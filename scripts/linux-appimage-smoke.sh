#!/usr/bin/env bash
set -euo pipefail

appimage=${1:?Usage: linux-appimage-smoke.sh APPIMAGE EVIDENCE_DIRECTORY}
evidence_directory=${2:?Usage: linux-appimage-smoke.sh APPIMAGE EVIDENCE_DIRECTORY}
appimage=$(realpath "$appimage")
mkdir -p "$evidence_directory"
evidence_directory=$(realpath "$evidence_directory")

if [[ $(uname -m) != "x86_64" ]]; then
  echo "The Linux preview smoke test requires x86_64." >&2
  exit 1
fi
if [[ ${XDG_CURRENT_DESKTOP:-} != *GNOME* ]] || [[ -z ${DISPLAY:-}${WAYLAND_DISPLAY:-} ]]; then
  echo "A graphical GNOME session is required to prove tray and Secret Service behavior." >&2
  exit 1
fi
if ! gdbus call --session --dest org.freedesktop.secrets --object-path /org/freedesktop/secrets \
  --method org.freedesktop.DBus.Peer.Ping >/dev/null; then
  echo "GNOME Secret Service is unavailable." >&2
  exit 1
fi

smoke_root=$(mktemp -d)
desktop_pid=
cleanup() {
  if [[ -n ${desktop_pid:-} ]] && kill -0 "$desktop_pid" 2>/dev/null; then
    kill -TERM "$desktop_pid" 2>/dev/null || true
    wait "$desktop_pid" 2>/dev/null || true
  fi
  cp -a "$smoke_root/config/Vitana Health/logs/." "$evidence_directory/" 2>/dev/null || true
  rm -rf "$smoke_root"
}
trap cleanup EXIT

export XDG_CONFIG_HOME="$smoke_root/config"
export APPIMAGE_EXTRACT_AND_RUN=1
health_url=https://127.0.0.1:4317/api/health

start_desktop() {
  "$appimage" >"$evidence_directory/desktop.stdout.log" 2>"$evidence_directory/desktop.stderr.log" &
  desktop_pid=$!
  for _ in {1..120}; do
    if curl --silent --show-error --insecure --max-time 2 "$health_url" | grep -q '"ok":true'; then
      return
    fi
    if ! kill -0 "$desktop_pid" 2>/dev/null; then
      wait "$desktop_pid" || true
      echo "The AppImage exited before its HTTPS API became healthy." >&2
      exit 1
    fi
    sleep 0.5
  done
  echo "The AppImage did not expose its HTTPS API within 60 seconds." >&2
  exit 1
}

stop_desktop() {
  kill -TERM "$desktop_pid"
  for _ in {1..60}; do
    kill -0 "$desktop_pid" 2>/dev/null || { wait "$desktop_pid" || true; desktop_pid=; return; }
    sleep 0.5
  done
  echo "The AppImage did not shut down cleanly within 30 seconds." >&2
  exit 1
}

start_desktop
user_data="$XDG_CONFIG_HOME/Vitana Health"
manifest="$user_data/storage-backend.json"
key_file="$user_data/store-key.v1.json"
database=$(find "$user_data/duckdb-storage" -name '*.duckdb' -type f -print -quit)
[[ -f "$manifest" ]] && grep -q '"backend"[[:space:]]*:[[:space:]]*"duckdb"' "$manifest"
[[ -f "$key_file" ]] && grep -q '"wrappedKey"' "$key_file"
[[ -n "$database" ]]
manifest_sha=$(sha256sum "$manifest" | cut -d' ' -f1)
key_sha=$(sha256sum "$key_file" | cut -d' ' -f1)
stop_desktop

start_desktop
[[ $(sha256sum "$manifest" | cut -d' ' -f1) == "$manifest_sha" ]]
[[ $(sha256sum "$key_file" | cut -d' ' -f1) == "$key_sha" ]]
stop_desktop

{
  sha256sum "$appimage"
  printf 'gnome_session=true\nsecret_service=true\nencrypted_duckdb_reopened=true\nclean_shutdown=true\n'
} >"$evidence_directory/appimage-smoke-evidence.txt"
