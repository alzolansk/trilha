'use client';
import { useEffect, useState } from 'react';
export interface Fx { base: string; rates: Record<string, number>; date: string; source: string }
export function useFx(base: string) {
  const [fx, setFx] = useState<Fx | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setFx(null);
    const key = `trilha.fx.${base}`;
    try { const cached = JSON.parse(localStorage.getItem(key) ?? 'null'); if (cached?.base === base) setFx(cached); } catch { /* cache opcional */ }
    fetch(`/api/fx?base=${base}`, { signal: controller.signal }).then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'Cotação indisponível.');
      setFx(data); setErr(null);
      try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* cache opcional */ }
    }).catch((e) => { if (!controller.signal.aborted) setErr(e.message); });
    return () => controller.abort();
  }, [base]);
  const rates = Object.fromEntries(Object.entries(fx?.base === base ? fx.rates : {}).filter(([, n]) => n > 0).map(([c, n]) => [c, 1 / n]));
  return { fx, err, rates };
}
