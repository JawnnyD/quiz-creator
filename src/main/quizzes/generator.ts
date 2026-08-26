import { randomInt } from 'crypto'
import OpenAI from 'openai'
import type { DatabaseSync } from 'node:sqlite'

import type { QuizCreationSettings, QuizDifficulty } from '../../shared/quizzes'
import {
  getLessonTextForQuizGenerationFromDatabase,
  type LessonTextForQuizGeneration
} from '../lessons/service'
import {
  createQuizRecordFromDatabase,
  loadFullQuizFromDatabase,
  saveQuizQuestionsFromDatabase,
  type FullQuiz,
  type SaveQuizQuestionInput
} from './service'

const defaultQuizTitle = 'Medical Practice Quiz'
const maxTemporaryQuizQuestionCount = 50
const requiredChoicesPerQuestion = 5
const easyModel = 'gpt-5.6-luna'
const advancedModel = 'gpt-5.6-terra'
const openAiApiKeyEnvironmentVariableName = 'OPENAI_API_KEY'

const defaultQuizSettings = {
  questionCount: 10,
  choicesPerQuestion: requiredChoicesPerQuestion,
  difficulty: 'easy',
  customDifficultyInstructions: ''
} satisfies NormalizedQuizSettings

let openAiClient: OpenAI | null = null

export interface GenerateTemporaryQuizInput {
  lessonId: string
  title?: string
  settings?: Partial<QuizCreationSettings>
}

interface NormalizedQuizSettings {
  questionCount: number
  choicesPerQuestion: number
  difficulty: QuizDifficulty
  customDifficultyInstructions: string
}

interface GeneratedQuiz {
  title: string
  questions: SaveQuizQuestionInput[]
}

