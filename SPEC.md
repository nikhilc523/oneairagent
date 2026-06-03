# OneAir AI Agent — Build Specification

A from-scratch rebuild of the OneAir operations AI agent: a **human-in-the-loop assistant** that lets travel-operations staff resolve customer queries (rebooking, refunds, policy lookups, booking status, escalations) by chatting with an AI that does the lookups and *proposes* actions, while the human stays in control of anything that touches money.

This document is the contract for what we build and how. Code follows the spec, not the other way around.

---

## 1. Goal and scope

**The problem.** Operations staff spend most of their day on *lookups* — reading policies, querying bookings, calculating refund eligibility — instead of the human-judgment parts of support. We want an AI agent that does the lookups and drafts the actions, so staff review and confirm instead of researching from scratch.

**The thesis we are proving.** A carefully designed AI agent can absorb a large share of operations work *if* destructive actions always pass through a human. Trust, not model capability, is the bottleneck — so the architecture puts authority in the human and the database, never in the model.

**In scope (v1).** Five core use cases:

1. **Rebooking** — move a passenger to a different flight/date.
2. **Cancellation & refund** — cancel a booking and compute refund eligibility.
3. **Policy lookup** — answer policy questions accurately from source documents.
4. **Booking status / itinerary** — read-only questions about a booking.
5. **Escalation routing** — hand off cases the AI shouldn't handle.

