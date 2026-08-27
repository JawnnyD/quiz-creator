import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabaseConnection } from '../db/connection'
import { generateTemporaryQuizFromLessonTextFromDatabase } from './generator'

const openAiCreateMock = vi.hoisted(() => vi.fn())
const aiResponseMalformedMessage =
  'The AI returned a quiz format this app could not use. Try generating again.'

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(function OpenAI() {
    return {
      responses: {
        create: openAiCreateMock
      }
    }
  })
}))

let connection: DatabaseSync

describe('quiz generation error states', () => {
  beforeEach(() => {
    process.env['OPENAI_API_KEY'] = 'test-key'
    openAiCreateMock.mockReset()
    connection = createDatabaseConnection(':memory:')
  })

  afterEach(() => {
    connection.close()
    delete process.env['OPENAI_API_KEY']
  })

  it('rejects generation for a missing lesson', async () => {
    await expectAppError(
      generateTemporaryQuizFromLessonTextFromDatabase(connection, {
        lessonId: 'missing',
        settings: { questionCount: 2 }
      }),
      {
        code: 'lesson_not_found',
        message: 'This lesson is no longer available.'
      }
    )
    expect(openAiCreateMock).not.toHaveBeenCalled()
    expect(countRows('quizzes')).toBe(0)
  })

  it('distinguishes unavailable, failed, and empty extracted text', async () => {
    insertLesson('not-started')
    await expectAppError(
      generateTemporaryQuizFromLessonTextFromDatabase(connection, {
        lessonId: 'not-started',
        settings: { questionCount: 2 }
      }),
      {
        code: 'lesson_text_unavailable',
        message: 'Lesson text is not ready yet.'
      }
    )

    insertLesson('failed')
    insertTextExtraction('failed', 'failed', '', 'PDF text extraction failed')
    await expectAppError(
      generateTemporaryQuizFromLessonTextFromDatabase(connection, {
        lessonId: 'failed',
        settings: { questionCount: 2 }
      }),
      {
        code: 'lesson_text_extraction_failed',
        message: 'Quiz generation is unavailable because text extraction failed.'
      }
    )

    insertLesson('empty')
    insertTextExtraction('empty', 'completed', '')
    await expectAppError(
      generateTemporaryQuizFromLessonTextFromDatabase(connection, {
        lessonId: 'empty',
        settings: { questionCount: 2 }
      }),
      {
        code: 'lesson_text_empty',
        message: 'Quiz generation is unavailable because no selectable text was found.'
      }
    )
    expect(openAiCreateMock).not.toHaveBeenCalled()
    expect(countRows('quizzes')).toBe(0)
  })

  it('maps AI request failures to a safe generation error', async () => {
    insertLessonWithCompletedText('lesson-1')
    openAiCreateMock.mockRejectedValue(new Error('raw provider failure'))

    await expectAppError(
      generateTemporaryQuizFromLessonTextFromDatabase(connection, {
        lessonId: 'lesson-1',
        settings: { questionCount: 2 }
      }),
      {
        code: 'ai_generation_failed',
        message: 'Quiz generation failed. Check your connection and API key, then try again.'
      }
    )
    expect(countRows('quizzes')).toBe(0)
  })

  it.each([
    ['invalid JSON', '{not-json'],
    ['wrong question count', JSON.stringify(createGeneratedQuiz(1))],
    [
      'missing choices',
      JSON.stringify({
        title: 'Generated Quiz',
        questions: [
          {
            prompt: 'Question 1?',
            explanation: 'Explanation 1.'
          },
          createGeneratedQuestion(2)
        ]
      })
    ],
    [
      'duplicate prompts',
      JSON.stringify({
        title: 'Generated Quiz',
        questions: [
          createGeneratedQuestion(1, { prompt: 'Repeated prompt?' }),
          createGeneratedQuestion(2, { prompt: 'Repeated prompt?' })
        ]
      })
    ],
    [
      'multiple correct answers',
      JSON.stringify({
        title: 'Generated Quiz',
        questions: [
          createGeneratedQuestion(1, { correctChoiceIndexes: [0, 1] }),
          createGeneratedQuestion(2)
        ]
      })
    ]
  ])('rejects malformed AI responses: %s', async (_, outputText) => {
    insertLessonWithCompletedText('lesson-1')
    openAiCreateMock.mockResolvedValue({
      status: 'completed',
      output_text: outputText
    })

    await expectAppError(
      generateTemporaryQuizFromLessonTextFromDatabase(connection, {
        lessonId: 'lesson-1',
        settings: { questionCount: 2 }
      }),
      {
        code: 'ai_response_malformed',
        message: aiResponseMalformedMessage
      }
    )
    expect(countRows('quizzes')).toBe(0)
  })

  it('rejects incomplete AI responses without persisting a quiz', async () => {
    insertLessonWithCompletedText('lesson-1')
    openAiCreateMock.mockResolvedValue({
      status: 'incomplete',
      output_text: ''
    })

    await expectAppError(
      generateTemporaryQuizFromLessonTextFromDatabase(connection, {
        lessonId: 'lesson-1',
        settings: { questionCount: 2 }
      }),
      {
        code: 'ai_generation_failed',
        message: 'Quiz generation did not complete. Try again.'
      }
    )
    expect(countRows('quizzes')).toBe(0)
  })
})

function insertLessonWithCompletedText(id: string): void {
  insertLesson(id)
  insertTextExtraction(id, 'completed', 'The left ventricle pumps blood into the aorta.')
}

function insertLesson(id: string): void {
  connection
    .prepare(
      `
        INSERT INTO lessons (
          id,
          title,
          original_file_name,
          original_file_path,
          stored_relative_path,
          content_hash,
          size_bytes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      id,
      'Cardiology',
      'cardiology.pdf',
      'C:/lessons/cardiology.pdf',
      `${id}.pdf`,
      `${id}-hash`,
      123
    )
}

function insertTextExtraction(
  lessonId: string,
  status: 'completed' | 'failed',
  fullText: string,
  errorMessage: string | null = null
): void {
  connection
    .prepare(
      `
        INSERT INTO lesson_text_extractions (
          lesson_id,
          status,
          full_text,
          page_count,
          character_count,
          extractor_name,
          extractor_version,
          error_message
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(lessonId, status, fullText, 1, fullText.length, 'test', '1', errorMessage)
}

function createGeneratedQuiz(questionCount: number): unknown {
  return {
    title: 'Generated Quiz',
    questions: Array.from({ length: questionCount }, (_, index) =>
      createGeneratedQuestion(index + 1)
    )
  }
}

function createGeneratedQuestion(
  questionNumber: number,
  options: { prompt?: string; correctChoiceIndexes?: number[] } = {}
): unknown {
  const correctChoiceIndexes = options.correctChoiceIndexes ?? [0]

  return {
    prompt: options.prompt ?? `Question ${questionNumber}?`,
    explanation: `Explanation ${questionNumber}.`,
    choices: Array.from({ length: 5 }, (_, choiceIndex) => ({
      choiceText: `Question ${questionNumber} choice ${choiceIndex + 1}`,
      isCorrect: correctChoiceIndexes.includes(choiceIndex)
    }))
  }
}

function countRows(tableName: string): number {
  const row = connection.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as
    { count: number } | undefined

  return row?.count ?? 0
}

async function expectAppError(
  promise: Promise<unknown>,
  expectedError: { code: string; message: string }
): Promise<void> {
  let thrownError: unknown

  try {
    await promise
  } catch (error) {
    thrownError = error
  }

  expect(thrownError).toMatchObject(expectedError)
}
