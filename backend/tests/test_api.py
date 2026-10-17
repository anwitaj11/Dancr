import os
import tempfile

os.environ["DABLAB_DB"] = tempfile.mktemp(suffix=".db")
os.environ["DABLAB_MEDIA"] = tempfile.mkdtemp()
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

        assert client.get(f"/dances/{dance_id}").json()["hasVideo"] is False
        assert client.put(f"/dances/{dance_id}/video", content=b"x", headers={"content-type": "text/plain"}).status_code == 415
        assert client.put(f"/dances/{dance_id}/video", content=b"fakemp4", headers={"content-type": "video/mp4"}).status_code == 200
        assert client.get(f"/dances/{dance_id}").json()["hasVideo"] is True
        assert client.get(f"/dances/{dance_id}/video").content == b"fakemp4"
        assert client.get("/dances").json()[0]["hasVideo"] is True

        new = {"name": "Real Dab", "bpm": 96, "data": {**DANCE["data"], "fps": 24}}
        assert client.put(f"/dances/{dance_id}", json=new).status_code == 200
        replaced = client.get(f"/dances/{dance_id}").json()
        assert (replaced["name"], replaced["bpm"], replaced["data"]["fps"]) == ("Real Dab", 96, 24)
        assert client.put("/dances/999", json=new).status_code == 404

        # a second dance, deleted along with its video and attempts
        doomed = client.post("/dances", json=DANCE).json()["id"]
        client.put(f"/dances/{doomed}/video", content=b"vid", headers={"content-type": "video/mp4"})
        attempt(client, dance_id=doomed)
        assert client.delete(f"/dances/{doomed}").status_code == 200
        assert client.get(f"/dances/{doomed}").status_code == 404
        assert client.get(f"/dances/{doomed}/video").status_code == 404
        assert client.get("/profile/sam").json()["stats"]["attempts"] == 0
        assert client.delete(f"/dances/{doomed}").status_code == 404

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


def test_voice_agent_session(monkeypatch):
    from app import voice_agent

    with TestClient(app) as client:
        monkeypatch.delenv("ELEVENLABS_AGENT_ID", raising=False)
        assert client.get("/voice-agent/session").status_code == 503

        # No key: public agent, browser connects with the Agent ID only.
        monkeypatch.setenv("ELEVENLABS_AGENT_ID", "agent_test")
        assert client.get("/voice-agent/session").json() == {"mode": "public", "agentId": "agent_test"}

        # With a key: the backend fetches a short-lived token; the key never leaves the server.
        monkeypatch.setenv("ELEVENLABS_API_KEY", "sk_secret")
        seen = {}

        class FakeResponse:
            def __init__(self, status, body):
                self.status_code, self._body = status, body

            def json(self):
                return self._body

        def fake_get(url, params, headers, timeout):
            seen.update(url=url, params=params, headers=headers)
            return FakeResponse(200, {"token": "tok_123"})

        monkeypatch.setattr(voice_agent.httpx, "get", fake_get)
        body = client.get("/voice-agent/session").json()
        assert body == {"mode": "private", "agentId": "agent_test", "conversationToken": "tok_123"}
        assert "sk_secret" not in str(body)
        assert seen["params"] == {"agent_id": "agent_test"} and seen["headers"]["xi-api-key"] == "sk_secret"

        monkeypatch.setattr(voice_agent.httpx, "get", lambda *a, **k: FakeResponse(401, {}))
        r = client.get("/voice-agent/session")
        assert r.status_code == 502 and "rejected the API key" in r.json()["detail"]


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
