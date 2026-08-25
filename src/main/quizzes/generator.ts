import type { DatabaseSync } from 'node:sqlite'

import type { QuizCreationSettings } from '../../shared/quizzes'
import { getLessonTextForQuizGenerationFromDatabase } from '../lessons/service'
import {
  createQuizRecordFromDatabase,
  loadFullQuizFromDatabase,
  saveQuizQuestionsFromDatabase,
  type FullQuiz,
  type SaveQuizQuestionInput
} from './service'

const defaultQuizTitle = 'Temporary Quiz'
const maxTemporaryQuizQuestionCount = 50
const defaultQuizSettings: QuizCreationSettings = {
  questionCount: 10,
  choicesPerQuestion: 4
}
const fallbackDistractors = [
  'overview',
  'definition',
  'example',
  'process',
  'summary',
  'context',
  'evidence',
  'result',
  'method',
  'detail'
]
const stopWords = new Set([
  'the',
  'and',
  'for',
  'are',
  'but',
  'not',
  'you',
  'with',
  'that',
  'this',
  'from',
  'have',
  'has',
  'was',
  'were',
  'will',
  'their',
  'there',
  'which',
  'when',
  'what'
])

export interface GenerateTemporaryQuizInput {
  lessonId: string
  title?: string
  settings?: Partial<QuizCreationSettings>
}

interface SourceExcerpt {
  text: string
  keywords: string[]
}

export function generateTemporaryQuizFromLessonTextFromDatabase(
  connection: DatabaseSync,
  input: GenerateTemporaryQuizInput
): FullQuiz {
  const lessonId = input.lessonId.trim()

  if (lessonId.length === 0) {
    throw new Error('Lesson id is required to generate a quiz')
  }

  const settings = normalizeQuizSettings(input.settings)
  const lessonText = getLessonTextForQuizGenerationFromDatabase(connection, lessonId)

  if (lessonText === null) {
    throw new Error(`Completed lesson text was not found for quiz generation: ${lessonId}`)
  }

  const fullText = normalizeWhitespace(lessonText.fullText)

  if (fullText.length === 0) {
    throw new Error(`Lesson text is empty for quiz generation: ${lessonId}`)
  }

  const title = input.title?.trim() || defaultQuizTitle
  const questions = generateTemporaryQuestions(fullText, settings)
  const quiz = createQuizRecordFromDatabase(connection, {
    lessonId,
    title,
    ...(settings.difficulty === undefined ? {} : { difficulty: settings.difficulty })
  })

  try {
    saveQuizQuestionsFromDatabase(connection, {
      quizId: quiz.id,
      questions
    })
  } catch (error) {
    cleanupGeneratedQuiz(connection, quiz.id)
    throw error
  }

  const fullQuiz = loadFullQuizFromDatabase(connection, quiz.id)

  if (fullQuiz === null) {
    throw new Error(`Generated quiz was not found after saving questions: ${quiz.id}`)
  }

  return fullQuiz
}

function normalizeQuizSettings(
  settings: Partial<QuizCreationSettings> | undefined
): QuizCreationSettings {
  const questionCount = settings?.questionCount ?? defaultQuizSettings.questionCount
  const choicesPerQuestion = settings?.choicesPerQuestion ?? defaultQuizSettings.choicesPerQuestion

  if (!Number.isInteger(questionCount) || questionCount <= 0) {
    throw new Error('Temporary quiz question count must be a positive integer')
  }

  if (questionCount > maxTemporaryQuizQuestionCount) {
    throw new Error(`Temporary quiz question count cannot exceed ${maxTemporaryQuizQuestionCount}`)
  }

  if (!Number.isInteger(choicesPerQuestion) || choicesPerQuestion < 2) {
    throw new Error('Temporary quiz choices per question must be an integer of at least 2')
  }

  const normalizedSettings: QuizCreationSettings = {
    questionCount,
    choicesPerQuestion
  }

  if (settings?.difficulty !== undefined) {
    normalizedSettings.difficulty = settings.difficulty
  }

  return normalizedSettings
}

