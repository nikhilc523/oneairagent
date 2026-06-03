// ─── Domain Models ───

export interface Customer {
  id: string;
  name: string;
  email: string;
  tier: 'standard' | 'silver' | 'gold' | 'platinum';
}

export interface Booking {
  ref: string;            // ON-XXXXXX
  customerId: string;
  status: 'confirmed' | 'cancelled' | 'completed' | 'pending';
  origin: string;
  destination: string;
  departAt: string;       // ISO datetime
  fareClass: 'economy' | 'premium_economy' | 'business' | 'first';
  price: number;
  refundable: boolean;
}

export interface Policy {
  id: string;
  title: string;
  body: string;
  embedding?: number[];   // vector(1536) in prod
}

export interface AuditEntry {
  id: string;
  traceId: string;
  sessionId: string;
  actorId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface Session {
  id: string;
  actorId: string;
  summary: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

// ─── Action Proposals (HITL) ───

export type ActionType = 'rebook' | 'refund' | 'escalation';

export interface ActionProposal {
  id: string;
  traceId: string;
  sessionId: string;
  type: ActionType;
  params: Record<string, unknown>;
  summary: string;         // human-readable description
  status: 'pending' | 'confirmed' | 'rejected' | 'executed' | 'failed';
  createdAt: string;
  resolvedAt?: string;
  result?: Record<string, unknown>;
}

// ─── Webhook ───

export interface WebhookRequest {
  fulfillmentInfo: {
    tag: string;
  };
  sessionInfo: {
    session: string;
    parameters: Record<string, unknown>;
  };
  text?: string;
}

export interface WebhookResponse {
  fulfillmentResponse: {
    messages: Array<{
      text: { text: string[] };
    }>;
  };
  sessionInfo?: {
    parameters?: Record<string, unknown>;
  };
}

// ─── LLM ───

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMResponse {
  content: string;
  toolCalls?: LLMToolCall[];
}
