'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Estimate, EstimateNote, FitBadge } from '../components/plan/PlanBits';
import p from '../components/plan/plan.module.css';
import { useAction, useConfirm } from '../components/ui/feedback';
import { Icon, PageTitle } from '../components/ui/primitives';
import { useBundle } from '../data/TripContext';
import { callAiOrError } from '../lib/ai/client';
import { sortedStops } from '../lib/derive';
import { categoryPerPerson, destinationPollId, fitOf, hoursLabel, perPersonCents, rangeLabel } from '../lib/explore';
import { MODE_LABEL } from '../lib/format';
import { centsToDecimal, toCents } from '../lib/money';
import { hasDestination } from '../lib/plan';

interface Place {
  name: string; region: string; country: string; lat: number; lng: number; why: string;
  mode: 'bus' | 'car' | 'plane' | 'train' | 'boat'; hours: number; cost_low: number; cost_high: number; km: number | null;
}
interface Result { items: Place[]; from: string | null; currency: string; model?: string }

const VIBES = ['Praia', 'Serra', 'Natureza', 'Cidade', 'Cultura', 'Comida', 'Rolê barato', 'Vida noturna'];
const HOURS: { label: string; v: number | null }[] = [{ label: 'até 3h', v: 3 }, { label: 'até 6h', v: 6 }, { label: 'voo curto', v: 12 }, { label: 'tanto faz', v: null }];

