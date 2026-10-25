[CmdletBinding()]
param([string]$EnvironmentRoot = 'C:\Code\SoftEnv')

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path $PSScriptRoot -Parent
$checks = [Collections.Generic.List[object]]::new()
function Add-Check([string]$Name, [bool]$Passed, [object]$Details) {
    $checks.Add([pscustomobject]@{ name = $Name; passed = $Passed; details = $Details })
    Write-Output "$Name : $Passed"
}

# Emulate a fresh normal user shell: exclude paths injected by the agent host.
$machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$env:Path = [Environment]::ExpandEnvironmentVariables($machinePath + ';' + $userPath)
$env:npm_config_cache = Join-Path $EnvironmentRoot 'cache\npm'
$env:pnpm_config_store_dir = Join-Path $EnvironmentRoot 'cache\pnpm'
$env:ELECTRON_CACHE = Join-Path $EnvironmentRoot 'cache\electron'
$env:ELECTRON_BUILDER_CACHE = Join-Path $EnvironmentRoot 'cache\electron-builder'

foreach ($name in @('node', 'npm.cmd', 'pnpm.cmd', 'corepack.cmd', 'git', 'code.cmd')) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if (-not $command) {
        Add-Check $name $false 'Command not found in persisted machine/user PATH'
        continue
    }
    $versionOutput = @(& $command.Source --version 2>&1 | ForEach-Object { "$_" })
    $commandExitCode = $LASTEXITCODE
    Add-Check $name ($commandExitCode -eq 0) ([ordered]@{
        path = $command.Source; version = $versionOutput; exitCode = $commandExitCode
        allPaths = @((Get-Command $name -All).Source)
    })
}

$nodeOutput = & node --eval 'if (process.versions.node.split(".")[0] !== "24") process.exit(1); console.log(JSON.stringify({node: process.version, platform: process.platform, arch: process.arch, calculation: 6 * 7}));'
Add-Check 'node-execution' ($LASTEXITCODE -eq 0) $nodeOutput
$pnpmVersion = (& pnpm.cmd --version).Trim()
Add-Check 'pnpm-version-pin' ($LASTEXITCODE -eq 0 -and $pnpmVersion -eq '12.15.0') $pnpmVersion
$storePath = (& pnpm.cmd store path).Trim()
Add-Check 'project-store-environment' ($LASTEXITCODE -eq 0 -and $storePath.StartsWith((Join-Path $EnvironmentRoot 'cache\pnpm'), [StringComparison]::OrdinalIgnoreCase)) $storePath
$pingOutput = @(& npm.cmd ping --registry=https://registry.npmjs.org/ --fetch-retries=0 --fetch-timeout=20000 2>&1 | ForEach-Object { "$_" })
Add-Check 'npm-registry' ($LASTEXITCODE -eq 0) $pingOutput

$extensions = @(& code.cmd --list-extensions --show-versions 2>&1 | ForEach-Object { "$_" })
$extensionExitCode = $LASTEXITCODE
foreach ($extension in @('dbaeumer.vscode-eslint', 'esbenp.prettier-vscode')) {
    $match = @($extensions | Where-Object { $_ -like "$extension@*" })
    Add-Check $extension ($extensionExitCode -eq 0 -and $match.Count -eq 1) $match
}

$probeRoot = Join-Path $EnvironmentRoot ('temp\environment-check-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffffffZ'))
[void][IO.Directory]::CreateDirectory($probeRoot)
$manifest = '{"name":"jsoneditor-environment-probe","version":"0.0.0","private":true,"packageManager":"pnpm@12.15.0"}'
[IO.File]::WriteAllText((Join-Path $probeRoot 'package.json'), $manifest, [Text.UTF8Encoding]::new($false))
$installOutput = @(& pnpm.cmd --dir $probeRoot add is-number@7.0.0 --save-exact --ignore-scripts --registry=https://registry.npmjs.org/ --reporter=append-only 2>&1 | ForEach-Object { "$_" })
$installExitCode = $LASTEXITCODE
Add-Check 'ordinary-dependency-install' ($installExitCode -eq 0) ([ordered]@{ directory = $probeRoot; exitCode = $installExitCode; output = $installOutput })
if ($installExitCode -eq 0) {
    Push-Location $probeRoot
    try {
        $dependencyOutput = @(& node --eval 'const isNumber = require("is-number"); if (!isNumber(42) || isNumber("not a number")) process.exit(1); console.log("DEPENDENCY_EXECUTION_OK");' 2>&1 | ForEach-Object { "$_" })
        Add-Check 'ordinary-dependency-execution' ($LASTEXITCODE -eq 0) $dependencyOutput
    } finally { Pop-Location }
    $offlineDirectory = Join-Path $probeRoot 'offline-reproduction'
    [void][IO.Directory]::CreateDirectory($offlineDirectory)
    Copy-Item -LiteralPath (Join-Path $probeRoot 'package.json'), (Join-Path $probeRoot 'pnpm-lock.yaml') -Destination $offlineDirectory
    $offlineOutput = @(& pnpm.cmd --dir $offlineDirectory install --offline --frozen-lockfile --ignore-scripts --reporter=append-only 2>&1 | ForEach-Object { "$_" })
    Add-Check 'lockfile-offline-reproduction' ($LASTEXITCODE -eq 0) $offlineOutput
}

$report = [ordered]@{
    capturedAtUtc = [DateTime]::UtcNow.ToString('o')
    timezone = 'Asia/Shanghai'
    repository = $repositoryRoot
    environmentRoot = $EnvironmentRoot
    pathSource = 'Persisted machine PATH + persisted user PATH; agent injected PATH excluded'
    checks = @($checks.ToArray())
    passed = (@($checks | Where-Object { -not $_.passed }).Count -eq 0)
    notPerformed = @('Electron project initialization', 'Electron binary download and GUI launch', 'Windows installer build', 'Linux build and GUI validation')
}
$reportDate = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow, 'China Standard Time').ToString('yyyy-MM-dd')
$reportPath = Join-Path $repositoryRoot "docs\environment-check-$reportDate.json"
[void][IO.Directory]::CreateDirectory((Split-Path $reportPath -Parent))
[IO.File]::WriteAllText($reportPath, ($report | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
Write-Output "Report: $reportPath"
if (-not $report.passed) { exit 1 }
