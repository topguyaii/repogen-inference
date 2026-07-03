import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { WebSocketServer } from 'ws'
import { createServer } from 'http'

import { nodeRegistry } from './registry/nodes'
import { modelRegistry } from './registry/models'
import { healthMonitor } from './health/monitor'
import { paymentsCalculator } from './payments/calculator'
import { protocolHandler } from './protocol/handler'
import { loadBalancer } from './routing/balancer'

// Create Hono app for HTTP API
const app = new Hono()

// CORS
app.use('*', cors())

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  })
})

// Get network status
app.get('/status', (c) => {
  return c.json({
    nodes: nodeRegistry.getStats(),
    models: modelRegistry.getNetworkStats(),
    health: healthMonitor.getStatus(),
    protocol: {
      connectedNodes: protocolHandler.getConnectedCount(),
    },
  })
})

// Get all nodes
app.get('/nodes', (c) => {
  const nodes = nodeRegistry.getAll()
  return c.json({
    nodes: nodes.map((n) => ({
      id: n.id,
      wallet: n.wallet,
      gpu: n.gpu,
      models: n.models,
      status: n.status,
      load: n.load,
      latencyMs: n.latencyMs,
      region: n.region,
      requestsProcessed: n.requestsProcessed,
      tokensGenerated: n.tokensGenerated,
    })),
    total: nodes.length,
  })
})

// Get single node
app.get('/nodes/:id', (c) => {
  const node = nodeRegistry.get(c.req.param('id'))
  if (!node) {
    return c.json({ error: 'Node not found' }, 404)
  }
  return c.json(node)
})

// Get available models
app.get('/models', (c) => {
  const models = modelRegistry.getAll()
  return c.json({
    models: models.map((m) => ({
      id: m.model.id,
      name: m.model.name,
      available: m.available,
      nodeCount: m.nodeCount,
      readyNodes: m.readyNodes,
      avgLatencyMs: m.avgLatencyMs,
    })),
    availableCount: models.filter((m) => m.available).length,
  })
})

// Get model availability
app.get('/models/:id', (c) => {
  const availability = modelRegistry.getAvailability(c.req.param('id'))
  return c.json(availability)
})

// Get protocol stats
app.get('/stats/protocol', (c) => {
  return c.json(paymentsCalculator.getProtocolStats())
})

// Get earnings for a wallet
app.get('/earnings/:wallet', (c) => {
  const summary = paymentsCalculator.getEarningsSummary(c.req.param('wallet'))
  return c.json(summary)
})

// Get pending payouts
app.get('/payouts/pending', (c) => {
  return c.json({
    payouts: paymentsCalculator.getPendingPayouts(),
  })
})

// Internal: Submit inference request (called by API server)
app.post('/internal/inference', async (c) => {
  try {
    const body = await c.req.json()
    const { model, messages, temperature, maxTokens, stream, regionPreference } = body

    // Check model availability
    if (!modelRegistry.isAvailable(model)) {
      return c.json({ error: `Model not available: ${model}` }, 503)
    }

    // Submit request to load balancer
    const response = await loadBalancer.submitRequest(model, messages, {
      temperature,
      maxTokens,
      stream,
      regionPreference,
    })

    return c.json(response)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ error: message }, 500)
  }
})

// Start server
const PORT = parseInt(process.env.COORDINATOR_PORT || '3002')
const WS_PORT = parseInt(process.env.COORDINATOR_WS_PORT || '3003')

// Create HTTP server for WebSocket
const wsHttpServer = createServer()
const wss = new WebSocketServer({ server: wsHttpServer })

wss.on('connection', (ws) => {
  protocolHandler.handleConnection(ws)
})

// Start health monitor
healthMonitor.start()

// Start HTTP API server
serve({
  fetch: app.fetch,
  port: PORT,
})

console.log(`[Coordinator] HTTP API running on port ${PORT}`)

// Start WebSocket server
wsHttpServer.listen(WS_PORT, () => {
  console.log(`[Coordinator] WebSocket server running on port ${WS_PORT}`)
})

console.log('[Coordinator] Ready to accept node connections')

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Coordinator] Shutting down...')
  healthMonitor.stop()
  wss.close()
  process.exit(0)
})

export { app }
