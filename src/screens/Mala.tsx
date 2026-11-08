'use client';
import { useState } from 'react';
import { Dialog, useAction, useConfirm, useToast } from '../components/ui/feedback';
import { AiNote, AiTag, Icon, useReveal } from '../components/ui/primitives';
import { Checkbox } from '../components/ui/Checkbox';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { useBundle } from '../data/TripContext';
import type { PackingItem, Task, TaskStatus } from '../data/types';
import { callAi } from '../lib/ai/client';
import { packingProgress } from '../lib/derive';
import { dayMonth, initials } from '../lib/format';
import { fgOn } from '../lib/identity/contrast';
import { CYCLE } from '../lib/identity/accent';
import { rulePacking, type PackingSuggestion } from '../lib/rules';
import { todayIn } from '../lib/time';
import s from './mala.module.css';

/**
 * Mala e pendências (/turma/mala), aguardando o redesign da Fase 7.
 * A Fase 6 moveu todo o dinheiro para as telas próprias e components/money.
 */
export default function Mala() {
  const { bundle: b, base } = useBundle();
  const pack = packingProgress(b);
  const C = 2 * Math.PI * 48;
  useReveal([b.packingItems.length]);

  return (
    <div className="wrap">
      <ScreenHeader back={`${base}/turma`} title="Mala e pendências" subtitle="O que falta levar e o que falta fazer, com a turma." />
      <section className={s.body}>
        <div className={s.left}>
          <div className={`${s.ring} rv`}>
            <svg aria-hidden="true" className={s.ringSvg} width="120" height="120" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="48" fill="none" stroke="currentColor" strokeOpacity=".18" strokeWidth="14" />
              <circle className={s.v} cx="60" cy="60" r="48" fill="none" stroke="var(--sun)" strokeWidth="14" strokeLinecap="round" strokeDasharray={`${((C * pack.pct) / 100).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(-90 60 60)" />
              <text x="60" y="68" textAnchor="middle" fontFamily="var(--font-body)" fontSize="22" fontWeight="700" fill="currentColor">{pack.pct}%</text>
            </svg>
            <div style={{ position: 'relative' }}>
              <div className={`disp ${s.count}`}>{pack.done} de {pack.total}</div>
              <div style={{ marginTop: 6, opacity: 0.85 }}>itens na mochila</div>
            </div>
          </div>
          <Packing />
          <Tasks />
        </div>
      </section>
    </div>
  );
}

// ───────────────────── Mala ─────────────────────
export function Packing() {
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
                <Checkbox strike checked={it.done} disabled={!canEdit || busy} onChange={(v) => void toggle(it, v)} label={it.label}>
                  {it.suggested_by ? <span title={it.suggestion_reason ?? undefined}><AiTag by={it.suggested_by} /></span> : null}
                </Checkbox>
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

export function Tasks() {
  const { bundle: b, canEdit, source, reload, profileOf } = useBundle();
  const { run } = useAction();
  const [edit, setEdit] = useState<Task | 'new' | null>(null);
  const cols = CYCLE;
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
              <span className={s.taskText}>
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

