$ErrorActionPreference = "Stop"

$InstallDir = "C:\inetpub\wwwroot\IMDBRapidRating"
$TaskName = "IMDB Rapid Rating Server"
$Port = 5012
$RuntimeDir = Join-Path $InstallDir ".runtime"
$ConfigDir = Join-Path $InstallDir ".config"
$LauncherPath = Join-Path $ConfigDir "StartServer.ps1"
$ServerLogPath = Join-Path $RuntimeDir "server.log"
$SettingsFileName = "settings.env"
$RuntimeSettingsPath = Join-Path $ConfigDir $SettingsFileName
$LegacySettingsPath = Join-Path $RuntimeDir $SettingsFileName
$ServiceAccountName = "NT AUTHORITY\LOCAL SERVICE"
$ServiceAccountSid = "S-1-5-19"
$LegacyProtectionMode = "legacy"
$RunningTaskState = "Running"
$UnavailableSiteState = "Unavailable"
$LoopbackAddress = "127.0.0.1"
$AppOriginVariable = "APP_ORIGIN"
$AppOriginParameter = "RapidRater.AppOrigin"
$ReadExecuteAcl = "*$($ServiceAccountSid):(OI)(CI)RX"
$SystemFullControlAcl = "SYSTEM:(OI)(CI)F"
$AdministratorsFullControlAcl = "Administrators:(OI)(CI)F"

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
New-Item -Path $ConfigDir -ItemType Directory -Force | Out-Null

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

