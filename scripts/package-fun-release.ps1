param(
  [string]$ReleaseRoot = ".local-release",
  [string]$TesseractRoot = ""
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$PythonOcrDir = Join-Path $RepoRoot "python-ocr"
$PythonOcrExecutable = Join-Path $PythonOcrDir ".venv\Scripts\python.exe"

if (-not (Test-Path $PythonOcrExecutable)) {
  throw "Python OCR virtualenv tidak ditemukan untuk build worker: $PythonOcrExecutable"
}

$Version = "1.0.19"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$ReleaseDir = Join-Path (Join-Path $RepoRoot $ReleaseRoot) "entrymate-fun-mode-$Version-$Stamp"

function Resolve-TesseractRoot {
  param([string]$ConfiguredRoot)

  $Candidates = @()
  if ($ConfiguredRoot) {
    $Candidates += $ConfiguredRoot
  }
  $Command = Get-Command tesseract -ErrorAction SilentlyContinue
  if ($Command -and $Command.Source) {
    $Candidates += (Split-Path -Parent $Command.Source)
  }
  $Candidates += @(
    "C:\Program Files\Tesseract-OCR",
    "C:\Program Files (x86)\Tesseract-OCR"
  )

  foreach ($Candidate in $Candidates) {
    if (-not $Candidate) {
      continue
    }
    $Resolved = $null
    try {
      $Resolved = (Resolve-Path $Candidate -ErrorAction Stop).Path
    } catch {
      continue
    }
    if (Test-Path (Join-Path $Resolved "tesseract.exe")) {
      return $Resolved
    }
  }

  throw "Tesseract tidak ditemukan. Install Tesseract atau jalankan dengan parameter -TesseractRoot 'C:\Path\Tesseract-OCR'"
}

function Ensure-PyInstaller {
  $PreviousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $PythonOcrExecutable -c "import PyInstaller" 1>$null 2>$null
    $HasPyInstaller = $LASTEXITCODE -eq 0
  } finally {
    $ErrorActionPreference = $PreviousErrorActionPreference
  }

  if ($HasPyInstaller) {
    return
  }

  Write-Host "Installing PyInstaller build dependency..."
  & $PythonOcrExecutable -m pip install -r (Join-Path $PythonOcrDir "requirements-dev.txt")
  if ($LASTEXITCODE -ne 0) {
    throw "Gagal install dependency build OCR worker."
  }
}

function Build-FunModeWorker {
  Ensure-PyInstaller

  $DistRoot = Join-Path $PythonOcrDir ".dist"
  $BuildRoot = Join-Path $PythonOcrDir ".tmp\pyinstaller-build"
  $SpecRoot = Join-Path $PythonOcrDir ".tmp\pyinstaller-spec"

  New-Item -ItemType Directory -Force -Path $DistRoot, $BuildRoot, $SpecRoot | Out-Null
  $ServicesData = Join-Path $PythonOcrDir "services\data"
  $ResolvedTesseractRoot = Resolve-TesseractRoot -ConfiguredRoot $TesseractRoot

  Push-Location $PythonOcrDir
  try {
    Write-Host "Building Fun Mode single executable..."
    & $PythonOcrExecutable -m PyInstaller `
      --noconfirm `
      --clean `
      --onefile `
      --name entrymate_fun `
      --distpath $DistRoot `
      --workpath $BuildRoot `
      --specpath $SpecRoot `
      --add-data "${ServicesData};services\data" `
      --add-data "${ResolvedTesseractRoot};tesseract" `
      --add-data "${RepoRoot}\passport-desktop\public\welcome.jpeg;." `
      --add-data "${RepoRoot}\passport-desktop\public\scan_complete.jpeg;." `
      --add-data "${RepoRoot}\passport-desktop\public\review_complete.jpeg;." `
      --add-data "${RepoRoot}\passport-desktop\public\export_complete.jpeg;." `
      --collect-submodules passporteye `
      --copy-metadata imageio `
      main_fun.py
    if ($LASTEXITCODE -ne 0) {
      throw "Gagal build Fun Mode executable."
    }
  } finally {
    Pop-Location
  }

  $WorkerExe = Join-Path $DistRoot "entrymate_fun.exe"
  if (-not (Test-Path $WorkerExe)) {
    throw "Fun Mode executable tidak ditemukan setelah build: $WorkerExe"
  }
  return $WorkerExe
}

New-Item -ItemType Directory -Force -Path $ReleaseDir | Out-Null

Push-Location $RepoRoot
try {
  $WorkerExe = Build-FunModeWorker

  Write-Host "Staging Fun Mode executable..."
  Copy-Item -Path $WorkerExe -Destination $ReleaseDir -Force

  $NotesPath = Join-Path $ReleaseDir "README_FUN_MODE.md"
  @"
# EntryMate By Ghaniya - Fun Mode Release

Version: $Version
Generated: $((Get-Date).ToString("yyyy-MM-dd HH:mm:ss"))

## Fun Mode

Cukup jalankan \`entrymate_fun.exe\` dari Command Prompt dengan argumen folder passport:

Contoh:
\`\`\`cmd
entrymate_fun.exe C:\path\to\passports
\`\`\`

## Dependensi
Executable ini berjalan mandiri (standalone .exe) karena menggunakan pyinstaller onefile build. Semua model Tesseract dan gambar sudah ada di dalamnya.
"@ | Set-Content -Path $NotesPath -Encoding UTF8

  Write-Host "Fun Mode single-file release siap:"
  Write-Host $ReleaseDir
} finally {
  Pop-Location
}
