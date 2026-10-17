"""Style remix (stretch): turn a free-text request into transform settings.

The transforms themselves run in the browser (frontend/src/lib/remix.js);
this only picks the numbers and explains them.
"""

import json

from . import coach

PRESETS = {
    "hype":   {"amplitude": 1.4, "speed": 1.0, "sharpness": 0.0, "smoothing": 0, "upperBodyOnly": False},
    "chill":  {"amplitude": 0.7, "speed": 0.5, "sharpness": 0.0, "smoothing": 0, "upperBodyOnly": False},
    "sharp":  {"amplitude": 1.0, "speed": 1.0, "sharpness": 0.8, "smoothing": 0, "upperBodyOnly": False},
    "smooth": {"amplitude": 1.0, "speed": 1.0, "sharpness": 0.0, "smoothing": 9, "upperBodyOnly": False},
    "seated": {"amplitude": 1.0, "speed": 1.0, "sharpness": 0.0, "smoothing": 0, "upperBodyOnly": True},
}

SETTINGS_SCHEMA = {
    "type": "object",
    "properties": {
        "amplitude": {"type": "number", "description": "0.5-1.6, scales how big the moves are"},
        "speed": {"type": "number", "description": "0.5-1.5 playback speed"},
        "sharpness": {"type": "number", "description": "0-1, snap between poses and hold"},
        "smoothing": {"type": "integer", "description": "0-15 frames of averaging"},
        "upperBodyOnly": {"type": "boolean", "description": "freeze hips and knees (seated/low-impact)"},
        "explanation": {"type": "string", "description": "1-2 sentences on what changed and why"},
    },
    "required": ["amplitude", "speed", "sharpness", "smoothing", "upperBodyOnly", "explanation"],
    "additionalProperties": False,
}

SYSTEM = (
    "You configure style remixes in Dab Lab, a dance coaching app. A remix is defined only by "
    "these knobs: amplitude, speed, sharpness, smoothing, upperBodyOnly. Map the user's request "
    "to values in range and explain the change in plain words a dancer would use."
)

LIMITS = {"amplitude": (0.5, 1.6), "speed": (0.5, 1.5), "sharpness": (0.0, 1.0), "smoothing": (0, 15)}


def clamp(settings: dict) -> dict:
    out = dict(settings)
    for key, (lo, hi) in LIMITS.items():
        out[key] = min(hi, max(lo, out[key]))
    return out


def remix(request: str) -> dict:
    key = request.strip().lower()
    if key in PRESETS:
        return {**PRESETS[key], "explanation": f"Applied the {key} preset.", "source": "preset"}
    text = coach._ask(
        SYSTEM, request, max_tokens=2000,
        output_format={"type": "json_schema", "schema": SETTINGS_SCHEMA},
    )
    if text:
        try:
            return {**clamp(json.loads(text)), "source": "llm"}
        except (json.JSONDecodeError, KeyError):
            pass
    return {**PRESETS["hype"], "explanation": "Couldn't reach the AI, so here's the Hype preset.",
            "source": "preset"}
