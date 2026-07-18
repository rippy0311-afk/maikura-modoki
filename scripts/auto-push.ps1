param(
  [int]$DebounceSeconds = 8,
  [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$logPath = Join-Path $repo ".auto-push.log"
$pending = $false
$lastChange = Get-Date
$isSyncing = $false

function Write-Log($message) {
  $time = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -LiteralPath $logPath -Value "[$time] $message"
}

function Invoke-Git($arguments) {
  $output = & git -C $repo @arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw ($output -join "`n")
  }
  return $output
}

function Sync-Changes {
  if ($isSyncing) { return }
  $script:isSyncing = $true
  try {
    $status = (& git -C $repo status --porcelain)
    if (-not $status) { return }

    Write-Log "Changes detected. Auto committing..."
    Invoke-Git @("add", "-A") | Out-Null

    $afterAdd = (& git -C $repo status --porcelain)
    if (-not $afterAdd) { return }

    $message = "Auto update $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    Invoke-Git @("commit", "-m", $message) | Out-Null
    Write-Log "Committed: $message"

    Invoke-Git @("pull", "--rebase", "origin", $Branch) | Out-Null
    Invoke-Git @("push", "origin", $Branch) | Out-Null
    Write-Log "Pushed to origin/$Branch"
  } catch {
    Write-Log "Auto push stopped by error: $($_.Exception.Message)"
    Write-Log "Please resolve it manually, then restart scripts/start-auto-push.bat"
    throw
  } finally {
    $script:isSyncing = $false
  }
}

Set-Location -LiteralPath $repo
Write-Log "Auto push watcher started for $repo"

$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $repo
$watcher.IncludeSubdirectories = $true
$watcher.EnableRaisingEvents = $true

$action = {
  $path = $Event.SourceEventArgs.FullPath
  if ($path -match "\\\.git\\" -or $path -match "\\\.claude\\" -or $path -like "*.auto-push.log") { return }
  $script:pending = $true
  $script:lastChange = Get-Date
}

Register-ObjectEvent $watcher Changed -Action $action | Out-Null
Register-ObjectEvent $watcher Created -Action $action | Out-Null
Register-ObjectEvent $watcher Deleted -Action $action | Out-Null
Register-ObjectEvent $watcher Renamed -Action $action | Out-Null

while ($true) {
  Start-Sleep -Seconds 1
  if ($pending -and ((Get-Date) - $lastChange).TotalSeconds -ge $DebounceSeconds) {
    $pending = $false
    Sync-Changes
  }
}
