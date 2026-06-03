import { Router, Request, Response } from 'express';
import { Orchestrator } from '../orchestrator';
import { WebhookRequest, WebhookResponse } from '../types';

export function createWebhookRouter(orchestrator: Orchestrator): Router {
  const router = Router();

  router.post('/webhook', async (req: Request, res: Response) => {
    const body = req.body as WebhookRequest;
    const tag = body.fulfillmentInfo?.tag;
    const params = body.sessionInfo?.parameters || {};
    const sessionId = body.sessionInfo?.session || 'unknown-session';
    const actorId = 'staff-user'; // In prod: extract from auth token
    const rawText = body.text || '';

    console.log(`[webhook] tag=${tag} session=${sessionId.slice(-12)} params=${JSON.stringify(params)}`);

    let result;

    try {
      switch (tag) {
        case 'rebook.propose':
          result = await orchestrator.handleRebook(
            sessionId,
            actorId,
            params.booking_ref as string,
            params.new_date as string,
            params.new_city as string | undefined,
          );
          break;

        case 'refund.propose':
          result = await orchestrator.handleRefund(
            sessionId,
            actorId,
            params.booking_ref as string,
          );
          break;

        case 'policy.answer':
          result = await orchestrator.handlePolicyQuery(
            sessionId,
            actorId,
            (params.raw_query as string) || rawText,
          );
          break;

        case 'booking.status':
          result = await orchestrator.handleBookingStatus(
            sessionId,
            actorId,
            params.booking_ref as string,
          );
          break;

        case 'escalate.propose':
          result = await orchestrator.handleEscalation(
            sessionId,
            actorId,
            (params.escalation_reason as string) || rawText,
          );
          break;

        case 'fallback.general':
          result = await orchestrator.handleFallback(
            sessionId,
            actorId,
            (params.raw_query as string) || rawText,
          );
          break;

        default:
          result = { text: `Unknown fulfillment tag: ${tag}` };
      }

      const response: WebhookResponse = {
        fulfillmentResponse: {
          messages: [{ text: { text: [result.text] } }],
        },
        sessionInfo: {
          parameters: { returning: true },
        },
      };

      // If there's a proposal, include it in session params for the app to pick up
      if (result.proposal) {
        response.sessionInfo!.parameters!.pending_proposal = {
          id: result.proposal.id,
          type: result.proposal.type,
          summary: result.proposal.summary,
          params: result.proposal.params,
          status: result.proposal.status,
        };
      }

      res.json(response);
    } catch (error) {
      console.error(`[webhook] Error handling tag=${tag}:`, error);
      const errorResponse: WebhookResponse = {
        fulfillmentResponse: {
          messages: [{ text: { text: ['Sorry, something went wrong processing your request. Please try again.'] } }],
        },
      };
      res.json(errorResponse);
    }
  });

  return router;
}
