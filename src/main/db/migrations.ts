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
  }
]
