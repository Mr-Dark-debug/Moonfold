!include "StrFunc.nsh"
!ifdef BUILD_UNINSTALLER
  ${UnStrRep}
  !define MoonfoldStrRep '${UnStrRep}'
!else
  ${StrRep}
  !define MoonfoldStrRep '${StrRep}'
!endif

!macro customAppRunningMessages
  Push $0
  Push $1
  ${If} $IsPowerShellAvailable == 0
    System::Call 'kernel32::SetEnvironmentVariable(t "MOONFOLD_INSTALL_DIR", t "$INSTDIR")'
    nsExec::ExecToStack `"$PowerShellPath" -NoProfile -NonInteractive -C "Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ExecutablePath -and [IO.Path]::GetDirectoryName($$_.ExecutablePath) -eq $$env:MOONFOLD_INSTALL_DIR } | ForEach-Object { [IO.Path]::GetFileNameWithoutExtension($$_.ExecutablePath) } | Where-Object { $$_ -in 'Moonfold (Alpha)', 'Moonfold (Beta)', 'Moonfold (Nightly)' } | Select-Object -First 1 | ForEach-Object { [Console]::Write($$_) }"`
    Pop $0
    Pop $1
    System::Call 'kernel32::SetEnvironmentVariable(t "MOONFOLD_INSTALL_DIR", p 0)'
    ${If} $0 == 0
      ${If} $1 == "Moonfold (Alpha)"
      ${OrIf} $1 == "Moonfold (Beta)"
      ${OrIf} $1 == "Moonfold (Nightly)"
        ${MoonfoldStrRep} $appRunningMessage $appRunningMessage "${PRODUCT_NAME}" $1
        ${MoonfoldStrRep} $appClosingMessage $appClosingMessage "${PRODUCT_NAME}" $1
        ${MoonfoldStrRep} $appCannotBeClosedMessage $appCannotBeClosedMessage "${PRODUCT_NAME}" $1
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Pop $1
  Pop $0
!macroend

; electron-builder counts running copies with `(...).Count -gt 0`, which Windows PowerShell 5.1 leaves
; empty for a single match. A lone helper started from the app's .exe (agent-device, a server) then
; survived an upgrade, the new .exe could not be written, and only the uninstaller was left.
; Defining customCheckAppRunning makes electron-builder skip these two, which its check still uses.
!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
  Push $0
  ${If} $IsPowerShellAvailable == 0
    nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -C "@(Get-CimInstance -ClassName Win32_Process | ? {$$_.Path -and $$_.Path.StartsWith('$INSTDIR', 'CurrentCultureIgnoreCase')}) | % { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  ${Else}
    nsExec::Exec `"$CmdPath" /C taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /FI "PID ne $pid" /FI "USERNAME eq %USERNAME%"`
  ${EndIf}
  Pop $0
  Pop $0
  Sleep 500
!macroend

!macro customInstall
  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    ${IfNot} ${FileExists} "$newStartMenuLink"
      !insertmacro createMenuDirectory
      CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    ${EndIf}
  !endif
!macroend
