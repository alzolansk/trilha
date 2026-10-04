'use client';
import { useEffect, useMemo, useState } from 'react';
import { Dialog, useAction, useConfirm, useToast } from '../components/ui/feedback';
import { AiNote, AiTag, Floaters, Icon, MotifCheck, PageTitle, useReveal } from '../components/ui/primitives';
import { useBundle } from '../data/TripContext';
import type { BudgetCategory, Expense, PackingItem, Task, TaskStatus } from '../data/types';
import { callAi } from '../lib/ai/client';
import { currencyForCountry, currencySymbol } from '../lib/currency';
import { packingProgress, sortedStops, stopCode, tripPhase, tripTarget } from '../lib/derive';
import { dayMonth, initials } from '../lib/format';
import { fgOn } from '../lib/identity/contrast';
import { colorCycle } from '../lib/identity/theme';
import { balances, budgetByCategory, centsToDecimal, convertCents, formatMoney, splitEqual, suggestTransfers, toCents } from '../lib/money';
import { rulePacking, type PackingSuggestion } from '../lib/rules';
import { countdown, todayIn } from '../lib/time';
import s from './mala.module.css';

interface Fx {
  base: string;
  rates: Record<string, number>;
  date: string;
  source: string;
}

function useFx(base: string) {
  const [fx, setFx] = useState<Fx | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const key = `trilha.fx.${base}`;
    try {
      const c = localStorage.getItem(key);
      if (c) setFx(JSON.parse(c));
    } catch {
      /* ignora */
    }
    if (!navigator.onLine) return;
    fetch(`/api/fx?base=${base}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setFx(j);
        setErr(null);
        try {
          localStorage.setItem(key, JSON.stringify(j));
        } catch {
          /* ignora */
        }
      })
      .catch((e) => setErr((e as Error).message || 'Cotação indisponível.'));
  }, [base]);
  return { fx, err };
}

export default function Mala() {
  const { bundle: b, identity, canEdit } = useBundle();
  const cols = colorCycle(identity);
  const pack = packingProgress(b);
  const C = 2 * Math.PI * 48;
  const [tab, setTab] = useState<'mala' | 'gastos'>('mala');
  useReveal([b.packingItems.length, b.expenses.length]);
  const phase = tripPhase(b.trip);
  const days = countdown(Date.now(), tripTarget(b.trip), b.trip.departure_tz).totalDays;
  const spent = b.expenses.reduce((a, e) => a + toCents(String(e.base_amount)), 0);
  const people = Math.max(1, b.members.length);

  return (
    <div className="wrap">
      <Floaters />
      <PageTitle eyebrow={`${b.trip.title} · ${phase.kind === 'before' ? `faltam ${days} dias` : phase.kind === 'after' ? 'viagem concluída' : 'em andamento'}`} title="Mala e gastos" sub="O que falta levar e quanto já foi. Dividido com a turma." />
      <div className={s.tabs} role="group" aria-label="Seção">
        <button className="chip tap" aria-pressed={tab === 'mala'} onClick={() => setTab('mala')}>Mala e pendências</button>
        <button className="chip tap" aria-pressed={tab === 'gastos'} onClick={() => setTab('gastos')}>Gastos</button>
      </div>
      <section className="split" style={{ marginTop: 44 }}>
        <div className={`${s.left} ${tab === 'mala' ? '' : s.hideMobile}`}>
          <div className={`${s.ring} rv`}>
            <div aria-hidden="true" style={{ position: 'absolute', right: -30, top: -30, width: 130, height: 130, clipPath: 'var(--motif)', background: 'var(--acc2)', opacity: 0.5, animation: 'floaty 8s ease-in-out infinite' }} />
            <svg aria-hidden="true" width="120" height="120" viewBox="0 0 120 120" style={{ flex: 'none', position: 'relative' }}>
              <circle cx="60" cy="60" r="48" fill="none" stroke="currentColor" strokeOpacity=".18" strokeWidth="14" />
              <circle className={s.v} cx="60" cy="60" r="48" fill="none" stroke="var(--acc2)" strokeWidth="14" strokeLinecap="round" strokeDasharray={`${((C * pack.pct) / 100).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(-90 60 60)" />
              <text x="60" y="68" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="22" fill="currentColor">{pack.pct}%</text>
            </svg>
            <div style={{ position: 'relative' }}>
              <div className="disp" style={{ fontSize: 36, lineHeight: 1 }}>{pack.done} de {pack.total}</div>
              <div style={{ marginTop: 6, opacity: 0.85 }}>itens na mochila</div>
            </div>
          </div>
          <div className={s.mobileTiles}>
            <div style={{ background: 'var(--acc3)', color: 'var(--fg-acc3)' }}><span className="mono">GASTO</span><b className="disp">{formatMoney(spent, b.trip.base_currency, { compact: true })}</b></div>
            <div style={{ background: 'var(--acc2)', color: 'var(--fg-acc2)' }}><span className="mono">POR PESSOA</span><b className="disp">{formatMoney(Math.round(spent / people), b.trip.base_currency, { compact: true })}</b></div>
          </div>
          <Packing />
          <Tasks />
        </div>
        <div className={`${s.right} ${tab === 'gastos' ? '' : s.hideMobile}`}>
          <Budget cols={cols} />
          <StopSpend cols={cols} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(260px,100%),1fr))', gap: 26 }}>
            <Converter />
            <Debts cols={cols} />
          </div>
          <ExpenseList />
          {!canEdit ? <p className="muted">Você está como leitor: dá pra consultar tudo, sem editar.</p> : null}
        </div>
      </section>
    </div>
  );
}

