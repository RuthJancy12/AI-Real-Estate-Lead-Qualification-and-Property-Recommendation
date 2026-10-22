/**
 * Lyka Realty – Browser-Native Voice Assistant Service
 *
 * 100% Free, zero-API-key voice interaction powered by:
 * 1. Web Speech API (SpeechRecognition / webkitSpeechRecognition) for microphone speech-to-text
 * 2. Browser Speech Synthesis (speechSynthesis / SpeechSynthesisUtterance) for text-to-speech
 *
 * Microphones remain strictly inactive until explicitly clicked by the user.
 * Finalizes one clean transcript per voice turn without inserting partial/unintended chunks.
 */

import type { VoiceState } from './openaiRealtime'

declare global {
  interface Window {
    SpeechRecognition?: any
    webkitSpeechRecognition?: any
    __lykaUtterance?: any
  }
}

export interface BrowserVoiceCallbacks {
  onStateChange: (state: VoiceState) => void
  onInterimTranscript?: (text: string) => void
  onFinalTranscript: (text: string) => void
  onError?: (error: string) => void
  onVolumeChange?: (volume: number) => void
}

export class BrowserVoiceSession {
  private callbacks: BrowserVoiceCallbacks
  private state: VoiceState = 'IDLE'
  private recognition: any = null
  private synth: SpeechSynthesis | null = null
  private audioContext: AudioContext | null = null
  private mediaStream: MediaStream | null = null
  private analyser: AnalyserNode | null = null
  private animFrameId: number | null = null
  private isSessionActive = false
  private silenceTimer: any = null
  private latestTranscript: string = ''

