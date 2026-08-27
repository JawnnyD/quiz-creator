import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabaseConnection } from '../db/connection'
import { deleteLessonWithStorage } from '../lessons/service'
import {
  createQuizRecordFromDatabase,
  deleteQuizFromDatabase,
  listQuizAttemptsForLessonFromDatabase,
  loadFullQuizFromDatabase,
  loadQuizAttemptResultFromDatabase,
  saveQuizQuestionsFromDatabase,
  submitQuizAttemptFromDatabase,
  updateQuizTitleFromDatabase,
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

  it('grades and persists mixed correct and incorrect answers', () => {
    const { quiz, questions } = createStoredQuiz()
    const firstQuestion = questions[0]
    const secondQuestion = questions[1]
    const firstCorrectChoice = requireChoiceId(firstQuestion, true)
    const secondIncorrectChoice = requireChoiceId(secondQuestion, false)
    const result = submitQuizAttemptFromDatabase(connection, quiz.id, [
      {
        questionId: firstQuestion.id,
        selectedChoiceId: firstCorrectChoice
      },
      {
        questionId: secondQuestion.id,
        selectedChoiceId: secondIncorrectChoice
      }
    ])

    expect(result.quiz).toEqual(quiz)
    expect(result.attempt).toMatchObject({
      quizId: quiz.id,
      completedAt: expect.any(String),
      correctAnswerCount: 1,
      totalQuestionCount: 2
    })
    expect(result.answers).toHaveLength(2)
    expect(result.answers.map((answer) => answer.question.id)).toEqual([
      firstQuestion.id,
      secondQuestion.id
    ])
    expect(result.answers.map((answer) => answer.selectedChoiceId)).toEqual([
      firstCorrectChoice,
      secondIncorrectChoice
    ])
    expect(result.answers.map((answer) => answer.isCorrect)).toEqual([true, false])
    expect(countRows('quiz_attempts')).toBe(1)
    expect(countRows('quiz_attempt_answers')).toBe(2)
    expect(loadQuizAttemptResultFromDatabase(connection, result.attempt.id)).toEqual(result)
  })

  it('edits a quiz title and trims user input', () => {
    const { quiz } = createStoredQuiz()

    const updatedQuiz = updateQuizTitleFromDatabase(connection, quiz.id, '  Cardiology Blocks  ')

    expect(updatedQuiz).toMatchObject({
      id: quiz.id,
      lessonId: quiz.lessonId,
      title: 'Cardiology Blocks',
      difficulty: 'easy',
      questionCount: 2
    })
    expect(loadFullQuizFromDatabase(connection, quiz.id)?.quiz.title).toBe('Cardiology Blocks')
  })

  it('lists completed attempt history for the requested lesson', () => {
    const { quiz, questions } = createStoredQuiz()
    const otherQuiz = createStoredQuiz({ lessonId: 'lesson-2', title: 'Renal Quiz' })
    const result = submitQuizAttemptFromDatabase(connection, quiz.id, [
      {
        questionId: questions[0].id,
        selectedChoiceId: requireChoiceId(questions[0], true)
      },
      {
        questionId: questions[1].id,
        selectedChoiceId: requireChoiceId(questions[1], false)
      }
    ])
    submitQuizAttemptFromDatabase(connection, otherQuiz.quiz.id, [
      {
        questionId: otherQuiz.questions[0].id,
        selectedChoiceId: requireChoiceId(otherQuiz.questions[0], true)
      },
      {
        questionId: otherQuiz.questions[1].id,
        selectedChoiceId: requireChoiceId(otherQuiz.questions[1], true)
      }
    ])

    expect(listQuizAttemptsForLessonFromDatabase(connection, 'lesson-1')).toEqual([result.attempt])
  })

  it('retaking a quiz creates separate saved attempts', () => {
    const { quiz, questions } = createStoredQuiz()
    const firstAttempt = submitQuizAttemptFromDatabase(connection, quiz.id, [
      {
        questionId: questions[0].id,
        selectedChoiceId: requireChoiceId(questions[0], true)
      },
      {
        questionId: questions[1].id,
        selectedChoiceId: requireChoiceId(questions[1], false)
      }
    ])
    const secondAttempt = submitQuizAttemptFromDatabase(connection, quiz.id, [
      {
        questionId: questions[0].id,
        selectedChoiceId: requireChoiceId(questions[0], false)
      },
      {
        questionId: questions[1].id,
        selectedChoiceId: requireChoiceId(questions[1], true)
      }
    ])

    expect(secondAttempt.attempt.id).not.toBe(firstAttempt.attempt.id)
    expect(countRows('quiz_attempts')).toBe(2)
    expect(countRows('quiz_attempt_answers')).toBe(4)
    expect(listQuizAttemptsForLessonFromDatabase(connection, 'lesson-1')).toEqual(
      expect.arrayContaining([firstAttempt.attempt, secondAttempt.attempt])
    )
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

  it('deleting a lesson cascades text, quizzes, questions, choices, attempts, and answers', () => {
    const { quiz, questions } = createStoredQuiz()
    insertLessonText('lesson-1')
    const result = submitQuizAttemptFromDatabase(connection, quiz.id, [
      {
        questionId: questions[0].id,
        selectedChoiceId: requireChoiceId(questions[0], true)
      },
      {
        questionId: questions[1].id,
        selectedChoiceId: requireChoiceId(questions[1], false)
      }
    ])

    expect(countRows('lessons')).toBe(1)
    expect(countRows('lesson_text_extractions')).toBe(1)
    expect(countRows('lesson_text_pages')).toBe(1)
    expect(countRows('quizzes')).toBe(1)
    expect(countRows('quiz_questions')).toBe(2)
    expect(countRows('quiz_question_choices')).toBe(10)
    expect(countRows('quiz_attempts')).toBe(1)
    expect(countRows('quiz_attempt_answers')).toBe(2)

    expect(deleteLessonWithStorage(connection, 'C:/quiz-creator-test-storage', 'lesson-1')).toEqual(
      {
        deleted: true,
        fileDeleted: false,
        cleanupError: null
      }
    )
    expect(loadFullQuizFromDatabase(connection, quiz.id)).toBeNull()
    expect(loadQuizAttemptResultFromDatabase(connection, result.attempt.id)).toBeNull()
    expect(countRows('lessons')).toBe(0)
    expect(countRows('lesson_text_extractions')).toBe(0)
    expect(countRows('lesson_text_pages')).toBe(0)
    expect(countRows('quizzes')).toBe(0)
    expect(countRows('quiz_questions')).toBe(0)
    expect(countRows('quiz_question_choices')).toBe(0)
    expect(countRows('quiz_attempts')).toBe(0)
    expect(countRows('quiz_attempt_answers')).toBe(0)
    expect(deleteLessonWithStorage(connection, 'C:/quiz-creator-test-storage', 'lesson-1')).toEqual(
      {
        deleted: false,
        fileDeleted: false,
        cleanupError: null
      }
    )
  })
})

function createStoredQuiz(
  options: { lessonId?: string; title?: string } = {}
): NonNullable<ReturnType<typeof loadFullQuizFromDatabase>> {
  const lessonId = options.lessonId ?? 'lesson-1'

  insertLesson(lessonId)

  const quiz = createQuizRecordFromDatabase(connection, {
    lessonId,
    title: options.title ?? 'Cardiology Quiz',
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
      `lesson-pdfs/${id}.pdf`,
      `${id}-hash`,
      123
    )
}

function insertLessonText(lessonId: string): void {
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
          extractor_version
        )
        VALUES (?, 'completed', ?, ?, ?, ?, ?)
      `
    )
    .run(lessonId, 'Cardiac physiology text.', 1, 24, 'test', '1')

  connection
    .prepare(
      `
        INSERT INTO lesson_text_pages (lesson_id, page_number, text, character_count)
        VALUES (?, ?, ?, ?)
      `
    )
    .run(lessonId, 1, 'Cardiac physiology text.', 24)
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
