import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from . import coach, learner, remix, tts  # noqa: E402
from .db import get_or_create_user, init_db, loads, session  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Dab Lab API", lifespan=lifespan)

# Reference videos for uploaded dances (the dance JSON only holds poses and angles).
MEDIA_DIR = Path(os.getenv("DABLAB_MEDIA", Path(__file__).parent.parent / "media"))
VIDEO_TYPES = {"video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov"}
MAX_VIDEO_BYTES = 200 * 1024 * 1024


def _video_path(dance_id: int) -> Path | None:
    return next(MEDIA_DIR.glob(f"{dance_id}.*"), None) if MEDIA_DIR.exists() else None
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ---------- models ----------

class DanceIn(BaseModel):
    name: str
    bpm: float
    builtin: bool = False
    difficulty: int = 1
    data: dict  # see docs/dance-format.md


class AttemptIn(BaseModel):
    user: str
    dance_id: int
    step_index: int
    overall: float = Field(ge=0, le=1)
    joint_scores: dict[str, float]
    timing_offset: float = 0
    speed: float = 1
    attempt_count: int = 1
    time_spent: float = 0
    passed: bool = False


class CoachIn(BaseModel):
    user: str
    context: dict | None = None


class TTSIn(BaseModel):
    text: str = Field(max_length=300)


class RemixIn(BaseModel):
    request: str = Field(max_length=300)


# ---------- dances ----------

@app.post("/dances")
def create_dance(dance: DanceIn):
    with session() as conn:
        cur = conn.execute(
            "INSERT INTO dances (name, bpm, builtin, difficulty, data) VALUES (?, ?, ?, ?, ?)",
            (dance.name, dance.bpm, int(dance.builtin), dance.difficulty, json.dumps(dance.data)),
        )
        return {"id": cur.lastrowid}


@app.get("/dances")
def list_dances():
    """Library listing: metadata plus step count, without the heavy frame data."""
    with session() as conn:
        rows = conn.execute("SELECT * FROM dances ORDER BY builtin DESC, difficulty, id").fetchall()
    out = []
    for r in rows:
        data = loads(r["data"], {})
        out.append({
            "id": r["id"], "name": r["name"], "bpm": r["bpm"], "builtin": bool(r["builtin"]),
            "difficulty": r["difficulty"], "steps": len(data.get("steps", [])),
            "duration": data["frames"][-1]["t"] if data.get("frames") else 0,
            "hasVideo": _video_path(r["id"]) is not None,
        })
    return out


class DanceUpdate(BaseModel):
    name: str
    bpm: float
    data: dict


@app.put("/dances/{dance_id}")
def replace_dance(dance_id: int, dance: DanceUpdate):
    """Swap in a new recording for an existing dance (e.g. a placeholder built-in),
    keeping its id, library slot, difficulty and everyone's attempt history."""
    with session() as conn:
        cur = conn.execute("UPDATE dances SET name = ?, bpm = ?, data = ? WHERE id = ?",
                           (dance.name, dance.bpm, json.dumps(dance.data), dance_id))
        if cur.rowcount == 0:
            raise HTTPException(404, "dance not found")
    return {"id": dance_id}


