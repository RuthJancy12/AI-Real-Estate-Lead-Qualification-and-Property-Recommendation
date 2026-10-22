/**
 * Lyka Realty – OpenAI Realtime API WebRTC Client Service
 *
 * Real-time bidirectional voice assistant service communicating with
 * the OpenAI Realtime API via WebRTC.
 * Keeps permanent API key secure on the FastAPI backend.
 */

export type VoiceState =
  | 'IDLE'
  | 'CONNECTING'
  | 'LISTENING'
  | 'THINKING'
  | 'SPEAKING'
  | 'ERROR'
  | 'ENDED'

export interface TranscriptItem {
  id: string
  role: 'user' | 'model'
  text: string
  timestamp: Date
}

export interface LiveVoiceSessionCallbacks {
  onStateChange: (state: VoiceState) => void
  onTranscript?: (item: TranscriptItem) => void
  onTurnComplete?: () => void
  onInterrupted?: () => void
  onMatchedProperties?: (properties: any[]) => void
  onError?: (error: string) => void
  onVolumeChange?: (volume: number) => void
}

const REALTIME_SYSTEM_INSTRUCTION = `You are LYKA Realty's Dubai property assistant.

CRITICAL LANGUAGE RULES:
- Always respond in English by default.
- Do not automatically switch to Hindi or any other language.
- Use another language ONLY when the user explicitly requests it.

Tone & Voice Style:
- You are friendly, professional, natural, and conversational.
- Keep spoken responses concise, engaging, and clear (1-3 sentences per turn for natural dialogue).
- Respond promptly and warmly to greetings (e.g. for 'Hi' or 'Hello', give an instant, concise 1-sentence greeting asking how you can help with their Dubai property search).

Core Capabilities:
1. Welcome users and understand their Dubai property goals (buying, renting, investing).
2. When the user provides or modifies criteria (location, bedrooms, budget, property type, purpose), call the search_properties tool to retrieve real verified Dubai listings.
3. Seamlessly adapt when users change criteria (e.g., 'Actually 3 bedrooms', 'Increase my budget', 'Rent instead', 'Downtown instead').
4. NEVER invent or hallucinate property details or reference IDs. Use only data from search_properties.
5. When properties are returned, highlight the top 1-2 options naturally and invite the user to view details or save favorites.`

export class OpenAIRealtimeSession {
  private pc: RTCPeerConnection | null = null
  private dc: RTCDataChannel | null = null
  private mediaStream: MediaStream | null = null
  private remoteAudioEl: HTMLAudioElement | null = null
  private volumeAudioContext: AudioContext | null = null
  private volumeProcessor: ScriptProcessorNode | null = null
  private currentState: VoiceState = 'IDLE'
  private callbacks: LiveVoiceSessionCallbacks
  private activeModelMsgId: string | null = null
  private activeUserMsgId: string | null = null

  constructor(callbacks: LiveVoiceSessionCallbacks) {
    this.callbacks = callbacks
  }

  public getState(): VoiceState {
    return this.currentState
  }

  private setState(newState: VoiceState) {
    if (this.currentState === newState) return
    this.currentState = newState
    this.callbacks.onStateChange(newState)
  }

  private getBackendUrl(): string {
    return (import.meta.env.VITE_API_URL as string | undefined) || 'http://127.0.0.1:8000'
  }

  /**
   * Starts the real-time OpenAI WebRTC session.
   * 1. Requests mic access.
   * 2. Creates RTCPeerConnection & DataChannel ("oai-events").
   * 3. Exchanges SDP offer/answer with OpenAI GA Realtime endpoint.
   */
  public async start(): Promise<void> {
    if (this.currentState === 'CONNECTING' || this.currentState === 'LISTENING' || this.currentState === 'SPEAKING') {
      return
    }

    this.setState('CONNECTING')
    this.activeModelMsgId = null
    this.activeUserMsgId = null

    try {
      // 1. Request microphone permission
      try {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: 24000,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })
      } catch (err) {
        const errorMsg = 'Microphone permission denied or audio device unavailable.'
        this.setState('ERROR')
        if (this.callbacks.onError) this.callbacks.onError(errorMsg)
        return
      }

      // 2. Setup hidden audio element in DOM to play incoming model voice
      if (!this.remoteAudioEl) {
        this.remoteAudioEl = document.createElement('audio')
        this.remoteAudioEl.autoplay = true
        this.remoteAudioEl.style.display = 'none'
        document.body.appendChild(this.remoteAudioEl)
      }

      // 3. Create WebRTC Peer Connection
      const pc = new RTCPeerConnection()
      this.pc = pc

