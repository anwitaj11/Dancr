"""Learning tracker: per-body-part skill scores and learner-pattern rules.

Everything here is pure (no DB access) so it is easy to test and tweak.
"""

from statistics import mean, median

JOINTS = [
    "leftElbow", "rightElbow", "leftShoulder", "rightShoulder",
    "leftHip", "rightHip", "leftKnee", "rightKnee",
]

BODY_PARTS = {
    "arms": ["leftElbow", "rightElbow", "leftShoulder", "rightShoulder"],
    "torso": ["leftHip", "rightHip"],
    "legs": ["leftKnee", "rightKnee"],
}

EMA_OLD, EMA_NEW = 0.7, 0.3
PASS_SCORE = 0.7  # SUPER or better, matches frontend/src/lib/scoring.js
DETAIL_THRESHOLD = 0.6
TIMING_THRESHOLD = 0.15  # seconds


def update_skills(skills: dict, joint_scores: dict) -> dict:
    """new = 0.7 * old + 0.3 * latest, per joint, then roll up to body parts."""
    joints = dict(skills.get("joints", {}))
    for joint, score in joint_scores.items():
        if joint not in JOINTS:
            continue
        old = joints.get(joint)
        joints[joint] = score if old is None else EMA_OLD * old + EMA_NEW * score
    parts = {
        part: round(mean(joints[j] for j in members if j in joints), 3)
        for part, members in BODY_PARTS.items()
        if any(j in joints for j in members)
    }
    return {"joints": {j: round(v, 3) for j, v in joints.items()}, "parts": parts}


def _attempts_per_passed_step(attempts: list[dict]) -> list[int]:
    """How many tries each passed (dance, step) took, in the order they were passed."""
    counts, tries = [], {}
    for a in attempts:
        key = (a["dance_id"], a["step_index"])
        tries[key] = tries.get(key, 0) + 1
        if a["passed"] and key not in {k for k, _ in counts}:
            counts.append((key, tries[key]))
    return [n for _, n in counts]


def detect_patterns(attempts: list[dict], skills: dict) -> list[dict]:
    """attempts: oldest first. Returns the patterns that currently apply."""
    patterns = []
    if not attempts:
        return patterns

    passed = _attempts_per_passed_step(attempts)
    current = attempts[-1]
    current_key = (current["dance_id"], current["step_index"])
    current_tries = sum(1 for a in attempts if (a["dance_id"], a["step_index"]) == current_key)
    current_passed = any(a["passed"] for a in attempts if (a["dance_id"], a["step_index"]) == current_key)

    if (passed and mean(passed) > 4) or (not current_passed and current_tries > 4):
        patterns.append({"id": "slow", "emoji": "🐢", "label": "Steady Learner",
                         "detail": "Taking more than 4 tries per step"})
    elif len(passed) >= 2 and mean(passed[-3:]) <= 2:
        patterns.append({"id": "fast", "emoji": "⚡", "label": "Quick Learner",
                         "detail": "Passing steps in 1–2 tries"})

    parts = skills.get("parts", {})
    if parts:
        weakest = min(parts, key=parts.get)
        if parts[weakest] < DETAIL_THRESHOLD:
            joints = skills.get("joints", {})
            weakest_joint = min(BODY_PARTS[weakest], key=lambda j: joints.get(j, 1))
            patterns.append({"id": "details", "emoji": "🎯", "label": "Needs Detail Work",
                             "detail": f"{weakest} at {parts[weakest]:.0%}",
                             "part": weakest, "joint": weakest_joint})

    recent = attempts[-5:]
    if len(recent) >= 3:
        offsets = [a["timing_offset"] for a in recent]
        typical = median(offsets)
        same_side = all((o > 0) == (typical > 0) for o in offsets)
        if abs(typical) > TIMING_THRESHOLD and same_side:
            patterns.append({"id": "timing", "emoji": "⏱️", "label": "Off the Beat",
                             "detail": "early" if typical > 0 else "late",
                             "direction": "early" if typical > 0 else "late"})

    step_attempts = [a for a in attempts if (a["dance_id"], a["step_index"]) == current_key]
    if len(step_attempts) >= 6 and not current_passed:
        before = step_attempts[-6]["overall"]
        if max(a["overall"] for a in step_attempts[-5:]) <= before + 0.02:
            patterns.append({"id": "plateau", "emoji": "📉", "label": "Plateau",
                             "detail": "No improvement in 5 tries"})
    return patterns


def adaptations(patterns: list[dict]) -> dict:
    """Turn patterns into lesson settings the frontend applies automatically."""
    ids = {p["id"] for p in patterns}
    settings = {
        "chunkCounts": 8, "speed": 1.0, "drill": None,
        "rhythmMode": False, "suggestBreak": False, "unlockHarder": False,
    }
    if "slow" in ids:
        settings.update(chunkCounts=4, speed=0.7)
    if "fast" in ids:
        settings.update(chunkCounts=16, unlockHarder=True)
    for p in patterns:
        if p["id"] == "details":
            settings["drill"] = {"part": p["part"], "joint": p["joint"]}
    if "timing" in ids:
        settings["rhythmMode"] = True
    if "plateau" in ids:
        settings["suggestBreak"] = True
    return settings


def learner_badge(patterns: list[dict], skills: dict) -> dict:
    ids = {p["id"] for p in patterns}
    parts = skills.get("parts", {})
    if "fast" in ids:
        return {"emoji": "⚡", "label": "Quick Learner"}
    if parts and min(parts.values()) >= 0.85:
        return {"emoji": "🎯", "label": "Detail Master"}
    return {"emoji": "🐢", "label": "Steady Learner"}
