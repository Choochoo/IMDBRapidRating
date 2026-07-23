$ErrorActionPreference = "Stop"

$InstallDir = "C:\inetpub\wwwroot\IMDBRapidRating"
$TaskName = "IMDB Rapid Rating Server"
$Port = 5012
$RuntimeDir = Join-Path $InstallDir ".runtime"
$LauncherPath = Join-Path $RuntimeDir "StartServer.ps1"
$ServerLogPath = Join-Path $RuntimeDir "server.log"

function Get-RapidRaterParameter {
    param([string]$Name)

    if ($null -ne $OctopusParameters -and $OctopusParameters.ContainsKey($Name)) {
        return [string]$OctopusParameters[$Name]
    }
    return ""
}

Write-Host "Configuring IMDb Rapid Rating deployment..." -ForegroundColor Cyan

New-Item -Path (Join-Path $InstallDir "data") -ItemType Directory -Force | Out-Null
New-Item -Path (Join-Path $InstallDir "cache") -ItemType Directory -Force | Out-Null
New-Item -Path $RuntimeDir -ItemType Directory -Force | Out-Null

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

$escapedInstallDir = $InstallDir.Replace("'", "''")
$escapedNodePath = $nodePath.Replace("'", "''")
$escapedServerLogPath = $ServerLogPath.Replace("'", "''")
$launcherScript = @"
Set-Location -LiteralPath '$escapedInstallDir'
& '$escapedNodePath' 'scripts/server.mjs' *>> '$escapedServerLogPath'
exit `$LASTEXITCODE
"@
$launcherScript | Set-Content -LiteralPath $LauncherPath -Encoding UTF8

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
    "IMDB_MAX_REQUESTS_PER_SECOND=10",
    "IMDB_WORKER_CONCURRENCY=4",
    "PUBLIC_REGISTRATION_ENABLED=true"
)
$settingsLines = $defaultSettingsLines
$usePreservedSettings = $false
foreach ($entry in $requiredVariables.GetEnumerator()) {
    $value = Get-RapidRaterParameter -Name $entry.Value
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
$allowedOrigins = Get-RapidRaterParameter -Name "RapidRater.AllowedOrigins"
if (-not [string]::IsNullOrWhiteSpace($allowedOrigins)) {
    $settingsLines = @($settingsLines | Where-Object { $_ -notmatch '^APP_ALLOWED_ORIGINS=' })
    $settingsLines += "APP_ALLOWED_ORIGINS=$allowedOrigins"
}
$settingsLines | Set-Content -LiteralPath $runtimeSettingsPath -Encoding UTF8
icacls $runtimeSettingsPath /inheritance:r /grant:r "SYSTEM:F" "Administrators:F" /Q | Out-Null

Write-Host "Installing production dependencies..."
& $npmPath ci --omit=dev --no-audit --no-fund --prefix $InstallDir
if ($LASTEXITCODE -ne 0) {
    throw "npm ci failed."
}

Write-Host "Applying PostgreSQL migrations..."
Push-Location $InstallDir
try {
    & $nodePath "scripts/migrate.mjs"
    if ($LASTEXITCODE -ne 0) {
        throw "Database migration failed."
    }
} finally {
    Pop-Location
}

$powerShellPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$action = New-ScheduledTaskAction `
    -Execute $powerShellPath `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$LauncherPath`"" `
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
        if ($state -ne "Running") {
            break
        }
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

Set-Content -LiteralPath $ServerLogPath -Value "" -Encoding UTF8
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
        $taskState = (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue).State
        Write-Host "Health check attempt $attempt is still waiting (task state: $taskState)..."
        if ($taskState -ne "Running") {
            break
        }
    }
}

if (-not $healthy) {
    $taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
    Write-Host "Scheduled task last result: $($taskInfo.LastTaskResult)"
    if (Test-Path -LiteralPath $ServerLogPath) {
        Write-Host "IMDb Rapid Rating server log:"
        Get-Content -LiteralPath $ServerLogPath -Tail 100 | ForEach-Object { Write-Host $_ }
    }
    throw "IMDb Rapid Rating failed its health check at $healthUrl"
}

Write-Host "IMDb Rapid Rating is healthy at $healthUrl" -ForegroundColor Green

Write-Host "Checking optional IIS reverse-proxy configuration..."
$proxySiteName = Get-RapidRaterParameter -Name "RapidRater.ProxySiteName"
$proxyHostName = Get-RapidRaterParameter -Name "RapidRater.ProxyHostName"
$proxyDir = Get-RapidRaterParameter -Name "RapidRater.ProxyDirectory"
if ([string]::IsNullOrWhiteSpace($proxySiteName) -or
    [string]::IsNullOrWhiteSpace($proxyHostName) -or
    [string]::IsNullOrWhiteSpace($proxyDir)) {
    Write-Host "Optional IIS proxy skipped. Configure RapidRater.ProxySiteName, RapidRater.ProxyHostName, and RapidRater.ProxyDirectory to enable it."
    return
}

$proxyUpstreamHost = Get-RapidRaterParameter -Name "RapidRater.ProxyUpstreamHost"
if ([string]::IsNullOrWhiteSpace($proxyUpstreamHost)) {
    $proxyUpstreamHost = "127.0.0.1"
}
$proxyHealthAddress = Get-RapidRaterParameter -Name "RapidRater.ProxyHealthAddress"
if ([string]::IsNullOrWhiteSpace($proxyHealthAddress)) {
    $proxyHealthAddress = "127.0.0.1"
}
$proxyUpstreamUrl = "http://${proxyUpstreamHost}:$Port"
$appCmd = "C:\Windows\System32\inetsrv\appcmd.exe"
$siteState = "Unavailable"
try {
    if (-not (Test-Path -LiteralPath $appCmd)) {
        throw "IIS appcmd.exe is unavailable."
    }
    New-Item -Path $proxyDir -ItemType Directory -Force | Out-Null

    & $appCmd set config /section:system.webServer/proxy /enabled:true /preserveHostHeader:true /reverseRewriteHostInResponseHeaders:false /commit:apphost | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "IIS reverse-proxy support could not be enabled."
    }

    $proxyConfig = @"
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="Proxy IMDb Rapid Rating" stopProcessing="true">
          <match url="(.*)" />
          <action type="Rewrite" url="$proxyUpstreamUrl/{R:1}" appendQueryString="true" />
        </rule>
      </rules>
    </rewrite>
  </system.webServer>
</configuration>
"@
    $proxyConfigPath = Join-Path $proxyDir "web.proxy.config"
    $proxyConfig | Set-Content -LiteralPath $proxyConfigPath -Encoding UTF8
    Copy-Item -LiteralPath $proxyConfigPath -Destination (Join-Path $proxyDir "web.config") -Force
    $siteState = (& $appCmd list site $proxySiteName /text:state 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        $siteState = "Unavailable"
    }
} catch {
    $siteState = "Unavailable"
    Write-Warning "The optional IIS proxy configuration could not be refreshed: $($_.Exception.Message)"
}
Write-Host "IIS proxy site state: $siteState"
Write-Host "Application deployment is complete; checking the optional public proxy..." -ForegroundColor Cyan

$proxyHealthUrl = "http://$proxyHealthAddress/health"
$proxyHealthy = $false
if ($siteState -eq "Started") {
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        Start-Sleep -Seconds 1
        try {
            $response = Invoke-WebRequest -Uri $proxyHealthUrl -Headers @{ Host = $proxyHostName } -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -eq 200) {
                $proxyHealthy = $true
                break
            }
        } catch {
            $healthError = $_.Exception.Message
            if ($null -ne $_.Exception.Response) {
                $healthError = "HTTP $([int]$_.Exception.Response.StatusCode): $healthError"
            }
            Write-Host "IIS proxy health check attempt $attempt failed: $healthError"
        }
    }
}
if (-not $proxyHealthy) {
    Write-Warning "The optional IIS proxy is not healthy (site state: $siteState). IMDb Rapid Rater remains healthy at $healthUrl, so deployment will continue."
} else {
    Write-Host "IMDb Rapid Rater IIS proxy is healthy at $proxyHealthUrl" -ForegroundColor Green
}
