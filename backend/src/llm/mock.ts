import { LLMProvider, ToolDefinition } from './provider';
import { LLMMessage, LLMResponse } from '../types';

export class MockLLMProvider implements LLMProvider {
  async chat(messages: LLMMessage[], _tools?: ToolDefinition[]): Promise<LLMResponse> {
    // Check all messages for context (system prompt contains the policy/booking data)
    const allContent = messages.map(m => m.content).join(' ').toLowerCase();

    // Detect if this is a rebook context
    if (allContent.includes('propose a rebooking') || allContent.includes('propose_rebook')) {
      return {
        content: '',
        toolCalls: [{
          name: 'propose_rebook',
          arguments: {
            summary: 'Rebooking proposed based on the provided parameters. The passenger will be moved to the requested date. Any fare difference will be calculated at confirmation.',
          },
        }],
      };
    }

    // Detect refund context
    if (allContent.includes('propose a refund') || allContent.includes('process refund')) {
      return {
        content: '',
        toolCalls: [{
          name: 'propose_refund',
          arguments: {
            summary: 'Refund eligibility assessed based on fare class and cancellation timing. See the proposal details for the exact refund amount and any applicable fees.',
          },
        }],
      };
    }

    // Detect escalation context
    if (allContent.includes('escalat')) {
      return {
        content: '',
        toolCalls: [{
          name: 'propose_escalation',
          arguments: {
            summary: 'This case has been flagged for escalation to a supervisor or specialist team.',
          },
        }],
      };
    }

    // Policy / general question — extract the source text from the system prompt and echo it
    if (allContent.includes('policy') || allContent.includes('source')) {
      // Find the system message which contains the retrieved policy text
      const systemMsg = messages.find(m => m.role === 'system');
      const sourceMatch = systemMsg?.content.match(/\[Source \d+: (.+?)\]/g);
      const sources = sourceMatch ? sourceMatch.join(', ') : 'policy documents';

      return {
        content: `Based on the retrieved policy documents (${sources}), here is the relevant information from our records. Please refer to the source documents for complete details.`,
        toolCalls: undefined,
      };
    }

    // Default: return a helpful general response
    return {
      content: 'I can help you with rebooking, cancellations and refunds, policy questions, booking status lookups, or escalations. What would you like to do?',
      toolCalls: undefined,
    };
  }
}
