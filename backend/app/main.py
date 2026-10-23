import json
import os
import re
import time
import uuid
import httpx
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import FileResponse, RedirectResponse  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from . import coach, learner, remix, tts, voice_agent  # noqa: E402
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
    paths = (MEDIA_DIR / f"{dance_id}{ext}" for ext in VIDEO_TYPES.values())
    return next((p for p in paths if p.exists()), None)


def _people_path(dance_id: int) -> Path:
    """Everyone the pose model saw in the video, saved so the dancer can be changed without a rescan."""
    return MEDIA_DIR / f"{dance_id}.people.json"
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])



# Persistent private reference videos. The browser uploads directly to Supabase
# using a short-lived signed upload token; Vercel never receives the large file.
def _storage_config():
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SECRET_KEY", "")
    if not url or not key:
        raise HTTPException(503, "Supabase storage is not configured")
    return url, {"apikey": key, "Authorization": f"Bearer {key}"}


def _video_storage_path(dance_id):
    with session() as conn:
        row = conn.execute("SELECT data FROM dances WHERE id = ?", (dance_id,)).fetchone()
    return loads(row["data"], {}).get("_videoPath") if row else None


@app.post("/dances/{dance_id}/video-upload")
def sign_video_upload(dance_id: int, content_type: str = "video/mp4"):
    ext = VIDEO_TYPES.get(content_type)
    if not ext:
        raise HTTPException(415, "unsupported video type")
    with session() as conn:
        if not conn.execute("SELECT 1 FROM dances WHERE id = ?", (dance_id,)).fetchone():
            raise HTTPException(404, "dance not found")
    url, headers = _storage_config()
    path = f"dances/{dance_id}/{uuid.uuid4().hex}{ext}"
    try:
        r = httpx.post(f"{url}/storage/v1/object/upload/sign/dance-videos/{path}",
                       headers=headers, timeout=15)
        r.raise_for_status()
        token = r.json()["token"]
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        raise HTTPException(502, "Could not create a signed video upload") from exc
    return {"url": f"{url}/storage/v1/object/upload/sign/dance-videos/{path}?token={token}", "path": path}


class UploadedVideo(BaseModel):
    path: str


@app.post("/dances/{dance_id}/video-complete")
def complete_video_upload(dance_id: int, body: UploadedVideo):
    if not re.fullmatch(rf"dances/{dance_id}/[0-9a-f]{{32}}\\.(mp4|mov|webm)", body.path):
        raise HTTPException(400, "invalid video path")
    url, headers = _storage_config()
    try:
        r = httpx.head(f"{url}/storage/v1/object/dance-videos/{body.path}",
                       headers=headers, timeout=15)
    except httpx.HTTPError as exc:
        raise HTTPException(502, "Could not verify uploaded video") from exc
    if r.status_code != 200:
        raise HTTPException(400, "Video has not finished uploading")
    with session() as conn:
        row = conn.execute("SELECT data FROM dances WHERE id = ?", (dance_id,)).fetchone()
        if not row:
            raise HTTPException(404, "dance not found")
        data = loads(row["data"], {})
        data["_videoPath"] = body.path
        conn.execute("UPDATE dances SET data = ? WHERE id = ?", (json.dumps(data), dance_id))
    return {"ok": True}


def _signed_video_url(path):
    url, headers = _storage_config()
    try:
        r = httpx.post(f"{url}/storage/v1/object/sign/dance-videos/{path}",
                       headers=headers, json={"expiresIn": 3600}, timeout=15)
        r.raise_for_status()
        signed = r.json()["signedURL"]
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        raise HTTPException(502, "Could not load saved video") from exc
    if signed.startswith("/storage/v1/"):
        return url + signed
    if signed.startswith("/object/"):
        return url + "/storage/v1" + signed
    if signed.startswith("https://"):
        return signed
    raise HTTPException(502, "Unexpected storage URL")


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
            "hasVideo": bool(loads(r["data"], {}).get("_videoPath")) or _video_path(r["id"]) is not None,
            "dancer": data.get("dancer"),  # which person the lesson follows, if the video has several
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
    _people_path(dance_id).unlink(missing_ok=True)
    return {"deleted": dance_id}


