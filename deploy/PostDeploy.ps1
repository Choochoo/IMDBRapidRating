$ErrorActionPreference = "Stop"

$InstallDir = "C:\inetpub\wwwroot\IMDBRapidRating"
$LegacyDir = "C:\Users\Jared\Documents\GitHub\IMDBRapidRating"
$TaskName = "IMDB Rapid Rating Server"
$Port = 5012

Write-Host "Configuring IMDb Rapid Rating deployment..." -ForegroundColor Cyan

New-Item -Path (Join-Path $InstallDir "data") -ItemType Directory -Force | Out-Null
New-Item -Path (Join-Path $InstallDir "cache") -ItemType Directory -Force | Out-Null
New-Item -Path (Join-Path $InstallDir ".runtime") -ItemType Directory -Force | Out-Null

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

$npmPath = Join-Path (Split-Path $nodePath -Parent) "npm.cmd"
if (-not (Test-Path -LiteralPath $npmPath)) {
    $npmPath = (Get-Command npm.cmd -ErrorAction Stop).Source
}

$runtimeSettingsPath = Join-Path $InstallDir ".runtime\settings.env"
$requiredVariables = @{
    "POSTGRES_CONNECTION_STRING" = "RapidRater.PostgresConnectionString"
    "SESSION_SECRET"             = "RapidRater.SessionSecret"
    "DATA_ENCRYPTION_KEY"        = "RapidRater.DataEncryptionKey"
    "APP_ORIGIN"                 = "RapidRater.AppOrigin"
}
$settingsLines = @("RAPID_RATER_DB_SCHEMA=imdb_rapid_rater", "TRUST_PROXY_HOPS=1", "IMDB_DRY_RUN=false", "PUBLIC_REGISTRATION_ENABLED=true")
foreach ($entry in $requiredVariables.GetEnumerator()) {
    $value = $null
    if ($null -ne $OctopusParameters -and $OctopusParameters.ContainsKey($entry.Value)) {
        $value = [string]$OctopusParameters[$entry.Value]
    }
    if ([string]::IsNullOrWhiteSpace($value)) {
        if (-not (Test-Path -LiteralPath $runtimeSettingsPath)) {
            throw "Required sensitive Octopus variable '$($entry.Value)' is not configured."
        }
        $settingsLines = $null
        break
    }
    $settingsLines += "$($entry.Key)=$value"
}
if ($null -ne $settingsLines) {
    $settingsLines | Set-Content -LiteralPath $runtimeSettingsPath -Encoding UTF8
}
icacls $runtimeSettingsPath /inheritance:r /grant:r "SYSTEM:F" "Administrators:F" /Q | Out-Null

Write-Host "Installing production dependencies..."
& $npmPath ci --omit=dev --no-audit --no-fund --prefix $InstallDir
if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }

Write-Host "Applying PostgreSQL migrations..."
Push-Location $InstallDir
try {
    & $nodePath "scripts/migrate.mjs"
    if ($LASTEXITCODE -ne 0) { throw "Database migration failed." }
} finally {
    Pop-Location
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

$healthUrl = "http://127.0.0.1:$Port/health"
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
