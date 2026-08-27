import { randomInt } from 'crypto'
import OpenAI from 'openai'
import type { DatabaseSync } from 'node:sqlite'

import { AppError, isAppError } from '../../shared/errors'
import type { QuizCreationSettings, QuizDifficulty } from '../../shared/quizzes'
import {
  getLessonFromDatabase,
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
const aiResponseMalformedMessage =
  'The AI returned a quiz format this app could not use. Try generating again.'

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
    throw new AppError('validation_failed', 'Lesson id is required to generate a quiz.')
  }

  const settings = normalizeQuizSettings(input.settings)
  const lesson = getLessonFromDatabase(connection, lessonId)

  if (lesson === null) {
    throw new AppError('lesson_not_found', 'This lesson is no longer available.')
  }

  if (lesson.textExtractionStatus === 'failed') {
    throw new AppError(
      'lesson_text_extraction_failed',
      'Quiz generation is unavailable because text extraction failed.'
    )
  }

  if (lesson.textExtractionStatus === 'not_started') {
    throw new AppError('lesson_text_unavailable', 'Lesson text is not ready yet.')
  }

  if (lesson.textCharacterCount === 0) {
    throw new AppError(
      'lesson_text_empty',
      'Quiz generation is unavailable because no selectable text was found.'
    )
  }

  const lessonText = getLessonTextForQuizGenerationFromDatabase(connection, lessonId)

  if (lessonText === null) {
    throw new AppError('lesson_text_unavailable', 'Lesson text is not ready yet.')
  }

  if (normalizeWhitespace(lessonText.fullText).length === 0) {
    throw new AppError(
      'lesson_text_empty',
      'Quiz generation is unavailable because no selectable text was found.'
    )
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
    throw new AppError('unexpected', 'The generated quiz could not be loaded after saving.')
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
    throw new AppError('validation_failed', 'Choose at least 1 question.')
  }

  if (questionCount > maxTemporaryQuizQuestionCount) {
    throw new AppError(
      'validation_failed',
      `Question count cannot exceed ${maxTemporaryQuizQuestionCount}.`
    )
  }

  if (!Number.isInteger(choicesPerQuestion) || choicesPerQuestion !== requiredChoicesPerQuestion) {
    throw new AppError(
      'validation_failed',
      `AI-generated quizzes must use exactly ${requiredChoicesPerQuestion} choices.`
    )
  }

  if (difficulty !== 'easy' && difficulty !== 'nbme' && difficulty !== 'custom') {
    throw new AppError('validation_failed', 'Choose a supported quiz difficulty.')
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

  try {
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
      throw new AppError('ai_generation_failed', 'Quiz generation did not complete. Try again.')
    }

    const responseText = response.output_text.trim()

    if (responseText.length === 0) {
      throw new AppError('ai_response_malformed', aiResponseMalformedMessage)
    }

    const generatedQuiz = validateGeneratedQuiz(parseGeneratedQuizJson(responseText), settings)

    return randomizeGeneratedQuizChoices(generatedQuiz)
  } catch (error) {
    if (isAppError(error)) {
      throw error
    }

    throw new AppError(
      'ai_generation_failed',
      'Quiz generation failed. Check your connection and API key, then try again.'
    )
  }
}

function getOpenAiClient(): OpenAI {
  const apiKey = process.env[openAiApiKeyEnvironmentVariableName]?.trim()

  if (apiKey === undefined || apiKey.length === 0) {
    throw new AppError(
      'ai_generation_failed',
      `${openAiApiKeyEnvironmentVariableName} is required to generate quizzes.`
    )
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
    throw new AppError('ai_response_malformed', aiResponseMalformedMessage)
  }

  const title = getRequiredString(value, 'title')
  const questionsValue = value['questions']

  if (!Array.isArray(questionsValue)) {
    throw new AppError('ai_response_malformed', aiResponseMalformedMessage)
  }

  if (questionsValue.length !== settings.questionCount) {
    throw new AppError('ai_response_malformed', aiResponseMalformedMessage)
  }

  const questionPrompts = new Set<string>()
  const questions = questionsValue.map((questionValue) =>
    validateGeneratedQuestion(questionValue, settings, questionPrompts)
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
      throw new AppError('unexpected', 'Unable to prepare generated quiz choices.')
    }

    shuffledChoices[index] = randomChoice
    shuffledChoices[randomIndex] = currentChoice
  }

  return shuffledChoices
}

function validateGeneratedQuestion(
  value: unknown,
  settings: NormalizedQuizSettings,
  questionPrompts: Set<string>
): SaveQuizQuestionInput {
  if (!isRecord(value)) {
    throw new AppError('ai_response_malformed', aiResponseMalformedMessage)
  }

  const prompt = getRequiredString(value, 'prompt')
  const explanation = getRequiredString(value, 'explanation')
  const promptKey = normalizeChoiceKey(prompt)

  if (questionPrompts.has(promptKey)) {
    throw new AppError('ai_response_malformed', aiResponseMalformedMessage)
  }

  questionPrompts.add(promptKey)

  const choicesValue = value['choices']

  if (!Array.isArray(choicesValue)) {
    throw new AppError('ai_response_malformed', aiResponseMalformedMessage)
  }

  if (choicesValue.length !== settings.choicesPerQuestion) {
    throw new AppError('ai_response_malformed', aiResponseMalformedMessage)
  }

  const choiceTexts = new Set<string>()
  let correctChoiceCount = 0
  const choices = choicesValue.map((choiceValue) => {
    const choice = validateGeneratedChoice(choiceValue)
    const choiceKey = normalizeChoiceKey(choice.choiceText)

    if (choiceTexts.has(choiceKey)) {
      throw new AppError('ai_response_malformed', aiResponseMalformedMessage)
    }

    choiceTexts.add(choiceKey)

    if (choice.isCorrect) {
      correctChoiceCount += 1
    }

    return choice
  })

  if (correctChoiceCount !== 1) {
    throw new AppError('ai_response_malformed', aiResponseMalformedMessage)
  }

  return {
    prompt,
    explanation,
    choices
  }
}

function validateGeneratedChoice(value: unknown): SaveQuizQuestionInput['choices'][number] {
  if (!isRecord(value)) {
    throw new AppError('ai_response_malformed', aiResponseMalformedMessage)
  }

  const choiceText = getRequiredString(value, 'choiceText')
  const isCorrect = value['isCorrect']

  if (typeof isCorrect !== 'boolean') {
    throw new AppError('ai_response_malformed', aiResponseMalformedMessage)
  }

  return {
    choiceText,
    isCorrect
  }
}

function getRequiredString(value: Record<string, unknown>, key: string): string {
  const fieldValue = value[key]

  if (typeof fieldValue !== 'string') {
    throw new AppError('ai_response_malformed', aiResponseMalformedMessage)
  }

  const trimmedValue = fieldValue.trim()

  if (trimmedValue.length === 0) {
    throw new AppError('ai_response_malformed', aiResponseMalformedMessage)
  }

  return trimmedValue
}

function parseGeneratedQuizJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    throw new AppError('ai_response_malformed', aiResponseMalformedMessage)
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
