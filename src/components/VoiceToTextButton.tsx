import React, { useEffect, useRef, useState } from 'react'
import { Button, showToast } from './ui'

interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<ArrayLike<{ transcript: string }>>
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
}

export function VoiceToTextButton({
  onTranscript,
  label = 'Voice to text',
}: {
  onTranscript: (text: string) => void
  label?: string
}) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const [listening, setListening] = useState(false)

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
    }
  }, [])

  function startListening() {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!Recognition) {
      showToast('Voice-to-text is not supported in this browser', 'error')
      return
    }

    const recognition = new Recognition()
    recognition.continuous = true
    recognition.interimResults = false
    recognition.lang = 'en-US'
    recognition.onresult = event => {
      const transcript = Array.from(event.results)
        .slice(event.resultIndex)
        .flatMap(result => Array.from(result))
        .map(item => item.transcript.trim())
        .filter(Boolean)
        .join(' ')

      if (transcript) onTranscript(transcript)
    }
    recognition.onerror = event => {
      setListening(false)
      showToast(`Voice-to-text error: ${event.error}`, 'error')
    }
    recognition.onend = () => setListening(false)
    recognition.start()
    recognitionRef.current = recognition
    setListening(true)
    showToast('Voice capture started', 'info')
  }

  function stopListening() {
    recognitionRef.current?.stop()
    setListening(false)
    showToast('Voice capture stopped', 'info')
  }

  return (
    <Button variant={listening ? 'danger' : 'secondary'} onClick={listening ? stopListening : startListening}>
      {listening ? 'Stop listening' : label}
    </Button>
  )
}
