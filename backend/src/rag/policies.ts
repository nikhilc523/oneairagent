// Policy document titles for reference — the actual content lives in the DataStore seed data.
// This file exists as a quick index and for generating embeddings in prod (Phase 5).

export const POLICY_TITLES = [
  'Cancellation Policy — General',
  'Rebooking / Change Policy',
  'Delay and Disruption Compensation',
  'Baggage Policy',
  'No-Show Policy',
  'Unaccompanied Minor Policy',
  'Medical Cancellation Policy',
  'Overbooking and Denied Boarding Compensation',
  'Loyalty Tier Benefits',
  'Upgrade Policy',
] as const;

export type PolicyTitle = typeof POLICY_TITLES[number];