**Out of scope (v1).** Customer-facing chat (this is an *internal staff tool*), payments processing itself (we call a refund API, we don't move money ourselves), multi-language, voice.

**Non-negotiable principle.** Rebooking, refund, and escalation are **destructive/consequential**. The AI may only *propose* them. A human must explicitly confirm before the backend executes anything.

---

## 2. System at a glance

Three runtime pieces plus shared data:

```
┌─────────────────────┐     intent + params      ┌──────────────────────┐
│  React Native app    │ ───────────────────────▶ │   Dialogflow CX       │
│  (Expo) — staff chat │ ◀─────────────────────── │   (Conversational     │
│  UI + HITL cards     │     fulfillment text     │    Agents) — routing  │
└──────────┬──────────┘                            └───────────┬──────────┘
           │ WebSocket (streaming tokens,                       │ webhook
           │  status updates, action proposals)                 │ (fulfillment)
           ▼                                                    ▼
┌───────────────────────────────────────────────────────────────────────┐
│                     Node.js + TypeScript backend                         │
│                                                                          │
│  HTTP/WS API  →  Orchestrator  →  ┌─ RAG retrieval (pgvector)           │
│                                   ├─ Customer/booking lookup (Postgres)  │
│                                   ├─ External API calls (airline/payment)│
│                                   └─ LLM call (OpenAI, streaming)        │
│                                                                          │
│  Controlled tools  →  Validation layer  →  HITL gate  →  Audit log       │
└───────────────────────────────────────────────────────────────────────┘
           │                         │                    │
           ▼                         ▼                    ▼
   PostgreSQL + pgvector        Redis (cache,         External APIs
   (bookings, customers,        locks, rate          (airline, payment) —
    policy embeddings,          limits)              mocked in dev
    audit log)
```

**Why Dialogflow CX *and* an LLM.** CX owns deterministic conversation structure — intent detection, slot/parameter collection (e.g. "which booking?"), session state, and routing. The LLM owns the open-ended generative work — reading retrieved policy text and writing a grounded answer, and proposing structured tool calls. CX calls our backend via a **webhook** whenever it needs the LLM or a data action. This is the hybrid the enterprise (SEI-style) world actually uses: structured where structure helps, generative where it doesn't.

---

## 3. Requirements

### 3.1 Functional requirements

| ID | Requirement |
|----|-------------|
| F1 | Staff can send a free-text message and receive a streamed AI response. |
| F2 | The agent classifies each message into one of the five use cases (or "other"). |
| F3 | For policy questions, answers are grounded in retrieved source documents, with the source shown. |
| F4 | For booking status, the agent reads live booking data and answers read-only. |
| F5 | For rebooking/refund/escalation, the agent returns a **structured proposal** (action type + parameters + human-readable summary), never an executed action. |
| F6 | A proposal is rendered as a confirmation **card** in the app with Confirm / Reject buttons. |
| F7 | Execution happens only after the staff member confirms; rejection discards the proposal. |
| F8 | Every proposal, confirmation/rejection, and execution result is written to an audit log. |
| F9 | The agent can resume a conversation across app restarts (server-side session is source of truth). |
| F10 | Conversations exceeding the context window are windowed + summarized automatically. |

### 3.2 Non-functional requirements

| ID | Requirement | Target |
|----|-------------|--------|
| N1 | Time to first streamed token | < 800 ms p50 |
| N2 | Read-only query end-to-end (no LLM) | < 300 ms p50 |
| N3 | Survive WebSocket disconnect mid-stream | resume from last sequence number |
| N4 | Survive external API outage | timeout + circuit breaker + graceful degradation |
| N5 | No PII in logs | customer IDs only; emails/names/payment redacted |
| N6 | LLM cannot perform a destructive action without human confirmation | enforced server-side, not by prompt |
| N7 | Prompt-injection resistance | authority lives in human + DB, not the model |
| N8 | Runs locally with zero external accounts | mock LLM + mock DB fallback |

### 3.3 The signature patterns (these are the point of the project)

- **Human-in-the-loop (HITL):** destructive actions are *proposals* until a human confirms. Enforced in the backend's action gate, independent of what the model says.
- **Validation against ground truth:** every proposed action's parameters are checked against the real database *before* the proposal is shown. If the LLM proposes rebooking a booking that doesn't exist, the proposal never appears.
- **Capability gating:** the LLM has no DB or API access. It can only emit calls to a small, fixed set of tools, each a controlled gate.
- **Auditability:** raw LLM output, validated output, human decision, and result are all logged per interaction.

---

## 4. Tech stack and why

| Layer | Choice | Why |
|-------|--------|-----|
| Conversation routing | **Dialogflow CX** (Conversational Agents) | Structured intent/parameter management, session handling, visual flows, enterprise-grade. Webhook fulfillment hands generative work to our backend. |
| Mobile client | **React Native + Expo + TypeScript** | One codebase iOS/Android, fast to run (Expo Go), type safety across a complex chat state. |
| Client state | **Redux Toolkit** | Chat state is genuinely complex — message history, streaming buffers, pending action proposals, connection state, optimistic sends. Predictable transitions + good devtools. |
| Backend | **Node.js + TypeScript + Express** | Async I/O fits chat workloads (lots of waiting on APIs); shared TS types with the client; mature LLM tooling. |
| Realtime | **WebSocket (ws)** | Bidirectional: stream LLM tokens *and* push status updates (e.g. "airline confirmed rebook") to the client. |
| LLM | **OpenAI** (swappable behind an interface) | Streaming + tool/structured output. Abstracted so Claude/others can be swapped via config. |
| Retrieval | **PostgreSQL + pgvector** | Embeddings live next to relational data — no separate vector DB to operate. |
| Cache / locks | **Redis** | Hot data caching, concurrency locks, rate-limit counters. |
| Deploy | **GCP Cloud Run + Docker** | Stateless autoscaling, dev/prod parity, no infra management. |
| Dev fallback | **In-memory mock LLM + mock DB** | Project runs with zero accounts; real services activate when keys/env are present. |

**Explicitly swappable.** The LLM lives behind an `LLMProvider` interface and the data layer behind a `DataStore` interface, so dev (mock) and prod (OpenAI + Postgres) are a config switch, not a rewrite.

---

## 5. Dialogflow CX agent design

The CX agent is the front door for conversation logic. It does **not** contain the AI answers — it routes and collects parameters, then calls our webhook.

**Agent:** `oneair-ops-agent`

**Entities (custom):**
- `@booking_ref` — regex-style pattern for booking references (e.g. `ON-XXXXXX`).
- `@city` — extends `@sys.geo-city` with airport/city aliases.
- `@action_confirmation` — `yes` / `no` synonyms for the confirmation turn.

**System entities used:** `@sys.date`, `@sys.date-time`, `@sys.number`, `@sys.any`.

**Flows & pages:**

- **Default Start Flow** — entry point. A route group classifies the message into one of the five intents and transitions to the matching page.
- **Rebooking page** — required parameters: `booking_ref`, `new_date` (and optional `new_city`). CX prompts for any missing parameter ("Which booking?"). When parameters are filled, the page's fulfillment calls the webhook with `tag: "rebook.propose"`.
- **Cancellation/Refund page** — required: `booking_ref`. Fulfillment tag `refund.propose`.
- **Policy page** — captures the raw question in `@sys.any`; fulfillment tag `policy.answer` (pure RAG, no parameters needed).
- **Booking status page** — required: `booking_ref`; fulfillment tag `booking.status` (read-only).
- **Escalation page** — fulfillment tag `escalate.propose`.
- **Confirmation handling** — proposals come back to the client, not CX. CX's job ends at producing the proposal; the confirm/execute round-trip is handled directly by the backend over WebSocket (see §7). CX is stateless about money.

**Intents (training-phrase seeds — expanded in the import file):**
- `intent.rebook` — "change my flight to Friday", "move booking ON-… to next week".
- `intent.cancel_refund` — "cancel and refund", "what's my refund if I cancel".
- `intent.policy` — "what's the cancellation policy", "do delays include hotels".
- `intent.booking_status` — "where's my booking", "is my flight confirmed".
- `intent.escalate` — "I want a human", "this is urgent / complaint".

**Webhook (fulfillment):** a single HTTPS endpoint on our backend, `POST /dialogflow/webhook`, distinguished by the `fulfillmentInfo.tag`. CX sends session parameters; the backend returns fulfillment text (and, out-of-band over WS, any action proposal).

**Generative fallback.** For messages CX can't confidently classify, a no-match handler routes to the `policy.answer`/general webhook tag so the LLM can attempt a grounded answer or politely escalate — rather than CX replying with a canned "I didn't get that."

---

## 6. Backend design

A layered Node/TS service. Request flow for a message:

1. **API/transport layer** — receives the message over WS (live UI) or HTTPS (CX webhook). Attaches a `traceId` and resolves the `sessionId`.
2. **Orchestrator** — the brain. In parallel it runs: RAG retrieval, customer/booking lookup, and any needed external API call. It assembles context within a token budget, then calls the LLM with streaming + the tool schema.
3. **LLM layer (`LLMProvider`)** — OpenAI in prod, deterministic mock in dev. Streams tokens; returns either prose or a tool call (structured JSON).
4. **Tools (controlled gates)** — the only things the model can "do": `search_bookings`, `get_policy`, `propose_rebook`, `propose_refund`, `propose_escalation`. `propose_*` tools never execute; they emit a proposal object.
5. **Validation layer** — checks every proposed action's parameters against the real `DataStore` (does the booking exist? is the customer the owner? is the new date valid?). Invalid proposals are dropped and the user is asked to clarify — they are never shown.
6. **HITL gate** — a validated destructive proposal is sent to the client as a `pending_action` and parked server-side. Nothing executes. On a `confirm_action` message from the client, the gate re-checks authorization, executes the real action, and emits the result. On `reject_action`, it discards.
7. **Audit log** — every step (raw LLM output, validated proposal, human decision, execution result) is appended with `traceId`, `sessionId`, `actorId`, timestamp. No PII.

**Resilience details:**
- External API calls wrapped in service classes with **timeouts (3–5s)**, **retry**, and a **circuit breaker** (cooldown after repeated failures) so one slow airline API can't cascade.
- **Graceful degradation:** if alternate-flight lookup is down, policy/status answers still work; the agent says it can't search alternates right now.
- **Streaming resilience:** every streamed token carries a `messageId` + `seq`. The server buffers a completed stream briefly (~30s). On reconnect the client requests "resume from seq N"; if the buffer expired, it falls back to an HTTP GET for the final message.
- **Concurrency:** Redis locks prevent two staff from modifying the same booking simultaneously; DB writes use transactions with row locking.

**Long-conversation handling:** send the last 10–20 messages plus a rolling summary (generated by a cheaper model in the background); rank RAG chunks by relevance and truncate to the token budget; as a last resort, prompt for a fresh session with a one-line carryover summary.

---

## 7. End-to-end flows

**A) Policy question (read + generate, no HITL):**
```
Staff types question → WS → CX classifies intent.policy → webhook policy.answer
→ backend: embed query → pgvector top-k policies → assemble context
→ LLM streams grounded answer (with source) → tokens stream to app
→ audit log entry (query, retrieved chunks, answer)
```

