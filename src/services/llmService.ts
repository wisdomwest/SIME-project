import type { BackendLLMConfig } from './pythonApi';

export type LLMProvider = 'nvidia-nim' | 'deepseek' | 'tokenrouter';

export interface LLMConfig {
  provider: LLMProvider;
  configured: boolean;
  model: string;
}

let backendConfig: LLMConfig | null = null;

export function setBackendConfig(config: BackendLLMConfig): void {
  backendConfig = config;
}

export function getConfig(): LLMConfig | null {
  return backendConfig?.configured ? backendConfig : null;
}

export async function queryLLM(
  userQuestion: string,
  context: string,
  onChunk?: (chunk: string) => void,
): Promise<string> {
  if (!getConfig()) {
    throw new Error('Server-side LLM is not configured. Add a provider key to the backend environment.');
  }

  const response = await fetch('/api/simelab/llm/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_question: userQuestion, context }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail || `LLM request failed (${response.status}).`);
  }

  const data: { content?: string } = await response.json();
  const content = data.content || '';
  if (!content) throw new Error('The LLM provider returned an empty response.');
  onChunk?.(content);
  return content;
}

export async function queryLLMStreaming(
  userQuestion: string,
  context: string,
  onChunk: (chunk: string) => void,
): Promise<string> {
  // The server uses one non-streaming provider request so credentials never
  // enter the browser. Keep this API shape for the chat UI.
  return queryLLM(userQuestion, context, onChunk);
}
