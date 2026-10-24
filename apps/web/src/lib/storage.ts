import "server-only";
import { ArtifactStorage, storageConfigFromEnv } from "@faultline/db";
import { getEnv } from "./env";

const globalForStorage = globalThis as unknown as { faultlineStorage?: ArtifactStorage };

export function getStorage(): ArtifactStorage {
  globalForStorage.faultlineStorage ??= new ArtifactStorage(storageConfigFromEnv(getEnv()));
  return globalForStorage.faultlineStorage;
}
