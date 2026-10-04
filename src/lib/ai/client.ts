'use client';
// Chamadas às rotas /api/ai/* a partir do navegador. Falhas nunca quebram a tela:
// retornam null e o espaço da sugestão simplesmente não aparece (SPEC §9.1).
export type AiTask = 'identity' | 'tips' | 'packing' | 'classify' | 'alerts' | 'retro';

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