function generateTemporaryQuestions(
  lessonText: string,
  settings: QuizCreationSettings
): SaveQuizQuestionInput[] {
  const keywords = extractKeywordCandidates(lessonText)

  if (keywords.length === 0) {
    throw new Error('Lesson text does not contain usable words for quiz generation')
  }

  const sourceExcerpts = buildSourceExcerpts(lessonText)
  const sourcesWithKeywords = sourceExcerpts.filter((source) => source.keywords.length > 0)

  if (sourcesWithKeywords.length === 0) {
    throw new Error('Lesson text does not contain usable excerpts for quiz generation')
  }

  return Array.from({ length: settings.questionCount }, (_, questionIndex) => {
    const source = sourcesWithKeywords[questionIndex % sourcesWithKeywords.length]
    const correctChoice = source.keywords[questionIndex % source.keywords.length]
    const promptExcerpt = replaceKeywordWithBlank(source.text, correctChoice)

    return {
      prompt: `Question ${questionIndex + 1}: Complete the excerpt: "${promptExcerpt}"`,
      explanation: `Source excerpt: ${source.text}`,
      choices: buildChoices(correctChoice, keywords, questionIndex, settings.choicesPerQuestion)
    }
  })
}

function buildSourceExcerpts(lessonText: string): SourceExcerpt[] {
  const sentenceMatches = lessonText.match(/[^.!?]+[.!?]?/g) ?? [lessonText]
  const excerpts = sentenceMatches
    .map((sentence) => truncateText(normalizeWhitespace(sentence), 180))
    .filter((sentence) => sentence.length > 0)

  return (excerpts.length > 0 ? excerpts : [truncateText(lessonText, 180)]).map((text) => ({
    text,
    keywords: extractKeywordCandidates(text)
  }))
}

function buildChoices(
  correctChoice: string,
  allKeywords: string[],
  questionIndex: number,
  choicesPerQuestion: number
): SaveQuizQuestionInput['choices'] {
  const correctChoiceKey = normalizeChoiceKey(correctChoice)
  const usedChoiceKeys = new Set([correctChoiceKey])
  const distractors: string[] = []
  const rotatedKeywords = [
    ...allKeywords.slice(questionIndex + 1),
    ...allKeywords.slice(0, questionIndex + 1)
  ]

  for (const keyword of rotatedKeywords) {
    addDistractor(keyword, usedChoiceKeys, distractors, choicesPerQuestion - 1)
  }

  let fallbackRound = 0

  while (distractors.length < choicesPerQuestion - 1) {
    for (const fallback of fallbackDistractors) {
      const candidate = fallbackRound === 0 ? fallback : `${fallback} ${fallbackRound + 1}`

      addDistractor(candidate, usedChoiceKeys, distractors, choicesPerQuestion - 1)

      if (distractors.length === choicesPerQuestion - 1) {
        break
      }
    }

    fallbackRound += 1
  }

  const correctChoiceIndex = questionIndex % choicesPerQuestion
  const choices: SaveQuizQuestionInput['choices'] = []

  for (let choiceIndex = 0; choiceIndex < choicesPerQuestion; choiceIndex += 1) {
    if (choiceIndex === correctChoiceIndex) {
      choices.push({
        choiceText: correctChoice,
        isCorrect: true
      })
    } else {
      choices.push({
        choiceText: distractors.shift() ?? fallbackDistractors[0],
        isCorrect: false
      })
    }
  }

  return choices
}

function addDistractor(
  candidate: string,
  usedChoiceKeys: Set<string>,
  distractors: string[],
  desiredDistractorCount: number
): void {
  if (distractors.length >= desiredDistractorCount) {
    return
  }

  const trimmedCandidate = candidate.trim()

  if (trimmedCandidate.length === 0) {
    return
  }

  const choiceKey = normalizeChoiceKey(trimmedCandidate)

  if (usedChoiceKeys.has(choiceKey)) {
    return
  }

  distractors.push(trimmedCandidate)
  usedChoiceKeys.add(choiceKey)
}

function extractKeywordCandidates(text: string): string[] {
  const words = text.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g) ?? []
  const preferredWords = uniqueWords(
    words.filter((word) => word.length >= 3 && !stopWords.has(word.toLowerCase()))
  )

  if (preferredWords.length > 0) {
    return preferredWords
  }

  return uniqueWords(words)
}

function uniqueWords(words: string[]): string[] {
  const seenWords = new Set<string>()
  const unique: string[] = []

  for (const word of words) {
    const trimmedWord = word.trim()
    const wordKey = trimmedWord.toLowerCase()

    if (trimmedWord.length === 0 || seenWords.has(wordKey)) {
      continue
    }

    unique.push(trimmedWord)
    seenWords.add(wordKey)
  }

  return unique
}

function replaceKeywordWithBlank(excerpt: string, keyword: string): string {
  const keywordPattern = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'i')

  return excerpt.replace(keywordPattern, '____')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeChoiceKey(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength - 3).trimEnd()}...`
}

function cleanupGeneratedQuiz(connection: DatabaseSync, quizId: string): void {
  try {
    connection.prepare('DELETE FROM quizzes WHERE id = ?').run(quizId)
  } catch {
    // Preserve the original generation error.
  }
}
