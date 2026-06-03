// LLM service supporting NVIDIA NIM and DeepSeek APIs
// API key stored in localStorage under 'simelab_llm_key' and 'simelab_llm_provider'

export type LLMProvider = 'nvidia-nim' | 'deepseek';

interface LLMConfig {
  provider: LLMProvider;
  apiKey: string;
  model: string;
}

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  'nvidia-nim': 'meta/llama-3.1-70b-instruct',
  'deepseek': 'deepseek-chat',
};

const ENDPOINTS: Record<LLMProvider, string> = {
  'nvidia-nim': '/api/nvidia/v1/chat/completions',
  'deepseek': '/api/deepseek/v1/chat/completions',
};

export function getConfig(): LLMConfig | null {
  const provider = localStorage.getItem('simelab_llm_provider') as LLMProvider | null;
  const apiKey = localStorage.getItem('simelab_llm_key');
  if (!provider || !apiKey) return null;
  return {
    provider,
    apiKey,
    model: DEFAULT_MODELS[provider],
  };
}

export function saveConfig(provider: LLMProvider, apiKey: string): void {
  localStorage.setItem('simelab_llm_provider', provider);
  localStorage.setItem('simelab_llm_key', apiKey);
}

export function clearConfig(): void {
  localStorage.removeItem('simelab_llm_provider');
  localStorage.removeItem('simelab_llm_key');
}

export function getSystemPrompt(context: string): string {
  return `You are a social network analysis expert at SIMElab Africa, a research lab at USIU-Africa in Nairobi. 
You analyze social media network data, identify patterns, and generate insights.

When answering, be concise, data-driven, and professional. Use the network metrics provided as your ground truth.
Always cite specific numbers from the data when available (node counts, degree values, sentiment percentages, etc.).

Context about the current dataset:
${context}`;
}

export async function queryLLM(
  userQuestion: string,
  context: string,
  onChunk?: (chunk: string) => void
): Promise<string> {
  const config = getConfig();
  if (!config) throw new Error('No API key configured. Set your NVIDIA NIM or DeepSeek key in settings.');

  const systemPrompt = getSystemPrompt(context);

  const response = await fetch(ENDPOINTS[config.provider], {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userQuestion },
      ],
      temperature: 0.3,
      max_tokens: 1500,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API error (${response.status}): ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  
  if (onChunk) onChunk(content);
  return content;
}

export async function queryLLMStreaming(
  userQuestion: string,
  context: string,
  onChunk: (chunk: string) => void
): Promise<string> {
  const config = getConfig();
  if (!config) throw new Error('No API key configured.');

  const systemPrompt = getSystemPrompt(context);

  const response = await fetch(ENDPOINTS[config.provider], {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userQuestion },
      ],
      temperature: 0.3,
      max_tokens: 1500,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API error (${response.status}): ${errText.slice(0, 200)}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

    for (const line of lines) {
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content || '';
        if (content) {
          fullText += content;
          onChunk(content);
        }
      } catch (_) {}
    }
  }

  return fullText;
}