  constructor(callbacks: BrowserVoiceCallbacks) {
    this.callbacks = callbacks
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synth = window.speechSynthesis
    }
  }

  public getState(): VoiceState {
    return this.state
  }

  public isActive(): boolean {
    return this.isSessionActive
  }

  private setState(newState: VoiceState) {
    if (this.state === newState) return
    this.state = newState
    try {
      this.callbacks.onStateChange(newState)
    } catch (e) {
      console.error('[BrowserVoice] Error in onStateChange callback:', e)
    }
  }

  /**
   * Starts microphone capture for a SINGLE user voice turn.
   * Remains inactive until explicitly triggered by user clicking the microphone.
   */
  public async start(): Promise<void> {
    if (this.isSessionActive) {
      return
    }

    this.isSessionActive = true
    this.latestTranscript = ''
    this.setState('CONNECTING')

    // 1. Check Web Speech API support
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRec) {
      const err = 'Speech Recognition is not supported in this browser. Please use Chrome, Edge, or text chat.'
      this.setState('ERROR')
      this.callbacks.onError?.(err)
      this.isSessionActive = false
      return
    }

    // 2. Setup Audio Volume Analyser for UI visualizer orb
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
        if (AudioCtx) {
          this.audioContext = new AudioCtx()
          const source = this.audioContext.createMediaStreamSource(this.mediaStream)
          this.analyser = this.audioContext.createAnalyser()
          this.analyser.fftSize = 256
          source.connect(this.analyser)
          this.startVolumeLoop()
        }
      }
    } catch (micErr) {
      console.warn('[BrowserVoice] Microphone stream setup warning:', micErr)
    }

    // 3. Setup SpeechRecognition
    try {
      this.recognition = new SpeechRec()
      this.recognition.continuous = true
      this.recognition.interimResults = true
      this.recognition.lang = 'en-US'
      this.recognition.maxAlternatives = 1

      this.recognition.onstart = () => {
        if (this.isSessionActive) {
          this.setState('LISTENING')
        }
      }

      this.recognition.onresult = (event: any) => {
        if (!this.isSessionActive) return

        let fullTranscript = ''
        let hasFinalResult = false

        for (let i = 0; i < event.results.length; ++i) {
          const res = event.results[i]
          if (res && res[0]) {
            fullTranscript += ' ' + res[0].transcript
            if (res.isFinal) {
              hasFinalResult = true
            }
          }
        }

        const cleanText = fullTranscript.trim()
        if (!cleanText) return
        this.latestTranscript = cleanText

        // Stream interim transcription for live UI feedback without creating chat bubbles
        this.callbacks.onInterimTranscript?.(cleanText)

        // Debounce finalization when user stops speaking
        if (this.silenceTimer) clearTimeout(this.silenceTimer)
        const delay = hasFinalResult ? 1000 : 1800

        this.silenceTimer = setTimeout(() => {
          if (this.isSessionActive && this.latestTranscript) {
            this.finalizeVoiceTurn(this.latestTranscript)
          }
        }, delay)
      }

      this.recognition.onerror = (event: any) => {
        console.warn('[BrowserVoice] Speech event:', event.error)
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          this.setState('ERROR')
          this.callbacks.onError?.('Microphone permission denied. Please allow microphone access to talk.')
          this.stop()
        } else if (event.error === 'network') {
          this.setState('ERROR')
          this.callbacks.onError?.('Speech recognition network error. Please use text chat.')
          this.stop()
        } else if (event.error === 'no-speech') {
          // No speech detected yet, keep listening without erroring
        }
      }

      this.recognition.onend = () => {
        // If silence timer was pending and we have a transcript, finalize now
        if (this.isSessionActive && this.latestTranscript) {
          this.finalizeVoiceTurn(this.latestTranscript)
        } else if (this.isSessionActive && this.state === 'LISTENING') {
          // If no transcript was captured and session is still active, stay ready
          this.stop()
        }
      }

      this.recognition.start()
    } catch (e: any) {
      console.error('[BrowserVoice] Failed to start speech recognition:', e)
      this.setState('ERROR')
      this.callbacks.onError?.(e.message || 'Failed to start speech recognition')
      this.stop()
    }
  }

  /**
   * Finalizes one clean speech transcript and passes it to the UI submission pipeline.
   * Stops recognition immediately to prevent duplicate runs.
   */
  private finalizeVoiceTurn(transcript: string) {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer)
      this.silenceTimer = null
    }

    const cleanText = transcript.trim()
    this.latestTranscript = ''

    // Stop recognition immediately so no further audio is processed for this turn
    try {
      this.recognition?.stop()
    } catch {}

    if (cleanText) {
      this.callbacks.onFinalTranscript(cleanText)
    } else {
      this.stop()
    }
  }

  /**
   * Speaks the response text aloud via browser SpeechSynthesis.
   */
  public speak(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (!this.synth || !text.trim() || !this.isSessionActive) {
        resolve()
        return
      }

      const cleanSpeech = text
        .replace(/[*#_`~]/g, '')
        .replace(/https?:\/\/\S+/g, '')
        .trim()

      if (!cleanSpeech) {
        resolve()
        return
      }

      try {
        this.synth.cancel()
      } catch {}

      const utterance = new SpeechSynthesisUtterance(cleanSpeech)
      if (typeof window !== 'undefined') {
        window.__lykaUtterance = utterance
      }

      utterance.lang = 'en-US'
      utterance.rate = 1.0
      utterance.pitch = 1.0

      try {
        const voices = this.synth.getVoices()
        const preferredVoice = voices.find(
          (v) => (v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Zira') || v.name.includes('David')))
        ) || voices.find((v) => v.lang.startsWith('en'))
        if (preferredVoice) {
          utterance.voice = preferredVoice
        }
      } catch {}

      let resolved = false
      const finish = () => {
        if (!resolved) {
          resolved = true
          clearTimeout(safetyTimer)
          if (this.isSessionActive) {
            this.setState('IDLE')
          }
          resolve()
        }
      }

      const maxSpeechMs = Math.min(20000, Math.max(3000, cleanSpeech.length * 100))
      const safetyTimer = setTimeout(finish, maxSpeechMs)

      utterance.onstart = () => {
        if (this.isSessionActive) {
          this.setState('SPEAKING')
        }
      }

      utterance.onend = finish
      utterance.onerror = (e) => {
        console.warn('[BrowserVoice] Speech synthesis ended/error:', e)
        finish()
      }

      try {
        this.synth.speak(utterance)
      } catch (speakErr) {
        console.warn('[BrowserVoice] Failed to invoke synth.speak:', speakErr)
        finish()
      }
    })
  }

  /**
   * Loops over AudioAnalyser to provide volume level (0.0 to 1.0) to callbacks.
   */
  private startVolumeLoop() {
    if (!this.analyser) return

    const buffer = new Uint8Array(this.analyser.frequencyBinCount)
    const update = () => {
      if (!this.isSessionActive) return

      if (this.state === 'LISTENING' && this.analyser) {
        this.analyser.getByteFrequencyData(buffer)
        let sum = 0
        for (let i = 0; i < buffer.length; i++) {
          sum += buffer[i]
        }
        const avg = sum / buffer.length
        const norm = Math.min(1.0, avg / 128.0)
        this.callbacks.onVolumeChange?.(norm)
      } else if (this.state === 'SPEAKING') {
        const wave = 0.3 + 0.2 * Math.sin(Date.now() / 150)
        this.callbacks.onVolumeChange?.(wave)
      } else {
        this.callbacks.onVolumeChange?.(0)
      }

      this.animFrameId = requestAnimationFrame(update)
    }

    this.animFrameId = requestAnimationFrame(update)
  }

  /**
   * Stops the voice session, mic capture, and speech synthesis.
   */
  public stop(): void {
    this.isSessionActive = false

    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer)
      this.silenceTimer = null
    }

    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId)
      this.animFrameId = null
    }

    if (this.recognition) {
      try {
        this.recognition.abort()
      } catch {}
      this.recognition = null
    }

    if (this.synth) {
      try {
        this.synth.cancel()
      } catch {}
    }

    if (this.mediaStream) {
      try {
        this.mediaStream.getTracks().forEach((t) => t.stop())
      } catch {}
      this.mediaStream = null
    }

    if (this.audioContext) {
      try {
        this.audioContext.close()
      } catch {}
      this.audioContext = null
    }

    this.setState('IDLE')
  }
}
