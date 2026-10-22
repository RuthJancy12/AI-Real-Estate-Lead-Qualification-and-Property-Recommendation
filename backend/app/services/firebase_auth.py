"""
Firebase ID-token verification for LYKA Realty (optional, non-enforcing).

The chatbot and property search remain public so existing functionality —
including voice and anonymous dataset search — keeps working. When the server
is configured for Firebase (firebase-admin installed AND one of
FIREBASE_PROJECT_ID / FIREBASE_CREDENTIALS_JSON / GOOGLE_APPLICATION_CREDENTIALS
present), a valid `Authorization: Bearer <Firebase ID token>` header is
verified with the Admin SDK and the caller identity is returned. Otherwise
(and on any verification failure) this module returns None and requests
proceed anonymously.

Security rules:
- Never trust a uid/email supplied by the frontend; only verified token claims.
- Service-account private keys stay on the server (env vars), never frontend.
- To enforce auth on an endpoint later, check the return value and raise 401
  when it is None — do not add enforcement silently.
"""

import json
import logging
import os
from typing import Any, Dict, Optional

logger = logging.getLogger("lyka.firebase_auth")

_admin_app_initialized = False


def _ensure_admin() -> bool:
    """Initializes firebase_admin lazily. Returns True when verification is available."""
    global _admin_app_initialized
    if _admin_app_initialized:
        return True
    try:
        import firebase_admin
        from firebase_admin import credentials
    except ImportError:
        logger.info("firebase-admin not installed — Firebase verification disabled.")
        return False

    try:
        project_id = os.getenv("FIREBASE_PROJECT_ID")
        creds_json = os.getenv("FIREBASE_CREDENTIALS_JSON")
        if creds_json:
            cred = credentials.Certificate(json.loads(creds_json))
            firebase_admin.initialize_app(cred, {"projectId": project_id} if project_id else None)
        elif project_id:
            # Uses Application Default Credentials; projectId scopes token checks.
            firebase_admin.initialize_app(options={"projectId": project_id})
        else:
            # GOOGLE_APPLICATION_CREDENTIALS env is honored automatically.
            firebase_admin.initialize_app()
        _admin_app_initialized = True
        logger.info("Firebase Admin initialized for ID-token verification.")
        return True
    except Exception as e:
        logger.warning("Firebase Admin init failed — verification disabled: %s", e)
        return False


def verify_bearer_token(authorization: Optional[str]) -> Optional[Dict[str, Any]]:
    """
    Verifies `Authorization: Bearer <token>` and returns the decoded claims
    (uid, email, ...) or None when unavailable/invalid. Never raises.
    """
    if not authorization or not authorization.startswith("Bearer "):
        return None
    if not _ensure_admin():
        return None
    token = authorization[len("Bearer "):].strip()
    if not token:
        return None
    try:
        from firebase_admin import auth as admin_auth
        claims = admin_auth.verify_id_token(token)
        return {"uid": claims.get("uid"), "email": claims.get("email")}
    except Exception as e:
        logger.info("Firebase token verification failed: %s", e)
        return None
