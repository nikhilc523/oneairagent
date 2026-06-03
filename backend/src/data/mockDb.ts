import { v4 as uuid } from 'uuid';
import { DataStore } from './store';
import { Customer, Booking, Policy, AuditEntry, Session, ActionProposal } from '../types';

// ─── Seed Data ───

const CUSTOMERS: Customer[] = [
  { id: 'cust-001', name: 'Alice Johnson', email: 'alice.j@example.com', tier: 'gold' },
  { id: 'cust-002', name: 'Bob Martinez', email: 'bob.m@example.com', tier: 'standard' },
  { id: 'cust-003', name: 'Carol Chen', email: 'carol.c@example.com', tier: 'platinum' },
  { id: 'cust-004', name: 'David Park', email: 'david.p@example.com', tier: 'silver' },
  { id: 'cust-005', name: 'Emma Wilson', email: 'emma.w@example.com', tier: 'standard' },
  { id: 'cust-006', name: 'Frank Obi', email: 'frank.o@example.com', tier: 'gold' },
  { id: 'cust-007', name: 'Grace Kim', email: 'grace.k@example.com', tier: 'silver' },
  { id: 'cust-008', name: 'Henry Patel', email: 'henry.p@example.com', tier: 'standard' },
];

const BOOKINGS: Booking[] = [
  {
    ref: 'ON-204881', customerId: 'cust-001', status: 'confirmed',
    origin: 'New York', destination: 'Los Angeles',
    departAt: '2026-06-15T08:30:00Z', fareClass: 'business', price: 1250.00, refundable: true,
  },
  {
    ref: 'ON-331200', customerId: 'cust-002', status: 'confirmed',
    origin: 'Chicago', destination: 'Miami',
    departAt: '2026-06-20T14:00:00Z', fareClass: 'economy', price: 320.00, refundable: false,
  },
  {
    ref: 'ON-100234', customerId: 'cust-003', status: 'confirmed',
    origin: 'San Francisco', destination: 'Tokyo',
    departAt: '2026-07-01T22:00:00Z', fareClass: 'first', price: 5800.00, refundable: true,
  },
  {
    ref: 'ON-550012', customerId: 'cust-001', status: 'confirmed',
    origin: 'Los Angeles', destination: 'London',
    departAt: '2026-06-25T16:45:00Z', fareClass: 'premium_economy', price: 1890.00, refundable: true,
  },
  {
    ref: 'ON-771003', customerId: 'cust-004', status: 'confirmed',
    origin: 'Dallas', destination: 'Denver',
    departAt: '2026-06-18T09:15:00Z', fareClass: 'economy', price: 210.00, refundable: false,
  },
  {
    ref: 'ON-882211', customerId: 'cust-005', status: 'pending',
    origin: 'Boston', destination: 'Paris',
    departAt: '2026-07-10T19:30:00Z', fareClass: 'business', price: 3200.00, refundable: true,
  },
  {
    ref: 'ON-443322', customerId: 'cust-006', status: 'confirmed',
    origin: 'Atlanta', destination: 'Dubai',
    departAt: '2026-06-28T23:00:00Z', fareClass: 'economy', price: 780.00, refundable: false,
  },
  {
    ref: 'ON-990100', customerId: 'cust-007', status: 'cancelled',
    origin: 'Seattle', destination: 'Singapore',
    departAt: '2026-06-12T01:00:00Z', fareClass: 'business', price: 4100.00, refundable: true,
  },
  {
    ref: 'ON-667788', customerId: 'cust-008', status: 'completed',
    origin: 'Miami', destination: 'New York',
    departAt: '2026-05-28T11:00:00Z', fareClass: 'economy', price: 180.00, refundable: false,
  },
  {
    ref: 'ON-112233', customerId: 'cust-003', status: 'confirmed',
    origin: 'Tokyo', destination: 'San Francisco',
    departAt: '2026-07-15T10:00:00Z', fareClass: 'first', price: 5600.00, refundable: true,
  },
];

