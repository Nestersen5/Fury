; Project-owned supported electron-builder NSIS hooks. Never patch templates.
; customHeader is expanded before Section "install" in the locked builder.
; This mandatory hidden section therefore precedes uninstallOldVersion, even
; in an elevated inner instance (which skips CHECK_APP_RUNNING).
!macro customHeader
  !ifndef BUILD_UNINSTALLER
    Var furyOldUserPath
    Var furyOldMachinePath
    Var furyUserExeLease
    Var furyMachineExeLease
    Var furyTargetExeLease
    Function furyHoldExecutable
      Exch $0
      StrCmp $0 "" fury_no_executable
      IfFileExists "$0\${APP_EXECUTABLE_FILENAME}" 0 fury_no_executable
      ; FILE_SHARE_DELETE permits the old uninstaller's rename/removal, while
      ; withholding FILE_SHARE_READ prevents a legacy Fury relaunch after the
      ; snapshot. NSIS owns this handle until replacement finishes or it exits.
      System::Call 'kernel32::CreateFileW(w "$0\${APP_EXECUTABLE_FILENAME}", i 0x80000000, i 4, p 0, i 3, i 0x80, p 0) p .r0'
      Goto fury_executable_return
      fury_no_executable:
        StrCpy $0 0
      fury_executable_return:
        Exch $0
    FunctionEnd
    Section "-Preserve Fury user data"
      SectionIn RO
      ; The locked template elevates a silent per-machine upgrade in its next
      ; section. Only the inner instance may own leases that span removal.
      ${if} $hasPerMachineInstallation == "1"
      ${andIf} ${Silent}
        ${ifNot} ${UAC_IsAdmin}
          Goto fury_storage_done
        ${endif}
      ${endif}
      InitPluginsDir
      ClearErrors
      ReadRegStr $furyOldUserPath HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
      ${if} $furyOldUserPath == ""
        ReadRegStr $0 HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString
        Push $0
        Call GetInQuotes
        Call GetFileParent
        Pop $furyOldUserPath
      ${endif}
      ReadRegStr $furyOldMachinePath HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
      ${if} $furyOldMachinePath == ""
        ReadRegStr $0 HKLM "${UNINSTALL_REGISTRY_KEY}" UninstallString
        Push $0
        Call GetInQuotes
        Call GetFileParent
        Pop $furyOldMachinePath
      ${endif}
      Push $furyOldUserPath
      Call furyHoldExecutable
      Pop $furyUserExeLease
      StrCmp $furyUserExeLease -1 fury_storage_failed
      ${if} $furyOldMachinePath != $furyOldUserPath
        Push $furyOldMachinePath
        Call furyHoldExecutable
        Pop $furyMachineExeLease
        StrCmp $furyMachineExeLease -1 fury_storage_failed
      ${endif}
      ${if} $INSTDIR != $furyOldUserPath
      ${andIf} $INSTDIR != $furyOldMachinePath
        Push $INSTDIR
        Call furyHoldExecutable
        Pop $furyTargetExeLease
        StrCmp $furyTargetExeLease -1 fury_storage_failed
      ${endif}
      ClearErrors
      SetOutPath "$PLUGINSDIR\fury-storage-runtime"
      ; Use only the NEW embedded application/runtime. No old app code, external
      ; Node dependency or downloaded migration executable is trusted here.
      ; Match extractEmbeddedAppPackage so NSIS can reference the same stored
      ; archive instead of embedding/recompressing a second 135+ MiB payload.
      !ifdef COMPRESS
        SetCompress off
      !endif
      File /oname=$PLUGINSDIR\app-64.7z "${APP_64}"
      !ifdef COMPRESS
        SetCompress "${COMPRESS}"
      !endif
      Nsis7z::Extract "$PLUGINSDIR\app-64.7z"
      IfErrors fury_storage_failed
      IfFileExists "$PLUGINSDIR\fury-storage-runtime\${APP_EXECUTABLE_FILENAME}" 0 fury_storage_failed
      ; Run normal Electron to resolve appData with its supported Windows API.
      ; Empty still enables Electron's RunAsNode mode. A NULL value deletes it.
      System::Call 'kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", p 0)'
      ClearErrors
      System::Call 'kernel32::GetCurrentProcessId() i .r0'
      ExecWait '"$PLUGINSDIR\fury-storage-runtime\${APP_EXECUTABLE_FILENAME}" --fury-preserve-storage "--fury-installer-pid=$0" "--fury-next-install=$INSTDIR" "--fury-preservation-result=$PLUGINSDIR\fury-storage-result.txt"' $0
      IfErrors fury_storage_failed
      StrCmp $0 0 fury_storage_done
      fury_storage_failed:
        StrCpy $1 "MIGRATION_HELPER_FAILED"
        FileOpen $2 "$PLUGINSDIR\fury-storage-result.txt" r
        IfErrors +3
        FileRead $2 $1
        FileClose $2
        MessageBox MB_OK|MB_ICONSTOP "Fury could not safely preserve your existing data. The upgrade has stopped before removing the old installation.$\r$\n$\r$\nSafety check: $1$\r$\n$\r$\nClose all Fury launchers and proxy processes. Check free disk space and folder permissions, then retry as the Windows user who owns the old Fury profile. Shared or ambiguous profiles need manual preservation by their owner.$\r$\n$\r$\nDo not uninstall the old version to bypass this check." /SD IDOK
        SetErrorLevel 70
        Quit
      fury_storage_done:
        SetOutPath "$PLUGINSDIR"
    SectionEnd
  !endif
!macroend

!ifndef BUILD_UNINSTALLER
  !macro customInstall
    System::Call 'kernel32::CloseHandle(p $furyUserExeLease)'
    System::Call 'kernel32::CloseHandle(p $furyMachineExeLease)'
    System::Call 'kernel32::CloseHandle(p $furyTargetExeLease)'
  !macroend
  !macro customCheckAppRunning
    ; The earlier mandatory preservation section checks all legacy locations
    ; and refuses active writers. Do not force-kill them after snapshotting.
  !macroend
!endif
