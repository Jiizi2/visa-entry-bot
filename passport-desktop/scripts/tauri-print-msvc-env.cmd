@echo off
setlocal

if "%TAURI_MSVC_VSDEVCMD%"=="" (
  echo TAURI_MSVC_VSDEVCMD belum di-set.
  exit /b 1
)

if not exist "%TAURI_MSVC_VSDEVCMD%" (
  echo VsDevCmd.bat tidak ditemukan: "%TAURI_MSVC_VSDEVCMD%"
  exit /b 1
)

call "%TAURI_MSVC_VSDEVCMD%" -arch=x64 -host_arch=x64 >nul
if errorlevel 1 exit /b %errorlevel%

set
