!macro customInstall
  ; Open a selected folder in a new Netcatty local terminal.
  ; Args go after `--` so Electron/Chromium does not swallow them. Use
  ; `--open-terminal-path="%1."` so paths with spaces stay one token and drive
  ; roots (`C:\`) do not break Windows quote parsing.
  WriteRegStr SHCTX "Software\Classes\Directory\shell\Netcatty" "MUIVerb" "Open in Netcatty"
  WriteRegStr SHCTX "Software\Classes\Directory\shell\Netcatty" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\Directory\shell\Netcatty\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" -- --open-terminal-path="%1."'

  ; Open the directory currently displayed by Explorer.
  WriteRegStr SHCTX "Software\Classes\Directory\Background\shell\Netcatty" "MUIVerb" "Open in Netcatty"
  WriteRegStr SHCTX "Software\Classes\Directory\Background\shell\Netcatty" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\Directory\Background\shell\Netcatty\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" -- --open-terminal-path="%V."'
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Classes\Directory\shell\Netcatty"
  DeleteRegKey SHCTX "Software\Classes\Directory\Background\shell\Netcatty"
!macroend