@app.get("/dances/{dance_id}")
def get_dance(dance_id: int):
    with session() as conn:
        r = conn.execute("SELECT * FROM dances WHERE id = ?", (dance_id,)).fetchone()
    if not r:
        raise HTTPException(404, "dance not found")
    return {"id": r["id"], "name": r["name"], "bpm": r["bpm"], "builtin": bool(r["builtin"]),
            "difficulty": r["difficulty"], "hasVideo": bool(loads(r["data"], {}).get("_videoPath")) or _video_path(dance_id) is not None,
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


@app.put("/dances/{dance_id}/people")
async def save_people(dance_id: int, request: Request):
    """The video's multi-person scan (JSON from the browser), kept next to the video."""
    with session() as conn:
        if not conn.execute("SELECT 1 FROM dances WHERE id = ?", (dance_id,)).fetchone():
            raise HTTPException(404, "dance not found")
    body = await request.body()
    if len(body) > MAX_VIDEO_BYTES:
        raise HTTPException(413, "scan too large")
    try:
        json.loads(body)
    except ValueError:
        raise HTTPException(400, "scan must be JSON")
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    _people_path(dance_id).write_bytes(body)
    return {"ok": True}


@app.get("/dances/{dance_id}/people")
def get_people(dance_id: int):
    path = _people_path(dance_id)
    if not path.exists():
        raise HTTPException(404, "no saved scan for this dance")
    return FileResponse(path, media_type="application/json")


# ---------- last take: the latest recording of the dancer practicing ----------

TAKE_TYPES = {"video/webm": ".webm", "video/mp4": ".mp4"}


def _take_base(user: str) -> Path:
    """One recording per user, replaced by every new take."""
    return MEDIA_DIR / "takes" / (re.sub(r"[^A-Za-z0-9_-]", "_", user)[:64] or "_")


def _take_video(user: str) -> Path | None:
    base = _take_base(user)
    return next((p for p in (base.with_suffix(ext) for ext in TAKE_TYPES.values()) if p.exists()), None)


@app.put("/takes/{user}")
async def save_take(user: str, request: Request, dance_id: int, step: str = "", score: float = 0,
                    passed: bool = False, speed: float = 1, start: float = 0, mirror: bool = False):
    """Raw video bytes in the body; details of the try in the query string."""
    ext = TAKE_TYPES.get(request.headers.get("content-type", "").split(";")[0])
    if not ext:
        raise HTTPException(415, f"take must be one of {', '.join(TAKE_TYPES)}")
    with session() as conn:
        row = conn.execute("SELECT name FROM dances WHERE id = ?", (dance_id,)).fetchone()
    if not row:
        raise HTTPException(404, "dance not found")
    body = await request.body()
    if len(body) > MAX_VIDEO_BYTES:
        raise HTTPException(413, "take too large")
    base = _take_base(user)
    base.parent.mkdir(parents=True, exist_ok=True)
    if old := _take_video(user):
        old.unlink()
    base.with_suffix(ext).write_bytes(body)
    meta = {"danceId": dance_id, "danceName": row["name"], "step": step, "score": score, "passed": passed,
            "speed": speed, "start": start, "mirror": mirror, "recordedAt": time.time()}
    base.with_suffix(".json").write_text(json.dumps(meta))
    return meta


@app.get("/takes/{user}")
def get_take(user: str):
    meta = _take_base(user).with_suffix(".json")
    if not meta.exists() or not _take_video(user):
        raise HTTPException(404, "no take yet")
    return json.loads(meta.read_text())


@app.get("/takes/{user}/video")
def get_take_video(user: str):
    if not (path := _take_video(user)):
        raise HTTPException(404, "no take yet")
    return FileResponse(path)


@app.delete("/takes/{user}")
def delete_take(user: str):
    if path := _take_video(user):
        path.unlink()
    _take_base(user).with_suffix(".json").unlink(missing_ok=True)
    return {"deleted": True}


@app.get("/dances/{dance_id}/video")
def get_video(dance_id: int):
    if stored := _video_storage_path(dance_id):
        return RedirectResponse(_signed_video_url(stored), status_code=307)
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


@app.get("/voice-agent/session")
def voice_agent_session():
    """What the browser needs to start a Dancr Coach voice conversation. Never includes the API key."""
    try:
        return voice_agent.session()
    except voice_agent.VoiceAgentError as e:
        raise HTTPException(e.status, e.message)


@app.get("/health")
def health():
    return {"ok": True}
