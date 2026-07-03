import { nodeRegistry } from './nodes'
import { MODELS, type ModelDefinition } from '../models'

/**
 * Model availability info
 */
export interface ModelAvailability {
  model: ModelDefinition
  nodeCount: number
  readyNodes: number
  totalCapacity: number // Estimated requests per minute
  avgLatencyMs: number
  available: boolean
}

/**
 * Model Registry - Tracks model availability across the network
 */
export class ModelRegistry {
  /**
   * Get all models with their network availability
   */
  getAll(): ModelAvailability[] {
    return Object.values(MODELS).map((model) => this.getAvailability(model.id))
  }

  /**
   * Get availability for a specific model
   */
  getAvailability(modelId: string): ModelAvailability {
    const model = MODELS[modelId]
    if (!model) {
      return {
        model: {
          id: modelId,
          name: modelId,
          providers: [],
          context_length: 0,
          input_price_per_m: 0,
          output_price_per_m: 0,
          supports_streaming: false,
          supports_tools: false,
          privacy_tiers: [],
          is_open: false,
        },
        nodeCount: 0,
        readyNodes: 0,
        totalCapacity: 0,
        avgLatencyMs: 0,
        available: false,
      }
    }

    const nodes = nodeRegistry.getByModel(modelId)
    const readyNodes = nodes.filter((n) => n.status === 'ready')

    // Calculate average latency from ready nodes
    const avgLatencyMs =
      readyNodes.length > 0
        ? readyNodes.reduce((sum, n) => sum + n.latencyMs, 0) / readyNodes.length
        : 0

    // Estimate capacity based on ready nodes and their load
    const totalCapacity = readyNodes.reduce((sum, n) => {
      // Assume each node can handle ~10 requests/min at full capacity
      // Adjust based on current load
      const availableCapacity = 10 * (1 - n.load)
      return sum + availableCapacity
    }, 0)

    return {
      model,
      nodeCount: nodes.length,
      readyNodes: readyNodes.length,
      totalCapacity: Math.round(totalCapacity),
      avgLatencyMs: Math.round(avgLatencyMs),
      available: readyNodes.length > 0,
    }
  }

  /**
   * Check if a model is available on the network
   */
  isAvailable(modelId: string): boolean {
    const readyNodes = nodeRegistry.getReadyNodes(modelId)
    return readyNodes.length > 0
  }

  /**
   * Get all available models (at least one ready node)
   */
  getAvailableModels(): ModelAvailability[] {
    return this.getAll().filter((m) => m.available)
  }

  /**
   * Get network-wide stats
   */
  getNetworkStats(): {
    totalModels: number
    availableModels: number
    totalNodes: number
    readyNodes: number
    totalCapacity: number
  } {
    const all = this.getAll()
    const registryStats = nodeRegistry.getStats()

    return {
      totalModels: all.length,
      availableModels: all.filter((m) => m.available).length,
      totalNodes: registryStats.total,
      readyNodes: registryStats.ready,
      totalCapacity: all.reduce((sum, m) => sum + m.totalCapacity, 0),
    }
  }
}

// Singleton instance
export const modelRegistry = new ModelRegistry()
