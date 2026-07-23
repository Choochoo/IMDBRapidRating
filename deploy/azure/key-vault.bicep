targetScope = 'resourceGroup'

@description('Globally unique Azure Key Vault name.')
@minLength(3)
@maxLength(24)
param vaultName string

@description('Azure region for the vault and monitoring workspace.')
param location string = resourceGroup().location

@description('Object ID of the production workload managed identity.')
param runtimePrincipalId string

@description('Full resource ID of the virtual network that contains the production workload.')
param virtualNetworkId string

@description('Full resource ID of the subnet reserved for private endpoints.')
param privateEndpointSubnetId string

@description('Log Analytics workspace used for Key Vault audit records.')
param logAnalyticsWorkspaceName string = '${vaultName}-logs'

@description('Optional Azure resource tags.')
param tags object = {}

var wrappingKeyName = 'rapid-rater-wrap'
var servicePrincipalType = 'ServicePrincipal'
var globalLocation = 'global'
var roleDefinitionResourceType = 'Microsoft.Authorization/roleDefinitions'
var secretsUserRoleId = subscriptionResourceId(roleDefinitionResourceType, '4633458b-17de-408a-b874-0445c86b69e6')
var cryptoServiceEncryptionUserRoleId = subscriptionResourceId(roleDefinitionResourceType, 'e147488a-f6f5-4113-8e2d-b22465e65bf6')

resource vault 'Microsoft.KeyVault/vaults@2025-05-01' = {
  name: vaultName
  location: location
  tags: tags
  properties: {
    accessPolicies: []
    enablePurgeProtection: true
    enableRbacAuthorization: true
    enableSoftDelete: true
    networkAcls: {
      bypass: 'None'
      defaultAction: 'Deny'
      ipRules: []
      virtualNetworkRules: []
    }
    publicNetworkAccess: 'Disabled'
    sku: {
      family: 'A'
      name: 'premium'
    }
    softDeleteRetentionInDays: 90
    tenantId: tenant().tenantId
  }
}

resource wrappingKey 'Microsoft.KeyVault/vaults/keys@2025-05-01' = {
  parent: vault
  name: wrappingKeyName
  properties: {
    attributes: {
      enabled: true
      exportable: false
    }
    keyOps: [
      'wrapKey'
      'unwrapKey'
    ]
    keySize: 3072
    kty: 'RSA-HSM'
    rotationPolicy: {
      attributes: {
        expiryTime: 'P1Y'
      }
      lifetimeActions: [
        {
          action: {
            type: 'rotate'
          }
          trigger: {
            timeAfterCreate: 'P335D'
          }
        }
      ]
    }
  }
}

resource roleAssignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for roleDefinitionId in [secretsUserRoleId, cryptoServiceEncryptionUserRoleId]: {
  name: guid(vault.id, runtimePrincipalId, roleDefinitionId)
  scope: vault
  properties: {
    principalId: runtimePrincipalId
    principalType: servicePrincipalType
    roleDefinitionId: roleDefinitionId
  }
}]

resource privateDnsZone 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'privatelink.vaultcore.azure.net'
  location: globalLocation
  tags: tags
}

resource privateDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: privateDnsZone
  name: 'rapid-rater-${uniqueString(virtualNetworkId)}'
  location: globalLocation
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: virtualNetworkId
    }
  }
}

resource privateEndpoint 'Microsoft.Network/privateEndpoints@2025-05-01' = {
  name: '${vaultName}-endpoint'
  location: location
  tags: tags
  properties: {
    privateLinkServiceConnections: [
      {
        name: 'rapid-rater-vault'
        properties: {
          groupIds: [
            'vault'
          ]
          privateLinkServiceId: vault.id
        }
      }
    ]
    subnet: {
      id: privateEndpointSubnetId
    }
  }
}

resource privateDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2025-05-01' = {
  parent: privateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'azure-key-vault'
        properties: {
          privateDnsZoneId: privateDnsZone.id
        }
      }
    ]
  }
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2025-02-01' = {
  name: logAnalyticsWorkspaceName
  location: location
  tags: tags
  properties: {
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
    retentionInDays: 90
    sku: {
      name: 'PerGB2018'
    }
  }
}

resource vaultDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'rapid-rater-audit'
  scope: vault
  properties: {
    logs: [
      {
        categoryGroup: 'audit'
        enabled: true
      }
    ]
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
      }
    ]
    workspaceId: logAnalytics.id
  }
}

output azureKeyVaultUrl string = vault.properties.vaultUri
output azureKeyVaultKeyId string = '${vault.properties.vaultUri}keys/${wrappingKey.name}'
output logAnalyticsWorkspaceId string = logAnalytics.id
