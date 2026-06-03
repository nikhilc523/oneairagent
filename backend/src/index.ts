import express from 'express';
import cors from 'cors';
import { config } from './config';
import { MockDataStore } from './data/mockDb';
import { MockLLMProvider } from './llm/mock';
import { AuditLogger } from './audit';
import { HITLGate } from './hitl';
import { Orchestrator } from './orchestrator';
import { createWebhookRouter } from './dialogflow/webhook';

async function main() {
  // ── Initialize services ──
  const store = new MockDataStore();
  const llm = new MockLLMProvider();
  const audit = new AuditLogger(store);
  const hitl = new HITLGate(store, audit);
  const orchestrator = new Orchestrator(store, llm, hitl, audit);

  // ── Express app ──
  const app = express();
  app.use(cors());
  app.use(express.json());

  // ── Health check ──
  app.get('/', (_req, res) => {
    res.json({
      service: 'oneair-agent-backend',
      status: 'ok',
      version: '1.0.0',
      mode: config.useMockLlm ? 'mock' : 'live',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy' });
  });

  // ── Dialogflow CX webhook ──
  app.use('/dialogflow', createWebhookRouter(orchestrator));

  // ── Direct API routes (for testing without CX) ──

  // Booking status (read-only)
  app.get('/api/bookings/:ref', async (req, res) => {
    const result = await orchestrator.handleBookingStatus(
      'api-session', 'api-user', req.params.ref,
    );
    res.json({ text: result.text });
  });

  // Policy query
  app.post('/api/policy', async (req, res) => {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'query is required' });
    const result = await orchestrator.handlePolicyQuery(
      'api-session', 'api-user', query,
    );
    res.json({ text: result.text, sources: result.sources });
  });

  // Rebook proposal
  app.post('/api/rebook', async (req, res) => {
    const { booking_ref, new_date, new_city } = req.body;
    if (!booking_ref || !new_date) {
      return res.status(400).json({ error: 'booking_ref and new_date are required' });
    }
    const result = await orchestrator.handleRebook(
      'api-session', 'api-user', booking_ref, new_date, new_city,
    );
    res.json({ text: result.text, proposal: result.proposal });
  });

  // Refund proposal
  app.post('/api/refund', async (req, res) => {
    const { booking_ref } = req.body;
    if (!booking_ref) return res.status(400).json({ error: 'booking_ref is required' });
    const result = await orchestrator.handleRefund(
      'api-session', 'api-user', booking_ref,
    );
    res.json({ text: result.text, proposal: result.proposal });
  });

  // Escalation proposal
  app.post('/api/escalate', async (req, res) => {
    const { reason } = req.body;
    const result = await orchestrator.handleEscalation(
      'api-session', 'api-user', reason,
    );
    res.json({ text: result.text, proposal: result.proposal });
  });

  // HITL: Confirm a proposal
  app.post('/api/proposals/:id/confirm', async (req, res) => {
    const result = await hitl.confirm(req.params.id, 'api-user');
    if (!result) return res.status(404).json({ error: 'Proposal not found or not pending' });
    res.json(result);
  });

  // HITL: Reject a proposal
  app.post('/api/proposals/:id/reject', async (req, res) => {
    const result = await hitl.reject(req.params.id, 'api-user');
    if (!result) return res.status(404).json({ error: 'Proposal not found or not pending' });
    res.json(result);
  });

  // Fallback
  app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });
    const result = await orchestrator.handleFallback(
      'api-session', 'api-user', message,
    );
    res.json({ text: result.text });
  });

  // ── Start server ──
  app.listen(config.port, () => {
    console.log(`\n🛫 OneAir Agent Backend running on port ${config.port}`);
    console.log(`   Mode: ${config.useMockLlm ? 'MOCK' : 'LIVE'}`);
    console.log(`   Webhook: http://localhost:${config.port}/dialogflow/webhook`);
    console.log(`   Health:  http://localhost:${config.port}/health`);
    console.log(`   API:     http://localhost:${config.port}/api/bookings/ON-204881\n`);
  });
}

main().catch(console.error);
