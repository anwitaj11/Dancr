// Seed the backend with placeholder built-in dances: `npm run seed`
// (backend must be running; set API_URL to point elsewhere).
import { demoDances } from '../src/lib/demoDances.js'

const API_URL = process.env.API_URL ?? 'http://localhost:8000'

const existing = await fetch(`${API_URL}/dances`).then((r) => r.json())
for (const { dance, difficulty } of demoDances()) {
  if (existing.some((d) => d.name === dance.name)) {
    console.log(`skip  ${dance.name} (already there)`)
    continue
  }
  const res = await fetch(`${API_URL}/dances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: dance.name, bpm: dance.bpm, builtin: true, difficulty, data: dance }),
  })
  console.log(`${res.ok ? 'added' : 'FAIL '} ${dance.name} (${dance.steps.length} steps)`)
}
