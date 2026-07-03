import { WebSocket } from 'ws'
import {
  NodeMessage,
  RegisterMessage,
  HeartbeatMessage,
  InferenceResponse,
  InferenceChunk,
  InferenceRequest,
  AckMessage,
  ErrorMessage,
} from '../types'
import { nodeRegistry } from '../registry/nodes'
import { loadBalancer } from '../routing/balancer'
import { paymentsCalculator } from '../payments/calculator'
import {
  registerProvider,
  updateProviderStatus,
  updateProviderHeartbeat,
  recordProviderRequest,
  startProviderSession,
  endProviderSession,
} from '../db/providers'

/**
 * Connected node with WebSocket
 */
interface ConnectedNode {
  nodeId: string
  ws: WebSocket
  wallet: string
  providerId?: string // Database provider ID
  sessionId?: string // Current session ID
  requestsServed: number
  tokensGenerated: number
  earningsMicros: number
}

/**
 * Protocol Handler - Manages WebSocket communication with nodes
 */
export class ProtocolHandler {
  private connections: Map<string, ConnectedNode> = new Map() // nodeId -> connection
  private wsToNodeId: Map<WebSocket, string> = new Map()

  /**
   * Handle new WebSocket connection
   */
  handleConnection(ws: WebSocket): void {
    console.log('[Protocol] New connection')

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString())
        this.handleMessage(ws, message)
      } catch (error) {
        console.error('[Protocol] Invalid message:', error)
        this.sendError(ws, undefined, 'INVALID_MESSAGE', 'Invalid JSON message')
      }
    })

    ws.on('close', () => {
      this.handleDisconnect(ws)
    })

    ws.on('error', (error) => {
      console.error('[Protocol] WebSocket error:', error)
      this.handleDisconnect(ws)
    })
  }

  /**
   * Handle incoming message from node
   */
  private async handleMessage(ws: WebSocket, rawMessage: unknown): Promise<void> {
    const result = NodeMessage.safeParse(rawMessage)

    if (!result.success) {
      console.error('[Protocol] Invalid message format:', result.error)
      this.sendError(ws, undefined, 'INVALID_FORMAT', 'Invalid message format')
      return
    }

    const message = result.data

    switch (message.type) {
      case 'register':
        await this.handleRegister(ws, message)
        break
      case 'heartbeat':
        await this.handleHeartbeat(ws, message)
        break
      case 'inference_response':
        await this.handleInferenceResponse(message)
        break
      case 'inference_chunk':
        this.handleInferenceChunk(message)
        break
      case 'error':
        this.handleNodeError(message)
        break
    }
  }

  /**
   * Handle node registration
   */
  private async handleRegister(ws: WebSocket, message: RegisterMessage): Promise<void> {
    const node = nodeRegistry.register(message.wallet, message.gpu, message.models, message.region)

    // Persist to database if Apple Silicon info provided
    let providerId: string | undefined
    let sessionId: string | undefined
    let authToken: string | undefined

    if (message.appleSilicon) {
      const result = await registerProvider(
        message.wallet,
        message.appleSilicon.chip,
        message.appleSilicon.memoryGb,
        message.appleSilicon.osVersion,
        message.models
      )

      if (result) {
        providerId = result.provider.id
        authToken = result.authToken

        // Check if provider is approved
        if (!result.provider.is_approved) {
          console.log(`[Protocol] Provider ${providerId} pending approval`)
        }

        // Start session
        sessionId = await startProviderSession(providerId) || undefined
      }
    }

    // Store connection
    this.connections.set(node.id, {
      nodeId: node.id,
      ws,
      wallet: message.wallet,
      providerId,
      sessionId,
      requestsServed: 0,
      tokensGenerated: 0,
      earningsMicros: 0,
    })
    this.wsToNodeId.set(ws, node.id)

    // Send acknowledgment with auth token (for reconnection)
    const ack: AckMessage & { authToken?: string; providerId?: string } = {
      type: 'ack',
      nodeId: node.id,
      authToken,
      providerId,
    }
    ws.send(JSON.stringify(ack))

    const chipInfo = message.appleSilicon
      ? `${message.appleSilicon.chip} ${message.appleSilicon.memoryGb}GB`
      : message.gpu.name

    console.log(
      `[Protocol] Node registered: ${node.id} (${message.wallet}) - ` +
        `Hardware: ${chipInfo}, Models: ${message.models.join(', ')}`
    )
  }

  /**
   * Handle heartbeat from node
   */
  private async handleHeartbeat(ws: WebSocket, message: HeartbeatMessage): Promise<void> {
    const nodeId = this.wsToNodeId.get(ws)
    if (!nodeId) {
      this.sendError(ws, undefined, 'NOT_REGISTERED', 'Node not registered')
      return
    }

    const success = nodeRegistry.heartbeat(nodeId, message.status, message.load, message.latencyMs)

    if (!success) {
      this.sendError(ws, undefined, 'NODE_NOT_FOUND', 'Node not found in registry')
      return
    }

    // Update database heartbeat
    const connection = this.connections.get(nodeId)
    if (connection?.providerId) {
      await updateProviderHeartbeat(connection.providerId)
    }
  }

  /**
   * Handle inference response from node
   */
  private async handleInferenceResponse(response: InferenceResponse): Promise<void> {
    const request = loadBalancer.getPendingRequest(response.requestId)
    if (!request || !request.nodeId) {
      console.warn(`[Protocol] Response for unknown request: ${response.requestId}`)
      return
    }

    // Record earnings
    const earnings = paymentsCalculator.recordEarnings(
      response.requestId,
      request.nodeId,
      request.model,
      response.promptTokens,
      response.completionTokens
    )

    // Record to database
    const connection = this.connections.get(request.nodeId)
    if (connection?.providerId) {
      const latencyMs = Date.now() - request.createdAt.getTime()

      await recordProviderRequest(
        connection.providerId,
        request.model,
        response.promptTokens,
        response.completionTokens,
        latencyMs,
        earnings?.providerEarningsMicros || 0
      )

      // Update connection stats
      connection.requestsServed++
      connection.tokensGenerated += response.completionTokens
      connection.earningsMicros += earnings?.providerEarningsMicros || 0
    }

    // Complete the request
    loadBalancer.handleResponse(response)

    console.log(
      `[Protocol] Request ${response.requestId} completed - ` +
        `${response.promptTokens + response.completionTokens} tokens`
    )
  }

  /**
   * Handle streaming chunk from node
   */
  private handleInferenceChunk(chunk: InferenceChunk): void {
    loadBalancer.handleChunk(chunk)
  }

  /**
   * Handle error from node
   */
  private handleNodeError(error: ErrorMessage): void {
    if (error.requestId) {
      loadBalancer.handleError(error.requestId, new Error(error.message))
    }
    console.error(`[Protocol] Node error: ${error.code} - ${error.message}`)
  }

  /**
   * Handle node disconnection
   */
  private async handleDisconnect(ws: WebSocket): Promise<void> {
    const nodeId = this.wsToNodeId.get(ws)
    if (!nodeId) return

    const connection = this.connections.get(nodeId)
    if (connection) {
      console.log(`[Protocol] Node disconnected: ${nodeId} (${connection.wallet})`)

      // Update database
      if (connection.providerId) {
        await updateProviderStatus(connection.providerId, 'offline')

        // End session with stats
        if (connection.sessionId) {
          await endProviderSession(
            connection.sessionId,
            connection.requestsServed,
            connection.tokensGenerated,
            connection.earningsMicros
          )
        }
      }
    }

    // Mark node offline
    nodeRegistry.disconnect(nodeId)

    // Fail pending requests
    loadBalancer.handleNodeDisconnect(nodeId)

    // Clean up
    this.connections.delete(nodeId)
    this.wsToNodeId.delete(ws)
  }

  /**
   * Send inference request to a node
   */
  sendInferenceRequest(nodeId: string, request: InferenceRequest): boolean {
    const connection = this.connections.get(nodeId)
    if (!connection) {
      console.error(`[Protocol] Cannot send to node ${nodeId}: not connected`)
      return false
    }

    try {
      connection.ws.send(JSON.stringify(request))
      return true
    } catch (error) {
      console.error(`[Protocol] Failed to send to node ${nodeId}:`, error)
      return false
    }
  }

  /**
   * Send error to a WebSocket
   */
  private sendError(ws: WebSocket, requestId: string | undefined, code: string, message: string): void {
    const error: ErrorMessage = {
      type: 'error',
      requestId,
      code,
      message,
    }
    ws.send(JSON.stringify(error))
  }

  /**
   * Get connected node count
   */
  getConnectedCount(): number {
    return this.connections.size
  }

  /**
   * Get all connected node IDs
   */
  getConnectedNodeIds(): string[] {
    return Array.from(this.connections.keys())
  }
}

// Singleton instance
export const protocolHandler = new ProtocolHandler()
