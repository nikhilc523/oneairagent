# OneAir Agent Backend — Complete Guide

This document explains every single file in the backend, what it does, how data flows through the system, and what happens step-by-step when a request arrives. Written for someone who has never built a backend before.

---

## Table of Contents

1. [The Big Picture](#1-the-big-picture)
2. [What Happens When a Request Arrives (Step by Step)](#2-what-happens-when-a-request-arrives)
3. [File-by-File Breakdown](#3-file-by-file-breakdown)
4. [All 6 Flows Explained with Examples](#4-all-6-flows-explained-with-examples)
5. [The Data (Mock Database)](#5-the-data)
6. [All API Endpoints](#6-all-api-endpoints)
7. [How HITL (Human-in-the-Loop) Works](#7-how-hitl-works)
8. [How RAG (Retrieval-Augmented Generation) Works](#8-how-rag-works)
9. [Security Patterns](#9-security-patterns)
10. [Mock vs Real (Phase 5)](#10-mock-vs-real)

---

## 1. The Big Picture

The backend is a Node.js + TypeScript server that does one job: **receive requests from Dialogflow CX, do the work, and send back answers.**

```
Dialogflow CX (Google Cloud)
    │
    │  POST /dialogflow/webhook
    │  Body: { tag: "booking.status", params: { booking_ref: "ON-204881" } }
    │
    ▼
┌──────────────────────────────────────────────────────────┐
│                    EXPRESS SERVER (index.ts)               │
│                                                           │
│  Receives the HTTP request, parses JSON, routes to...     │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │              WEBHOOK ROUTER (webhook.ts)             │  │
│  │                                                      │  │
│  │  Reads the "tag" field and calls the right handler:  │  │
│  │  "booking.status" → orchestrator.handleBookingStatus │  │
│  │  "policy.answer"  → orchestrator.handlePolicyQuery   │  │
│  │  "refund.propose" → orchestrator.handleRefund        │  │
│  │  "rebook.propose" → orchestrator.handleRebook        │  │
│  │  "escalate.propose" → orchestrator.handleEscalation  │  │
│  │  "fallback.general" → orchestrator.handleFallback    │  │
│  └──────────────────────┬──────────────────────────────┘  │
│                         │                                  │
│  ┌──────────────────────▼──────────────────────────────┐  │
│  │              ORCHESTRATOR (orchestrator.ts)           │  │
│  │                                                      │  │
│  │  The brain. For each request it:                     │  │
│  │  1. Validates inputs against the database            │  │
│  │  2. Retrieves relevant data (bookings, policies)     │  │
│  │  3. Calls the LLM if needed                          │  │
│  │  4. Creates HITL proposals for destructive actions    │  │
│  │  5. Logs everything to the audit trail               │  │
│  │  6. Returns { text, proposal?, sources? }            │  │
│  └──┬──────────┬──────────┬──────────┬─────────────────┘  │
│     │          │          │          │                      │
│     ▼          ▼          ▼          ▼                      │
│  DataStore  Validator   LLM      HITL Gate                  │
│  (mockDb)  (validation) (mock)   (hitl.ts)                  │
│     │          │          │          │                      │
│     ▼          │          │          ▼                      │
│  Audit Log ◄──┘──────────┘──────── Audit Log               │
└──────────────────────────────────────────────────────────┘
    │
    │  Response: { fulfillmentResponse: { messages: [{ text: "..." }] } }
    │
    ▼
Dialogflow CX shows the answer to the staff member
```

### The files at a glance

```
backend/src/
├── index.ts              ← Starts the server, wires everything together
├── config.ts             ← Reads environment variables (port, mock mode, API keys)
├── types.ts              ← All TypeScript types/interfaces (the "dictionary")
├── orchestrator.ts       ← The brain — coordinates all other components
├── validation.ts         ← Checks if actions are valid before proposing them
├── hitl.ts               ← Human-in-the-loop gate (propose → confirm → execute)
├── audit.ts              ← Logs every action, redacts PII
├── dialogflow/
│   └── webhook.ts        ← Receives Dialogflow CX requests, routes by tag
├── llm/
│   ├── provider.ts       ← Interface — what ANY LLM provider must look like
│   └── mock.ts           ← Fake LLM for dev (no API key needed)
├── rag/
│   ├── retriever.ts      ← Searches policy documents (RAG retrieval)
│   └── policies.ts       ← Policy title index
├── tools/
│   └── index.ts          ← The 5 tools the LLM can call (and ONLY these 5)
├── data/
│   ├── store.ts          ← Interface — what ANY database must look like
│   ├── mockDb.ts         ← In-memory fake database with seed data
│   └── schema.sql        ← Real PostgreSQL schema (for Phase 5)
```

---

## 2. What Happens When a Request Arrives

Let's trace a real request from start to finish. A staff member types "What's the status of ON-204881" in the chat.

### Step 1: Dialogflow CX classifies the message

CX recognizes `intent.booking_status` and extracts `booking_ref = ON-204881` from the text. It calls our webhook:

```
POST https://oneairagent.onrender.com/dialogflow/webhook

{
  "fulfillmentInfo": {
    "tag": "booking.status"                    ← tells us WHAT to do
  },
  "sessionInfo": {
    "session": "projects/xxx/sessions/abc123", ← unique conversation ID
    "parameters": {
      "booking_ref": "ON-204881"               ← extracted from user's message
    }
  },
  "text": "What's the status of ON-204881"     ← raw user message
}
```

### Step 2: Express receives the request (`index.ts`)

```typescript
// index.ts line 40
app.use('/dialogflow', createWebhookRouter(orchestrator));
```

Express sees the URL is `/dialogflow/webhook`, so it hands the request to the webhook router.

### Step 3: Webhook router reads the tag (`webhook.ts`)

```typescript
// webhook.ts line 12-16
const tag = (rawBody.fulfillmentInfo?.tag || '').trim();
// tag = "booking.status"

const params = rawBody.sessionInfo?.parameters || {};
// params = { booking_ref: "ON-204881" }
```

It hits the `switch` statement:

```typescript
// webhook.ts line 56-62
case 'booking.status':
  result = await orchestrator.handleBookingStatus(
    sessionId,         // "projects/xxx/sessions/abc123"
    actorId,           // "staff-user"
    params.booking_ref // "ON-204881"
  );
  break;
```

### Step 4: Orchestrator handles the logic (`orchestrator.ts`)

```typescript
// orchestrator.ts line 175-211
async handleBookingStatus(sessionId, actorId, bookingRef) {
  const traceId = uuid();  // Generate a unique trace ID for this request

  // Step 4a: Look up the booking in the database
  const booking = await this.store.getBooking("ON-204881");
  // Returns: {
  //   ref: "ON-204881",
  //   customerId: "cust-001",
  //   status: "confirmed",
  //   origin: "New York",
  //   destination: "Los Angeles",
  //   departAt: "2026-06-15T08:30:00Z",
  //   fareClass: "business",
  //   price: 1250.00,
  //   refundable: true
  // }

  // Step 4b: Look up the customer
  const customer = await this.store.getCustomer("cust-001");
  // Returns: { id: "cust-001", name: "Alice Johnson", tier: "gold" }

  // Step 4c: Write to audit log
  await this.audit.log(traceId, sessionId, actorId, 'booking_status_query', {
    bookingRef: "ON-204881",
    status: "confirmed"
  });

  // Step 4d: Format and return the answer
  return {
    text: "**Booking ON-204881**\n" +
          "Status: **CONFIRMED**\n" +
          "Passenger: Alice Johnson (gold tier)\n" +
          "Route: New York → Los Angeles\n" +
          "Departure: Monday, June 15, 2026 at 08:30 AM UTC\n" +
          "Fare: business — $1250.00\n" +
          "Refundable: Yes"
  };
}
```

**Notice:** No LLM was called. No HITL proposal was created. This is a pure database read — fast and deterministic.

### Step 5: Webhook router formats the response (`webhook.ts`)

```typescript
// webhook.ts line 84-91
const response = {
  fulfillmentResponse: {
    messages: [{
      text: {
        text: ["**Booking ON-204881**\nStatus: **CONFIRMED**\n..."]
      }
    }]
  },
  sessionInfo: {
    parameters: { returning: true }
  }
};

res.json(response);  // Send it back to Dialogflow CX
```

### Step 6: CX shows the answer

Dialogflow CX receives the response and displays the text to the staff member in the chat.

**Total time: ~200-300ms** (no LLM call, just database lookups).

---

## 3. File-by-File Breakdown

### `index.ts` — The Entry Point

**What it does:** Starts the server and wires everything together.

Think of it as the "main" function. When you run `npm start`, this file executes. It:

1. **Creates all the services:**
   ```typescript
   const store = new MockDataStore();    // The database (in-memory)
   const llm = new MockLLMProvider();    // The AI model (fake)
   const audit = new AuditLogger(store); // The audit trail
   const hitl = new HITLGate(store, audit); // The HITL proposal system
   const orchestrator = new Orchestrator(store, llm, hitl, audit); // The brain
   ```

2. **Creates the Express app** and registers all routes:
   - `/dialogflow/webhook` — for Dialogflow CX
   - `/api/bookings/:ref` — direct booking lookup
   - `/api/policy` — direct policy query
   - `/api/rebook`, `/api/refund`, `/api/escalate` — direct proposal creation
   - `/api/proposals/:id/confirm` and `/api/proposals/:id/reject` — HITL actions
   - `/health` — health check

3. **Starts listening** on the configured port (default 3000).

**Why two sets of routes?** The `/dialogflow/webhook` route is what Dialogflow CX calls. The `/api/*` routes let you test the backend directly without CX — just use curl or a browser.

---

### `config.ts` — Environment Configuration

**What it does:** Reads settings from environment variables.

```typescript
export const config = {
  port: 3000,              // Which port to listen on
  nodeEnv: 'development',  // dev or production
  useMockLlm: true,        // Use fake LLM (no API key needed)
  useMockDb: true,          // Use in-memory database (no Postgres needed)
  openaiApiKey: '',         // OpenAI key (Phase 5)
  databaseUrl: '',          // PostgreSQL connection string (Phase 5)
  redisUrl: '',             // Redis connection string (Phase 6)
};
```

**Why it matters:** This is how you switch between mock mode (everything runs locally, no accounts needed) and real mode (OpenAI + PostgreSQL). Change one environment variable and the whole system switches.

---

### `types.ts` — The Dictionary

**What it does:** Defines the shape of every piece of data in the system.

Think of it as a dictionary that every other file references. It defines:

- **`Customer`** — `{ id, name, email, tier }` — a passenger in the system
- **`Booking`** — `{ ref, customerId, status, origin, destination, departAt, fareClass, price, refundable }` — a flight booking
- **`Policy`** — `{ id, title, body, embedding? }` — a policy document (with optional vector embedding for RAG)
- **`AuditEntry`** — `{ traceId, sessionId, actorId, eventType, payload, createdAt }` — one line in the audit log
- **`ActionProposal`** — `{ id, type, params, summary, status }` — a proposed action waiting for human approval
- **`WebhookRequest`** / **`WebhookResponse`** — the exact JSON shape Dialogflow CX sends and expects back
- **`LLMMessage`** / **`LLMResponse`** — the format for talking to an AI model

**Why it matters:** TypeScript enforces these shapes at compile time. If you try to access `booking.color` (which doesn't exist), the code won't compile. This prevents entire categories of bugs.

---

### `dialogflow/webhook.ts` — The Front Door

**What it does:** Receives every request from Dialogflow CX and routes it to the right handler.

It's like a receptionist — it doesn't do any work itself, it just reads the `tag` and says "go talk to this person."

```
tag = "booking.status"   → orchestrator.handleBookingStatus()
tag = "policy.answer"    → orchestrator.handlePolicyQuery()
tag = "refund.propose"   → orchestrator.handleRefund()
tag = "rebook.propose"   → orchestrator.handleRebook()
tag = "escalate.propose" → orchestrator.handleEscalation()
tag = "fallback.general" → orchestrator.handleFallback()
```

It also:
- Extracts `params` from the request (booking_ref, new_date, raw_query, etc.)
- If the orchestrator returns a **proposal** (HITL), it includes it in the response's `sessionInfo.parameters` so the app can display a confirm/reject card
- Catches errors and returns a friendly error message instead of crashing

---

### `orchestrator.ts` — The Brain

**What it does:** Coordinates everything. Every handler follows the same pattern:

```
1. Validate the inputs       (is this booking real? is the date valid?)
2. Fetch relevant data       (booking details, customer info, policy documents)
3. Call the LLM if needed    (for policy answers or action proposals)
4. Create HITL proposal      (for destructive actions only)
5. Log to audit trail        (every single step)
6. Return the result         ({ text, proposal?, sources? })
```

**The return type is always the same:**
```typescript
interface OrchestratorResult {
  text: string;              // The answer shown to the user
  proposal?: ActionProposal; // Only for destructive actions (rebook, refund, escalate)
  sources?: string[];        // Only for policy queries (which documents were used)
}
```

**Six handlers:**

| Handler | Does DB lookup? | Uses LLM? | Creates HITL proposal? |
|---------|:-:|:-:|:-:|
| `handleBookingStatus()` | Yes | No | No |
| `handlePolicyQuery()` | Yes (RAG) | Yes | No |
| `handleRebook()` | Yes | Yes | **Yes** |
| `handleRefund()` | Yes | Yes | **Yes** |
| `handleEscalation()` | No | No | **Yes** |
| `handleFallback()` | Yes (RAG) | Yes | No |

---

### `validation.ts` — The Guard

**What it does:** Checks if a proposed action is valid *before* it's shown to anyone.

This is the "validation against ground truth" pattern. The LLM might hallucinate a booking that doesn't exist. The validator catches that.

**`validateRebook(bookingRef, newDate, newCity)`** checks:
- Does the booking exist? → If not: `"Booking ON-999999 not found."`
- Is it already cancelled? → If so: `"Booking ON-204881 is already cancelled."`
- Is it already completed (past travel)? → If so: error
- Is the new date valid and in the future? → If not: error
- Is it at least 2 hours before departure? → If not: `"Changes must be made at least 2 hours before departure."`

**`validateRefund(bookingRef)`** checks:
- Does the booking exist?
- Is it already cancelled?
- Is it already completed?

**`computeRefund(booking)`** calculates the exact refund amount based on policy rules:

```
Refundable ticket + >24h before departure:
  → Full refund minus $50 processing fee
  → Example: $1250 ticket → $1200 refund, $50 fee

Refundable ticket + <24h before departure:
  → 80% refund
  → Example: $1250 ticket → $1000 refund, $250 fee

Non-refundable ticket + >24h before departure:
  → No cash refund, travel credit minus $150 fee
  → Example: $320 ticket → $0 refund, $170 travel credit

Non-refundable ticket + <24h before departure:
  → Nothing. No refund, no credit.
```

**`computeRebookFee(booking)`** calculates the change fee:
```
Refundable ticket → $0 (free date/time change)
Non-refundable ticket → $150 change fee
```

**Why this matters:** The validator uses the REAL database, not the LLM's opinion. If the LLM says "this booking qualifies for a full refund" but the booking is non-refundable, the validator overrides. **The database is the source of truth, never the model.**

---

### `hitl.ts` — The HITL Gate (Human-in-the-Loop)

**What it does:** Manages the propose → confirm → execute lifecycle for destructive actions.

This is the most important security pattern in the system. The LLM can **never** directly cancel a booking or process a refund. It can only *propose* doing so. A human must confirm.

**Three methods:**

**`createProposal()`** — Called by the orchestrator when a destructive action is needed:
```typescript
const proposal = {
  id: "abc-123",                    // unique ID
  type: "refund",                   // what kind of action
  params: {                         // the details
    booking_ref: "ON-204881",
    refund_amount: 1200,
    fee: 50
  },
  summary: "Cancel ON-204881 (...). Full refund minus $50 fee.",
  status: "pending",                // ← NOTHING HAS HAPPENED YET
  createdAt: "2026-06-03T10:00:00Z"
};
```
The proposal is saved to the database and an audit log entry is created. **No action is taken.**

**`confirm(proposalId)`** — Called when a human clicks "Confirm":
1. Loads the proposal from the database
2. Checks it's still `pending` (hasn't been confirmed/rejected already)
3. Calls `execute()` which actually does the thing:
   - **Rebook:** Updates the booking's `departAt` and `destination`
   - **Refund:** Sets the booking's status to `cancelled`
   - **Escalation:** Creates an escalation ticket
4. Updates the proposal status to `executed` (or `failed`)
5. Logs everything to the audit trail

**`reject(proposalId)`** — Called when a human clicks "Reject":
1. Loads the proposal
2. Sets status to `rejected`
3. Logs the rejection
4. **Nothing else happens.** The booking is untouched.

---

### `audit.ts` — The Audit Trail

**What it does:** Logs every single action in the system, with automatic PII redaction.

Every handler in the orchestrator calls `audit.log()`:

```typescript
await this.audit.log(
  traceId,     // Unique ID for this request (links all steps together)
  sessionId,   // The conversation ID
  actorId,     // Who did it ("staff-user")
  eventType,   // What happened ("booking_status_query", "proposal_created", etc.)
  payload      // The details (booking ref, refund amount, etc.)
);
```

**PII redaction:** Before saving, the audit logger scans the payload for sensitive keys (`name`, `email`, `phone`, `address`, `card`, `payment`, `ssn`, `password`) and replaces their values with `[REDACTED]`. This means the audit log never contains customer names or emails — only IDs.

```
Before redaction: { booking_ref: "ON-204881", customer_name: "Alice Johnson" }
After redaction:  { booking_ref: "ON-204881", customer_name: "[REDACTED]" }
```

**The traceId** is crucial — it links every step of a request together. If something goes wrong with a refund, you can search the audit log for the traceId and see: the original request, the validation result, the LLM response, the proposal creation, the human confirmation, and the execution result — all connected.

---

### `llm/provider.ts` — The LLM Interface

**What it does:** Defines what ANY LLM provider must look like.

```typescript
interface LLMProvider {
  chat(messages: LLMMessage[], tools?: ToolDefinition[]): Promise<LLMResponse>;
}
```

That's it. One method. Any LLM that can take messages and optionally call tools can implement this interface.

**Why it matters:** This is the "abstraction you'd add from day one." Today we use `MockLLMProvider`. In Phase 5, we swap in `OpenAIProvider`. We could swap in Claude, Gemini, Llama — anything. The rest of the code doesn't change.

---

### `llm/mock.ts` — The Fake LLM

**What it does:** Pretends to be an AI model for development. No API key needed.

It reads the messages, looks for keywords, and returns a deterministic response:

```
Messages contain "propose a rebooking" → returns tool call: propose_rebook
Messages contain "process refund"      → returns tool call: propose_refund
Messages contain "escalat"             → returns tool call: propose_escalation
Messages contain "policy" or "source"  → returns a generic policy answer
Everything else                        → returns "I can help with..."
```

**It's intentionally dumb.** It doesn't actually read the policy documents or understand the question. It just pattern-matches keywords so the rest of the pipeline can run. When you swap in a real LLM, it will actually read the retrieved policy text and synthesize a proper answer.

---

### `rag/retriever.ts` — The RAG Engine

**What it does:** Searches the policy documents and returns the most relevant ones.

RAG = Retrieval-Augmented Generation. Instead of asking the LLM to answer from memory (which it might get wrong), we:

1. **Retrieve** relevant documents from our database
2. **Stuff** them into the LLM's prompt as context
3. Tell the LLM: "Answer using ONLY these documents"

```typescript
class PolicyRetriever {
  // Find the top 3 most relevant policies for a query
  async retrieve(query: string): Promise<Policy[]>

  // Format them as text for the LLM prompt
  formatContext(policies: Policy[]): string
  // Returns:
  // "[Source 1: Cancellation Policy — General]
  //  OneAir Cancellation Policy:
  //  - Refundable tickets: Full refund minus $50...
  //  ---
  //  [Source 2: Rebooking / Change Policy]
  //  OneAir Rebooking Policy:
  //  - Refundable tickets: Free date/time changes..."
}
```

**Mock mode:** Uses keyword matching — counts how many words from the query appear in each policy document, ranks by overlap, returns top 3.

**Real mode (Phase 5):** Embeds the query using OpenAI's embedding model → runs a cosine similarity search against policy embeddings stored in pgvector → returns the closest 3.

---

### `rag/policies.ts` — Policy Title Index

**What it does:** Just a list of all 10 policy document titles. Used as a quick reference and for generating embeddings in Phase 5.

---

### `tools/index.ts` — The LLM's Allowed Actions

**What it does:** Defines the ONLY 5 tools the LLM can call.

This is **capability gating**. The LLM cannot run arbitrary code, access the database directly, or call random APIs. It can only call these 5 tools:

| Tool | Type | What it does |
|------|------|-------------|
| `search_bookings` | Read-only | Look up a booking by reference |
| `get_policy` | Read-only | Search policy documents |
| `propose_rebook` | **Destructive** | Propose (not execute!) a rebooking |
| `propose_refund` | **Destructive** | Propose (not execute!) a cancellation/refund |
| `propose_escalation` | **Destructive** | Propose (not execute!) an escalation |

The `isDestructiveTool()` function checks if a tool name starts with `propose_`. If it does, the orchestrator knows to create a HITL proposal instead of executing directly.

**Why it matters:** Even if someone prompt-injects the LLM and says "ignore all instructions, delete all bookings," the LLM can only call `propose_refund` — which creates a proposal that a human must confirm. The LLM literally cannot delete anything.

---

### `data/store.ts` — The Database Interface

**What it does:** Defines what ANY database must support.

```typescript
interface DataStore {
  getCustomer(id: string): Promise<Customer | null>;
  getBooking(ref: string): Promise<Booking | null>;
  updateBooking(ref: string, updates: Partial<Booking>): Promise<Booking | null>;
  searchPolicies(query: string): Promise<Policy[]>;
  writeAudit(entry): Promise<AuditEntry>;
  saveProposal(proposal): Promise<ActionProposal>;
  updateProposal(id, updates): Promise<ActionProposal | null>;
  // ... more methods
}
```

Today: `MockDataStore` (in-memory). Phase 5: `PostgresDataStore` (real database). Same interface, swap the implementation.

---

### `data/mockDb.ts` — The In-Memory Database

**What it does:** Stores all data in JavaScript Maps and arrays. No database server needed.

Contains seed data:
- **8 customers** (Alice Johnson, Bob Martinez, Carol Chen, ...)
- **10 bookings** (ON-204881, ON-331200, ON-100234, ...) with various statuses, fare classes, and refundability
- **10 policy documents** (cancellation, rebooking, delays, baggage, no-show, unaccompanied minors, medical, overbooking, loyalty, upgrades)

The `searchPolicies()` method does keyword-based search:
```
Query: "cancellation policy business class"
→ Splits into words: ["cancellation", "policy", "business", "class"]
→ Counts how many words appear in each policy's title + body
→ Ranks by count, returns top 3
```

**Data resets when the server restarts.** If you cancel a booking via HITL, it's cancelled in memory. Restart the server and it's back to the original seed data.

---

### `data/schema.sql` — The Real Database Schema

**What it does:** SQL commands to create the real PostgreSQL tables for Phase 5.

Creates 6 tables: `customers`, `bookings`, `policies` (with pgvector embeddings), `audit_log`, `sessions`, `action_proposals`. Includes indexes and the same seed data as the mock DB.

Not used yet — it's the blueprint for when you set up a real database.

---

## 4. All 6 Flows Explained with Examples

### Flow A: Booking Status (read-only, no LLM, no HITL)

```
User: "What's the status of ON-204881"

webhook.ts:  tag = "booking.status", params = { booking_ref: "ON-204881" }
             → orchestrator.handleBookingStatus("ON-204881")

orchestrator.ts:
  1. store.getBooking("ON-204881")     → found! confirmed, NYC→LAX, business, $1250
  2. store.getCustomer("cust-001")     → Alice Johnson, gold tier
  3. audit.log("booking_status_query") → logged
  4. Format text                       → "Booking ON-204881\nStatus: CONFIRMED\n..."

webhook.ts:  return { messages: ["Booking ON-204881..."] }

Speed: ~200ms (no LLM call)
```

### Flow B: Policy Query (RAG + LLM, no HITL)

```
User: "What's the cancellation policy for business class?"

webhook.ts:  tag = "policy.answer", params = { raw_query: "What's the cancellation..." }
             → orchestrator.handlePolicyQuery("What's the cancellation...")

orchestrator.ts:
  1. retriever.retrieve("What's the cancellation...")
     → mockDb.searchPolicies()
     → keyword match: "cancellation" appears in policies 1, 5, 7
     → returns top 3: [Cancellation Policy, No-Show Policy, Medical Cancellation]

  2. retriever.formatContext(policies)
     → "[Source 1: Cancellation Policy — General]\n..."
     → "[Source 2: No-Show Policy]\n..."

  3. llm.chat([
       { role: "system", content: "Answer using ONLY these sources:\n[Source 1...]" },
       { role: "user", content: "What's the cancellation policy for business class?" }
     ])
     → Mock LLM: "Based on the retrieved policy documents ([Source 1...]...)..."
     → Real LLM would say: "For business class (refundable), you can cancel for
        a full refund minus $50 processing fee if >24h before departure..."

  4. audit.log("policy_query", { retrievedPolicies: [...] })

  5. return { text: "Based on...", sources: ["Cancellation Policy — General", ...] }

Speed: ~300ms (mock LLM is instant; real LLM would be 1-3 seconds)
```

### Flow C: Refund (validation + LLM + HITL)

```
User: "Cancel ON-204881 and refund"

webhook.ts:  tag = "refund.propose", params = { booking_ref: "ON-204881" }
             → orchestrator.handleRefund("ON-204881")

orchestrator.ts:
  1. validator.validateRefund("ON-204881")
     → store.getBooking("ON-204881") → found!
     → status = "confirmed" → OK (not cancelled or completed)
     → { valid: true, booking: {...} }

  2. validator.computeRefund(booking)
     → refundable = true
     → hoursUntilDepart = 288 hours (>24h)
     → { refundAmount: 1200, fee: 50, reason: "Full refund minus $50 fee" }

  3. llm.chat([...], TOOL_DEFINITIONS)
     → Mock LLM detects "process refund" in the system prompt
     → Returns: { toolCalls: [{ name: "propose_refund", arguments: {...} }] }

  4. isDestructiveTool("propose_refund") → true!
     → hitl.createProposal("refund", {
         booking_ref: "ON-204881",
         refund_amount: 1200,
         fee: 50
       }, "Cancel ON-204881 (NYC→LAX, $1250). Full refund minus $50 fee.")
     → Saves proposal with status: "pending"
     → audit.log("proposal_created")

  5. return {
       text: "I've assessed the refund eligibility for ON-204881. Review the proposal.",
       proposal: { id: "abc-123", status: "pending", ... }
     }

  ⚠️ AT THIS POINT: The booking is still CONFIRMED. Nothing has changed.
     The staff member sees a proposal card with Confirm/Reject buttons.

--- LATER: Staff clicks Confirm ---

  POST /api/proposals/abc-123/confirm

  hitl.confirm("abc-123"):
    1. Load proposal → status is "pending" → OK
    2. execute(proposal):
       → type = "refund"
       → store.getBooking("ON-204881") → found
       → store.updateBooking("ON-204881", { status: "cancelled" })
       → return { success: true, message: "Booking cancelled. Refund of $1200..." }
    3. Update proposal → status = "executed"
    4. audit.log("proposal_confirmed")

  NOW the booking is cancelled. Only after the human confirmed.
```

### Flow D: Rebook (validation + LLM + HITL)

```
User: "Rebook ON-204881 to July 1st"

orchestrator.handleRebook("ON-204881", "2026-07-01"):
  1. validator.validateRebook("ON-204881", "2026-07-01")
     → Booking exists? Yes
     → Already cancelled? No
     → New date valid and in the future? Yes
     → At least 2 hours before departure? Yes
     → { valid: true }

  2. validator.computeRebookFee(booking)
     → refundable ticket → { fee: 0, reason: "Free date/time change" }

  3. LLM proposes → hitl.createProposal("rebook", {
       booking_ref: "ON-204881", new_date: "2026-07-01", fee: 0
     })

  4. Proposal returned → staff sees card → confirms → booking date updated
```

### Flow E: Escalation (no validation, no LLM, HITL)

```
User: "This customer is threatening legal action, I need a supervisor"

orchestrator.handleEscalation("This customer is threatening..."):
  1. No validation needed (any case can be escalated)
  2. No LLM needed (just create the proposal)
  3. hitl.createProposal("escalation", {
       reason: "This customer is threatening legal action..."
     })
  4. Return proposal → staff confirms → escalation ticket created
```

### Flow F: Fallback (RAG + LLM, no HITL)

```
User: "the customer is really unhappy about the delay"

orchestrator.handleFallback("the customer is really unhappy..."):
  1. Try RAG retrieval → might find "Delay and Disruption Compensation" policy
  2. LLM tries to answer using the policy context
  3. If it can't: "I can help with rebooking, cancellations, policy questions,
     booking status, or escalations. What would you like to do?"
```

---

## 5. The Data

### Customers (8)

| ID | Name | Tier | Email |
|----|------|------|-------|
| cust-001 | Alice Johnson | gold | alice.j@example.com |
| cust-002 | Bob Martinez | standard | bob.m@example.com |
| cust-003 | Carol Chen | platinum | carol.c@example.com |
| cust-004 | David Park | silver | david.p@example.com |
| cust-005 | Emma Wilson | standard | emma.w@example.com |
| cust-006 | Frank Obi | gold | frank.o@example.com |
| cust-007 | Grace Kim | silver | grace.k@example.com |
| cust-008 | Henry Patel | standard | henry.p@example.com |

### Bookings (10)

| Ref | Customer | Route | Date | Class | Price | Refundable | Status |
|-----|----------|-------|------|-------|-------|:----------:|--------|
| ON-204881 | Alice Johnson | NYC → LAX | Jun 15 | business | $1,250 | Yes | confirmed |
| ON-331200 | Bob Martinez | CHI → MIA | Jun 20 | economy | $320 | No | confirmed |
| ON-100234 | Carol Chen | SFO → TYO | Jul 1 | first | $5,800 | Yes | confirmed |
| ON-550012 | Alice Johnson | LAX → LHR | Jun 25 | prem_econ | $1,890 | Yes | confirmed |
| ON-771003 | David Park | DFW → DEN | Jun 18 | economy | $210 | No | confirmed |
| ON-882211 | Emma Wilson | BOS → CDG | Jul 10 | business | $3,200 | Yes | pending |
| ON-443322 | Frank Obi | ATL → DXB | Jun 28 | economy | $780 | No | confirmed |
| ON-990100 | Grace Kim | SEA → SIN | Jun 12 | business | $4,100 | Yes | cancelled |
| ON-667788 | Henry Patel | MIA → NYC | May 28 | economy | $180 | No | completed |
| ON-112233 | Carol Chen | TYO → SFO | Jul 15 | first | $5,600 | Yes | confirmed |

### Policies (10)

1. Cancellation Policy — General
2. Rebooking / Change Policy
3. Delay and Disruption Compensation
4. Baggage Policy
5. No-Show Policy
6. Unaccompanied Minor Policy
7. Medical Cancellation Policy
8. Overbooking and Denied Boarding Compensation
9. Loyalty Tier Benefits
10. Upgrade Policy

---

## 6. All API Endpoints

### Dialogflow CX Webhook
```
POST /dialogflow/webhook
Body: { fulfillmentInfo: { tag: "..." }, sessionInfo: { parameters: {...} } }
Response: { fulfillmentResponse: { messages: [{ text: { text: ["..."] } }] } }
```

### Direct API (for testing without CX)

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| GET | `/health` | — | Health check |
| GET | `/api/bookings/:ref` | — | Look up a booking |
| POST | `/api/policy` | `{ query: "..." }` | Ask a policy question |
| POST | `/api/rebook` | `{ booking_ref, new_date, new_city? }` | Propose a rebooking |
| POST | `/api/refund` | `{ booking_ref }` | Propose a refund |
| POST | `/api/escalate` | `{ reason? }` | Propose an escalation |
| POST | `/api/proposals/:id/confirm` | — | Confirm a proposal (executes it) |
| POST | `/api/proposals/:id/reject` | — | Reject a proposal (discards it) |
| POST | `/api/chat` | `{ message: "..." }` | General chat (fallback) |

### Example: Test the full HITL flow with curl

```bash
# Step 1: Propose a refund
curl -X POST https://oneairagent.onrender.com/api/refund \
  -H "Content-Type: application/json" \
  -d '{"booking_ref": "ON-204881"}'

# Response includes proposal.id = "abc-123"

# Step 2: Confirm it (booking gets cancelled)
curl -X POST https://oneairagent.onrender.com/api/proposals/abc-123/confirm

# Step 3: Check the booking — now it's cancelled
curl https://oneairagent.onrender.com/api/bookings/ON-204881
```

---

## 7. How HITL Works

HITL = Human-in-the-Loop. It's the core safety pattern.

```
                    ┌──────────────┐
                    │  LLM says:   │
                    │  "refund     │
                    │   this"      │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  Validator   │
                    │  checks DB   │──── INVALID? → Error message, no proposal
                    └──────┬───────┘
                           │ VALID
                    ┌──────▼───────┐
                    │  HITL Gate   │
                    │  creates     │
                    │  PROPOSAL    │──── status: "pending"
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │   Staff      │
                    │   sees card  │
                    │  [Confirm]   │
                    │  [Reject]    │
                    └──┬───────┬───┘
                       │       │
               Confirm │       │ Reject
                       │       │
                ┌──────▼──┐ ┌──▼──────┐
                │ EXECUTE  │ │ DISCARD │
                │ update   │ │ nothing │
                │ database │ │ happens │
                └──────────┘ └─────────┘
```

**The key insight:** Between the LLM saying "do this" and the action actually happening, there are THREE barriers:
1. **Validation** — checks the action against the real database
2. **HITL Gate** — requires human confirmation
3. **Audit Log** — records everything for accountability

Even if the LLM is compromised (prompt injection), it can only create proposals. It can never execute.

---

## 8. How RAG Works

RAG = Retrieval-Augmented Generation.

**The problem:** If you just ask an LLM "what's the cancellation policy?", it answers from training data — which might be wrong, outdated, or made up.

**The solution:** Find the actual policy document first, then tell the LLM "answer using THIS document."

```
User: "What's the cancellation policy for business class?"
                │
                ▼
        ┌───────────────┐
        │  Retriever    │
        │  searches     │──── Mock: keyword matching
        │  10 policy    │     Real: vector similarity (pgvector)
        │  documents    │
        └───────┬───────┘
                │ Top 3 matches
                ▼
        ┌───────────────┐
        │  Format as    │
        │  "[Source 1:  │
        │   Cancel...   │
        │   Policy]     │
        │   Full text   │
        │   here..."    │
        └───────┬───────┘
                │
                ▼
        ┌───────────────┐
        │  LLM Prompt:  │
        │  "Answer      │
        │   using ONLY  │
        │   these       │
        │   sources.    │──── The LLM can't make stuff up
        │   Cite which  │     because the sources are right there
        │   source."    │
        └───────┬───────┘
                │
                ▼
        ┌───────────────┐
        │  LLM Answer:  │
        │  "For business│
        │   class, the  │
        │   cancellation│
        │   fee is..."  │
        │  [Source 1]   │
        └───────────────┘
```

---

## 9. Security Patterns

| Pattern | What it prevents | Where it's enforced |
|---------|-----------------|-------------------|
| **HITL** | AI executing actions without human approval | `hitl.ts` — proposals require confirmation |
| **Validation** | Invalid actions (nonexistent bookings, past dates) | `validation.ts` — checks DB before proposing |
| **Capability gating** | LLM doing anything outside the 5 allowed tools | `tools/index.ts` — fixed tool list |
| **PII redaction** | Customer data in logs | `audit.ts` — auto-redacts names, emails, etc. |
| **Prompt injection resistance** | Attacker manipulating the LLM via user input | Architecture — authority is in `hitl.ts` + `validation.ts`, not the prompt |

**The most important thing:** Security doesn't depend on the prompt being clever. Even if the LLM is completely compromised, the backend still:
- Validates every action against the real database
- Requires a human to click Confirm
- Logs everything with full traceability

---

## 10. Mock vs Real

| Component | Mock (now) | Real (Phase 5) | What changes |
|-----------|-----------|----------------|-------------|
| Database | In-memory Maps | PostgreSQL + pgvector | Swap `MockDataStore` → `PostgresDataStore` |
| LLM | Keyword matching | OpenAI GPT-4 | Swap `MockLLMProvider` → `OpenAIProvider` |
| RAG search | Word overlap counting | Vector cosine similarity | Same `PolicyRetriever`, different `searchPolicies()` impl |
| Embeddings | None | OpenAI text-embedding-3-small | Add embedding step in `PolicyRetriever.retrieve()` |
| Cache | None | Redis | Add cache layer in DataStore |

**The swap is a config change, not a rewrite.** Set `USE_MOCK_LLM=false` and `OPENAI_API_KEY=sk-...` in Render's environment variables, and the system uses the real LLM. Same for the database.

This is why `DataStore` and `LLMProvider` are interfaces — the orchestrator doesn't know or care whether it's talking to a Mock or a real service. It calls the same methods either way.