// ───────────────────── Mala ─────────────────────
function Packing() {
  const { bundle: b, canEdit, source, reload, me } = useBundle();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const toast = useToast();
  const [item, setItem] = useState('');
  const [group, setGroup] = useState('');
  const [sugs, setSugs] = useState<{ list: (PackingSuggestion & { by: 'ai' | 'rules' })[]; model?: string } | null>(null);
  const [asking, setAsking] = useState(false);
  const [editing, setEditing] = useState<PackingItem | null>(null);
  const cats = [...b.packingCategories].sort((a, c) => a.position - c.position);
  const hasAiItems = b.packingItems.some((i) => i.suggested_by === 'ai');

  const ensureCategory = async (name: string) => {
    const found = cats.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (found) return found.id;
    const c = await source.insert<{ id: string }>('packing_categories', { trip_id: b.trip.id, name, position: cats.length });
    return c.id;
  };

  const toggle = (it: PackingItem, done: boolean) =>
    run(() => source.update('packing_items', it.id, { done, done_by: done ? me : null }).then(reload));

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const label = item.trim();
    if (!label) return;
    void run(async () => {
      const catId = group || (await ensureCategory('Seus itens'));
      await source.insert('packing_items', { trip_id: b.trip.id, category_id: catId, label, position: b.packingItems.filter((x) => x.category_id === catId).length });
      setItem('');
      await reload();
    });
  };

  const ask = async () => {
    setAsking(true);
    const r = source.kind === 'supabase' ? await callAi<PackingSuggestion[]>('packing', { tripId: b.trip.id }) : null;
    const list = r ? r.data.map((x) => ({ ...x, by: r.by })) : rulePacking(b).map((x) => ({ ...x, by: 'rules' as const }));
    setSugs({ list, model: r?.model });
    setAsking(false);
    if (!list.length) toast('Nada novo pra sugerir com os dados atuais.');
  };

  const accept = (sg: PackingSuggestion & { by: 'ai' | 'rules' }) =>
    run(async () => {
      const catId = await ensureCategory(sg.group);
      await source.insert('packing_items', { trip_id: b.trip.id, category_id: catId, label: sg.label, suggestion_reason: sg.reason, suggested_by: sg.by, position: 999 });
      setSugs((p) => (p ? { ...p, list: p.list.filter((x) => x.label !== sg.label) } : p));
      await reload();
    }, { success: `${sg.label} adicionado à mala.` });

  return (
    <>
      <div className="rv">
        {hasAiItems || b.packingItems.some((i) => i.suggested_by === 'rules') ? (
          <AiNote by={hasAiItems ? 'ai' : 'rules'}>Itens com etiqueta {hasAiItems ? 'IA' : 'AUTO'} foram sugeridos a partir das paradas, atividades e transportes da sua trilha. Toque no item pra ver o motivo.</AiNote>
        ) : null}
      </div>
      {!b.packingItems.length ? (
        <div className="empty rv">
          <h3 className="disp" style={{ fontSize: 24 }}>Mala vazia</h3>
          <p style={{ margin: 0 }}>Adicione itens ou peça sugestões com base no roteiro.</p>
        </div>
      ) : null}
      {canEdit ? (
        <button className="btn btn-ghost tap rv" onClick={ask} disabled={asking} style={{ alignSelf: 'flex-start' }}>
          <Icon name="sparkle" size={16} fill="currentColor" />
          {asking ? 'Pensando…' : 'Pedir sugestões à IA'}
        </button>
      ) : null}
      {sugs?.list.length ? (
        <div className={s.sugs}>
          {sugs.list.map((sg) => (
            <div key={sg.label} className={s.sug}>
              <div style={{ flex: 1 }}>
                <b>{sg.label}</b> <AiTag by={sg.by} />
                <div style={{ fontSize: 13, color: 'var(--mute)' }}>{sg.reason}</div>
              </div>
              <button className="btn btn-sm btn-ink tap" onClick={() => void accept(sg)} disabled={busy}>Adicionar</button>
            </div>
          ))}
          <button className="btn btn-sm tap" onClick={() => setSugs(null)}>Dispensar sugestões</button>
        </div>
      ) : null}
      {cats.map((c) => {
        const items = b.packingItems.filter((i) => i.category_id === c.id).sort((a, x) => a.position - x.position);
        return (
          <fieldset key={c.id} className={`${s.group} rv`}>
            <legend>{c.name}</legend>
            {items.map((it) => (
              <div key={it.id} className={s.itemRow}>
                <MotifCheck checked={it.done} disabled={!canEdit || busy} onChange={(v) => void toggle(it, v)} label={it.label}>
                  {it.suggested_by ? <span title={it.suggestion_reason ?? undefined}><AiTag by={it.suggested_by} /></span> : null}
                </MotifCheck>
                {canEdit ? <button className="btn btn-icon btn-sm" style={{ border: 0, background: 'transparent' }} aria-label={`Editar ${it.label}`} onClick={() => setEditing(it)}><Icon name="edit" size={16} /></button> : null}
              </div>
            ))}
            {!items.length ? <p className="muted" style={{ margin: '6px 0' }}>Sem itens.</p> : null}
            {canEdit ? (
              <button className={s.linkBtn} onClick={async () => {
                if (await confirm({ title: `Excluir “${c.name}”?`, message: `Os ${items.length} itens desse grupo também saem da mala.` })) await run(() => source.remove('packing_categories', { id: c.id }).then(reload));
              }}>Excluir grupo</button>
            ) : null}
          </fieldset>
        );
      })}
      {canEdit ? (
        <form className="rv" onSubmit={add} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <label className="field" style={{ flex: '1 1 200px' }}>
            <span className="sr">Novo item</span>
            <input value={item} maxLength={120} onChange={(e) => setItem(e.target.value)} placeholder="Adicionar item à mala" required />
          </label>
          <label className="field" style={{ flex: '0 1 170px' }}>
            <span className="sr">Grupo</span>
            <select value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">Seus itens</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <button className="btn btn-ink tap" aria-label="Adicionar item" disabled={busy}><Icon name="plus" size={18} /></button>
        </form>
      ) : null}
      {canEdit ? <NewGroup count={cats.length} /> : null}
      {editing ? <ItemDialog it={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function NewGroup({ count }: { count: number }) {
  const { bundle: b, source, reload } = useBundle();
  const { run } = useAction();
  const [name, setName] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) void run(() => source.insert('packing_categories', { trip_id: b.trip.id, name: name.trim(), position: count }).then(reload).then(() => setName(''))); }} style={{ display: 'flex', gap: 10 }}>
      <label className="field" style={{ flex: 1 }}>
        <span className="sr">Novo grupo</span>
        <input id="newgroup" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Novo grupo (ex.: Eletrônicos)" />
      </label>
      <button className="btn tap">Criar grupo</button>
    </form>
  );
}

