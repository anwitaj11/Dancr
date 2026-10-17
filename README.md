# ✦ Dancr

An AI dance coach that teaches you 2016's dances through your webcam, watches
how you move, works out how you learn, and adapts each lesson to you.

- **Body tracking**: MediaPipe Pose runs in the browser. The video never leaves the device.
- **Scoring**: compares 12 full-body angles (arms, hips, knees, feet, leg spread, torso lean) to the reference, so it works for any body size. Joints the camera can't see are skipped, not counted wrong. Scores show as a match percentage; 70%+ completes a step.
- **Learning tracker**: every attempt updates a skill score per body part and detects your learning patterns.
- **AI coach**: Claude writes the tips and session reports, and ElevenLabs speaks them.

## Quick start

```bash
# 1. Backend (FastAPI + SQLite), port 8000
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # add ANTHROPIC_API_KEY and ELEVENLABS_API_KEY
uvicorn app.main:app --reload

# 2. Frontend (React + Vite), port 5173
cd frontend
npm install                     # also copies the MediaPipe wasm into public/
npm run seed                    # adds the placeholder built-in dances
npm run dev
```

Open http://localhost:5173 and allow camera access.

**No API keys?** Everything still runs. The coach falls back to rule-based tips,
and the voice falls back to the browser's built-in speech.

## Tests

```bash
cd backend && pytest            # API flow, skill EMA, learner patterns
cd frontend && npm test         # angles, scoring, timing, steps, remix
```

## Layout → checklist

| Process | Where |
|---|---|
| 1. Library & upload | `frontend/src/lib/processVideo.js`, `dance.js`, `steps.js`, `pages/Upload.jsx`, `pages/Library.jsx`, `components/SkeletonPlayer.jsx` |
| 2. Live tracking | `hooks/useWebcamPose.js`, `lib/pose.js`, `lib/angles.js` (8 angles, smoothing, in-frame check), `pages/Calibrate.jsx` |
| 3. Scoring & practice | `lib/scoring.js` (per-joint score, colors, ±0.5 s timing, loop stats), `pages/Practice.jsx` |
| 4. Backend & data | `backend/app/db.py` (tables), `backend/app/main.py` (endpoints) |
| 5. Learning tracker | `backend/app/learner.py` (EMA skills, 🐢⚡🎯⏱️📉 rules → lesson settings) |
| 6. AI coach | `backend/app/coach.py` (Claude tips + report), `backend/app/tts.py` (ElevenLabs + cache), `frontend/src/lib/voice.js` |
| 7. Dashboard | `pages/Dashboard.jsx` |
| 8. Style remix (stretch) | `frontend/src/lib/remix.js`, `backend/app/remix.py`, `pages/Remix.jsx` |
| 9. Share (stretch) | `components/VineRecorder.jsx` |
| 10. 2016 design | `frontend/src/styles.css` |

The data format is in [`docs/dance-format.md`](docs/dance-format.md).

The 🎙️ voice coach (ElevenLabs agent) setup is in [`docs/voice-coach.md`](docs/voice-coach.md).

## API

| Method | Path | What it does |
|---|---|---|
| `POST` | `/dances` | Save a dance (`{name, bpm, builtin, difficulty, data}`) |
| `GET` | `/dances` | List the library (metadata only) |
| `GET` | `/dances/{id}` | Full dance JSON, plus `hasVideo` |
| `PUT` | `/dances/{id}` | Replace a dance's recording in place (`{name, bpm, data}`) |
| `PUT` | `/dances/{id}/video` | Store the original clip (raw body, `video/mp4`, `video/webm` or `video/quicktime`) |
| `GET` | `/dances/{id}/video` | The original clip, shown as the tutorial on the practice screen |
| `POST` | `/attempts` | Save a loop result and get back the updated profile |
| `GET` | `/profile/{user}` | Skills, patterns, adaptations, badge, history |
| `POST` | `/coach` | One-sentence tip (`{user, context}`) |
| `POST` | `/report/{user}` | Strengths, weaknesses, and a plan; saved as the latest report |
| `POST` | `/tts` | MP3 of the text, cached on disk (503 if no key, and the frontend falls back) |
| `POST` | `/tts/pregenerate` | Pre-generates "5, 6, 7, 8!", "Nice!", and the other stock lines |
| `GET` | `/voice-agent/session` | How the browser connects to the Dancr Coach voice agent (a short-lived token; never the API key) |
| `POST` | `/remix` | Turns a preset name or a free-text request into remix settings plus an explanation |

## Still to do

- [ ] **Record the real reference videos.** On the Upload page, choose "Replace Dab" (or another built-in)
  under "Add it as", pick your recording, and save. The dance keeps its library slot and everyone's history,
  and the feed and practice screen switch from the neon demo figure to your video.
- [ ] Hand-check each built-in's step boundaries (`steps` in the dance JSON) against the choreography.
- [ ] Tune the thresholds on real dancers: `PASS_SCORE` and the 45° falloff in `scoring.js`, and
  the pattern thresholds in `learner.py`.
- [ ] Run `POST /tts/pregenerate` once the ElevenLabs key is in.
- [ ] Test in the Klaus Atrium lighting.
