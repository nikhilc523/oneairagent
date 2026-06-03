# Dialogflow CX Agent — Setup Guide

This directory contains the complete configuration for the **OneAir Operations Agent** in Dialogflow CX (Conversational Agents).

## Architecture Overview

```
Staff message → CX classifies intent → collects missing params via slot-filling
             → calls webhook with fulfillment tag → backend handles LLM/RAG/HITL
             → returns fulfillment text to CX → CX relays to staff
```

CX handles: intent detection, parameter collection, session state, routing.
CX does NOT handle: AI answers (that's the backend LLM), HITL confirmation (that's WebSocket), money.

## Directory Structure

```
dialogflow/
├── agent.json                          # Agent settings (name, language, NLU config)
├── entityTypes/
│   ├── booking_ref.json                # Regexp: ON-\d{6}
│   ├── city.json                       # Airport codes + city synonyms
│   └── action_confirmation.json        # yes/no synonyms
├── intents/
│   ├── intent.rebook.json              # 20 training phrases
│   ├── intent.cancel_refund.json       # 18 training phrases
│   ├── intent.policy.json              # 18 training phrases
│   ├── intent.booking_status.json      # 17 training phrases
│   └── intent.escalate.json            # 16 training phrases
├── flows/
│   └── Default Start Flow/
│       ├── flow.json                   # Flow settings + no-match handlers
│       ├── pages/
│       │   ├── Collect Rebook Params.json
│       │   ├── Collect Cancel Params.json
│       │   ├── Handle Policy Query.json
│       │   ├── Collect Status Params.json
│       │   ├── Handle Escalation.json
│       │   └── End Session.json
│       └── routeGroups/
│           ├── global-intent-routes.json
│           └── escalation-always-available.json
├── webhooks/
│   └── oneair-webhook.json             # Single webhook, 6 fulfillment tags
└── testCases/                          # Conversation test scenarios
    ├── rebook-happy-path.json
    ├── rebook-slot-filling.json
    ├── refund-happy-path.json
    ├── policy-question.json
    ├── booking-status.json
    ├── escalation.json
    └── fallback-no-match.json
```

## Setup Steps

### Prerequisites

- A Google Cloud project with billing enabled
- Dialogflow CX API enabled (`dialogflow.googleapis.com`)
- The backend running (locally or deployed) to handle webhooks

### 1. Create the CX Agent

