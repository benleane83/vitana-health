!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall add rule name="Local Fitness Advisor" dir=in action=allow program="$INSTDIR\Local Fitness Advisor.exe" profile=private enable=yes'
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Local Fitness Advisor" program="$INSTDIR\Local Fitness Advisor.exe"'
!macroend
