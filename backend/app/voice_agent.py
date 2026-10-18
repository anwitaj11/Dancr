"""ElevenLabs Conversational AI ("Dancr Coach") session setup.

The browser talks to the agent directly over WebRTC; this module only hands it
what it needs to connect, without ever exposing the API key:

- ELEVENLABS_API_KEY set  -> ask ElevenLabs for a short-lived conversation token
  (works whether or not the agent has authentication turned on).
- no API key              -> return just the Agent ID, which only works when the
  agent is public (authentication off in the ElevenLabs dashboard).
"""

import os

import httpx

TOKEN_URL = "https://api.elevenlabs.io/v1/convai/conversation/token"


def _env(name: str) -> str:
    """Setting from .env, forgiving stray spaces or quotes around the value."""
    return os.getenv(name, "").strip().strip('"').strip("'").strip()


def _reason(response) -> str:
    """ElevenLabs' own explanation from an error response, e.g. a missing permission."""
    try:
        detail = response.json().get("detail")
    except ValueError:
        return ""
    if isinstance(detail, dict):
        return str(detail.get("message") or detail.get("status") or "")
    return str(detail or "")


class VoiceAgentError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def session() -> dict:
    agent_id = _env("ELEVENLABS_AGENT_ID") or _env("AgentID")
    if not agent_id:
        raise VoiceAgentError(503, "The voice coach isn't set up yet: add ELEVENLABS_AGENT_ID to backend/.env.")

    api_key = _env("ELEVENLABS_API_KEY") or _env("ElevenLabsAPI")
    if not api_key:
        return {"mode": "public", "agentId": agent_id}

    try:
        r = httpx.get(TOKEN_URL, params={"agent_id": agent_id}, headers={"xi-api-key": api_key}, timeout=15)
    except httpx.HTTPError:
        raise VoiceAgentError(502, "Couldn't reach ElevenLabs. Check your internet connection and try again.")
    if r.status_code in (401, 403):
        reason = _reason(r)
        raise VoiceAgentError(502, "ElevenLabs rejected the API key"
                                   + (f" ({reason})" if reason else "")
                                   + ". Check ELEVENLABS_API_KEY in backend/.env (no quotes or spaces), that the key"
                                   " wasn't deleted, and that it has access to ElevenLabs Agents.")
    if r.status_code == 404:
        raise VoiceAgentError(502, "ElevenLabs couldn't find that agent. Check ELEVENLABS_AGENT_ID in backend/.env.")
    if r.status_code >= 400:
        raise VoiceAgentError(502, f"ElevenLabs returned an error ({r.status_code}). Try again in a moment.")
    token = r.json().get("token")
    if not token:
        raise VoiceAgentError(502, "ElevenLabs didn't return a conversation token. Try again in a moment.")
    return {"mode": "private", "agentId": agent_id, "conversationToken": token}
