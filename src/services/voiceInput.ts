/**
 * LYKA Realty — voice-to-text input only (dictation into the chat textbox).
 *
 * TEXT-BASED assistant: the microphone converts speech to editable text via
 * the browser Web Speech API. It NEVER auto-sends, NEVER posts a chat
 * message, and NEVER speaks back (no TTS, no WebRTC, no voice agent).
 *
 * Contract:
 * - Interim + final transcripts go ONLY to the input textbox.
 * - The message is sent only when the user clicks Send or presses Enter.
 * - Typing always works, even when mic is denied or SR is unavailable.
 * - Duplicate final transcripts are ignored (exactly-once text handling).
 */

export type VoiceInputState = 'idle' | 'listening' | 'denied' | 'unsupported' | 'error'

export interface VoiceInputCallbacks {
  onStateChange: (state: VoiceInputState) => void
  /** Live words while speaking — shown in the input for review. */
  onInterimText: (text: string) => void
  /** Completed utterance — appended to the input, never submitted. */
  onFinalText: (text: string) => void
  onError?: (message: string) => void
}

function getSpeechRecognitionCtor(): any | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as Record<string, any>
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

export function isVoiceInputSupported(): boolean {
  return getSpeechRecognitionCtor() !== null
}

/**
 * Pure helper: appends dictated words after existing text with exactly one
 * space. Tested in `src/utils/__tests__/voiceText.test.ts`.
 */
export function combineVoiceText(base: string, addition: string): string {
  const b = (base || '').trimEnd()
  const a = (addition || '').trim()
  if (!a) return base
  if (!b) return a
  return `${b} ${a}`
}

/**
 * Pure helper: browsers may re-fire the same final result event. Returns
 * true when this final transcript duplicates the previous one within the
 * dedupe window and must be ignored. Tested alongside combineVoiceText.
 */
export function isRepeatFinalTranscript(
  finalText: string,
  lastFinal: string,
  lastFinalAt: number,
  now: number,
  windowMs = 1500
): boolean {
  return finalText === lastFinal && now - lastFinalAt < windowMs
}

export class VoiceInputSession {
  private callbacks: VoiceInputCallbacks
  private state: VoiceInputState = 'idle'
  private recognition: any = null
  private baseText = ''
  private lastFinal = ''
  private lastFinalAt = 0

  constructor(callbacks: VoiceInputCallbacks) {
    this.callbacks = callbacks
  }

  public getState(): VoiceInputState {
    return this.state
  }

  public isListening(): boolean {
    return this.state === 'listening'
  }

  private setState(next: VoiceInputState) {
    if (this.state === next) return
    this.state = next
    try {
      this.callbacks.onStateChange(next)
    } catch (e) {
      console.error('[VoiceInput] onStateChange failed:', e)
    }
  }

  /**
   * Call on every composer change so dictated text appends after what the
   * user typed (or edited) instead of overwriting it.
   */
  public setBaseText(text: string) {
    this.baseText = text || ''
  }

  private combine(base: string, addition: string): string {
    return combineVoiceText(base, addition)
  }

  public start() {
    const SR = getSpeechRecognitionCtor()
    if (!SR) {
      this.setState('unsupported')
      try {
        this.callbacks.onError?.(
          'Voice input is not supported in this browser. Please use Chrome or Edge, or continue typing.'
        )
      } catch {}
      return
    }
    if (this.state === 'listening') return

    try {
      if (this.recognition) {
        try {
          this.recognition.onstart = null
          this.recognition.onresult = null
          this.recognition.onerror = null
          this.recognition.onend = null
          this.recognition.abort()
        } catch {}
        this.recognition = null
      }
      const rec = new SR()
      rec.continuous = false
      rec.interimResults = true
      rec.lang = 'en-US'
      rec.maxAlternatives = 1

      rec.onstart = () => {
        this.lastFinal = ''
        this.setState('listening')
      }

      rec.onresult = (event: any) => {
        try {
          let interim = ''
          let finalChunk = ''
          for (let i = 0; i < event.results.length; i++) {
            const res = event.results[i]
            if (!res || !res[0]) continue
            const transcript = String(res[0].transcript || '').trim()
            if (!transcript) continue
            if (res.isFinal) finalChunk += ` ${transcript}`
            else interim += ` ${transcript}`
          }
          const live = (finalChunk + ' ' + interim).trim()
          if (live) {
            try {
              this.callbacks.onInterimText(this.combine(this.baseText, live))
            } catch {}
          }
          const finalText = finalChunk.trim()
          if (finalText) {
            // Dedupe: browsers may re-fire the same final result.
            const now = Date.now()
            if (isRepeatFinalTranscript(finalText, this.lastFinal, this.lastFinalAt, now)) return
            this.lastFinal = finalText
            this.lastFinalAt = now
            const merged = this.combine(this.baseText, finalText)
            this.baseText = merged
            try {
              this.callbacks.onFinalText(merged)
            } catch {}
          }
        } catch {
          // Ignore malformed recognition events; typing is unaffected.
        }
      }

      rec.onerror = (event: any) => {
        const code = event?.error
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          this.setState('denied')
          try {
            this.callbacks.onError?.(
              'Microphone permission denied. Typing still works — allow mic access in the address bar to dictate.'
            )
          } catch {}
          this.teardown()
        } else if (code === 'audio-capture') {
          this.setState('error')
          try {
            this.callbacks.onError?.('No microphone was found. Typing still works.')
          } catch {}
          this.teardown()
        } else if (code === 'aborted' || code === 'no-speech') {
          // Benign: keep whatever text was already dictated, stop quietly.
          this.stop()
        } else {
          console.warn('[VoiceInput] recognition event:', code)
        }
      }

      rec.onend = () => {
        // Single-utterance dictation: stop after each utterance, keeping text.
        this.teardown()
        this.setState('idle')
      }

      this.recognition = rec
      rec.start()
    } catch (e: any) {
      console.warn('[VoiceInput] start failed:', e)
      this.setState('error')
      try {
        this.callbacks.onError?.('Could not start voice input. Typing still works.')
      } catch {}
      this.teardown()
    }
  }

  public stop() {
    this.teardown()
    this.setState('idle')
  }

  private teardown() {
    if (this.recognition) {
      try {
        this.recognition.onstart = null
        this.recognition.onresult = null
        this.recognition.onerror = null
        this.recognition.onend = null
        this.recognition.abort()
      } catch {}
      this.recognition = null
    }
  }
}
