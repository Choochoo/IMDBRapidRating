param(
    [Parameter(Mandatory = $true)]
    [string]$OctopusUrl,

    [Parameter(Mandatory = $true)]
    [string]$ApiKey,

    [string]$SpaceName = "Default"
)

$ErrorActionPreference = "Stop"

$ProjectName = "IMDBRapidRating"
$PackageName = "IMDBRapidRating"
$DeployPath = "C:\inetpub\wwwroot\IMDBRapidRating"
$TargetRole = "web"
$repoRoot = Split-Path -Parent $PSScriptRoot
$preDeployScript = Get-Content -Raw -LiteralPath (Join-Path $repoRoot "deploy\PreDeploy.ps1")
$postDeployScript = Get-Content -Raw -LiteralPath (Join-Path $repoRoot "deploy\PostDeploy.ps1")

$headers = @{
    "X-Octopus-ApiKey" = $ApiKey
    "Content-Type" = "application/json"
}

function Invoke-OctopusApi {
    param(
        [string]$Uri,
        [string]$Method = "GET",
        $Body = $null
    )

    $parameters = @{
        Uri = "$OctopusUrl$Uri"
        Method = $Method
        Headers = $headers
    }
    if ($null -ne $Body) {
        $parameters.Body = $Body | ConvertTo-Json -Depth 30
    }
    try {
        Invoke-RestMethod @parameters
    } catch {
        $details = $_.Exception.Message
        if ($_.Exception.Response) {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $responseBody = $reader.ReadToEnd()
            if ($responseBody) {
                $details = $responseBody
            }
        }
        throw "Octopus API $Method $Uri failed: $details"
    }
}

function New-ScriptAction {
    param([string]$Name, [string]$ScriptBody)
    @{
        Name = $Name
        ActionType = "Octopus.Script"
        IsDisabled = $false
        CanBeUsedForProjectVersioning = $false
        IsRequired = $false
        WorkerPoolId = $null
        Container = @{ Image = $null; FeedId = $null; GitUrl = $null; Dockerfile = $null }
        WorkerPoolVariable = $null
        Environments = @()
        ExcludedEnvironments = @()
        Channels = @()
        TenantTags = @()
        Packages = @()
        GitDependencies = @()
        Condition = "Success"
        Properties = @{
            "Octopus.Action.Script.ScriptSource" = "Inline"
            "Octopus.Action.Script.Syntax" = "PowerShell"
            "Octopus.Action.Script.ScriptBody" = $ScriptBody
            "Octopus.Action.TargetRoles" = $TargetRole
        }
    }
}

function New-ProcessStep {
    param([string]$Name, $Action)
    @{
        Name = $Name
        PackageRequirement = "LetOctopusDecide"
        Properties = @{ "Octopus.Action.TargetRoles" = $TargetRole }
        Condition = "Success"
        StartTrigger = "StartAfterPrevious"
        Actions = @($Action)
    }
}

$spaces = Invoke-OctopusApi "/api/spaces?partialName=$([uri]::EscapeDataString($SpaceName))&take=100"
$space = $spaces.Items | Where-Object { $_.Name -eq $SpaceName } | Select-Object -First 1
if (-not $space) {
    throw "Octopus space '$SpaceName' was not found."
}
$spaceId = $space.Id

$environments = Invoke-OctopusApi "/api/$spaceId/environments?partialName=Production&take=100"
$production = $environments.Items | Where-Object { $_.Name -eq "Production" } | Select-Object -First 1
if (-not $production) {
    throw "The Production environment was not found."
}

$groups = Invoke-OctopusApi "/api/$spaceId/projectgroups?take=100"
$projectGroup = $groups.Items | Select-Object -First 1
if (-not $projectGroup) {
    throw "No Octopus project group was found."
}

$lifecycles = Invoke-OctopusApi "/api/$spaceId/lifecycles?take=100"
$lifecycle = $lifecycles.Items | Where-Object { $_.Name -eq "Default Lifecycle" } | Select-Object -First 1
if (-not $lifecycle) {
    $lifecycle = $lifecycles.Items | Select-Object -First 1
}
if (-not $lifecycle) {
    throw "No Octopus lifecycle was found."
}

$projects = Invoke-OctopusApi "/api/$spaceId/projects?partialName=$([uri]::EscapeDataString($ProjectName))&take=100"
$project = $projects.Items | Where-Object { $_.Name -eq $ProjectName } | Select-Object -First 1
if (-not $project) {
    $project = Invoke-OctopusApi "/api/$spaceId/projects" -Method POST -Body @{
        Name = $ProjectName
        ProjectGroupId = $projectGroup.Id
        LifecycleId = $lifecycle.Id
    }
    Write-Host "Created Octopus project $ProjectName ($($project.Id))." -ForegroundColor Green
} else {
    Write-Host "Updating existing Octopus project $ProjectName ($($project.Id))." -ForegroundColor Yellow
}

$packageAction = @{
    Name = "Deploy $ProjectName"
    ActionType = "Octopus.TentaclePackage"
    IsDisabled = $false
    CanBeUsedForProjectVersioning = $true
    IsRequired = $false
    WorkerPoolId = $null
    Container = @{ Image = $null; FeedId = $null; GitUrl = $null; Dockerfile = $null }
    WorkerPoolVariable = ""
    Environments = @()
    ExcludedEnvironments = @()
    Channels = @()
    TenantTags = @()
    GitDependencies = @()
    Condition = "Success"
    Packages = @(
        @{
            Name = ""
            PackageId = $PackageName
            FeedId = "feeds-builtin"
            AcquisitionLocation = "Server"
            Properties = @{ SelectionMode = "immediate" }
        }
    )
    Properties = @{
        "Octopus.Action.Package.DownloadOnTentacle" = "False"
        "Octopus.Action.Package.FeedId" = "feeds-builtin"
        "Octopus.Action.Package.CustomInstallationDirectory" = $DeployPath
        "Octopus.Action.Package.CustomInstallationDirectoryShouldBePurgedBeforeDeployment" = "False"
        "Octopus.Action.Package.PackageId" = $PackageName
        "Octopus.Action.TargetRoles" = $TargetRole
        "Octopus.Action.Package.AutomaticallyRunConfigurationTransformationFiles" = "False"
        "Octopus.Action.Package.AutomaticallyUpdateAppSettingsAndConnectionStrings" = "False"
        "Octopus.Action.EnabledFeatures" = "Octopus.Features.CustomDirectory"
    }
}

$process = Invoke-OctopusApi "/api/$spaceId/projects/$($project.Id)/deploymentprocesses"
$process.Steps = @(
    (New-ProcessStep -Name "Stop IMDb Rapid Rating" -Action (New-ScriptAction -Name "Stop IMDb Rapid Rating" -ScriptBody $preDeployScript)),
    (New-ProcessStep -Name "Deploy IMDb Rapid Rating" -Action $packageAction),
    (New-ProcessStep -Name "Start and verify IMDb Rapid Rating" -Action (New-ScriptAction -Name "Start and verify IMDb Rapid Rating" -ScriptBody $postDeployScript))
)

Invoke-OctopusApi "/api/$spaceId/deploymentprocesses/$($process.Id)" -Method PUT -Body $process | Out-Null

Write-Host "Octopus project configured." -ForegroundColor Green
Write-Host "Project: $ProjectName"
Write-Host "Environment: $($production.Name)"
Write-Host "Target role: $TargetRole"
Write-Host "Deployment path: $DeployPath"
