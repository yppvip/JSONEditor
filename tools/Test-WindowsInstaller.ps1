[CmdletBinding()]
param(
    [string]$Installer,
    [string]$PreviousInstaller,
    [switch]$RunE2E,
    [switch]$DeferUninstall
)

$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Windows is required.' }
if (-not $DeferUninstall) {
    # End the verification host before uninstalling: Windows may keep PE resource
    # mappings until the host exits even after the native application has exited.
    $started = [DateTime]::UtcNow
    $workerArgs = @('-NoProfile', '-File', $PSCommandPath, '-DeferUninstall')
    if ($Installer) { $workerArgs += @('-Installer', $Installer) }
    if ($PreviousInstaller) { $workerArgs += @('-PreviousInstaller', $PreviousInstaller) }
    if ($RunE2E) { $workerArgs += '-RunE2E' }
    & (Join-Path $PSHOME 'pwsh.exe') @workerArgs
    $verificationExit = $LASTEXITCODE
    $reportFile = Join-Path $PSScriptRoot '../docs/phase7-installer.json'
    if ((Test-Path -LiteralPath $reportFile) -and [DateTime](Get-Content $reportFile -Raw | ConvertFrom-Json).capturedAtUtc -ge $started) {
        & (Join-Path $PSScriptRoot 'Complete-WindowsInstaller.ps1')
    }
    if ($verificationExit -ne 0) { throw 'Installer verification failed; see phase7-installer.json.' }
    return
}
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$version = (Get-Content (Join-Path $workspace 'package.json') -Raw | ConvertFrom-Json).version
if (-not $Installer) { $Installer = Join-Path $workspace "release/JSONEditor-$version-x64-setup.exe" }
$Installer = (Resolve-Path -LiteralPath $Installer).Path
if ($PreviousInstaller) { $PreviousInstaller = (Resolve-Path -LiteralPath $PreviousInstaller).Path }
$testRoot = [IO.Path]::GetFullPath((Join-Path $workspace 'release/installer-validation'))
$directory = [IO.Path]::GetFullPath((Join-Path $testRoot ('phase7-install-' + [guid]::NewGuid().ToString('N'))))
if (-not $directory.StartsWith($testRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Installation directory must remain inside workspace release/installer-validation.'
}
$installDirectory = Join-Path $directory 'application'
$smokeDirectory = Join-Path $directory 'smoke'
$markerPath = Join-Path $smokeDirectory 'profile/upgrade-marker.txt'
$executable = Join-Path $installDirectory 'JSONEditor.exe'
# electron-builder UUID v5(appId, ELECTRON_BUILDER_NS_UUID), also checked by the installed registry entry.
$guid = '0465693a-4e6b-5aec-903d-73e3d382cfa5'
$uninstallKey = "Software\Microsoft\Windows\CurrentVersion\Uninstall\$guid"
$installKey = "Software\$guid"
$registryKeys = foreach ($hive in @('HKCU:', 'HKLM:')) {
    foreach ($key in @($uninstallKey, $installKey, "Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\$guid", "Software\WOW6432Node\$guid")) {
        "$hive\$key"
    }
}
foreach ($key in $registryKeys) {
    if (Test-Path -LiteralPath $key) { throw "Existing installation registry key detected; refusing to modify it: $key" }
}
$startMenuLink = Join-Path ([Environment]::GetFolderPath('Programs')) 'JSONEditor.lnk'
$shortcutPaths = @(
    $startMenuLink,
    (Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'JSONEditor.lnk'),
    (Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'JSONEditor.lnk'),
    (Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'JSONEditor.lnk')
)
foreach ($path in $shortcutPaths) {
    if (Test-Path -LiteralPath $path) { throw "Existing shortcut detected; refusing to modify it: $path" }
}

New-Item -ItemType Directory -Path $directory -Force | Out-Null
$report = [ordered]@{
    capturedAtUtc = [DateTime]::UtcNow.ToString('o')
    version = $version
    passed = $false
    verificationPassed = $false
    installationDirectory = $installDirectory
    checks = [Collections.Generic.List[string]]::new()
    limitations = @('Silent current-user NSIS flow; interactive wizard, UAC and signed reputation are not tested', 'File dialog return is a fixture; disk save, IPC and installed executable are real')
}
$oldExecutable = $env:JSONEDITOR_EXECUTABLE
$oldVersion = $env:JSONEDITOR_EXPECTED_VERSION
$oldSmoke = $env:JSONEDITOR_SMOKE_DIRECTORY
$installedByThisRun = $false
$profileMarkerCreated = $false
function Invoke-Installer([string]$Path) {
    # /D must be last: NSIS consumes the remaining command line as the destination path.
    $process = Start-Process -FilePath $Path -ArgumentList @('/S', '/currentuser', '--no-desktop-shortcut', "/D=$installDirectory") -WindowStyle Hidden -PassThru
    if (-not $process.WaitForExit(120000)) { $process.Kill(); throw 'Installer timed out.' }
    if ($process.ExitCode -ne 0) { throw "Installer exited with $($process.ExitCode)" }
    if (-not (Test-Path -LiteralPath $executable)) { throw 'Installed executable is missing.' }
}
function Assert-Registration([string]$ExpectedVersion) {
    $entry = Get-ItemProperty -LiteralPath "HKCU:\$uninstallKey"
    $location = (Get-ItemProperty -LiteralPath "HKCU:\$installKey").InstallLocation
    if ([IO.Path]::GetFullPath($location) -ne $installDirectory) { throw 'Unexpected registered installation location.' }
    if ($entry.DisplayVersion -ne $ExpectedVersion) { throw 'Unexpected registered version.' }
    if (-not (Test-Path -LiteralPath $startMenuLink)) { throw 'Start menu shortcut is missing.' }
    # Shell COM can cache an executable's icon/resource mapping beyond RCW release.
    # Validate the link in a disposable process so the test cannot pin the installed PE.
    $shortcutJob = Start-Job -ArgumentList $startMenuLink, $executable -ScriptBlock {
        param($LinkPath, $ExpectedTarget)
        $ErrorActionPreference = 'Stop'
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $null
        try {
            $shortcut = $shell.CreateShortcut($LinkPath)
            if ($shortcut.TargetPath -ne $ExpectedTarget) { throw 'Shortcut target mismatch.' }
        } finally {
            if ($shortcut) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shortcut) }
            [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
        }
    }
    try {
        $shortcutJob | Wait-Job | Receive-Job -ErrorAction Stop
        if ($shortcutJob.State -ne 'Completed') { throw 'Shortcut validation failed.' }
    } finally {
        Remove-Job $shortcutJob -Force
    }
}
function Invoke-InstalledSmoke([string]$ExpectedVersion) {
    $env:JSONEDITOR_EXECUTABLE = $executable
    $env:JSONEDITOR_EXPECTED_VERSION = $ExpectedVersion
    $env:JSONEDITOR_SMOKE_DIRECTORY = $smokeDirectory
    & node (Join-Path $workspace 'tools/smoke-installed.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Installed application smoke failed.' }
}
function Wait-ExecutableRelease {
    # Native child exit and PE-file release can differ (debugger/scanner handles).
    # Never terminate another process or treat leftover files as successful uninstall.
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    while (Test-Path -LiteralPath $executable) {
        try {
            $stream = [IO.File]::Open($executable, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
            $stream.Dispose()
            return
        } catch [IO.IOException] {
            if ([DateTime]::UtcNow -ge $deadline) { throw 'Installed executable is still held by a process; uninstall not started.' }
            Start-Sleep -Milliseconds 250
        }
    }
}

Push-Location $workspace
try {
    if ($PreviousInstaller) {
        $previousVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($PreviousInstaller).ProductVersion
        if (-not $previousVersion) { throw 'Previous installer version is unavailable.' }
        $installedByThisRun = $true
        Invoke-Installer $PreviousInstaller
        Assert-Registration $previousVersion
        Invoke-InstalledSmoke $previousVersion
        [IO.File]::WriteAllText($markerPath, 'preserve-profile')
        $profileMarkerCreated = $true
        $report.checks.Add("previous-$previousVersion-install-launch-save")
    }
    $installedByThisRun = $true
    Invoke-Installer $Installer
    Assert-Registration $version
    Invoke-InstalledSmoke $version
    $report.checks.Add('current-install-registry-shortcut-offline-launch-save')
    if ($PreviousInstaller) {
        if ([IO.File]::ReadAllText($markerPath) -ne 'preserve-profile') { throw 'Upgrade changed profile marker.' }
        $report.checks.Add('upgrade-keeps-profile')
    }
    if ($RunE2E) {
        & node (Join-Path $workspace 'node_modules/@playwright/test/cli.js') test
        if ($LASTEXITCODE -ne 0) { throw 'Installed executable E2E failed.' }
        Copy-Item -LiteralPath (Join-Path $workspace 'test-results/e2e.json') -Destination (Join-Path $workspace 'docs/phase7-installed-e2e.json')
        $report.checks.Add('installed-executable-full-e2e')
    }
    $report.verificationPassed = $true
} catch {
    $report.error = $_.Exception.Message
    throw
} finally {
    try {
        if ($installedByThisRun -and -not $report.verificationPassed) {
            $registered = Get-ItemProperty -LiteralPath "HKCU:\$installKey" -ErrorAction SilentlyContinue
            if ($registered -and [IO.Path]::GetFullPath($registered.InstallLocation) -ne $installDirectory) {
                throw 'Refusing cleanup of a different installation.'
            }
            $uninstaller = Join-Path $installDirectory 'Uninstall JSONEditor.exe'
            if (Test-Path -LiteralPath $uninstaller) {
                [GC]::Collect()
                [GC]::WaitForPendingFinalizers()
                Wait-ExecutableRelease
                $report.checks.Add('installed-executable-released-before-uninstall')
                $process = Start-Process -FilePath $uninstaller -ArgumentList @('/S', '/currentuser') -WindowStyle Hidden -PassThru
                if (-not $process.WaitForExit(120000)) { $process.Kill(); throw 'Uninstaller timed out.' }
                if ($process.ExitCode -ne 0) { throw 'Uninstaller failed.' }
                $deadline = [DateTime]::UtcNow.AddSeconds(30)
                while ((Test-Path -LiteralPath $executable) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 250 }
            }
            if ((Test-Path -LiteralPath $executable) -or (Test-Path -LiteralPath $startMenuLink)) { throw 'Uninstaller left executable or shortcut.' }
            foreach ($key in $registryKeys) {
                if (Test-Path -LiteralPath $key) { throw "Uninstaller left registry key: $key" }
            }
            if ($profileMarkerCreated) {
                if (-not (Test-Path -LiteralPath $markerPath) -or [IO.File]::ReadAllText($markerPath) -ne 'preserve-profile') { throw 'Uninstall removed or changed profile marker.' }
                $report.checks.Add('uninstall-retains-profile')
            }
            $report.checks.Add('uninstall-removes-executable-registry-shortcuts')
        }
    } catch {
        $report.passed = $false
        $report.cleanupError = $_.Exception.Message
        throw
    } finally {
        $env:JSONEDITOR_EXECUTABLE = $oldExecutable
        $env:JSONEDITOR_EXPECTED_VERSION = $oldVersion
        $env:JSONEDITOR_SMOKE_DIRECTORY = $oldSmoke
        [IO.File]::WriteAllText((Join-Path $workspace 'docs/phase7-installer.json'), ($report | ConvertTo-Json -Depth 10) + "`n", [Text.UTF8Encoding]::new($false))
        Pop-Location
    }
}
Write-Output 'Windows installation verification: PASS; verification host will exit before uninstall.'