function ItemDialog({ it, onClose }: { it: PackingItem; onClose: () => void }) {
  const { bundle: b, source, reload } = useBundle();
  const { run, busy } = useAction();
  const [label, setLabel] = useState(it.label);
  const [cat, setCat] = useState(it.category_id);
  return (
    <Dialog open onClose={onClose} title="Editar item" footer={<>
      <button className="btn btn-danger tap" onClick={() => void run(() => source.remove('packing_items', { id: it.id }).then(reload).then(onClose), { success: 'Item removido.' })}>Excluir</button>
      <button className="btn btn-primary tap" disabled={busy || !label.trim()} onClick={() => void run(() => source.update('packing_items', it.id, { label: label.trim(), category_id: cat }, it.version).then(reload).then(onClose), { onConflict: () => source.update('packing_items', it.id, { label: label.trim(), category_id: cat }).then(reload).then(onClose) })}>Salvar</button>
    </>}>
      <label className="field">Item<input value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} /></label>
      <label className="field">Grupo<select value={cat} onChange={(e) => setCat(e.target.value)}>{b.packingCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      {it.suggestion_reason ? <AiNote by={it.suggested_by ?? 'rules'}>{it.suggestion_reason}</AiNote> : null}
    </Dialog>
  );
}

// ───────────────────── Pendências ─────────────────────
const STATUS_LABEL: Record<TaskStatus, string> = { todo: 'A fazer', doing: 'Fazendo', done: 'Feito' };

function Tasks() {
  const { bundle: b, canEdit, source, reload, profileOf, identity } = useBundle();
  const { run } = useAction();
  const [edit, setEdit] = useState<Task | 'new' | null>(null);
  const cols = colorCycle(identity);
  const today = todayIn(b.trip.departure_tz);
  const tasks = [...b.tasks].filter((t) => !t.dismissed).sort((a, c) => Number(a.status === 'done') - Number(c.status === 'done') || (a.due_date ?? '9').localeCompare(c.due_date ?? '9'));
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 28 }}>
        <h2 className="disp rv" style={{ margin: 0, fontSize: 30 }}>Pendências</h2>
        {canEdit ? <button className="btn btn-sm tap" onClick={() => setEdit('new')}><Icon name="plus" size={16} />Pendência</button> : null}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {tasks.map((t, i) => {
          const who = profileOf(t.assignee_id);
          const late = t.status !== 'done' && t.due_date && t.due_date < today;
          return (
            <li key={t.id} className={`${s.task} rv lift`} data-done={t.status === 'done'}>
              <span aria-hidden="true" className="bullet" style={{ width: 14, height: 14, background: cols[i % 4] }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ display: 'block', fontWeight: 600, textDecoration: t.status === 'done' ? 'line-through' : undefined }}>{t.title}</b>
                <span style={{ fontSize: 14, color: 'var(--mute)' }}>
                  {[t.detail, who ? `com ${who.display_name}` : null, t.due_date ? `${late ? 'atrasada · ' : 'até '}${dayMonth(t.due_date)}` : null].filter(Boolean).join(' · ')}
                </span>
              </span>
              {t.source !== 'user' ? <AiTag by={t.source} /> : null}
              {who ? <span className="av" style={{ background: who.color, color: fgOn(who.color) }} title={who.display_name}>{initials(who.display_name)}</span> : null}
              {canEdit ? (
                <select aria-label={`Estado de ${t.title}`} value={t.status} className={s.status} onChange={(e) => void run(() => source.update('tasks', t.id, { status: e.target.value }).then(reload))}>
                  {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              ) : <span className="pill">{STATUS_LABEL[t.status].toUpperCase()}</span>}
              {canEdit ? <button className="btn btn-icon btn-sm" style={{ border: 0, background: 'transparent' }} aria-label={`Editar ${t.title}`} onClick={() => setEdit(t)}><Icon name="edit" size={16} /></button> : null}
            </li>
          );
        })}
        {!tasks.length ? <li className="muted">Nenhuma pendência. As da turma aparecem aqui com responsável e prazo.</li> : null}
      </ul>
      {edit ? <TaskDialog t={edit === 'new' ? null : edit} onClose={() => setEdit(null)} /> : null}
    </>
  );
}

