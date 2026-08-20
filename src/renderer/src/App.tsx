function App(): React.JSX.Element {
  const openPdfPicker = async (): Promise<void> => {
    const selectedPdfPath = await window.api.selectPdf()

    if (selectedPdfPath === null) {
      return
    }
  }

  return (
    <main className="app">
      <button className="upload-button" type="button" onClick={openPdfPicker}>
        Upload PDF
      </button>
    </main>
  )
}

export default App
