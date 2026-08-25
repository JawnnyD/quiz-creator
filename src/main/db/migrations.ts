export interface Migration {
  version: number
  name: string
  sql: string
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'create_app_settings',
    sql: `
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) STRICT;
    `
  },
  {
    version: 2,
    name: 'create_lessons',
    sql: `
      CREATE TABLE IF NOT EXISTS lessons (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        original_file_name TEXT NOT NULL,
        original_file_path TEXT NOT NULL,
        stored_relative_path TEXT NOT NULL UNIQUE,
        content_hash TEXT NOT NULL UNIQUE,
        size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) STRICT;
    `
  },
  {
    version: 3,
    name: 'create_lesson_text_extractions',
    sql: `
      CREATE TABLE IF NOT EXISTS lesson_text_extractions (
        lesson_id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
        full_text TEXT NOT NULL DEFAULT '',
        page_count INTEGER NOT NULL DEFAULT 0 CHECK (page_count >= 0),
        character_count INTEGER NOT NULL DEFAULT 0 CHECK (character_count >= 0),
        extractor_name TEXT NOT NULL,
        extractor_version TEXT NOT NULL,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE IF NOT EXISTS lesson_text_pages (
        lesson_id TEXT NOT NULL,
        page_number INTEGER NOT NULL CHECK (page_number > 0),
        text TEXT NOT NULL DEFAULT '',
        character_count INTEGER NOT NULL DEFAULT 0 CHECK (character_count >= 0),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (lesson_id, page_number),
        FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
      ) STRICT;
    `
  },
  {
    version: 4,
    name: 'create_quiz_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS quizzes (
        id TEXT PRIMARY KEY,
        lesson_id TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE IF NOT EXISTS quiz_questions (
        id TEXT PRIMARY KEY,
        quiz_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        explanation TEXT,
        sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (quiz_id, sort_order),
        FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE IF NOT EXISTS quiz_question_choices (
        id TEXT PRIMARY KEY,
        question_id TEXT NOT NULL,
        choice_text TEXT NOT NULL,
        is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
        sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (question_id, sort_order),
        FOREIGN KEY (question_id) REFERENCES quiz_questions(id) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE IF NOT EXISTS quiz_attempts (
        id TEXT PRIMARY KEY,
        quiz_id TEXT NOT NULL,
        started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT,
        correct_answer_count INTEGER NOT NULL DEFAULT 0 CHECK (correct_answer_count >= 0),
        total_question_count INTEGER NOT NULL CHECK (total_question_count >= 0),
        CHECK (correct_answer_count <= total_question_count),
        FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE IF NOT EXISTS quiz_attempt_answers (
        attempt_id TEXT NOT NULL,
        question_id TEXT NOT NULL,
        selected_choice_id TEXT,
        is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
        answered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (attempt_id, question_id),
        FOREIGN KEY (attempt_id) REFERENCES quiz_attempts(id) ON DELETE CASCADE,
        FOREIGN KEY (question_id) REFERENCES quiz_questions(id) ON DELETE CASCADE,
        FOREIGN KEY (selected_choice_id) REFERENCES quiz_question_choices(id) ON DELETE SET NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS quizzes_lesson_id_index
        ON quizzes(lesson_id);

      CREATE INDEX IF NOT EXISTS quiz_questions_quiz_id_index
        ON quiz_questions(quiz_id);

      CREATE INDEX IF NOT EXISTS quiz_question_choices_question_id_index
        ON quiz_question_choices(question_id);

      CREATE UNIQUE INDEX IF NOT EXISTS quiz_question_choices_one_correct_per_question_index
        ON quiz_question_choices(question_id)
        WHERE is_correct = 1;

      CREATE INDEX IF NOT EXISTS quiz_attempts_quiz_id_index
        ON quiz_attempts(quiz_id);

      CREATE INDEX IF NOT EXISTS quiz_attempt_answers_question_id_index
        ON quiz_attempt_answers(question_id);

      CREATE INDEX IF NOT EXISTS quiz_attempt_answers_selected_choice_id_index
        ON quiz_attempt_answers(selected_choice_id);

      CREATE TRIGGER IF NOT EXISTS quiz_attempt_answers_validate_insert
      BEFORE INSERT ON quiz_attempt_answers
      FOR EACH ROW
      BEGIN
        SELECT RAISE(ABORT, 'Quiz attempt answer question does not belong to attempted quiz')
        WHERE NOT EXISTS (
          SELECT 1
          FROM quiz_attempts
          INNER JOIN quiz_questions ON quiz_questions.id = NEW.question_id
          WHERE quiz_attempts.id = NEW.attempt_id
            AND quiz_questions.quiz_id = quiz_attempts.quiz_id
        );

        SELECT RAISE(ABORT, 'Selected quiz choice does not belong to answer question')
        WHERE NEW.selected_choice_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM quiz_question_choices
            WHERE quiz_question_choices.id = NEW.selected_choice_id
              AND quiz_question_choices.question_id = NEW.question_id
          );
      END;

      CREATE TRIGGER IF NOT EXISTS quiz_attempt_answers_validate_update
      BEFORE UPDATE ON quiz_attempt_answers
      FOR EACH ROW
      BEGIN
        SELECT RAISE(ABORT, 'Quiz attempt answer question does not belong to attempted quiz')
        WHERE NOT EXISTS (
          SELECT 1
          FROM quiz_attempts
          INNER JOIN quiz_questions ON quiz_questions.id = NEW.question_id
          WHERE quiz_attempts.id = NEW.attempt_id
            AND quiz_questions.quiz_id = quiz_attempts.quiz_id
        );

        SELECT RAISE(ABORT, 'Selected quiz choice does not belong to answer question')
        WHERE NEW.selected_choice_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM quiz_question_choices
            WHERE quiz_question_choices.id = NEW.selected_choice_id
              AND quiz_question_choices.question_id = NEW.question_id
          );
      END;

      CREATE TRIGGER IF NOT EXISTS quiz_questions_prevent_answer_quiz_mismatch_update
      BEFORE UPDATE OF quiz_id ON quiz_questions
      FOR EACH ROW
      BEGIN
        SELECT RAISE(ABORT, 'Cannot move answered question to a different quiz')
        WHERE EXISTS (
          SELECT 1
          FROM quiz_attempt_answers
          INNER JOIN quiz_attempts ON quiz_attempts.id = quiz_attempt_answers.attempt_id
          WHERE quiz_attempt_answers.question_id = OLD.id
            AND quiz_attempts.quiz_id != NEW.quiz_id
        );
      END;

      CREATE TRIGGER IF NOT EXISTS quiz_attempts_prevent_answer_quiz_mismatch_update
      BEFORE UPDATE OF quiz_id ON quiz_attempts
      FOR EACH ROW
      BEGIN
        SELECT RAISE(ABORT, 'Cannot move answered attempt to a different quiz')
        WHERE EXISTS (
          SELECT 1
          FROM quiz_attempt_answers
          INNER JOIN quiz_questions ON quiz_questions.id = quiz_attempt_answers.question_id
          WHERE quiz_attempt_answers.attempt_id = OLD.id
            AND quiz_questions.quiz_id != NEW.quiz_id
        );
      END;
    `
  },
  {
    version: 5,
    name: 'add_quiz_difficulty',
    sql: `
      ALTER TABLE quizzes
        ADD COLUMN difficulty TEXT CHECK (difficulty IN ('easy', 'nbme', 'custom'));
    `
  }
]
