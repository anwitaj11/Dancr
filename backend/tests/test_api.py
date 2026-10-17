import os
import tempfile

os.environ["DABLAB_DB"] = tempfile.mktemp(suffix=".db")
os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ.pop("ELEVENLABS_API_KEY", None)

from fastapi.testclient import TestClient  # noqa: E402

from app import learner  # noqa: E402
from app.main import app  # noqa: E402

JOINTS = learner.JOINTS
DANCE = {
    "name": "Test Dab", "bpm": 120,
    "data": {"version": 1, "fps": 30, "frames": [{"t": 0, "angles": {}}, {"t": 4.0, "angles": {}}],
             "steps": [{"index": 0, "start": 0, "end": 4}]},
}


def scores(value, **overrides):
    return {j: overrides.get(j, value) for j in JOINTS}


def attempt(client, **kw):
    body = {"user": "sam", "dance_id": 1, "step_index": 0, "overall": 0.5,
            "joint_scores": scores(0.5), **kw}
    r = client.post("/attempts", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_full_flow():
    with TestClient(app) as client:
        dance_id = client.post("/dances", json=DANCE).json()["id"]
        listing = client.get("/dances").json()
        assert listing[0]["steps"] == 1 and listing[0]["duration"] == 4.0
        assert client.get(f"/dances/{dance_id}").json()["data"]["fps"] == 30
        assert client.get("/dances/999").status_code == 404

        # five weak, late tries on one step → slow + timing + legs detail drill
        for _ in range(5):
            profile = attempt(client, dance_id=dance_id, timing_offset=-0.3,
                              joint_scores=scores(0.8, leftKnee=0.3, rightKnee=0.4))
        ids = {p["id"] for p in profile["patterns"]}
        assert {"slow", "timing", "details"} <= ids
        assert profile["adaptations"]["chunkCounts"] == 4
        assert profile["adaptations"]["drill"]["part"] == "legs"
        assert profile["adaptations"]["rhythmMode"] is True
        assert profile["stats"]["attempts"] == 5

        tip = client.post("/coach", json={"user": "sam", "context": {"timingOffset": -0.3}}).json()
        assert tip["source"] == "rules" and "late" in tip["tip"]

        report = client.post("/report/sam").json()
        assert report["strengths"]
        assert client.get("/profile/sam").json()["lastReport"] == report

        assert client.post("/tts", json={"text": "Nice!"}).status_code == 503
        assert client.post("/remix", json={"request": "chill"}).json()["speed"] == 0.5


def test_skill_ema():
    s = learner.update_skills({}, {"leftElbow": 1.0})
    s = learner.update_skills(s, {"leftElbow": 0.0})
    assert s["joints"]["leftElbow"] == 0.7
    assert s["parts"]["arms"] == 0.7


def test_fast_learner_and_plateau():
    fast = [{"dance_id": 1, "step_index": i, "overall": 0.9, "timing_offset": 0, "passed": True}
            for i in range(3)]
    assert "fast" in {p["id"] for p in learner.detect_patterns(fast, {})}

    stuck = [{"dance_id": 1, "step_index": 0, "overall": 0.6, "timing_offset": 0, "passed": False}
             for _ in range(6)]
    ids = {p["id"] for p in learner.detect_patterns(stuck, {})}
    assert {"plateau", "slow"} <= ids
    assert learner.adaptations(learner.detect_patterns(stuck, {}))["suggestBreak"]