**B) Refund (the HITL path):**
```
Staff: "cancel ON-204881 and refund" → CX collects booking_ref → webhook refund.propose
→ backend: validate booking exists + owner + compute eligibility against policy
→ LLM proposes { action: "refund", booking_ref, amount, fee, reason }
→ validation passes → pending_action card pushed to app over WS  ← NOTHING EXECUTED
→ staff taps Confirm → confirm_action over WS
→ HITL gate re-authorizes → calls (mock) payment refund API in a transaction
→ result pushed to app + audit log (proposal, confirmation, result)
```

**C) Disconnect mid-stream:** client tracks last `seq`; on reconnect sends `resume:{messageId, seq}`; server replays from buffer or client falls back to HTTP for the final state. UI shows a subtle "reconnecting" indicator, never loses the message.

---

## 8. Data model (dev mock mirrors prod schema)

- **customers** — `id`, `name` (redacted in logs), `email` (encrypted/ redacted), `tier`.
- **bookings** — `ref` (ON-XXXXXX), `customer_id`, `status`, `origin`, `destination`, `depart_at`, `fare_class`, `price`, `refundable`.
- **policies** — `id`, `title`, `body`, `embedding vector(1536)` (pgvector).
- **audit_log** — `id`, `trace_id`, `session_id`, `actor_id`, `event_type`, `payload_redacted`, `created_at`.
- **sessions** — `id`, `actor_id`, `summary`, `created_at`, `updated_at` (server-side source of truth for resume).

