# Dancr persistent demo setup

This branch is a work-in-progress migration from Vercel ephemeral SQLite and media files to Supabase.

## Backend environment (Vercel project dancr-2w68)
- `DATABASE_URL`: Supabase **Session pooler** PostgreSQL connection string (Settings → Database → Connect). Set this as a Vercel server-side variable; **never** add it to the frontend or GitHub.
- `SUPABASE_URL`: existing project URL.
- `SUPABASE_SECRET_KEY`: Supabase server-side secret key (API Keys); **never** prefix with `VITE_` or paste into chat.

The tables `users`, `dances`, `attempts`, and `profiles` have been created in Supabase with RLS enabled. Backend uses a PostgreSQL connection via `DATABASE_URL`; if absent it falls back to SQLite for local development.

## Storage
Private bucket: `dance-videos`.
Frontend requests a short-lived upload token from the backend, uploads the file directly to Supabase Storage, then confirms the uploaded path. This avoids Vercel's request-body limit. Playback uses a short-lived signed URL via the backend.

## Limitations / before production
- The demo uses an unprotected backend and username-based profiles, **not authentication**. Even though the bucket is private, unauthenticated API clients could request video links. Do not use with sensitive or personal videos until authentication and ownership checks are implemented.
- The older multi-person scan and practice-take endpoints still use local disk; these require a separate storage migration for persistence.
- Voice coaching requires valid ElevenLabs credentials and a writable audio cache (e.g. `DABLAB_AUDIO_CACHE=/tmp/dancr-audio`).
- Verify Supabase Storage CORS policy and signed upload behavior in the deployed browser.
- Run end-to-end tests and deploy only after environment variables are configured. This branch has not been deployed.
