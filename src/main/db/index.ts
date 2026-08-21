import { app } from 'electron'
import { mkdirSync } from 'fs'
import type { DatabaseSync } from 'node:sqlite'
import { join } from 'path'

import { createDatabaseConnection } from './connection'

export { createDatabaseConnection } from './connection'

const databaseFileName = 'quiz-creator.sqlite3'

let database: DatabaseSync | null = null

export function getDatabasePath(): string {
  return join(app.getPath('userData'), databaseFileName)
}

export function initializeDatabase(): DatabaseSync {
  if (database !== null) {
    return database
  }

  const userDataPath = app.getPath('userData')
  mkdirSync(userDataPath, { recursive: true })

  database = createDatabaseConnection(join(userDataPath, databaseFileName))
  return database
}

export function closeDatabase(): void {
  if (database === null) {
    return
  }

  database.close()
  database = null
}
