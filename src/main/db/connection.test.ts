import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabaseConnection } from './connection'
import { migrations } from './migrations'

let connection: DatabaseSync

describe('database migrations', () => {
  beforeEach(() => {
    connection = createDatabaseConnection(':memory:')
  })

  afterEach(() => {
    connection.close()
  })

  it('records every migration in order', () => {
    const rows = connection
      .prepare('SELECT version, name FROM schema_migrations ORDER BY version ASC')
      .all() as unknown as Array<{ version: number; name: string }>

    expect(rows).toEqual(
      migrations.map((migration) => ({
        version: migration.version,
        name: migration.name
      }))
    )
  })

  it('creates expected tables, indexes, and triggers', () => {
    expect(listSchemaNames('table')).toEqual(
      expect.arrayContaining([
        'schema_migrations',
        'app_settings',
        'lessons',
        'lesson_text_extractions',
        'lesson_text_pages',
        'quizzes',
        'quiz_questions',
        'quiz_question_choices',
        'quiz_attempts',
        'quiz_attempt_answers'
      ])
    )
    expect(listSchemaNames('index')).toEqual(
      expect.arrayContaining([
        'quizzes_lesson_id_index',
        'quiz_questions_quiz_id_index',
        'quiz_question_choices_question_id_index',
        'quiz_question_choices_one_correct_per_question_index',
        'quiz_attempts_quiz_id_index',
        'quiz_attempt_answers_question_id_index',
        'quiz_attempt_answers_selected_choice_id_index'
      ])
    )
    expect(listSchemaNames('trigger')).toEqual(
      expect.arrayContaining([
        'quiz_attempt_answers_validate_insert',
        'quiz_attempt_answers_validate_update',
        'quiz_questions_prevent_answer_quiz_mismatch_update',
        'quiz_attempts_prevent_answer_quiz_mismatch_update'
      ])
    )
  })

  it('enables foreign key enforcement', () => {
    expect(getPragmaNumber('foreign_keys')).toBe(1)
  })

  it('rejects invalid core constraint data', () => {
    insertLesson('lesson-1')
    const quizId = insertQuiz('lesson-1')
    const questionId = insertQuestion(quizId)

    expect(() =>
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
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run('lesson-1', 'pending', '', 0, 0, 'test', '1')
    ).toThrow()

    expect(() => insertQuiz('lesson-1', 'unsupported')).toThrow()

    expect(() =>
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
        .run('invalid-size', 'Invalid', 'invalid.pdf', 'C:/invalid.pdf', 'invalid.pdf', 'hash', -1)
    ).toThrow()

    insertChoice(questionId, 'Correct answer', true, 0)
    expect(() => insertChoice(questionId, 'Second correct answer', true, 1)).toThrow()
  })
})

function listSchemaNames(type: 'table' | 'index' | 'trigger'): string[] {
  const rows = connection
    .prepare(
      `
        SELECT name
        FROM sqlite_schema
        WHERE type = ?
        ORDER BY name ASC
      `
    )
    .all(type) as unknown as Array<{ name: string }>

  return rows.map((row) => row.name)
}

function getPragmaNumber(name: string): number {
  const row = connection.prepare(`PRAGMA ${name}`).get() as Record<string, number> | undefined

  return row?.[name] ?? 0
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
    .run(id, 'Lesson', 'lesson.pdf', 'C:/lesson.pdf', `${id}.pdf`, `${id}-hash`, 123)
}

function insertQuiz(lessonId: string, difficulty = 'easy'): string {
  const id = `${lessonId}-${difficulty}-quiz`

  connection
    .prepare(
      `
        INSERT INTO quizzes (id, lesson_id, title, difficulty)
        VALUES (?, ?, ?, ?)
      `
    )
    .run(id, lessonId, 'Quiz', difficulty)

  return id
}

function insertQuestion(quizId: string): string {
  const id = `${quizId}-question`

  connection
    .prepare(
      `
        INSERT INTO quiz_questions (id, quiz_id, prompt, explanation, sort_order)
        VALUES (?, ?, ?, ?, ?)
      `
    )
    .run(id, quizId, 'Question?', 'Explanation.', 0)

  return id
}

function insertChoice(
  questionId: string,
  choiceText: string,
  isCorrect: boolean,
  sortOrder: number
): void {
  connection
    .prepare(
      `
        INSERT INTO quiz_question_choices (id, question_id, choice_text, is_correct, sort_order)
        VALUES (?, ?, ?, ?, ?)
      `
    )
    .run(`${questionId}-${sortOrder}`, questionId, choiceText, isCorrect ? 1 : 0, sortOrder)
}
