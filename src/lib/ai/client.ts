'use client';
// Chamadas às rotas /api/ai/* a partir do navegador. Falhas nunca quebram a tela:
// retornam null e o espaço da sugestão simplesmente não aparece (SPEC §9.1).
export type AiTask = 'tips' | 'packing' | 'classify' | 'alerts' | 'retro' | 'explore' | 'suggest' | 'estimate';

export interface AiResponse<T> {
  data: T;
  by: 'ai' | 'rules';
  model?: string;
  note?: string;
}

export async function callAi<T>(task: AiTask, body: unknown, signal?: AbortSignal): Promise<AiResponse<T> | null> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
  try {
    const r = await fetch(`/api/ai/${task}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!r.ok) return null;
    return (await r.json()) as AiResponse<T>;
  } catch {
    return null;
  }
}

export async function aiStatus(): Promise<{ configured: boolean; providers: string[] } | null> {
  try {
    const r = await fetch('/api/ai/status');
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/** Como callAi, mas devolve a mensagem de erro da rota (ex.: IA não configurada, cota). */
export async function callAiOrError<T>(task: AiTask, body: unknown): Promise<{ ok: true; res: AiResponse<T> } | { ok: false; error: string }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { ok: false, error: 'Sem conexão. As sugestões voltam quando a internet voltar.' };
  try {
    const r = await fetch(`/api/ai/${task}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, error: (j as { error?: string } | null)?.error ?? 'Não deu pra sugerir agora. Tenta de novo.' };
    return { ok: true, res: j as AiResponse<T> };
  } catch {
    return { ok: false, error: 'Não deu pra sugerir agora. Tenta de novo.' };
  }
}
