param(
    [Parameter(Position = 0)]
    [string]$Group
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonExe = Join-Path $scriptDir ".venv\Scripts\python.exe"
$mainScript = Join-Path $scriptDir "main.py"

if (-not (Test-Path $pythonExe)) {
    Write-Error "Python venv not found: $pythonExe"
    exit 1
}

if (-not (Test-Path $mainScript)) {
    Write-Error "main.py not found: $mainScript"
    exit 1
}

if ([string]::IsNullOrWhiteSpace($Group)) {
    & $pythonExe $mainScript
    exit $LASTEXITCODE
}

& $pythonExe $mainScript $Group
exit $LASTEXITCODE
