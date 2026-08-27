import 'dotenv/config'
import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { encodeAppErrorForIpc } from '../shared/errors'
import { closeDatabase, initializeDatabase } from './db'
import {
  deleteLesson,
  importLessonPdf,
  listLessons,
  updateLessonTitle,
  type DeleteLessonResult,
  type LessonRecord
} from './lessons'
import {
  deleteQuiz,
  generateTemporaryQuizFromLessonText,
  listQuizAttemptsForLesson,
  listQuizzesForLesson,
  loadFullQuiz,
  loadQuizAttemptResult,
  submitQuizAttempt,
  updateQuizTitle,
  type FullQuiz,
  type GenerateTemporaryQuizInput,
  type DeleteQuizResult,
  type QuizAnswerSubmission,
  type QuizAttempt,
  type QuizRecord,
  type QuizResult
} from './quizzes'

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createIpcError(error: unknown, fallbackMessage: string): Error {
  return new Error(encodeAppErrorForIpc(error, fallbackMessage))
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  try {
    initializeDatabase()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    dialog.showErrorBox(
      'Database Error',
      `Quiz Creator could not initialize its local database.\n\n${message}`
    )
    app.quit()
    return
  }

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('lessons:importPdf', async (): Promise<LessonRecord | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'PDF files', extensions: ['pdf'] }]
    })

    if (result.canceled) {
      return null
    }

    const selectedPdfPath = result.filePaths[0]

    if (selectedPdfPath === undefined) {
      return null
    }

    try {
      return await importLessonPdf(selectedPdfPath)
    } catch (error) {
      throw createIpcError(error, 'Unable to import lesson PDF.')
    }
  })

  ipcMain.handle('lessons:list', (): LessonRecord[] => {
    try {
      return listLessons()
    } catch (error) {
      throw createIpcError(error, 'Unable to load lessons.')
    }
  })

  ipcMain.handle('lessons:updateTitle', (_, lessonId: string, title: string): LessonRecord => {
    try {
      return updateLessonTitle(lessonId, title)
    } catch (error) {
      throw createIpcError(error, 'Unable to update lesson title.')
    }
  })

  ipcMain.handle('lessons:delete', (_, lessonId: string): DeleteLessonResult => {
    try {
      return deleteLesson(lessonId)
    } catch (error) {
      throw createIpcError(error, 'Unable to delete lesson.')
    }
  })

  ipcMain.handle(
    'quizzes:create',
    async (_, input: GenerateTemporaryQuizInput): Promise<FullQuiz> => {
      try {
        return await generateTemporaryQuizFromLessonText(input)
      } catch (error) {
        throw createIpcError(error, 'Unable to create quiz.')
      }
    }
  )

  ipcMain.handle('quizzes:listForLesson', (_, lessonId: string): QuizRecord[] => {
    try {
      return listQuizzesForLesson(lessonId)
    } catch (error) {
      throw createIpcError(error, 'Unable to load quizzes.')
    }
  })

  ipcMain.handle('quizzes:updateTitle', (_, quizId: string, title: string): QuizRecord => {
    try {
      return updateQuizTitle(quizId, title)
    } catch (error) {
      throw createIpcError(error, 'Unable to update quiz title.')
    }
  })

  ipcMain.handle('quizzes:delete', (_, quizId: string): DeleteQuizResult => {
    try {
      return deleteQuiz(quizId)
    } catch (error) {
      throw createIpcError(error, 'Unable to delete quiz.')
    }
  })

  ipcMain.handle('quizzes:listAttemptsForLesson', (_, lessonId: string): QuizAttempt[] => {
    try {
      return listQuizAttemptsForLesson(lessonId)
    } catch (error) {
      throw createIpcError(error, 'Unable to load quiz attempts.')
    }
  })

  ipcMain.handle('quizzes:get', (_, quizId: string): FullQuiz | null => {
    try {
      return loadFullQuiz(quizId)
    } catch (error) {
      throw createIpcError(error, 'Unable to load quiz.')
    }
  })

  ipcMain.handle('quizzes:getAttemptResult', (_, attemptId: string): QuizResult | null => {
    try {
      return loadQuizAttemptResult(attemptId)
    } catch (error) {
      throw createIpcError(error, 'Unable to load quiz attempt.')
    }
  })

  ipcMain.handle(
    'quizzes:submitAttempt',
    (_, quizId: string, answers: QuizAnswerSubmission[]): QuizResult => {
      try {
        return submitQuizAttempt(quizId, answers)
      } catch (error) {
        throw createIpcError(error, 'Unable to submit quiz attempt.')
      }
    }
  )

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  closeDatabase()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
