import { DefaultAzureCredential, ManagedIdentityCredential } from "@azure/identity";
import { ReadManagedIdentityClientId } from "./secret-protection-config.mjs";

const ProductionEnvironment = "production";

export function CreateAzureCredential(options = {}) {
  if (options.useDefaultCredential || process.env.NODE_ENV !== ProductionEnvironment)
    return new DefaultAzureCredential();
  const clientId = options.clientId || ReadManagedIdentityClientId();
  return clientId ? new ManagedIdentityCredential(clientId) : new ManagedIdentityCredential();
}
