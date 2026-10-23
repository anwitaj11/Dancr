import json
import os
import re
import time
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import FileResponse, RedirectResponse
import httpx  # noqa: E402
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

# Verify Supabase access tokens with the Auth service, never trust a username supplied
# by the browser. Protected routes can access request.state.account_id.
@app.middleware("http")
async def authenticate(request: Request, call_next):
    from fastapi.responses import JSONResponse
    if request.method == "OPTIONS" or request.url.path.startswith("/health"):
        return await call_next(request)
    header = request.headers.get("authorization", "")
    if not header.startswith("Bearer "):
        # Public demo: visitors can browse shared dances without an account.
        # All mutations and account-specific routes still require authentication.
        public_read = request.method == "GET" and (
            request.url.path == "/dances" or
            (request.url.path.startswith("/dances/") and
             request.url.path.count("/") == 2 and request.url.path.split("/")[-1].isdigit()) or
            (request.url.path.startswith("/dances/") and request.url.path.endswith("/video-url"))
        )
        if public_read:
            request.state.account_id = "guest"
            return await call_next(request)
        return JSONResponse(status_code=401, content={"detail": "Sign in to save dances and track progress."})
    config = _storage_config()
    if not config:
        return JSONResponse(status_code=503, content={"detail": "Authentication is not configured."})
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                f"{config[0]}/auth/v1/user",
                headers={"apikey": config[1], "Authorization": header},
            )
        if response.status_code != 200:
            return JSONResponse(status_code=401, content={"detail": "Session expired. Sign in again."})
        account_id = response.json().get("id")
        if not account_id:
            return JSONResponse(status_code=401, content={"detail": "Invalid account."})
        request.state.account_id = account_id
        return await call_next(request)
    except httpx.HTTPError:
        return JSONResponse(status_code=503, content={"detail": "Authentication service unavailable."})


def _owner(request: Request):
    return request.state.account_id


def _assert_readable(conn, dance_id: int, account_id: str):
    row = conn.execute("SELECT owner_id FROM dances WHERE id = ?", (dance_id,)).fetchone()
    if not row or (row["owner_id"] is not None and str(row["owner_id"]) != account_id):
        raise HTTPException(404, "dance not found")


def _assert_owned(conn, dance_id: int, account_id: str):
    row = conn.execute("SELECT owner_id FROM dances WHERE id = ?", (dance_id,)).fetchone()
    if not row:
        raise HTTPException(404, "dance not found")
    if str(row["owner_id"] or "") != account_id:
        raise HTTPException(403, "You can only change your own dances")





# Private Supabase Storage; server-side secret never reaches the browser.
def _storage_config():
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SECRET_KEY", "")
    return (url, key) if url and key else None


def _storage_headers():
    config = _storage_config()
    if not config:
        raise HTTPException(503, "Supabase storage not configured")
    return {"apikey": config[1], "Authorization": f"Bearer {config[1]}"}


def _stored_video_name(dance_id):
    with session() as conn:
        row = conn.execute("SELECT data FROM dances WHERE id = ?", (dance_id,)).fetchone()
    if not row:
        return None
    return loads(row["data"], {}).get("_videoPath")


def _signed_storage_url(path, expires=3600):
    config = _storage_config()
    if not config:
        raise HTTPException(503, "Supabase storage not configured")
    with httpx.Client(timeout=15) as client:
        r = client.post(
            f"{config[0]}/storage/v1/object/sign/dance-videos/{path}",
            headers=_storage_headers(), json={"expiresIn": expires})
    if r.status_code >= 400:
        raise HTTPException(502, "Unable to retrieve private video")
    signed = r.json().get("signedURL", "")
    if signed.startswith(("https://", "http://")):
        return signed
    # Supabase returns /object/sign/...; it is relative to /storage/v1,
    # not to the project root. A root-relative redirect returns "requested path is invalid".
    if signed.startswith("/storage/v1/"):
        return config[0] + signed
    if signed.startswith("/object/"):
        return config[0] + "/storage/v1" + signed
    raise HTTPException(502, "Storage returned an unexpected signed video URL")


