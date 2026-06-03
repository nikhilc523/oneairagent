import { Customer, Booking, Policy, AuditEntry, Session, ActionProposal } from '../types';

export interface DataStore {
  // Customers
  getCustomer(id: string): Promise<Customer | null>;
  getCustomerByEmail(email: string): Promise<Customer | null>;

  // Bookings
  getBooking(ref: string): Promise<Booking | null>;
  getBookingsByCustomer(customerId: string): Promise<Booking[]>;
  updateBooking(ref: string, updates: Partial<Booking>): Promise<Booking | null>;

  // Policies
  getAllPolicies(): Promise<Policy[]>;
  searchPolicies(query: string): Promise<Policy[]>;

  // Audit
  writeAudit(entry: Omit<AuditEntry, 'id' | 'createdAt'>): Promise<AuditEntry>;
  getAuditBySession(sessionId: string): Promise<AuditEntry[]>;

  // Sessions
  getSession(id: string): Promise<Session | null>;
  upsertSession(session: Session): Promise<Session>;

  // Action proposals (HITL)
  getProposal(id: string): Promise<ActionProposal | null>;
  getPendingProposals(sessionId: string): Promise<ActionProposal[]>;
  saveProposal(proposal: ActionProposal): Promise<ActionProposal>;
  updateProposal(id: string, updates: Partial<ActionProposal>): Promise<ActionProposal | null>;
}
