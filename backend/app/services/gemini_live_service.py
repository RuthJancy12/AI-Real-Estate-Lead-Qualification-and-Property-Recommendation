import asyncio
import base64
import json
import logging
import os
from typing import Optional
from dotenv import load_dotenv
from fastapi import WebSocket, WebSocketDisconnect
from google import genai
from google.genai import types

load_dotenv()

logger = logging.getLogger("lyka.gemini_live")
logger.setLevel(logging.INFO)

VOICE_SYSTEM_INSTRUCTION = (
    "You are LYKA Realty's Dubai property assistant.\n\n"
    "CRITICAL LANGUAGE RULES:\n"
    "- Always respond in English by default.\n"
    "- Do not automatically switch to Hindi or any other language.\n"
    "- Use another language ONLY when the user explicitly requests it.\n\n"
    "Tone & Style:\n"
    "- You are friendly, professional, natural, and conversational.\n\n"
    "Conversation Guidelines:\n"
    "- Welcome users naturally and help them explain what kind of property they are looking for in Dubai.\n"
    "- If the user says hello or hi, greet them warmly in English (e.g. 'Hello! How can I help you today?').\n"
    "- If the user asks how you are, respond naturally in English (e.g. 'I\\'m doing well, thank you! How can I help you with Dubai real estate today?').\n"
    "- When the user looks for a home or property (e.g. 'I am looking for a house in Dubai Marina'), respond naturally in English and use search_properties to find matching listings.\n"
    "- Ask useful follow-up questions when important information is missing, such as:\n"
    "  * property type (Apartment, Villa, Townhouse)\n"
    "  * location (Dubai Marina, Downtown Dubai, Palm Jumeirah, etc.)\n"
    "  * BHK / number of bedrooms\n"
    "  * budget in AED\n"
    "  * buy or rent\n"
    "  * preferred amenities\n"
    "- Do not invent property listings, prices, locations, or other property data.\n"
    "- Keep responses concise, helpful, and natural for voice conversation.\n"
    "- Do not sound like a scripted chatbot."
)

DEFAULT_LIVE_MODEL = "gemini-2.5-flash-native-audio-latest"
FALLBACK_LIVE_MODELS = ["gemini-3.8-live", "gemini-3.1-flash-live-preview"]


def get_gemini_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY is not configured in the backend environment.")
    return genai.Client(api_key=api_key)