export async function generateTemporaryQuizFromLessonTextFromDatabase(
  connection: DatabaseSync,
  input: GenerateTemporaryQuizInput
): Promise<FullQuiz> {
  const lessonId = input.lessonId.trim()

  if (lessonId.length === 0) {
    throw new Error('Lesson id is required to generate a quiz')
  }

  const settings = normalizeQuizSettings(input.settings)
  const lessonText = getLessonTextForQuizGenerationFromDatabase(connection, lessonId)

  if (lessonText === null) {
    throw new Error(`Completed lesson text was not found for quiz generation: ${lessonId}`)
  }

  if (normalizeWhitespace(lessonText.fullText).length === 0) {
    throw new Error(`Lesson text is empty for quiz generation: ${lessonId}`)
  }

  const generatedQuiz = await generateQuizWithOpenAi(lessonText, settings)
  const title = input.title?.trim() || generatedQuiz.title || defaultQuizTitle
  const quiz = createQuizRecordFromDatabase(connection, {
    lessonId,
    title,
    difficulty: settings.difficulty
  })

  try {
    saveQuizQuestionsFromDatabase(connection, {
      quizId: quiz.id,
      questions: generatedQuiz.questions
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
): NormalizedQuizSettings {
  const questionCount = settings?.questionCount ?? defaultQuizSettings.questionCount
  const choicesPerQuestion = settings?.choicesPerQuestion ?? defaultQuizSettings.choicesPerQuestion
  const difficulty = settings?.difficulty ?? defaultQuizSettings.difficulty
  const customDifficultyInstructions = settings?.customDifficultyInstructions?.trim() ?? ''

  if (!Number.isInteger(questionCount) || questionCount <= 0) {
    throw new Error('Temporary quiz question count must be a positive integer')
  }

  if (questionCount > maxTemporaryQuizQuestionCount) {
    throw new Error(`Temporary quiz question count cannot exceed ${maxTemporaryQuizQuestionCount}`)
  }

  if (!Number.isInteger(choicesPerQuestion) || choicesPerQuestion !== requiredChoicesPerQuestion) {
    throw new Error(`AI-generated quizzes must use exactly ${requiredChoicesPerQuestion} choices`)
  }

  if (difficulty !== 'easy' && difficulty !== 'nbme' && difficulty !== 'custom') {
    throw new Error(`Unsupported quiz difficulty: ${String(difficulty)}`)
  }

  return {
    questionCount,
    choicesPerQuestion,
    difficulty,
    customDifficultyInstructions
  }
}

async function generateQuizWithOpenAi(
  lessonText: LessonTextForQuizGeneration,
  settings: NormalizedQuizSettings
): Promise<GeneratedQuiz> {
  const client = getOpenAiClient()
  const response = await client.responses.create({
    model: getModelForDifficulty(settings.difficulty),
    instructions: buildGeneratorInstructions(settings),
    input: buildGeneratorInput(lessonText, settings),
    max_output_tokens: getMaxOutputTokens(settings.questionCount),
    store: false,
    text: {
      format: {
        type: 'json_schema',
        name: 'medical_practice_quiz',
        strict: true,
        schema: buildGeneratedQuizSchema()
      }
    }
  })

  if (response.status !== 'completed') {
    const reason =
      response.error?.message ?? response.incomplete_details?.reason ?? 'Unknown completion status'

    throw new Error(`OpenAI quiz generation did not complete: ${reason}`)
  }

  const responseText = response.output_text.trim()

  if (responseText.length === 0) {
    throw new Error('OpenAI quiz generation returned an empty response')
  }

  const generatedQuiz = validateGeneratedQuiz(parseGeneratedQuizJson(responseText), settings)

  return randomizeGeneratedQuizChoices(generatedQuiz)
}

function getOpenAiClient(): OpenAI {
  const apiKey = process.env[openAiApiKeyEnvironmentVariableName]?.trim()

  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error(`${openAiApiKeyEnvironmentVariableName} is required to generate quizzes`)
  }

  openAiClient ??= new OpenAI({ apiKey })

  return openAiClient
}

function getModelForDifficulty(difficulty: QuizDifficulty): string {
  return difficulty === 'nbme' ? advancedModel : easyModel
}

function buildGeneratorInstructions(settings: NormalizedQuizSettings): string {
  return `${sharedBasePrompt}

${getDifficultyPrompt(settings)}`
}

function buildGeneratorInput(
  lessonText: LessonTextForQuizGeneration,
  settings: NormalizedQuizSettings
): string {
  return `Treat the extracted lesson text below as the uploaded document.

Settings:
- Requested questions: ${settings.questionCount}
- Answer choices per question: ${settings.choicesPerQuestion}
- Difficulty: ${settings.difficulty}

Extracted lesson text:
<lesson_text>
${formatLessonTextForPrompt(lessonText)}
</lesson_text>`
}

const sharedBasePrompt = `You are a medical education question writer creating practice questions for USMLE Step 1-style learning.

Use the uploaded document as the primary factual source. Do not introduce unsupported facts from outside the document unless they are necessary basic medical knowledge for framing a question. Prioritize the document's learning objectives, high-yield concepts, and clinically relevant details.

Generate the number of questions requested by the user.

Each question must:

- Have one best answer.
- Include 5 answer choices.
- Use plausible distractors.
- Avoid trick wording, vague clues, or unsupported assumptions.
- Test understanding rather than simple word matching when possible.
- Match the selected difficulty level.
- Vary answer choice order across questions and avoid predictable correct-answer positions.
- Be clinically and scientifically accurate.`

function getDifficultyPrompt(settings: NormalizedQuizSettings): string {
  switch (settings.difficulty) {
    case 'easy':
      return easyPrompt
    case 'nbme':
      return nbmePrompt
    case 'custom':
      return buildCustomPrompt(settings.customDifficultyInstructions)
  }
}

const easyPrompt = `Difficulty: Easy

Create straightforward practice questions focused on recall, recognition, and basic understanding of the uploaded document.

Question style:
- Short to moderate-length stems.
- Ask about definitions, mechanisms, classic associations, key facts, simple cause-effect relationships, or direct application of a concept.
- Clinical context may be used, but it should be simple and not require multi-step reasoning.
- Avoid long vignettes, complex lab interpretation, or competing diagnoses.

Distractors:
- Should be plausible but clearly distinguishable from the correct answer.
- Should test common misunderstandings or closely related concepts.
- Avoid overly obscure answer choices.

The goal is to help the learner confirm that they understand the core material before moving to harder application questions.`

const nbmePrompt = `Difficulty: NBME

Create USMLE Step 1-style questions modeled after NBME-style clinical reasoning.

Question style:
- Use full clinical vignette stems when appropriate.
- Include patient demographics, relevant history, physical exam findings, labs, imaging, pathology, or experimental findings when useful.
- Require application, integration, or multi-step reasoning rather than direct recall.
- Focus on mechanisms, diagnosis, pathophysiology, pharmacology, microbiology, immunology, biochemistry, genetics, physiology, pathology, or behavioral science as supported by the document.
- The correct answer should be the best answer, not merely a true statement.

Distractors:
- Must be medically plausible.
- Should reflect common diagnostic confusions, mechanism errors, similar diseases, similar drugs, or related pathways.
- Avoid obviously wrong or throwaway options.

Question quality requirements:
- Do not make the vignette longer than necessary.
- Include only details that help discriminate the correct answer from distractors.
- Avoid copying wording directly from the source document when possible.
- Maintain balanced coverage across the document, with emphasis on learning objectives and high-yield concepts.`

function buildCustomPrompt(customDifficultyInstructions: string): string {
  const instructions =
    customDifficultyInstructions.length > 0
      ? customDifficultyInstructions
      : 'No custom instructions were provided. Create balanced practice questions using the general medical question-writing standards.'

  return `Difficulty: Custom

Create straightforward practice questions that follow the general style and structure of Easy questions, while focusing on the user's requested topic, section, lesson area, or custom instructions.

User custom instructions:
${instructions}

Question style:
- Use short to moderate-length stems.
- Focus on recall, recognition, basic understanding, and simple application.
- Prioritize the specific section, topic, learning objective, or part of the lesson requested by the user.
- Clinical context may be used when helpful, but it should remain simple and not require complex multi-step reasoning.
- Avoid long NBME-style vignettes unless the user explicitly requests board-style or clinical vignette questions.
- Avoid complex lab interpretation, competing diagnoses, or advanced integration unless specifically requested.

Distractors:
- Should be plausible but clearly distinguishable from the correct answer.
- Should test common misunderstandings, closely related terms, or nearby concepts from the requested section.
- Avoid obscure, overly advanced, or throwaway answer choices.

If the user's custom instructions are vague:
- Treat the request as Easy-style by default.
- Focus on the most relevant learning objectives from the uploaded document.
- Keep the questions simple, direct, and useful for first-pass review.

The goal is to let the learner target a specific part of the lesson while keeping the difficulty approachable and focused.`
}

function buildGeneratedQuizSchema(): { [key: string]: unknown } {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: {
        type: 'string',
        description: 'A concise title for the generated quiz.'
      },
      questions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            prompt: {
              type: 'string',
              description: 'The full question stem.'
            },
            explanation: {
              type: 'string',
              description: 'A concise explanation of why the correct answer is best.'
            },
            choices: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  choiceText: {
                    type: 'string',
                    description: 'The answer choice text.'
                  },
                  isCorrect: {
                    type: 'boolean',
                    description: 'True only for the one best answer.'
                  }
                },
                required: ['choiceText', 'isCorrect']
              }
            }
          },
          required: ['prompt', 'explanation', 'choices']
        }
      }
    },
    required: ['title', 'questions']
  }
}

