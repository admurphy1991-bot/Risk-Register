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

## TA builder (Task Analysis / SWMS)

`/tas` → **Create TA** walks a project manager through four steps:

1. **Documents** — drag in the accepted proposal/quote, scope, client emails
   (`.eml`), site notes or photos (PDF, `.docx`, `.eml`, text, images). **Read
   documents & fill in details** has Claude pull out the job number, project
   name, site, contacts, work type, overview, permits, plant, chemicals and PPE.
   It only fills empty fields (or ones it filled before) — anything a person
   typed is never overwritten — and AI-filled fields are badged "✦ AI" until
   someone edits them.
2. **Project details** — the project-details table from the Sansom TA/SWMS
   template, plus plant/equipment, hazardous substances, PPE, legislation and
   responsibilities.
3. **Risks & controls** — the job-step table. **Suggest steps & risks** has
   Claude draft the steps, link the applicable Sansom register risks to each,
   pre-tick the relevant register controls and propose ratings. PMs can also
   link risks manually (searchable picker over the live register). Each linked
   risk's control paragraph is split into individual statements to tick, plus
   job-specific controls. Initial/residual ratings use Sansom's matrix.
4. **Review & submit** — readiness checks (e.g. residual can't exceed
   initial), a preview, and **Submit for H&S review**, which locks the TA and
   hands it to Make.com.

H&S reviewers then **Approve** or **Request changes** (comment required) from
the same page; changes reopen the TA for the PM to fix and resubmit. Approved
TAs can be **Closed** when the job finishes. Every step is on the TA's timeline.

**Roles** (Settings → Users): *Project manager* builds TAs · *H&S reviewer*
approves them (never their own) · *Admin* does everything incl. settings.

**The Word document** (`Download Word`, and attached to every Make.com
payload) follows the Sansom TA/SWMS template: A4 landscape with the Sansom
logo, project details, plant/chemicals table, PPE checkboxes, the job-step
table with colour-coded ratings (Low green · Moderate yellow · High orange ·
Critical red) and register cross-references, responsible persons, the worker
sign-on register, completion sign-off, and the risk matrix. Generated by
`src/lib/ta-docx.ts`.

**Risk matrix:** the app uses Sansom's own matrix from the register workbook —
likelihood Rare/Unlikely/Possible/Likely/Almost Certain, consequence
Minor/Medium/Serious/Major/Catastrophic, score = L × C, bands **Low 1–3 ·
Moderate 4–6 · High 8–12 · Critical 15–25** (`src/lib/risk-scoring.ts`).

### Make.com payload

Configure in **Settings → TA workflow** (or env vars `MAKE_WEBHOOK_URL`,
`MFILES_EMAIL`, `HS_MANAGER_EMAIL`, `HS_MANAGER_NAME`). The app `POST`s JSON
to the webhook on these events (also sent as the `X-Sansom-Event` header):

| `event` | When | Suggested Make route |
| --- | --- | --- |
| `ta.submitted` | PM submits (or resubmits) | Email the doc to `recipients.mfilesEmail`; email `recipients.hsManagerEmail` with `links.reviewUrl` |
| `ta.approved` | H&S approves | Email the final doc to M-Files; notify `recipients.preparedByEmail` |
| `ta.changes_requested` | H&S sends it back | Notify `recipients.preparedByEmail` with `ta.reviewComment` |
| `test` | Settings → "Send test payload" | Use to teach Make the structure |

