import type { Node, NodeStatus, GpuSpec } from '../types'
import { randomUUID } from 'crypto'

/**
 * Node Registry - Manages all connected GPU nodes
 */
export class NodeRegistry {
  private nodes: Map<string, Node> = new Map()
  private walletToNodeId: Map<string, string> = new Map()

  /**
   * Register a new node
   */
  register(wallet: string, gpu: GpuSpec, models: string[], region?: string): Node {
    // Check if wallet already has a node
    const existingNodeId = this.walletToNodeId.get(wallet)
    if (existingNodeId) {
      // Update existing node
      const existingNode = this.nodes.get(existingNodeId)
      if (existingNode) {
        existingNode.gpu = gpu
        existingNode.models = models
        existingNode.status = 'ready'
        existingNode.connectedAt = new Date()
        existingNode.lastHeartbeat = new Date()
        if (region) existingNode.region = region
        return existingNode
      }
    }

    // Create new node
    const node: Node = {
      id: randomUUID(),
      wallet,
      gpu,
      models,
      status: 'ready',
      load: 0,
      latencyMs: 0,
      region: region || 'unknown',
      connectedAt: new Date(),
      lastHeartbeat: new Date(),
      requestsProcessed: 0,
      tokensGenerated: 0,
    }

    this.nodes.set(node.id, node)
    this.walletToNodeId.set(wallet, node.id)

    return node
  }

  /**
   * Update node heartbeat
   */
  heartbeat(nodeId: string, status: NodeStatus, load: number, latencyMs: number): boolean {
    const node = this.nodes.get(nodeId)
    if (!node) return false

    node.status = status
    node.load = load
    node.latencyMs = latencyMs
    node.lastHeartbeat = new Date()

    return true
  }

  /**
   * Mark node as offline
   */
  disconnect(nodeId: string): boolean {
    const node = this.nodes.get(nodeId)
    if (!node) return false

    node.status = 'offline'
    return true
  }

  /**
   * Remove node from registry
   */
  remove(nodeId: string): boolean {
    const node = this.nodes.get(nodeId)
    if (!node) return false

    this.walletToNodeId.delete(node.wallet)
    this.nodes.delete(nodeId)
    return true
  }

  /**
   * Get node by ID
   */
  get(nodeId: string): Node | undefined {
    return this.nodes.get(nodeId)
  }

  /**
   * Get node by wallet address
   */
  getByWallet(wallet: string): Node | undefined {
    const nodeId = this.walletToNodeId.get(wallet)
    if (!nodeId) return undefined
    return this.nodes.get(nodeId)
  }

  /**
   * Get all nodes
   */
  getAll(): Node[] {
    return Array.from(this.nodes.values())
  }

  /**
   * Get nodes that support a specific model
   */
  getByModel(model: string): Node[] {
    return this.getAll().filter((node) => node.models.includes(model))
  }

  /**
   * Get ready nodes for a model
   */
  getReadyNodes(model: string): Node[] {
    return this.getByModel(model).filter((node) => node.status === 'ready')
  }

  /**
   * Get online node count
   */
  getOnlineCount(): number {
    return this.getAll().filter((n) => n.status !== 'offline').length
  }

  /**
   * Get total nodes
   */
  getTotalCount(): number {
    return this.nodes.size
  }

  /**
   * Update node stats after processing request
   */
  recordRequest(nodeId: string, tokensGenerated: number): void {
    const node = this.nodes.get(nodeId)
    if (node) {
      node.requestsProcessed++
      node.tokensGenerated += tokensGenerated
    }
  }

  /**
   * Check for stale nodes (no heartbeat in 30 seconds)
   */
  checkStaleNodes(maxAgeMs: number = 30000): Node[] {
    const now = Date.now()
    const staleNodes: Node[] = []

    for (const node of this.nodes.values()) {
      if (node.status !== 'offline') {
        const age = now - node.lastHeartbeat.getTime()
        if (age > maxAgeMs) {
          node.status = 'offline'
          staleNodes.push(node)
        }
      }
    }

    return staleNodes
  }

  /**
   * Get registry stats
   */
  getStats(): {
    total: number
    online: number
    ready: number
    busy: number
    offline: number
    totalRequests: number
    totalTokens: number
  } {
    const nodes = this.getAll()
    return {
      total: nodes.length,
      online: nodes.filter((n) => n.status !== 'offline').length,
      ready: nodes.filter((n) => n.status === 'ready').length,
      busy: nodes.filter((n) => n.status === 'busy').length,
      offline: nodes.filter((n) => n.status === 'offline').length,
      totalRequests: nodes.reduce((sum, n) => sum + n.requestsProcessed, 0),
      totalTokens: nodes.reduce((sum, n) => sum + n.tokensGenerated, 0),
    }
  }
}

// Singleton instance
export const nodeRegistry = new NodeRegistry()