function TaskDialog({ t, onClose }: { t: Task | null; onClose: () => void }) {
  const { bundle: b, source, reload, profileOf } = useBundle();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const [v, setV] = useState({ title: t?.title ?? '', detail: t?.detail ?? '', assignee_id: t?.assignee_id ?? '', due_date: t?.due_date ?? '', link: t?.link ?? 'roteiro', status: t?.status ?? 'todo' });
  const row = () => ({ title: v.title.trim(), detail: v.detail.trim() || null, assignee_id: v.assignee_id || null, due_date: v.due_date || null, link: v.link, status: v.status });
  const save = () => run(async () => {
    if (t) await source.update('tasks', t.id, row(), t.version);
    else await source.insert('tasks', { ...row(), trip_id: b.trip.id });
    await reload();
    onClose();
  }, { success: 'Pendência salva.', onConflict: async () => { if (t) await source.update('tasks', t.id, row()); await reload(); onClose(); } });
  return (
    <Dialog open onClose={onClose} title={t ? 'Editar pendência' : 'Nova pendência'} footer={<>
      {t ? <button className="btn btn-danger tap" onClick={async () => { if (await confirm({ title: 'Excluir pendência?', message: t.title })) await run(() => source.remove('tasks', { id: t.id }).then(reload).then(onClose)); }}>Excluir</button> : null}
      <button className="btn tap" onClick={onClose}>Cancelar</button>
      <button className="btn btn-primary tap" disabled={busy || !v.title.trim()} onClick={save}>Salvar</button>
    </>}>
      {t && t.source !== 'user' ? <AiNote by={t.source}>Pendência criada automaticamente. Edite ou exclua à vontade.</AiNote> : null}
      <label className="field">O que fazer<input value={v.title} maxLength={160} onChange={(e) => setV({ ...v, title: e.target.value })} /></label>
      <label className="field">Detalhe<input value={v.detail} maxLength={300} onChange={(e) => setV({ ...v, detail: e.target.value })} /></label>
      <div className="grid2">
        <label className="field">Responsável<select value={v.assignee_id} onChange={(e) => setV({ ...v, assignee_id: e.target.value })}><option value="">Ninguém</option>{b.members.map((m) => <option key={m.user_id} value={m.user_id}>{profileOf(m.user_id)?.display_name ?? 'Pessoa'}</option>)}</select></label>
        <label className="field">Prazo<input type="date" value={v.due_date} onChange={(e) => setV({ ...v, due_date: e.target.value })} /></label>
        <label className="field">Estado<select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as TaskStatus })}>{Object.entries(STATUS_LABEL).map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select></label>
        <label className="field">Área<select value={v.link} onChange={(e) => setV({ ...v, link: e.target.value as Task['link'] })}><option value="roteiro">Roteiro</option><option value="documentos">Documentos</option><option value="mala">Mala e gastos</option><option value="turma">Turma</option></select></label>
      </div>
    </Dialog>
  );
}

