import { ToolDefinition } from '../llm/provider';

// These are the ONLY tools the LLM can call.
// propose_* tools never execute — they emit a proposal object for HITL review.

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'search_bookings',
    description: 'Look up a booking by reference number. Returns booking details including status, route, date, fare class, and price. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        booking_ref: {
          type: 'string',
          description: 'The booking reference (e.g., ON-204881)',
        },
      },
      required: ['booking_ref'],
    },
  },
  {
    name: 'get_policy',
    description: 'Search OneAir policy documents for information relevant to the query. Returns matching policy text with source titles.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The policy question to search for',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'propose_rebook',
    description: 'Propose rebooking a passenger to a different flight/date. This does NOT execute the rebook — it creates a proposal for human review.',
    parameters: {
      type: 'object',
      properties: {
        booking_ref: {
          type: 'string',
          description: 'The booking to rebook',
        },
        new_date: {
          type: 'string',
          description: 'The new departure date (ISO format)',
        },
        new_city: {
          type: 'string',
          description: 'New destination city (optional, only if changing destination)',
        },
        summary: {
          type: 'string',
          description: 'Human-readable summary of the proposed change',
        },
      },
      required: ['booking_ref', 'new_date', 'summary'],
    },
  },
  {
    name: 'propose_refund',
    description: 'Propose cancelling a booking and processing a refund. This does NOT execute — it creates a proposal for human review.',
    parameters: {
      type: 'object',
      properties: {
        booking_ref: {
          type: 'string',
          description: 'The booking to cancel',
        },
        refund_amount: {
          type: 'number',
          description: 'Calculated refund amount',
        },
        fee: {
          type: 'number',
          description: 'Any applicable cancellation fee',
        },
        summary: {
          type: 'string',
          description: 'Human-readable summary of refund eligibility',
        },
      },
      required: ['booking_ref', 'summary'],
    },
  },
  {
    name: 'propose_escalation',
    description: 'Propose escalating the case to a supervisor or specialist team. This does NOT execute — it creates a proposal for human review.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Why this case needs escalation',
        },
        summary: {
          type: 'string',
          description: 'Brief summary for the receiving team',
        },
      },
      required: ['summary'],
    },
  },
];

export type ToolName = 'search_bookings' | 'get_policy' | 'propose_rebook' | 'propose_refund' | 'propose_escalation';

export function isDestructiveTool(name: string): boolean {
  return name.startsWith('propose_');
}
