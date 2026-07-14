!include LogicLib.nsh

!macro customInstall
  firewallRule:
  nsExec::Exec 'netsh advfirewall firewall add rule name="Local Fitness Advisor" dir=in action=allow program="$INSTDIR\Local Fitness Advisor.exe" profile=private enable=yes'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Unable to configure private-network access (netsh exit code $0)." IDRETRY firewallRule
    Abort
  ${EndIf}
!macroend

!macro customUnInstall
  removeFirewallRule:
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Local Fitness Advisor" program="$INSTDIR\Local Fitness Advisor.exe"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Unable to remove the private-network firewall rule (netsh exit code $0)." IDRETRY removeFirewallRule
    Abort
  ${EndIf}
!macroend