      // Play remote audio stream when tracks arrive from OpenAI
      pc.ontrack = (event) => {
        if (this.remoteAudioEl && event.streams[0]) {
          this.remoteAudioEl.srcObject = event.streams[0]
          this.remoteAudioEl.play().catch(() => {
            // Browser autoplay policy catch
          })
        }
      }

      // Add local microphone audio track to WebRTC
      this.mediaStream.getAudioTracks().forEach((track) => {
        pc.addTrack(track, this.mediaStream!)
      })

      // 4. Create DataChannel for OpenAI Realtime events
      const dc = pc.createDataChannel('oai-events')
      this.dc = dc

      dc.onopen = () => {
        this.setState('LISTENING')
        // Send initial session configuration over data channel
        this.sendSessionUpdate()
      }

      dc.onmessage = (event) => {
        this.handleDataChannelMessage(event.data)
      }

      dc.onerror = (err) => {
        console.error('OpenAI Realtime DataChannel error:', err)
      }

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          if (this.currentState !== 'ENDED' && this.currentState !== 'IDLE') {
            this.setState('ERROR')
            if (this.callbacks.onError) {
              this.callbacks.onError('WebRTC voice connection disconnected.')
            }
          }
        }
      }

      // 5. Generate SDP Offer
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      // 6. Negotiate SDP Answer:
      // First attempt direct low-latency connection via ephemeral token from /api/voice/session
      // with seamless fallback to backend proxy /api/voice/webrtc
      const backendUrl = this.getBackendUrl()
      let answerSdp = ''

      try {
        const sessionRes = await fetch(`${backendUrl}/api/voice/session`, { method: 'POST' })
        if (sessionRes.ok) {
          const sessionData = await sessionRes.json()
          const ephemeralKey = sessionData.value || sessionData.client_secret?.value
          if (ephemeralKey) {
            const directResponse = await fetch('https://api.openai.com/v1/realtime/calls?model=gpt-realtime-1.5', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${ephemeralKey}`,
                'Content-Type': 'application/sdp',
              },
              body: offer.sdp,
            })
            if (directResponse.ok) {
              answerSdp = await directResponse.text()
            } else {
              const errBody = await directResponse.text()
              if (
                errBody.includes('credit_balance_exhausted') ||
                errBody.includes('insufficient_quota') ||
                errBody.includes('credits remaining')
              ) {
                throw new Error('OpenAI account credits exhausted. Please add credits at platform.openai.com to enable live voice.')
              }
            }
          }
        }
      } catch (directErr) {
        if (directErr instanceof Error && directErr.message.includes('credits exhausted')) {
          throw directErr
        }
        // Fallback to proxy
      }

      if (!answerSdp) {
        const sdpResponse = await fetch(`${backendUrl}/api/voice/webrtc`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sdp: offer.sdp, model: 'gpt-realtime-1.5' }),
        })

        if (!sdpResponse.ok) {
          const errorData = await sdpResponse.json().catch(() => ({ detail: 'Failed to negotiate voice session' }))
          const rawDetail = errorData.detail || `Server error (${sdpResponse.status})`
          if (
            rawDetail.includes('credit_balance_exhausted') ||
            rawDetail.includes('insufficient_quota') ||
            rawDetail.includes('credits remaining')
          ) {
            throw new Error('OpenAI account credits exhausted. Please add credits at platform.openai.com to enable live voice.')
          }
          throw new Error(rawDetail)
        }

        const resJson = await sdpResponse.json()
        answerSdp = resJson.sdp
      }

      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })

      // 7. Setup volume metering for UI feedback
      this.setupVolumeMeter()

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to initialize voice session'
      this.setState('ERROR')
      if (this.callbacks.onError) this.callbacks.onError(errorMsg)
      this.cleanup()
    }
  }

  /**
   * Configures the OpenAI Realtime session with instructions, Whisper transcription,
   * optimized low-latency VAD (250ms silence detection), and tools.
   */
  private sendSessionUpdate() {
    if (!this.dc || this.dc.readyState !== 'open') return

    const updateEvent = {
      type: 'session.update',
      session: {
        modalities: ['audio', 'text'],
        instructions: REALTIME_SYSTEM_INSTRUCTION,
        voice: 'alloy',
        input_audio_transcription: {
          model: 'whisper-1'
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 200,
          silence_duration_ms: 250,
          create_response: true
        },
        tools: [
          {
            type: 'function',
            name: 'search_properties',
            description: 'Searches real Dubai properties in the Lyka Realty dataset based on location, property type, bedrooms, budget, purpose, etc.',
            parameters: {
              type: 'object',
              properties: {
                location: {
                  type: 'string',
                  description: 'Dubai location/community (e.g., Dubai Marina, Downtown Dubai, Palm Jumeirah, Dubai Hills Estate, Business Bay)'
                },
                property_type: {
                  type: 'string',
                  description: 'Property type: Apartment, Villa, Townhouse, Penthouse'
                },
                bedrooms: {
                  type: 'integer',
                  description: 'Number of bedrooms / BHK (0 for Studio, 1, 2, 3, etc.)'
                },
                max_budget_aed: {
                  type: 'number',
                  description: 'Maximum budget in AED'
                },
                purpose: {
                  type: 'string',
                  description: 'Purpose: Sale or Rent'
                }
              }
            }
          }
        ],
        tool_choice: 'auto'
      }
    }

    try {
      this.dc.send(JSON.stringify(updateEvent))
    } catch (e) {
      console.warn('Failed to send session.update:', e)
    }
  }

  /**
   * Allows sending text messages directly over the active WebRTC voice session.
   */
  public sendTextMessage(text: string): boolean {
    if (this.dc && this.dc.readyState === 'open') {
      try {
        this.dc.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_text',
                text
              }
            ]
          }
        }))
        this.dc.send(JSON.stringify({
          type: 'response.create'
        }))
        return true
      } catch (e) {
        console.error('Failed to send text message via WebRTC data channel:', e)
      }
    }
    return false
  }

  /**
   * Handles incoming Realtime Server Events over the DataChannel
   */
  private async handleDataChannelMessage(rawMsg: string) {
    try {
      const event = JSON.parse(rawMsg)
      const eventType = event.type

      switch (eventType) {
        // User speech detected by server VAD -> Interruption handling
        case 'input_audio_buffer.speech_started': {
          if (this.currentState === 'SPEAKING') {
            if (this.remoteAudioEl) {
              // Pause model speech immediately on user interruption
              this.remoteAudioEl.pause()
            }
            if (this.callbacks.onInterrupted) {
              this.callbacks.onInterrupted()
            }
            // Immediately signal OpenAI to cancel model response generation
            try {
              if (this.dc && this.dc.readyState === 'open') {
                this.dc.send(JSON.stringify({ type: 'response.cancel' }))
              }
            } catch (e) {
              console.warn('Failed to send response.cancel:', e)
            }
          }
          this.setState('LISTENING')
          break
        }

        // User speech ended
        case 'input_audio_buffer.speech_stopped': {
          this.setState('THINKING')
          break
        }

        // User speech transcription completed by Whisper
        case 'conversation.item.input_audio_transcription.completed': {
          const userText = event.transcript
          if (userText && userText.trim()) {
            this.activeUserMsgId = `user-voice-${Date.now()}`
            if (this.callbacks.onTranscript) {
              this.callbacks.onTranscript({
                id: this.activeUserMsgId,
                role: 'user',
                text: userText.trim(),
                timestamp: new Date()
              })
            }
          }
          break
        }

        // Assistant is speaking text / audio delta
        case 'response.audio_transcript.delta': {
          const delta = event.delta
          if (delta) {
            this.setState('SPEAKING')
            if (!this.activeModelMsgId) {
              this.activeModelMsgId = `agent-voice-${Date.now()}`
            }
            if (this.callbacks.onTranscript) {
              this.callbacks.onTranscript({
                id: this.activeModelMsgId,
                role: 'model',
                text: delta,
                timestamp: new Date()
              })
            }
          }
          break
        }

        // Assistant finished speaking current response
        case 'response.audio_transcript.done': {
          this.activeModelMsgId = null
          break
        }

        // Turn completed
        case 'response.done': {
          this.activeModelMsgId = null
          this.activeUserMsgId = null
          this.setState('LISTENING')
          if (this.callbacks.onTurnComplete) {
            this.callbacks.onTurnComplete()
          }
          break
        }

        // Tool / Function Calling (search_properties)
        case 'response.function_call_arguments.done': {
          const fnName = event.name
          const callId = event.call_id
          const argsRaw = event.arguments || '{}'

          if (fnName === 'search_properties') {
            this.setState('THINKING')
            let args: Record<string, any> = {}
            try {
              args = JSON.parse(argsRaw)
            } catch {
              args = {}
            }

            // Execute real property search against backend dataset
            await this.handleToolCallSearchProperties(callId, args)
          }
          break
        }

        // Server error
        case 'error': {
          let errMessage = event.error?.message || 'OpenAI Realtime error'
          if (
            errMessage.includes('credit_balance_exhausted') ||
            errMessage.includes('insufficient_quota') ||
            errMessage.includes('credits remaining')
          ) {
            errMessage = 'OpenAI account credits exhausted. Please add credits at platform.openai.com to enable live voice.'
          }
          console.error('OpenAI Realtime error event:', event.error)
          if (this.callbacks.onError) {
            this.callbacks.onError(errMessage)
          }
          break
        }

        default:
          break
      }
    } catch (e) {
      console.warn('Failed to parse realtime DataChannel message:', e)
    }
  }

  /**
   * Executes the real property search tool and feeds the result back to OpenAI Realtime.
   */
  private async handleToolCallSearchProperties(callId: string, args: Record<string, any>) {
    try {
      const backendUrl = this.getBackendUrl()
      const queryParams = new URLSearchParams()

      if (args.location) queryParams.append('location', args.location)
      if (args.property_type) queryParams.append('property_type', args.property_type)
      if (args.bedrooms !== undefined && args.bedrooms !== null) queryParams.append('bedrooms', String(args.bedrooms))
      if (args.max_budget_aed) queryParams.append('max_budget', String(args.max_budget_aed))
      if (args.purpose) queryParams.append('purpose', args.purpose)
      queryParams.append('limit', '4')

      const response = await fetch(`${backendUrl}/api/properties/search?${queryParams.toString()}`)
      if (!response.ok) {
        throw new Error(`Search failed: HTTP ${response.status}`)
      }

      const searchData = await response.json()
      const topProps = searchData.top_properties || []

      // Emit real matched properties to UI cards
      if (topProps.length > 0 && this.callbacks.onMatchedProperties) {
        this.callbacks.onMatchedProperties(topProps)
      }

      // Send tool output back to OpenAI Realtime via DataChannel
      if (this.dc && this.dc.readyState === 'open') {
        // 1. Create function_call_output item
        this.dc.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify({
              total_found: searchData.total_found,
              top_properties: searchData.ai_summary || []
            })
          }
        }))

        // 2. Request model to generate voice response referencing the found properties
        this.dc.send(JSON.stringify({
          type: 'response.create'
        }))
      }

    } catch (err) {
      console.error('Tool execution error in search_properties:', err)
      if (this.dc && this.dc.readyState === 'open') {
        this.dc.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify({ error: 'Failed to search properties' })
          }
        }))
        this.dc.send(JSON.stringify({ type: 'response.create' }))
      }
    }
  }

  /**
   * Set up volume analysis for mic feedback
   */
  private setupVolumeMeter() {
    if (!this.mediaStream) return
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.volumeAudioContext = new AudioContextClass()
      const source = this.volumeAudioContext.createMediaStreamSource(this.mediaStream)
      this.volumeProcessor = this.volumeAudioContext.createScriptProcessor(2048, 1, 1)

      this.volumeProcessor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0)
        let sum = 0
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i]
        }
        const rms = Math.sqrt(sum / inputData.length)
        if (this.callbacks.onVolumeChange) {
          this.callbacks.onVolumeChange(Math.min(1, rms * 5))
        }
      }

      source.connect(this.volumeProcessor)
      this.volumeProcessor.connect(this.volumeAudioContext.destination)
    } catch {
      // AudioContext metering is optional
    }
  }

  /**
   * Stops the voice session and cleans up resources cleanly.
   */
  public stop(): void {
    this.cleanup()
    this.setState('ENDED')
  }

  private cleanup(): void {
    if (this.dc) {
      try {
        this.dc.close()
      } catch {
        // Ignore
      }
      this.dc = null
    }

    if (this.pc) {
      try {
        this.pc.close()
      } catch {
        // Ignore
      }
      this.pc = null
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop())
      this.mediaStream = null
    }

    if (this.volumeProcessor) {
      this.volumeProcessor.disconnect()
      this.volumeProcessor = null
    }

    if (this.volumeAudioContext) {
      this.volumeAudioContext.close().catch(() => {})
      this.volumeAudioContext = null
    }

    if (this.remoteAudioEl) {
      this.remoteAudioEl.pause()
      this.remoteAudioEl.srcObject = null
      if (this.remoteAudioEl.parentNode) {
        this.remoteAudioEl.parentNode.removeChild(this.remoteAudioEl)
      }
      this.remoteAudioEl = null
    }

    this.activeModelMsgId = null
    this.activeUserMsgId = null
  }
}

// Backward-compatible alias for any components referencing GeminiLiveSession
export { OpenAIRealtimeSession as GeminiLiveSession }
