import type { DatabaseSync } from 'node:sqlite'

import { AppError } from '../../shared/errors'
import type {
  ClearOpenAiApiKeyResult,
  OpenAiApiKeyStatus,
  SaveOpenAiApiKeyResult
} from '../../shared/settings'

export const openAiApiKeyEnvironmentVariableName = 'OPENAI_API_KEY'
export const openAiApiKeySettingKey = 'openai_api_key'

const encryptedApiKeyPrefix = 'safe-storage:v1:'
const emptyOpenAiApiKeyStatus = {
  hasKey: false,
  source: null,
  maskedKey: null,
  updatedAt: null
} satisfies OpenAiApiKeyStatus

export interface SecureStorageAdapter {
  isEncryptionAvailable: () => boolean
  encryptString: (plainText: string) => Buffer
  decryptString: (encryptedValue: Buffer) => string
}

export interface ResolvedOpenAiApiKey {
  apiKey: string
  source: 'saved' | 'environment'
}

interface AppSettingRow {
  value: string
  updatedAt: string
}

export function getOpenAiApiKeyStatusFromDatabase(
  connection: DatabaseSync,
  secureStorage?: SecureStorageAdapter
): OpenAiApiKeyStatus {
  const savedSetting = getAppSetting(connection, openAiApiKeySettingKey)

  if (savedSetting !== null) {
    const apiKey = decryptStoredApiKey(savedSetting.value, secureStorage)

    return {
      hasKey: true,
      source: 'saved',
      maskedKey: maskApiKey(apiKey),
      updatedAt: savedSetting.updatedAt
    }
  }

  const environmentApiKey = getEnvironmentOpenAiApiKey()

  if (environmentApiKey !== null) {
    return {
      hasKey: true,
      source: 'environment',
      maskedKey: maskApiKey(environmentApiKey),
      updatedAt: null
    }
  }

  return emptyOpenAiApiKeyStatus
}

export function saveOpenAiApiKeyToDatabase(
  connection: DatabaseSync,
  secureStorage: SecureStorageAdapter,
  apiKey: string
): SaveOpenAiApiKeyResult {
  const trimmedApiKey = apiKey.trim()

  if (trimmedApiKey.length === 0) {
    throw new AppError('validation_failed', 'Enter an OpenAI API key.')
  }

  if (!secureStorage.isEncryptionAvailable()) {
    throw new AppError('validation_failed', 'Secure key storage is unavailable on this system.')
  }

  const encryptedApiKey = secureStorage.encryptString(trimmedApiKey).toString('base64')

  connection
    .prepare(
      `
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = CURRENT_TIMESTAMP
      `
    )
    .run(openAiApiKeySettingKey, `${encryptedApiKeyPrefix}${encryptedApiKey}`)

  return {
    status: getOpenAiApiKeyStatusFromDatabase(connection, secureStorage)
  }
}

export function clearOpenAiApiKeyFromDatabase(
  connection: DatabaseSync,
  secureStorage?: SecureStorageAdapter
): ClearOpenAiApiKeyResult {
  connection.prepare('DELETE FROM app_settings WHERE key = ?').run(openAiApiKeySettingKey)

  return {
    status: getOpenAiApiKeyStatusFromDatabase(connection, secureStorage)
  }
}

export function resolveOpenAiApiKeyFromDatabase(
  connection: DatabaseSync,
  secureStorage?: SecureStorageAdapter
): ResolvedOpenAiApiKey | null {
  const savedSetting = getAppSetting(connection, openAiApiKeySettingKey)

  if (savedSetting !== null) {
    return {
      apiKey: decryptStoredApiKey(savedSetting.value, secureStorage),
      source: 'saved'
    }
  }

  const environmentApiKey = getEnvironmentOpenAiApiKey()

  if (environmentApiKey === null) {
    return null
  }

  return {
    apiKey: environmentApiKey,
    source: 'environment'
  }
}

function getAppSetting(connection: DatabaseSync, key: string): AppSettingRow | null {
  const row = connection
    .prepare('SELECT value, updated_at AS updatedAt FROM app_settings WHERE key = ?')
    .get(key) as AppSettingRow | undefined

  return row ?? null
}

function decryptStoredApiKey(
  storedValue: string,
  secureStorage: SecureStorageAdapter | undefined
): string {
  if (secureStorage === undefined || !secureStorage.isEncryptionAvailable()) {
    throw new AppError('validation_failed', 'Secure key storage is unavailable on this system.')
  }

  if (!storedValue.startsWith(encryptedApiKeyPrefix)) {
    throw new AppError(
      'validation_failed',
      'Saved OpenAI API key could not be read. Re-enter it in Settings.'
    )
  }

  const encryptedApiKey = storedValue.slice(encryptedApiKeyPrefix.length)

  try {
    const decryptedApiKey = secureStorage
      .decryptString(Buffer.from(encryptedApiKey, 'base64'))
      .trim()

    if (decryptedApiKey.length === 0) {
      throw new Error('Decrypted API key was empty.')
    }

    return decryptedApiKey
  } catch {
    throw new AppError(
      'validation_failed',
      'Saved OpenAI API key could not be read. Re-enter it in Settings.'
    )
  }
}

function getEnvironmentOpenAiApiKey(): string | null {
  const apiKey = process.env[openAiApiKeyEnvironmentVariableName]?.trim()

  return apiKey === undefined || apiKey.length === 0 ? null : apiKey
}

export function maskApiKey(apiKey: string): string {
  const trimmedApiKey = apiKey.trim()
  const visiblePrefixLength = trimmedApiKey.startsWith('sk-')
    ? 3
    : Math.min(4, trimmedApiKey.length)
  const prefix = trimmedApiKey.slice(0, visiblePrefixLength)
  const suffix = trimmedApiKey.slice(-4)

  return `${prefix}...${suffix}`
}
