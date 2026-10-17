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


class VoiceAgentError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def session() -> dict:
    agent_id = os.getenv("ELEVENLABS_AGENT_ID", "").strip()
    if not agent_id:
        raise VoiceAgentError(503, "The voice coach isn't set up yet: add ELEVENLABS_AGENT_ID to backend/.env.")

    api_key = os.getenv("ELEVENLABS_API_KEY", "").strip()
    if not api_key:
        return {"mode": "public", "agentId": agent_id}

    try:
        r = httpx.get(TOKEN_URL, params={"agent_id": agent_id}, headers={"xi-api-key": api_key}, timeout=15)
    except httpx.HTTPError:
        raise VoiceAgentError(502, "Couldn't reach ElevenLabs. Check your internet connection and try again.")
    if r.status_code in (401, 403):
        raise VoiceAgentError(502, "ElevenLabs rejected the API key. Check ELEVENLABS_API_KEY in backend/.env "
                                   "and that the key has access to ElevenLabs Agents.")
    if r.status_code == 404:
        raise VoiceAgentError(502, "ElevenLabs couldn't find that agent. Check ELEVENLABS_AGENT_ID in backend/.env.")
    if r.status_code >= 400:
        raise VoiceAgentError(502, f"ElevenLabs returned an error ({r.status_code}). Try again in a moment.")
    token = r.json().get("token")
    if not token:
        raise VoiceAgentError(502, "ElevenLabs didn't return a conversation token. Try again in a moment.")
    return {"mode": "private", "agentId": agent_id, "conversationToken": token}
