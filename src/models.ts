// Model definitions (inlined from @repogen/shared for standalone deployment)

export type ProviderId = 'local' | 'anthropic' | 'openai' | 'google'

export interface ModelDefinition {
  id: string
  name: string
  providers: ProviderId[]
  context_length: number
  input_price_per_m: number // USD per million tokens
  output_price_per_m: number
  supports_streaming: boolean
  supports_tools: boolean
  privacy_tiers: ('standard' | 'no-log' | 'tee')[]
  is_open: boolean
}

// Available models
export const MODELS: Record<string, ModelDefinition> = {
  // Llama 3.1 8B - Meta's open model
  'llama-3.1-8b': {
    id: 'llama-3.1-8b',
    name: 'Llama 3.1 8B',
    providers: ['local'],
    context_length: 8192,
    input_price_per_m: 0.01,
    output_price_per_m: 0.03,
    supports_streaming: true,
    supports_tools: false,
    privacy_tiers: ['standard', 'no-log'],
    is_open: true,
  },

  // Llama 3.2 3B - Smaller model for limited RAM
  'llama-3.2-3b': {
    id: 'llama-3.2-3b',
    name: 'Llama 3.2 3B',
    providers: ['local'],
    context_length: 8192,
    input_price_per_m: 0.005,
    output_price_per_m: 0.015,
    supports_streaming: true,
    supports_tools: false,
    privacy_tiers: ['standard', 'no-log'],
    is_open: true,
  },

  // Mistral 7B
  'mistral-7b': {
    id: 'mistral-7b',
    name: 'Mistral 7B Instruct',
    providers: ['local'],
    context_length: 32768,
    input_price_per_m: 0.01,
    output_price_per_m: 0.03,
    supports_streaming: true,
    supports_tools: false,
    privacy_tiers: ['standard', 'no-log'],
    is_open: true,
  },

  // Qwen 2.5 7B
  'qwen-2.5-7b': {
    id: 'qwen-2.5-7b',
    name: 'Qwen 2.5 7B',
    providers: ['local'],
    context_length: 32768,
    input_price_per_m: 0.01,
    output_price_per_m: 0.03,
    supports_streaming: true,
    supports_tools: false,
    privacy_tiers: ['standard', 'no-log'],
    is_open: true,
  },

  // Gemma 2 9B
  'gemma-2-9b': {
    id: 'gemma-2-9b',
    name: 'Gemma 2 9B',
    providers: ['local'],
    context_length: 8192,
    input_price_per_m: 0.01,
    output_price_per_m: 0.03,
    supports_streaming: true,
    supports_tools: false,
    privacy_tiers: ['standard', 'no-log'],
    is_open: true,
  },
}

export function getModel(id: string): ModelDefinition | undefined {
  return MODELS[id]
}

export function getAllModels(): ModelDefinition[] {
  return Object.values(MODELS)
}
