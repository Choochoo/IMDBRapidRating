[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern("^[a-zA-Z0-9-]{3,24}$")]
    [string]$VaultName
)

$ErrorActionPreference = "Stop"

function Set-PromptedVaultSecret {
    param(
        [string]$Name,
        [string]$Prompt
    )

    $SecretValue = Read-Host -Prompt $Prompt -AsSecureString
    Set-AzKeyVaultSecret -VaultName $VaultName -Name $Name -SecretValue $SecretValue | Out-Null
    Write-Host "Stored $Name without printing its value." -ForegroundColor Green
}

if (-not (Get-Command Set-AzKeyVaultSecret -ErrorAction SilentlyContinue)) {
    throw "Az.KeyVault is required. Run Install-Module Az.KeyVault -Scope CurrentUser, then Connect-AzAccount."
}

Set-PromptedVaultSecret `
    -Name "rapid-rater-postgres-connection-string" `
    -Prompt "Paste the production PostgreSQL connection string"
Set-PromptedVaultSecret `
    -Name "rapid-rater-session-secret" `
    -Prompt "Paste the current SESSION_SECRET"
Set-PromptedVaultSecret `
    -Name "rapid-rater-tmdb-api-key" `
    -Prompt "Paste the production TMDB API key"
Set-PromptedVaultSecret `
    -Name "rapid-rater-legacy-data-encryption-key" `
    -Prompt "Paste the current DATA_ENCRYPTION_KEY (needed only during migration)"
