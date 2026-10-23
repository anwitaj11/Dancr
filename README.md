# Dancr

**Learn the choreography. Practice the movement. See your progress.**

Dancr is a browser-based dance learning app that turns a reference video into a step-by-step practice session. It tracks movement through your webcam, compares your poses with the choreography, and offers feedback as you learn.

**[Live site](https://dancr.vercel.app)** · **[Development preview](https://dancr-git-fix-no-login-reliability-anwitaj11.vercel.app)**

> **Release status:** The latest changes are merged into `main`, but the production deployment is awaiting an update. The preview currently has the newer step editor and persistence improvements.

## What it does

- **Upload choreography** — process a dance video and extract pose landmarks for the reference performance.
- **Edit the steps** — start with suggested cuts, then split, merge, move, and rename sections manually. Auto-splitting is experimental; manual editing is the reliable option.
- **Practice with your webcam** — follow a reference video alongside live pose tracking and movement-based scoring.
- **Get coaching** — receive spoken cues and feedback through ElevenLabs, with browser speech fallback.
- **Track improvement** — save practice attempts and review progress, strengths, and areas to revisit.
- **Keep your library** — the deployed backend supports PostgreSQL-backed dance data and signed video storage through Supabase when configured.

## How it works

```text
Reference video
    ↓
Pose extraction (MediaPipe)
    ↓
Editable choreography steps
    ↓
Webcam practice + pose comparison
    ↓
Feedback, scoring, and progress history
```

Dancr uses pose landmarks and joint angles rather than comparing raw camera images. The interface is built with **React + Vite**; the API uses **Python + FastAPI**. MediaPipe handles pose detection, while Claude and ElevenLabs power optional AI and voice features.

## Run locally

**Requirements:** Node.js, npm, and Python 3.

Start the backend:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

In another terminal, start the frontend:

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173** and allow webcam access when practicing.

The local backend can use SQLite. Hosted persistence and video uploads require additional Supabase/PostgreSQL configuration. See `backend/.env.example` for available settings; never commit credentials.

**Optional integrations:** Claude and ElevenLabs improve coaching and speech, but the app includes fallback behavior when API keys are unavailable.

## Tests

```bash
cd backend && pytest
cd frontend && npm test
```

## Project structure

| Directory | Purpose |
| --- | --- |
| `frontend/src/pages/` | Library, upload, practice, and progress screens |
| `frontend/src/components/` | Step editor, reference player, and pose visualization |
| `frontend/src/lib/` | Video processing, step segmentation, scoring, and API client |
| `backend/app/` | FastAPI routes, storage, coaching, voice, and learning data |
| `docs/` | Dance format and voice-coach setup notes |

For technical details, see [Dance format](docs/dance-format.md) and [Voice coach setup](docs/voice-coach.md).

## Current limitations

Automatic step segmentation uses pose movement and an entered BPM; it does **not** yet analyze audio beats directly. You can adjust every suggested cut in the step editor. Pose tracking and scoring also depend on camera visibility, lighting, and reference-video quality.

---

Built to make learning choreography more interactive, one step at a time.
