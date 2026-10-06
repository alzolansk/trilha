import 'server-only';
// Provedores de IA com alternância. Chaves só existem no servidor.
// Estratégia: cada tarefa tem uma ordem preferida; um provedor que devolve 429/5xx
// entra em "resfriamento" e a próxima chamada pula para o seguinte (preserva cotas).

export type ProviderId = 'gemini' | 'groq' | 'openrouter';
export type TaskKind = 'identity' | 'tips' | 'packing' | 'classify' | 'alerts' | 'retro';

interface Provider {
  id: ProviderId;
  model: string;
  available: boolean;
  call: (system: string, user: string, opts: { maxTokens: number; temperature: number }) => Promise<string>;
}

const cooldown = new Map<ProviderId, number>();

// Por que essa ordem:
// - identity: Gemini Flash segue bem o schema e tem cota diária maior no nível gratuito;
// - tips/packing/alerts/retro: Groq (gpt-oss-120b) é rápido e bom em pt-BR curto; Gemini como reserva;
// - classify: texto curto e frequente → Gemma no OpenRouter (gratuito) primeiro, poupando Groq/Gemini.
export const ORDER: Record<TaskKind, ProviderId[]> = {
  identity: ['gemini', 'groq', 'openrouter'],
  tips: ['groq', 'gemini', 'openrouter'],
  packing: ['groq', 'gemini', 'openrouter'],
  alerts: ['groq', 'gemini', 'openrouter'],
  retro: ['gemini', 'groq', 'openrouter'],
  classify: ['openrouter', 'groq', 'gemini'],
};

class ProviderError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function postJson(url: string, body: unknown, headers: Record<string, string>, timeoutMs = 25000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    const text = await r.text();
    if (!r.ok) throw new ProviderError(r.status, text.slice(0, 300));
    return JSON.parse(text);
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw new ProviderError(0, (e as Error).name === 'AbortError' ? 'timeout' : (e as Error).message);
  } finally {
    clearTimeout(t);
  }
}

function openAiCompatible(id: ProviderId, url: string, key: string | undefined, model: string, extraHeaders: Record<string, string> = {}): Provider {
  return {
    id,
    model,
    available: !!key,
    async call(system, user, { maxTokens, temperature }) {
      const j = await postJson(
        url,
        {
          model,
          temperature,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        },
        { Authorization: `Bearer ${key}`, ...extraHeaders },
      );
      const content = j?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new ProviderError(502, 'resposta vazia');
      return content;
    },
  };
}

export function providers(): Record<ProviderId, Provider> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  return {
    gemini: {
      id: 'gemini',
      model: geminiModel,
      available: !!geminiKey,
      async call(system, user, { maxTokens, temperature }) {
        const j = await postJson(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`,
          {
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: user }] }],
            generationConfig: { temperature, maxOutputTokens: maxTokens, responseMimeType: 'application/json' },
          },
          { 'x-goog-api-key': geminiKey ?? '' },
        );
        const text = j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('');
        if (!text) throw new ProviderError(502, 'resposta vazia');
        return text;
      },
    },
    groq: openAiCompatible('groq', 'https://api.groq.com/openai/v1/chat/completions', process.env.GROQ_API_KEY, process.env.GROQ_MODEL || 'openai/gpt-oss-120b'),
    openrouter: openAiCompatible('openrouter', 'https://openrouter.ai/api/v1/chat/completions', process.env.OPENROUTER_API_KEY, process.env.OPENROUTER_MODEL || 'google/gemma-4-31b-it:free', {
      'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
      'X-Title': 'Trilha',
    }),
  };
}

export function aiConfigured(): ProviderId[] {
  return Object.values(providers())
    .filter((p) => p.available)
    .map((p) => p.id);
}

function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('JSON inválido');
  }
}

/**
 * Chama os provedores na ordem da tarefa até um responder com JSON que passe em `validate`.
 * Retorna null se nenhum estiver configurado/disponível (o chamador usa as regras locais).
 */
export async function runWithFallback<T>(
  task: TaskKind,
  system: string,
  user: string,
  validate: (raw: unknown) => T | null,
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<{ data: T; provider: ProviderId; model: string } | null> {
  const all = providers();
  const now = Date.now();
  for (const id of ORDER[task]) {
    const p = all[id];
    if (!p.available) continue;
    if ((cooldown.get(id) ?? 0) > now) continue;
    for (let attempt = 0; attempt < 2; attempt++) {
      let text: string;
      try {
        text = await p.call(system, user, { maxTokens: opts.maxTokens ?? 900, temperature: opts.temperature ?? 0.5 });
      } catch (e) {
        const status = e instanceof ProviderError ? e.status : 0;
        if (status === 429 || status >= 500 || status === 0) cooldown.set(id, Date.now() + (status === 429 ? 10 * 60_000 : 60_000));
        if (status === 404 || status === 400 || status === 401 || status === 403) cooldown.set(id, Date.now() + 30 * 60_000);
        console.warn(`[ai] ${task} via ${id} falhou (${status || 'rede'}: ${(e as Error).message.slice(0, 120)})`);
        break;
      }
      // JSON malformado ou fora do schema não é falha do provedor: tenta mais uma vez e depois passa adiante.
      let data: T | null = null;
      try {
        data = validate(extractJson(text));
      } catch {
        data = null;
      }
      if (data != null) return { data, provider: id, model: p.model };
      console.warn(`[ai] ${task} via ${id}: resposta fora do formato (tentativa ${attempt + 1})`);
    }
  }
  return null;
}
