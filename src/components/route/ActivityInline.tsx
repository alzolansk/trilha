'use client';
// Atividade editada no próprio dia (canvas "cidade e reservas", fase 4): tocar na linha abre o card
// no lugar, sem janela por cima. Turno em chips, nota com autor, mudar de dia, tirar do dia com
// "Desfazer". Tudo salva sozinho. O formulário completo (moeda, horário exato, mapa, pago) fica em
// "Mais detalhes" (ActivitySheet).
import { useState } from 'react';
import { useAction, useToast } from '../ui/feedback';
import { Icon } from '../ui/primitives';
import { useBundle } from '../../data/TripContext';
import type { Activity, Stop } from '../../data/types';
import { dayWeekU, hhmm } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { sameThing } from '../../lib/route';
import { stopSlots } from '../../lib/suggestions';
import { tourWhat } from '../../lib/tourInfo';
import s from './activityInline.module.css';

type Turn = 'none' | 'manha' | 'tarde' | 'noite' | 'hora';
const PRESET: Record<'manha' | 'tarde' | 'noite', string> = { manha: '09:00', tarde: '14:00', noite: '19:00' };
const TURNS: { id: Turn; label: string }[] = [
  { id: 'none', label: 'Sem horário' }, { id: 'manha', label: 'Manhã' }, { id: 'tarde', label: 'Tarde' }, { id: 'noite', label: 'Noite' }, { id: 'hora', label: 'Horário certo' },
];

function turnOf(time: string | null | undefined): Turn {
  const t = hhmm(time);
  if (!t) return 'none';
  const hit = (Object.keys(PRESET) as (keyof typeof PRESET)[]).find((k) => PRESET[k] === t);
  return hit ?? 'hora';
}

/** Linha fechada: título, a frase do que é (quando a sugestão tem) e o horário. */
export function activityWhat(b: ReturnType<typeof useBundle>['bundle'], act: Activity): string | null {
  const sg = (b.suggestions ?? []).find((x) => x.kind === 'activity' && x.stop_id === act.stop_id && sameThing(x.payload.title, act.title));
  return tourWhat(sg?.payload) ?? null;
}

export function ActivityInline({ act, stop, onClose, onMore }: { act: Activity; stop: Stop; onClose: () => void; onMore: () => void }) {
  const { bundle: b, source, reload } = useBundle();
  const { run } = useAction();
  const toast = useToast();
  const [title, setTitle] = useState(act.title);
  const [notes, setNotes] = useState(act.notes ?? '');
  const [turn, setTurn] = useState<Turn>(turnOf(act.time));
  const [time, setTime] = useState(hhmm(act.time));
  const [moving, setMoving] = useState(false);
  const what = activityWhat(b, act);
  const slots = stopSlots(b, stop).filter((x) => x.date !== act.day);

  // Grava só o que mudou, com a versão que a tela tem; conflito: grava por cima do valor do campo.
  const save = (patch: Partial<Activity>, msg = 'Salvo.') =>
    run(async () => {
      await source.update('activities', act.id, patch, act.version);
      await reload();
    }, { success: msg, onConflict: async () => { await source.update('activities', act.id, patch); await reload(); } });

  const pickTurn = (t: Turn) => {
    setTurn(t);
    if (t === 'hora') return; // espera o horário no campo
    const next = t === 'none' ? null : PRESET[t];
    setTime(next ?? '');
    if (next !== (act.time ? hhmm(act.time) : null)) void save({ time: next });
  };
  const moveTo = (date: string, n: number) => {
    setMoving(false);
    void run(async () => {
      await source.update('activities', act.id, { day: date }, act.version);
      await reload();
      onClose();
    }, { success: `${act.title} foi para o dia ${n}.` });
  };
  const remove = async () => {
    const { version: _v, created_at: _c, updated_at: _u, ...row } = act;
    void _v; void _c; void _u;
    const ok = await run(async () => {
      await source.remove('activities', { id: act.id });
      await reload();
      return true;
    });
    if (!ok) return;
    onClose();
    toast(`${act.title} saiu do dia.`, {
      label: 'Desfazer',
      run: () => void run(async () => { await source.insert('activities', row); await reload(); }, { success: 'Voltou para o dia.' }),
    });
  };

  const cost = act.cost_cents == null ? null : act.cost_cents <= 0 ? 'grátis' : `${act.cost_is_estimate !== false ? '≈ ' : ''}${formatMoney(act.cost_cents, act.cost_currency ?? b.trip.base_currency, { compact: true })} por pessoa`;
  const author = act.suggested_by === 'ai' ? 'da Trilha' : null;

  return (
    <article className={s.card} aria-label={`${act.title}: editar no dia`}>
      <div className={s.head}>
        <div className={s.titles}>
          <label className="sr" htmlFor={`act-title-${act.id}`}>Nome da atividade</label>
          <input id={`act-title-${act.id}`} className={s.title} value={title} maxLength={160}
            onChange={(e) => setTitle(e.target.value)} onBlur={() => { const v = title.trim(); if (v && v !== act.title) void save({ title: v }); else setTitle(act.title); }} />
          {what ? <p className={s.what}>{what}</p> : null}
        </div>
        <button type="button" className={s.close} onClick={onClose} aria-label="Fechar"><Icon name="close" size={18} /></button>
      </div>

      <div className={s.group}>
        <span className={s.label} id={`turn-${act.id}`}>Quando?</span>
        <div role="radiogroup" aria-labelledby={`turn-${act.id}`} className={s.chips}>
          {TURNS.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={turn === t.id} className={s.chip} onClick={() => pickTurn(t.id)}>{t.label}</button>
          ))}
        </div>
        {turn === 'hora' ? (
          <label className={s.timeLabel}>
            Horário
            <input type="time" value={time} autoFocus onChange={(e) => setTime(e.target.value)} onBlur={() => { if (time && time !== hhmm(act.time)) void save({ time }); }} />
          </label>
        ) : null}
      </div>

      {cost ? (
        <div className={s.pills}>
          {cost ? <span className={cost === 'grátis' ? s.pillOk : s.pill}>{cost}</span> : null}
        </div>
      ) : null}

      <div className={s.note}>
        <label className={s.noteLabel} htmlFor={`act-notes-${act.id}`}>nota{author ? ` ${author}` : ''}</label>
        <textarea id={`act-notes-${act.id}`} rows={2} value={notes} maxLength={2000} placeholder="Algo para lembrar? (opcional)"
          onChange={(e) => setNotes(e.target.value)} onBlur={() => { const v = notes.trim() || null; if (v !== (act.notes ?? null)) void save({ notes: v }); }} />
      </div>

      {moving ? (
        <div className={s.group}>
          <span className={s.label}>Para qual dia?</span>
          <div className={s.chips}>
            {slots.map((x) => (
              <button key={x.date} type="button" className={s.chip} onClick={() => moveTo(x.date, x.dayNumber)}>
                Dia {x.dayNumber} · {dayWeekU(x.date).toLowerCase()}
              </button>
            ))}
            <button type="button" className={s.chipGhost} onClick={() => setMoving(false)}>Cancelar</button>
          </div>
        </div>
      ) : null}

      <div className={s.actions}>
        <div className={s.left}>
          {slots.length && !moving ? <button type="button" className={s.btn} onClick={() => setMoving(true)}>Mudar de dia</button> : null}
          <button type="button" className={s.btn} onClick={onMore}>Mais detalhes</button>
        </div>
        <button type="button" className={s.danger} onClick={() => void remove()}>Tirar do dia</button>
      </div>
      <p className={s.hint}>Salva sozinho ao sair de cada campo.</p>
    </article>
  );
}