// ───────────────────── Orçamento ─────────────────────
function Budget({ cols }: { cols: string[] }) {
  const { bundle: b, canEdit } = useBundle();
  const [edit, setEdit] = useState(false);
  const cur = b.trip.base_currency;
  const spent = b.expenses.reduce((a, e) => a + toCents(String(e.base_amount)), 0);
  const planned = b.trip.budget_total != null ? toCents(String(b.trip.budget_total)) : 0;
  const cats = budgetByCategory(b.budgetCategories, b.expenses);
  const over = cats.filter((c) => c.overPct);
  const per = Math.round(spent / Math.max(1, b.members.length));
  return (
    <article className="card rv" style={{ padding: 30, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
        <div>
          <div className="eyebrow">Orçamento</div>
          <div className="disp" style={{ fontSize: 'clamp(48px,5vw,72px)', lineHeight: 1 }}>{formatMoney(spent, cur, { compact: true })}</div>
          <div style={{ color: 'var(--mute)', marginTop: 6 }}>
            {planned ? <>de {formatMoney(planned, cur, { compact: true })} previstos · {spent <= planned ? `faltam ${formatMoney(planned - spent, cur, { compact: true })}` : `${formatMoney(spent - planned, cur, { compact: true })} acima`}</> : 'Sem orçamento total definido'}
          </div>
        </div>
        <div className={s.sticker}>
          <span className="disp" style={{ fontSize: 18, letterSpacing: 0 }}>{formatMoney(per, cur, { compact: true })}</span>
          <span className="mono" style={{ fontSize: 9, letterSpacing: '.12em' }}>POR PESSOA</span>
        </div>
      </div>
      {cats.length ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {cats.map((c, i) => (
            <li key={c.id ?? 'none'} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontWeight: 600 }}>
                <span>{c.name}</span>
                <span className="mono" style={{ fontSize: 13, fontWeight: 400 }}>{formatMoney(c.spentCents, cur, { compact: true })}{c.plannedCents ? ` / ${formatMoney(c.plannedCents, cur, { compact: true })}` : ''}</span>
              </div>
              <div className="bar"><i className="gw" style={{ width: `${c.plannedCents ? Math.min(100, Math.round((c.spentCents / c.plannedCents) * 100)) : 100}%`, background: cols[i % 4] }} /></div>
              {c.overPct ? <span className="mono" style={{ fontSize: 11, letterSpacing: '.1em' }}>{c.overPct}% ACIMA DO PREVISTO</span> : null}
            </li>
          ))}
        </ul>
      ) : <p className="muted" style={{ margin: 0 }}>Crie categorias de orçamento para acompanhar os desvios.</p>}
      {over.length ? <AiNote by="rules">{over.map((c) => c.name).join(' e ')} {over.length > 1 ? 'passaram' : 'passou'} do previsto. Ainda dá pra ajustar nas próximas reservas.</AiNote> : null}
      {canEdit ? <button className="btn btn-sm tap" style={{ alignSelf: 'flex-start' }} onClick={() => setEdit(true)}><Icon name="edit" size={16} />Ajustar orçamento</button> : null}
      {edit ? <BudgetDialog onClose={() => setEdit(false)} cols={cols} /> : null}
    </article>
  );
}

function BudgetDialog({ onClose, cols }: { onClose: () => void; cols: string[] }) {
  const { bundle: b, source, reload } = useBundle();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const [total, setTotal] = useState(b.trip.budget_total != null ? String(b.trip.budget_total) : '');
  const [cats, setCats] = useState(b.budgetCategories.map((c) => ({ ...c, planned: String(c.planned) })));
  const [newName, setNewName] = useState('');
  const save = () => run(async () => {
    const t = total.trim() ? toCents(total) : null;
    if (t != null && (isNaN(t) || t < 0)) throw new Error('Valor total inválido.');
    await source.update('trips', b.trip.id, { budget_total: t == null ? null : centsToDecimal(t) });
    for (const c of cats) {
      const orig = b.budgetCategories.find((x) => x.id === c.id) as BudgetCategory;
      const p = toCents(c.planned || '0');
      if (isNaN(p) || p < 0) throw new Error(`Valor inválido em ${c.name}.`);
      if (c.name !== orig.name || p !== toCents(String(orig.planned))) await source.update('budget_categories', c.id, { name: c.name.trim(), planned: centsToDecimal(p) });
    }
    await reload();
    onClose();
  }, { success: 'Orçamento atualizado.' });
  const addCat = () => run(async () => {
    if (!newName.trim()) return;
    await source.insert('budget_categories', { trip_id: b.trip.id, name: newName.trim(), planned: 0, color: '#000000', position: cats.length });
    setNewName('');
    await reload();
    onClose();
  });
  return (
    <Dialog open onClose={onClose} title="Orçamento" footer={<><button className="btn tap" onClick={onClose}>Cancelar</button><button className="btn btn-primary tap" onClick={save} disabled={busy}>Salvar</button></>}>
      <label className="field">Total previsto ({b.trip.base_currency})<input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="9.500,00" /></label>
      {cats.map((c, i) => (
        <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <span aria-hidden="true" className="bullet" style={{ background: cols[i % 4], marginBottom: 18 }} />
          <label className="field" style={{ flex: 2 }}>Categoria<input value={c.name} maxLength={40} onChange={(e) => setCats(cats.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)))} /></label>
          <label className="field" style={{ flex: 1 }}>Previsto<input inputMode="decimal" value={c.planned} onChange={(e) => setCats(cats.map((x) => (x.id === c.id ? { ...x, planned: e.target.value } : x)))} /></label>
          <button className="btn btn-icon btn-sm" aria-label={`Excluir ${c.name}`} onClick={async () => { if (await confirm({ title: `Excluir ${c.name}?`, message: 'Os gastos dessa categoria ficam como “Sem categoria”.' })) await run(() => source.remove('budget_categories', { id: c.id }).then(reload).then(onClose)); }}>✕</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8 }}>
        <label className="field" style={{ flex: 1 }}><span className="sr">Nova categoria</span><input value={newName} maxLength={40} onChange={(e) => setNewName(e.target.value)} placeholder="Nova categoria (ex.: Comida)" /></label>
        <button className="btn tap" onClick={addCat}>Criar</button>
      </div>
    </Dialog>
  );
}