```jsonc
{
  "event": "ta.submitted",
  "sentAt": "2026-09-25T07:29:13.509Z",
  "ta": {
    "id": "TA-0001", "title": "S34150 - HARBOURVIEW APARTMENTS …",
    "jobNumber": "S34150", "projectName": "…", "taDate": "2026-09-25",
    "siteAddress": "…", "mainContractor": "…", "siteContactName": "…", "siteContactPhone": "…",
    "contractManager": "…", "contractManagerPhone": "…", "workType": "…", "overview": "…",
    "permits": ["Work At Height Permit"], "status": "submitted", "statusLabel": "Awaiting H&S review",
    "preparedBy": "Tales Melo", "submittedAt": "…", "reviewedBy": null, "reviewedAt": null, "reviewComment": null,
    "stepCount": 3, "highestInitialRating": "CRITICAL 15", "highestResidualRating": "MODERATE 4",
    "registerRiskIds": ["TAC-16", "TAC-11"],
    "steps": [{ "number": 1, "description": "…", "identifiedRisks": ["…"], "initialRating": "CRITICAL 15",
                "residualRating": "MODERATE 4", "controls": ["…"], "registerRisks": [{ "id": "TAC-16", "title": "Fall from Height" }] }]
  },
  "document": {
    "filename": "TA-SWMS S34150 HARBOURVIEW APARTMENTS ….docx",
    "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "sizeBytes": 34401,
    "base64": "UEsDB…",                       // the .docx itself
    "downloadUrl": "https://…/api/tas/TA-0001/document?token=…"  // signed, valid 30 days, no login needed
  },
  "links": { "viewUrl": "https://…/tas/TA-0001", "reviewUrl": "https://…/tas/TA-0001" },
  "recipients": { "mfilesEmail": "…", "hsManagerEmail": "…", "hsManagerName": "…", "preparedByEmail": "…" },
  "email": { "mfilesSubject": "TA/SWMS … (TA-0001)", "hsReviewSubject": "TA for review: … (TA-0001)",
             "preparerSubject": "TA approved: … (TA-0001)", "bodyText": "…ready-made plain-text summary with the review link…" }
}
```

**Building the scenario:** add a *Webhooks → Custom webhook* trigger, paste
its URL into Settings, click **Send test payload** so Make learns the
structure, then add a *Router* on `event`. For the attachment, map
`document.filename` as the file name and `toBinary(document.base64; base64)`
as the data in your email module (Gmail / Microsoft 365 / SMTP). If M-Files
needs a PDF, add a conversion module (e.g. CloudConvert, or OneDrive
"Convert a file") between the webhook and the M-Files email. Every delivery
and its HTTP result is logged on the TA page, with a **Resend** button.

**Storage:** uploaded documents are saved next to the database file
(`<db dir>/ta-files/<TA id>/`). On Railway make sure `DATABASE_URL` points at
the mounted volume (e.g. `/data/risk-register.db`) so uploads survive
redeploys too. New tables are created automatically on start-up — no
migration step.

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
- Roles: admin / H&S reviewer / project manager (Settings → Users). Role
  changes and removed users take effect on the next request.
- API keys are stored as salted hashes and shown once at creation — if one
  leaks, revoke it from Settings immediately.
- The public `/api/v1/*` surface has no rate limiting yet; add some (e.g. via
  a proxy/CDN) before exposing it outside a trusted network.

## Known limitations / good next steps

- Password resets are admin-driven (Settings → Users → Reset password); there's
  no self-service "forgot password" email yet.
- Single organization/tenant — there's no multi-company support.
- The risk matrix follows Sansom's workbook and is defined in
  `src/lib/risk-scoring.ts` — edit there if the matrix changes.
- TA: the template's hazard/risk-scenario checkbox grid and the appended SDS
  sheets aren't generated yet; the cross-site "active risks" dashboard rollup
  is next (the data is already captured — `ta_step_risks` links every
  submitted/approved TA step to its register risks).
- TA document reading supports PDF, .docx, .eml, text and images — not
  Outlook `.msg` or spreadsheets (users are told to save as PDF/.eml/CSV).
- `conqa`/`safetyculture` adapters are placeholders until the real payload
  shape is confirmed — see "Integrating" above.
- No automated tests yet; `npm run build` (typecheck + lint + production
  build) is the current safety net.
