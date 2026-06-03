import { Router, Request, Response } from 'express';
import { Orchestrator } from '../orchestrator';
import { WebhookRequest, WebhookResponse } from '../types';

export function createWebhookRouter(orchestrator: Orchestrator): Router {
  const router = Router();

  router.post('/webhook', async (req: Request, res: Response) => {
    const body = req.body as WebhookRequest;
    // Dialogflow CX webhook request can have the tag in fulfillmentInfo.tag
    const rawBody = req.body;
    const tag = (
      rawBody.fulfillmentInfo?.tag ||
      rawBody.FulfillmentInfo?.tag ||
      ''
    ).trim();
    const params = rawBody.sessionInfo?.parameters || rawBody.SessionInfo?.parameters || {};
    const sessionId = rawBody.sessionInfo?.session || rawBody.SessionInfo?.session || 'unknown-session';
    const actorId = 'staff-user';
    const rawText = rawBody.text || rawBody.Text || '';

    // Debug logging — check Render logs to see what CX actually sends
    console.log(`[webhook] FULL BODY: ${JSON.stringify(rawBody).slice(0, 500)}`);
    console.log(`[webhook] tag="${tag}" params=${JSON.stringify(params)}`);

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