@app.post("/dances/{dance_id}/video-upload")
def create_video_upload(dance_id: int, request: Request, content_type: str = "video/mp4"):
    ext = VIDEO_TYPES.get(content_type)
    if not ext:
        raise HTTPException(415, "unsupported video type")
    with session() as conn:
        _assert_owned(conn, dance_id, _owner(request))
    config = _storage_config()
    if not config:
        raise HTTPException(503, "Supabase storage not configured")
    path = f"dances/{dance_id}/{int(time.time() * 1000)}{ext}"
    with httpx.Client(timeout=15) as client:
        r = client.post(
            f"{config[0]}/storage/v1/object/upload/sign/dance-videos/{path}",
            headers=_storage_headers())
    if r.status_code >= 400:
        raise HTTPException(502, "Unable to authorize private video upload")
    token = r.json().get("token")
    if not token:
        raise HTTPException(502, "Storage did not issue an upload token")
    return {"url": f"{config[0]}/storage/v1/object/upload/sign/dance-videos/{path}?token={token}",
            "path": path}


class VideoUploaded(BaseModel):
    path: str


@app.post("/dances/{dance_id}/video-complete")
def video_complete(dance_id: int, body: VideoUploaded, request: Request):
    if not re.fullmatch(rf"dances/{dance_id}/[0-9]+\.(mp4|mov|webm)", body.path):
        raise HTTPException(400, "invalid video path")
    with session() as conn:
        _assert_owned(conn, dance_id, _owner(request))
        row = conn.execute("SELECT data FROM dances WHERE id = ?", (dance_id,)).fetchone()
        data = loads(row["data"], {})
        data["_videoPath"] = body.path
        conn.execute("UPDATE dances SET data = ? WHERE id = ?", (json.dumps(data), dance_id))
    return {"ok": True}

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
def create_dance(dance: DanceIn, request: Request):
    with session() as conn:
        cur = conn.execute(
            "INSERT INTO dances (name, bpm, builtin, difficulty, data, owner_id) VALUES (?, ?, ?, ?, ?, ?)",
            (dance.name, dance.bpm, 0, dance.difficulty, json.dumps(dance.data), _owner(request)),
        )
        return {"id": cur.lastrowid}


@app.get("/dances")
def list_dances(request: Request):
    """Library listing: metadata plus step count, without the heavy frame data."""
    with session() as conn:
        rows = conn.execute("SELECT * FROM dances WHERE owner_id IS NULL OR owner_id = ? ORDER BY builtin DESC, difficulty, id", (_owner(request),)).fetchall()
    out = []
    for r in rows:
        data = loads(r["data"], {})
        out.append({
            "id": r["id"], "name": r["name"], "bpm": r["bpm"], "builtin": bool(r["builtin"]),
            "mine": str(r["owner_id"] or "") == _owner(request),
            "difficulty": r["difficulty"], "steps": len(data.get("steps", [])),
            "duration": data["frames"][-1]["t"] if data.get("frames") else 0,
            "hasVideo": bool(data.get("_videoPath")) or _video_path(r["id"]) is not None,
            "dancer": data.get("dancer"),  # which person the lesson follows, if the video has several
        })
    return out


class DanceUpdate(BaseModel):
    name: str
    bpm: float
    data: dict


@app.put("/dances/{dance_id}")
def replace_dance(dance_id: int, dance: DanceUpdate, request: Request):
    """Swap in a new recording for an existing dance (e.g. a placeholder built-in),
    keeping its id, library slot, difficulty and everyone's attempt history."""
    with session() as conn:
        _assert_owned(conn, dance_id, _owner(request))
        cur = conn.execute("UPDATE dances SET name = ?, bpm = ?, data = ? WHERE id = ?",
                           (dance.name, dance.bpm, json.dumps(dance.data), dance_id))
        if cur.rowcount == 0:
            raise HTTPException(404, "dance not found")
    return {"id": dance_id}


