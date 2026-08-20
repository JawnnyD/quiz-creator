import { useRef } from 'react'

function App(): React.JSX.Element {
  const pdfInputRef = useRef<HTMLInputElement>(null)

  const openPdfPicker = (): void => {
    pdfInputRef.current?.click()
  }

  return (
    <main className="app">
      <input
        ref={pdfInputRef}
        className="pdf-input"
        type="file"
        accept="application/pdf,.pdf"
        aria-label="Upload PDF"
      />
      <button className="upload-button" type="button" onClick={openPdfPicker}>
        Upload PDF
      </button>
    </main>
  )
}

export default App
