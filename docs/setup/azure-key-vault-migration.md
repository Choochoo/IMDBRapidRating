# Azure Key Vault migration

This runbook moves Rapid Rater's runtime secrets and user API-key encryption
away from a key stored on the web server.

## What the design protects

- Azure Key Vault Premium holds a non-exportable RSA-HSM wrapping key.
- PostgreSQL stores a different AES-256-GCM data key for each user, wrapped by
  the Azure key. The plaintext user key exists only in application memory while
  a secret is being used.
- A stolen database does not contain the Azure wrapping key.
- The production managed identity can only read this app's runtime secrets and
  wrap or unwrap data keys. It cannot create, edit, or delete vault contents.
- The vault accepts data-plane traffic only through an Azure private endpoint.
- Key Vault audit events and metrics are retained in Log Analytics for 90 days.

A fully compromised running server can temporarily use its managed identity
while that access remains enabled. No vault can prevent this and still allow the
application to decrypt data. Containment therefore also requires prompt
identity revocation, server isolation, audit alerts, and credential rotation.

## Information required before provisioning

Collect these non-secret values from Azure:

1. Subscription ID.
2. Azure region.
3. Resource group name for the new vault.
4. Globally unique Key Vault name, 3-24 letters, numbers, or hyphens.
5. Object ID of the production workload's managed identity.
6. Full resource ID of the production virtual network.
7. Full resource ID of the subnet reserved for private endpoints.

The production workload must run in Azure with a managed identity and private
network access to the vault. If it is not an Azure VM, App Service, Container
App, or another managed-identity-capable Azure service, stop and choose the
hosting or Azure Arc design before provisioning.

## Responsibilities

Codex can:

- maintain the application, database migration, and encryption code;
- deploy the included Bicep infrastructure after an Azure sign-in;
- validate the vault without printing any secret;
- run the database preview and migration;
- verify the application and remove obsolete configuration references.

The owner must:

- sign in to the correct Azure tenant with MFA;
- approve Azure costs and the irreversible purge-protection setting;
- provide the seven non-secret Azure values above;
- paste existing secret values into the secure prompts personally;
- approve the production deployment and final cutover;
- choose alert recipients and emergency responders.

Never send secret values through chat, commit them, place them in a Bicep
parameter file, or pass them as ordinary command-line arguments.

## Phase 1: prepare and back up

1. Take a PostgreSQL backup before changing encryption. Encrypt the backup and
   test that it can be restored to an isolated database.
2. Record the current count of rows in `user_secrets`.
3. Keep the existing `DATA_ENCRYPTION_KEY` available until the final vault-mode
   verification is complete.
4. Deploy the new application code once with
   `RapidRater.SecretProtectionMode=legacy`. This applies the
   `user_data_keys` schema without changing existing ciphertext.

Do not run the secret migration from a developer machine against production.

## Phase 2: create the private vault

Run the following from a checked-out repository in Azure Cloud Shell or a
workstation with Azure CLI:

```powershell
az login
.\deploy\azure\Deploy-RapidRaterVault.ps1 -SubscriptionId "<subscription-id>" -ResourceGroupName "<resource-group>" -Location "<region>" -VaultName "<globally-unique-vault-name>" -RuntimePrincipalId "<managed-identity-object-id>" -VirtualNetworkId "<virtual-network-resource-id>" -PrivateEndpointSubnetId "<private-endpoint-subnet-resource-id>"
```

The deployment creates:

- a Premium Key Vault with RBAC, soft delete, purge protection, and public
  network access disabled;
- a 3072-bit non-exportable RSA-HSM wrapping key with annual rotation;
- least-privilege runtime role assignments;
- a private endpoint and private DNS link;
- a Log Analytics workspace and Key Vault audit diagnostics.

Save the two non-secret outputs:

- `AZURE_KEY_VAULT_URL`
- `AZURE_KEY_VAULT_KEY_ID`

Do not delete or disable old wrapping-key versions after automatic rotation.
Existing encrypted rows retain the exact key version needed to unwrap them.

