import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabaseConnection } from '../db/connection'
import {
  createQuizRecordFromDatabase,
  deleteQuizFromDatabase,
  loadFullQuizFromDatabase,
  loadQuizAttemptResultFromDatabase,
  saveQuizQuestionsFromDatabase,
  submitQuizAttemptFromDatabase,
  type SaveQuizQuestionInput
} from './service'

let connection: DatabaseSync

describe('quiz service validation and deletion', () => {
  beforeEach(() => {
    connection = createDatabaseConnection(':memory:')
  })

  afterEach(() => {
    connection.close()
  })

  it('rejects incomplete attempt submissions and does not create an attempt', () => {
    const { quiz, questions } = createStoredQuiz()
    const firstQuestion = questions[0]
    const firstCorrectChoice = requireChoiceId(firstQuestion, true)

    expectAppError(
      () =>
        submitQuizAttemptFromDatabase(connection, quiz.id, [
          {
            questionId: firstQuestion.id,
            selectedChoiceId: firstCorrectChoice
          }
        ]),
      {
        code: 'quiz_incomplete_submission',
        message: 'Answer every question before submitting. 1 remaining.'
      }
    )
    expect(countRows('quiz_attempts')).toBe(0)
  })

  it('rejects malformed answer submissions', () => {
    const { quiz, questions } = createStoredQuiz()
    const firstQuestion = questions[0]
    const secondQuestion = questions[1]
    const firstCorrectChoice = requireChoiceId(firstQuestion, true)
    const secondCorrectChoice = requireChoiceId(secondQuestion, true)

    expectAppError(
      () =>
        submitQuizAttemptFromDatabase(connection, quiz.id, [
          { questionId: firstQuestion.id, selectedChoiceId: firstCorrectChoice },
          { questionId: 'missing-question', selectedChoiceId: secondCorrectChoice }
        ]),
      {
        code: 'validation_failed',
        message: 'Submitted answers include an unknown question.'
      }
    )

    expectAppError(
      () =>
        submitQuizAttemptFromDatabase(connection, quiz.id, [
          { questionId: firstQuestion.id, selectedChoiceId: firstCorrectChoice },
          { questionId: firstQuestion.id, selectedChoiceId: firstCorrectChoice }
        ]),
      {
        code: 'validation_failed',
        message: 'Submitted answers include a duplicate question.'
      }
    )

    expectAppError(
      () =>
        submitQuizAttemptFromDatabase(connection, quiz.id, [
          { questionId: firstQuestion.id, selectedChoiceId: secondCorrectChoice },
          { questionId: secondQuestion.id, selectedChoiceId: secondCorrectChoice }
        ]),
      {
        code: 'validation_failed',
        message: 'Selected answers do not match this quiz.'
      }
    )
    expect(countRows('quiz_attempts')).toBe(0)
  })

  it('deletes quizzes idempotently and cascades child records', () => {
    const { quiz, questions } = createStoredQuiz()
    const result = submitQuizAttemptFromDatabase(connection, quiz.id, [
      {
        questionId: questions[0].id,
        selectedChoiceId: requireChoiceId(questions[0], true)
      },
      {
        questionId: questions[1].id,
        selectedChoiceId: requireChoiceId(questions[1], true)
      }
    ])

    expect(countRows('quizzes')).toBe(1)
    expect(countRows('quiz_questions')).toBe(2)
    expect(countRows('quiz_question_choices')).toBe(10)
    expect(countRows('quiz_attempts')).toBe(1)
    expect(countRows('quiz_attempt_answers')).toBe(2)

    expect(deleteQuizFromDatabase(connection, quiz.id)).toEqual({ deleted: true })
    expect(loadFullQuizFromDatabase(connection, quiz.id)).toBeNull()
    expect(loadQuizAttemptResultFromDatabase(connection, result.attempt.id)).toBeNull()
    expect(countRows('quizzes')).toBe(0)
    expect(countRows('quiz_questions')).toBe(0)
    expect(countRows('quiz_question_choices')).toBe(0)
    expect(countRows('quiz_attempts')).toBe(0)
    expect(countRows('quiz_attempt_answers')).toBe(0)
    expect(deleteQuizFromDatabase(connection, quiz.id)).toEqual({ deleted: false })
  })
})

function createStoredQuiz(): NonNullable<ReturnType<typeof loadFullQuizFromDatabase>> {
  insertLesson('lesson-1')

  const quiz = createQuizRecordFromDatabase(connection, {
    lessonId: 'lesson-1',
    title: 'Cardiology Quiz',
    difficulty: 'easy'
  })

  saveQuizQuestionsFromDatabase(connection, {
    quizId: quiz.id,
    questions: createQuestionInputs()
  })

  const fullQuiz = loadFullQuizFromDatabase(connection, quiz.id)

  if (fullQuiz === null) {
    throw new Error('Test quiz was not created')
  }

  return fullQuiz
}

function createQuestionInputs(): SaveQuizQuestionInput[] {
  return [
    {
      prompt: 'Which chamber pumps blood to the systemic circulation?',
      explanation: 'The left ventricle pumps oxygenated blood through the aorta.',
      choices: [
        { choiceText: 'Left ventricle', isCorrect: true },
        { choiceText: 'Right ventricle', isCorrect: false },
        { choiceText: 'Left atrium', isCorrect: false },
        { choiceText: 'Right atrium', isCorrect: false },
        { choiceText: 'Coronary sinus', isCorrect: false }
      ]
    },
    {
      prompt: 'Which valve separates the left atrium from the left ventricle?',
      explanation: 'The mitral valve sits between the left atrium and left ventricle.',
      choices: [
        { choiceText: 'Aortic valve', isCorrect: false },
        { choiceText: 'Mitral valve', isCorrect: true },
        { choiceText: 'Pulmonary valve', isCorrect: false },
        { choiceText: 'Tricuspid valve', isCorrect: false },
        { choiceText: 'Eustachian valve', isCorrect: false }
      ]
    }
  ]
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

function countRows(tableName: string): number {
  const row = connection.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as
    { count: number } | undefined

  return row?.count ?? 0
}

function requireChoiceId(
  question: NonNullable<ReturnType<typeof loadFullQuizFromDatabase>>['questions'][number],
  isCorrect: boolean
): string {
  const choice = question.choices.find((candidateChoice) => candidateChoice.isCorrect === isCorrect)

  if (choice === undefined) {
    throw new Error('Expected test choice was not found')
  }

  return choice.id
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
