param(
  [string]$ReleaseRoot = ".local-release",
  [switch]$IncludePortable
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$DesktopDir = Join-Path $RepoRoot "passport-desktop"
$ExtensionDir = Join-Path $RepoRoot "chrome-extension"
$PythonOcrDir = Join-Path $RepoRoot "python-ocr"
$PythonOcrExecutable = Join-Path $PythonOcrDir ".venv\Scripts\python.exe"
$TauriConfigPath = Join-Path $DesktopDir "src-tauri\tauri.conf.json"
$ExtensionManifestPath = Join-Path $ExtensionDir "manifest.json"

if (-not (Test-Path $TauriConfigPath)) {
  throw "Tauri config tidak ditemukan: $TauriConfigPath"
}
if (-not (Test-Path $ExtensionManifestPath)) {
  throw "Extension manifest tidak ditemukan: $ExtensionManifestPath"
}
if (-not (Test-Path $PythonOcrExecutable)) {
  throw "Python OCR virtualenv tidak ditemukan untuk build worker: $PythonOcrExecutable"
}

$TauriConfig = Get-Content $TauriConfigPath -Raw | ConvertFrom-Json
$ExtensionManifest = Get-Content $ExtensionManifestPath -Raw | ConvertFrom-Json
$Version = if ($TauriConfig.version) { [string]$TauriConfig.version } else { "0.0.0" }
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$ReleaseDir = Join-Path (Join-Path $RepoRoot $ReleaseRoot) "entrymate-by-ghaniya-$Version-$Stamp-jiddan-version"
$DesktopPortableDir = Join-Path $ReleaseDir "desktop-portable"
$ExtensionReleaseDir = Join-Path $ReleaseDir "extension"
$TauriReleaseResourcesDir = Join-Path $DesktopDir "src-tauri\release-resources"
$TauriReleaseConfigPath = Join-Path $DesktopDir "src-tauri\tauri.local-release.conf.json"

function Assert-ChildPath {
  param(
    [Parameter(Mandatory = $true)][string]$Parent,
    [Parameter(Mandatory = $true)][string]$Child
  )

  $ParentFullPath = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\', '/')
  $ChildFullPath = [System.IO.Path]::GetFullPath($Child)
  if (-not $ChildFullPath.StartsWith($ParentFullPath + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Path cleanup di luar release dir ditolak: $ChildFullPath"
  }
}

function Copy-DirectoryWithRobocopy {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination,
    [string[]]$ExcludeDirs = @(),
    [string[]]$ExcludeFiles = @()
  )

  New-Item -ItemType Directory -Force -Path $Destination | Out-Null

  $Arguments = @($Source, $Destination, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP")
  if ($ExcludeDirs.Count) {
    $Arguments += "/XD"
    $Arguments += $ExcludeDirs
  }
  if ($ExcludeFiles.Count) {
    $Arguments += "/XF"
    $Arguments += $ExcludeFiles
  }

  & robocopy @Arguments | Out-Host
  if ($LASTEXITCODE -gt 7) {
    throw "Gagal copy folder dengan robocopy exit code $LASTEXITCODE dari $Source ke $Destination"
  }
  $global:LASTEXITCODE = 0
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

function Build-OcrWorker {
  Ensure-PyInstaller

  $DistRoot = Join-Path $PythonOcrDir ".dist"
  $BuildRoot = Join-Path $PythonOcrDir ".tmp\pyinstaller-build"
  $SpecRoot = Join-Path $PythonOcrDir ".tmp\pyinstaller-spec"
  $WorkerDist = Join-Path $DistRoot "scan_worker"

  New-Item -ItemType Directory -Force -Path $DistRoot, $BuildRoot, $SpecRoot | Out-Null
  $ServicesData = Join-Path $PythonOcrDir "services\data"

  Push-Location $PythonOcrDir
  try {
    Write-Host "Building OCR worker executable..."
    & $PythonOcrExecutable -m PyInstaller `
      --noconfirm `
      --clean `
      --onedir `
      --name scan_worker `
      --distpath $DistRoot `
      --workpath $BuildRoot `
      --specpath $SpecRoot `
      --add-data "${ServicesData};services\data" `
      --collect-submodules passporteye `
      --collect-all rapidocr_onnxruntime `
      --copy-metadata imageio `
      scan_worker.py
    if ($LASTEXITCODE -ne 0) {
      throw "Gagal build OCR worker executable."
    }
  } finally {
    Pop-Location
  }

  $WorkerExe = Join-Path $WorkerDist "scan_worker.exe"
  if (-not (Test-Path $WorkerExe)) {
    throw "OCR worker executable tidak ditemukan setelah build: $WorkerExe"
  }
  return $WorkerDist
}

function Stage-DesktopInstallerResources {
  $WorkerDist = Build-OcrWorker
  $SrcTauriDir = Join-Path $DesktopDir "src-tauri"

  if (Test-Path $TauriReleaseResourcesDir) {
    Assert-ChildPath -Parent $SrcTauriDir -Child $TauriReleaseResourcesDir
    Remove-Item -LiteralPath $TauriReleaseResourcesDir -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $TauriReleaseResourcesDir | Out-Null

  $WorkerTarget = Join-Path $TauriReleaseResourcesDir "python-ocr-dist"
  Write-Host "Staging OCR worker for desktop installer..."
  Copy-DirectoryWithRobocopy -Source $WorkerDist -Destination $WorkerTarget
  if (-not (Test-Path (Join-Path $WorkerTarget "scan_worker.exe"))) {
    throw "OCR worker bundle tidak lengkap: scan_worker.exe tidak ditemukan."
  }

  @"
{
  "bundle": {
    "resources": {
      "release-resources/python-ocr-dist": "python-ocr-dist"
    }
  }
}
"@ | Set-Content -Path $TauriReleaseConfigPath -Encoding UTF8
}

function Copy-OptionalPortableDesktop {
  $DesktopExe = Join-Path $DesktopDir "src-tauri\target\release\entrymate-by-ghaniya.exe"
  if (-not (Test-Path $DesktopExe)) {
    throw "Executable desktop tidak ditemukan: $DesktopExe"
  }

  New-Item -ItemType Directory -Force -Path $DesktopPortableDir | Out-Null
  Copy-Item -LiteralPath $DesktopExe -Destination $DesktopPortableDir
  Copy-DirectoryWithRobocopy `
    -Source (Join-Path $TauriReleaseResourcesDir "python-ocr-dist") `
    -Destination (Join-Path $DesktopPortableDir "python-ocr-dist")
}

New-Item -ItemType Directory -Force -Path $ReleaseDir | Out-Null

Push-Location $RepoRoot
try {
  Stage-DesktopInstallerResources

  $BundleDir = Join-Path $DesktopDir "src-tauri\target\release\bundle"
  if (Test-Path (Join-Path $BundleDir "nsis")) {
    Remove-Item -Path (Join-Path $BundleDir "nsis\*.exe") -Force -ErrorAction SilentlyContinue
  }

  Write-Host "Building one-file desktop installer..."
  npm --prefix passport-desktop run tauri -- build --bundles nsis --config $TauriReleaseConfigPath --ci
  if ($LASTEXITCODE -ne 0) {
    throw "Gagal build desktop installer."
  }
  $Installer = Get-ChildItem -Path (Join-Path $BundleDir "nsis\*.exe") -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $Installer) {
    throw "NSIS installer desktop tidak ditemukan di $BundleDir"
  }

  $DesktopInstallerName = "entrymate-by-ghaniya-desktop-$Version-jiddan-version-setup.exe"
  $DesktopInstallerOutput = Join-Path $ReleaseDir $DesktopInstallerName
  Copy-Item -LiteralPath $Installer.FullName -Destination $DesktopInstallerOutput -Force

  Write-Host "Copying Chrome Extension to release directory..."
  Copy-DirectoryWithRobocopy `
    -Source $ExtensionDir `
    -Destination $ExtensionReleaseDir `
    -ExcludeDirs @(".git", "node_modules", "test", ".review") `
    -ExcludeFiles @(".gitignore", "package.json")

  if ($IncludePortable) {
    Copy-OptionalPortableDesktop
  }

  $NotesPath = Join-Path $ReleaseDir "README_LOCAL_RELEASE.md"
  @"
# EntryMate By Ghaniya Local Release

Version: $Version
Generated: $((Get-Date).ToString("yyyy-MM-dd HH:mm:ss"))

## Desktop

Install file ini:

- $DesktopInstallerName

Installer desktop sudah membawa OCR worker executable (RapidOCR), jadi device target tidak perlu install Python manual.

## Chrome Extension

Folder ekstensi Chrome tersedia di:

- `extension/`

Cara install di Chrome:
1. Buka browser Google Chrome dan navigasi ke `chrome://extensions/`.
2. Aktifkan **Developer mode** di pojok kanan atas.
3. Klik **Load unpacked** (Muat ekstensi yang belum dikemas) di pojok kiri atas.
4. Pilih folder `extension/` yang ada di dalam rilis ini.

## Data Lokal

Passport, manifest hasil scan, dan review artifact tidak ikut dipaketkan. Simpan semuanya lokal di device masing-masing.
"@ | Set-Content -Path $NotesPath -Encoding UTF8

  Write-Host "Local release siap:"
  Write-Host $ReleaseDir
} finally {
  Pop-Location
}
