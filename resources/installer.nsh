; Included by electron-builder's NSIS installer and uninstaller (buildResources is resources/, so it is found by name).
; Without this macro the installer closes a running Scraper Studio with taskkill, which ends a research run or an AI
; call halfway. Instead it waits until the person quits the app themselves; the app warns them first if work is running.
; nsProcess FindProcess sets $R0 to 0 while a process with that file name runs. A silent install (/S) gives up.
!macro customCheckAppRunning
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${While} $R0 == 0
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${PRODUCT_NAME} is open. Close its window (it asks first if a run is still going), then click Retry." /SD IDCANCEL IDRETRY +2
    Quit
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${EndWhile}
!macroend