function StopSpend({ cols }: { cols: string[] }) {
  const { bundle: b } = useBundle();
  const stops = sortedStops(b);
  const by = stops.map((st) => b.expenses.filter((e) => e.stop_id === st.id).reduce((a, e) => a + toCents(String(e.base_amount)), 0));
  const max = Math.max(1, ...by);
  if (!stops.length) return null;
  return (
    <article className="card rv" style={{ padding: 30 }}>
      <h2 className="disp" style={{ margin: '0 0 20px', fontSize: 26 }}>Gasto por parada</h2>
      <div className={s.cols} role="img" aria-label={stops.map((st, i) => `${st.name}: ${formatMoney(by[i], b.trip.base_currency, { compact: true })}`).join('; ')}>
        {stops.map((st, i) => (
          <div key={st.id} title={`${st.name}: ${formatMoney(by[i], b.trip.base_currency, { compact: true })}`}>
            <i className="gy" style={{ height: `${by[i] ? Math.round(8 + (92 * by[i]) / max) : 2}%`, background: cols[i % 4] }} />
            <span className="mono" style={{ fontSize: 11 }}>{stopCode(st)}</span>
          </div>
        ))}
      </div>
      {!by.some(Boolean) ? <p className="muted" style={{ margin: '12px 0 0' }}>Nenhum gasto ligado a paradas ainda.</p> : null}
    </article>
  );
}

function Converter() {
  const { bundle: b } = useBundle();
  const base = b.trip.base_currency;
  const { fx, err } = useFx(base);
  const [amt, setAmt] = useState('500');
  const codes = useMemo(() => {
    const set = new Set<string>();
    for (const st of b.stops) {
      const c = currencyForCountry(st.country);
      if (c && c !== base) set.add(c);
    }
    for (const e of b.expenses) if (e.currency !== base) set.add(e.currency);
    if (!set.size) set.add('USD');
    return [...set].slice(0, 5);
  }, [b.stops, b.expenses, base]);
  const value = Number(amt.replace(',', '.')) || 0;
  return (
    <article className="rv lift" style={{ padding: 26, borderRadius: 30, background: 'var(--deep)', color: 'var(--on-deep)', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h2 className="disp" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10, fontSize: 22 }}><Icon name="swap" size={22} />Conversor</h2>
      <label className="field" style={{ color: 'inherit' }}>Valor em {base === 'BRL' ? 'reais' : base}
        <input type="number" min={0} inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} style={{ minHeight: 52, border: 0, color: '#141414', background: '#fff', fontSize: 22, fontWeight: 600 }} />
      </label>
      {codes.map((c) => {
        const r = fx?.rates[c];
        return (
          <div key={c} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '12px 14px', borderRadius: 14, background: 'rgba(255,255,255,.1)' }}>
            <span className="mono">{c}</span>
            <span className="disp" style={{ fontSize: 22, letterSpacing: 0 }}>{r ? `${currencySymbol(c)} ${(value * r).toLocaleString('pt-BR', { minimumFractionDigits: r > 5 ? 0 : 2, maximumFractionDigits: r > 5 ? 0 : 2 })}` : '—'}</span>
          </div>
        );
      })}
      <span className="mono" style={{ fontSize: 10, letterSpacing: '.12em', opacity: 0.8 }}>
        {fx ? `COTAÇÃO ${fx.source.toUpperCase()} · ${fx.date.split('-').reverse().join('/')}` : err ? 'COTAÇÃO INDISPONÍVEL AGORA · AO REGISTRAR UM GASTO, USE TAXA MANUAL' : 'BUSCANDO COTAÇÃO…'}
        {fx && !navigator.onLine ? ' · ÚLTIMA SALVA NESTE APARELHO' : ''}
      </span>
    </article>
  );
}

