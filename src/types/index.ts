import { z } from 'zod'

// Hardware specifications (supports both NVIDIA GPU and Apple Silicon)
export const GpuSpec = z.object({
  name: z.string(), // e.g., "NVIDIA RTX 4090" or "Apple M4 Pro"
  vram: z.number(), // MB (unified memory for Apple Silicon)
  compute: z.string(), // Compute capability e.g., "8.9" or "apple-silicon"
  type: z.enum(['nvidia', 'amd', 'apple']).optional(), // Hardware type
})
export type GpuSpec = z.infer<typeof GpuSpec>

// Apple Silicon specific info
export const AppleSiliconSpec = z.object({
  chip: z.string(), // e.g., "M4 Pro", "M3 Max"
  memoryGb: z.number(), // Unified memory in GB
  osVersion: z.string(), // e.g., "macOS 14.5"
})
export type AppleSiliconSpec = z.infer<typeof AppleSiliconSpec>

// Node status
export type NodeStatus = 'connecting' | 'ready' | 'busy' | 'offline'

// Registered node
export interface Node {
  id: string
  wallet: string
  gpu: GpuSpec
  models: string[]
  status: NodeStatus
  load: number // 0-1
  latencyMs: number
  region: string
  connectedAt: Date
  lastHeartbeat: Date
  requestsProcessed: number
  tokensGenerated: number
}

// WebSocket message types
export const MessageType = z.enum([
  'register',
  'heartbeat',
  'inference_request',
  'inference_response',
  'inference_chunk',
  'error',
  'ack',
])
export type MessageType = z.infer<typeof MessageType>

// Registration message from node
export const RegisterMessage = z.object({
  type: z.literal('register'),
  wallet: z.string(),
  gpu: GpuSpec,
  models: z.array(z.string()),
  region: z.string().optional(),
  // Apple Silicon specific fields
  appleSilicon: AppleSiliconSpec.optional(),
  authToken: z.string().optional(), // For reconnection
})
export type RegisterMessage = z.infer<typeof RegisterMessage>

// Heartbeat message from node
export const HeartbeatMessage = z.object({
  type: z.literal('heartbeat'),
  status: z.enum(['ready', 'busy']),
  load: z.number().min(0).max(1),
  latencyMs: z.number().positive(),
})
export type HeartbeatMessage = z.infer<typeof HeartbeatMessage>

// Inference request to node
export const InferenceRequest = z.object({
  type: z.literal('inference_request'),
  requestId: z.string(),
  model: z.string(),
  messages: z.array(
    z.object({
      role: z.enum(['system', 'user', 'assistant']),
      content: z.string(),
    })
  ),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
  stream: z.boolean().default(false),
})
export type InferenceRequest = z.infer<typeof InferenceRequest>

// Inference response from node
export const InferenceResponse = z.object({
  type: z.literal('inference_response'),
  requestId: z.string(),
  content: z.string(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  finishReason: z.enum(['stop', 'length', 'error']),
})
export type InferenceResponse = z.infer<typeof InferenceResponse>

// Streaming chunk from node
export const InferenceChunk = z.object({
  type: z.literal('inference_chunk'),
  requestId: z.string(),
  content: z.string(),
  done: z.boolean(),
})
export type InferenceChunk = z.infer<typeof InferenceChunk>

// Error message
export const ErrorMessage = z.object({
  type: z.literal('error'),
  requestId: z.string().optional(),
  code: z.string(),
  message: z.string(),
})
export type ErrorMessage = z.infer<typeof ErrorMessage>

// Acknowledgment message
export const AckMessage = z.object({
  type: z.literal('ack'),
  nodeId: z.string(),
})
export type AckMessage = z.infer<typeof AckMessage>

// Union of all messages
export const NodeMessage = z.discriminatedUnion('type', [
  RegisterMessage,
  HeartbeatMessage,
  InferenceResponse,
  InferenceChunk,
  ErrorMessage,
])
export type NodeMessage = z.infer<typeof NodeMessage>

// Pending inference request
export interface PendingRequest {
  id: string
  model: string
  messages: { role: string; content: string }[]
  temperature?: number
  maxTokens?: number
  stream: boolean
  nodeId: string | null
  createdAt: Date
  resolve: (response: InferenceResponse) => void
  reject: (error: Error) => void
  onChunk?: (chunk: InferenceChunk) => void
}
