from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException, Body, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.services.openai_service import generate_text_response
from app.services.openai_chat_service import process_chat_message
from app.services.ollama_chat_service import (
    process_ollama_chat_message,
    stream_ollama_chat_message,
    check_ollama_health,
    OLLAMA_MODEL,
    OLLAMA_BASE_URL
)
from app.services.openai_realtime_service import (
    create_realtime_session,
    negotiate_webrtc_sdp,
    REALTIME_MODEL
)
from app.services.property_service import (
    search_properties_dataset, init_property_dataset, get_distinct_locations,
)
from app.services.firebase_auth import verify_bearer_token
from app.database import init_db
from app.routers import leads as leads_router, properties as properties_router, staff as staff_router, customer as customer_router

app = FastAPI(
    title="Lyka Realty API",
    description="Backend API for Lyka Realty – AI Lead Qualification & Property Recommendation System",
    version="3.0.0",
)

# Enable CORS for frontend connectivity
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Startup: Initialise database tables & in-memory property index ──────────
@app.on_event("startup")
def on_startup():
    init_db()
    init_property_dataset()

# ─── CRM Routers ──────────────────────────────────────────────────────────────
app.include_router(leads_router.router)
app.include_router(properties_router.router)
app.include_router(staff_router.router)
app.include_router(customer_router.router)


class OpenAITestRequest(BaseModel):
    message: str = Field(..., description="User message to send to OpenAI")


class OpenAITestResponse(BaseModel):
    response: str = Field(..., description="OpenAI generated response")


class ChatMessagePayload(BaseModel):
    message: str = Field(..., description="User message to send to AI chat")
    session_id: Optional[str] = Field("default", description="Conversation session ID")
    history: Optional[List[Dict[str, str]]] = Field(None, description="Previous conversation turns")


class ChatResponsePayload(BaseModel):
    reply: str
    matched_properties: List[Dict[str, Any]]
    requirements: Dict[str, Any]
    session_id: str
    provider: Optional[str] = "ollama"
    model: Optional[str] = "llama3.2:3b"
    timings: Optional[Dict[str, float]] = None
    # Clarification gate: "purpose" | "property_type" when the turn asks a
    # follow-up instead of searching; options lists the clickable choices.
    need: Optional[str] = None
    options: Optional[List[str]] = None


class WebRtcOfferPayload(BaseModel):
    sdp: str = Field(..., description="WebRTC SDP offer from browser")
    model: Optional[str] = Field(None, description="Optional Realtime model override")


class WebRtcAnswerResponse(BaseModel):
    sdp: str = Field(..., description="WebRTC SDP answer from OpenAI")


@app.get("/api/health")
def health_check():
    ollama_info = check_ollama_health()
    return {
        "status": "ok",
        "provider": "ollama",
        "model": OLLAMA_MODEL,
        "ollama": ollama_info,
        "message": f"Lyka Realty backend is running (Ollama {ollama_info.get('status', 'unknown')})"
    }


@app.get("/api/ollama/status")
def ollama_status():
    """
    Health check specifically for the local Ollama service and target model.
    """
    return check_ollama_health()


@app.get("/api/voice/status")
def voice_status():
    return {
        "status": "ready",
        "provider": "openai-realtime",
        "model": REALTIME_MODEL,
        "transport": "webrtc",
        "audio_format": {
            "input": "audio/pcm;rate=24000",
            "output": "audio/pcm;rate=24000"
        }
    }


@app.post("/api/voice/session")
async def create_voice_session():
    """
    Creates an ephemeral session with OpenAI Realtime API for browser WebRTC connection.
    Keeps permanent API key secure on the backend.
    """
    try:
        session = await create_realtime_session()
        return session
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create voice session: {str(e)}")


@app.post("/api/voice/webrtc", response_model=WebRtcAnswerResponse)
async def exchange_webrtc_sdp(payload: WebRtcOfferPayload):
    """
    Exchanges browser WebRTC SDP offer with OpenAI Realtime server,
    returning the answer SDP. Eliminates browser CORS and keeps key secure on backend.
    """
    try:
        answer_sdp = await negotiate_webrtc_sdp(payload.sdp, model=payload.model)
        return {"sdp": answer_sdp}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"WebRTC negotiation failed: {str(e)}")


@app.post("/api/chat", response_model=ChatResponsePayload)
def chat_with_assistant(
    payload: ChatMessagePayload,
    authorization: Optional[str] = Header(default=None),
):
    """
    Multi-turn conversational chat powered by local Ollama (llama3.2:3b)
    with property search function calling and real Dubai dataset integration.
    A Firebase ID token may be supplied via Authorization header; when the
    server is Firebase-configured it is verified (identity logged), otherwise
    the request proceeds anonymously so existing flows keep working.
    """
    try:
        verified = verify_bearer_token(authorization)
        if verified:
            import logging
            logging.getLogger("lyka.chat").info(
                "Authenticated chat request (uid verified)."
            )
        result = process_ollama_chat_message(
            message=payload.message,
            session_id=payload.session_id or "default",
            client_history=payload.history
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ollama chat error: {str(e)}")


@app.post("/api/chat/stream")
async def chat_stream_with_assistant(
    payload: ChatMessagePayload,
    authorization: Optional[str] = Header(default=None),
):
    """
    Streams conversational chat tokens from local Ollama via Server-Sent Events (SSE),
    emitting DB search results and criteria metadata in < 3ms so UI updates immediately.
    Preserves cancellation and error handling.
    """
    try:
        verify_bearer_token(authorization)
        return StreamingResponse(
            stream_ollama_chat_message(
                message=payload.message,
                session_id=payload.session_id or "default",
                client_history=payload.history
            ),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            }
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat stream error: {str(e)}")


@app.get("/api/communities")
def list_communities():
    """Public list of real dataset communities with live listing counts.

    Powers chatbot location chips and summary dropdowns. No auth required
    so guests can explore; read-only, no data exposure beyond names/counts.
    """
    try:
        return {"communities": get_distinct_locations()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Communities error: {str(e)}")


@app.get("/api/properties/search")
def search_properties_endpoint(
    location: Optional[str] = None,
    property_type: Optional[str] = None,
    bedrooms: Optional[int] = None,
    bathrooms: Optional[int] = None,
    min_budget: Optional[float] = None,
    max_budget: Optional[float] = None,
    purpose: Optional[str] = None,
    near_metro: Optional[bool] = None,
    near_beach: Optional[bool] = None,
    view: Optional[str] = None,
    sort_by: Optional[str] = None,
    main_road_access: Optional[bool] = None,
    availability: Optional[str] = None,
    limit: int = 12,
    min_parking: Optional[int] = None,
    amenity: Optional[List[str]] = None,
):
    try:
        return search_properties_dataset(
            location=location,
            property_type=property_type,
            bedrooms=bedrooms,
            bathrooms=bathrooms,
            min_budget_aed=min_budget,
            max_budget_aed=max_budget,
            purpose=purpose,
            near_metro=near_metro,
            near_beach=near_beach,
            view=view,
            sort_by=sort_by,
            main_road_access=main_road_access,
            availability=availability,
            limit=limit,
            min_parking=min_parking,
            amenities=amenity,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search error: {str(e)}")


@app.post("/api/openai/test", response_model=OpenAITestResponse)
def test_openai(payload: OpenAITestRequest):
    try:
        reply = generate_text_response(payload.message)
        return {"response": reply}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OpenAI error: {str(e)}")
