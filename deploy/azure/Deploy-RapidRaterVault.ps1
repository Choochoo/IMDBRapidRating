[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SubscriptionId,

    [Parameter(Mandatory = $true)]
    [string]$ResourceGroupName,

    [Parameter(Mandatory = $true)]
    [string]$Location,

    [Parameter(Mandatory = $true)]
    [string]$VaultName,

    [Parameter(Mandatory = $true)]
    [string]$RuntimePrincipalId,

    [Parameter(Mandatory = $true)]
    [string]$VirtualNetworkId,

    [Parameter(Mandatory = $true)]
    [string]$PrivateEndpointSubnetId
)

$ErrorActionPreference = "Stop"
$TemplatePath = Join-Path $PSScriptRoot "key-vault.bicep"

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    throw "Azure CLI is required. Run this script from Azure Cloud Shell or install Azure CLI."
}

& az account set --subscription $SubscriptionId
if ($LASTEXITCODE -ne 0) {
    throw "Azure subscription selection failed."
}

& az group create --name $ResourceGroupName --location $Location --output none
if ($LASTEXITCODE -ne 0) {
    throw "Azure resource group creation failed."
}

$DeploymentArguments = @(
    "deployment", "group", "create",
    "--resource-group", $ResourceGroupName,
    "--template-file", $TemplatePath,
    "--parameters",
    "vaultName=$VaultName",
    "location=$Location",
    "runtimePrincipalId=$RuntimePrincipalId",
    "virtualNetworkId=$VirtualNetworkId",
    "privateEndpointSubnetId=$PrivateEndpointSubnetId",
    "--query", "properties.outputs",
    "--output", "json"
)
$DeploymentOutput = & az @DeploymentArguments
if ($LASTEXITCODE -ne 0) {
    throw "Azure Key Vault deployment failed."
}

$Outputs = $DeploymentOutput | ConvertFrom-Json
Write-Host "Azure Key Vault infrastructure is ready." -ForegroundColor Green
Write-Host "AZURE_KEY_VAULT_URL=$($Outputs.azureKeyVaultUrl.value)"
Write-Host "AZURE_KEY_VAULT_KEY_ID=$($Outputs.azureKeyVaultKeyId.value)"
