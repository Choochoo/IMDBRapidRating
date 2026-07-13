$ErrorActionPreference = "Stop"

$TaskName = "IMDB Rapid Rating Server"
$Port = 5199

Write-Host "Stopping IMDb Rapid Rating before deployment..." -ForegroundColor Cyan

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

$listeners = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
foreach ($listener in $listeners) {
    if ($listener.OwningProcess -gt 0) {
        Write-Host "Stopping process $($listener.OwningProcess) on port $Port"
        Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "IMDb Rapid Rating stopped." -ForegroundColor Green
