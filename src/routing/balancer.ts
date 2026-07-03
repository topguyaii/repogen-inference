import type { PendingRequest, InferenceResponse, InferenceChunk, InferenceRequest } from '../types'
import { nodeSelector } from './selector'
import { nodeRegistry } from '../registry/nodes'
import { randomUUID } from 'crypto'

// Lazy import to avoid circular dependency
function getProtocolHandler(): typeof import('../protocol/handler').protocolHandler {
  return require('../protocol/handler').protocolHandler
}

/**
 * Load Balancer - Manages request queue and distribution
 */
export class LoadBalancer {
  private pendingRequests: Map<string, PendingRequest> = new Map()
  private requestTimeout: number = 60000 // 60 seconds

  /**
   * Submit an inference request to the network
   */
  async submitRequest(
    model: string,
    messages: { role: string; content: string }[],
    options: {
      temperature?: number
      maxTokens?: number
      stream?: boolean
      onChunk?: (chunk: InferenceChunk) => void
      regionPreference?: string
    } = {}
  ): Promise<InferenceResponse> {
    const { temperature, maxTokens, stream = false, onChunk, regionPreference } = options

    // Select optimal node
    const node = nodeSelector.selectOptimal(model, { regionPreference })

    if (!node) {
      throw new Error(`No nodes available for model: ${model}`)
    }

    // Create request
    const requestId = randomUUID()

    return new Promise((resolve, reject) => {
      const pendingRequest: PendingRequest = {
        id: requestId,
        model,
        messages,
        temperature,
        maxTokens,
        stream,
        nodeId: node.id,
        createdAt: new Date(),
        resolve,
        reject,
        onChunk,
      }

      this.pendingRequests.set(requestId, pendingRequest)

      // Build the inference request to send to provider
      const inferenceRequest: InferenceRequest = {
        type: 'inference_request',
        requestId,
        model,
        messages: messages as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
        temperature,
        maxTokens,
        stream,
      }

      // Send the request to the provider via WebSocket
      const sent = getProtocolHandler().sendInferenceRequest(node.id, inferenceRequest)
      if (!sent) {
        this.pendingRequests.delete(requestId)
        reject(new Error('Failed to send request to provider'))
        return
      }

      console.log(`[LoadBalancer] Request ${requestId} sent to node ${node.id}`)

      // Set timeout
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId)
          reject(new Error('Request timeout'))
        }
      }, this.requestTimeout)
    })
  }

  /**
   * Handle response from node
   */
  handleResponse(response: InferenceResponse): boolean {
    const request = this.pendingRequests.get(response.requestId)
    if (!request) return false

    // Update node stats
    if (request.nodeId) {
      nodeRegistry.recordRequest(request.nodeId, response.completionTokens)
    }

    // Resolve the promise
    request.resolve(response)
    this.pendingRequests.delete(response.requestId)

    return true
  }

  /**
   * Handle streaming chunk from node
   */
  handleChunk(chunk: InferenceChunk): boolean {
    const request = this.pendingRequests.get(chunk.requestId)
    if (!request) return false

    // Call chunk handler if provided
    if (request.onChunk) {
      request.onChunk(chunk)
    }

    // If this is the final chunk, we'll wait for the full response
    return true
  }

  /**
   * Handle error from node
   */
  handleError(requestId: string, error: Error): boolean {
    const request = this.pendingRequests.get(requestId)
    if (!request) return false

    request.reject(error)
    this.pendingRequests.delete(requestId)

    return true
  }

  /**
   * Get pending request by ID
   */
  getPendingRequest(requestId: string): PendingRequest | undefined {
    return this.pendingRequests.get(requestId)
  }

  /**
   * Get all pending requests for a node
   */
  getPendingRequestsForNode(nodeId: string): PendingRequest[] {
    return Array.from(this.pendingRequests.values()).filter((r) => r.nodeId === nodeId)
  }

  /**
   * Handle node disconnection - fail all pending requests
   */
  handleNodeDisconnect(nodeId: string): void {
    const requests = this.getPendingRequestsForNode(nodeId)
    for (const request of requests) {
      request.reject(new Error('Node disconnected'))
      this.pendingRequests.delete(request.id)
    }
  }

  /**
   * Get stats
   */
  getStats(): {
    pendingRequests: number
    oldestRequestAge: number | null
  } {
    const requests = Array.from(this.pendingRequests.values())
    const now = Date.now()

    return {
      pendingRequests: requests.length,
      oldestRequestAge:
        requests.length > 0
          ? Math.max(...requests.map((r) => now - r.createdAt.getTime()))
          : null,
    }
  }
}

// Singleton instance
export const loadBalancer = new LoadBalancer()
