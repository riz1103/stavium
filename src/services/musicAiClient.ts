/**
 * OpenAI-compatible chat API for music tooling (arrangement, reharmonize, SATB, countermelody).
 * Defaults to Groq (free tier at https://console.groq.com) — set VITE_MUSIC_AI_API_KEY.
 * Help chat stays on Google Gemini (VITE_GEMINI_API_KEY) in helpChatService.ts.
 *
 * You can point VITE_MUSIC_AI_BASE_URL at any OpenAI-compatible endpoint (Ollama, LM Studio, etc.).
 */

const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';
/** Groq free tier — override if your account uses different IDs (see console.groq.com/docs/models). */
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

export const isMusicAiConfigured = (): boolean => {
  const key = import.meta.env.VITE_MUSIC_AI_API_KEY?.trim();
  return !!key && key !== 'your-music-ai-api-key';
};

export interface MusicAiChatOptions {
  temperature?: number;
  maxTokens?: number;
}

/**
 * Sends a user prompt and returns assistant text, or null if not configured / request failed.
 */
export async function chatCompletionText(
  userPrompt: string,
  options: MusicAiChatOptions = {}
): Promise<string | null> {
  if (!isMusicAiConfigured()) return null;

  const apiKey = import.meta.env.VITE_MUSIC_AI_API_KEY!.trim();
  const baseUrl = (import.meta.env.VITE_MUSIC_AI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const model = import.meta.env.VITE_MUSIC_AI_MODEL || DEFAULT_MODEL;
  const temperature = options.temperature ?? 0.85;
  const maxTokens = options.maxTokens ?? 1200;

  const url = `${baseUrl}/chat/completions`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: userPrompt }],
        temperature,
        max_tokens: maxTokens,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn('[musicAiClient]', res.status, errText.slice(0, 200));
      return null;
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    if (data.error?.message) {
      console.warn('[musicAiClient]', data.error.message);
      return null;
    }

    const text = data.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch (e) {
    console.warn('[musicAiClient] fetch failed', e);
    return null;
  }
}