const POLICIES: Policy[] = [
  {
    id: 'pol-001',
    title: 'Cancellation Policy — General',
    body: `OneAir Cancellation Policy:
- Refundable tickets: Full refund minus a $50 processing fee if cancelled more than 24 hours before departure.
- Non-refundable tickets: No cash refund. A travel credit equal to the fare minus a $150 change fee is issued, valid for 12 months.
- All tickets: Free cancellation within 24 hours of purchase, regardless of fare class (DOT 24-hour rule).
- Cancellations within 24 hours of departure: Refundable tickets receive 80% refund. Non-refundable tickets receive no refund or credit.
- Group bookings (10+ passengers): Subject to separate group cancellation terms. Contact the groups desk.`,
  },
  {
    id: 'pol-002',
    title: 'Rebooking / Change Policy',
    body: `OneAir Rebooking Policy:
- Refundable tickets: Free date/time changes. Destination changes incur a $75 routing fee plus any fare difference.
- Non-refundable tickets: $150 change fee plus any fare difference. If the new fare is lower, the difference is issued as a travel credit.
- Same-day changes: Available for $50 (economy) or free (business/first), subject to availability.
- Changes must be made at least 2 hours before the original departure.
- Involuntary changes (airline-initiated schedule change >2 hours): Free rebooking to any available flight within 7 days, or full refund regardless of fare class.`,
  },
  {
    id: 'pol-003',
    title: 'Delay and Disruption Compensation',
    body: `OneAir Delay & Disruption Policy:
- Delays 2-4 hours: Meal voucher ($15) provided at the gate.
- Delays 4+ hours: Meal voucher ($25) + option to rebook on next available flight at no cost.
- Overnight delays (no same-day flight available): Hotel accommodation provided (partner hotels) + ground transport + $25 meal voucher per meal.
- Cancellation by airline: Full refund or rebooking on next available flight. If rebooking results in arrival 4+ hours later than original, $200 compensation credit.
- Tarmac delays: Passengers deplaned after 3 hours (domestic) or 4 hours (international) per DOT rules. Snacks and water provided after 2 hours.
- Weather-related delays: Rebooking provided at no cost but no hotel/meal vouchers (force majeure).`,
  },
  {
    id: 'pol-004',
    title: 'Baggage Policy',
    body: `OneAir Baggage Policy:
- Carry-on: 1 bag (22x14x9 inches) + 1 personal item, all fare classes.
- Checked bags — Economy: 1st bag $35, 2nd bag $45. Max 50 lbs each.
- Checked bags — Premium Economy: 1st bag free, 2nd bag $35. Max 50 lbs each.
- Checked bags — Business: 2 bags free. Max 70 lbs each.
- Checked bags — First: 3 bags free. Max 70 lbs each.
- Overweight (50-70 lbs): $75 surcharge. Over 70 lbs: $150 surcharge.
- Oversized bags: $100 surcharge per bag exceeding 62 linear inches.
- Lost baggage: File a claim within 24 hours. Compensation up to $3,800 (domestic) per DOT guidelines. Interim expenses reimbursed up to $50/day for 5 days.
- Delayed baggage: If not delivered within 12 hours, $50/day interim expense allowance for up to 5 days.`,
  },
  {
    id: 'pol-005',
    title: 'No-Show Policy',
    body: `OneAir No-Show Policy:
- If a passenger does not check in or board, the booking is marked as a no-show.
- Refundable tickets: 50% refund minus $50 processing fee.
- Non-refundable tickets: No refund. The ticket value is forfeited.
- Round-trip bookings: If the outbound is a no-show, the return segment is automatically cancelled.
- To avoid no-show penalties, cancel at least 2 hours before departure.`,
  },
  {
    id: 'pol-006',
    title: 'Unaccompanied Minor Policy',
    body: `OneAir Unaccompanied Minor (UM) Policy:
- Ages 5-7: Accepted on direct/nonstop flights only. $150 UM service fee each way.
- Ages 8-14: Accepted on direct and connecting flights. $150 UM service fee each way.
- Ages 15-17: UM service optional ($75 fee). Can travel as regular passenger.
- UM service includes: Dedicated staff escort, priority boarding, supervision during connections, handoff only to authorized pickup person (photo ID required).
- Maximum 2 UMs per flight in economy. No limit in business/first.
- UM bookings must be made by phone or at a ticket counter — not available online.`,
  },
  {
    id: 'pol-007',
    title: 'Medical Cancellation Policy',
    body: `OneAir Medical Cancellation Policy:
- Passengers unable to travel due to medical reasons may request a full refund regardless of fare class.
- Required documentation: A signed letter from a licensed physician stating the passenger is unfit to travel, dated within 10 days of the scheduled departure.
- Processing time: 10-15 business days after receipt of documentation.
- Travel companion: If the patient's travel companion also needs to cancel, both tickets are eligible for medical cancellation with the same documentation.
- Pre-existing conditions: Covered if the acute episode preventing travel is documented by the physician.`,
  },
  {
    id: 'pol-008',
    title: 'Overbooking and Denied Boarding Compensation',
    body: `OneAir Overbooking Policy:
- OneAir may overbook flights. If a flight is oversold, we first seek volunteers willing to take a later flight in exchange for compensation.
- Volunteer compensation: Travel credit of $200-$800 depending on the delay to the next available flight, plus meal vouchers.
- Involuntary denied boarding (IDB): If not enough volunteers, passengers bumped involuntarily receive:
  - Arrival delay 0-1 hour: No compensation required (per DOT).
  - Arrival delay 1-2 hours (domestic) / 1-4 hours (international): 200% of one-way fare, max $775.
  - Arrival delay 2+ hours (domestic) / 4+ hours (international): 400% of one-way fare, max $1,550.
- Passengers with disabilities, unaccompanied minors, and families with children under 6 are last to be involuntarily bumped.`,
  },
  {
    id: 'pol-009',
    title: 'Loyalty Tier Benefits',
    body: `OneAir Loyalty Tiers:
- Standard: Base earn rate (1 mile per $1). No priority. Standard baggage fees.
- Silver: 1.25x earn rate. Priority check-in. 1 free checked bag.
- Gold: 1.5x earn rate. Priority boarding + check-in. 2 free checked bags. Complimentary same-day changes. Lounge access (2 visits/year).
- Platinum: 2x earn rate. First-class check-in. 3 free checked bags. Unlimited complimentary changes. Unlimited lounge access. Guaranteed seat on any flight (within 24 hours of departure). Dedicated support line.`,
  },
  {
    id: 'pol-010',
    title: 'Upgrade Policy',
    body: `OneAir Upgrade Policy:
- Paid upgrades: Available at check-in (24 hours before departure) or at the gate. Price varies by route and availability.
- Mileage upgrades: Redeem miles for upgrades. Economy → Premium Economy: 10,000 miles. Premium Economy → Business: 25,000 miles. Business → First: 30,000 miles. Subject to availability.
- Complimentary upgrades: Platinum members receive complimentary upgrades to the next cabin class when available, confirmed at gate. Gold members are waitlisted.
- Upgrade priority: Platinum > Gold > Silver > fare class > check-in time.
- Upgrades are non-transferable and apply to the named passenger only.`,
  },
];

