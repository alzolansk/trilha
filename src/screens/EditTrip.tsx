'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useAction, useConfirm } from '../components/ui/feedback';
import { PageTitle } from '../components/ui/primitives';
import { Placeholder } from '../components/ui/Photo';
import { useAuth } from '../data/AuthContext';
import { useBundle } from '../data/TripContext';
import { deleteBundle } from '../data/offline';
import type { TripStyle } from '../data/types';
import { ACCENT_CHOICES } from '../lib/identity/accent';
import { centsToDecimal, toCents } from '../lib/money';
import { instantToWall, isValidTimeZone, listTimeZones, wallToInstant } from '../lib/time';

const STYLES: TripStyle[] = ['Mochilão', 'Conforto', 'Aventura', 'Cultural'];

function localDeparture(iso: string | null, tz: string): string {
  if (!iso) return '';
  const w = instantToWall(tz, Date.parse(iso));
  return `${String(w.h).padStart(2, '0')}:${String(w.mi).padStart(2, '0')}`;
}

export default function EditTrip() {
  const { bundle: b, canEdit, isOrganizer, source, reload, accent } = useBundle();
  const { refreshTrips } = useAuth();
  const router = useRouter();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const t = b.trip;
  const [v, setV] = useState({
    title: t.title, tagline: t.tagline ?? '', destinations: t.destinations.join(', '), start: t.start_date, end: t.end_date,
    time: localDeparture(t.departure_at, t.departure_tz), tz: t.departure_tz, home: t.home_tz, origin: t.origin ?? '', style: t.style,
    currency: t.base_currency, budget: t.budget_total != null ? String(t.budget_total) : '',
  });
  const tzs = useMemo(() => listTimeZones(), []);
  const ok = v.title.trim() && v.end >= v.start && isValidTimeZone(v.tz) && isValidTimeZone(v.home) && /^[A-Z]{3}$/.test(v.currency);

  if (!canEdit) return <div className="wrap"><PageTitle title="Dados da trilha" sub="Só organizador e editores alteram os dados da trilha." /></div>;

  const pickAccent = (hex: string | null) =>
    run(async () => {
      await source.update('trips', t.id, { accent: hex });
      await reload();
    }, { success: hex ? 'Cor da trilha atualizada.' : 'A cor volta a ser automática.' });

  const save = () =>
    run(async () => {
      const [y, mo, d] = v.start.split('-').map(Number);
      const [h, mi] = (v.time || '00:00').split(':').map(Number);
      const departure = v.time ? new Date(wallToInstant(v.tz, { y, mo, d, h, mi, s: 0 })).toISOString() : null;
      const budget = v.budget.trim() ? toCents(v.budget) : null;
      if (budget != null && (isNaN(budget) || budget < 0)) throw new Error('Orçamento inválido.');
      const patch = {
        title: v.title.trim(), tagline: v.tagline.trim() || null, destinations: v.destinations.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20),
        start_date: v.start, end_date: v.end, departure_at: departure, departure_tz: v.tz, home_tz: v.home, origin: v.origin.trim().toUpperCase() || null,
        style: v.style, base_currency: v.currency, budget_total: budget == null ? null : centsToDecimal(budget),
      };
      await source.update('trips', t.id, patch, t.version);
      await reload();
      await refreshTrips();
    }, { success: 'Trilha atualizada.', onConflict: async () => { await source.update('trips', t.id, { title: v.title.trim() }); await reload(); } });

  const del = async () => {
    if (!(await confirm({ title: `Excluir “${t.title}”?`, message: 'Roteiro, documentos, gastos e diário desta trilha são apagados para todo mundo. Não dá pra desfazer.', confirmLabel: 'Excluir trilha' }))) return;
    await run(async () => {
      const paths = b.documents.flatMap((d) => [d.storage_path, ...(d.preview_path ? [d.preview_path] : [])]);
      if (paths.length) await source.removeFiles('documents', paths).catch(() => undefined);
      if (b.journalPhotos.length) await source.removeFiles('journal', b.journalPhotos.map((p) => p.storage_path)).catch(() => undefined);
      if (t.cover_path) await source.removeFiles('covers', [t.cover_path]).catch(() => undefined);
      await source.remove('trips', { id: t.id });
      await deleteBundle(source.userId, t.id).catch(() => undefined);
      await refreshTrips();
      router.replace('/');
    }, { success: 'Trilha excluída.' });
  };

  return (
    <div className="wrap">
      <PageTitle eyebrow={t.title} title="Dados da trilha" sub="Datas, horário e fuso do embarque alimentam o countdown." />
      <section className="split">
        <div className="col-main card" style={{ padding: 26, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label className="field">Nome da trilha<input value={v.title} maxLength={80} onChange={(e) => setV({ ...v, title: e.target.value })} /></label>
          <label className="field">Destinos (separados por vírgula)<input value={v.destinations} onChange={(e) => setV({ ...v, destinations: e.target.value })} placeholder="Paraty" />{!t.destinations.length ? <span className="hint">Fechou o destino? Escreva aqui e salve.</span> : null}</label>
          <div className="grid2">
            <label className="field">Ida<input type="date" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} /></label>
            <label className="field">Volta<input type="date" value={v.end} min={v.start} onChange={(e) => setV({ ...v, end: e.target.value })} /></label>
            <label className="field">Horário do embarque<input type="time" value={v.time} onChange={(e) => setV({ ...v, time: e.target.value })} /><span className="hint">Sem horário, o countdown conta até 00:00 do dia da ida.</span></label>
            <label className="field">Fuso do embarque<input list="tzs" value={v.tz} onChange={(e) => setV({ ...v, tz: e.target.value })} />{!isValidTimeZone(v.tz) ? <span className="err">Fuso desconhecido.</span> : null}</label>
            <label className="field">Origem (IATA ou cidade)<input value={v.origin} maxLength={60} onChange={(e) => setV({ ...v, origin: e.target.value })} placeholder="GRU" /></label>
            <label className="field">Seu fuso de casa<input list="tzs" value={v.home} onChange={(e) => setV({ ...v, home: e.target.value })} /></label>
            <label className="field">Estilo<select value={v.style} onChange={(e) => setV({ ...v, style: e.target.value as TripStyle })}>{STYLES.map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="field">Moeda base<input value={v.currency} maxLength={3} onChange={(e) => setV({ ...v, currency: e.target.value.toUpperCase() })} /><span className="hint">Gastos já registrados mantêm a taxa gravada.</span></label>
            <label className="field">Orçamento total<input inputMode="decimal" value={v.budget} onChange={(e) => setV({ ...v, budget: e.target.value })} /></label>
            <label className="field">Etiqueta (opcional)<input value={v.tagline} maxLength={40} onChange={(e) => setV({ ...v, tagline: e.target.value })} placeholder="Mochilão de verão" /></label>
          </div>
          <datalist id="tzs">{tzs.map((z) => <option key={z} value={z} />)}</datalist>
          <button className="btn btn-primary tap" style={{ alignSelf: 'flex-start' }} disabled={!ok || busy} onClick={save}>Salvar</button>
        </div>
        <div className="col-side" style={{ gap: 16 }}>
          <h2 className="disp" style={{ margin: 0, fontSize: 24 }}>Aparência</h2>
          {/* Trilha 2.0: a identidade por destino virou uma cor só (trips.accent, planning §6.7 / §7). */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ position: 'relative', height: 120 }}><Placeholder label="Capa sem foto na cor da trilha" /></div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span style={{ fontSize: 14, color: 'var(--ink-2)' }}>Cor da trilha. Aparece na capa sem foto, no mapa e em pequenos detalhes.</span>
              <div role="radiogroup" aria-label="Cor da trilha" style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                <button
                  type="button" role="radio" aria-checked={!t.accent} className="tap" onClick={() => pickAccent(null)} disabled={busy}
                  style={{ height: 36, padding: '0 12px', borderRadius: 999, border: !t.accent ? '2px solid var(--ink)' : '1px solid var(--line)', background: 'var(--surface)', fontSize: 13, fontWeight: 600 }}
                >Automática</button>
                {ACCENT_CHOICES.map((c) => {
                  const on = t.accent?.toUpperCase() === c.hex;
                  return (
                    <button
                      key={c.hex} type="button" role="radio" aria-checked={on} aria-label={c.name} title={c.name} className="tap" disabled={busy}
                      onClick={() => pickAccent(c.hex)}
                      style={{ width: 36, height: 36, borderRadius: 999, background: c.hex, border: on ? '3px solid var(--surface)' : 0, boxShadow: on ? '0 0 0 2px var(--ink)' : 'none' }}
                    />
                  );
                })}
              </div>
              <span style={{ fontSize: 12, color: 'var(--mute)' }}>
                {t.accent ? `Escolhida: ${ACCENT_CHOICES.find((c) => c.hex === t.accent?.toUpperCase())?.name ?? t.accent}` : 'Automática: escolhida pelo destino.'}
                {' '}<span aria-hidden="true" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 999, background: accent, verticalAlign: 'middle' }} />
              </span>
            </div>
          </div>
          {isOrganizer ? <button className="btn btn-danger tap" style={{ marginTop: 32 }} onClick={del}>Excluir trilha</button> : null}
        </div>
      </section>
    </div>
  );
}
