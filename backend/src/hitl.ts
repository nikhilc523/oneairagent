import { v4 as uuid } from 'uuid';
import { DataStore } from './data/store';
import { AuditLogger } from './audit';
import { ActionProposal, ActionType } from './types';

export class HITLGate {
  constructor(
    private store: DataStore,
    private audit: AuditLogger,
  ) {}

  async createProposal(
    traceId: string,
    sessionId: string,
    actorId: string,
    type: ActionType,
    params: Record<string, unknown>,
    summary: string,
  ): Promise<ActionProposal> {
    const proposal: ActionProposal = {
      id: uuid(),
      traceId,
      sessionId,
      type,
      params,
      summary,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    await this.store.saveProposal(proposal);

    await this.audit.log(traceId, sessionId, actorId, 'proposal_created', {
      proposalId: proposal.id,
      type,
      params,
      summary,
    });

    return proposal;
  }

  async confirm(
    proposalId: string,
    actorId: string,
  ): Promise<ActionProposal | null> {
    const proposal = await this.store.getProposal(proposalId);
    if (!proposal || proposal.status !== 'pending') return null;

    // Execute the action
    const result = await this.execute(proposal);

    const updated = await this.store.updateProposal(proposalId, {
      status: result.success ? 'executed' : 'failed',
      resolvedAt: new Date().toISOString(),
      result: result.data,
    });

    await this.audit.log(proposal.traceId, proposal.sessionId, actorId, 'proposal_confirmed', {
      proposalId,
      result: result.data,
    });

    return updated;
  }

  async reject(
    proposalId: string,
    actorId: string,
  ): Promise<ActionProposal | null> {
    const proposal = await this.store.getProposal(proposalId);
    if (!proposal || proposal.status !== 'pending') return null;

    const updated = await this.store.updateProposal(proposalId, {
      status: 'rejected',
      resolvedAt: new Date().toISOString(),
    });

    await this.audit.log(proposal.traceId, proposal.sessionId, actorId, 'proposal_rejected', {
      proposalId,
    });

    return updated;
  }

  private async execute(proposal: ActionProposal): Promise<{ success: boolean; data: Record<string, unknown> }> {
    switch (proposal.type) {
      case 'rebook': {
        const booking = await this.store.getBooking(proposal.params.booking_ref as string);
        if (!booking) return { success: false, data: { error: 'Booking not found' } };

        const updated = await this.store.updateBooking(booking.ref, {
          departAt: proposal.params.new_date as string,
          destination: (proposal.params.new_city as string) || booking.destination,
        });

        return {
          success: true,
          data: {
            message: `Booking ${booking.ref} rebooked successfully.`,
            newDepartAt: updated?.departAt,
            newDestination: updated?.destination,
          },
        };
      }

      case 'refund': {
        const booking = await this.store.getBooking(proposal.params.booking_ref as string);
        if (!booking) return { success: false, data: { error: 'Booking not found' } };

        await this.store.updateBooking(booking.ref, { status: 'cancelled' });

        return {
          success: true,
          data: {
            message: `Booking ${booking.ref} cancelled. Refund of $${proposal.params.refund_amount || 0} will be processed.`,
            refundAmount: proposal.params.refund_amount,
            fee: proposal.params.fee,
          },
        };
      }

      case 'escalation': {
        // In prod: create a ticket in the escalation system
        return {
          success: true,
          data: {
            message: 'Case escalated to supervisor queue.',
            escalationId: `ESC-${Date.now()}`,
            reason: proposal.params.reason || 'No reason provided',
          },
        };
      }

      default:
        return { success: false, data: { error: `Unknown action type: ${proposal.type}` } };
    }
  }
}
