import { useState, useEffect, useRef } from 'react'
import {
  X, Send, Sparkles, RefreshCw,
  Phone, MessageSquare, Maximize2, AlertCircle, Mic,
  MapPin, Building2, Eye, Heart
} from 'lucide-react'
import type { Property } from '../../types/property'
import type { UserRequirements, ChatMessage, AgentStatus, TrackedFieldKey } from '../../types/agent'
import { sendChatMessage, fetchPropertiesFromApi, type ChatHistoryTurn } from '../../services/api'
import { formatProperty } from '../../utils/propertyData'
import { parseUserInput } from '../../utils/agentEngine'
import { OpenAIRealtimeSession, type VoiceState } from '../../services/openaiRealtime'
import { BrowserVoiceSession } from '../../services/browserVoice'
import { RequirementPanel } from './RequirementPanel'

interface UIAgentModalProps {
  isOpen: boolean
  onClose: () => void
  properties: Property[]
  onSelectProperty: (property: Property) => void
  initialQuery?: string
  favoriteIds?: string[]
  onToggleFavorite?: (id: string) => void
}

const INITIAL_REQUIREMENTS: UserRequirements = {
  purpose: null,
  location: null,
  propertyType: null,
  bhk: null,
  budget: null,
  nearMetro: null,
  beachfront: null,
  amenities: []
}

const INITIAL_GREETING_MESSAGE: ChatMessage = {
  id: 'msg-1',
  sender: 'agent',
  text: "Hi! 👋\nI'm Lyka, your AI Real Estate Consultant.\nHow can I help you today?",
  timestamp: 'Just now',
  quickActions: ['Buy', 'Rent', 'Invest']
}

// Exact luxury suggestion color theme matching LYKA palette
const SUGGESTION_STYLE = {
  bg: '#F3E8D5',
  border: '#DCC7A5',
  text: '#4A3A2A',
  hoverBg: '#D8B878',
  hoverText: '#241A20'
}

function getContextualSuggestions(msg: ChatMessage, isLatestAgentMsg: boolean): string[] {
  if (msg.quickActions && msg.quickActions.length > 0) {
    return msg.quickActions
  }
  if (msg.sender !== 'agent' || !isLatestAgentMsg) {
    return []
  }

  const textLower = msg.text.toLowerCase()

  // Buy or Rent or Invest
  if (
    (textLower.includes('buy') || textLower.includes('purchase')) &&
    (textLower.includes('rent') || textLower.includes('lease'))
  ) {
    return ['Buy', 'Rent', 'Invest']
  }

  // Property type inquiry
  if (
    textLower.includes('property type') ||
    textLower.includes('kind of property') ||
    textLower.includes('apartment') ||
    textLower.includes('villa') ||
    textLower.includes('townhouse') ||
    textLower.includes('penthouse')
  ) {
    return ['Apartment', 'Villa', 'Townhouse', 'Penthouse']
  }

  // Bedroom inquiry
  if (
    textLower.includes('bedroom') ||
    textLower.includes('bhk') ||
    textLower.includes('how many bed')
  ) {
    return ['Studio', '1 BHK', '2 BHK', '3 BHK', '4+ BHK']
  }

  // Budget inquiry
  if (
    textLower.includes('budget') ||
    textLower.includes('price range') ||
    textLower.includes('how much')
  ) {
    return ['Under 1.5M AED', '1.5M - 3M AED', '3M - 5M AED', '5M+ AED']
  }

  // Location inquiry
  if (
    textLower.includes('community') ||
    textLower.includes('neighborhood') ||
    textLower.includes('preferred location') ||
    textLower.includes('where in dubai')
  ) {
    return ['Dubai Marina', 'Downtown Dubai', 'Palm Jumeirah', 'Dubai Hills Estate']
  }

  return []
}

