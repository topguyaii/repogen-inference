import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { WebSocketServer } from 'ws'
import { createServer, IncomingMessage } from 'http'
import { Duplex } from 'stream'

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

// Use PORT from environment (Render sets this)
const PORT = parseInt(process.env.PORT || process.env.COORDINATOR_PORT || '3002')

// Create HTTP server that handles both HTTP and WebSocket
const server = createServer(async (req, res) => {
  // Convert Node request/response to fetch API format for Hono
  const url = new URL(req.url || '/', `http://${req.headers.host}`)

  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) {
      headers.set(key, Array.isArray(value) ? value.join(', ') : value)
    }
  }

  // Read body for POST requests
  let body: string | undefined
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    body = await new Promise<string>((resolve) => {
      let data = ''
      req.on('data', (chunk) => (data += chunk))
      req.on('end', () => resolve(data))
    })
  }

  const request = new Request(url.toString(), {
    method: req.method,
    headers,
    body: body,
  })

  const response = await app.fetch(request)

  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })

  const responseBody = await response.text()
  res.end(responseBody)
})

// Create WebSocket server attached to the same HTTP server
const wss = new WebSocketServer({ noServer: true })

wss.on('connection', (ws) => {
  protocolHandler.handleConnection(ws)
})

// Ping all connected clients every 25 seconds to keep connections alive
// (Render/Cloudflare typically timeout idle connections at 60s)
const PING_INTERVAL = 25000
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.readyState === ws.OPEN) {
      ws.ping()
    }
  })
}, PING_INTERVAL)

// Handle WebSocket upgrade requests
server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
  const pathname = new URL(request.url || '/', `http://${request.headers.host}`).pathname

  // Only upgrade /ws path to WebSocket
  if (pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request)
    })
  } else {
    socket.destroy()
  }
})

// Start health monitor
healthMonitor.start()

// Start the combined server
server.listen(PORT, () => {
  console.log(`[Coordinator] Server running on port ${PORT}`)
  console.log(`[Coordinator] HTTP API: http://localhost:${PORT}`)
  console.log(`[Coordinator] WebSocket: ws://localhost:${PORT}/ws`)
  console.log('[Coordinator] Ready to accept node connections')
})

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Coordinator] Shutting down...')
  healthMonitor.stop()
  wss.close()
  server.close()
  process.exit(0)
})

export { app }
