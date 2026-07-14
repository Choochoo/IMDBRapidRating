$ErrorActionPreference = "Stop"

$InstallDir = "C:\inetpub\wwwroot\IMDBRapidRating"
$LegacyDir = "C:\Users\Jared\Documents\GitHub\IMDBRapidRating"
$TaskName = "IMDB Rapid Rating Server"
$Port = 5012

Write-Host "Configuring IMDb Rapid Rating deployment..." -ForegroundColor Cyan

New-Item -Path (Join-Path $InstallDir "data") -ItemType Directory -Force | Out-Null
New-Item -Path (Join-Path $InstallDir "cache") -ItemType Directory -Force | Out-Null

$preservedFiles = @(
    ".env.local",
    "data\imdb-ratings.csv",
    "cache\title-metadata.json"
)

foreach ($relativePath in $preservedFiles) {
    $source = Join-Path $LegacyDir $relativePath
    $destination = Join-Path $InstallDir $relativePath
    if ((Test-Path -LiteralPath $source) -and -not (Test-Path -LiteralPath $destination)) {
        New-Item -Path (Split-Path $destination -Parent) -ItemType Directory -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination -Force
        Write-Host "Migrated preserved file: $relativePath"
    }
}

$nodeCandidates = @(
    "C:\Program Files\nodejs\node.exe",
    "C:\Program Files (x86)\nodejs\node.exe"
)
$nodePath = $nodeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $nodePath) {
    $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
}

$action = New-ScheduledTaskAction `
    -Execute $nodePath `
    -Argument "scripts/server.mjs" `
    -WorkingDirectory $InstallDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -RestartCount 5 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName

$healthUrl = "http://127.0.0.1:$Port/api/imdb/status"
$healthy = $false
for ($attempt = 1; $attempt -le 20; $attempt++) {
    Start-Sleep -Seconds 1
    try {
        $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -eq 200) {
            $healthy = $true
            break
        }
    } catch {
        Write-Host "Health check attempt $attempt is still waiting..."
    }
}

if (-not $healthy) {
    throw "IMDb Rapid Rating failed its health check at $healthUrl"
}

Write-Host "IMDb Rapid Rating is healthy at $healthUrl" -ForegroundColor Green
