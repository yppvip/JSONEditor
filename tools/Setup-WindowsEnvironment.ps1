[CmdletBinding()]
param(
    [string]$EnvironmentRoot = 'D:\5DevelopmentEnvironment',
    [string]$PnpmVersion = '12.15.0',
    [switch]$AddToUserPath
)

$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This setup script is for Windows.' }
if ($PnpmVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Use an exact stable pnpm version.' }
$EnvironmentRoot = [IO.Path]::GetFullPath($EnvironmentRoot)
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$nodeVersion = (& $nodePath --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v24\.' -or [version]$nodeVersion.TrimStart('v') -lt [version]'24.16.0') {
    throw "Expected an existing Node.js >=24.16.0 <25 installation, found $nodeVersion. No Node installation was changed."
}
$npmPath = (Get-Command npm.cmd -ErrorAction Stop).Source
$pnpmDirectory = Join-Path $EnvironmentRoot "package-manager\pnpm\$PnpmVersion"
$pnpmCommand = Join-Path $pnpmDirectory 'pnpm.cmd'
$metadataDirectory = Join-Path $EnvironmentRoot 'metadata'
$cacheDirectory = Join-Path $EnvironmentRoot 'cache\npm'
foreach ($directory in @($pnpmDirectory, $metadataDirectory, $cacheDirectory,
    (Join-Path $EnvironmentRoot 'cache\pnpm'),
    (Join-Path $EnvironmentRoot 'cache\electron'),
    (Join-Path $EnvironmentRoot 'cache\electron-builder'),
    (Join-Path $EnvironmentRoot 'temp'))) {
    [void][IO.Directory]::CreateDirectory($directory)
}

if (Test-Path -LiteralPath $pnpmCommand) {
    $installedVersion = (& $pnpmCommand --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $installedVersion -ne $PnpmVersion) {
        throw "An unexpected installation already exists at $pnpmDirectory; refusing to overwrite it."
    }
    Write-Output "Reusing pnpm $installedVersion at $pnpmDirectory"
} else {
    & $npmPath install --global --prefix $pnpmDirectory "pnpm@$PnpmVersion" `
        --registry=https://registry.npmjs.org/ --cache $cacheDirectory `
        --no-audit --no-fund --fetch-retries=0 --fetch-timeout=30000
    if ($LASTEXITCODE -ne 0) { throw "pnpm installation failed with exit code $LASTEXITCODE; PATH was not changed." }
    $installedVersion = (& $pnpmCommand --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $installedVersion -ne $PnpmVersion) { throw 'Installed pnpm version verification failed.' }
}

# Preserve the raw user PATH, including expandable variables. Never modify machine PATH.
$userPathBefore = [Environment]::GetEnvironmentVariable('Path', 'User')
$userEntries = @($userPathBefore -split ';' | Where-Object { $_ })
$alreadyPresent = @($userEntries | Where-Object {
    [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\') -ieq $pnpmDirectory.TrimEnd('\')
}).Count -gt 0
if ($AddToUserPath -and -not $alreadyPresent) {
    $backupPath = Join-Path $metadataDirectory ('user-path-before-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffffffZ') + '.json')
    $backup = [ordered]@{
        capturedAtUtc = [DateTime]::UtcNow.ToString('o')
        userPath = $userPathBefore
        addedEntry = $pnpmDirectory
    }
    [IO.File]::WriteAllText($backupPath, ($backup | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    $userPathAfter = $pnpmDirectory + ';' + $userPathBefore
    [Environment]::SetEnvironmentVariable('Path', $userPathAfter, 'User')
    if ([Environment]::GetEnvironmentVariable('Path', 'User') -ne $userPathAfter) { throw 'User PATH verification failed.' }
    Write-Output "Added user PATH entry: $pnpmDirectory"
    Write-Output "Previous user PATH saved to: $backupPath"
} elseif ($alreadyPresent) {
    Write-Output 'User PATH already contains the selected pnpm directory.'
} else {
    Write-Output 'User PATH was not changed. Dot-source tools/Enter-DevEnvironment.ps1 in new terminals.'
}
$env:Path = $pnpmDirectory + ';' + $env:Path
Write-Output "Node: $nodeVersion ($nodePath)"
Write-Output "pnpm: $installedVersion ($pnpmCommand)"
Write-Output 'Machine PATH, global npm configuration, existing tool installations, and PowerShell execution policy were not changed.'
Write-Output 'Existing terminals may need to load tools/Enter-DevEnvironment.ps1 or restart their parent application.'
