export interface QuizRecord {
  id: string
  lessonId: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface QuizChoice {
  id: string
  questionId: string
  choiceText: string
  isCorrect: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface QuizQuestion {
  id: string
  quizId: string
  prompt: string
  explanation: string | null
  sortOrder: number
  choices: QuizChoice[]
  createdAt: string
  updatedAt: string
}

export interface QuizAttempt {
  id: string
  quizId: string
  startedAt: string
  completedAt: string | null
  correctAnswerCount: number
  totalQuestionCount: number
}

export interface QuizResult {
  quiz: QuizRecord
  attempt: QuizAttempt
  answers: Array<{
    question: QuizQuestion
    selectedChoiceId: string | null
    isCorrect: boolean
    answeredAt: string
  }>
}

// Placeholder until quiz generation format requirements are defined.
export interface QuizCreationSettings {
  questionCount: number
  choicesPerQuestion: number
}