export default function Explorar() {
  const { bundle: b, base, canEdit, source, reload, me } = useBundle();
  const router = useRouter();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const planning = !hasDestination(b);
  const stops = useMemo(() => sortedStops(b), [b]);
  const cur = b.trip.base_currency;
  const cacheKey = `trilha.explorar.${b.trip.id}`;

  const defaultBudget = planning ? perPersonCents(b) : categoryPerPerson(b, 'Passeios');
  const [origin, setOrigin] = useState(b.trip.origin ?? '');
  const [near, setNear] = useState(stops[0]?.id ?? '');
  const [budget, setBudget] = useState(defaultBudget ? String(Math.round(defaultBudget / 100)) : '');
  const [hours, setHours] = useState<number | null>(6);
  const [vibes, setVibes] = useState<string[]>([]);
  const [res, setRes] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<Record<string, string>>({});

  // Última busca fica na sessão: voltar pra tela não gasta outra chamada de IA.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(cacheKey);
      if (raw) setRes(JSON.parse(raw) as Result);
    } catch {
      /* sem armazenamento: só não reaproveita */
    }
  }, [cacheKey]);

  const capCents = budget.trim() ? toCents(budget) : 0;
  const demo = source.kind === 'demo';

  const suggest = async () => {
    setLoading(true);
    setError(null);
    const r = await callAiOrError<Omit<Result, 'model'>>('explore', {
      kind: 'destinations', tripId: b.trip.id, origin: planning ? origin.trim() || null : null, nearStopId: planning ? null : near || null,
      budgetPerPerson: capCents ? Math.round(capCents / 100) : null, maxHours: planning ? hours : null, vibes,
    });
    setLoading(false);
    if (!r.ok) return setError(r.error);
    const next = { ...r.res.data, model: r.res.model };
    setRes(next);
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify(next));
    } catch {
      /* ignora */
    }
  };

  const detail = (x: Place, currency: string) => `${x.why} · ${rangeLabel(x.cost_low * 100, x.cost_high * 100, currency)}/pessoa (estimativa da IA)`.slice(0, 300);

  const toDispute = (x: Place, currency: string) =>
    run(async () => {
      let pollId = destinationPollId(b);
      if (!pollId) {
        pollId = crypto.randomUUID();
        await source.insert('polls', { id: pollId, trip_id: b.trip.id, question: 'Pra onde a gente vai?', detail: null, target: 'free', stop_id: null, multi: false, closes_at: null, created_by: me }, { returning: false });
      }
      const opts = (b.pollOptions ?? []).filter((o) => o.poll_id === pollId);
      if (opts.some((o) => o.label.toLowerCase() === x.name.toLowerCase())) return;
      await source.insert('poll_options', {
        id: crypto.randomUUID(), poll_id: pollId, trip_id: b.trip.id, label: x.name.slice(0, 80), detail: detail(x, currency),
        link_url: null, price: null, currency: null, address: null, position: opts.length, created_by: me,
      }, { returning: false });
      await reload();
      setDone((d) => ({ ...d, [x.name]: 'Na disputa' }));
    }, { success: `${x.name} entrou na votação do destino.` });

  const choose = async (x: Place) => {
    if (!(await confirm({ title: `Fechar ${x.name} como destino?`, message: 'A trilha passa a ter esse destino. Em seguida você gera a identidade visual dele.', confirmLabel: 'Fechar destino' }))) return;
    await run(async () => {
      await source.update('trips', b.trip.id, { destinations: [x.name.slice(0, 80)] });
      await reload();
      router.push(`${base}/ajustes`);
    }, { success: `Destino: ${x.name}. Agora gere a identidade.` });
  };

  const inspire = (x: Place, currency: string) =>
    run(async () => {
      await source.insert('journal_entries', {
        id: crypto.randomUUID(), trip_id: b.trip.id, author_id: me, kind: 'inspiracao', phase: 'antes', stop_id: planning ? null : near || null,
        entry_date: null, title: x.name.slice(0, 120), body: detail(x, currency), link_url: null, place_name: [x.name, x.region].filter(Boolean).join(', ').slice(0, 120),
      }, { returning: false });
      await reload();
      setDone((d) => ({ ...d, [x.name]: 'Nas inspirações' }));
    }, { success: `${x.name} foi pras inspirações do Diário. A turma já pode reagir.` });

  return (
    <div className="wrap">
      <PageTitle
        eyebrow={planning ? 'Sonhar · sem destino ainda' : `${b.trip.title} · perto do roteiro`}
        title={planning ? 'Pra onde dá pra ir?' : 'O que mais dá pra ver?'}
        sub={planning
          ? 'Sugestões pelo tempo de viagem, pelo orçamento de cada pessoa e pelo que a turma curte.'
          : 'Bate-voltas e paradas extras perto das suas paradas, com o custo a mais por pessoa.'}
      />

      <section className={p.filters} aria-label="O que vocês procuram">
        <div className={p.row}>
          {planning ? (
            <label className="field">Saindo de<input value={origin} maxLength={80} onChange={(e) => setOrigin(e.target.value)} placeholder="São Paulo" /></label>
          ) : stops.length ? (
            <label className="field">Perto de<select value={near} onChange={(e) => setNear(e.target.value)}>{stops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          ) : null}
          <label className="field">{planning ? `Até quanto por pessoa (${cur})` : `Quanto a mais por pessoa (${cur})`}
            <input inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d]/g, ''))} placeholder={planning ? '1500' : '300'} />
          </label>
        </div>
        {planning ? (
          <div className={p.group} role="group" aria-labelledby="ex-horas">
            <span id="ex-horas" style={{ fontSize: 14, fontWeight: 500 }}>Quanto tempo de estrada topam?</span>
            <div className={p.chips}>{HOURS.map((h) => <button key={h.label} className="chip tap" aria-pressed={hours === h.v} onClick={() => setHours(h.v)}>{h.label}</button>)}</div>
          </div>
        ) : null}
        <div className={p.group} role="group" aria-labelledby="ex-vibe">
          <span id="ex-vibe" style={{ fontSize: 14, fontWeight: 500 }}>O que a turma curte</span>
          <div className={p.chips}>
            {VIBES.map((v) => (
              <button key={v} className="chip tap" aria-pressed={vibes.includes(v)} onClick={() => setVibes(vibes.includes(v) ? vibes.filter((x) => x !== v) : [...vibes, v].slice(0, 6))}>{v}</button>
            ))}
          </div>
        </div>
        <div className="actions">
          <button className="btn btn-primary tap" onClick={suggest} disabled={loading || demo || (planning && !origin.trim())}>
            <Icon name="sparkle" size={18} sw={1.6} fill="currentColor" />{loading ? 'Procurando…' : res ? 'Sugerir de novo' : 'Sugerir lugares'}
          </button>
          {demo ? <span className="muted" style={{ fontSize: 14 }}>Na demonstração as sugestões ficam desligadas: elas usam a IA da sua conta.</span> : null}
        </div>
      </section>

      {error ? <div className="errbox" role="alert" style={{ marginTop: 24 }}>{error}</div> : null}

      {res ? (
        <section style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 16 }} aria-labelledby="ex-res">
          <h2 id="ex-res" className="disp" style={{ margin: 0, fontSize: 28 }}>
            {res.items.length} {res.items.length === 1 ? 'lugar' : 'lugares'}{res.from ? ` a partir de ${res.from}` : ''}
          </h2>
          <div className={p.cards}>
            {res.items.map((x) => {
              const fit = fitOf(x.cost_low * 100, x.cost_high * 100, capCents);
              return (
                <article key={x.name} className={p.card} data-fit={fit}>
                  <div className={p.cardHead}>
                    <div>
                      <h3>{x.name}</h3>
                      <span className={p.meta}>{[x.region, x.country].filter(Boolean).join(', ')}</span>
                    </div>
                    <FitBadge fit={fit} high={x.cost_high * 100} cap={capCents} currency={res.currency} />
                  </div>
                  <span className={p.meta}>
                    {hoursLabel(x.hours)} de {MODE_LABEL[x.mode]?.toLowerCase() ?? x.mode}{x.km != null ? ` · ${x.km} km em linha reta` : ''}
                  </span>
                  <Estimate low={x.cost_low * 100} high={x.cost_high * 100} currency={res.currency} suffix={planning ? 'por pessoa, viagem toda' : 'a mais por pessoa'} />
                  <p className={p.why}>{x.why}</p>
                  {canEdit && !demo ? (
                    <div className={p.actions}>
                      {done[x.name] ? (
                        <span className="pill" data-tone="ink"><Icon name="check" size={14} />{done[x.name]}</span>
                      ) : planning ? (
                        <>
                          <button className="btn btn-sm btn-ink tap" disabled={busy} onClick={() => toDispute(x, res.currency)}>Pôr na disputa</button>
                          <button className="btn btn-sm tap" disabled={busy} onClick={() => choose(x)}>Fechar destino</button>
                        </>
                      ) : (
                        <button className="btn btn-sm btn-ink tap" disabled={busy} onClick={() => inspire(x, res.currency)}>Guardar nas inspirações</button>
                      )}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
          <EstimateNote model={res.model} />
          {planning && destinationPollId(b) ? <Link href={`${base}/turma#decisoes`} style={{ fontWeight: 600 }}>Ver a votação do destino →</Link> : null}
          {!planning ? <Link href={`${base}/turma/diario`} style={{ fontWeight: 600 }}>Ver inspirações no Diário →</Link> : null}
        </section>
      ) : null}

      {capCents > 0 && planning && b.trip.budget_total == null && canEdit && !demo ? (
        <p className="muted" style={{ marginTop: 24, fontSize: 14 }}>
          Quer usar {rangeLabel(capCents, capCents, cur).replace('~', '')} por pessoa como orçamento da trilha?{' '}
          <button className="btn btn-sm tap" style={{ marginLeft: 6 }} disabled={busy} onClick={() => run(async () => {
            await source.update('trips', b.trip.id, { budget_total: centsToDecimal(capCents * Math.max(1, b.members.length)) });
            await reload();
          }, { success: 'Orçamento salvo. Dá pra dividir por categoria em Mala e gastos.' })}>Salvar orçamento</button>
        </p>
      ) : null}
    </div>
  );
}
