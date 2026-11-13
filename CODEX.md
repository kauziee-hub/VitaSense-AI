# VitaSense AI — Codex / Agent Context

This file is the **single source of truth** for AI coding agents (Codex, Cursor, etc.) working in this repository. Read it before making non-trivial changes.

---

## 1. What this project is

**VitaSense AI** (FastAPI metadata title: *VitalIQ Health Chatbot*) is a **local-first full-stack prototype** for preventive health UX: onboarding profile, structured daily logs, a **deterministic wellness forecast** (no LLM), a **live locality health intelligence engine**, and a **Grok (xAI)** chat with safety scanning and Supabase persistence.

It is **not** a regulated medical device. Copy includes medical-style disclaimers and emergency escalation in chat; still a demo.

---

## 2. Tech stack (critical facts)

| Layer | Technology |
|-------|------------|
| **Backend** | Python 3.11+, **FastAPI**, **Uvicorn**, **Pydantic v2** |
| **HTTP client to DB** | **supabase-py** (`create_client`) with **service role** key — **server only** |
| **LLM** | **OpenAI Python SDK** pointed at **xAI** base URL `https://api.x.ai/v1` (`grok_client.py`) |
| **Frontend** | **Vite 6**, **React 19**, **TypeScript**, **Tailwind v4**, **motion/react**, **lucide-react** |
| **Tests** | **pytest** under `tests/` (106 tests as of last full run) |

**Not used:** Next.js, Supabase JS client in the browser, `@supabase/ssr`, React Router (navigation is React state in `App.tsx`).

---

## 3. Repository layout

```text
.
├── main.py                 # FastAPI app, routes, Pydantic models, lifespan
├── grok_client.py          # AsyncOpenAI wrapper for Grok; verify_models on startup if GROK_API_KEY set
├── logging_config.py
├── requirements.txt
├── .env                    # Local secrets (gitignored) — GROK, Supabase service role
├── .env.example            # Template + uvicorn port hint
├── CODEX.md                # This file
├── README.md               # Human-oriented setup and API examples
├── chat/
│   ├── orchestrator.py     # Chat pipeline: safety → context → prompt → Grok → safety → persist → SSE chunks
│   ├── prompt_builder.py   # System prompt from profile + 7d daily + hypotheses + follow-ups
│   └── safety_scanner.py   # Regex emergency/diagnosis handling; disclaimer append
├── db/
│   ├── supabase_client.py  # get_supabase(): SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
│   ├── user_context_loader.py
│   ├── daily_log_store.py
│   ├── setup_context_store.py
│   └── *.sql               # Run in Supabase SQL Editor (see README order)
├── state/
│   └── conversation_store.py   # In-memory TTL conversation per (user_id, session_id)
├── wellness/
│   └── forecast.py         # Pure-Python forecast (no Grok)
├── locality/
│   └── intelligence.py     # Hyperlocal disease/symptom/hazard/food/predictive mock intelligence engine
├── tests/
└── vitasense-ai-2/         # Vite SPA
    ├── package.json        # "dev": npx vite --port=3000 --host=127.0.0.1
    ├── .env.example
    ├── .env.development    # gitignored pattern .env* — may exist locally for VITE_API_BASE_URL
    └── src/
        ├── App.tsx
        ├── main.tsx
        ├── lib/api.ts      # REST to FastAPI
        ├── lib/chat.ts     # SSE streaming chat
        ├── lib/demoData.ts # FALLBACK_USER_ID, offline forecast/map fallback data
        ├── screens/
        └── components/
```

---

## 4. Ports and URLs (defaults)

| Service | Default |
|---------|---------|
| **API** | `http://127.0.0.1:8888` (project chose **8888** to avoid clashing with other apps on **8000**) |
| **Vite** | `http://127.0.0.1:3000` — if busy, Vite auto-increments (3001, 3002, …) |

**Frontend → API:** `import.meta.env.VITE_API_BASE_URL` in `vitasense-ai-2/src/lib/api.ts` and `chat.ts`, defaulting to `http://127.0.0.1:8888` if unset.

**CORS:** `main.py` → `_cors_allow_origins()` includes common dev origins (3000–3002, 3020, localhost + 127.0.0.1). Extend with env **`CORS_ORIGINS`** (comma-separated) if Vite lands on another port.

**Run commands:**

```powershell
# Backend (repo root)
python -m uvicorn main:app --host 127.0.0.1 --port 8888

# Frontend
cd vitasense-ai-2
npm install   # first time
npm run dev
```

---

## 5. Environment variables

### Backend (repo root `.env`, gitignored)

