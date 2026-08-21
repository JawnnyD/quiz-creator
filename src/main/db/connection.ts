import { DatabaseSync } from 'node:sqlite'

import { type Migration, migrations } from './migrations'

interface MigrationRow {
  version: number
}

export function createDatabaseConnection(databasePath: string): DatabaseSync {
  const connection = new DatabaseSync(databasePath)

  try {
    configureDatabase(connection)
    runMigrations(connection)
  } catch (error) {
    connection.close()
    throw error
  }

  return connection
}

function configureDatabase(connection: DatabaseSync): void {
  connection.exec('PRAGMA foreign_keys = ON')
  connection.exec('PRAGMA journal_mode = WAL')
  connection.exec('PRAGMA busy_timeout = 5000')
}

function runMigrations(connection: DatabaseSync): void {
  validateMigrations(migrations)

  connection.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;
  `)

  const appliedRows = connection
    .prepare('SELECT version FROM schema_migrations')
    .all() as unknown as MigrationRow[]
  const appliedVersions = new Set(appliedRows.map((row) => row.version))

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) {
      continue
    }

    applyMigration(connection, migration)
    appliedVersions.add(migration.version)
  }
}

function validateMigrations(migrationList: readonly Migration[]): void {
  let previousVersion = 0

  for (const migration of migrationList) {
    if (migration.version <= previousVersion) {
      throw new Error('Database migrations must be ordered by ascending version')
    }

    previousVersion = migration.version
  }
}

function applyMigration(connection: DatabaseSync, migration: Migration): void {
  try {
    connection.exec('BEGIN IMMEDIATE')
    connection.exec(migration.sql)
    connection
      .prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)')
      .run(migration.version, migration.name)
    connection.exec('COMMIT')
  } catch (error) {
    try {
      connection.exec('ROLLBACK')
    } catch {
      // Ignore rollback failures so the original migration error is reported.
    }

    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Failed to apply database migration ${migration.version}_${migration.name}: ${message}`
    )
  }
}