Dev uses in-memory seed data with the same shapes; prod uses Postgres + pgvector. Both sit behind the `DataStore` interface.

---

## 9. Project structure (monorepo)

```
oneair-agent/
├── SPEC.md                    ← this document
├── README.md                  ← quickstart + how to run
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example
│   └── src/
│       ├── index.ts           ← Express + WebSocket server
│       ├── config.ts          ← env, feature flags (mock vs real)
│       ├── orchestrator.ts    ← context assembly + LLM call + proposals
│       ├── validation.ts      ← validate proposals vs DataStore
│       ├── hitl.ts            ← pending-action gate + execution
│       ├── audit.ts           ← redacted audit log
│       ├── ws.ts             ← streaming + reconnect/resume
│       ├── llm/
│       │   ├── provider.ts    ← LLMProvider interface
│       │   ├── openai.ts      ← real provider (streaming + tools)
│       │   └── mock.ts        ← deterministic dev provider
│       ├── rag/
│       │   ├── policies.ts    ← seed policy documents
│       │   └── retriever.ts   ← embed + cosine / pgvector
│       ├── tools/
│       │   └── index.ts       ← controlled tool schemas + handlers
│       ├── data/
│       │   ├── store.ts       ← DataStore interface
│       │   └── mockDb.ts      ← in-memory seed data
│       └── dialogflow/
│           └── webhook.ts     ← CX fulfillment by tag
├── mobile/
│   ├── package.json
│   ├── app.json
│   ├── App.tsx
│   └── src/
│       ├── api.ts             ← WS client + reconnect/resume
│       ├── ChatScreen.tsx
│       ├── store/             ← Redux Toolkit slices
│       └── components/
│           ├── MessageBubble.tsx
│           └── PendingActionCard.tsx   ← the HITL confirm/reject UI
└── dialogflow/
    ├── README.md              ← how to create the CX agent + import config
    ├── intents.json           ← intent training phrases
    └── entities.json          ← custom entities
```

---

## 10. Build phases

| Phase | Deliverable | Status |
|-------|-------------|--------|
| 0 | Spec (this doc) + repo structure | current |
| 1 | Backend core: DataStore + mock DB, RAG, tools, orchestrator, mock LLM — runnable, no accounts | next |
| 2 | WebSocket transport + streaming + HITL gate + audit log | next |
| 3 | React Native (Expo) chat app: streaming UI + pending-action cards | next |
| 4 | Dialogflow CX agent config + webhook wiring + setup guide | next |
| 5 | Real services: OpenAI provider, Postgres+pgvector, Redis | later |
| 6 | Resilience: circuit breakers, reconnect/resume, concurrency locks | later |
| 7 | Observability: trace IDs, metrics, eval harness, thumbs feedback | later |
| 8 | Dockerize + deploy to Cloud Run | later |

Phases 1–4 give a **fully demoable system running locally** (mock LLM + mock DB), where you can chat, get grounded policy answers, and walk through a refund proposal → confirm → execute with an audit trail. Phase 5 onward swaps in the real services.

---

## 11. Prerequisites (for the real-service phases)

These require *your* accounts and must be done by you — the project never enters credentials on your behalf:

- **Node.js 20+** and **npm**.
- **Expo Go** app on a phone (or an iOS/Android simulator) for the mobile client.
- **OpenAI API key** (Phase 5) — set as `OPENAI_API_KEY`.
- **Google Cloud project** with the Dialogflow CX / Conversational Agents API enabled, and a service account (Phase 4).
- **PostgreSQL 15+ with the `pgvector` extension**, and **Redis** (Phase 5/6) — local Docker is fine.

Until those are configured, the feature flags in `config.ts` keep everything on mock implementations so the system still runs end to end.

---

## 12. How this maps back to the interview story

Every probe in your prep has a corresponding piece of real code here: the HITL pattern (`hitl.ts`), validation against ground truth (`validation.ts`), capability gating (`tools/index.ts`), prompt-injection posture (authority in `hitl.ts` + `validation.ts`, not the prompt), RAG (`rag/`), streaming + reconnect (`ws.ts` + `mobile/src/api.ts`), the provider abstraction you "wish you'd built from day one" (`llm/provider.ts`), and the audit trail (`audit.ts`). Building it means your answers stop being memorized and start being remembered.
