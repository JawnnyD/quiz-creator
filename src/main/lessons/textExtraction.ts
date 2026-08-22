import { createRequire } from 'module'
import { dirname, join } from 'path'

const extractorName = 'pdfjs-dist'
const nodeRequire = createRequire(__filename)
const standardFontDataPath = join(
  dirname(nodeRequire.resolve('pdfjs-dist/package.json')),
  'standard_fonts'
)
const standardFontDataUrl = `${standardFontDataPath.replaceAll('\\', '/')}/`

export interface ExtractedPdfTextPage {
  pageNumber: number
  text: string
  characterCount: number
}

export interface ExtractedPdfText {
  fullText: string
  pages: ExtractedPdfTextPage[]
  pageCount: number
  characterCount: number
  extractorName: string
  extractorVersion: string
}

interface PdfJsTextItem {
  str: string
  hasEOL?: boolean
}

export async function extractPdfText(pdfPath: string): Promise<ExtractedPdfText> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loadingTask = pdfjs.getDocument({ url: pdfPath, standardFontDataUrl })
  const document = await loadingTask.promise
  const pageCount = document.numPages
  const pages: ExtractedPdfTextPage[] = []

  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber)

      try {
        const textContent = await page.getTextContent()
        const text = normalizeExtractedText(
          textContent.items.map((item) => (isPdfJsTextItem(item) ? itemToText(item) : '')).join('')
        )

        pages.push({
          pageNumber,
          text,
          characterCount: text.length
        })
      } finally {
        page.cleanup()
      }
    }
  } finally {
    await loadingTask.destroy()
  }

  const fullText = pages
    .map((page) => page.text)
    .join('\n\n')
    .trim()

  return {
    fullText,
    pages,
    pageCount,
    characterCount: fullText.length,
    extractorName,
    extractorVersion: typeof pdfjs.version === 'string' ? pdfjs.version : 'unknown'
  }
}

function isPdfJsTextItem(item: unknown): item is PdfJsTextItem {
  return typeof item === 'object' && item !== null && 'str' in item
}

function itemToText(item: PdfJsTextItem): string {
  return item.hasEOL === true ? `${item.str}\n` : `${item.str} `
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