## Phase 3: load secrets without exposing them

Temporarily grant the signed-in migration operator `Key Vault Secrets Officer`
on this vault. Do not grant that role to the application managed identity.

From an interactive PowerShell session on a machine inside the production VNet:

```powershell
Connect-AzAccount
.\deploy\azure\Set-RapidRaterVaultSecrets.ps1 -VaultName "<globally-unique-vault-name>"
Disconnect-AzAccount -Scope Process
Clear-AzContext -Scope CurrentUser -Force
```

The prompts store:

- `rapid-rater-postgres-connection-string`
- `rapid-rater-session-secret`
- `rapid-rater-tmdb-api-key`
- `rapid-rater-legacy-data-encryption-key`

Remove the operator's temporary `Key Vault Secrets Officer` assignment
immediately afterward. The legacy encryption key remains in the vault only for
the migration window.

## Phase 4: test dual mode

Configure these Octopus variables:

| Octopus variable | Value | Sensitive |
| --- | --- | --- |
| `RapidRater.SecretProtectionMode` | `dual` | No |
| `RapidRater.AzureKeyVaultUrl` | `AZURE_KEY_VAULT_URL` output | No |
| `RapidRater.AzureKeyVaultKeyId` | `AZURE_KEY_VAULT_KEY_ID` output | No |
| `RapidRater.AzureManagedIdentityClientId` | User-assigned identity client ID, or blank for system-assigned | No |

Keep the existing application origin variables. In dual or vault mode the
deployment settings file contains vault identifiers, not the PostgreSQL
password, session secret, TMDB key, or encryption key.

Deploy to production, then run on the production host:

```powershell
Set-Location C:\inetpub\wwwroot\IMDBRapidRating
npm run vault:verify
npm run secrets:migrate
```

The first command verifies secret reads and HSM wrap/unwrap without displaying
secret values. The second is preview-only and prints only a row count.

## Phase 5: migrate user secrets

After the backup and preview are confirmed:

```powershell
npm run secrets:migrate -- --execute
npm run secrets:migrate
```

The final preview must report zero legacy encrypted secrets. The migration is
restartable and updates a row only while it is still on legacy key version 1.
It never logs plaintext.

Test at least:

1. Sign in.
2. Open the AI connection page.
3. Discover models from a custom URL.
4. Test the connection.
5. Use an existing IMDb connection.
6. Restart the service and repeat the connection tests.

## Phase 6: cut over and retire the old key

1. Change `RapidRater.SecretProtectionMode` from `dual` to `vault`.
2. Deploy again.
3. Run `npm run vault:verify`.
4. Confirm `/health` is healthy and repeat the connection tests.
5. Delete the `rapid-rater-legacy-data-encryption-key` secret from Key Vault.
   Leave it soft-deleted; purge protection intentionally prevents immediate
   permanent deletion.
6. Remove obsolete secret-valued Octopus variables after confirming they are
   no longer referenced.
7. Never switch back to `legacy` after version-2 records have been written.

If cutover fails before the legacy vault secret is deleted, return to `dual`
mode while investigating. Do not restore old application code over a migrated
database.

## Phase 7: finish the operational security work

1. Enable Microsoft Defender for Key Vault after reviewing its Azure cost.
2. Alert on repeated access denials, secret or key deletion, vault network
   changes, and role-assignment changes.
3. Put human vault administration behind Entra PIM, MFA, approval, and
   time-limited activation.
4. Configure the GitHub `production` environment with a required reviewer,
   prevent self-review, and allow deployments only from protected `main`.
5. Move production-only GitHub secrets into that environment while they are
   still needed.
6. Replace the public repository's self-hosted build runner with a clean
   GitHub-hosted runner or an ephemeral isolated runner before accepting
   untrusted contributions.
7. Rotate every credential that has ever lived outside the vault after the
   cutover is stable.

Source code can remain on GitHub. Secrets, local settings files, database
backups, runner work directories, generated packages containing configuration,
and Azure parameter files containing values must never be committed.