function Debts({ cols }: { cols: string[] }) {
  const { bundle: b, canEdit, source, reload, profileOf } = useBundle();
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const people = b.members.map((m) => m.user_id);
  const exp = b.expenses.map((e) => ({ payer_id: e.payer_id, base_amount: e.base_amount, shares: b.expenseShares.filter((s2) => s2.expense_id === e.id) }));
  const transfers = suggestTransfers(balances(exp, b.settlements, people));
  const colorOf = (uid: string) => cols[Math.max(0, people.indexOf(uid)) % 3];
  const av = (uid: string) => {
    const p = profileOf(uid);
    const c = colorOf(uid);
    return <span className="av" style={{ background: c, color: fgOn(c) }} title={p?.display_name}>{initials(p?.display_name ?? '?')}</span>;
  };
  return (
    <article className="card rv lift" style={{ padding: 26, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 className="disp" style={{ margin: 0, fontSize: 22 }}>Acerto de contas</h2>
      {people.length < 2 ? (
        <p style={{ margin: 0, color: 'var(--mute)' }}>Viajando sozinho por enquanto. Convide alguém pra dividir os gastos.</p>
      ) : transfers.length ? (
        transfers.map((t) => (
          <div key={t.from + t.to} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderRadius: 16, background: 'var(--bg)', flexWrap: 'wrap' }} title={`${profileOf(t.from)?.display_name} deve pra ${profileOf(t.to)?.display_name}`}>
            {av(t.from)}<Icon name="arrow" size={18} />{av(t.to)}
            <span className="disp" style={{ marginLeft: 'auto', fontSize: 20, letterSpacing: 0 }}>{formatMoney(t.cents, b.trip.base_currency, { compact: true })}</span>
            {canEdit ? <button className="btn btn-sm tap" disabled={busy} onClick={() => void run(() => source.insert('settlements', { trip_id: b.trip.id, from_user: t.from, to_user: t.to, amount_cents: t.cents }, { returning: false }).then(reload), { success: 'Pagamento registrado.' })}>Pago</button> : null}
          </div>
        ))
      ) : (
        <p style={{ margin: 0, color: 'var(--mute)' }}>Tudo acertado. Ninguém deve nada.</p>
      )}
      {b.settlements.length ? (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 14 }}>Pagamentos registrados ({b.settlements.length})</summary>
          <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
            {b.settlements.map((x) => (
              <li key={x.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ flex: 1 }}>{profileOf(x.from_user)?.display_name} → {profileOf(x.to_user)?.display_name} · {formatMoney(x.amount_cents, b.trip.base_currency)} · {dayMonth(x.paid_on)}</span>
                {canEdit ? <button className="btn btn-icon btn-sm" aria-label="Desfazer pagamento" onClick={() => void run(() => source.remove('settlements', { id: x.id }).then(reload))}>✕</button> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {canEdit ? <button className="btn btn-ink tap" style={{ justifyContent: 'center' }} onClick={() => setOpen(true)}>Registrar gasto</button> : null}
      {open ? <ExpenseDialog e={null} onClose={() => setOpen(false)} /> : null}
    </article>
  );
}

function ExpenseList() {
  const { bundle: b, canEdit, profileOf } = useBundle();
  const [edit, setEdit] = useState<Expense | null>(null);
  if (!b.expenses.length) return null;
  return (
    <article className="card rv" style={{ padding: 26 }}>
      <h2 className="disp" style={{ margin: '0 0 14px', fontSize: 22 }}>Gastos registrados</h2>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {b.expenses.map((e) => (
          <li key={e.id} className={s.exp}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b>{e.description}</b>
              <span style={{ display: 'block', fontSize: 13, color: 'var(--mute)' }}>
                {dayMonth(e.spent_on)} · pagou {profileOf(e.payer_id)?.display_name ?? '—'}{e.currency !== b.trip.base_currency ? ` · ${formatMoney(toCents(String(e.amount)), e.currency)} a ${Number(e.rate_to_base).toLocaleString('pt-BR', { maximumFractionDigits: 6 })}${e.rate_is_manual ? ' (taxa manual)' : ` (${e.rate_source}, ${dayMonth(e.rate_date)})`}` : ''}
              </span>
            </span>
            <span className="mono">{formatMoney(toCents(String(e.base_amount)), b.trip.base_currency)}</span>
            {canEdit ? <button className="btn btn-icon btn-sm" aria-label={`Editar ${e.description}`} onClick={() => setEdit(e)}><Icon name="edit" size={16} /></button> : null}
          </li>
        ))}
      </ul>
      {edit ? <ExpenseDialog e={edit} onClose={() => setEdit(null)} /> : null}
    </article>
  );
}

function ExpenseDialog({ e, onClose }: { e: Expense | null; onClose: () => void }) {
  const { bundle: b, source, reload, me, profileOf } = useBundle();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const base = b.trip.base_currency;
  const { fx } = useFx(base);
  const stops = sortedStops(b);
  const shareIds = e ? b.expenseShares.filter((x) => x.expense_id === e.id).map((x) => x.user_id) : b.members.map((m) => m.user_id);
  const [v, setV] = useState({
    description: e?.description ?? '', amount: e ? String(e.amount) : '', currency: e?.currency ?? base, manual: e?.rate_is_manual ?? false, rate: e ? String(e.rate_to_base) : '',
    spent_on: e?.spent_on ?? todayIn(b.trip.departure_tz), category_id: e?.category_id ?? '', stop_id: e?.stop_id ?? '', payer_id: e?.payer_id ?? me, split: shareIds,
  });
  const amountCents = toCents(v.amount || '0');
  const autoRate = v.currency === base ? 1 : fx?.rates[v.currency] ? 1 / fx.rates[v.currency] : null;
  // Na edição, mantém a taxa gravada a menos que a pessoa troque moeda/valor manualmente.
  const keepOld = e && e.currency === v.currency && !v.manual;
  const rate = v.manual ? Number(v.rate.replace(',', '.')) : keepOld ? Number(e.rate_to_base) : autoRate;
  const baseCents = rate ? convertCents(amountCents, rate) : NaN;
  const shares = splitEqual(baseCents, v.split);
  const valid = v.description.trim() && amountCents > 0 && rate && rate > 0 && Number.isFinite(baseCents) && baseCents > 0 && v.split.length > 0;
  const rateSource = v.currency === base ? 'Mesma moeda' : v.manual ? 'Taxa manual' : keepOld ? e!.rate_source : fx?.source ?? '';
  const rateDate = v.currency === base ? v.spent_on : v.manual ? todayIn(b.trip.departure_tz) : keepOld ? e!.rate_date : fx?.date ?? todayIn(b.trip.departure_tz);

  const save = () => run(async () => {
    await source.rpc('save_expense', {
      p_expense: {
        id: e?.id ?? '', version: e?.version ?? '', trip_id: b.trip.id, description: v.description.trim(), category_id: v.category_id, stop_id: v.stop_id, payer_id: v.payer_id,
        amount: centsToDecimal(amountCents), currency: v.currency, rate_to_base: Number(rate!.toFixed(8)), rate_source: rateSource, rate_date: rateDate,
        rate_is_manual: v.manual, base_amount: centsToDecimal(baseCents), spent_on: v.spent_on,
      },
      p_shares: shares,
    });
    await reload();
    onClose();
  }, { success: 'Gasto salvo.' });

  const codes = useMemo(() => Array.from(new Set([base, ...b.stops.map((x) => currencyForCountry(x.country)).filter(Boolean) as string[], 'USD', 'EUR'])), [b.stops, base]);
  return (
    <Dialog open onClose={onClose} title={e ? 'Editar gasto' : 'Registrar gasto'} footer={<>
      {e ? <button className="btn btn-danger tap" onClick={async () => { if (await confirm({ title: 'Excluir gasto?', message: `${e.description} sai das contas e do rateio.` })) await run(() => source.remove('expenses', { id: e.id }).then(reload).then(onClose)); }}>Excluir</button> : null}
      <button className="btn tap" onClick={onClose}>Cancelar</button>
      <button className="btn btn-primary tap" disabled={!valid || busy} onClick={save}>Salvar</button>
    </>}>
      <label className="field">Descrição<input value={v.description} maxLength={120} onChange={(x) => setV({ ...v, description: x.target.value })} placeholder="Jantar em Cusco" /></label>
      <div className="grid2">
        <label className="field">Valor<input inputMode="decimal" value={v.amount} onChange={(x) => setV({ ...v, amount: x.target.value })} placeholder="0,00" /></label>
        <label className="field">Moeda<select value={v.currency} onChange={(x) => setV({ ...v, currency: x.target.value, manual: false })}>{codes.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <label className="field">Data<input type="date" value={v.spent_on} onChange={(x) => setV({ ...v, spent_on: x.target.value })} /></label>
        <label className="field">Categoria<select value={v.category_id} onChange={(x) => setV({ ...v, category_id: x.target.value })}><option value="">Sem categoria</option>{b.budgetCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="field">Parada<select value={v.stop_id} onChange={(x) => setV({ ...v, stop_id: x.target.value })}><option value="">Nenhuma</option>{stops.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label className="field">Quem pagou<select value={v.payer_id} onChange={(x) => setV({ ...v, payer_id: x.target.value })}>{b.members.map((m) => <option key={m.user_id} value={m.user_id}>{profileOf(m.user_id)?.display_name ?? 'Pessoa'}</option>)}</select></label>
      </div>
      {v.currency !== base ? (
        <div className="errbox" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          {autoRate && !v.manual ? (
            <span className="mono" style={{ fontSize: 12 }}>1 {v.currency} = {(keepOld ? Number(e!.rate_to_base) : autoRate).toLocaleString('pt-BR', { maximumFractionDigits: 6 })} {base} · {rateSource.toUpperCase()} · {rateDate.split('-').reverse().join('/')}</span>
          ) : !v.manual ? <span>Cotação indisponível agora: informe uma taxa manual.</span> : null}
          <label className="check" style={{ minHeight: 36 }}><input type="checkbox" checked={v.manual} onChange={(x) => setV({ ...v, manual: x.target.checked })} /><span className="box" aria-hidden="true" /><span>Usar taxa manual</span></label>
          {v.manual ? <label className="field">1 {v.currency} vale quantos {base}?<input inputMode="decimal" value={v.rate} onChange={(x) => setV({ ...v, rate: x.target.value })} placeholder="1,49" /></label> : null}
          <span className="mono" style={{ fontSize: 12 }}>A taxa fica gravada neste gasto; cotações futuras não mudam o histórico.</span>
        </div>
      ) : null}
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="h3">Dividir com</legend>
        {b.members.map((m) => (
          <label key={m.user_id} className="check" style={{ minHeight: 40 }}>
            <input type="checkbox" checked={v.split.includes(m.user_id)} onChange={(x) => setV({ ...v, split: x.target.checked ? [...v.split, m.user_id] : v.split.filter((u) => u !== m.user_id) })} />
            <span className="box" aria-hidden="true" />
            <span style={{ flex: 1 }}>{profileOf(m.user_id)?.display_name ?? 'Pessoa'}</span>
            <span className="mono" style={{ fontSize: 12 }}>{Number.isFinite(baseCents) ? formatMoney(shares.find((x) => x.user_id === m.user_id)?.share_cents ?? 0, base) : ''}</span>
          </label>
        ))}
      </fieldset>
      {Number.isFinite(baseCents) && baseCents > 0 ? <span className="mono" style={{ fontSize: 12 }}>TOTAL {formatMoney(baseCents, base)} · CENTAVOS QUE SOBRAM VÃO PARA OS PRIMEIROS DA LISTA</span> : null}
    </Dialog>
  );
}