$singleQuote = "'"
$escapedSingleQuote = "''"
$escapedInstallDir = $InstallDir.Replace($singleQuote, $escapedSingleQuote)
$escapedNodePath = $nodePath.Replace($singleQuote, $escapedSingleQuote)
$escapedServerLogPath = $ServerLogPath.Replace($singleQuote, $escapedSingleQuote)
$escapedRuntimeDir = $RuntimeDir.Replace($singleQuote, $escapedSingleQuote)
$escapedRuntimeSettingsPath = $RuntimeSettingsPath.Replace($singleQuote, $escapedSingleQuote)
$launcherScript = @"
Set-Location -LiteralPath '$escapedInstallDir'
`$env:IMDB_RAPID_RATER_HOME = '$escapedRuntimeDir'
`$env:RAPID_RATER_SETTINGS_PATH = '$escapedRuntimeSettingsPath'
& '$escapedNodePath' 'scripts/server.mjs' *>> '$escapedServerLogPath'
exit `$LASTEXITCODE
"@
$launcherScript | Set-Content -LiteralPath $LauncherPath -Encoding UTF8

if (-not (Test-Path -LiteralPath $RuntimeSettingsPath) -and (Test-Path -LiteralPath $LegacySettingsPath)) {
    Copy-Item -LiteralPath $LegacySettingsPath -Destination $RuntimeSettingsPath
}
$secretProtectionMode = (Get-RapidRaterParameter -Name "RapidRater.SecretProtectionMode").Trim().ToLowerInvariant()
if ([string]::IsNullOrWhiteSpace($secretProtectionMode)) {
    $secretProtectionMode = $LegacyProtectionMode
}
if ($secretProtectionMode -notin @($LegacyProtectionMode, "dual", "vault")) {
    throw "RapidRater.SecretProtectionMode must be legacy, dual, or vault."
}
$requiredVariables = if ($secretProtectionMode -eq $LegacyProtectionMode) {
    @{
        "POSTGRES_CONNECTION_STRING" = "RapidRater.PostgresConnectionString"
        "SESSION_SECRET"             = "RapidRater.SessionSecret"
        "DATA_ENCRYPTION_KEY"        = "RapidRater.DataEncryptionKey"
        "TMDB_API_KEY"               = "RapidRater.TmdbApiKey"
        $AppOriginVariable           = $AppOriginParameter
    }
} else {
    @{
        "AZURE_KEY_VAULT_URL"    = "RapidRater.AzureKeyVaultUrl"
        "AZURE_KEY_VAULT_KEY_ID" = "RapidRater.AzureKeyVaultKeyId"
        $AppOriginVariable       = $AppOriginParameter
    }
}
$defaultSettingsLines = @(
    "RAPID_RATER_DB_SCHEMA=imdb_rapid_rater",
    "SECRET_PROTECTION_MODE=$secretProtectionMode",
    "TRUST_PROXY_HOPS=1",
    "IMDB_DRY_RUN=false",
    "IMDB_MAX_REQUESTS_PER_SECOND=10",
    "IMDB_WORKER_CONCURRENCY=4",
    "PUBLIC_REGISTRATION_ENABLED=true",
    "POSTHOG_ENABLED=false"
)
$settingsLines = $defaultSettingsLines
$usePreservedSettings = $false
foreach ($entry in $requiredVariables.GetEnumerator()) {
    $value = Get-RapidRaterParameter -Name $entry.Value
    if ([string]::IsNullOrWhiteSpace($value)) {
        if (-not (Test-Path -LiteralPath $RuntimeSettingsPath)) {
            throw "Required sensitive Octopus variable '$($entry.Value)' is not configured."
        }
        $usePreservedSettings = $true
        break
    }
    $settingsLines += "$($entry.Key)=$value"
}
if ($usePreservedSettings) {
    if ($secretProtectionMode -ne $LegacyProtectionMode) {
        throw "Azure vault modes require complete current Octopus configuration and cannot reuse a preserved settings file."
    }
    $settingsLines = Get-Content -LiteralPath $RuntimeSettingsPath
}
$managedIdentityClientId = Get-RapidRaterParameter -Name "RapidRater.AzureManagedIdentityClientId"
if (-not [string]::IsNullOrWhiteSpace($managedIdentityClientId)) {
    $settingsLines += "AZURE_MANAGED_IDENTITY_CLIENT_ID=$managedIdentityClientId"
}
$settingsLines = @($settingsLines | Where-Object { $_ -notmatch '^APP_ALLOWED_ORIGINS=' })
$privateAiOrigins = Get-RapidRaterParameter -Name "RapidRater.AiAllowedPrivateOrigins"
if (-not [string]::IsNullOrWhiteSpace($privateAiOrigins)) {
    $settingsLines = @($settingsLines | Where-Object { $_ -notmatch '^AI_ALLOWED_PRIVATE_ORIGINS=' })
    $settingsLines += "AI_ALLOWED_PRIVATE_ORIGINS=$privateAiOrigins"
}
$postHogEnabled = (Get-RapidRaterParameter -Name "RapidRater.PostHogEnabled").Trim().ToLowerInvariant()
if (-not [string]::IsNullOrWhiteSpace($postHogEnabled)) {
    if ($postHogEnabled -notin @("true", "false")) {
        throw "RapidRater.PostHogEnabled must be true or false."
    }
    $settingsLines = @($settingsLines | Where-Object { $_ -notmatch '^POSTHOG_' })
    $settingsLines += "POSTHOG_ENABLED=$postHogEnabled"
    if ($postHogEnabled -eq "true") {
        $postHogToken = Get-RapidRaterParameter -Name "RapidRater.PostHogProjectToken"
        $postHogHost = Get-RapidRaterParameter -Name "RapidRater.PostHogHost"
        if ([string]::IsNullOrWhiteSpace($postHogToken) -or [string]::IsNullOrWhiteSpace($postHogHost)) {
            throw "Enabled PostHog analytics require RapidRater.PostHogProjectToken and RapidRater.PostHogHost."
        }
        $settingsLines += "POSTHOG_PROJECT_TOKEN=$postHogToken"
        $settingsLines += "POSTHOG_HOST=$postHogHost"
    }
}
$settingsLines | Set-Content -LiteralPath $RuntimeSettingsPath -Encoding UTF8
icacls $InstallDir /grant:r $ReadExecuteAcl /Q | Out-Null
icacls $ConfigDir /inheritance:r /grant:r $SystemFullControlAcl $AdministratorsFullControlAcl $ReadExecuteAcl /Q | Out-Null
icacls $RuntimeDir /inheritance:r /grant:r $SystemFullControlAcl $AdministratorsFullControlAcl "*$($ServiceAccountSid):(OI)(CI)M" /Q | Out-Null
icacls $RuntimeSettingsPath /inheritance:r /grant:r "SYSTEM:F" "Administrators:F" "*$($ServiceAccountSid):R" /Q | Out-Null
if (Test-Path -LiteralPath $LegacySettingsPath) {
    Remove-Item -LiteralPath $LegacySettingsPath -Force
}

Write-Host "Installing production dependencies..."
& $npmPath ci --omit=dev --no-audit --no-fund --prefix $InstallDir
if ($LASTEXITCODE -ne 0) {
    throw "npm ci failed."
}

Write-Host "Applying PostgreSQL migrations..."
Push-Location $InstallDir
try {
    $env:IMDB_RAPID_RATER_HOME = $RuntimeDir
    $env:RAPID_RATER_SETTINGS_PATH = $RuntimeSettingsPath
    & $nodePath "scripts/migrate.mjs"
    if ($LASTEXITCODE -ne 0) {
        throw "Database migration failed."
    }
} finally {
    Pop-Location
}

$powerShellPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$action = New-ScheduledTaskAction -Execute $powerShellPath -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$LauncherPath`"" -WorkingDirectory $InstallDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId $ServiceAccountName -LogonType ServiceAccount -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -ne $existingTask) {
    Write-Host "Stopping the existing IMDb Rapid Rating process..."
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    for ($attempt = 1; $attempt -le 20; $attempt++) {
        $state = (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue).State
        if ($state -ne $RunningTaskState) {
            break
        }
        Start-Sleep -Milliseconds 500
    }
    if ((Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue).State -eq $RunningTaskState) {
        throw "The existing IMDb Rapid Rating scheduled task did not stop."
    }
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

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
        if ($taskState -ne $RunningTaskState) {
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
    $proxyUpstreamHost = $LoopbackAddress
}
$proxyHealthAddress = Get-RapidRaterParameter -Name "RapidRater.ProxyHealthAddress"
if ([string]::IsNullOrWhiteSpace($proxyHealthAddress)) {
    $proxyHealthAddress = $LoopbackAddress
}
$proxyUpstreamUrl = "http://${proxyUpstreamHost}:$Port"
$appCmd = "C:\Windows\System32\inetsrv\appcmd.exe"
$siteState = $UnavailableSiteState
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
        $siteState = $UnavailableSiteState
    }
} catch {
    $siteState = $UnavailableSiteState
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
