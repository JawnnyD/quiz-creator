import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabaseConnection } from '../db/connection'
import {
  clearOpenAiApiKeyFromDatabase,
  getOpenAiApiKeyStatusFromDatabase,
  openAiApiKeyEnvironmentVariableName,
  openAiApiKeySettingKey,
  resolveOpenAiApiKeyFromDatabase,
  saveOpenAiApiKeyToDatabase,
  type SecureStorageAdapter
} from './service'

let connection: DatabaseSync
let originalOpenAiApiKey: string | undefined

describe('OpenAI API key settings service', () => {
  beforeEach(() => {
    originalOpenAiApiKey = process.env[openAiApiKeyEnvironmentVariableName]
    delete process.env[openAiApiKeyEnvironmentVariableName]
    connection = createDatabaseConnection(':memory:')
  })

  afterEach(() => {
    connection.close()

    if (originalOpenAiApiKey === undefined) {
      delete process.env[openAiApiKeyEnvironmentVariableName]
    } else {
      process.env[openAiApiKeyEnvironmentVariableName] = originalOpenAiApiKey
    }
  })

  it('saves encrypted key data and returns only masked status to callers', () => {
    const secureStorage = createFakeSecureStorage()
    const result = saveOpenAiApiKeyToDatabase(
      connection,
      secureStorage,
      '  sk-test-saved-key-1234  '
    )

    expect(result.status).toMatchObject({
      hasKey: true,
      source: 'saved',
      maskedKey: 'sk-...1234'
    })
    expect(result.status.updatedAt).not.toBeNull()
    expect(getOpenAiApiKeyStatusFromDatabase(connection, secureStorage)).toEqual(result.status)
    expect(resolveOpenAiApiKeyFromDatabase(connection, secureStorage)).toEqual({
      apiKey: 'sk-test-saved-key-1234',
      source: 'saved'
    })

    const storedSetting = getStoredApiKeySetting()

    expect(storedSetting?.value).toMatch(/^safe-storage:v1:/)
    expect(storedSetting?.value).not.toContain('sk-test-saved-key-1234')
  })

  it('prefers saved keys over environment keys and falls back after clearing', () => {
    const secureStorage = createFakeSecureStorage()
    process.env[openAiApiKeyEnvironmentVariableName] = 'sk-test-env-key-9999'

    expect(getOpenAiApiKeyStatusFromDatabase(connection, secureStorage)).toMatchObject({
      hasKey: true,
      source: 'environment',
      maskedKey: 'sk-...9999',
      updatedAt: null
    })

    saveOpenAiApiKeyToDatabase(connection, secureStorage, 'sk-test-saved-key-1234')

    expect(resolveOpenAiApiKeyFromDatabase(connection, secureStorage)).toEqual({
      apiKey: 'sk-test-saved-key-1234',
      source: 'saved'
    })

    const clearResult = clearOpenAiApiKeyFromDatabase(connection, secureStorage)

    expect(clearResult.status).toEqual({
      hasKey: true,
      source: 'environment',
      maskedKey: 'sk-...9999',
      updatedAt: null
    })
    expect(resolveOpenAiApiKeyFromDatabase(connection, secureStorage)).toEqual({
      apiKey: 'sk-test-env-key-9999',
      source: 'environment'
    })
    expect(getStoredApiKeySetting()).toBeUndefined()
  })

  it('rejects empty saved keys with a typed validation error', () => {
    expectAppError(
      () => {
        saveOpenAiApiKeyToDatabase(connection, createFakeSecureStorage(), '   ')
      },
      {
        code: 'validation_failed',
        message: 'Enter an OpenAI API key.'
      }
    )
    expect(getStoredApiKeySetting()).toBeUndefined()
  })

  it('rejects saving when secure encryption is unavailable', () => {
    expectAppError(
      () => {
        saveOpenAiApiKeyToDatabase(connection, createFakeSecureStorage(false), 'sk-test-key-1234')
      },
      {
        code: 'validation_failed',
        message: 'Secure key storage is unavailable on this system.'
      }
    )
    expect(getStoredApiKeySetting()).toBeUndefined()
  })
})

function createFakeSecureStorage(isEncryptionAvailable = true): SecureStorageAdapter {
  return {
    isEncryptionAvailable: () => isEncryptionAvailable,
    encryptString: (plainText: string) => Buffer.from(`encrypted:${plainText}`, 'utf8'),
    decryptString: (encryptedValue: Buffer) =>
      encryptedValue.toString('utf8').replace(/^encrypted:/, '')
  }
}

function getStoredApiKeySetting(): { value: string; updatedAt: string } | undefined {
  return connection
    .prepare('SELECT value, updated_at AS updatedAt FROM app_settings WHERE key = ?')
    .get(openAiApiKeySettingKey) as { value: string; updatedAt: string } | undefined
}

function expectAppError(
  action: () => unknown,
  expectedError: { code: string; message: string }
): void {
  let thrownError: unknown

  try {
    action()
  } catch (error) {
    thrownError = error
  }

  expect(thrownError).toMatchObject(expectedError)
}
