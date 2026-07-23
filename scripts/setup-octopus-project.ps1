param(
    [Parameter(Mandatory = $true)]
    [string]$OctopusUrl,

    [Parameter(Mandatory = $true)]
    [string]$ApiKey,

    [string]$SpaceName = "Default"
)

$ErrorActionPreference = "Stop"

$ApplicationName = "IMDBRapidRating"
$ProjectName = $ApplicationName
$PackageName = $ApplicationName
$DeployPath = "C:\inetpub\wwwroot\IMDBRapidRating"
$TargetRole = "web"
$BuiltInFeedId = "feeds-builtin"
$FalsePropertyValue = "False"
$GetMethod = "GET"
$SuccessCondition = "Success"
$TargetRolesProperty = "Octopus.Action.TargetRoles"
$StopActionName = "Stop IMDb Rapid Rating"
$DeployActionName = "Deploy IMDb Rapid Rating"
$StartActionName = "Start and verify IMDb Rapid Rating"
$repoRoot = Split-Path -Parent $PSScriptRoot
$preDeployScript = Get-Content -Raw -LiteralPath (Join-Path $repoRoot "deploy\PreDeploy.ps1")
$postDeployScript = Get-Content -Raw -LiteralPath (Join-Path $repoRoot "deploy\PostDeploy.ps1")

$headers = @{
    "X-Octopus-ApiKey" = $ApiKey
    "Content-Type" = "application/json"
}

function New-OctopusApiParameters {
    param([string]$Uri, [string]$Method = $GetMethod, $Body = $null)
    $parameters = @{
        Uri = "$OctopusUrl$Uri"
        Method = $Method
        Headers = $headers
    }
    if ($null -ne $Body) {
        $parameters.Body = $Body | ConvertTo-Json -Depth 30
    }
    return $parameters
}

function Read-OctopusApiError {
    param($ErrorRecord)
    if (-not $ErrorRecord.Exception.Response) {
        return $ErrorRecord.Exception.Message
    }
    $reader = New-Object System.IO.StreamReader($ErrorRecord.Exception.Response.GetResponseStream())
    $responseBody = $reader.ReadToEnd()
    if ($responseBody) {
        return $responseBody
    }
    return $ErrorRecord.Exception.Message
}

function Invoke-OctopusApi {
    param([string]$Uri, [string]$Method = $GetMethod, $Body = $null)
    $parameters = New-OctopusApiParameters -Uri $Uri -Method $Method -Body $Body
    try {
        Invoke-RestMethod @parameters
    } catch {
        $details = Read-OctopusApiError $_
        throw "Octopus API $Method $Uri failed: $details"
    }
}

function New-ActionCore {
    param([string]$Name, [string]$ActionType)
    return @{
        Name = $Name
        ActionType = $ActionType
        IsDisabled = $false
        CanBeUsedForProjectVersioning = $false
        IsRequired = $false
        WorkerPoolId = $null
        Container = @{ Image = $null; FeedId = $null; GitUrl = $null; Dockerfile = $null }
        WorkerPoolVariable = $null
    }
}

function New-ActionCollections {
    return @{
        Environments = @()
        ExcludedEnvironments = @()
        Channels = @()
        TenantTags = @()
        Packages = @()
        GitDependencies = @()
    }
}

function New-ScriptActionProperties {
    param([string]$ScriptBody)
    return @{
        "Octopus.Action.Script.ScriptSource" = "Inline"
        "Octopus.Action.Script.Syntax" = "PowerShell"
        "Octopus.Action.Script.ScriptBody" = $ScriptBody
        $TargetRolesProperty = $TargetRole
    }
}

function New-ScriptAction {
    param([string]$Name, [string]$ScriptBody)
    $action = (New-ActionCore -Name $Name -ActionType "Octopus.Script") + (New-ActionCollections)
    $action.Condition = $SuccessCondition
    $action.Properties = New-ScriptActionProperties $ScriptBody
    return $action
}

function New-ProcessStep {
    param([string]$Name, $Action)
    @{
        Name = $Name
        PackageRequirement = "LetOctopusDecide"
        Properties = @{ $TargetRolesProperty = $TargetRole }
        Condition = $SuccessCondition
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
    $projectBody = @{
        Name = $ProjectName
        ProjectGroupId = $projectGroup.Id
        LifecycleId = $lifecycle.Id
    }
    $project = Invoke-OctopusApi "/api/$spaceId/projects" -Method POST -Body $projectBody
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
    Condition = $SuccessCondition
    Packages = @(
        @{
            Name = ""
            PackageId = $PackageName
            FeedId = $BuiltInFeedId
            AcquisitionLocation = "Server"
            Properties = @{ SelectionMode = "immediate" }
        }
    )
    Properties = @{
        "Octopus.Action.Package.DownloadOnTentacle" = $FalsePropertyValue
        "Octopus.Action.Package.FeedId" = $BuiltInFeedId
        "Octopus.Action.Package.CustomInstallationDirectory" = $DeployPath
        "Octopus.Action.Package.CustomInstallationDirectoryShouldBePurgedBeforeDeployment" = $FalsePropertyValue
        "Octopus.Action.Package.PackageId" = $PackageName
        $TargetRolesProperty = $TargetRole
        "Octopus.Action.Package.AutomaticallyRunConfigurationTransformationFiles" = $FalsePropertyValue
        "Octopus.Action.Package.AutomaticallyUpdateAppSettingsAndConnectionStrings" = $FalsePropertyValue
        "Octopus.Action.EnabledFeatures" = "Octopus.Features.CustomDirectory"
    }
}

$process = Invoke-OctopusApi "/api/$spaceId/projects/$($project.Id)/deploymentprocesses"
$process.Steps = @(
    (New-ProcessStep -Name $StopActionName -Action (New-ScriptAction -Name $StopActionName -ScriptBody $preDeployScript)),
    (New-ProcessStep -Name $DeployActionName -Action $packageAction),
    (New-ProcessStep -Name $StartActionName -Action (New-ScriptAction -Name $StartActionName -ScriptBody $postDeployScript))
)

Invoke-OctopusApi "/api/$spaceId/deploymentprocesses/$($process.Id)" -Method PUT -Body $process | Out-Null

Write-Host "Octopus project configured." -ForegroundColor Green
Write-Host "Project: $ProjectName"
Write-Host "Environment: $($production.Name)"
Write-Host "Target role: $TargetRole"
Write-Host "Deployment path: $DeployPath"
