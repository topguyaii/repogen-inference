import { supabase, isDbConfigured } from './client'
import { createHash, randomBytes } from 'crypto'

export interface ProviderRecord {
  id: string
  wallet_address: string
  auth_token_hash: string
  chip: string | null
  memory_gb: number | null
  os_version: string | null
  models: string[]
  max_concurrent: number
  status: 'online' | 'offline' | 'busy'
  is_approved: boolean
  total_requests: number
  total_tokens_generated: number
  total_earnings_micros: number
  pending_earnings_micros: number
}

/**
 * Generate auth token for provider
 */
export function generateAuthToken(): { token: string; hash: string } {
  const token = `rp_${randomBytes(32).toString('hex')}`
  const hash = createHash('sha256').update(token).digest('hex')
  return { token, hash }
}

/**
 * Hash an auth token
 */
export function hashAuthToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Register a new provider
 */
export async function registerProvider(
  walletAddress: string,
  chip: string,
  memoryGb: number,
  osVersion: string,
  models: string[]
): Promise<{ provider: ProviderRecord; authToken: string } | null> {
  if (!isDbConfigured() || !supabase) {
    console.warn('[DB] Database not configured, skipping provider registration')
    return null
  }

  // Generate auth token
  const { token, hash } = generateAuthToken()

  // Check if provider already exists
  const { data: existing } = await supabase
    .from('inference_providers')
    .select('*')
    .eq('wallet_address', walletAddress.toLowerCase())
    .single()

  if (existing) {
    // Update existing provider
    const { data, error } = await supabase
      .from('inference_providers')
      .update({
        chip,
        memory_gb: memoryGb,
        os_version: osVersion,
        models,
        status: 'online',
        last_heartbeat: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select()
      .single()

    if (error) {
      console.error('[DB] Failed to update provider:', error)
      return null
    }

    return { provider: data as ProviderRecord, authToken: token }
  }

  // Create new provider
  const { data, error } = await supabase
    .from('inference_providers')
    .insert({
      wallet_address: walletAddress.toLowerCase(),
      auth_token_hash: hash,
      chip,
      memory_gb: memoryGb,
      os_version: osVersion,
      models,
      status: 'online',
      last_heartbeat: new Date().toISOString(),
      is_approved: false, // Requires manual approval for V1
    })
    .select()
    .single()

  if (error) {
    console.error('[DB] Failed to create provider:', error)
    return null
  }

  return { provider: data as ProviderRecord, authToken: token }
}

/**
 * Verify provider auth token
 */
export async function verifyProviderToken(token: string): Promise<ProviderRecord | null> {
  if (!isDbConfigured() || !supabase) return null

  const hash = hashAuthToken(token)

  const { data, error } = await supabase
    .from('inference_providers')
    .select('*')
    .eq('auth_token_hash', hash)
    .single()

  if (error || !data) return null

  return data as ProviderRecord
}

/**
 * Update provider status
 */
export async function updateProviderStatus(
  providerId: string,
  status: 'online' | 'offline' | 'busy'
): Promise<boolean> {
  if (!isDbConfigured() || !supabase) return true // Silently succeed if no DB

  const { error } = await supabase
    .from('inference_providers')
    .update({
      status,
      last_heartbeat: new Date().toISOString(),
    })
    .eq('id', providerId)

  if (error) {
    console.error('[DB] Failed to update provider status:', error)
    return false
  }

  return true
}

/**
 * Update provider heartbeat
 */
export async function updateProviderHeartbeat(providerId: string): Promise<boolean> {
  if (!isDbConfigured() || !supabase) return true

  const { error } = await supabase
    .from('inference_providers')
    .update({
      last_heartbeat: new Date().toISOString(),
    })
    .eq('id', providerId)

  return !error
}

/**
 * Record a completed request
 */
export async function recordProviderRequest(
  providerId: string,
  model: string,
  tokensIn: number,
  tokensOut: number,
  latencyMs: number,
  earningsMicros: number,
  status: 'success' | 'error' | 'timeout' = 'success',
  errorMessage?: string
): Promise<boolean> {
  if (!isDbConfigured() || !supabase) return true

  const { error } = await supabase.from('provider_request_logs').insert({
    provider_id: providerId,
    model,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    latency_ms: latencyMs,
    earnings_micros: earningsMicros,
    status,
    error_message: errorMessage,
  })

  if (error) {
    console.error('[DB] Failed to record request:', error)
    return false
  }

  // The trigger will auto-update provider stats
  return true
}

/**
 * Get provider by wallet
 */
export async function getProviderByWallet(walletAddress: string): Promise<ProviderRecord | null> {
  if (!isDbConfigured() || !supabase) return null

  const { data, error } = await supabase
    .from('inference_providers')
    .select('*')
    .eq('wallet_address', walletAddress.toLowerCase())
    .single()

  if (error || !data) return null

  return data as ProviderRecord
}

/**
 * Get all approved providers
 */
export async function getApprovedProviders(): Promise<ProviderRecord[]> {
  if (!isDbConfigured() || !supabase) return []

  const { data, error } = await supabase
    .from('inference_providers')
    .select('*')
    .eq('is_approved', true)

  if (error) {
    console.error('[DB] Failed to get approved providers:', error)
    return []
  }

  return (data || []) as ProviderRecord[]
}

/**
 * Get online providers for a model
 */
export async function getOnlineProvidersForModel(model: string): Promise<ProviderRecord[]> {
  if (!isDbConfigured() || !supabase) return []

  const { data, error } = await supabase
    .from('inference_providers')
    .select('*')
    .eq('status', 'online')
    .eq('is_approved', true)
    .contains('models', [model])

  if (error) {
    console.error('[DB] Failed to get providers for model:', error)
    return []
  }

  return (data || []) as ProviderRecord[]
}

/**
 * Start a provider session
 */
export async function startProviderSession(providerId: string): Promise<string | null> {
  if (!isDbConfigured() || !supabase) return null

  const { data, error } = await supabase
    .from('provider_sessions')
    .insert({
      provider_id: providerId,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[DB] Failed to start session:', error)
    return null
  }

  return data.id
}

/**
 * End a provider session
 */
export async function endProviderSession(
  sessionId: string,
  requestsServed: number,
  tokensGenerated: number,
  earningsMicros: number
): Promise<boolean> {
  if (!isDbConfigured() || !supabase) return true

  const { error } = await supabase
    .from('provider_sessions')
    .update({
      ended_at: new Date().toISOString(),
      requests_served: requestsServed,
      tokens_generated: tokensGenerated,
      earnings_micros: earningsMicros,
    })
    .eq('id', sessionId)

  return !error
}
