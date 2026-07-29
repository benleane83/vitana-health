/**
 * Owns the desktop shell's shutdown path.
 *
 * Quitting is the only moment where the encrypted DuckDB databases are checkpointed and their
 * handles released. Anything that lets the process die before that finishes - a hung HTTP
 * connection keeping `server.close()` pending, an uncaught exception unwinding past the
 * `before-quit` handler, Windows force-killing a process that took too long to exit - risks
 * leaving a store that the next launch has to recover rather than simply open.
 *
 * The logic lives here, behind injected collaborators, because none of it is reachable from a test
 * once it is written inline against Electron's `app` singleton.
 */
function createDesktopLifecycle({
  app,
  diagnostics,
  shutdownTimeoutMs = 10_000,
  schedule = setTimeout,
  clearScheduled = clearTimeout,
  exit = (code) => app.exit(code)
}) {
  let server;
  let quitting = false;
  let shutdownPromise;
  let updateInstallPending = false;

  function withTimeout(promise, label) {
    return new Promise((resolve, reject) => {
      const timer = schedule(() => reject(new Error(`${label} timed out after ${shutdownTimeoutMs}ms.`)), shutdownTimeoutMs);
      timer?.unref?.();
      promise.then(
        (value) => { clearScheduled(timer); resolve(value); },
        (error) => { clearScheduled(timer); reject(error); }
      );
    });
  }

  /**
   * Closes the embedded API, releasing storage. Idempotent and never runs twice concurrently, so
   * `before-quit`, a fatal error and an update install can all call it without racing each other.
   */
  function closeServer(label) {
    if (!server) return Promise.resolve();
    // Invoked eagerly rather than in a `.then` so `shutdownPromise` is set before control returns
    // to Electron - a second `before-quit` must never be able to start a second shutdown.
    shutdownPromise ??= withTimeout((async () => server.shutdown())(), label)
      .then(() => { server = undefined; })
      .catch((error) => { shutdownPromise = undefined; throw error; });
    return shutdownPromise;
  }

  return {
    setServer(next) { server = next; },
    hasServer() { return Boolean(server); },
    isQuitting() { return quitting; },
    markQuitting() { quitting = true; },
    isUpdateInstallPending() { return updateInstallPending; },

    /** Shuts the API down ahead of an installer run; leaves the app alive if it fails. */
    async prepareForUpdateInstall(onClosed) {
      if (updateInstallPending) return;
      updateInstallPending = true;
      quitting = true;
      try {
        await closeServer("Embedded API shutdown");
      } catch (error) {
        updateInstallPending = false;
        quitting = false;
        throw error;
      }
      await onClosed?.();
    },

    /**
     * `before-quit` handler. Defers the quit until storage is closed, but only for a bounded
     * window - a shutdown that hangs must not leave a window-less process the user cannot kill.
     */
    handleBeforeQuit(event) {
      quitting = true;
      diagnostics.info("Application shutdown requested");
      if (updateInstallPending) return;
      if (shutdownPromise || !server) return;
      event.preventDefault();
      void closeServer("Embedded API shutdown")
        .then(() => app.quit())
        .catch((error) => {
          diagnostics.error("Embedded API shutdown failed", error);
          exit(1);
        });
    },

    /**
     * Last-resort handler for `uncaughtException` / `unhandledRejection`. The process is already in
     * an undefined state, so the only useful work left is flushing and closing storage before it
     * goes away.
     */
    handleFatalError(kind, error) {
      diagnostics.error(kind, error);
      if (!server) return Promise.resolve();
      quitting = true;
      return closeServer("Emergency storage shutdown")
        .catch((closeError) => diagnostics.error("Emergency storage shutdown failed", closeError))
        .then(() => exit(1));
    }
  };
}

module.exports = { createDesktopLifecycle };
