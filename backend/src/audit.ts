import { DataStore } from './data/store';
import { AuditEntry } from './types';

export class AuditLogger {
  constructor(private store: DataStore) {}

  async log(
    traceId: string,
    sessionId: string,
    actorId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<AuditEntry> {
    // Redact PII before logging — only IDs, never names/emails/payment
    const redacted = this.redact(payload);

    return this.store.writeAudit({
      traceId,
      sessionId,
      actorId,
      eventType,
      payload: redacted,
    });
  }

  private redact(payload: Record<string, unknown>): Record<string, unknown> {
    const sensitiveKeys = ['name', 'email', 'phone', 'address', 'card', 'payment', 'ssn', 'password'];
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(payload)) {
      if (sensitiveKeys.some(s => key.toLowerCase().includes(s))) {
        result[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        result[key] = this.redact(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  async getSessionAudit(sessionId: string): Promise<AuditEntry[]> {
    return this.store.getAuditBySession(sessionId);
  }
}
