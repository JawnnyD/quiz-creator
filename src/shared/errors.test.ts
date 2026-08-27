import { describe, expect, it } from 'vitest'

import { AppError, decodeAppErrorFromIpc, encodeAppErrorForIpc, isAppError } from './errors'

describe('app error IPC encoding', () => {
  it('preserves expected error codes and safe messages across IPC error text', () => {
    const encodedError = encodeAppErrorForIpc(
      new AppError('quiz_not_found', 'This quiz is no longer available.')
    )

    const decodedError = decodeAppErrorFromIpc(
      new Error(`Error invoking remote method 'quizzes:get': Error: ${encodedError}\nstack text`)
    )

    expect(decodedError).toBeInstanceOf(AppError)
    expect(decodedError).toMatchObject({
      code: 'quiz_not_found',
      message: 'This quiz is no longer available.'
    })
  })

  it('converts unknown errors to a safe unexpected error message', () => {
    const encodedError = encodeAppErrorForIpc(new Error('database details'), 'Unable to load quiz.')
    const decodedError = decodeAppErrorFromIpc(new Error(encodedError))

    expect(decodedError).toMatchObject({
      code: 'unexpected',
      message: 'Unable to load quiz.'
    })
  })

  it('recognizes app errors structurally when prototypes are lost', () => {
    expect(isAppError({ code: 'validation_failed', message: 'Invalid input.' })).toBe(true)
  })
})
