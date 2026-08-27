export const appErrorCodes = [
  'lesson_not_found',
  'lesson_text_unavailable',
  'lesson_text_extraction_failed',
  'lesson_text_empty',
  'ai_generation_failed',
  'ai_response_malformed',
  'quiz_not_found',
  'quiz_attempt_not_found',
  'quiz_incomplete_submission',
  'validation_failed',
  'unexpected'
] as const

export type AppErrorCode = (typeof appErrorCodes)[number]

export interface SerializedAppError {
  type: 'app_error'
  code: AppErrorCode
  message: string
}

const ipcAppErrorPrefix = '__QUIZ_CREATOR_APP_ERROR__:'

export class AppError extends Error {
  readonly code: AppErrorCode

  constructor(code: AppErrorCode, message: string) {
    super(message)
    this.name = 'AppError'
    this.code = code
  }
}

export function isAppError(error: unknown): error is AppError {
  if (error instanceof AppError) {
    return true
  }

  if (typeof error !== 'object' || error === null || Array.isArray(error)) {
    return false
  }

  const candidate = error as Partial<AppError>

  return isAppErrorCode(candidate.code) && typeof candidate.message === 'string'
}

export function toAppError(error: unknown, fallbackMessage = 'Something went wrong.'): AppError {
  if (isAppError(error)) {
    return error
  }

  return new AppError('unexpected', fallbackMessage)
}

export function encodeAppErrorForIpc(error: unknown, fallbackMessage?: string): string {
  const appError = toAppError(error, fallbackMessage)
  const serializedError: SerializedAppError = {
    type: 'app_error',
    code: appError.code,
    message: appError.message
  }

  return `${ipcAppErrorPrefix}${JSON.stringify(serializedError)}`
}

export function decodeAppErrorFromIpc(error: unknown): AppError | null {
  const message = error instanceof Error ? error.message : String(error)
  const prefixIndex = message.indexOf(ipcAppErrorPrefix)

  if (prefixIndex === -1) {
    return null
  }

  const serializedStartIndex = prefixIndex + ipcAppErrorPrefix.length
  const serializedEndIndex = message.lastIndexOf('}')

  if (serializedEndIndex < serializedStartIndex) {
    return null
  }

  const serializedValue = message.slice(serializedStartIndex, serializedEndIndex + 1)

  try {
    const parsedValue = JSON.parse(serializedValue) as unknown

    if (!isSerializedAppError(parsedValue)) {
      return null
    }

    return new AppError(parsedValue.code, parsedValue.message)
  } catch {
    return null
  }
}

function isSerializedAppError(value: unknown): value is SerializedAppError {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const candidate = value as Partial<SerializedAppError>

  return (
    candidate.type === 'app_error' &&
    isAppErrorCode(candidate.code) &&
    typeof candidate.message === 'string' &&
    candidate.message.trim().length > 0
  )
}

function isAppErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === 'string' && appErrorCodes.includes(value as AppErrorCode)
}
