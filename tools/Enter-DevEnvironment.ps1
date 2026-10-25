# Dot-source this file: . .\tools\Enter-DevEnvironment.ps1
[CmdletBinding()]
param([string]$EnvironmentRoot = 'C:\Code\SoftEnv')

$pnpmDirectory = Join-Path $EnvironmentRoot 'package-manager\pnpm\12.15.0'
$pnpmCommand = Join-Path $pnpmDirectory 'pnpm.cmd'
if (-not (Test-Path -LiteralPath $pnpmCommand)) {
    throw "pnpm is missing at $pnpmCommand. Run Setup-WindowsEnvironment.ps1 first."
}
if (($env:Path -split ';') -notcontains $pnpmDirectory) {
    $env:Path = $pnpmDirectory + ';' + $env:Path
}
# These are process-scoped settings, not persistent user/global configuration.
$env:npm_config_cache = Join-Path $EnvironmentRoot 'cache\npm'
$env:pnpm_config_store_dir = Join-Path $EnvironmentRoot 'cache\pnpm'
$env:ELECTRON_CACHE = Join-Path $EnvironmentRoot 'cache\electron'
$env:ELECTRON_BUILDER_CACHE = Join-Path $EnvironmentRoot 'cache\electron-builder'
Write-Output "Development environment active: $EnvironmentRoot"
& $pnpmCommand --version
if ($LASTEXITCODE -ne 0) { throw 'pnpm verification failed.' }