1. Go to [Dialogflow CX Console](https://dialogflow.cloud.google.com/cx)
2. Select your GCP project
3. Click **Create Agent**
4. Set:
   - Display name: `OneAir Operations Agent`
   - Location: `us-central1` (or your preferred region)
   - Default language: `English (en)`
   - Time zone: `America/New_York`
5. Click **Create**

### 2. Create Entity Types

Create these in order (entities must exist before intents reference them):

1. **booking_ref** (Manage → Entity Types → Create)
   - Kind: **Regexp**
   - Pattern: `ON-\d{6}`

2. **city** (Manage → Entity Types → Create)
   - Kind: **Map**
   - Enable: Auto-expansion, Fuzzy matching
   - Add entries from `entityTypes/city.json` (value + synonyms)

3. **action_confirmation** (Manage → Entity Types → Create)
   - Kind: **Map**
   - Enable: Fuzzy matching
   - Add entries: `yes` (with synonyms) and `no` (with synonyms)

### 3. Create Intents

For each file in `intents/`:

1. Go to Manage → Intents → Create
2. Set the display name (e.g., `intent.rebook`)
3. Add all training phrases from the JSON file
4. For phrases with entity annotations (`parameterId`), highlight the annotated text and assign the correct entity type
5. Save

**Order doesn't matter for intents**, but create all 5 before building flows.

### 4. Create the Webhook

1. Go to Manage → Webhooks → Create
2. Display name: `oneair-webhook`
3. Webhook URL:
   - **Local dev:** Use ngrok — run `ngrok http 3000` and use the forwarding URL + `/dialogflow/webhook`
   - **Production:** Your deployed backend URL + `/dialogflow/webhook`
4. Timeout: `10s`
5. Save

### 5. Build the Flow

All pages live in the **Default Start Flow** (the built-in flow created with the agent).

#### 5a. Create Pages

Create each page from the `flows/Default Start Flow/pages/` JSON files:

1. Open the Default Start Flow in the visual builder
2. Click **+** to add a page
3. Configure each page's:
   - Entry fulfillment (the greeting message)
   - Form parameters (entity type, required flag, prompts, reprompts)
   - Transition routes (condition: `$page.params.status = "FINAL"`, webhook + tag, target: Start Page)
   - Event handlers (sys.no-match-default → webhook `fallback.general`)

#### 5b. Create Route Groups

1. **global-intent-routes** — In the flow settings, create a Route Group
   - Add 5 routes, one per intent, each transitioning to the matching page
   - Set parameter presets on each route (see `routeGroups/global-intent-routes.json`)
   - Attach to the **Start Page**

2. **escalation-always-available** — Create another Route Group
   - Single route: `intent.escalate` → Handle Escalation page
   - Attach to: Collect Rebook Params, Collect Cancel Params, Collect Status Params

#### 5c. Configure Flow-Level Event Handlers

In the flow settings (click the flow name → Edit):
- `sys.no-match-default` → webhook `fallback.general`
- `sys.no-match-2` → static message listing capabilities
- `sys.no-match-3` → auto-escalate via webhook `escalate.propose`
- `sys.no-input-default` → "I'm still here. What can I help you with?"

### 6. Test

Use the **Test Agent** panel in the CX Console:

| Test | Expected |
|------|----------|
| "Rebook ON-204881 to next Friday" | Intent: rebook, webhook tag: `rebook.propose`, params: booking_ref + new_date |
| "Cancel ON-331200" | Intent: cancel_refund, webhook tag: `refund.propose`, params: booking_ref |
| "What's the cancellation policy?" | Intent: policy, webhook tag: `policy.answer`, params: raw_query |
| "Status of ON-204881" | Intent: booking_status, webhook tag: `booking.status`, params: booking_ref |
| "I need to escalate this" | Intent: escalate, webhook tag: `escalate.propose` |
| "asdfghjkl" | No match → webhook tag: `fallback.general` |
| "I need to change a flight" (no params) | Intent: rebook → prompts for booking_ref → prompts for new_date |

### 7. Connect to Backend

The backend webhook handler is at `backend/src/dialogflow/webhook.ts`. It routes by `fulfillmentInfo.tag`:

| Tag | Action |
|-----|--------|
| `rebook.propose` | Validate booking → LLM proposes rebook → sends proposal over WS |
| `refund.propose` | Validate booking → compute refund eligibility → sends proposal over WS |
| `policy.answer` | RAG retrieval → LLM generates grounded answer → returns inline |
| `booking.status` | DataStore lookup → returns formatted itinerary inline |
| `escalate.propose` | Creates escalation proposal → sends over WS |
| `fallback.general` | LLM attempts a helpful response or redirects |

## Webhook Request/Response Format

**Request** (what CX sends to your backend):
```json
{
  "fulfillmentInfo": { "tag": "rebook.propose" },
  "sessionInfo": {
    "session": "projects/PROJECT_ID/locations/us-central1/agents/AGENT_ID/sessions/SESSION_ID",
    "parameters": {
      "booking_ref": "ON-204881",
      "new_date": "2026-06-05",
      "new_city": "Chicago"
    }
  },
  "text": "Rebook ON-204881 to next Friday to Chicago"
}
```

**Response** (what your backend returns):
```json
{
  "fulfillmentResponse": {
    "messages": [
      {
        "text": {
          "text": ["I've found options for rebooking ON-204881. Check the proposal in your queue."]
        }
      }
    ]
  },
  "sessionInfo": {
    "parameters": {
      "returning": true
    }
  }
}
```

## Notes

- **Placeholder IDs:** All JSON files use `PROJECT_ID`, `AGENT_ID`, `FLOW_ID`, etc. as placeholders. CX auto-generates real IDs when you create resources through the console. These files are reference configs, not direct imports.
- **No PII in CX logs:** Booking references (ON-XXXXXX) are not PII. Customer names/emails never pass through CX — they're resolved by the backend from the booking ref.
- **CX is stateless about money:** HITL confirm/reject flows are handled entirely over WebSocket between the app and backend. CX never knows whether a proposal was accepted.