| Variable | Required for | Notes |
|----------|----------------|-------|
| `GROK_API_KEY` | Grok chat, `grok: true` on `/health` | If unset, app **still starts**; chat returns **503**; lifespan logs a warning |
| `SUPABASE_URL` | All Supabase-backed routes | |
| `SUPABASE_SERVICE_ROLE_KEY` | Same | **Never** expose to frontend or commit |
| `CORS_ORIGINS` | Optional | Extra allowed browser origins |

### Frontend (`vitasense-ai-2/.env` or `.env.development`)

| Variable | Purpose |
|----------|---------|
| `VITE_API_BASE_URL` | Base URL for `fetch` to FastAPI (must match running uvicorn) |
| `VITE_FALLBACK_USER_ID` | Integer fallback id used only when offline fallback data renders (default `1`) |

`vitasense-ai-2/.env.example` may still mention legacy `GEMINI_API_KEY` / `APP_URL` from an AI Studio template; **this stack uses Grok from the Python backend**, not Gemini in the browser for chat.

---

## 6. HTTP API (FastAPI)

All under the running host (e.g. `http://127.0.0.1:8888`).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | `status`, `timestamp`, `grok` (bool: models.list succeeded) |
| POST | `/api/v1/chat` | Body: `{ user_id, message, session_id? }`. Response: **SSE** `text/event-stream`, lines `data: ...`, ends with `data: [DONE]` |
| GET | `/api/v1/user/{user_id}/history` | Chat history rows from Supabase |
| GET | `/api/v1/user/{user_id}/daily-log?log_date=YYYY-MM-DD` | Merged read of daily tables |
| PUT | `/api/v1/user/{user_id}/daily-log` | Upsert daily payloads |
| PUT | `/api/v1/user/{user_id}/setup-context` | Onboarding / profile upserts |
| GET | `/api/v1/user/{user_id}/wellness-forecast` | Deterministic JSON forecast |
| GET | `/api/v1/user/{user_id}/locality-health-intelligence?city=...&locality=...&radius_km=3` | Hyperlocal disease, symptom, hazard, food-safety, and predictive risk intelligence |

**Auth:** None. `user_id` is passed explicitly after selecting or creating a user in the SPA.

---

## 7. Data and Supabase

- **Initialization:** `db/supabase_client.py` — `load_dotenv()` then `create_client(url, service_role_key)`.
- **Heavy queries** often wrapped in `asyncio.to_thread(...)` + timeouts to avoid blocking the event loop.
- **Schema source of truth:** `db/supabase_schema.sql` plus patches in `db/*.sql` (order in `README.md`).
- **RLS:** Enabled on tables in SQL; **service role bypasses RLS** for server-side access.

### Tables (conceptual)

- **`users`** — root user rows; local seed includes Kausik, Rithik, and Abhishek.
- **Profile (one row per user):** `user_life_context`, `user_food_body_relationship`, `user_medical_identity`, `user_emotional_wellness`, `user_personal_context`, `ai_user_health_profile`.
- **Daily (per `user_id` + `log_date`):** `daily_fitness_data`, `daily_environment_data`, `daily_device_behavior_data`, `daily_calendar_data`, `daily_user_memory_logs`.
- **`chatbot_conversation_history`** — persisted turns.
- **`ai_health_insights`** — defined in SQL; **no read/write in Python yet** (reserved).
- **`user_health_record_imports`** — schema only; **not wired** in loaders.

### Daily log behavior

- `daily_log_store.build_automatic_daily_payloads()` generates **deterministic placeholder** fitness/environment/device/calendar fields from `(log_date, user_id)` so the product works without real wearables.
- Manual fields mapped in `main._daily_log_table_payloads`; `_daily_ai_fields` adds heuristic chatbot metadata (risk, canned actions) for storage when columns exist (`db/vitasense_data_upgrade.sql`).

---

## 8. AI / chat pipeline (order matters)

1. **`POST /api/v1/chat`** → `stream_chat_sse` → `handle_chat_message` (`chat/orchestrator.py`).
2. **`scan_user_message`** — may block and return escalation only.
3. **`get_supabase()`** — if fails, chat continues without persistence/context load (logged).
4. **`load_user_health_context` + `load_recent_daily_data(..., 7)`** in parallel.
5. **`build_system_prompt`** (`prompt_builder.py`) — role rules, profile block, 7-day summary, hypotheses, follow-up strategy.
6. **`ConversationStore`** — last N turns as user/assistant messages to Grok (after system).
7. **`GrokClient.chat(..., stream=True)`** — orchestrator **consumes full stream** into one string, then **`_chunk_text`** re-emits as SSE for the client (not raw token-forwarding).
8. **`scan_ai_response`** — may modify or block.
9. **`persist_turn`** ×2 → `chatbot_conversation_history`.

