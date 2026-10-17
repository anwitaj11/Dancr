# Dance data format (v1)

Every dance (built-in, uploaded, or remixed) is one JSON object, stored in the
`dances.data` column and produced by `buildDance()` in `frontend/src/lib/dance.js`.

```jsonc
{
  "version": 1,
  "name": "Dab",
  "bpm": 100,
  "fps": 30,
  "aspect": 1.778,        // source video width / height (angles depend on it)
  "countStart": 0.0,      // seconds: when count 1 of step 1 lands
  "source": "builtin",    // builtin | upload | remix
  "frames": [
    {
      "t": 0.0,           // seconds from the start of the dance
      "angles": {         // degrees, 0–180, at the middle joint
        "leftElbow": 172.4,  "rightElbow": 170.1,   // shoulder–elbow–wrist
        "leftShoulder": 18.0, "rightShoulder": 17.2, // elbow–shoulder–hip
        "leftHip": 176.5,    "rightHip": 175.9,     // shoulder–hip–knee
        "leftKnee": 178.0,   "rightKnee": 177.3     // hip–knee–ankle
      },
      "pose": [[0.5, 0.15, 0.99], ...]  // 13 × [x, y, visibility], normalized to the video frame
    }
  ],
  "steps": [
    { "index": 0, "start": 0.0, "end": 4.8, "counts": 8, "label": "Step 1" }
  ]
}
```

## Notes

- **Left/right** are the dancer's own left and right (MediaPipe convention).
- **`pose` point order** (indices into MediaPipe's 33 landmarks):
  nose 0, shoulders 11/12, elbows 13/14, wrists 15/16, hips 23/24, knees 25/26, ankles 27/28.
  See `frontend/src/lib/joints.js`.
- **Angles are the scoring data.** They don't depend on body size. `pose` is
  kept for drawing the reference skeleton and for remixes, which transform
  points and then recompute angles.
- Angles are computed after scaling x by `aspect`, so a phone video (9:16) and a
  laptop webcam (16:9) give the same angle for the same pose.
- **Steps** default to 8 counts (`8 × 60 / bpm` seconds) starting at `countStart`.
  For the built-ins you can hand-edit `steps` to match the choreography.
- The learner can re-chunk steps into 4-count halves or 16-count pairs
  (`buildChunks()` in `steps.js`); attempts are saved against the first
  original step in the chunk.

## Attempt payload (`POST /attempts`)

```json
{
  "user": "sam", "dance_id": 1, "step_index": 0,
  "overall": 0.74,
  "joint_scores": { "leftElbow": 0.81, "...": 0.0 },
  "timing_offset": -0.22,
  "speed": 0.75, "attempt_count": 3, "time_spent": 4.8, "passed": false
}
```

`timing_offset` is the median over the loop of the best-matching reference
offset within ±0.5 s: positive means the user is early, negative means late.
