'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { IdentityCard } from '../components/identity/IdentityCard';
import { useAction, useConfirm } from '../components/ui/feedback';
import { AiNote, PageTitle } from '../components/ui/primitives';
import { useAuth } from '../data/AuthContext';
import { useBundle } from '../data/TripContext';
import { deleteBundle } from '../data/offline';
import type { TripStyle } from '../data/types';
import { callAi } from '../lib/ai/client';
import type { DestinationIdentity } from '../lib/identity/types';
import { centsToDecimal, toCents } from '../lib/money';
import { instantToWall, isValidTimeZone, listTimeZones, wallToInstant } from '../lib/time';

const STYLES: TripStyle[] = ['Mochilão', 'Conforto', 'Aventura', 'Cultural'];

function localDeparture(iso: string | null, tz: string): string {
  if (!iso) return '';
  const w = instantToWall(tz, Date.parse(iso));
  return `${String(w.h).padStart(2, '0')}:${String(w.mi).padStart(2, '0')}`;
}

export default function EditTrip() {
  const { bundle: b, canEdit, isOrganizer, source, reload, identity } = useBundle();
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
  const [preview, setPreview] = useState<{ id: DestinationIdentity; by: string } | null>(null);
  const tzs = useMemo(() => listTimeZones(), []);
  const ok = v.title.trim() && v.end >= v.start && isValidTimeZone(v.tz) && isValidTimeZone(v.home) && /^[A-Z]{3}$/.test(v.currency);

  if (!canEdit) return <div className="wrap"><PageTitle title="Dados da trilha" sub="Só organizador e editores alteram os dados da trilha." /></div>;

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

  const regenerate = async () => {
    const r = await callAi<DestinationIdentity>('identity', { destination: t.title, departDate: t.start_date, returnDate: t.end_date, style: t.style, version: (t.identity_version ?? 1) + 1 });
    if (r) setPreview({ id: r.data, by: r.by });
  };
  const applyIdentity = () =>
    run(async () => {
      if (!preview) return;
      await source.update('trips', t.id, { identity: preview.id, identity_version: preview.id.version });
      setPreview(null);
      await reload();
      await refreshTrips();
    }, { success: 'Nova identidade aplicada.' });

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
          <label className="field">Destino (título)<input value={v.title} maxLength={80} onChange={(e) => setV({ ...v, title: e.target.value })} /></label>
          <label className="field">Destinos (separados por vírgula)<input value={v.destinations} onChange={(e) => setV({ ...v, destinations: e.target.value })} /></label>
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
          <h2 className="disp" style={{ margin: 0, fontSize: 28 }}>Identidade</h2>
          <IdentityCard identity={preview?.id ?? identity} title={t.title} />
          {preview ? (
            <>
              <AiNote by={preview.by === 'ai' ? 'ai' : 'rules'}>{preview.by === 'ai' ? 'Nova versão gerada por IA e validada (contraste, fonte, fenda).' : 'IA indisponível: versão gerada por regras locais.'}</AiNote>
              <div className="actions"><button className="btn btn-primary tap" onClick={applyIdentity} disabled={busy}>Usar esta versão</button><button className="btn tap" onClick={() => setPreview(null)}>Manter a atual</button></div>
            </>
          ) : source.kind === 'supabase' ? (
            <button className="btn btn-ghost tap" onClick={regenerate}>Gerar outra versão</button>
          ) : null}
          {isOrganizer ? <button className="btn btn-danger tap" style={{ marginTop: 32 }} onClick={del}>Excluir trilha</button> : null}
        </div>
      </section>
    </div>
  );
}
