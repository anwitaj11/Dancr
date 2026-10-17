# 🎙️ Dancr Coach (ElevenLabs voice agent)

The **🎙️ talk to your coach** button (bottom right of every page) opens a live
voice conversation with your existing ElevenLabs agent, **Dancr Coach**.
You speak through your microphone and the coach answers out loud.

## How it connects (and why your key stays safe)

```
Browser ──GET /voice-agent/session──▶ Dancr backend ──(API key)──▶ ElevenLabs
   ▲                                       │
   └──── short-lived conversation token ◀──┘
Browser ════════ live voice (WebRTC) ════════▶ Dancr Coach agent
```

- The **API key only lives in `backend/.env`** on the computer running the backend.
  The browser only ever receives a short-lived token, and only from your own backend.
- If no API key is set, the backend gives the browser just the Agent ID. That only
  works if the agent is **public** (authentication off). With a key, it works either way.

## Setup on your Mac

1. Open `~/dancr/backend/.env` (create it by copying `.env.example` if it doesn't exist):
   ```bash
   cd ~/dancr/backend
   cp -n .env.example .env
   open -e .env
   ```
2. Fill in these lines and save:
   ```
   ELEVENLABS_API_KEY=your-new-key-here
   ELEVENLABS_AGENT_ID=agent_2601m55mhty9fjcr9eds91nc444r
   ELEVENLABS_VOICE_ID=uYXf8XasLslADfZ2MB4u
   ```
3. Restart the backend window (Ctrl+C, then `uvicorn app.main:app --reload`). `.env` is
   only read at startup.
4. Install the new package once: `cd ~/dancr/frontend && npm install`.
5. Open Dancr, click **🎙️ talk to your coach → start talking**, and allow the microphone.

`.env` is in `.gitignore`, so it never goes to GitHub. Never put the key in any file
under `frontend/`.

## Deploying (later)

Set the same three variables in your host's **environment variables / secrets** settings
for the backend service (for example Render, Railway or Fly.io: *Environment* →
*Add variable*). Don't upload a `.env` file. Then, in the ElevenLabs dashboard, add your
site's domain to the agent's allowed hosts if you've restricted them.

## In the ElevenLabs dashboard

The exact menu names change from time to time, so look for these settings on your
**Dancr Coach** agent:

- **Voice:** in the agent's *Voice* settings, pick the voice with ID
  `uYXf8XasLslADfZ2MB4u` (search for it or paste the ID). Dancr does not override the
  voice from code, so the dashboard choice is what you'll hear.
- **Authentication (recommended: on):** in the agent's *Security* / *Advanced* settings.
  With it on, only your backend (with the API key) can start conversations, so strangers
  can't use up your ElevenLabs credits.
- **API key permissions:** if you create a restricted key, give it access to
  *ElevenLabs Agents* (for the coach) and *Text to Speech* (for the "5, 6, 7, 8!" clips).
- **System prompt:** paste this into the agent's prompt so it behaves like Dancr's coach:

  > You are Dancr Coach, a warm, upbeat dance teacher inside Dancr, a webcam app that
  > teaches viral dances step by step. Explain moves simply: break them into counts
  > ("on 5, step right; on 6, arms up"), name the body part to focus on, and keep
  > answers short enough to say out loud while someone is catching their breath.
  > Be encouraging and specific.
  >
  > Dancr sends you background updates about what it measured: the dance and step,
  > ratings (PERFECT, SUPER, GOOD, OK, KEEP GOING), the weakest joint, timing (early,
  > late, on beat) and learning patterns. Use them to personalise feedback. You cannot
  > see the dancer or their camera: never claim to see them, and never invent ratings
  > Dancr didn't send. Never mention numbers or percentages; use the rating words.
  > If someone seems hurt or in pain, tell them to stop and rest.

- **First message (optional):** e.g. *"Hey! I'm your Dancr coach. Which move are we working on?"*

## What the coach knows

Dancr only tells the coach what it actually measured, as plain-text background updates
(`sendContextualUpdate` in the ElevenLabs React SDK):

| Page | What's sent |
|---|---|
| Practice | dance, step, speed, mirror on/off, last rating, weakest joint, lowest-rated count, timing, body-part ratings, learning patterns, the last written tip |
| My Practice | number of tries and steps, learner type, skill ratings, patterns |
| Home | which dances are in the library |

Updates are sent when the conversation starts and again whenever a new rating comes in.
While you're talking to the coach, the practice page's own spoken tips stay quiet so the
two don't talk over each other.

## If something goes wrong

| Message | Fix |
|---|---|
| "The voice coach isn't set up yet" | Add `ELEVENLABS_AGENT_ID` to `backend/.env` and restart the backend. |
| "Your Dancr Coach agent is private" | Add `ELEVENLABS_API_KEY` to `backend/.env` and restart the backend. |
| "ElevenLabs rejected the API key" | The key is wrong, revoked, or lacks *ElevenLabs Agents* access. |
| "Dancr needs your microphone" | Click the 🔒 icon in Chrome's address bar → allow Microphone → try again. |
| "Can't reach the Dancr backend" | Start the backend window (`uvicorn app.main:app --reload`). |
