import type { Node } from '../types'
import { nodeRegistry } from '../registry/nodes'

export type SelectionStrategy = 'lowest_load' | 'lowest_latency' | 'round_robin'

/**
 * Node Selector - Chooses the best node for a request
 */
export class NodeSelector {
  private roundRobinIndex: Map<string, number> = new Map()

  /**
   * Select the best node for a model
   */
  select(model: string, strategy: SelectionStrategy = 'lowest_load'): Node | null {
    const readyNodes = nodeRegistry.getReadyNodes(model)

    if (readyNodes.length === 0) {
      return null
    }

    switch (strategy) {
      case 'lowest_load':
        return this.selectLowestLoad(readyNodes)
      case 'lowest_latency':
        return this.selectLowestLatency(readyNodes)
      case 'round_robin':
        return this.selectRoundRobin(model, readyNodes)
      default:
        return this.selectLowestLoad(readyNodes)
    }
  }

  /**
   * Select node with lowest current load
   */
  private selectLowestLoad(nodes: Node[]): Node {
    return nodes.reduce((best, node) => (node.load < best.load ? node : best), nodes[0])
  }

  /**
   * Select node with lowest latency
   */
  private selectLowestLatency(nodes: Node[]): Node {
    return nodes.reduce((best, node) => (node.latencyMs < best.latencyMs ? node : best), nodes[0])
  }

  /**
   * Round-robin selection across nodes
   */
  private selectRoundRobin(model: string, nodes: Node[]): Node {
    const currentIndex = this.roundRobinIndex.get(model) || 0
    const nextIndex = (currentIndex + 1) % nodes.length
    this.roundRobinIndex.set(model, nextIndex)
    return nodes[currentIndex]
  }

  /**
   * Select with composite scoring
   * Balances load and latency with configurable weights
   */
  selectOptimal(
    model: string,
    options: {
      loadWeight?: number
      latencyWeight?: number
      regionPreference?: string
    } = {}
  ): Node | null {
    const { loadWeight = 0.6, latencyWeight = 0.4, regionPreference } = options

    const readyNodes = nodeRegistry.getReadyNodes(model)
    if (readyNodes.length === 0) return null

    // Normalize metrics
    const maxLatency = Math.max(...readyNodes.map((n) => n.latencyMs), 1)

    // Score each node (lower is better)
    const scored = readyNodes.map((node) => {
      let score = node.load * loadWeight + (node.latencyMs / maxLatency) * latencyWeight

      // Boost score for preferred region
      if (regionPreference && node.region === regionPreference) {
        score *= 0.8 // 20% boost for preferred region
      }

      return { node, score }
    })

    // Sort by score ascending (lower is better)
    scored.sort((a, b) => a.score - b.score)

    return scored[0].node
  }
}

// Singleton instance
export const nodeSelector = new NodeSelector()
