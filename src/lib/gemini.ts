/**
 * Shared Gemini REST helper — no extra dependencies.
 *
 * Uses the v1beta endpoint with SSE streaming.
 * Model: gemini-2.5-flash (stable, as of 2025-05).
 */

export const GEMINI_MODEL = 'gemini-2.5-flash';

export interface GeminiPart    { text: string }
export interface GeminiContent { role: 'user' | 'model'; parts: GeminiPart[] }

/**
 * Normalize a chat history to be Gemini-compatible:
 *  - Drop leading 'model' messages (Gemini requires first = 'user')
 *  - Drop empty messages
 *  - Merge consecutive same-role messages (Gemini requires strict alternation)
 */
export function normalizeHistory(messages: GeminiContent[]): GeminiContent[] {
  // Filter empty
  let msgs = messages.filter(m => m.parts.some(p => p.text.trim()));

  // Drop leading model turns
  while (msgs.length > 0 && msgs[0].role === 'model') msgs = msgs.slice(1);

  if (msgs.length === 0) return [];

  // Merge consecutive same-role turns
  const result: GeminiContent[] = [msgs[0]];
  for (let i = 1; i < msgs.length; i++) {
    const prev = result[result.length - 1];
    if (msgs[i].role === prev.role) {
      // Merge parts
      prev.parts = [...prev.parts, ...msgs[i].parts];
    } else {
      result.push({ ...msgs[i] });
    }
  }

  return result;
}

/**
 * Stream a Gemini response.
 * Returns a ReadableStream<Uint8Array> that yields raw text chunks.
 */
export async function streamGemini(
  apiKey: string,
  systemPrompt: string,
  messages: GeminiContent[],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<ReadableStream<Uint8Array>> {
  const { maxTokens = 600, temperature = 0.7 } = opts;

  const normalized = normalizeHistory(messages);
  if (normalized.length === 0) {
    throw new Error('No valid messages to send to Gemini (empty or all-model history)');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: normalized,
      generationConfig: { maxOutputTokens: maxTokens, temperature },
    }),
  });

  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`Gemini ${response.status}: ${errText}`);
  }

  const body = response.body;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader  = body.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const jsonStr = line.slice(5).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;
            try {
              const parsed = JSON.parse(jsonStr) as {
                candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
              };
              const text = parsed.candidates?.[0]?.content?.parts
                ?.map(p => p.text ?? '').join('') ?? '';
              if (text) controller.enqueue(encoder.encode(text));
            } catch { /* skip malformed SSE chunk */ }
          }
        }
      } finally {
        controller.close();
      }
    },
  });
}

/**
 * One-shot (non-streaming) Gemini call.
 * Returns the full text response.
 */
export async function callGemini(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const { maxTokens = 2048, temperature = 0.4 } = opts;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`Gemini ${response.status}: ${errText}`);
  }

  const data = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  };
  return data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
}
