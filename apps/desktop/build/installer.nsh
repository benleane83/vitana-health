!include LogicLib.nsh

; The private-network firewall rule is a convenience, not a correctness requirement: the app binds
; loopback until a companion device is paired, and an unpaired install works fine without it. On an
; upgrade over an existing install the `add rule` call routinely reports a non-zero exit code (the
; rule already exists, or Windows Firewall is managed by policy). Aborting there fails the whole
; upgrade and leaves the user on a half-removed version, so failures are logged and tolerated.
!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Local Fitness Advisor"'
  Pop $0
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Vitana Health" program="$INSTDIR\Vitana Health.exe"'
  Pop $0
  nsExec::Exec 'netsh advfirewall firewall add rule name="Vitana Health" dir=in action=allow program="$INSTDIR\Vitana Health.exe" profile=private enable=yes'
  Pop $0
  ${If} $0 != 0
    DetailPrint "Warning: could not configure private-network access (netsh exit code $0). Pairing a phone may require allowing Vitana Health through Windows Firewall manually."
  ${EndIf}
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Vitana Health" program="$INSTDIR\Vitana Health.exe"'
  Pop $0
  ${If} $0 != 0
    DetailPrint "Warning: could not remove the private-network firewall rule (netsh exit code $0)."
  ${EndIf}
!macroend
