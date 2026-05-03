param(
  [Parameter(Mandatory = $true)]
  [string]$ExtensionId
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$templatePath = Join-Path $repoRoot "browser-extension\nusuk-bridge-extension\native-host\com.visaentry.nusuk_bridge.template.json"
$manifestPath = Join-Path $repoRoot "scripts\native-host\com.visaentry.nusuk_bridge.json"

if (-not (Test-Path $templatePath)) {
  throw "Template manifest tidak ditemukan: $templatePath"
}

$raw = Get-Content -Raw -Path $templatePath
$raw = $raw.Replace("__EXTENSION_ID__", $ExtensionId)
Set-Content -Path $manifestPath -Value $raw -Encoding UTF8

$regPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.visaentry.nusuk_bridge"
New-Item -Path $regPath -Force | Out-Null
Set-ItemProperty -Path $regPath -Name "(default)" -Value $manifestPath

$regPathEdge = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.visaentry.nusuk_bridge"
New-Item -Path $regPathEdge -Force | Out-Null
Set-ItemProperty -Path $regPathEdge -Name "(default)" -Value $manifestPath

Write-Host "Native host installed."
Write-Host "Manifest: $manifestPath"
Write-Host "Chrome reg : $regPath"
Write-Host "Edge reg   : $regPathEdge"