@app.delete("/dances/{dance_id}")
def delete_dance(dance_id: int, request: Request):
    """Remove a dance from the library, with its video and the attempts made on it."""
    with session() as conn:
        _assert_owned(conn, dance_id, _owner(request))
        conn.execute("DELETE FROM attempts WHERE dance_id = ?", (dance_id,))
        cur = conn.execute("DELETE FROM dances WHERE id = ?", (dance_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, "dance not found")
    if video := _video_path(dance_id):
        video.unlink()
    _people_path(dance_id).unlink(missing_ok=True)
    return {"deleted": dance_id}


@app.get("/dances/{dance_id}")
def get_dance(dance_id: int, request: Request):
    with session() as conn:
        r = conn.execute("SELECT * FROM dances WHERE id = ?", (dance_id,)).fetchone()
    if not r:
        raise HTTPException(404, "dance not found")
    if r["owner_id"] is not None and str(r["owner_id"]) != _owner(request):
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
        _assert_owned(conn, dance_id, _owner(request))
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
        _assert_owned(conn, dance_id, _owner(request))
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
def get_people(dance_id: int, request: Request):
    with session() as conn:
        _assert_readable(conn, dance_id, _owner(request))
    path = _people_path(dance_id)
    if not path.exists():
        raise HTTPException(404, "no saved scan for this dance")
    return FileResponse(path, media_type="application/json")


# ---------- persistent private practice recordings ----------

TAKE_TYPES = {"video/webm": ".webm", "video/mp4": ".mp4"}


def _take_row(user: str):
    with session() as conn:
        return conn.execute("SELECT path, metadata FROM practice_takes WHERE owner_id = ?", (user,)).fetchone()


@app.post("/takes/{user}/upload-url")
def take_upload_url(user: str, request: Request, content_type: str = "video/webm"):
    if user != _owner(request):
        raise HTTPException(403, "Cannot access another account")
    ext = TAKE_TYPES.get(content_type)
    if not ext:
        raise HTTPException(415, "Unsupported practice recording format")
    config = _storage_config()
    if not config:
        raise HTTPException(503, "Supabase storage not configured")
    path = f"takes/{user}/{int(time.time() * 1000)}{ext}"
    with httpx.Client(timeout=15) as client:
        response = client.post(f"{config[0]}/storage/v1/object/upload/sign/dance-videos/{path}", headers=_storage_headers())
    if response.status_code >= 400 or not response.json().get("token"):
        raise HTTPException(502, "Unable to authorize practice upload")
    return {"url": f"{config[0]}/storage/v1/object/upload/sign/dance-videos/{path}?token={response.json()['token']}", "path": path}


class TakeComplete(BaseModel):
    path: str
    dance_id: int
    step: str = ""
    score: float = Field(default=0, ge=0, le=1)
    passed: bool = False
    speed: float = 1
    start: float = 0
    mirror: bool = False


@app.post("/takes/{user}/complete")
def complete_take(user: str, body: TakeComplete, request: Request):
    if user != _owner(request):
        raise HTTPException(403, "Cannot access another account")
    if not re.fullmatch(rf"takes/{re.escape(user)}/[0-9]+\\.(webm|mp4)", body.path):
        raise HTTPException(400, "Invalid practice recording path")
    with session() as conn:
        _assert_readable(conn, body.dance_id, user)
        dance = conn.execute("SELECT name FROM dances WHERE id = ?", (body.dance_id,)).fetchone()
        old = conn.execute("SELECT path FROM practice_takes WHERE owner_id = ?", (user,)).fetchone()
        meta = {"danceId": body.dance_id, "danceName": dance["name"], "step": body.step,
                "score": body.score, "passed": body.passed, "speed": body.speed,
                "start": body.start, "mirror": body.mirror, "recordedAt": time.time()}
        conn.execute("""INSERT INTO practice_takes (owner_id, path, metadata) VALUES (?, ?, ?)
                     ON CONFLICT (owner_id) DO UPDATE SET path = EXCLUDED.path, metadata = EXCLUDED.metadata""",
                     (user, body.path, json.dumps(meta)))
    # Best effort cleanup; a failed cleanup must not lose the newly saved take.
    if old and old["path"] != body.path:
        try:
            with httpx.Client(timeout=15) as client:
                client.request("DELETE", f"{_storage_config()[0]}/storage/v1/object/dance-videos",
                               headers=_storage_headers(), json={"prefixes": [old["path"]]})
        except httpx.HTTPError:
            pass
    return meta


@app.get("/takes/{user}")
def get_take(user: str, request: Request):
    if user != _owner(request):
        raise HTTPException(403, "Cannot access another account")
    row = _take_row(user)
    return json.loads(row["metadata"]) if row else None


@app.get("/takes/{user}/video-url")
def get_take_video_url(user: str, request: Request):
    if user != _owner(request):
        raise HTTPException(403, "Cannot access another account")
    row = _take_row(user)
    if not row:
        raise HTTPException(404, "No recording yet")
    return {"url": _signed_storage_url(row["path"])}


@app.delete("/takes/{user}")
def delete_take(user: str, request: Request):
    if user != _owner(request):
        raise HTTPException(403, "Cannot access another account")
    with session() as conn:
        row = conn.execute("SELECT path FROM practice_takes WHERE owner_id = ?", (user,)).fetchone()
        if row:
            conn.execute("DELETE FROM practice_takes WHERE owner_id = ?", (user,))
    if row:
        try:
            with httpx.Client(timeout=15) as client:
                client.request("DELETE", f"{_storage_config()[0]}/storage/v1/object/dance-videos",
                               headers=_storage_headers(), json={"prefixes": [row["path"]]})
        except httpx.HTTPError:
            pass
    return {"deleted": bool(row)}


@app.get("/dances/{dance_id}/video-url")
def get_video_url(dance_id: int, request: Request):
    """Return a short-lived signed playback URL after checking ownership."""
    with session() as conn:
        _assert_readable(conn, dance_id, _owner(request))
    stored = _stored_video_name(dance_id)
    if not stored:
        raise HTTPException(404, "No cloud video for this dance")
    return {"url": _signed_storage_url(stored)}


@app.get("/dances/{dance_id}/video")
def get_video(dance_id: int, request: Request):
    with session() as conn:
        _assert_readable(conn, dance_id, _owner(request))
    stored = _stored_video_name(dance_id)
    if stored:
        return RedirectResponse(_signed_storage_url(stored))
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
def create_attempt(a: AttemptIn, request: Request):
    a.user = _owner(request)
    with session() as conn:
        _assert_readable(conn, a.dance_id, _owner(request))
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
def get_profile(user: str, request: Request):
    if user != _owner(request):
        raise HTTPException(403, 'Cannot access another account')
    with session() as conn:
        return build_profile(conn, user)


# ---------- AI coach ----------

@app.post("/coach")
def get_tip(body: CoachIn, request: Request):
    body.user = _owner(request)
    with session() as conn:
        profile = build_profile(conn, body.user)
    return coach.tip(profile, body.context)


@app.post("/report/{user}")
def make_report(user: str, request: Request):
    if user != _owner(request):
        raise HTTPException(403, 'Cannot access another account')
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


@app.get("/health/database")
def database_health():
    """Temporary non-sensitive connectivity check for deployment debugging."""
    from .db import connect
    try:
        conn = connect()
        try:
            conn.execute("SELECT 1").fetchone()
        finally:
            conn.close()
        return {"database": "connected"}
    except Exception as exc:
        # Do not expose connection strings, hostnames, or credentials.
        from fastapi.responses import JSONResponse
        kind = type(exc).__name__
        message = str(exc).lower()
        if "password authentication failed" in message or "invalid password" in message:
            cause = "authentication_failed"
        elif "name or service not known" in message or "could not translate host" in message or "nodename nor servname" in message:
            cause = "hostname_resolution_failed"
        elif "network is unreachable" in message or "no route to host" in message:
            cause = "network_unreachable"
        elif "connection refused" in message:
            cause = "connection_refused"
        elif "timeout" in message or "timed out" in message:
            cause = "connection_timeout"
        elif "certificate" in message or "ssl" in message:
            cause = "tls_error"
        elif "database" in message and "does not exist" in message:
            cause = "database_not_found"
        elif "invalid" in message and ("uri" in message or "dsn" in message or "port" in message):
            cause = "invalid_connection_string"
        else:
            cause = "other_connection_error"
        return JSONResponse(status_code=503, content={"database": "unavailable", "error_type": kind, "cause": cause})
