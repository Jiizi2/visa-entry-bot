@echo off
set SCRIPT_DIR=%~dp0
set PYTHON_EXE=%SCRIPT_DIR%.venv\Scripts\python.exe
set MAIN_SCRIPT=%SCRIPT_DIR%main.py

if not exist "%PYTHON_EXE%" (
  echo Python venv not found: "%PYTHON_EXE%"
  exit /b 1
)

if not exist "%MAIN_SCRIPT%" (
  echo main.py not found: "%MAIN_SCRIPT%"
  exit /b 1
)

"%PYTHON_EXE%" "%MAIN_SCRIPT%" %*
exit /b %errorlevel%