function validateGeneratedQuiz(value: unknown, settings: NormalizedQuizSettings): GeneratedQuiz {
  if (!isRecord(value)) {
    throw new Error('OpenAI quiz generation returned an invalid quiz object')
  }

  const title = getRequiredString(value, 'title', 'Generated quiz title')
  const questionsValue = value['questions']

  if (!Array.isArray(questionsValue)) {
    throw new Error('OpenAI quiz generation did not return a questions array')
  }

  if (questionsValue.length !== settings.questionCount) {
    throw new Error(
      `OpenAI quiz generation returned ${questionsValue.length} questions instead of ${settings.questionCount}`
    )
  }

  const questionPrompts = new Set<string>()
  const questions = questionsValue.map((questionValue, questionIndex) =>
    validateGeneratedQuestion(questionValue, questionIndex, settings, questionPrompts)
  )

  return {
    title,
    questions
  }
}

function randomizeGeneratedQuizChoices(quiz: GeneratedQuiz): GeneratedQuiz {
  return {
    ...quiz,
    questions: quiz.questions.map((question) => ({
      ...question,
      choices: shuffleChoices(question.choices)
    }))
  }
}

function shuffleChoices(
  choices: SaveQuizQuestionInput['choices']
): SaveQuizQuestionInput['choices'] {
  const shuffledChoices = [...choices]

  for (let index = shuffledChoices.length - 1; index > 0; index -= 1) {
    const randomIndex = randomInt(index + 1)
    const currentChoice = shuffledChoices[index]
    const randomChoice = shuffledChoices[randomIndex]

    if (currentChoice === undefined || randomChoice === undefined) {
      throw new Error('Unable to randomize generated quiz choices')
    }

    shuffledChoices[index] = randomChoice
    shuffledChoices[randomIndex] = currentChoice
  }

  return shuffledChoices
}