async def handle_live_voice_session(websocket: WebSocket) -> None:
    """
    Manages a bidirectional real-time audio session between the React frontend
    and Google Gemini Live API.
    """
    await websocket.accept()
    logger.info("Client connected to Gemini Live voice WebSocket.")

    client = None
    try:
        client = get_gemini_client()
    except Exception as e:
        logger.error("Failed to initialize Gemini client: %s", e)
        await websocket.send_json({
            "type": "error",
            "message": f"Gemini configuration error: {str(e)}"
        })
        await websocket.close()
        return

    from app.services.property_service import search_properties_dataset

    def search_properties(
        location: Optional[str] = None,
        property_type: Optional[str] = None,
        bedrooms: Optional[int] = None,
        max_budget_aed: Optional[float] = None,
        purpose: Optional[str] = None
    ) -> str:
        """Searches the real Dubai property dataset for matching listings."""
        res = search_properties_dataset(
            location=location,
            property_type=property_type,
            bedrooms=bedrooms,
            max_budget_aed=max_budget_aed,
            purpose=purpose,
            limit=3
        )
        return json.dumps({
            "total_found": res["total_found"],
            "top_properties": res["ai_summary"]
        })

    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Aoede")
            )
        ),
        system_instruction=types.Content(
            parts=[types.Part.from_text(text=VOICE_SYSTEM_INSTRUCTION)]
        ),
        tools=[search_properties],
        input_audio_transcription=types.AudioTranscriptionConfig(
            language_codes=["en-US", "en"]
        ),
        output_audio_transcription=types.AudioTranscriptionConfig(),
    )

    models_to_try = [DEFAULT_LIVE_MODEL] + FALLBACK_LIVE_MODELS
    session_ctx = None
    active_session = None

    for model_name in models_to_try:
        try:
            logger.info("Attempting connection to Gemini Live with model: %s", model_name)
            session_ctx = client.aio.live.connect(model=model_name, config=config)
            active_session = await session_ctx.__aenter__()
            logger.info("Successfully connected to Gemini Live model: %s", model_name)
            break
        except Exception as e:
            logger.warning("Could not connect to model %s: %s", model_name, e)
            if session_ctx:
                try:
                    await session_ctx.__aexit__(None, None, None)
                except Exception:
                    pass
            session_ctx = None
            active_session = None

    if not active_session:
        await websocket.send_json({
            "type": "error",
            "message": "Failed to connect to any supported Gemini Live model."
        })
        await websocket.close()
        return

    # Notify frontend that Gemini Live is connected and ready
    await websocket.send_json({
        "type": "connected",
        "state": "LISTENING",
        "message": "Connected to Gemini Live Voice Agent."
    })

    stop_event = asyncio.Event()

    async def receive_from_gemini():
        """Reads incoming audio and events from Gemini Live and forwards to the browser."""
        try:
            async for response in active_session.receive():
                if stop_event.is_set():
                    break

                # Handle tool calls from Gemini Live
                if response.tool_call is not None:
                    function_calls = response.tool_call.function_calls or []
                    function_responses = []
                    for fc in function_calls:
                        call_id = fc.id
                        fn_name = fc.name
                        fn_args = fc.args or {}
                        logger.info("Gemini Live tool call: %s(args=%s)", fn_name, fn_args)

                        if fn_name == "search_properties":
                            res_str = search_properties(**fn_args)
                            try:
                                res_obj = json.loads(res_str)
                                await websocket.send_json({
                                    "type": "matched_properties",
                                    "properties": res_obj.get("top_properties", [])
                                })
                            except Exception:
                                pass
                            function_responses.append(
                                types.FunctionResponse(
                                    name=fn_name,
                                    id=call_id,
                                    response={"result": res_str}
                                )
                            )
                        else:
                            function_responses.append(
                                types.FunctionResponse(
                                    name=fn_name,
                                    id=call_id,
                                    response={"result": "ok"}
                                )
                            )

                    if function_responses:
                        try:
                            await active_session.send_tool_response(
                                function_responses=function_responses
                            )
                        except Exception as te:
                            logger.error("Error sending tool response: %s", te)

                server_content = response.server_content
                if server_content is not None:
                    # Check for barge-in / interruption
                    if server_content.interrupted:
                        logger.info("Barge-in detected: Gemini Live interrupted by user.")
                        await websocket.send_json({
                            "type": "interrupted",
                            "state": "LISTENING"
                        })

                    # Input transcription (user's speech recognized by Gemini)
                    if getattr(server_content, "input_transcription", None):
                        trans = server_content.input_transcription
                        text = getattr(trans, "text", "") or ""
                        if text:
                            await websocket.send_json({
                                "type": "transcript",
                                "role": "user",
                                "text": text
                            })

                    # Output transcription (Gemini's speech transcribed)
                    if getattr(server_content, "output_transcription", None):
                        trans = server_content.output_transcription
                        text = getattr(trans, "text", "") or ""
                        if text:
                            await websocket.send_json({
                                "type": "transcript",
                                "role": "model",
                                "text": text
                            })

                    model_turn = server_content.model_turn
                    if model_turn is not None and model_turn.parts:
                        for part in model_turn.parts:
                            if getattr(part, "text", None):
                                await websocket.send_json({
                                    "type": "text",
                                    "text": part.text
                                })

                            if getattr(part, "inline_data", None) and part.inline_data.data:
                                pcm_b64 = base64.b64encode(part.inline_data.data).decode("utf-8")
                                mime = getattr(part.inline_data, "mime_type", "audio/pcm;rate=24000")
                                await websocket.send_json({
                                    "type": "audio",
                                    "data": pcm_b64,
                                    "mime": mime,
                                    "state": "SPEAKING"
                                })

                    if server_content.turn_complete:
                        await websocket.send_json({
                            "type": "turn_complete",
                            "state": "LISTENING"
                        })

        except asyncio.CancelledError:
            pass
        except Exception as e:
            if not stop_event.is_set():
                logger.error("Error receiving from Gemini Live: %s", e)
                try:
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Gemini stream error: {str(e)}"
                    })
                except Exception:
                    pass
        finally:
            stop_event.set()

    async def receive_from_client():
        """Reads user microphone PCM audio chunks and control messages from browser."""
        try:
            while not stop_event.is_set():
                message = await websocket.receive()
                msg_type = message.get("type")

                if msg_type == "websocket.disconnect":
                    logger.info("Client requested disconnect.")
                    break

                # Binary audio frame
                if "bytes" in message and message["bytes"]:
                    pcm_bytes = message["bytes"]
                    await active_session.send_realtime_input(
                        audio=types.Blob(data=pcm_bytes, mime_type="audio/pcm;rate=16000")
                    )

                # Text / JSON payload
                elif "text" in message and message["text"]:
                    try:
                        data = json.loads(message["text"])
                    except json.JSONDecodeError:
                        continue

                    action = data.get("type")

                    if action == "audio":
                        raw_b64 = data.get("data", "")
                        if raw_b64:
                            pcm_bytes = base64.b64decode(raw_b64)
                            await active_session.send_realtime_input(
                                audio=types.Blob(data=pcm_bytes, mime_type="audio/pcm;rate=16000")
                            )

                    elif action == "text":
                        user_text = data.get("text", "")
                        if user_text:
                            await active_session.send_client_content(
                                turns=types.Content(parts=[types.Part.from_text(text=user_text)]),
                                turn_complete=True
                            )

                    elif action == "stop":
                        logger.info("User requested stop voice session.")
                        break

        except WebSocketDisconnect:
            logger.info("WebSocket disconnected by client.")
        except asyncio.CancelledError:
            pass
        except Exception as e:
            if not stop_event.is_set():
                logger.error("Error receiving from client: %s", e)
        finally:
            stop_event.set()

    # Run bidirectional tasks
    gemini_task = asyncio.create_task(receive_from_gemini())
    client_task = asyncio.create_task(receive_from_client())

    done, pending = await asyncio.wait(
        [gemini_task, client_task],
        return_when=asyncio.FIRST_COMPLETED
    )

    for task in pending:
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass

    # Clean up Gemini session
    if session_ctx:
        try:
            await session_ctx.__aexit__(None, None, None)
        except Exception as e:
            logger.warning("Error exiting Gemini session: %s", e)

    # Clean up WebSocket
    try:
        await websocket.close()
    except Exception:
        pass

    logger.info("Live voice session terminated cleanly.")
