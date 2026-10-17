"""AI coach: one-sentence tips and end-of-session reports via Claude.

Falls back to simple rule-based text when ANTHROPIC_API_KEY is not set or the
API call fails, so the demo never stalls on the coach.
"""

import json
import logging
import os

import anthropic

log = logging.getLogger(__name__)

MODEL = os.getenv("DABLAB_MODEL", "claude-opus-5-5")

JOINT_NAMES = {
    "leftElbow": "left elbow", "rightElbow": "right elbow",
    "leftShoulder": "left arm", "rightShoulder": "right arm",
    "leftHip": "left hip", "rightHip": "right hip",
    "leftKnee": "left knee", "rightKnee": "right knee",
}

TIP_SYSTEM = (
    "You are the voice coach in Dab Lab, a webcam dance app that teaches 2016 dances "
    "(the Dab, Running Man, Juju On That Beat, Whip/Nae Nae). You get a short summary "
    "of how the dancer is doing. Reply with exactly one encouraging sentence, under 20 "
    "words, giving the single most useful fix. Name a body part or a count when you can. "
    "The sentence will be read aloud mid-dance, so no emoji, lists, or quotes."
)

REPORT_SYSTEM = (
    "You write the end-of-session report in Dab Lab, a webcam dance coaching app. "
    "From the dancer's stats, write short, specific, upbeat notes. Each item is one sentence."
)

REPORT_SCHEMA = {
    "type": "object",
    "properties": {
        "strengths": {"type": "array", "items": {"type": "string"}},
        "weaknesses": {"type": "array", "items": {"type": "string"}},
        "plan": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["strengths", "weaknesses", "plan"],
    "additionalProperties": False,
}

_client = None


def _get_client():
    global _client
    if _client is None and os.getenv("ANTHROPIC_API_KEY"):
        _client = anthropic.Anthropic(timeout=20.0)
    return _client


def _ask(system: str, prompt: str, max_tokens: int, output_format: dict | None = None) -> str | None:
    client = _get_client()
    if client is None:
        return None
    output_config = {"effort": "low"}
    if output_format:
        output_config["format"] = output_format
    try:
        # fallbacks="default" re-runs a safety-declined request on Anthropic's recommended model.
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=max_tokens,
            system=system,
            output_config=output_config,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            messages=[{"role": "user", "content": prompt}],
        )
    except anthropic.APIConnectionError as e:
        log.warning("coach: connection error: %s", e)
        return None
    except anthropic.RateLimitError:
        log.warning("coach: rate limited")
        return None
    except anthropic.APIStatusError as e:
        log.warning("coach: API error %s: %s", e.status_code, e.message)
        return None
    if response.stop_reason == "refusal":
        return None
    text = "".join(b.text for b in response.content if b.type == "text").strip()
    return text or None


def summarize(profile: dict, context: dict | None = None) -> str:
    """Compact plain-text summary of a learner, shared by tips and reports."""
    lines = []
    parts = profile.get("skills", {}).get("parts", {})
    if parts:
        lines.append("Skill by body part: " + ", ".join(f"{p} {v:.0%}" for p, v in parts.items()))
    joints = profile.get("skills", {}).get("joints", {})
    if joints:
        weakest = min(joints, key=joints.get)
        lines.append(f"Weakest joint: {JOINT_NAMES[weakest]} ({joints[weakest]:.0%})")
    for p in profile.get("patterns", []):
        lines.append(f"Pattern: {p['label']} ({p['detail']})")
    stats = profile.get("stats", {})
    if stats:
        lines.append(f"Attempts: {stats.get('attempts', 0)}, steps passed: {stats.get('stepsPassed', 0)}")
    if context:
        if "score" in context:
            lines.append(f"Last loop score: {context['score']:.0%}")
        if context.get("weakestJoint"):
            lines.append(f"Worst joint this loop: {JOINT_NAMES.get(context['weakestJoint'], context['weakestJoint'])}")
        if context.get("timingOffset") is not None:
            offset = context["timingOffset"]
            if abs(offset) > 0.15:
                lines.append(f"Timing this loop: {abs(offset):.2f}s {'early' if offset > 0 else 'late'}")
        if context.get("worstCount"):
            lines.append(f"Lowest-scoring count: {context['worstCount']}")
    return "\n".join(lines) or "New dancer, no attempts yet."


def rule_tip(profile: dict, context: dict | None = None) -> str:
    context = context or {}
    offset = context.get("timingOffset") or 0
    if abs(offset) > 0.15:
        return f"You're a little {'early' if offset > 0 else 'late'}, lock in on the counts!"
    joint = context.get("weakestJoint")
    if not joint:
        joints = profile.get("skills", {}).get("joints", {})
        joint = min(joints, key=joints.get) if joints else None
    if joint:
        return f"Nice energy! Focus on your {JOINT_NAMES.get(joint, joint)} and match the shape."
    return "Looking good, keep it going!"


def tip(profile: dict, context: dict | None = None) -> dict:
    text = _ask(TIP_SYSTEM, summarize(profile, context), max_tokens=2000)
    if text:
        return {"tip": text, "source": "llm"}
    return {"tip": rule_tip(profile, context), "source": "rules"}


def report(profile: dict) -> dict:
    text = _ask(
        REPORT_SYSTEM,
        summarize(profile) + "\n\nGive 2 strengths, 2 weaknesses, and a 3-item plan for next time.",
        max_tokens=4000,
        output_format={"type": "json_schema", "schema": REPORT_SCHEMA},
    )
    if text:
        try:
            return {**json.loads(text), "source": "llm"}
        except json.JSONDecodeError:
            log.warning("coach: report was not valid JSON")
    parts = profile.get("skills", {}).get("parts", {})
    ranked = sorted(parts, key=parts.get, reverse=True)
    return {
        "strengths": [f"Your {p} are at {parts[p]:.0%}." for p in ranked[:2]] or ["You showed up and danced!"],
        "weaknesses": [f"Your {p} are at {parts[p]:.0%}." for p in ranked[-1:]] if ranked else [],
        "plan": ["Warm up with the step you passed last.", "Drill your weakest body part at 0.75x.",
                 "Try the full dance at 1x."],
        "source": "rules",
    }
