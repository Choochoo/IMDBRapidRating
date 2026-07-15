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
$defaultSettingsLines = @(
    "RAPID_RATER_DB_SCHEMA=imdb_rapid_rater",
    "TRUST_PROXY_HOPS=1",
    "IMDB_DRY_RUN=false",
    "PUBLIC_REGISTRATION_ENABLED=true"
)
$settingsLines = $defaultSettingsLines
$usePreservedSettings = $false
foreach ($entry in $requiredVariables.GetEnumerator()) {
    $value = $null
    if ($null -ne $OctopusParameters -and $OctopusParameters.ContainsKey($entry.Value)) {
        $value = [string]$OctopusParameters[$entry.Value]
    }
    if ([string]::IsNullOrWhiteSpace($value)) {
        if (-not (Test-Path -LiteralPath $runtimeSettingsPath)) {
            throw "Required sensitive Octopus variable '$($entry.Value)' is not configured."
        }
        $usePreservedSettings = $true
        break
    }
    $settingsLines += "$($entry.Key)=$value"
}
if ($usePreservedSettings) {
    $settingsLines = Get-Content -LiteralPath $runtimeSettingsPath
}
$settingsLines = @($settingsLines | Where-Object { $_ -notmatch '^APP_ALLOWED_ORIGINS=' })
$settingsLines += "APP_ALLOWED_ORIGINS=http://ourfilmclub.duckdns.org:5012"
$settingsLines | Set-Content -LiteralPath $runtimeSettingsPath -Encoding UTF8
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

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -ne $existingTask) {
    Write-Host "Stopping the existing IMDb Rapid Rating process..."
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    for ($attempt = 1; $attempt -le 20; $attempt++) {
        $state = (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue).State
        if ($state -ne "Running") { break }
        Start-Sleep -Milliseconds 500
    }
    if ((Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue).State -eq "Running") {
        throw "The existing IMDb Rapid Rating scheduled task did not stop."
    }
}

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

Write-Host "Configuring the Our Film Club IIS reverse proxy..."
$proxySiteName = "Our Film Club"
$proxyHostName = "ourfilmclub.duckdns.org"
$proxyDir = "C:\inetpub\wwwroot\OurFilmClubProxy"
$appCmd = "C:\Windows\System32\inetsrv\appcmd.exe"
if (-not (Test-Path -LiteralPath $appCmd)) {
    throw "IIS appcmd.exe is unavailable."
}
New-Item -Path $proxyDir -ItemType Directory -Force | Out-Null
$proxyConfig = @'
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="Proxy IMDb Rapid Rating" stopProcessing="true">
          <match url="(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:5012/{R:1}" appendQueryString="true" />
        </rule>
      </rules>
    </rewrite>
  </system.webServer>
</configuration>
'@
$proxyConfig | Set-Content -LiteralPath (Join-Path $proxyDir "web.config") -Encoding UTF8

& $appCmd set config /section:system.webServer/proxy /enabled:true /preserveHostHeader:true /reverseRewriteHostInResponseHeaders:false /commit:apphost | Out-Null
if ($LASTEXITCODE -ne 0) { throw "IIS reverse-proxy support could not be enabled." }

& $appCmd list site "/name:$proxySiteName" | Out-Null
if ($LASTEXITCODE -eq 0) {
    & $appCmd set site $proxySiteName "/bindings:http/*:80:$proxyHostName" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "The Our Film Club IIS binding could not be updated." }
    & $appCmd set vdir "$proxySiteName/" "/physicalPath:$proxyDir" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "The Our Film Club IIS path could not be updated." }
} else {
    & $appCmd add site "/name:$proxySiteName" "/bindings:http/*:80:$proxyHostName" "/physicalPath:$proxyDir" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "The Our Film Club IIS site could not be created." }
}
& $appCmd start site "/site.name:$proxySiteName" 2>$null | Out-Null

$proxyHealthUrl = "http://$proxyHostName/health"
$proxyHealthy = $false
for ($attempt = 1; $attempt -le 10; $attempt++) {
    Start-Sleep -Seconds 1
    try {
        $response = Invoke-WebRequest -Uri $proxyHealthUrl -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -eq 200) {
            $proxyHealthy = $true
            break
        }
    } catch {
        Write-Host "IIS proxy health check attempt $attempt is still waiting..."
    }
}
if (-not $proxyHealthy) {
    throw "The Our Film Club IIS proxy failed its health check at $proxyHealthUrl"
}
Write-Host "Our Film Club is healthy at $proxyHealthUrl" -ForegroundColor Green