export function UIAgentModal({
  isOpen,
  onClose,
  properties: _allProperties,
  onSelectProperty,
  initialQuery,
  favoriteIds = [],
  onToggleFavorite
}: UIAgentModalProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_GREETING_MESSAGE])
  const [inputText, setInputText] = useState('')
  const [requirements, setRequirements] = useState<UserRequirements>(INITIAL_REQUIREMENTS)
  const [activeDiscussingField, setActiveDiscussingField] = useState<TrackedFieldKey | null>('location')
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('ready')
  const [isTyping, setIsTyping] = useState(false)
  const [showRequirementPanelMobile, setShowRequirementPanelMobile] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)

  // Local saved IDs state for reactive Save/Interested button updates
  const [localSavedIds, setLocalSavedIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('lyka_favorites')
      return saved ? JSON.parse(saved) : favoriteIds
    } catch {
      return favoriteIds
    }
  })

  useEffect(() => {
    if (favoriteIds && favoriteIds.length > 0) {
      setLocalSavedIds((prev) => Array.from(new Set([...prev, ...favoriteIds])))
    }
  }, [favoriteIds])

  const handleSaveProperty = (propId: string) => {
    const isSaved = localSavedIds.includes(propId)
    const updated = isSaved
      ? localSavedIds.filter((id) => id !== propId)
      : [...localSavedIds, propId]

    setLocalSavedIds(updated)
    try {
      localStorage.setItem('lyka_favorites', JSON.stringify(updated))
    } catch {
      // Ignore
    }

    if (onToggleFavorite) {
      onToggleFavorite(propId)
    }
  }

  // Voice session state for microphone button inside input bar
  const [voiceState, setVoiceState] = useState<VoiceState>('IDLE')
  const isVoiceActive =
    voiceState === 'CONNECTING' ||
    voiceState === 'LISTENING' ||
    voiceState === 'THINKING' ||
    voiceState === 'SPEAKING'

  const sessionRef = useRef<BrowserVoiceSession | OpenAIRealtimeSession | null>(null)
  const activeUserMsgIdRef = useRef<string | null>(null)
  const activeModelMsgIdRef = useRef<string | null>(null)

  // Unique session ID for persistent backend conversation memory
  const sessionIdRef = useRef<string>(`session-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const isSubmittingRef = useRef(false)
  const initialQueryHandledRef = useRef(false)
  const handleUserSubmitRef = useRef<(rawText: string, isFromVoice?: boolean) => Promise<void>>(null as any)

  const handleUserSubmit = async (rawText: string, isFromVoice = false) => {
    const text = rawText.trim()
    if (!text || isSubmittingRef.current) return
    isSubmittingRef.current = true

    setApiError(null)

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text,
      timestamp: 'Just now'
    }

    // Build history for assistant
    const currentHistory: ChatHistoryTurn[] = messages
      .filter((m) => m.sender === 'user' || m.sender === 'agent')
      .map((m) => ({
        role: m.sender === 'user' ? 'user' : 'model',
        text: m.text
      }))

    setMessages((prev) => [...prev, userMsg])
    setInputText('')
    setAgentStatus('thinking')
    setIsTyping(true)

    try {
      // Local Ollama conversation via FastAPI backend
      const response = await sendChatMessage(
        text,
        sessionIdRef.current,
        currentHistory
      )

      // Update structured requirements from AI understanding
      if (response.requirements) {
        setRequirements(response.requirements)

        // Highlight field currently being discussed
        if (response.requirements.location && !response.requirements.bhk) {
          setActiveDiscussingField('bhk')
        } else if (response.requirements.bhk && !response.requirements.budget) {
          setActiveDiscussingField('budget')
        } else if (!response.requirements.purpose) {
          setActiveDiscussingField('purpose')
        } else {
          setActiveDiscussingField(null)
        }
      }

      let matchedProps: Property[] = (response.matched_properties && response.matched_properties.length > 0)
        ? response.matched_properties.map(formatProperty)
        : []

      // Fallback query if LLM was conversational but user provided criteria
      if (matchedProps.length === 0) {
        const parsed = parseUserInput(text, response.requirements || requirements)
        const hasCriteria = Boolean(
          parsed.updated.location ||
          parsed.updated.propertyType ||
          parsed.updated.bhk !== null ||
          parsed.updated.purpose ||
          parsed.updated.budget
        )
        if (hasCriteria) {
          try {
            const apiRes = await fetchPropertiesFromApi({
              location: parsed.updated.location || undefined,
              property_type: parsed.updated.propertyType || undefined,
              bedrooms: parsed.updated.bhk ?? undefined,
              purpose: parsed.updated.purpose || undefined,
              max_budget: parsed.updated.budget || undefined,
              limit: 4
            })
            if (apiRes.top_properties && apiRes.top_properties.length > 0) {
              matchedProps = apiRes.top_properties.map(formatProperty)
              setRequirements(parsed.updated)
            }
          } catch {
            // Keep empty if API call fails
          }
        }
      }

      const hasMatches = matchedProps.length > 0
      setAgentStatus(hasMatches ? 'recommending' : 'ready')

      const agentMsg: ChatMessage = {
        id: `agent-${Date.now()}`,
        sender: 'agent',
        text: response.reply,
        timestamp: 'Just now',
        matchedProperties: hasMatches ? matchedProps : undefined,
        showSummary: hasMatches && !requirements.location ? true : undefined,
      }

      setMessages((prev) => [...prev, agentMsg])

      // If spoken by voice, speak response aloud
      if (isFromVoice && sessionRef.current && 'speak' in sessionRef.current) {
        sessionRef.current.speak(response.reply).catch(() => {})
      }
    } catch (err) {
      console.error('Error communicating with backend:', err)
      const errMsg = err instanceof Error ? err.message : 'Connection error'
      setApiError(errMsg)

      setMessages((prev) => [
        ...prev,
        {
          id: `agent-error-${Date.now()}`,
          sender: 'agent',
          text: `I encountered an issue connecting to the advisory backend: ${errMsg}. Please verify the backend server is running at http://localhost:8000.`,
          timestamp: 'Just now'
        }
      ])
    } finally {
      setIsTyping(false)
      isSubmittingRef.current = false
      setAgentStatus((prevStatus) => (prevStatus === 'thinking' ? 'ready' : prevStatus))
    }
  }

  handleUserSubmitRef.current = handleUserSubmit

  // Initialize free Browser-native voice session powered by local Ollama (llama3.2:3b)
  useEffect(() => {
    const session = new BrowserVoiceSession({
      onStateChange: (newState) => {
        setVoiceState(newState)
        if (newState === 'SPEAKING') {
          setAgentStatus('recommending')
        } else if (newState === 'THINKING') {
          setAgentStatus('thinking')
        } else if (newState === 'LISTENING') {
          setAgentStatus('listening')
        } else if (newState === 'IDLE' || newState === 'ENDED' || newState === 'ERROR') {
          setAgentStatus('ready')
          setIsTyping(false)
        }
      },
      onInterimTranscript: (interimText) => {
        setInputText(interimText)
      },
      onFinalTranscript: (finalText) => {
        if (finalText && finalText.trim()) {
          handleUserSubmitRef.current?.(finalText.trim(), true)
        }
      },
      onError: (err) => {
        setApiError(err)
      }
    })

    sessionRef.current = session

    return () => {
      session.stop()
      sessionRef.current = null
    }
  }, [])

  // Stop voice session if modal is closed
  useEffect(() => {
    if (!isOpen && sessionRef.current) {
      sessionRef.current.stop()
    }
  }, [isOpen])

  const handleToggleVoice = async () => {
    if (!sessionRef.current) return

    if (isVoiceActive) {
      sessionRef.current.stop()
    } else {
      setApiError(null)
      await sessionRef.current.start()
    }
  }

  useEffect(() => {
    if (isOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isTyping, isOpen])

  useEffect(() => {
    if (isOpen && initialQuery && initialQuery.trim() && !initialQueryHandledRef.current) {
      initialQueryHandledRef.current = true
      handleUserSubmit(initialQuery.trim())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialQuery])


  const handleResetConversation = () => {
    if (sessionRef.current && isVoiceActive) {
      sessionRef.current.stop()
    }
    activeModelMsgIdRef.current = null
    activeUserMsgIdRef.current = null
    sessionIdRef.current = `session-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
    setRequirements(INITIAL_REQUIREMENTS)
    setActiveDiscussingField('location')
    setMessages([INITIAL_GREETING_MESSAGE])
    setAgentStatus('ready')
    setApiError(null)
  }

  const handleEditField = (field: TrackedFieldKey) => {
    setActiveDiscussingField(field)
    const promptMap: Record<TrackedFieldKey, string> = {
      purpose: 'Would you prefer to Buy or Rent?',
      location: 'Which Dubai community should we focus on?',
      propertyType: 'What property type do you prefer (Apartment, Villa, Townhouse, Penthouse)?',
      bhk: 'How many bedrooms would you prefer?',
      budget: 'What is your maximum budget in AED?',
      nearMetro: 'Should the property be close to a Metro station?',
      beachfront: 'Are you looking for direct beach access or sea views?',
      amenities: 'What amenities are most important to you?'
    }
    setMessages((prev) => [
      ...prev,
      {
        id: `agent-${Date.now()}`,
        sender: 'agent',
        text: promptMap[field],
        timestamp: 'Just now',
        quickActions: field === 'purpose' ? ['Buy a Property', 'Rent a Property'] : undefined
      }
    ])
  }

  if (!isOpen) return null

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 1150,
      background: 'rgba(26, 13, 24, 0.75)',
      backdropFilter: 'blur(5px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px'
    }}>
      <div style={{
        background: '#FFFFFF',
        borderRadius: '12px',
        border: '1px solid var(--champagne-border)',
        boxShadow: '0 20px 50px rgba(26, 13, 24, 0.5)',
        width: '100%',
        maxWidth: '1160px',
        height: '88vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative'
      }}>
        {/* Header Bar (Deep Plum with Gold Borders) */}
        <div style={{
          padding: '16px 24px',
          background: 'var(--plum-deep)',
          color: '#FFFFFF',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--gold-border)',
          flexShrink: 0
        }}>
          {/* Left: Agent Avatar & Status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '38px',
              height: '38px',
              borderRadius: '6px',
              background: 'var(--plum-surface)',
              border: '1px solid var(--gold-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative'
            }}>
              <Sparkles size={18} color="var(--gold-primary)" />
              <span style={{
                position: 'absolute',
                bottom: '-2px',
                right: '-2px',
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: agentStatus === 'thinking' ? 'var(--gold-primary)' : '#10B981',
                border: '2px solid var(--plum-deep)'
              }} />
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 className="luxury-serif" style={{ fontSize: '16px', fontWeight: 600, margin: 0, letterSpacing: '0.02em' }}>
                  Lyka AI Advisory Consultant
                </h3>
                <span style={{
                  fontSize: '10px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  background: 'rgba(197, 168, 105, 0.2)',
                  color: 'var(--gold-light)',
                  padding: '2px 8px',
                  borderRadius: '3px',
                  fontWeight: 600
                }}>
                  Ollama AI &bull; Llama 3.2
                </span>
              </div>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0 }}>
                {agentStatus === 'thinking' ? 'Ollama AI is analyzing requirements & dataset...' : 'Local AI Advisory &bull; Real Dubai Properties'}
              </p>
            </div>
          </div>

          {/* Right: Controls & Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              onClick={() => setShowRequirementPanelMobile((prev) => !prev)}
              className="gold-btn-outline"
              style={{
                fontSize: '11px',
                padding: '6px 12px',
                borderRadius: '4px',
                color: '#FFFFFF',
                borderColor: 'var(--gold-border)'
              }}
              title="Toggle Requirements Panel"
            >
              Requirements
            </button>

            <button
              type="button"
              onClick={handleResetConversation}
              className="gold-btn-outline"
              style={{
                fontSize: '11px',
                padding: '6px 12px',
                borderRadius: '4px',
                color: '#FFFFFF',
                borderColor: 'var(--gold-border)'
              }}
              title="Reset Conversation"
            >
              <RefreshCw size={12} /> Reset Chat
            </button>

            <a
              href="tel:+97148005952"
              className="gold-btn"
              style={{
                fontSize: '11px',
                padding: '6px 12px',
                borderRadius: '4px',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <Phone size={12} /> +971 4 800 LYKA
            </a>

            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'rgba(255, 255, 255, 0.1)',
                border: 'none',
                borderRadius: '4px',
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: '#FFFFFF'
              }}
              title="Close Assistant"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Modal Main Body (2 Columns on Desktop) */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Left: Chat Feed & Conversation */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            background: '#F7F3EC',
            overflow: 'hidden'
          }}>
            {/* Messages Scroll Area */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '20px 24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              background: '#F7F3EC'
            }}>
              {apiError && (
                <div style={{
                  background: '#FEF2F2',
                  border: '1px solid #FECACA',
                  borderRadius: '6px',
                  padding: '9px 12px',
                  fontSize: '12px',
                  color: '#B91C1C',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  <AlertCircle size={14} />
                  <span>{apiError}</span>
                </div>
              )}

              {messages.map((msg, index) => {
                const isLatestAgentMsg =
                  msg.sender === 'agent' &&
                  (index === messages.length - 1 ||
                    messages.slice(index + 1).every((m) => m.sender !== 'agent'))
                const suggestions = getContextualSuggestions(msg, isLatestAgentMsg)

                return (
                  <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {/* Message Bubble Container */}
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                      width: '100%'
                    }}>
                      <div style={{
                        maxWidth: msg.sender === 'user' ? '78%' : '84%',
                        padding: '14px 18px',
                        borderRadius: msg.sender === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                        background: msg.sender === 'user'
                          ? '#E8D2A8'
                          : '#FFFFFF',
                        color: msg.sender === 'user' ? '#241A20' : '#25212A',
                        boxShadow: '0 2px 8px rgba(36, 17, 31, 0.04)',
                        border: msg.sender === 'user'
                          ? '1px solid #DCC7A5'
                          : '1px solid #E8DED0',
                        fontSize: '14px',
                        lineHeight: 1.6,
                        whiteSpace: 'pre-wrap',
                        letterSpacing: '0.01em'
                      }}>
                        {msg.text}
                      </div>

                      {/* Timestamp in exact #8C8278 */}
                      <span style={{
                        fontSize: '11px',
                        color: '#8C8278',
                        marginTop: '4px',
                        paddingLeft: msg.sender === 'agent' ? '4px' : '0',
                        paddingRight: msg.sender === 'user' ? '4px' : '0'
                      }}>
                        {msg.timestamp}
                      </span>


                      {/* Clean Text + Icons Property Snippets (Images Removed) */}
                      {msg.matchedProperties && msg.matchedProperties.length > 0 && (
                        <div style={{
                          marginTop: '12px',
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                          gap: '12px',
                          width: '100%'
                        }}>
                          {msg.matchedProperties.map((prop) => (
                            <div
                              key={prop.property_id}
                              style={{
                                background: '#FFFFFF',
                                border: '1px solid #E8DED0',
                                borderRadius: '12px',
                                padding: '16px',
                                boxShadow: '0 2px 8px rgba(36, 17, 31, 0.04)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '10px'
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                                <div>
                                  <div style={{
                                    fontSize: '10px',
                                    fontWeight: 700,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.08em',
                                    color: '#C9A45C',
                                    marginBottom: '3px'
                                  }}>
                                    {prop.property_type} &bull; For {prop.listing_type}
                                  </div>
                                  <h5 style={{
                                    fontSize: '14px',
                                    fontWeight: 600,
                                    color: '#25212A',
                                    margin: 0,
                                    lineHeight: 1.3
                                  }}>
                                    {prop.title}
                                  </h5>
                                </div>
                                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                  <div style={{ fontSize: '15px', fontWeight: 700, color: '#24111F' }}>
                                    AED {prop.price_aed.toLocaleString()}
                                  </div>
                                  {prop.listing_type === 'Rent' && (
                                    <span style={{ fontSize: '10px', color: '#8C8278' }}>/ yr</span>
                                  )}
                                </div>
                              </div>

                              {/* Specs with Clean Icons */}
                              <div style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                alignItems: 'center',
                                gap: '14px',
                                fontSize: '12px',
                                color: '#8C8278',
                                paddingTop: '6px',
                                borderTop: '1px dashed #E8DED0'
                              }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                  <MapPin size={13} color="#C9A45C" />
                                  {prop.location}
                                </span>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                  <Building2 size={13} color="#C9A45C" />
                                  {prop.bhk === 0 ? 'Studio' : `${prop.bhk} BHK`}
                                </span>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                  <Maximize2 size={13} color="#C9A45C" />
                                  {prop.property_size_sqft.toLocaleString()} sqft
                                </span>
                              </div>

                              {/* Action Buttons */}
                              <div style={{ display: 'flex', gap: '8px', paddingTop: '4px', flexWrap: 'wrap' }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    onSelectProperty(prop)
                                    onClose()
                                  }}
                                  style={{
                                    flex: 1,
                                    padding: '7px 12px',
                                    fontSize: '12px',
                                    borderRadius: '6px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '6px',
                                    background: '#F3E8D5',
                                    border: '1px solid #DCC7A5',
                                    color: '#4A3A2A',
                                    fontWeight: 500,
                                    cursor: 'pointer'
                                  }}
                                >
                                  <Eye size={13} color="#4A3A2A" /> View Details
                                </button>
                                {(() => {
                                  const isSaved = localSavedIds.includes(prop.property_id)
                                  return (
                                    <button
                                      type="button"
                                      onClick={() => handleSaveProperty(prop.property_id)}
                                      style={{
                                        background: isSaved ? '#24111F' : '#FFFDF9',
                                        color: isSaved ? '#F7E8C7' : '#25212A',
                                        border: isSaved ? '1px solid #24111F' : '1px solid #DCCFBE',
                                        borderRadius: '6px',
                                        padding: '7px 12px',
                                        fontSize: '12px',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '5px',
                                        cursor: 'pointer',
                                        fontWeight: 500,
                                        transition: 'all 0.15s ease'
                                      }}
                                      title={isSaved ? "Saved to Favorites" : "Save / Interested in this property"}
                                    >
                                      <Heart size={13} fill={isSaved ? '#F7E8C7' : 'none'} color={isSaved ? '#F7E8C7' : '#C9A45C'} />
                                      {isSaved ? 'Saved' : 'Interested'}
                                    </button>
                                  )
                                })()}
                                <a
                                  href={`https://wa.me/97148005952?text=Hello%20Lyka%20Realty,%20I%20am%20interested%20in%20${encodeURIComponent(prop.title)}%20(Ref:%20${prop.property_id})`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    background: '#FFFFFF',
                                    color: '#25212A',
                                    border: '1px solid #E8DED0',
                                    borderRadius: '6px',
                                    padding: '7px 12px',
                                    fontSize: '12px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '4px',
                                    textDecoration: 'none',
                                    fontWeight: 500
                                  }}
                                  title="Inquire on WhatsApp"
                                >
                                  <MessageSquare size={13} color="#C9A45C" /> WhatsApp
                                </a>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Suggestion Buttons in Soft Muted Beige/Gold */}
                    {suggestions.length > 0 && (
                      <div style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '8px',
                        marginTop: '4px',
                        paddingLeft: msg.sender === 'agent' ? '2px' : '0'
                      }}>
                        {suggestions.map((action, actionIdx) => (
                          <button
                            key={actionIdx}
                            type="button"
                            onClick={() => handleUserSubmit(action)}
                            style={{
                              background: SUGGESTION_STYLE.bg,
                              border: `1px solid ${SUGGESTION_STYLE.border}`,
                              color: SUGGESTION_STYLE.text,
                              borderRadius: '20px',
                              padding: '6px 14px',
                              fontSize: '12px',
                              fontWeight: 500,
                              cursor: 'pointer',
                              boxShadow: '0 1px 3px rgba(36, 17, 31, 0.03)',
                              transition: 'all 0.15s ease',
                              display: 'inline-flex',
                              alignItems: 'center'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = SUGGESTION_STYLE.hoverBg
                              e.currentTarget.style.color = SUGGESTION_STYLE.hoverText
                              e.currentTarget.style.borderColor = SUGGESTION_STYLE.hoverBg
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = SUGGESTION_STYLE.bg
                              e.currentTarget.style.color = SUGGESTION_STYLE.text
                              e.currentTarget.style.borderColor = SUGGESTION_STYLE.border
                            }}
                          >
                            {action}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Typing / Reasoning Indicator */}
              {isTyping && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 14px',
                  background: '#FFFFFF',
                  borderRadius: '16px',
                  width: 'fit-content',
                  border: '1px solid #E8DED0'
                }}>
                  <Sparkles size={13} color="#C9A45C" className="animate-spin" />
                  <span style={{ fontSize: '12px', color: '#8C8278' }}>
                    AI is analyzing requirements & dataset...
                  </span>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* Message Composer Area */}
            <div style={{
              padding: '16px 24px',
              background: '#F7F3EC',
              borderTop: '1px solid #E8DED0'
            }}>
              <style>{`
                .lyka-chat-input::placeholder {
                  color: #8A8177 !important;
                  opacity: 1;
                }
              `}</style>
              {/* Voice status pill if active */}
              {isVoiceActive && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginBottom: '10px',
                  padding: '4px 12px',
                  borderRadius: '12px',
                  background: '#F3E8D5',
                  border: '1px solid #DCC7A5',
                  width: 'fit-content',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#24111F'
                }}>
                  <span style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: '#C9A45C',
                    display: 'inline-block'
                  }} />
                  <span>
                    {voiceState === 'CONNECTING' && 'Connecting voice session...'}
                    {voiceState === 'LISTENING' && 'Listening (speak in English)...'}
                    {voiceState === 'THINKING' && 'Thinking (Ollama AI)...'}
                    {voiceState === 'SPEAKING' && 'Lyka Assistant is speaking...'}
                  </span>
                </div>
              )}

              {/* Wide unified message composer: [ Type a message...   🎤  ➤ ] */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                background: '#FFFDF9',
                border: isVoiceActive
                  ? '1.5px solid #C9A45C'
                  : '1px solid #DCCFBE',
                borderRadius: '24px',
                padding: '4px 8px 4px 18px',
                minHeight: '50px',
                boxShadow: isVoiceActive
                  ? '0 0 0 3px rgba(201, 164, 92, 0.2)'
                  : '0 1px 4px rgba(36, 17, 31, 0.03)',
                gap: '8px',
                transition: 'border-color 0.2s, box-shadow 0.2s',
                width: '100%'
              }}>
                <input
                  type="text"
                  className="lyka-chat-input"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={
                    voiceState === 'LISTENING'
                      ? "Listening... speak in English..."
                      : voiceState === 'SPEAKING'
                      ? "Lyka Assistant is speaking..."
                      : "Type a message..."
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      if (!isTyping && !isSubmittingRef.current && inputText.trim()) {
                        handleUserSubmit(inputText)
                      }
                    }
                  }}
                  style={{
                    flex: 1,
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    fontSize: '14px',
                    color: '#25212A',
                    padding: '10px 0'
                  }}
                />

                {/* Small Microphone Button */}
                <button
                  type="button"
                  id="chat-mic-btn"
                  onClick={handleToggleVoice}
                  title={isVoiceActive ? "Stop voice session" : "Voice input (Browser Speech & Local Ollama)"}
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '50%',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    background: isVoiceActive ? '#E63946' : '#E7D1A3',
                    color: isVoiceActive ? '#FFFFFF' : '#241A20',
                    transition: 'all 0.2s ease',
                    flexShrink: 0
                  }}
                >
                  <Mic size={16} color={isVoiceActive ? "#FFFFFF" : "#241A20"} />
                </button>

                {/* Elegant Dark-Plum Send Button */}
                <button
                  type="button"
                  id="chat-send-btn"
                  onClick={() => {
                    if (!isTyping && !isSubmittingRef.current && inputText.trim()) {
                      handleUserSubmit(inputText)
                    }
                  }}
                  disabled={!inputText.trim() || isTyping}
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '50%',
                    background: '#24111F',
                    color: '#F7E8C7',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: inputText.trim() && !isTyping ? 'pointer' : 'not-allowed',
                    opacity: inputText.trim() && !isTyping ? 1 : 0.45,
                    boxShadow: inputText.trim() && !isTyping ? '0 2px 6px rgba(36, 17, 31, 0.25)' : 'none',
                    transition: 'all 0.2s ease',
                    flexShrink: 0
                  }}
                  title="Send message"
                >
                  <Send size={14} color="#F7E8C7" />
                </button>
              </div>
            </div>
          </div>

          {/* Right: Live Requirement Tracking Panel */}
          <div
            className={`desktop-req-panel ${showRequirementPanelMobile ? 'mobile-panel-open' : ''}`}
            style={{
              width: '320px',
              borderLeft: '1px solid var(--champagne-border)',
              background: '#FFFFFF',
              padding: '20px',
              overflowY: 'auto',
              flexShrink: 0
            }}
          >
            <RequirementPanel
              requirements={requirements}
              activeField={activeDiscussingField}
              onEditField={handleEditField}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
