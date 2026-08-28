export interface OpenAiApiKeyStatus {
  hasKey: boolean
  source: 'saved' | 'environment' | null
  maskedKey: string | null
  updatedAt: string | null
}

export interface SaveOpenAiApiKeyResult {
  status: OpenAiApiKeyStatus
}

export interface ClearOpenAiApiKeyResult {
  status: OpenAiApiKeyStatus
}
