[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$reportPath = Join-Path $workspace 'docs/phase7-installer.json'
$report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
$root = [IO.Path]::GetFullPath((Join-Path $workspace 'release/installer-validation')) + [IO.Path]::DirectorySeparatorChar
$directory = [IO.Path]::GetFullPath($report.installationDirectory)
if (-not $directory.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected cleanup directory.' }
if ([IO.Path]::GetFileName($directory) -ne 'application') { throw 'Unexpected installation leaf directory.' }
$guid = '0465693a-4e6b-5aec-903d-73e3d382cfa5'
$installKey = "HKCU:\Software\$guid"
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$guid"
$registration = Get-ItemProperty -LiteralPath $installKey -ErrorAction SilentlyContinue
if ($registration -and [IO.Path]::GetFullPath($registration.InstallLocation) -ne $directory) { throw 'Refusing to uninstall a different registered application.' }
$uninstaller = Join-Path $directory 'Uninstall JSONEditor.exe'
$executable = Join-Path $directory 'JSONEditor.exe'
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'JSONEditor.lnk'
try {
    if (Test-Path -LiteralPath $uninstaller) {
        $process = Start-Process -FilePath $uninstaller -ArgumentList @('/S', '/currentuser') -WindowStyle Hidden -PassThru
        if (-not $process.WaitForExit(120000)) { $process.Kill(); throw 'Uninstaller timed out.' }
        if ($process.ExitCode -ne 0) { throw 'Uninstaller failed.' }
        $process.Dispose()
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    while (((Test-Path -LiteralPath $executable) -or (Test-Path -LiteralPath $shortcut) -or (Test-Path -LiteralPath $installKey) -or (Test-Path -LiteralPath $uninstallKey)) -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 250
    }
    if ((Test-Path -LiteralPath $executable) -or (Test-Path -LiteralPath $shortcut) -or (Test-Path -LiteralPath $installKey) -or (Test-Path -LiteralPath $uninstallKey)) { throw 'Uninstaller left executable, shortcut or registration.' }
    $marker = Join-Path (Split-Path -Parent $directory) 'smoke/profile/upgrade-marker.txt'
    if ($report.checks -contains 'upgrade-keeps-profile') {
        if (-not (Test-Path -LiteralPath $marker) -or [IO.File]::ReadAllText($marker) -ne 'preserve-profile') { throw 'Profile marker was not retained.' }
        $report.checks += 'uninstall-retains-profile'
    }
    $report.checks += 'uninstall-after-verification-host-exit-removes-executable-registry-shortcut'
    $report.passed = $report.verificationPassed -eq $true
    if (-not $report.passed) { throw 'Cleanup passed, but preceding application verification failed.' }
    Write-Output 'Windows install/upgrade/uninstall: PASS; no installed executable, registry or shortcut remains.'
} catch {
    $report.passed = $false
    $report | Add-Member -NotePropertyName cleanupError -NotePropertyValue $_.Exception.Message -Force
    throw
} finally {
    $report | Add-Member -NotePropertyName completedAtUtc -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
    [IO.File]::WriteAllText($reportPath, ($report | ConvertTo-Json -Depth 10) + "`n", [Text.UTF8Encoding]::new($false))
}
