@echo off
set SCRIPT_DIR=%~dp0
set OCR_RUNNER=%SCRIPT_DIR%python-ocr\run.cmd

if not exist "%OCR_RUNNER%" (
  echo OCR runner not found: "%OCR_RUNNER%"
  exit /b 1
)

call "%OCR_RUNNER%" %*
exit /b %errorlevel%
