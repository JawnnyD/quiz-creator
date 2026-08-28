import { safeStorage } from 'electron'

import type {
  ClearOpenAiApiKeyResult,
  OpenAiApiKeyStatus,
  SaveOpenAiApiKeyResult
} from '../../shared/settings'
import { initializeDatabase } from '../db'
import {
  clearOpenAiApiKeyFromDatabase,
  getOpenAiApiKeyStatusFromDatabase,
  saveOpenAiApiKeyToDatabase,
  type SecureStorageAdapter
} from './service'

export type {
  ClearOpenAiApiKeyResult,
  OpenAiApiKeyStatus,
  SaveOpenAiApiKeyResult
} from '../../shared/settings'
export type { SecureStorageAdapter } from './service'
export {
  clearOpenAiApiKeyFromDatabase,
  getOpenAiApiKeyStatusFromDatabase,
  maskApiKey,
  openAiApiKeyEnvironmentVariableName,
  openAiApiKeySettingKey,
  resolveOpenAiApiKeyFromDatabase,
  saveOpenAiApiKeyToDatabase
} from './service'

export const openAiApiKeySecureStorage = {
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encryptString: (plainText: string) => safeStorage.encryptString(plainText),
  decryptString: (encryptedValue: Buffer) => safeStorage.decryptString(encryptedValue)
} satisfies SecureStorageAdapter

export function getOpenAiApiKeyStatus(): OpenAiApiKeyStatus {
  return getOpenAiApiKeyStatusFromDatabase(initializeDatabase(), openAiApiKeySecureStorage)
}

export function saveOpenAiApiKey(apiKey: string): SaveOpenAiApiKeyResult {
  return saveOpenAiApiKeyToDatabase(initializeDatabase(), openAiApiKeySecureStorage, apiKey)
}

export function clearOpenAiApiKey(): ClearOpenAiApiKeyResult {
  return clearOpenAiApiKeyFromDatabase(initializeDatabase(), openAiApiKeySecureStorage)
}
