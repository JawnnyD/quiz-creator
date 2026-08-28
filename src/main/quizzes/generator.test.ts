import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { QuizDifficulty } from '../../shared/quizzes'
import { createDatabaseConnection } from '../db/connection'
import {
  openAiApiKeyEnvironmentVariableName,
  saveOpenAiApiKeyToDatabase,
  type SecureStorageAdapter
} from '../settings/service'
import { loadFullQuizFromDatabase } from './service'
import { generateTemporaryQuizFromLessonTextFromDatabase } from './generator'

const openAiCreateMock = vi.hoisted(() => vi.fn())
const openAiConstructorMock = vi.hoisted(() => vi.fn())
const aiResponseMalformedMessage =
  'The AI returned a quiz format this app could not use. Try generating again.'
const missingOpenAiApiKeyMessage = 'Add an OpenAI API key in Settings before generating a quiz.'
const difficultyGenerationCases: Array<{
  difficulty: QuizDifficulty
  expectedModel: string
  expectedInstructionsText: string
  customDifficultyInstructions?: string
}> = [
  {
    difficulty: 'easy',
    expectedModel: 'gpt-5.6-luna',
    expectedInstructionsText: 'Difficulty: Easy'
  },
  {
    difficulty: 'nbme',
    expectedModel: 'gpt-5.6-terra',
    expectedInstructionsText: 'Difficulty: NBME'
  },
  {
    difficulty: 'custom',
    expectedModel: 'gpt-5.6-luna',
    expectedInstructionsText: 'User custom instructions:',
    customDifficultyInstructions: 'Focus on pharmacology mechanisms.'
  }
]

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(function OpenAI(options: { apiKey?: string }) {
    openAiConstructorMock(options)

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
    process.env[openAiApiKeyEnvironmentVariableName] = 'test-key'
    openAiCreateMock.mockReset()
    openAiConstructorMock.mockReset()
    connection = createDatabaseConnection(':memory:')
  })

  afterEach(() => {
    connection.close()
    delete process.env[openAiApiKeyEnvironmentVariableName]
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

  it('uses the saved API key when one is available', async () => {
    const secureStorage = createFakeSecureStorage()
    insertLessonWithCompletedText('lesson-1')
    process.env[openAiApiKeyEnvironmentVariableName] = 'sk-test-env-key-9999'
    saveOpenAiApiKeyToDatabase(connection, secureStorage, 'sk-test-saved-key-1234')
    openAiCreateMock.mockResolvedValue({
      status: 'completed',
      output_text: JSON.stringify(createGeneratedQuiz(1))
    })

    await generateTemporaryQuizFromLessonTextFromDatabase(
      connection,
      {
        lessonId: 'lesson-1',
        settings: { questionCount: 1 }
      },
      secureStorage
    )

    expect(openAiConstructorMock).toHaveBeenCalledWith({ apiKey: 'sk-test-saved-key-1234' })
    expect(openAiCreateMock).toHaveBeenCalledTimes(1)
  })

  it('rejects generation with a friendly error when no API key is configured', async () => {
    delete process.env[openAiApiKeyEnvironmentVariableName]
    insertLessonWithCompletedText('lesson-1')

    await expectAppError(
      generateTemporaryQuizFromLessonTextFromDatabase(connection, {
        lessonId: 'lesson-1',
        settings: { questionCount: 1 }
      }),
      {
        code: 'ai_generation_failed',
        message: missingOpenAiApiKeyMessage
      }
    )
    expect(openAiConstructorMock).not.toHaveBeenCalled()
    expect(openAiCreateMock).not.toHaveBeenCalled()
    expect(countRows('quizzes')).toBe(0)
  })

  it('recreates the OpenAI client when the saved API key changes', async () => {
    const secureStorage = createFakeSecureStorage()
    insertLessonWithCompletedText('lesson-1')
    openAiCreateMock.mockResolvedValue({
      status: 'completed',
      output_text: JSON.stringify(createGeneratedQuiz(1))
    })

    saveOpenAiApiKeyToDatabase(connection, secureStorage, 'sk-test-first-key-1111')
    await generateTemporaryQuizFromLessonTextFromDatabase(
      connection,
      {
        lessonId: 'lesson-1',
        settings: { questionCount: 1 }
      },
      secureStorage
    )

    saveOpenAiApiKeyToDatabase(connection, secureStorage, 'sk-test-second-key-2222')
    await generateTemporaryQuizFromLessonTextFromDatabase(
      connection,
      {
        lessonId: 'lesson-1',
        settings: { questionCount: 1 }
      },
      secureStorage
    )

    expect(openAiConstructorMock.mock.calls.map(([options]) => options)).toEqual([
      { apiKey: 'sk-test-first-key-1111' },
      { apiKey: 'sk-test-second-key-2222' }
    ])
    expect(openAiCreateMock).toHaveBeenCalledTimes(2)
  })

  it('persists valid generated quiz data', async () => {
    insertLessonWithCompletedText('lesson-1')
    openAiCreateMock.mockResolvedValue({
      status: 'completed',
      output_text: JSON.stringify({
        title: ' Generated Quiz ',
        questions: [
          createGeneratedQuestion(1, { wrapWhitespace: true }),
          createGeneratedQuestion(2, { wrapWhitespace: true })
        ]
      })
    })

    const generatedQuiz = await generateTemporaryQuizFromLessonTextFromDatabase(connection, {
      lessonId: 'lesson-1',
      settings: {
        questionCount: 2,
        difficulty: 'easy'
      }
    })

    expect(generatedQuiz.quiz).toMatchObject({
      lessonId: 'lesson-1',
      title: 'Generated Quiz',
      difficulty: 'easy',
      questionCount: 2
    })
    expect(generatedQuiz.questions).toHaveLength(2)
    expect(countRows('quizzes')).toBe(1)
    expect(countRows('quiz_questions')).toBe(2)
    expect(countRows('quiz_question_choices')).toBe(10)
    expect(loadFullQuizFromDatabase(connection, generatedQuiz.quiz.id)).toEqual(generatedQuiz)

    for (const question of generatedQuiz.questions) {
      expect(question.prompt).toBe(question.prompt.trim())
      expect(question.prompt.length).toBeGreaterThan(0)
      expect(question.explanation).not.toBeNull()
      expect(question.explanation).toBe(question.explanation?.trim())
      expect(question.explanation?.length).toBeGreaterThan(0)
      expect(question.choices).toHaveLength(5)
      expect(question.choices.filter((choice) => choice.isCorrect)).toHaveLength(1)

      for (const choice of question.choices) {
        expect(choice.choiceText).toBe(choice.choiceText.trim())
        expect(choice.choiceText.length).toBeGreaterThan(0)
      }
    }
  })

  it.each(difficultyGenerationCases)(
    'generates and stores valid quizzes for $difficulty difficulty',
    async ({
      difficulty,
      expectedModel,
      expectedInstructionsText,
      customDifficultyInstructions
    }) => {
      insertLessonWithCompletedText(`lesson-${difficulty}`)
      openAiCreateMock.mockResolvedValue({
        status: 'completed',
        output_text: JSON.stringify(createGeneratedQuiz(1))
      })

      const generatedQuiz = await generateTemporaryQuizFromLessonTextFromDatabase(connection, {
        lessonId: `lesson-${difficulty}`,
        settings: {
          questionCount: 1,
          difficulty,
          customDifficultyInstructions
        }
      })

      expect(generatedQuiz.quiz).toMatchObject({
        lessonId: `lesson-${difficulty}`,
        difficulty,
        questionCount: 1
      })
      expect(generatedQuiz.questions).toHaveLength(1)
      expect(generatedQuiz.questions[0]?.choices).toHaveLength(5)
      expect(generatedQuiz.questions[0]?.choices.filter((choice) => choice.isCorrect)).toHaveLength(
        1
      )
      expect(countRows('quizzes')).toBe(1)
      expect(loadFullQuizFromDatabase(connection, generatedQuiz.quiz.id)).toEqual(generatedQuiz)
      expect(openAiCreateMock).toHaveBeenCalledTimes(1)

      const firstCall = openAiCreateMock.mock.calls[0]

      if (firstCall === undefined) {
        throw new Error('Expected OpenAI to be called')
      }

      const request = firstCall[0] as { model: string; instructions: string; input: string }

      expect(request.model).toBe(expectedModel)
      expect(request.instructions).toContain(expectedInstructionsText)
      expect(request.input).toContain(`- Difficulty: ${difficulty}`)

      if (customDifficultyInstructions !== undefined) {
        expect(request.instructions).toContain(customDifficultyInstructions)
      }
    }
  )

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
  options: { prompt?: string; correctChoiceIndexes?: number[]; wrapWhitespace?: boolean } = {}
): unknown {
  const correctChoiceIndexes = options.correctChoiceIndexes ?? [0]
  const prompt = options.prompt ?? `Question ${questionNumber}?`
  const explanation = `Explanation ${questionNumber}.`

  return {
    prompt: options.wrapWhitespace === true ? ` ${prompt} ` : prompt,
    explanation: options.wrapWhitespace === true ? ` ${explanation} ` : explanation,
    choices: Array.from({ length: 5 }, (_, choiceIndex) => ({
      choiceText:
        options.wrapWhitespace === true
          ? ` Question ${questionNumber} choice ${choiceIndex + 1} `
          : `Question ${questionNumber} choice ${choiceIndex + 1}`,
      isCorrect: correctChoiceIndexes.includes(choiceIndex)
    }))
  }
}

function countRows(tableName: string): number {
  const row = connection.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as
    { count: number } | undefined

  return row?.count ?? 0
}

function createFakeSecureStorage(): SecureStorageAdapter {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plainText: string) => Buffer.from(`encrypted:${plainText}`, 'utf8'),
    decryptString: (encryptedValue: Buffer) =>
      encryptedValue.toString('utf8').replace(/^encrypted:/, '')
  }
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
