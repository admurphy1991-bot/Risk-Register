# Sansom Risk Register

A self-built risk register modeled on the reference product screenshots
(register grid with saved views, scored 5×5 risk matrix, board-report
dashboard, an AI chat agent that edits the register through a reviewable
"change plan", and an integration layer for an external health & safety
system). Built with Next.js, SQLite, and the Anthropic API.

## What's here

- **Risk register** (`/register`) — grid with saved views (Risk register / By
  category / By location / High and extreme / Review due), search, inline
  status/category badges, a create/edit drawer with a 5×5 likelihood ×
  consequence scorer for both inherent and residual risk, and per-risk
  controls with an implemented checkbox.
- **Dashboard** (`/`) — KPI tiles, an appetite/threshold view, a by-category
  breakdown, upcoming reviews, and a recent-activity feed — the "board
  report" equivalent.
- **Ask Risk AI** — a chat panel (top right of every page) backed by the
  Anthropic API. It can search and explain risks, and when asked to create,
  edit, or delete something it always stages a **change plan** first — a
  reviewable diff the user must explicitly Apply or Discard. Nothing is
  written to the register by the AI without that step.
- **Full audit trail** (`/settings`) — every write, whether from the UI, the
  AI, a CSV import, or the external API, is recorded as a change plan with
  before/after snapshots. Any applied plan can be undone with one click.
- **Integration layer** (`/settings`) — an API-key-protected REST API for an
  external system to read/write risks, plus a webhook receiver that turns
  inbound events (e.g. a failed inspection item) into a *draft* risk proposal
  for review, never a direct write.
- **CSV import** (`/register` → Import CSV) — accepts the register's own
  export format (or a close variant); every imported row becomes a
  reviewable change plan too.

## Getting started

```bash
npm install
cp .env.example .env
# edit .env: set ANTHROPIC_API_KEY (required for the chat) and SESSION_SECRET
npm run db:seed   # creates the SQLite DB, an admin user, and imports the
                   # sample data from scripts/seed-risks.csv
npm run dev        # http://localhost:3000
```

Sign in with the seeded admin account and **change the password** (there's
no self-service password reset yet — see Limitations below):

```
admin@sansom.local / ChangeMe123!
```

For production:

```bash
npm run build
npm start
```

## Database

SQLite via [Drizzle ORM](https://orm.drizzle.team) and `better-sqlite3` — no
external database server needed. The file lives at `./data/risk-register.db`
by default; set `DATABASE_URL` to an absolute path to move it (e.g. onto a
persistent volume in production). Schema lives in `src/lib/db/schema.ts` and
is applied automatically on startup (`ensureSchema()` in `src/lib/db/index.ts`)
— there's no separate migration step to run.

**Why SQLite and not Postgres?** It keeps the app trivially self-hostable
(single file, no separate service). If you outgrow it, swapping the Drizzle
SQLite driver for `drizzle-orm/node-postgres` is a contained change — the
schema and query code barely differ.

**Deployment note:** because it's a single SQLite file, this app needs a host
with a persistent, writable filesystem — a small VPS, a Docker container with
a mounted volume, Railway, Fly.io, Render, etc. It will **not** work as-is on
a stock Vercel/serverless deployment, since those don't persist local disk
writes between invocations.

## The AI chat ("Ask Risk AI")

`src/app/api/chat/route.ts` runs a short tool-use loop against the Anthropic
Messages API (model configurable via `ANTHROPIC_MODEL`, see `.env.example`).
Tools are defined in `src/lib/ai-tools.ts`:

- `search_risks`, `get_risk`, `list_categories_and_locations` — read-only.
- `propose_change_plan` — the **only** tool that can affect data, and even
  then it only stages a plan (`src/lib/change-log.ts` → `proposeChangePlan`).
  Nothing is written until the user clicks Apply in the chat panel, which
  calls `POST /api/change-plans/:id/apply`.

This mirrors the "nothing has been written yet — review the plan, then hit
Apply" pattern from the reference product, and means the AI can never
silently mutate the register.

## Integrating with the existing health & safety system

Two directions are wired up; both are documented live in `/settings` with
your server's actual URL filled in.

**Outbound (pull/push risks from the register):**

```
GET   /api/v1/risks
GET   /api/v1/risks/:id
POST  /api/v1/risks
PATCH /api/v1/risks/:id
Authorization: Bearer <api key>   # generate one in Settings > API keys
```

**Inbound (the external system pushes events in):**

```
POST /api/v1/webhooks/<source>
Authorization: Bearer <api key>
Content-Type: application/json
```

Every inbound event is normalized by a small adapter
(`src/lib/integrations/adapters.ts`) into a draft risk, which lands as a
*proposed* change plan for a human to review — the same safety net as the AI
chat. Three adapters exist today:

- `generic` — a source-agnostic shape: `{ eventType, title, description,
  category, location, owner }`. Point anything at this if it can send
  arbitrary JSON.
- `conqa` and `safetyculture` — **placeholder mappings**, since the real
  system wasn't named yet. Once you have the actual system and its webhook
  payload shape, edit the relevant `map()` function in `adapters.ts` — that's
  the only file that needs to change; the route, the auth, and the
  review/apply flow all stay the same. Add a brand-new source the same way
  (see the comment at the top of that file).

## Project structure

```
src/app/(app)/          protected pages: dashboard, register, settings
src/app/login/          sign-in page
src/app/api/             internal API (session-authenticated) used by the UI
src/app/api/v1/          external API (API-key-authenticated) for integrations
src/components/          RiskDrawer (create/edit form), ChatPanel, Shell (nav)
src/lib/db/               Drizzle schema + SQLite connection
src/lib/change-log.ts     the propose/apply/undo change-plan engine
src/lib/ai-tools.ts       Claude tool definitions + execution
src/lib/integrations/     inbound webhook adapters
src/lib/risk-scoring.ts   shared 5x5 scoring/level/colour logic
scripts/seed.ts           creates the admin user + imports scripts/seed-risks.csv
```

## Security notes before going further than a local trial

- Change the seeded admin password, and set a real `SESSION_SECRET`.
- There's one role today (effectively admin for anyone who can log in) —
  if you need per-user permissions, extend `users.role` and check it in the
  API routes.
- API keys are stored as salted hashes and shown once at creation — if one
  leaks, revoke it from Settings immediately.
- The public `/api/v1/*` surface has no rate limiting yet; add some (e.g. via
  a proxy/CDN) before exposing it outside a trusted network.

## Known limitations / good next steps

- No password reset flow (change it directly in the database, or add one).
- Single organization/tenant — there's no multi-company support.
- The risk matrix bands (Low/Medium/High/Extreme, 5×5) are hard-coded in
  `src/lib/risk-scoring.ts` — make them configurable if you need a different
  matrix shape or labels.
- `conqa`/`safetyculture` adapters are placeholders until the real payload
  shape is confirmed — see "Integrating" above.
- No automated tests yet; `npm run build` (typecheck + lint + production
  build) is the current safety net.
