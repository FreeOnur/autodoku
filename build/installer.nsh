; AutoDoku – Zusätze für den Installer
!macro customInstall
  ; Reste der alten Installation (AutoDoku installieren.bat) aufräumen
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AutoDoku"
  Delete "$INSTDIR\uninstall.ps1"
  RMDir /r "$INSTDIR\_claude"
!macroend

!macro customUnInstall
  ; Heruntergeladene Teile (Whisper-Modell, Ollama) liegen in %APPDATA%\AutoDoku und bleiben erhalten,
  ; genau wie Notizen und Einstellungen. Ollama-Prozess beenden, falls AutoDoku ihn gestartet hat.
  nsExec::Exec 'taskkill /F /IM whisper-server.exe'
!macroend
