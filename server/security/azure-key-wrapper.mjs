import { CryptographyClient } from "@azure/keyvault-keys";
import { CreateAzureCredential } from "./azure-credential.mjs";
import { ReadAzureKeyVaultKeyId } from "./secret-protection-config.mjs";

const WrappingAlgorithm = "RSA-OAEP-256";
const Base64Encoding = "base64";

export function CreateAzureKeyWrapper(options = {}) {
  const keyId = options.keyId || ReadAzureKeyVaultKeyId();
  const credential = options.credential || CreateAzureCredential(options);
  const client = new CryptographyClient(keyId, credential);
  return {
    WrapKey: async (key) => await WrapKey(client, key, keyId),
    UnwrapKey: async (record) => await UnwrapKey(credential, record)
  };
}

async function WrapKey(client, key, fallbackKeyId) {
  const wrapped = await client.wrapKey(WrappingAlgorithm, key);
  return {
    wrappedKey: Buffer.from(wrapped.result).toString(Base64Encoding),
    wrappingKeyId: wrapped.keyID || fallbackKeyId,
    wrappingAlgorithm: WrappingAlgorithm
  };
}

async function UnwrapKey(credential, record) {
  const client = new CryptographyClient(record.wrappingKeyId, credential);
  const wrappedKey = Buffer.from(record.wrappedKey, Base64Encoding);
  const unwrapped = await client.unwrapKey(record.wrappingAlgorithm, wrappedKey);
  return Buffer.from(unwrapped.result);
}
