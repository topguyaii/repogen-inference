import { MODELS } from '../models'
import { nodeRegistry } from '../registry/nodes'

// Revenue distribution (V1: 85% provider, 15% platform)
const CONTRIBUTOR_SHARE = 0.85 // 85% to provider
const PROTOCOL_SHARE = 0.15 // 15% to repogen
const RESERVE_SHARE = 0 // No reserve for V1

/**
 * Earnings entry for a contributor
 */
export interface EarningsEntry {
  requestId: string
  nodeId: string
  wallet: string
  model: string
  promptTokens: number
  completionTokens: number
  totalCostUsd: number
  contributorEarningsUsd: number
  protocolFeeUsd: number
  reserveFeeUsd: number
  // Microdollars for database (1 USD = 1,000,000 micros)
  providerEarningsMicros: number
  timestamp: Date
}

/**
 * Contributor earnings summary
 */
export interface EarningsSummary {
  wallet: string
  totalEarningsUsd: number
  totalTokensProcessed: number
  totalRequests: number
  pendingPayoutUsd: number
  lastPayoutAt: Date | null
}

/**
 * Payments Calculator - Calculates earnings for contributors
 */
export class PaymentsCalculator {
  private earnings: EarningsEntry[] = []
  private pendingPayouts: Map<string, number> = new Map() // wallet -> pending USDC

  /**
   * Calculate cost for a request
   */
  calculateCost(
    model: string,
    promptTokens: number,
    completionTokens: number
  ): {
    totalCostUsd: number
    contributorEarningsUsd: number
    protocolFeeUsd: number
    reserveFeeUsd: number
  } {
    const modelDef = MODELS[model]
    if (!modelDef) {
      throw new Error(`Unknown model: ${model}`)
    }

    // Calculate total cost (per million tokens)
    const inputCost = (promptTokens / 1_000_000) * modelDef.input_price_per_m
    const outputCost = (completionTokens / 1_000_000) * modelDef.output_price_per_m
    const totalCostUsd = inputCost + outputCost

    // Distribute revenue
    const contributorEarningsUsd = totalCostUsd * CONTRIBUTOR_SHARE
    const protocolFeeUsd = totalCostUsd * PROTOCOL_SHARE
    const reserveFeeUsd = totalCostUsd * RESERVE_SHARE

    return {
      totalCostUsd,
      contributorEarningsUsd,
      protocolFeeUsd,
      reserveFeeUsd,
    }
  }

  /**
   * Record earnings for a completed request
   */
  recordEarnings(
    requestId: string,
    nodeId: string,
    model: string,
    promptTokens: number,
    completionTokens: number
  ): EarningsEntry {
    const node = nodeRegistry.get(nodeId)
    if (!node) {
      throw new Error(`Unknown node: ${nodeId}`)
    }

    const costs = this.calculateCost(model, promptTokens, completionTokens)

    const entry: EarningsEntry = {
      requestId,
      nodeId,
      wallet: node.wallet,
      model,
      promptTokens,
      completionTokens,
      ...costs,
      providerEarningsMicros: Math.floor(costs.contributorEarningsUsd * 1_000_000),
      timestamp: new Date(),
    }

    this.earnings.push(entry)

    // Add to pending payout
    const currentPending = this.pendingPayouts.get(node.wallet) || 0
    this.pendingPayouts.set(node.wallet, currentPending + costs.contributorEarningsUsd)

    return entry
  }

  /**
   * Get earnings summary for a wallet
   */
  getEarningsSummary(wallet: string): EarningsSummary {
    const walletEarnings = this.earnings.filter((e) => e.wallet === wallet)

    return {
      wallet,
      totalEarningsUsd: walletEarnings.reduce((sum, e) => sum + e.contributorEarningsUsd, 0),
      totalTokensProcessed: walletEarnings.reduce(
        (sum, e) => sum + e.promptTokens + e.completionTokens,
        0
      ),
      totalRequests: walletEarnings.length,
      pendingPayoutUsd: this.pendingPayouts.get(wallet) || 0,
      lastPayoutAt: null, // TODO: Track payouts
    }
  }

  /**
   * Get all pending payouts
   */
  getPendingPayouts(): { wallet: string; amountUsd: number }[] {
    return Array.from(this.pendingPayouts.entries()).map(([wallet, amountUsd]) => ({
      wallet,
      amountUsd,
    }))
  }

  /**
   * Mark payout as completed
   */
  markPaid(wallet: string): void {
    this.pendingPayouts.set(wallet, 0)
  }

  /**
   * Get protocol stats
   */
  getProtocolStats(): {
    totalRevenueUsd: number
    totalContributorPayoutsUsd: number
    totalProtocolFeesUsd: number
    totalReserveUsd: number
    totalRequests: number
    totalTokens: number
  } {
    return {
      totalRevenueUsd: this.earnings.reduce((sum, e) => sum + e.totalCostUsd, 0),
      totalContributorPayoutsUsd: this.earnings.reduce(
        (sum, e) => sum + e.contributorEarningsUsd,
        0
      ),
      totalProtocolFeesUsd: this.earnings.reduce((sum, e) => sum + e.protocolFeeUsd, 0),
      totalReserveUsd: this.earnings.reduce((sum, e) => sum + e.reserveFeeUsd, 0),
      totalRequests: this.earnings.length,
      totalTokens: this.earnings.reduce(
        (sum, e) => sum + e.promptTokens + e.completionTokens,
        0
      ),
    }
  }

  /**
   * Get recent earnings (last N entries)
   */
  getRecentEarnings(limit: number = 100): EarningsEntry[] {
    return this.earnings.slice(-limit)
  }
}

// Singleton instance
export const paymentsCalculator = new PaymentsCalculator()