// ─── In-Memory Mock DataStore ───

export class MockDataStore implements DataStore {
  private customers: Map<string, Customer>;
  private bookings: Map<string, Booking>;
  private policies: Policy[];
  private auditLog: AuditEntry[] = [];
  private sessions: Map<string, Session> = new Map();
  private proposals: Map<string, ActionProposal> = new Map();

  constructor() {
    this.customers = new Map(CUSTOMERS.map(c => [c.id, c]));
    this.bookings = new Map(BOOKINGS.map(b => [b.ref, b]));
    this.policies = [...POLICIES];
  }

  // ── Customers ──

  async getCustomer(id: string): Promise<Customer | null> {
    return this.customers.get(id) || null;
  }

  async getCustomerByEmail(email: string): Promise<Customer | null> {
    for (const c of this.customers.values()) {
      if (c.email === email) return c;
    }
    return null;
  }

  // ── Bookings ──

  async getBooking(ref: string): Promise<Booking | null> {
    return this.bookings.get(ref) || null;
  }

  async getBookingsByCustomer(customerId: string): Promise<Booking[]> {
    return [...this.bookings.values()].filter(b => b.customerId === customerId);
  }

  async updateBooking(ref: string, updates: Partial<Booking>): Promise<Booking | null> {
    const booking = this.bookings.get(ref);
    if (!booking) return null;
    const updated = { ...booking, ...updates };
    this.bookings.set(ref, updated);
    return updated;
  }

  // ── Policies ──

  async getAllPolicies(): Promise<Policy[]> {
    return this.policies;
  }

  async searchPolicies(query: string): Promise<Policy[]> {
    const q = query.toLowerCase();
    const scored = this.policies.map(p => {
      const text = `${p.title} ${p.body}`.toLowerCase();
      const words = q.split(/\s+/).filter(w => w.length > 2);
      const hits = words.filter(w => text.includes(w)).length;
      return { policy: p, score: hits / Math.max(words.length, 1) };
    });
    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(s => s.policy);
  }

  // ── Audit ──

  async writeAudit(entry: Omit<AuditEntry, 'id' | 'createdAt'>): Promise<AuditEntry> {
    const full: AuditEntry = {
      ...entry,
      id: uuid(),
      createdAt: new Date().toISOString(),
    };
    this.auditLog.push(full);
    return full;
  }

  async getAuditBySession(sessionId: string): Promise<AuditEntry[]> {
    return this.auditLog.filter(a => a.sessionId === sessionId);
  }

  // ── Sessions ──

  async getSession(id: string): Promise<Session | null> {
    return this.sessions.get(id) || null;
  }

  async upsertSession(session: Session): Promise<Session> {
    this.sessions.set(session.id, session);
    return session;
  }

  // ── Action Proposals ──

  async getProposal(id: string): Promise<ActionProposal | null> {
    return this.proposals.get(id) || null;
  }

  async getPendingProposals(sessionId: string): Promise<ActionProposal[]> {
    return [...this.proposals.values()].filter(
      p => p.sessionId === sessionId && p.status === 'pending'
    );
  }

  async saveProposal(proposal: ActionProposal): Promise<ActionProposal> {
    this.proposals.set(proposal.id, proposal);
    return proposal;
  }

  async updateProposal(id: string, updates: Partial<ActionProposal>): Promise<ActionProposal | null> {
    const proposal = this.proposals.get(id);
    if (!proposal) return null;
    const updated = { ...proposal, ...updates };
    this.proposals.set(id, updated);
    return updated;
  }
}