@app.delete("/dances/{dance_id}")
def delete_dance(dance_id: int):
    """Remove a dance from the library, with its video and the attempts made on it."""
    with session() as conn:
        conn.execute("DELETE FROM attempts WHERE dance_id = ?", (dance_id,))
        cur = conn.execute("DELETE FROM dances WHERE id = ?", (dance_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, "dance not found")
    if video := _video_path(dance_id):
        video.unlink()
    return {"deleted": dance_id}


@app.get("/dances/{dance_id}")
def get_dance(dance_id: int):
    with session() as conn:
        r = conn.execute("SELECT * FROM dances WHERE id = ?", (dance_id,)).fetchone()
    if not r:
        raise HTTPException(404, "dance not found")
    return {"id": r["id"], "name": r["name"], "bpm": r["bpm"], "builtin": bool(r["builtin"]),
            "difficulty": r["difficulty"], "hasVideo": _video_path(dance_id) is not None,
            "data": loads(r["data"])}


@app.put("/dances/{dance_id}/video")
async def upload_video(dance_id: int, request: Request):
    """Raw video bytes in the body, with the file's Content-Type."""
    ext = VIDEO_TYPES.get(request.headers.get("content-type", "").split(";")[0])
    if not ext:
        raise HTTPException(415, f"video must be one of {', '.join(VIDEO_TYPES)}")
    with session() as conn:
        if not conn.execute("SELECT 1 FROM dances WHERE id = ?", (dance_id,)).fetchone():
            raise HTTPException(404, "dance not found")
    body = await request.body()
    if len(body) > MAX_VIDEO_BYTES:
        raise HTTPException(413, "video too large")
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    if old := _video_path(dance_id):
        old.unlink()
    (MEDIA_DIR / f"{dance_id}{ext}").write_bytes(body)
    return {"ok": True}


@app.get("/dances/{dance_id}/video")
def get_video(dance_id: int):
    path = _video_path(dance_id)
    if not path:
        raise HTTPException(404, "no video for this dance")
    return FileResponse(path)


# ---------- attempts & profile ----------

def _attempt_rows(conn, user_id: int) -> list[dict]:
    rows = conn.execute("SELECT * FROM attempts WHERE user_id = ? ORDER BY id", (user_id,)).fetchall()
    return [{**dict(r), "joint_scores": loads(r["joint_scores"], {}), "passed": bool(r["passed"])} for r in rows]


def build_profile(conn, name: str) -> dict:
    user_id = get_or_create_user(conn, name)
    prof = conn.execute("SELECT * FROM profiles WHERE user_id = ?", (user_id,)).fetchone()
    skills = loads(prof["skills"], {})
    attempts = _attempt_rows(conn, user_id)
    patterns = learner.detect_patterns(attempts, skills)

    sessions: dict[str, list[float]] = {}
    for a in attempts:
        sessions.setdefault(a["created_at"][:10], []).append(a["overall"])
    history = [{"date": d, "avg": round(sum(v) / len(v), 3), "attempts": len(v)} for d, v in sessions.items()]

    return {
        "user": name,
        "skills": skills,
        "patterns": patterns,
        "adaptations": learner.adaptations(patterns),
        "badge": learner.learner_badge(patterns, skills),
        "stats": {
            "attempts": len(attempts),
            "stepsPassed": len({(a["dance_id"], a["step_index"]) for a in attempts if a["passed"]}),
            "timeSpent": round(sum(a["time_spent"] for a in attempts), 1),
        },
        "history": history,
        "lastReport": loads(prof["last_report"]),
    }


@app.post("/attempts")
def create_attempt(a: AttemptIn):
    with session() as conn:
        user_id = get_or_create_user(conn, a.user)
        conn.execute(
            """INSERT INTO attempts (user_id, dance_id, step_index, overall, joint_scores,
               timing_offset, speed, attempt_count, time_spent, passed)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (user_id, a.dance_id, a.step_index, a.overall, json.dumps(a.joint_scores),
             a.timing_offset, a.speed, a.attempt_count, a.time_spent, int(a.passed)),
        )
        prof = conn.execute("SELECT skills FROM profiles WHERE user_id = ?", (user_id,)).fetchone()
        skills = learner.update_skills(loads(prof["skills"], {}), a.joint_scores)
        conn.execute("UPDATE profiles SET skills = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?",
                     (json.dumps(skills), user_id))
        return build_profile(conn, a.user)


@app.get("/profile/{user}")
def get_profile(user: str):
    with session() as conn:
        return build_profile(conn, user)


# ---------- AI coach ----------

@app.post("/coach")
def get_tip(body: CoachIn):
    with session() as conn:
        profile = build_profile(conn, body.user)
    return coach.tip(profile, body.context)


@app.post("/report/{user}")
def make_report(user: str):
    with session() as conn:
        profile = build_profile(conn, user)
        result = coach.report(profile)
        user_id = get_or_create_user(conn, user)
        conn.execute("UPDATE profiles SET last_report = ? WHERE user_id = ?", (json.dumps(result), user_id))
    return result


@app.post("/tts")
def text_to_speech(body: TTSIn):
    try:
        return FileResponse(tts.speak(body.text), media_type="audio/mpeg")
    except tts.TTSUnavailable as e:
        # Frontend falls back to the browser's speechSynthesis on 503.
        raise HTTPException(503, f"tts unavailable: {e}")


@app.post("/tts/pregenerate")
def pregenerate_tts():
    return {"generated": tts.pregenerate()}


@app.post("/remix")
def make_remix(body: RemixIn):
    return remix.remix(body.request)


@app.get("/health")
def health():
    return {"ok": True}
