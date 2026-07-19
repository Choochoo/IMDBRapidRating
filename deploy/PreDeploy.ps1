$ErrorActionPreference = "Stop"

$TaskName = "IMDB Rapid Rating Server"
$Port = 5012
$ProxyDir = "C:\inetpub\wwwroot\OurFilmClubProxy"
$MaintenancePagePath = Join-Path $ProxyDir "maintenance.html"
$MaintenanceConfigPath = Join-Path $ProxyDir "web.maintenance.config"

Write-Host "Enabling the IMDb Rapid Rater maintenance page..." -ForegroundColor Cyan

New-Item -Path $ProxyDir -ItemType Directory -Force | Out-Null

$maintenancePage = @'
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>IMDb Rapid Rater is being updated</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #09090b;
      color: #fafafa;
    }
    * { box-sizing: border-box; }
    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      padding: 1.5rem;
      background:
        radial-gradient(circle at top, rgba(244, 63, 94, 0.16), transparent 34rem),
        #09090b;
    }
    main {
      width: min(100%, 34rem);
      padding: clamp(2rem, 7vw, 3.5rem);
      border: 1px solid #27272a;
      border-radius: 1.5rem;
      background: rgba(24, 24, 27, 0.92);
      box-shadow: 0 1.5rem 5rem rgba(0, 0, 0, 0.42);
      text-align: center;
    }
    .mark {
      display: grid;
      width: 4rem;
      height: 4rem;
      margin: 0 auto 1.5rem;
      place-items: center;
      border-radius: 999px;
      background: #e11d48;
      font-size: 1.8rem;
    }
    h1 {
      margin: 0;
      font-size: clamp(1.8rem, 6vw, 2.6rem);
      line-height: 1.08;
      letter-spacing: -0.04em;
    }
    p {
      margin: 1rem 0 0;
      color: #a1a1aa;
      font-size: 1.05rem;
      line-height: 1.65;
    }
  </style>
</head>
<body>
  <main>
    <div class="mark" aria-hidden="true">&#127916;</div>
    <h1>Quick intermission</h1>
    <p>IMDb Rapid Rater is being updated. We should be back in a few minutes.</p>
  </main>
</body>
</html>
'@
$maintenancePage | Set-Content -LiteralPath $MaintenancePagePath -Encoding UTF8

$maintenanceConfig = @'
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <httpErrors errorMode="Custom" existingResponse="Replace">
      <remove statusCode="503" subStatusCode="-1" />
      <error statusCode="503" subStatusCode="-1" path="/maintenance.html" responseMode="ExecuteURL" />
    </httpErrors>
    <rewrite>
      <rules>
        <rule name="Show maintenance page" stopProcessing="true">
          <match url="^(?!maintenance\.html$).*" />
          <action type="CustomResponse" statusCode="503" subStatusCode="0" statusReason="Service Unavailable" statusDescription="IMDb Rapid Rater is being updated." />
        </rule>
      </rules>
    </rewrite>
  </system.webServer>
</configuration>
'@
$maintenanceConfig | Set-Content -LiteralPath $MaintenanceConfigPath -Encoding UTF8
Copy-Item -LiteralPath $MaintenanceConfigPath -Destination (Join-Path $ProxyDir "web.config") -Force

Write-Host "IMDb Rapid Rater is in maintenance mode." -ForegroundColor Green

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
