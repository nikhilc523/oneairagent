import { v4 as uuid } from 'uuid';
import { DataStore } from './data/store';
import { LLMProvider } from './llm/provider';
import { PolicyRetriever } from './rag/retriever';
import { ProposalValidator } from './validation';
import { HITLGate } from './hitl';
import { AuditLogger } from './audit';
import { TOOL_DEFINITIONS, isDestructiveTool } from './tools';
import { LLMMessage, ActionProposal, Booking } from './types';

export interface OrchestratorResult {
  text: string;
  proposal?: ActionProposal;
  sources?: string[];
}

export class Orchestrator {
  private retriever: PolicyRetriever;
  private validator: ProposalValidator;

  constructor(
    private store: DataStore,
    private llm: LLMProvider,
    private hitl: HITLGate,
    private audit: AuditLogger,
  ) {
    this.retriever = new PolicyRetriever(store);
    this.validator = new ProposalValidator(store);
  }

  async handleRebook(
    sessionId: string,
    actorId: string,
    bookingRef: string,
    newDate: string,
    newCity?: string,
  ): Promise<OrchestratorResult> {
    const traceId = uuid();

    // Validate against ground truth
    const validation = await this.validator.validateRebook(bookingRef, newDate, newCity);
    if (!validation.valid) {
      await this.audit.log(traceId, sessionId, actorId, 'rebook_validation_failed', {
        bookingRef, newDate, newCity, error: validation.error,
      });
      return { text: validation.error! };
    }

    const booking = validation.booking!;
    const customer = await this.store.getCustomer(booking.customerId);
    const { fee, reason: feeReason } = this.validator.computeRebookFee(booking);

    // Build context for LLM
    const rebookPolicy = await this.retriever.retrieve('rebooking change policy');
    const policyContext = this.retriever.formatContext(rebookPolicy);

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `You are an airline operations assistant. Propose a rebooking based on the data below. Use the propose_rebook tool.\n\nBooking: ${bookingRef} | ${booking.origin} → ${booking.destination} | ${booking.departAt} | ${booking.fareClass} | $${booking.price} | ${booking.refundable ? 'refundable' : 'non-refundable'}\nCustomer tier: ${customer?.tier || 'unknown'}\nChange fee: $${fee} (${feeReason})\nNew date: ${newDate}${newCity ? ` | New destination: ${newCity}` : ''}\n\nPolicy:\n${policyContext}`,
      },
      {
        role: 'user',
        content: `Propose rebooking ${bookingRef} to ${newDate}${newCity ? ` to ${newCity}` : ''}.`,
      },
    ];

    const llmResponse = await this.llm.chat(messages, TOOL_DEFINITIONS);

    await this.audit.log(traceId, sessionId, actorId, 'llm_response', {
      bookingRef, toolCalls: llmResponse.toolCalls?.map(t => t.name),
    });

    // Handle tool call → create HITL proposal
    if (llmResponse.toolCalls?.length) {
      const toolCall = llmResponse.toolCalls[0];
      if (isDestructiveTool(toolCall.name)) {
        const proposal = await this.hitl.createProposal(
          traceId, sessionId, actorId, 'rebook',
          { booking_ref: bookingRef, new_date: newDate, new_city: newCity, fee },
          `Rebook ${bookingRef}: ${booking.origin} → ${newCity || booking.destination} on ${newDate}. Fee: $${fee}. ${feeReason}`,
        );
        return {
          text: `I've prepared a rebooking proposal for ${bookingRef}. Please review and confirm.`,
          proposal,
        };
      }
    }

    return { text: llmResponse.content || 'I was unable to process the rebooking request.' };
  }

  async handleRefund(
    sessionId: string,
    actorId: string,
    bookingRef: string,
  ): Promise<OrchestratorResult> {
    const traceId = uuid();

    const validation = await this.validator.validateRefund(bookingRef);
    if (!validation.valid) {
      await this.audit.log(traceId, sessionId, actorId, 'refund_validation_failed', {
        bookingRef, error: validation.error,
      });
      return { text: validation.error! };
    }

    const booking = validation.booking!;
    const customer = await this.store.getCustomer(booking.customerId);
    const { refundAmount, fee, reason } = this.validator.computeRefund(booking);

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `You are an airline operations assistant. Propose a refund using the propose_refund tool.\n\nBooking: ${bookingRef} | ${booking.origin} → ${booking.destination} | ${booking.departAt} | ${booking.fareClass} | $${booking.price} | ${booking.refundable ? 'refundable' : 'non-refundable'}\nCustomer tier: ${customer?.tier || 'unknown'}\nRefund calculation: $${refundAmount.toFixed(2)} refund, $${fee.toFixed(2)} fee. ${reason}`,
      },
      {
        role: 'user',
        content: `Process refund assessment for ${bookingRef}.`,
      },
    ];

    const llmResponse = await this.llm.chat(messages, TOOL_DEFINITIONS);

    await this.audit.log(traceId, sessionId, actorId, 'llm_response', {
      bookingRef, toolCalls: llmResponse.toolCalls?.map(t => t.name),
    });

    if (llmResponse.toolCalls?.length) {
      const proposal = await this.hitl.createProposal(
        traceId, sessionId, actorId, 'refund',
        { booking_ref: bookingRef, refund_amount: refundAmount, fee },
        `Cancel ${bookingRef} (${booking.origin} → ${booking.destination}, $${booking.price}). ${reason}`,
      );
      return {
        text: `I've assessed the refund eligibility for ${bookingRef}. Please review the proposal.`,
        proposal,
      };
    }

    return { text: llmResponse.content || 'I was unable to process the refund assessment.' };
  }

  async handlePolicyQuery(
    sessionId: string,
    actorId: string,
    query: string,
  ): Promise<OrchestratorResult> {
    const traceId = uuid();

    const policies = await this.retriever.retrieve(query);
    const policyContext = this.retriever.formatContext(policies);

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `You are an airline operations assistant. Answer the staff member's policy question using ONLY the provided source documents. Cite which source you used. If the answer is not in the sources, say so.\n\nSources:\n${policyContext}`,
      },
      { role: 'user', content: query },
    ];

    const llmResponse = await this.llm.chat(messages);

    await this.audit.log(traceId, sessionId, actorId, 'policy_query', {
      query,
      retrievedPolicies: policies.map(p => p.title),
    });

    return {
      text: llmResponse.content || 'I could not find relevant policy information for your question.',
      sources: policies.map(p => p.title),
    };
  }

  async handleBookingStatus(
    sessionId: string,
    actorId: string,
    bookingRef: string,
  ): Promise<OrchestratorResult> {
    const traceId = uuid();
    const booking = await this.store.getBooking(bookingRef);

    if (!booking) {
      return { text: `Booking ${bookingRef} not found.` };
    }

    const customer = await this.store.getCustomer(booking.customerId);

    await this.audit.log(traceId, sessionId, actorId, 'booking_status_query', {
      bookingRef, status: booking.status,
    });

    const departDate = new Date(booking.departAt);
    const formattedDate = departDate.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    const formattedTime = departDate.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    });

    return {
      text: [
        `**Booking ${bookingRef}**`,
        `Status: **${booking.status.toUpperCase()}**`,
        `Passenger: ${customer?.name || 'Unknown'} (${customer?.tier || 'standard'} tier)`,
        `Route: ${booking.origin} → ${booking.destination}`,
        `Departure: ${formattedDate} at ${formattedTime}`,
        `Fare: ${booking.fareClass.replace('_', ' ')} — $${booking.price.toFixed(2)}`,
        `Refundable: ${booking.refundable ? 'Yes' : 'No'}`,
      ].join('\n'),
    };
  }

  async handleEscalation(
    sessionId: string,
    actorId: string,
    reason?: string,
  ): Promise<OrchestratorResult> {
    const traceId = uuid();

    const proposal = await this.hitl.createProposal(
      traceId, sessionId, actorId, 'escalation',
      { reason: reason || 'Staff-requested escalation' },
      `Escalation requested: ${reason || 'No specific reason provided'}`,
    );

    return {
      text: 'I\'ve created an escalation request. Please review and confirm to route this to the supervisor queue.',
      proposal,
    };
  }

  async handleFallback(
    sessionId: string,
    actorId: string,
    query: string,
  ): Promise<OrchestratorResult> {
    const traceId = uuid();

    // Try RAG first — maybe it's a policy question that CX didn't classify
    const policies = await this.retriever.retrieve(query);

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `You are an airline operations assistant. The user's message didn't match a specific action. Try to answer helpfully using the policy sources below if relevant. If you can't answer, suggest what the user can ask about (rebooking, cancellations, policy questions, booking status, or escalation).\n\nSources:\n${this.retriever.formatContext(policies)}`,
      },
      { role: 'user', content: query },
    ];

    const llmResponse = await this.llm.chat(messages);

    await this.audit.log(traceId, sessionId, actorId, 'fallback_query', { query });

    return {
      text: llmResponse.content || 'I can help with rebooking, cancellations, policy questions, booking status, or escalations. What would you like to do?',
    };
  }
}
