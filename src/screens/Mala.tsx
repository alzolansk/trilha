'use client';
import { useState } from 'react';
import { Dialog, useAction, useConfirm, useToast } from '../components/ui/feedback';
import { AiNote, AiTag } from '../components/ui/primitives';
import { Avatar, Badge, Button, Card, Checkbox, EmptyState, Field, FieldGrid, IconButton, ScreenHeader } from '../components/ui';
import { useBundle } from '../data/TripContext';
import type { PackingItem, Task, TaskStatus } from '../data/types';
import { callAi } from '../lib/ai/client';
import { packingProgress } from '../lib/derive';
import { dayMonth } from '../lib/format';
import { fgOn } from '../lib/identity/contrast';
import { rulePacking, type PackingSuggestion } from '../lib/rules';
import { todayIn } from '../lib/time';
import s from './mala.module.css';

/** Mala e pendências (/turma/mala), com os componentes de ui (Fase 9). O dinheiro vive nas telas próprias. */
export default function Mala() {
  const { bundle: b, base } = useBundle();
  const pack = packingProgress(b);
  const C = 2 * Math.PI * 48;

  return (
    <div className="wrap">
      <ScreenHeader back={`${base}/turma`} title="Mala e pendências" subtitle="O que falta levar e o que falta fazer, com a turma." />
      <section className={s.body}>
        <div className={s.left}>
          <Card variant="dark" pad="lg" className={s.ring}>
            <svg aria-hidden="true" className={s.ringSvg} width="120" height="120" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="48" fill="none" stroke="currentColor" strokeOpacity=".18" strokeWidth="14" />
              <circle className={s.v} cx="60" cy="60" r="48" fill="none" stroke="var(--sun)" strokeWidth="14" strokeLinecap="round" strokeDasharray={`${((C * pack.pct) / 100).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(-90 60 60)" />
              <text x="60" y="68" textAnchor="middle" fontFamily="var(--font-body)" fontSize="22" fontWeight="700" fill="currentColor">{pack.pct}%</text>
            </svg>
            <div style={{ position: 'relative' }}>
              <div className={s.count}>{pack.done} de {pack.total}</div>
              <div className={s.countSub}>itens na mochila</div>
            </div>
          </Card>
          <Packing />
          <Tasks />
        </div>
      </section>
    </div>
  );
}

// ───────────────────── Mala ─────────────────────
export function Packing() {
  const { bundle: b, canEdit, source, reload, me, profileOf } = useBundle();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const toast = useToast();
  const [item, setItem] = useState('');
  const [group, setGroup] = useState('');
  const [who, setWho] = useState('');
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
      await source.insert('packing_items', { trip_id: b.trip.id, category_id: catId, label, assignee_id: who || null, position: b.packingItems.filter((x) => x.category_id === catId).length });
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
      <div>
        {hasAiItems || b.packingItems.some((i) => i.suggested_by === 'rules') ? (
          <AiNote by={hasAiItems ? 'ai' : 'rules'}>Itens com etiqueta {hasAiItems ? 'IA' : 'AUTO'} foram sugeridos a partir das paradas, atividades e transportes da sua trilha. Toque no item pra ver o motivo.</AiNote>
        ) : null}
      </div>
      {!b.packingItems.length ? (
        <EmptyState icon="list" title="Mala vazia" text="Adicione itens ou peça sugestões com base no roteiro." />
      ) : null}
      {canEdit ? (
        <Button variant="ghost" icon="sparkle" onClick={ask} disabled={asking} className={s.askBtn}>{asking ? 'Pensando…' : 'Pedir sugestões à IA'}</Button>
      ) : null}
      {sugs?.list.length ? (
        <div className={s.sugs}>
          {sugs.list.map((sg) => (
            <div key={sg.label} className={s.sug}>
              <div className={s.sugText}>
                <b>{sg.label}</b> <AiTag by={sg.by} />
                <div className={s.sugWhy}>{sg.reason}</div>
              </div>
              <Button size="sm" variant="dark" onClick={() => void accept(sg)} disabled={busy}>Adicionar</Button>
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => setSugs(null)} className={s.askBtn}>Dispensar sugestões</Button>
        </div>
      ) : null}
      {cats.map((c) => {
        const items = b.packingItems.filter((i) => i.category_id === c.id).sort((a, x) => a.position - x.position);
        return (
          <fieldset key={c.id} className={s.group}>
            <legend>{c.name}</legend>
            {items.map((it) => (
              <div key={it.id} className={s.itemRow}>
                <Checkbox strike checked={it.done} disabled={!canEdit || busy} onChange={(v) => void toggle(it, v)} label={it.label}>
                  {it.suggested_by ? <span title={it.suggestion_reason ?? undefined}><AiTag by={it.suggested_by} /></span> : null}
                  <WhoChip uid={it.assignee_id ?? null} />
                </Checkbox>
                {canEdit ? <IconButton icon="edit" label={`Editar ${it.label}`} variant="ghost" size={40} onClick={() => setEditing(it)} /> : null}
              </div>
            ))}
            {!items.length ? <p className={s.none}>Sem itens.</p> : null}
            {canEdit ? (
              <button className={s.linkBtn} onClick={async () => {
                if (await confirm({ title: `Excluir “${c.name}”?`, message: `Os ${items.length} itens desse grupo também saem da mala.` })) await run(() => source.remove('packing_categories', { id: c.id }).then(reload));
              }}>Excluir grupo</button>
            ) : null}
          </fieldset>
        );
      })}
      {canEdit ? (
        <form onSubmit={add} className={s.addForm}>
          <Field label={<span className="sr">Novo item</span>} className={s.grow}>
            <input value={item} maxLength={120} onChange={(e) => setItem(e.target.value)} placeholder="Adicionar item à mala" required />
          </Field>
          <Field label={<span className="sr">Grupo</span>} className={s.sel}>
            <select value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">Seus itens</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label={<span className="sr">Quem leva</span>} className={s.sel}>
            <select aria-label="Quem leva" value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">Todos</option>
              {b.members.map((m) => <option key={m.user_id} value={m.user_id}>{profileOf(m.user_id)?.display_name ?? 'Pessoa'}</option>)}
            </select>
          </Field>
          <Button variant="dark" icon="plus" aria-label="Adicionar item" type="submit" disabled={busy} />
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
    <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) void run(() => source.insert('packing_categories', { trip_id: b.trip.id, name: name.trim(), position: count }).then(reload).then(() => setName(''))); }} className={s.addForm}>
      <Field label={<span className="sr">Novo grupo</span>} className={s.grow}>
        <input id="newgroup" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Novo grupo (ex.: Eletrônicos)" />
      </Field>
      <Button variant="secondary" type="submit">Criar grupo</Button>
    </form>
  );
}

function ItemDialog({ it, onClose }: { it: PackingItem; onClose: () => void }) {
  const { bundle: b, source, reload } = useBundle();
  const { run, busy } = useAction();
  const [label, setLabel] = useState(it.label);
  const [cat, setCat] = useState(it.category_id);
  const [who, setWho] = useState(it.assignee_id ?? '');
  const { profileOf } = useBundle();
  const patch = () => ({ label: label.trim(), category_id: cat, assignee_id: who || null });
  return (
    <Dialog open onClose={onClose} title="Editar item" footer={<>
      <Button variant="secondary" className={s.danger} onClick={() => void run(() => source.remove('packing_items', { id: it.id }).then(reload).then(onClose), { success: 'Item removido.' })}>Excluir</Button>
      <Button disabled={busy || !label.trim()} onClick={() => void run(() => source.update('packing_items', it.id, patch(), it.version).then(reload).then(onClose), { onConflict: () => source.update('packing_items', it.id, patch()).then(reload).then(onClose) })}>Salvar</Button>
    </>}>
      <Field label="Item"><input value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} /></Field>
      <Field label="Grupo"><select value={cat} onChange={(e) => setCat(e.target.value)}>{b.packingCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="Quem leva"><select value={who} onChange={(e) => setWho(e.target.value)}><option value="">Todos</option>{b.members.map((m) => <option key={m.user_id} value={m.user_id}>{profileOf(m.user_id)?.display_name ?? 'Pessoa'}</option>)}</select></Field>
      {it.suggestion_reason ? <AiNote by={it.suggested_by ?? 'rules'}>{it.suggestion_reason}</AiNote> : null}
    </Dialog>
  );
}

/** "Quem leva": chip na cor da pessoa; "todos" quando é item individual. */
function WhoChip({ uid }: { uid: string | null }) {
  const { profileOf } = useBundle();
  const p = uid ? profileOf(uid) : null;
  return <span className={s.who} data-all={!p} style={p?.color ? { background: p.color, color: fgOn(p.color) } : undefined}>{p ? p.display_name.split(' ')[0] : 'todos'}</span>;
}

// ───────────────────── Pendências ─────────────────────
const STATUS_LABEL: Record<TaskStatus, string> = { todo: 'A fazer', doing: 'Fazendo', done: 'Feito' };

export function Tasks() {
  const { bundle: b, canEdit, source, reload, profileOf } = useBundle();
  const { run } = useAction();
  const [edit, setEdit] = useState<Task | 'new' | null>(null);
  const today = todayIn(b.trip.departure_tz);
  const tasks = [...b.tasks].filter((t) => !t.dismissed).sort((a, c) => Number(a.status === 'done') - Number(c.status === 'done') || (a.due_date ?? '9').localeCompare(c.due_date ?? '9'));
  return (
    <>
      <div className={s.taskHead}>
        <h2 className={s.h2}>Pendências</h2>
        {canEdit ? <Button size="sm" variant="secondary" icon="plus" onClick={() => setEdit('new')}>Pendência</Button> : null}
      </div>
      <ul className={s.tasks}>
        {tasks.map((t) => {
          const who = profileOf(t.assignee_id);
          const late = t.status !== 'done' && t.due_date && t.due_date < today;
          return (
            <li key={t.id} className={s.task} data-done={t.status === 'done'}>
              <span className={s.taskText}>
                <b className={s.taskTitle} data-done={t.status === 'done'}>{t.title}</b>
                <span className={s.taskSub} data-late={!!late}>
                  {[t.detail, who ? `com ${who.display_name}` : null, t.due_date ? `${late ? 'atrasada · ' : 'até '}${dayMonth(t.due_date)}` : null].filter(Boolean).join(' · ')}
                </span>
              </span>
              {t.source !== 'user' ? <AiTag by={t.source} /> : null}
              {who ? <Avatar name={who.display_name} color={who.color} size={32} /> : null}
              {canEdit ? (
                <select aria-label={`Estado de ${t.title}`} value={t.status} className={s.status} onChange={(e) => void run(() => source.update('tasks', t.id, { status: e.target.value }).then(reload))}>
                  {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              ) : <Badge upper>{STATUS_LABEL[t.status]}</Badge>}
              {canEdit ? <IconButton icon="edit" label={`Editar ${t.title}`} variant="ghost" size={40} onClick={() => setEdit(t)} /> : null}
            </li>
          );
        })}
        {!tasks.length ? <li className={s.none}>Nenhuma pendência. As da turma aparecem aqui com responsável e prazo.</li> : null}
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
      {t ? <Button variant="secondary" className={s.danger} onClick={async () => { if (await confirm({ title: 'Excluir pendência?', message: t.title })) await run(() => source.remove('tasks', { id: t.id }).then(reload).then(onClose)); }}>Excluir</Button> : null}
      <Button variant="secondary" onClick={onClose}>Cancelar</Button>
      <Button disabled={busy || !v.title.trim()} onClick={save}>Salvar</Button>
    </>}>
      {t && t.source !== 'user' ? <AiNote by={t.source}>Pendência criada automaticamente. Edite ou exclua à vontade.</AiNote> : null}
      <Field label="O que fazer"><input value={v.title} maxLength={160} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
      <Field label="Detalhe"><input value={v.detail} maxLength={300} onChange={(e) => setV({ ...v, detail: e.target.value })} /></Field>
      <FieldGrid>
        <Field label="Responsável"><select value={v.assignee_id} onChange={(e) => setV({ ...v, assignee_id: e.target.value })}><option value="">Ninguém</option>{b.members.map((m) => <option key={m.user_id} value={m.user_id}>{profileOf(m.user_id)?.display_name ?? 'Pessoa'}</option>)}</select></Field>
        <Field label="Prazo"><input type="date" value={v.due_date} onChange={(e) => setV({ ...v, due_date: e.target.value })} /></Field>
        <Field label="Estado"><select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as TaskStatus })}>{Object.entries(STATUS_LABEL).map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select></Field>
        <Field label="Área"><select value={v.link} onChange={(e) => setV({ ...v, link: e.target.value as Task['link'] })}><option value="roteiro">Roteiro</option><option value="documentos">Documentos</option><option value="mala">Mala e gastos</option><option value="turma">Turma</option></select></Field>
      </FieldGrid>
    </Dialog>
  );
}

