import { nodeRegistry } from '../registry/nodes'
import { loadBalancer } from '../routing/balancer'

/**
 * Health Monitor - Monitors node health and handles failures
 */
export class HealthMonitor {
  private intervalId: NodeJS.Timeout | null = null
  private checkIntervalMs: number = 10000 // Check every 10 seconds
  private staleThresholdMs: number = 30000 // Node is stale after 30 seconds without heartbeat

  /**
   * Start the health monitor
   */
  start(): void {
    if (this.intervalId) return

    this.intervalId = setInterval(() => {
      this.checkNodes()
    }, this.checkIntervalMs)

    console.log('[HealthMonitor] Started')
  }

  /**
   * Stop the health monitor
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
      console.log('[HealthMonitor] Stopped')
    }
  }

  /**
   * Check all nodes for staleness
   */
  private checkNodes(): void {
    const staleNodes = nodeRegistry.checkStaleNodes(this.staleThresholdMs)

    for (const node of staleNodes) {
      console.log(`[HealthMonitor] Node ${node.id} (${node.wallet}) marked offline - no heartbeat`)

      // Fail any pending requests for this node
      loadBalancer.handleNodeDisconnect(node.id)
    }

    if (staleNodes.length > 0) {
      const stats = nodeRegistry.getStats()
      console.log(
        `[HealthMonitor] ${staleNodes.length} nodes went offline. ` +
          `Network: ${stats.online}/${stats.total} online, ${stats.ready} ready`
      )
    }
  }

  /**
   * Get health status
   */
  getStatus(): {
    running: boolean
    checkIntervalMs: number
    staleThresholdMs: number
    nodeStats: ReturnType<typeof nodeRegistry.getStats>
    balancerStats: ReturnType<typeof loadBalancer.getStats>
  } {
    return {
      running: this.intervalId !== null,
      checkIntervalMs: this.checkIntervalMs,
      staleThresholdMs: this.staleThresholdMs,
      nodeStats: nodeRegistry.getStats(),
      balancerStats: loadBalancer.getStats(),
    }
  }

  /**
   * Configure monitor settings
   */
  configure(options: { checkIntervalMs?: number; staleThresholdMs?: number }): void {
    if (options.checkIntervalMs) {
      this.checkIntervalMs = options.checkIntervalMs
    }
    if (options.staleThresholdMs) {
      this.staleThresholdMs = options.staleThresholdMs
    }

    // Restart if running
    if (this.intervalId) {
      this.stop()
      this.start()
    }
  }
}

// Singleton instance
export const healthMonitor = new HealthMonitor()