function validateGeneratedQuestion(
  value: unknown,
  questionIndex: number,
  settings: NormalizedQuizSettings,
  questionPrompts: Set<string>
): SaveQuizQuestionInput {
  if (!isRecord(value)) {
    throw new Error(`Generated question ${questionIndex + 1} is not an object`)
  }

  const prompt = getRequiredString(
    value,
    'prompt',
    `Generated question ${questionIndex + 1} prompt`
  )
  const explanation = getRequiredString(
    value,
    'explanation',
    `Generated question ${questionIndex + 1} explanation`
  )
  const promptKey = normalizeChoiceKey(prompt)

  if (questionPrompts.has(promptKey)) {
    throw new Error(`Generated question ${questionIndex + 1} duplicates another question prompt`)
  }

  questionPrompts.add(promptKey)

  const choicesValue = value['choices']

  if (!Array.isArray(choicesValue)) {
    throw new Error(`Generated question ${questionIndex + 1} did not return a choices array`)
  }

  if (choicesValue.length !== settings.choicesPerQuestion) {
    throw new Error(
      `Generated question ${questionIndex + 1} returned ${choicesValue.length} choices instead of ${settings.choicesPerQuestion}`
    )
  }

  const choiceTexts = new Set<string>()
  let correctChoiceCount = 0
  const choices = choicesValue.map((choiceValue, choiceIndex) => {
    const choice = validateGeneratedChoice(choiceValue, questionIndex, choiceIndex)
    const choiceKey = normalizeChoiceKey(choice.choiceText)

    if (choiceTexts.has(choiceKey)) {
      throw new Error(`Generated question ${questionIndex + 1} has duplicate answer choice text`)
    }

    choiceTexts.add(choiceKey)

    if (choice.isCorrect) {
      correctChoiceCount += 1
    }

    return choice
  })

  if (correctChoiceCount !== 1) {
    throw new Error(`Generated question ${questionIndex + 1} must have exactly one correct answer`)
  }

  return {
    prompt,
    explanation,
    choices
  }
}

function validateGeneratedChoice(
  value: unknown,
  questionIndex: number,
  choiceIndex: number
): SaveQuizQuestionInput['choices'][number] {
  if (!isRecord(value)) {
    throw new Error(
      `Generated question ${questionIndex + 1} choice ${choiceIndex + 1} is not an object`
    )
  }

  const choiceText = getRequiredString(
    value,
    'choiceText',
    `Generated question ${questionIndex + 1} choice ${choiceIndex + 1} text`
  )
  const isCorrect = value['isCorrect']

  if (typeof isCorrect !== 'boolean') {
    throw new Error(
      `Generated question ${questionIndex + 1} choice ${choiceIndex + 1} correctness must be a boolean`
    )
  }

  return {
    choiceText,
    isCorrect
  }
}

function getRequiredString(value: Record<string, unknown>, key: string, label: string): string {
  const fieldValue = value[key]

  if (typeof fieldValue !== 'string') {
    throw new Error(`${label} must be a string`)
  }

  const trimmedValue = fieldValue.trim()

  if (trimmedValue.length === 0) {
    throw new Error(`${label} is required`)
  }

  return trimmedValue
}

function parseGeneratedQuizJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    throw new Error(`OpenAI quiz generation returned invalid JSON: ${message}`)
  }
}

function formatLessonTextForPrompt(lessonText: LessonTextForQuizGeneration): string {
  if (lessonText.pages.length === 0) {
    return normalizeWhitespace(lessonText.fullText)
  }

  return lessonText.pages
    .map((page) => `Page ${page.pageNumber}:\n${normalizeWhitespace(page.text)}`)
    .join('\n\n')
}

function getMaxOutputTokens(questionCount: number): number {
  return Math.min(120000, 3000 + questionCount * 900)
}

function normalizeChoiceKey(value: string): string {
  return normalizeWhitespace(value).toLowerCase()
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanupGeneratedQuiz(connection: DatabaseSync, quizId: string): void {
  try {
    connection.prepare('DELETE FROM quizzes WHERE id = ?').run(quizId)
  } catch {
    // Preserve the original generation error.
  }
}
