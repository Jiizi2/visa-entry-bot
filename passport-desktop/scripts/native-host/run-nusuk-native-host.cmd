@echo off
setlocal
set SCRIPT_DIR=%~dp0
set NODE_SCRIPT=%SCRIPT_DIR%nusuk-contract-native-host.mjs
if not defined NUSUK_CONTRACT_DIR (
  set NUSUK_CONTRACT_DIR=C:\visa-entry-bot\passport-desktop\bridge-contract
)

set NODE_EXE=
if defined NODE_EXE if exist "%NODE_EXE%" goto run_host

for /f "delims=" %%I in ('where node.exe 2^>nul') do (
  set NODE_EXE=%%I
  goto run_host
)

if exist "%ProgramFiles%\nodejs\node.exe" (
  set NODE_EXE=%ProgramFiles%\nodejs\node.exe
  goto run_host
)
if exist "%ProgramFiles(x86)%\nodejs\node.exe" (
  set NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe
  goto run_host
)
if exist "%LocalAppData%\Programs\nodejs\node.exe" (
  set NODE_EXE=%LocalAppData%\Programs\nodejs\node.exe
  goto run_host
)
if exist "%USERPROFILE%\scoop\apps\nodejs\current\node.exe" (
  set NODE_EXE=%USERPROFILE%\scoop\apps\nodejs\current\node.exe
  goto run_host
)

echo Native host gagal: node.exe tidak ditemukan 1>&2
exit /b 1

:run_host
"%NODE_EXE%" "%NODE_SCRIPT%"
