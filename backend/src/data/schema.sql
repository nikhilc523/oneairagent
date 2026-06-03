-- OneAir Agent Database Schema
-- PostgreSQL 15+ with pgvector extension
-- This schema mirrors the in-memory mock DB for production use (Phase 5)

CREATE EXTENSION IF NOT EXISTS "pgvector";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Customers ───

CREATE TABLE customers (
  id          TEXT PRIMARY KEY DEFAULT 'cust-' || substr(uuid_generate_v4()::text, 1, 8),
  name        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  tier        TEXT NOT NULL DEFAULT 'standard'
              CHECK (tier IN ('standard', 'silver', 'gold', 'platinum')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_customers_tier ON customers(tier);

-- ─── Bookings ───

CREATE TABLE bookings (
  ref          TEXT PRIMARY KEY,                  -- ON-XXXXXX
  customer_id  TEXT NOT NULL REFERENCES customers(id),
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('confirmed', 'cancelled', 'completed', 'pending')),
  origin       TEXT NOT NULL,
  destination  TEXT NOT NULL,
  depart_at    TIMESTAMPTZ NOT NULL,
  fare_class   TEXT NOT NULL
               CHECK (fare_class IN ('economy', 'premium_economy', 'business', 'first')),
  price        NUMERIC(10,2) NOT NULL,
  refundable   BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bookings_customer ON bookings(customer_id);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_bookings_depart ON bookings(depart_at);

-- ─── Policies (with pgvector embeddings for RAG) ───

CREATE TABLE policies (
  id         TEXT PRIMARY KEY DEFAULT 'pol-' || substr(uuid_generate_v4()::text, 1, 8),
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  embedding  vector(1536),                        -- OpenAI text-embedding-3-small
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_policies_embedding ON policies
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 10);

-- ─── Audit Log ───

CREATE TABLE audit_log (
  id               TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  trace_id         TEXT NOT NULL,
  session_id       TEXT NOT NULL,
  actor_id         TEXT NOT NULL,
  event_type       TEXT NOT NULL,
  payload_redacted JSONB NOT NULL DEFAULT '{}',    -- no PII: IDs only
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_session ON audit_log(session_id);
CREATE INDEX idx_audit_trace ON audit_log(trace_id);
CREATE INDEX idx_audit_created ON audit_log(created_at);

-- ─── Sessions ───

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  actor_id    TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  messages    JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_actor ON sessions(actor_id);

-- ─── Action Proposals (HITL) ───

CREATE TABLE action_proposals (
  id          TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  trace_id    TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('rebook', 'refund', 'escalation')),
  params      JSONB NOT NULL DEFAULT '{}',
  summary     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'confirmed', 'rejected', 'executed', 'failed')),
  result      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_proposals_session ON action_proposals(session_id);
CREATE INDEX idx_proposals_status ON action_proposals(status);

-- ─── Seed Data ───

INSERT INTO customers (id, name, email, tier) VALUES
  ('cust-001', 'Alice Johnson', 'alice.j@example.com', 'gold'),
  ('cust-002', 'Bob Martinez', 'bob.m@example.com', 'standard'),
  ('cust-003', 'Carol Chen', 'carol.c@example.com', 'platinum'),
  ('cust-004', 'David Park', 'david.p@example.com', 'silver'),
  ('cust-005', 'Emma Wilson', 'emma.w@example.com', 'standard'),
  ('cust-006', 'Frank Obi', 'frank.o@example.com', 'gold'),
  ('cust-007', 'Grace Kim', 'grace.k@example.com', 'silver'),
  ('cust-008', 'Henry Patel', 'henry.p@example.com', 'standard');

INSERT INTO bookings (ref, customer_id, status, origin, destination, depart_at, fare_class, price, refundable) VALUES
  ('ON-204881', 'cust-001', 'confirmed', 'New York', 'Los Angeles', '2026-06-15T08:30:00Z', 'business', 1250.00, true),
  ('ON-331200', 'cust-002', 'confirmed', 'Chicago', 'Miami', '2026-06-20T14:00:00Z', 'economy', 320.00, false),
  ('ON-100234', 'cust-003', 'confirmed', 'San Francisco', 'Tokyo', '2026-07-01T22:00:00Z', 'first', 5800.00, true),
  ('ON-550012', 'cust-001', 'confirmed', 'Los Angeles', 'London', '2026-06-25T16:45:00Z', 'premium_economy', 1890.00, true),
  ('ON-771003', 'cust-004', 'confirmed', 'Dallas', 'Denver', '2026-06-18T09:15:00Z', 'economy', 210.00, false),
  ('ON-882211', 'cust-005', 'pending', 'Boston', 'Paris', '2026-07-10T19:30:00Z', 'business', 3200.00, true),
  ('ON-443322', 'cust-006', 'confirmed', 'Atlanta', 'Dubai', '2026-06-28T23:00:00Z', 'economy', 780.00, false),
  ('ON-990100', 'cust-007', 'cancelled', 'Seattle', 'Singapore', '2026-06-12T01:00:00Z', 'business', 4100.00, true),
  ('ON-667788', 'cust-008', 'completed', 'Miami', 'New York', '2026-05-28T11:00:00Z', 'economy', 180.00, false),
  ('ON-112233', 'cust-003', 'confirmed', 'Tokyo', 'San Francisco', '2026-07-15T10:00:00Z', 'first', 5600.00, true);

INSERT INTO policies (id, title, body) VALUES
  ('pol-001', 'Cancellation Policy — General', 'OneAir Cancellation Policy:
- Refundable tickets: Full refund minus a $50 processing fee if cancelled more than 24 hours before departure.
- Non-refundable tickets: No cash refund. A travel credit equal to the fare minus a $150 change fee is issued, valid for 12 months.
- All tickets: Free cancellation within 24 hours of purchase, regardless of fare class (DOT 24-hour rule).
- Cancellations within 24 hours of departure: Refundable tickets receive 80% refund. Non-refundable tickets receive no refund or credit.
- Group bookings (10+ passengers): Subject to separate group cancellation terms. Contact the groups desk.'),
  ('pol-002', 'Rebooking / Change Policy', 'OneAir Rebooking Policy:
- Refundable tickets: Free date/time changes. Destination changes incur a $75 routing fee plus any fare difference.
- Non-refundable tickets: $150 change fee plus any fare difference. If the new fare is lower, the difference is issued as a travel credit.
- Same-day changes: Available for $50 (economy) or free (business/first), subject to availability.
- Changes must be made at least 2 hours before the original departure.
- Involuntary changes (airline-initiated schedule change >2 hours): Free rebooking to any available flight within 7 days, or full refund regardless of fare class.'),
  ('pol-003', 'Delay and Disruption Compensation', 'OneAir Delay & Disruption Policy:
- Delays 2-4 hours: Meal voucher ($15) provided at the gate.
- Delays 4+ hours: Meal voucher ($25) + option to rebook on next available flight at no cost.
- Overnight delays (no same-day flight available): Hotel accommodation provided (partner hotels) + ground transport + $25 meal voucher per meal.
- Cancellation by airline: Full refund or rebooking on next available flight. If rebooking results in arrival 4+ hours later than original, $200 compensation credit.
- Tarmac delays: Passengers deplaned after 3 hours (domestic) or 4 hours (international) per DOT rules. Snacks and water provided after 2 hours.
- Weather-related delays: Rebooking provided at no cost but no hotel/meal vouchers (force majeure).'),
  ('pol-004', 'Baggage Policy', 'OneAir Baggage Policy:
- Carry-on: 1 bag (22x14x9 inches) + 1 personal item, all fare classes.
- Checked bags — Economy: 1st bag $35, 2nd bag $45. Max 50 lbs each.
- Checked bags — Premium Economy: 1st bag free, 2nd bag $35. Max 50 lbs each.
- Checked bags — Business: 2 bags free. Max 70 lbs each.
- Checked bags — First: 3 bags free. Max 70 lbs each.
- Overweight (50-70 lbs): $75 surcharge. Over 70 lbs: $150 surcharge.
- Lost baggage: File a claim within 24 hours. Compensation up to $3,800 (domestic) per DOT guidelines.'),
  ('pol-005', 'No-Show Policy', 'OneAir No-Show Policy:
- If a passenger does not check in or board, the booking is marked as a no-show.
- Refundable tickets: 50% refund minus $50 processing fee.
- Non-refundable tickets: No refund. The ticket value is forfeited.
- Round-trip bookings: If the outbound is a no-show, the return segment is automatically cancelled.
- To avoid no-show penalties, cancel at least 2 hours before departure.'),
  ('pol-006', 'Unaccompanied Minor Policy', 'OneAir Unaccompanied Minor (UM) Policy:
- Ages 5-7: Accepted on direct/nonstop flights only. $150 UM service fee each way.
- Ages 8-14: Accepted on direct and connecting flights. $150 UM service fee each way.
- Ages 15-17: UM service optional ($75 fee). Can travel as regular passenger.
- UM bookings must be made by phone or at a ticket counter — not available online.'),
  ('pol-007', 'Medical Cancellation Policy', 'OneAir Medical Cancellation Policy:
- Passengers unable to travel due to medical reasons may request a full refund regardless of fare class.
- Required documentation: A signed letter from a licensed physician stating the passenger is unfit to travel, dated within 10 days of the scheduled departure.
- Processing time: 10-15 business days after receipt of documentation.'),
  ('pol-008', 'Overbooking and Denied Boarding Compensation', 'OneAir Overbooking Policy:
- OneAir may overbook flights. If a flight is oversold, we first seek volunteers willing to take a later flight in exchange for compensation.
- Involuntary denied boarding: Arrival delay 1-2 hours: 200% of one-way fare, max $775. Arrival delay 2+ hours: 400% of one-way fare, max $1,550.'),
  ('pol-009', 'Loyalty Tier Benefits', 'OneAir Loyalty Tiers:
- Standard: Base earn rate (1 mile per $1). No priority. Standard baggage fees.
- Silver: 1.25x earn rate. Priority check-in. 1 free checked bag.
- Gold: 1.5x earn rate. Priority boarding + check-in. 2 free checked bags. Complimentary same-day changes.
- Platinum: 2x earn rate. 3 free checked bags. Unlimited complimentary changes. Unlimited lounge access. Guaranteed seat.'),
  ('pol-010', 'Upgrade Policy', 'OneAir Upgrade Policy:
- Paid upgrades: Available at check-in or at the gate. Price varies by route and availability.
- Mileage upgrades: Economy to Premium Economy: 10,000 miles. Premium Economy to Business: 25,000 miles. Business to First: 30,000 miles.
- Complimentary upgrades: Platinum members receive complimentary upgrades when available. Gold members are waitlisted.');