**Models:** `grok_client.py` — default `grok-3-mini`, constant `grok-3` for “complex” (caller may pass). Startup **`verify_models()`** requires `grok-3-mini` in the account’s model list when `GROK_API_KEY` is set.

---

## 9. Frontend behavior

- **Routing:** `App.tsx` `useState<Screen>` — no React Router.
- **API:** `vitasense-ai-2/src/lib/api.ts` — JSON `fetch` for forecast, daily log, setup.
- **Chat:** `vitasense-ai-2/src/lib/chat.ts` — `fetch` + `ReadableStream` reader, parses `data:` SSE lines.
- **WellnessForecastHero:** tries live forecast; on failure uses **`demoWellnessForecast`** from `demoData.ts`.
- **Chatbot:** `localStorage` keys `vitasense.chat.sessionId`, `vitasense.chat.messages` — UI session, separate from Supabase history API.

---

## 10. Area Health Map

The Area Health Map is backed by `locality/intelligence.py` and `/api/v1/user/{user_id}/locality-health-intelligence`. It generates deterministic mock-live intelligence from city/locality/radius plus available Supabase context: profile, 30-day daily logs, chatbot history, and prior AI insights.

Current layers: disease, symptoms, hazards, food safety, and predictive. The engine is future-ready for municipality, public health, pollution/weather, hospital, food inspection, and anonymous symptom-cluster feeds. Optional additive persistence DDL lives in `db/locality_health_intelligence.sql`.

---

## 11. Testing and quality

```powershell
cd <repo-root>
python -m pytest tests -q
```

```powershell
cd vitasense-ai-2
npm run lint    # tsc --noEmit
```

- **`tests/test_main.py`** sets `GROK_API_KEY` + patches `GrokClient` because lifespan only constructs Grok when the env var is present.
- **`tests/test_api_endpoints.py`** uses autouse fixture to set `GROK_API_KEY` for the same reason.

After changing lifespan, CORS, or env loading, run these tests.

---

## 12. Conventions for agents (do / don’t)

**Do**

- Match existing style: focused diffs, no unrelated refactors.
- Keep **secrets** only in **`.env`** (root); never commit keys; never echo real keys in chat or docs.
- When changing API URL or port, update **defaults in `api.ts` / `chat.ts`**, **`.env.example`**, **`README.md`**, and **`CODEX.md`** together.
- If Vite uses a new dev port, add origin to **`_cors_allow_origins()`** or document **`CORS_ORIGINS`**.

**Don’t**

- Add **Supabase anon key** to the Vite bundle for this architecture unless you redesign auth and RLS.
- Run **`npm run dev`** in a new terminal **unless the user asked** to start the dev server (some user workflows keep dev running separately).
- Assume **Next.js** or **Server Components** — this UI is a **SPA**.

---

## 13. Known limitations / prototype notes

- No end-user authentication; API trusts `user_id` from the client.
- **`ConversationStore`** is **in-memory** — not shared across multiple uvicorn workers; use sticky sessions or Redis if you scale horizontally.
- **`ai_health_insights`** table unused in code.
- **`user_health_record_imports`** unused in code.
- Windows: use **`npx vite`** (already in `package.json`) so `vite` need not be global.

---

## 14. Quick verification after env changes

```powershell
Invoke-WebRequest http://127.0.0.1:8888/health -UseBasicParsing
# Expect: "grok":true when GROK_API_KEY valid
```

Then open the Vite URL and exercise dashboard (forecast), daily log, onboarding save, chat.

---

## 15. Where to edit for common tasks

| Task | Primary files |
|------|----------------|
| New REST route | `main.py` |
| Chat behavior / persistence | `chat/orchestrator.py`, `chat/prompt_builder.py`, `chat/safety_scanner.py` |
| Grok model / timeout / base URL | `grok_client.py` |
| Supabase read patterns | `db/user_context_loader.py`, `db/daily_log_store.py`, `db/setup_context_store.py` |
| Forecast logic | `wellness/forecast.py` |
| Locality health intelligence | `locality/intelligence.py`, `AreaHealthIntelligenceMap.tsx` |
| New UI screen | `vitasense-ai-2/src/screens/`, wire in `App.tsx` + `Layout`/`Sidebar` if needed |
| API base URL in UI | `vitasense-ai-2/src/lib/api.ts`, `chat.ts`, env files |

---

*End of CODEX.md — keep this file updated when architecture or defaults change materially.*
