'use client';
// Sheets do Roteiro e da Parada (planning §6.5). Todos usam `useAction` (toast e conflito de versão)
// e gravam pelo TripSource, como o resto do app.
import { PayItem } from '../money/ExpenseSheet';
import { useMemo, useState } from 'react';
import { PlaceSearch, type Place } from '../forms/PlaceSearch';
import { useDraft } from '../forms/useDraft';
import { EstimateBadge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { useAction, useConfirm } from '../ui/feedback';
import { Field, FieldGrid } from '../ui/Field';
import { formatMoneyTyping, parseMoneyInput } from '../ui/MoneyInput';
import { Photo, type PhotoData } from '../ui/Photo';
import { Sheet } from '../ui/Sheet';
import { useAuth } from '../../data/AuthContext';
import { acceptSuggestion, addStayOption } from '../../data/suggestionActions';
import { useBundle } from '../../data/TripContext';
import type { Activity, PhotoRef, Stay, Stop, Suggestion, Transport, TransportMode, TripBundle } from '../../data/types';
import { callAi } from '../../lib/ai/client';
import { currencyForCountry } from '../../lib/currency';
import { dayWeekU, hhmm, MODE_LABEL } from '../../lib/format';
import { fetchPhoto, photoCredit } from '../../lib/photos';
import { stopSlots, type DaySlot } from '../../lib/suggestions';
import { dateRange, isValidTimeZone, listTimeZones } from '../../lib/time';
import s from './route.module.css';

export const MODES: TransportMode[] = ['plane', 'bus', 'train', 'car', 'boat', 'walk', 'other'];
const nn = (v: string) => (v.trim() === '' ? null : v.trim());
const centsText = (c: number | null | undefined) => (c == null ? '' : formatMoneyTyping((c / 100).toFixed(2).replace('.', ',').replace(/,00$/, '')));

/** Moedas oferecidas nos campos de preço: a da trilha e as dos países das paradas. */
export function tripCurrencies(b: TripBundle): string[] {
  const set = new Set([b.trip.base_currency]);
  for (const st of b.stops) {
    const c = currencyForCountry(st.country);
    if (c) set.add(c);
  }
  return [...set];
}

/** Valor + moeda. Texto pt-BR enquanto digita; devolve centavos (ou null quando vazio). */
function PriceField({ label, text, currency, currencies, onText, onCurrency, hint }: { label: string; text: string; currency: string; currencies: string[]; onText: (t: string) => void; onCurrency: (c: string) => void; hint?: React.ReactNode }) {
  return (
    <div className={s.price}>
      <Field label={label} hint={hint}>
        <input inputMode="decimal" value={text} placeholder="0,00" onChange={(e) => onText(formatMoneyTyping(e.target.value))} />
      </Field>
      <Field label="Moeda">
        <select value={currency} onChange={(e) => onCurrency(e.target.value)}>{[...new Set([currency, ...currencies])].map((c) => <option key={c} value={c}>{c}</option>)}</select>
      </Field>
    </div>
  );
}

function Footer({ onClose, onSave, saveLabel = 'Salvar', disabled, onDelete, deleteLabel = 'Excluir' }: { onClose: () => void; onSave: () => void; saveLabel?: string; disabled?: boolean; onDelete?: () => void; deleteLabel?: string }) {
  return (
    <>
      {onDelete ? <Button variant="ghost" className={s.danger} onClick={onDelete}>{deleteLabel}</Button> : null}
      <Button variant="secondary" onClick={onClose}>Cancelar</Button>
      <Button onClick={onSave} disabled={disabled}>{saveLabel}</Button>
    </>
  );
}

// ───────────── Parada ─────────────

/** Adicionar parada: lugar, datas e como chega. Ao salvar, pede dica e sugestões em segundo plano. */
export function AddStopSheet({ open, onClose, stops, onCreated }: { open: boolean; onClose: () => void; stops: Stop[]; onCreated?: (id: string) => void }) {
  const { bundle: b, source, reload } = useBundle();
  const { run, busy } = useAction();
  const last = stops.at(-1);
  const start = last?.departure_date ?? b.trip.start_date;
  const d = useDraft(`stop-new-${b.trip.id}`, { name: '', a: start, b: start, mode: 'bus' as TransportMode, country: '', lat: '', lng: '', alt: '' });
  const v = d.value;
  const valid = !!v.name.trim() && !!v.a && !!v.b && v.b >= v.a;

  const save = () =>
    run(async () => {
      const stop = await source.insert<Stop>('stops', {
        trip_id: b.trip.id, position: (last?.position ?? -1) + 1, name: v.name.trim(), country: nn(v.country), arrival_date: v.a, departure_date: v.b,
        arrival_mode: v.mode, lat: v.lat ? Number(v.lat) : null, lng: v.lng ? Number(v.lng) : null, altitude_m: v.alt ? Number(v.alt) : null,
      });
      await source.insert('transports', {
        trip_id: b.trip.id, stop_id: stop.id, mode: v.mode, origin_name: last?.name ?? b.trip.origin ?? null, origin_code: last?.code ?? (last ? null : b.trip.origin),
        dest_name: stop.name, depart_date: v.a,
      });
      d.clear();
      d.setValue({ name: '', a: v.b, b: v.b, mode: 'bus', country: '', lat: '', lng: '', alt: '' });
      await reload();
      onCreated?.(stop.id);
      onClose();
      // Dica e sugestões da IA em segundo plano: se falharem, nada aparece (nunca bloqueia).
      if (source.kind === 'supabase') {
        void callAi('tips', { tripId: b.trip.id, stopId: stop.id }).then((r) => r && reload());
        void callAi('suggest', { tripId: b.trip.id, stopId: stop.id }).then((r) => r && reload());
      }
    }, { success: `${v.name.trim()} entrou no roteiro.` });

  return (
    <Sheet open={open} onClose={onClose} title="Adicionar parada" description="Cidade e datas. O resto dá pra completar depois." footer={<Footer onClose={onClose} onSave={() => void save()} saveLabel={busy ? 'Salvando…' : 'Salvar parada'} disabled={busy || !valid} />}>
      <div className={s.form}>
        {d.restored && v.name ? <span className={s.note}>Rascunho recuperado.</span> : null}
        <PlaceSearch
          label="Cidade ou lugar" value={v.name} required placeholder="Digite um lugar" enabled={source.kind === 'supabase'}
          onText={(t) => d.setValue({ ...v, name: t, lat: '', lng: '' })}
          onPick={(p: Place) => d.setValue({ ...v, name: p.name, country: p.country ?? v.country, lat: String(p.lat), lng: String(p.lng), alt: p.altitude != null ? String(p.altitude) : '' })}
        />
        <FieldGrid>
          <Field label="Chegada"><input type="date" required value={v.a} min={b.trip.start_date} max={b.trip.end_date} onChange={(e) => d.set('a', e.target.value)} /></Field>
          <Field label="Saída" error={v.b < v.a ? 'A saída precisa ser no dia da chegada ou depois.' : undefined}><input type="date" required value={v.b} min={v.a} onChange={(e) => d.set('b', e.target.value)} /></Field>
        </FieldGrid>
        <Field label="Como chega" hint="Dá pra completar horário, localizador e valor no trecho depois.">
          <select value={v.mode} onChange={(e) => d.set('mode', e.target.value as TransportMode)}>{MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}</select>
        </Field>
        {v.lat ? <span className={s.note}>{v.country ? `${v.country} · ` : ''}coordenadas {Number(v.lat).toFixed(3)}, {Number(v.lng).toFixed(3)}{v.alt ? ` · altitude ${v.alt} m (OSM)` : ''}</span> : null}
      </div>
    </Sheet>
  );
}

/** Editar parada: nome, datas, bairro escolhido, notas, foto da capa (Wikimedia) e excluir. */
export function EditStopSheet({ stop, onClose, onDeleted }: { stop: Stop; onClose: () => void; onDeleted?: () => void }) {
  const { source, reload, bundle: b } = useBundle();
  const { online } = useAuth();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const [v, setV] = useState({
    name: stop.name, country: stop.country ?? '', code: stop.code ?? '', a: stop.arrival_date, b: stop.departure_date, tz: stop.tz ?? '',
    alt: stop.altitude_m != null ? String(stop.altitude_m) : '', lat: stop.lat != null ? String(stop.lat) : '', lng: stop.lng != null ? String(stop.lng) : '',
    mode: stop.arrival_mode ?? 'bus', meta: stop.meta ?? '', area: stop.area ?? '', notes: stop.notes ?? '',
  });
  const [photo, setPhoto] = useState<PhotoRef | null>(stop.photo?.url ? stop.photo : null);
  const [looking, setLooking] = useState<'idle' | 'busy' | 'none'>('idle');
  const tzs = useMemo(() => listTimeZones(), []);
  const codeOk = !v.code || /^[A-Za-z0-9]{2,4}$/.test(v.code);
  const tzOk = !v.tz || isValidTimeZone(v.tz);
  const ok = !!v.name.trim() && v.b >= v.a && codeOk && tzOk && (!v.lat === !v.lng);
  const patch = () => ({
    name: v.name.trim(), country: nn(v.country), code: v.code ? v.code.toUpperCase() : null, arrival_date: v.a, departure_date: v.b, tz: nn(v.tz),
    altitude_m: v.alt ? Math.round(Number(v.alt)) : null, lat: v.lat ? Number(v.lat) : null, lng: v.lng ? Number(v.lng) : null, arrival_mode: v.mode, meta: nn(v.meta),
    area: nn(v.area)?.slice(0, 80) ?? null, notes: nn(v.notes), photo,
  });
  const save = () =>
    run(() => source.update('stops', stop.id, patch(), stop.version).then(reload).then(onClose), {
      success: 'Parada atualizada.',
      onConflict: () => source.update('stops', stop.id, patch()).then(reload).then(onClose),
    });
  const del = async () => {
    const yes = await confirm({ title: `Excluir ${stop.name}?`, message: 'A parada sai do roteiro junto com trecho, hospedagem e plano. Documentos ligados continuam em Documentos, só perdem o vínculo.' });
    if (!yes) return;
    await run(async () => {
      await source.remove('stops', { id: stop.id });
      await reload();
      onClose();
      onDeleted?.();
    }, { success: `${stop.name} saiu do roteiro.` });
  };
  const look = async () => {
    setLooking('busy');
    const p = await fetchPhoto([v.name.trim(), v.country.trim()].filter(Boolean).join(', '));
    setLooking(p ? 'idle' : 'none');
    if (p) setPhoto(p);
  };
  const canLook = source.kind === 'supabase' && online;

  return (
    <Sheet open onClose={onClose} title="Editar parada" size="lg" footer={<Footer onClose={onClose} onSave={() => void save()} disabled={!ok || busy} onDelete={() => void del()} />}>
      <div className={s.form}>
        <PlaceSearch label="Cidade ou lugar" value={v.name} enabled={source.kind === 'supabase'} onText={(t) => setV({ ...v, name: t })} onPick={(p) => setV({ ...v, name: p.name, country: p.country ?? v.country, lat: String(p.lat), lng: String(p.lng), alt: p.altitude != null ? String(p.altitude) : v.alt })} />
        <FieldGrid>
          <Field label="Chegada"><input type="date" value={v.a} onChange={(e) => setV({ ...v, a: e.target.value })} /></Field>
          <Field label="Saída" error={v.b < v.a ? 'A saída precisa ser depois da chegada.' : undefined}><input type="date" value={v.b} min={v.a} onChange={(e) => setV({ ...v, b: e.target.value })} /></Field>
          <Field label="Bairro escolhido" hint="Aparece no roteiro como “Fiquem em…”."><input value={v.area} maxLength={80} placeholder="ex.: San Blas" onChange={(e) => setV({ ...v, area: e.target.value })} /></Field>
          <Field label="País"><input value={v.country} maxLength={60} onChange={(e) => setV({ ...v, country: e.target.value })} /></Field>
          <Field label="Código (IATA ou abreviação)" error={!codeOk ? '2 a 4 letras ou números.' : undefined}><input value={v.code} maxLength={4} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} placeholder="CUZ" /></Field>
          <Field label="Como chega"><select value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value as TransportMode })}>{MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}</select></Field>
          <Field label="Fuso horário" error={!tzOk ? 'Fuso desconhecido (ex.: America/Lima).' : undefined}><input list="tzlist" value={v.tz} onChange={(e) => setV({ ...v, tz: e.target.value })} placeholder={b.trip.home_tz} /></Field>
          <Field label="Altitude (m)"><input type="number" value={v.alt} min={-500} max={9000} onChange={(e) => setV({ ...v, alt: e.target.value })} placeholder="só se souber" /></Field>
        </FieldGrid>
        <Field label="Linha curta"><input value={v.meta} maxLength={80} onChange={(e) => setV({ ...v, meta: e.target.value })} placeholder="medina e souks" /></Field>
        <Field label="Notas"><textarea rows={3} value={v.notes} maxLength={4000} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
        <datalist id="tzlist">{tzs.map((z) => <option key={z} value={z} />)}</datalist>
        <span className={s.note}>
          {v.lat ? `Coordenadas ${Number(v.lat).toFixed(4)}, ${Number(v.lng).toFixed(4)}.` : 'Sem coordenadas: escolha o lugar na busca para aparecer no mapa.'}
          {v.lat ? <button type="button" className={s.linkBtn} onClick={() => setV({ ...v, lat: '', lng: '' })}>Remover</button> : null}
        </span>

        <div className={s.photoBox}>
          <span className={s.label}>Foto da capa</span>
          <Photo photo={photo as PhotoData | null} place={v.name} ratio="16/9" />
          {photo ? <span className={s.note}>{photoCredit(photo)}</span> : <span className={s.note}>Sem foto: a capa usa a ilustração na cor da trilha.</span>}
          <div className={s.row}>
            {canLook ? <Button size="sm" variant="secondary" icon="search" onClick={() => void look()} disabled={looking === 'busy'}>{looking === 'busy' ? 'Procurando…' : 'Buscar na Wikipedia'}</Button> : null}
            {photo ? <Button size="sm" variant="ghost" onClick={() => setPhoto(null)}>Tirar foto</Button> : null}
          </div>
          {looking === 'none' ? <span className={s.note}>Não achamos uma foto deste lugar com autor e licença. Melhor ficar sem do que mostrar outro lugar.</span> : null}
        </div>
      </div>
    </Sheet>
  );
}

// ───────────── Trecho, hospedagem e atividade ─────────────

/** Trecho que chega na parada: modo, pontas, horários, localizador, assento, valor por pessoa e passagem anexada. */
export function TransportSheet({ stop, t, onClose }: { stop: Stop; t: Transport | null; onClose: () => void }) {
  const { source, reload, bundle: b } = useBundle();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const passDocs = b.documents.filter((d) => d.category === 'passagem' && d.status === 'ready');
  const [v, setV] = useState({
    mode: t?.mode ?? stop.arrival_mode ?? 'bus', origin_code: t?.origin_code ?? '', origin_name: t?.origin_name ?? '', dest_code: t?.dest_code ?? stop.code ?? '', dest_name: t?.dest_name ?? stop.name,
    depart_date: t?.depart_date ?? stop.arrival_date, depart_time: hhmm(t?.depart_time), depart_tz: t?.depart_tz ?? '', arrive_date: t?.arrive_date ?? stop.arrival_date, arrive_time: hhmm(t?.arrive_time),
    arrive_tz: t?.arrive_tz ?? stop.tz ?? '', booking_ref: t?.booking_ref ?? '', seat: t?.seat ?? '', duration: t?.duration_min ? String(t.duration_min) : '', document_id: t?.document_id ?? '', notes: t?.notes ?? '',
    price: centsText(t?.price_cents), currency: t?.price_currency ?? b.trip.base_currency,
  });
  const priceChanged = v.price !== centsText(t?.price_cents) || v.currency !== (t?.price_currency ?? b.trip.base_currency);
  const okTz = (!v.depart_tz || isValidTimeZone(v.depart_tz)) && (!v.arrive_tz || isValidTimeZone(v.arrive_tz));
  const row = () => {
    const cents = parseMoneyInput(v.price);
    return {
      mode: v.mode, origin_code: nn(v.origin_code.toUpperCase()), origin_name: nn(v.origin_name), dest_code: nn(v.dest_code.toUpperCase()), dest_name: nn(v.dest_name),
      depart_date: nn(v.depart_date), depart_time: nn(v.depart_time), depart_tz: nn(v.depart_tz), arrive_date: nn(v.arrive_date), arrive_time: nn(v.arrive_time), arrive_tz: nn(v.arrive_tz),
      booking_ref: nn(v.booking_ref), seat: nn(v.seat), duration_min: v.duration ? Number(v.duration) : null, document_id: nn(v.document_id), notes: nn(v.notes),
      // valor digitado pela turma deixa de ser estimativa
      ...(priceChanged ? { price_cents: cents, price_currency: cents != null ? v.currency : null, price_is_estimate: false } : {}),
    };
  };
  const save = () =>
    run(async () => {
      if (t) await source.update('transports', t.id, row(), t.version);
      else await source.insert('transports', { ...row(), trip_id: b.trip.id, stop_id: stop.id });
      await reload();
      onClose();
    }, { success: 'Trecho salvo.', onConflict: async () => { if (t) await source.update('transports', t.id, row()); await reload(); onClose(); } });
  const del = async () => {
    if (!t || !(await confirm({ title: 'Excluir trecho?', message: 'Os dados do bilhete deste trecho serão apagados.' }))) return;
    await run(() => source.remove('transports', { id: t.id }).then(reload).then(onClose), { success: 'Trecho excluído.' });
  };
  const f = (k: keyof typeof v, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <Field label={label}><input value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} {...extra} /></Field>
  );
  return (
    <Sheet open onClose={onClose} title={`Como chego em ${stop.name}`} size="lg" footer={<Footer onClose={onClose} onSave={() => void save()} disabled={busy || !okTz} onDelete={t ? () => void del() : undefined} />}>
      <div className={s.form}>
        {t ? <PayItem type="transport" id={t.id} /> : null}
        <Field label="Meio de transporte"><select value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value as TransportMode })}>{MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}</select></Field>
        <PriceField
          label="Valor por pessoa" text={v.price} currency={v.currency} currencies={tripCurrencies(b)} onText={(x) => setV({ ...v, price: x })} onCurrency={(c) => setV({ ...v, currency: c })}
          hint={t?.price_is_estimate && !priceChanged ? <span className={s.inline}><EstimateBadge /> preenchido pela Trilha. Confirme quando comprar.</span> : 'Entra no Orçamento como valor confirmado.'}
        />
        <FieldGrid>
          {f('origin_name', 'Origem', { maxLength: 80 })}
          {f('origin_code', 'Origem (código)', { maxLength: 8, placeholder: 'GRU' })}
          {f('dest_name', 'Destino', { maxLength: 80 })}
          {f('dest_code', 'Destino (código)', { maxLength: 8 })}
          {f('depart_date', 'Data de saída', { type: 'date' })}
          {f('depart_time', 'Horário de saída (local)', { type: 'time' })}
          {f('arrive_date', 'Data de chegada', { type: 'date' })}
          {f('arrive_time', 'Horário de chegada (local)', { type: 'time' })}
          {f('depart_tz', 'Fuso da saída', { list: 'tzlist2', placeholder: 'America/Sao_Paulo' })}
          {f('arrive_tz', 'Fuso da chegada', { list: 'tzlist2', placeholder: 'America/Lima' })}
          {f('booking_ref', 'Localizador', { maxLength: 40 })}
          {f('seat', 'Assento / poltrona', { maxLength: 40 })}
          {f('duration', 'Duração em minutos (se souber)', { type: 'number', min: 1, max: 10080 })}
          <Field label="Passagem anexada"><select value={v.document_id} onChange={(e) => setV({ ...v, document_id: e.target.value })}><option value="">Nenhuma</option>{passDocs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</select></Field>
        </FieldGrid>
        <datalist id="tzlist2">{listTimeZones().map((z) => <option key={z} value={z} />)}</datalist>
        {!okTz ? <span className={s.err}>Fuso desconhecido.</span> : null}
        <span className={s.note}>A duração só é calculada quando datas, horários e fusos das duas pontas estão preenchidos. Com localizador, o trecho deixa de aparecer como “não reservado”.</span>
      </div>
    </Sheet>
  );
}

/** Hospedagem da parada: nome, endereço, check-in/out, estado, valor por noite, link e comprovante. */
export function StaySheet({ stop, stay, onClose }: { stop: Stop; stay: Stay | null; onClose: () => void }) {
  const { source, reload, bundle: b } = useBundle();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const resDocs = b.documents.filter((d) => d.category === 'reserva' && d.status === 'ready');
  const [v, setV] = useState({
    name: stay?.name ?? '', address: stay?.address ?? '', checkin_date: stay?.checkin_date ?? stop.arrival_date, checkin_time: hhmm(stay?.checkin_time), checkout_date: stay?.checkout_date ?? stop.departure_date,
    checkout_time: hhmm(stay?.checkout_time), status: stay?.status ?? 'pending', notes: stay?.notes ?? '', document_id: stay?.document_id ?? '', link_url: stay?.link_url ?? '',
    price: centsText(stay?.price_cents), currency: stay?.price_currency ?? b.trip.base_currency,
  });
  const priceChanged = v.price !== centsText(stay?.price_cents) || v.currency !== (stay?.price_currency ?? b.trip.base_currency);
  const linkOk = !v.link_url.trim() || /^https?:\/\/\S+$/i.test(v.link_url.trim());
  const row = () => {
    const cents = parseMoneyInput(v.price);
    return {
      name: v.name.trim(), address: nn(v.address), checkin_date: nn(v.checkin_date), checkin_time: nn(v.checkin_time), checkout_date: nn(v.checkout_date), checkout_time: nn(v.checkout_time),
      status: v.status, notes: nn(v.notes), document_id: nn(v.document_id), suggested_by: null, link_url: nn(v.link_url),
      ...(priceChanged ? { price_cents: cents, price_currency: cents != null ? v.currency : null, price_is_estimate: false } : {}),
    };
  };
  const save = () =>
    run(async () => {
      if (stay) await source.update('stays', stay.id, row(), stay.version);
      else await source.insert('stays', { ...row(), trip_id: b.trip.id, stop_id: stop.id });
      await reload();
      onClose();
    }, { success: 'Hospedagem salva.', onConflict: async () => { if (stay) await source.update('stays', stay.id, row()); await reload(); onClose(); } });
  const del = async () => {
    if (!stay || !(await confirm({ title: 'Excluir hospedagem?', message: `${stay.name} sai desta parada.` }))) return;
    await run(() => source.remove('stays', { id: stay.id }).then(reload).then(onClose), { success: 'Hospedagem excluída.' });
  };
  return (
    <Sheet open onClose={onClose} title={`Onde dormir em ${stop.name}`} size="lg" footer={<Footer onClose={onClose} onSave={() => void save()} disabled={busy || !v.name.trim() || !linkOk} onDelete={stay ? () => void del() : undefined} />}>
      <div className={s.form}>
        {stay ? <PayItem type="stay" id={stay.id} /> : null}
        <Field label="Nome"><input value={v.name} maxLength={120} required onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <PriceField
          label="Valor por noite (quarto ou casa)" text={v.price} currency={v.currency} currencies={tripCurrencies(b)} onText={(x) => setV({ ...v, price: x })} onCurrency={(c) => setV({ ...v, currency: c })}
          hint={stay?.price_is_estimate && !priceChanged ? <span className={s.inline}><EstimateBadge /> valor de referência. Confirme ao reservar.</span> : undefined}
        />
        <FieldGrid>
          <Field label="Check-in"><input type="date" value={v.checkin_date} onChange={(e) => setV({ ...v, checkin_date: e.target.value })} /></Field>
          <Field label="Horário do check-in"><input type="time" value={v.checkin_time} onChange={(e) => setV({ ...v, checkin_time: e.target.value })} /></Field>
          <Field label="Check-out"><input type="date" value={v.checkout_date} onChange={(e) => setV({ ...v, checkout_date: e.target.value })} /></Field>
          <Field label="Horário do check-out"><input type="time" value={v.checkout_time} onChange={(e) => setV({ ...v, checkout_time: e.target.value })} /></Field>
          <Field label="Estado"><select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as Stay['status'] })}><option value="pending">Sem reserva</option><option value="booked">Reservado</option></select></Field>
          <Field label="Comprovante"><select value={v.document_id} onChange={(e) => setV({ ...v, document_id: e.target.value })}><option value="">Nenhum</option>{resDocs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</select></Field>
        </FieldGrid>
        <Field label="Endereço"><input value={v.address} maxLength={200} onChange={(e) => setV({ ...v, address: e.target.value })} /></Field>
        <Field label="Link da reserva ou do anúncio" error={!linkOk ? 'Use um link que comece com http:// ou https://.' : undefined}><input type="url" inputMode="url" value={v.link_url} maxLength={500} onChange={(e) => setV({ ...v, link_url: e.target.value })} placeholder="https://" /></Field>
        <Field label="Observações"><textarea rows={2} value={v.notes} maxLength={2000} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      </div>
    </Sheet>
  );
}

/** Atividade: dia, hora, título, notas e custo por pessoa (estimativa até alguém confirmar). */
export function ActivitySheet({ stop, act, day, onClose }: { stop: Stop; act: Activity | null; day?: string; onClose: () => void }) {
  const { source, reload, bundle: b } = useBundle();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const days = dateRange(stop.arrival_date, stop.departure_date);
  const [v, setV] = useState({
    day: act?.day ?? day ?? stop.arrival_date, time: hhmm(act?.time), title: act?.title ?? '', notes: act?.notes ?? '',
    price: centsText(act?.cost_cents), currency: act?.cost_currency ?? b.trip.base_currency,
  });
  const priceChanged = v.price !== centsText(act?.cost_cents) || v.currency !== (act?.cost_currency ?? b.trip.base_currency);
  const row = () => {
    const cents = parseMoneyInput(v.price);
    return {
      day: v.day, time: nn(v.time), title: v.title.trim(), notes: nn(v.notes),
      ...(priceChanged || !act ? { cost_cents: cents, cost_currency: cents != null ? v.currency : null, cost_is_estimate: false } : {}),
    };
  };
  const save = () =>
    run(async () => {
      if (act) await source.update('activities', act.id, row(), act.version);
      else await source.insert('activities', { ...row(), suggested_by: null, trip_id: b.trip.id, stop_id: stop.id, position: b.activities.filter((a) => a.stop_id === stop.id && a.day === v.day).length });
      await reload();
      onClose();
    }, { success: 'Plano atualizado.', onConflict: async () => { if (act) await source.update('activities', act.id, row()); await reload(); onClose(); } });
  const del = async () => {
    if (!act || !(await confirm({ title: 'Remover atividade?', message: act.title }))) return;
    await run(() => source.remove('activities', { id: act.id }).then(reload).then(onClose), { success: 'Atividade removida.' });
  };
  return (
    <Sheet open onClose={onClose} title={act ? 'Atividade' : 'Nova atividade'} footer={<Footer onClose={onClose} onSave={() => void save()} disabled={busy || !v.title.trim()} onDelete={act ? () => void del() : undefined} deleteLabel="Remover" />}>
      <div className={s.form}>
        {act ? <PayItem type="activity" id={act.id} /> : null}
        <Field label="O que fazer"><input value={v.title} maxLength={160} required onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
        <FieldGrid>
          <Field label="Dia"><select value={v.day} onChange={(e) => setV({ ...v, day: e.target.value })}>{days.map((d) => <option key={d} value={d}>{dayWeekU(d)}</option>)}</select></Field>
          <Field label="Horário (opcional)"><input type="time" value={v.time} onChange={(e) => setV({ ...v, time: e.target.value })} /></Field>
        </FieldGrid>
        <PriceField
          label="Custo por pessoa" text={v.price} currency={v.currency} currencies={tripCurrencies(b)} onText={(x) => setV({ ...v, price: x })} onCurrency={(c) => setV({ ...v, currency: c })}
          hint={act?.cost_is_estimate && act.cost_cents != null && !priceChanged ? <span className={s.inline}><EstimateBadge /> estimado pela Trilha. Edite para confirmar.</span> : 'Deixe vazio se for grátis ou ainda não souber.'}
        />
        <Field label="Notas"><textarea rows={2} value={v.notes} maxLength={2000} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      </div>
    </Sheet>
  );
}

// ───────────── Sugestão → dia ─────────────

const SLOT_LABEL: Record<DaySlot['state'], string> = { vazio: 'dia vazio', folga: '1 atividade', cheio: 'cheio', aclimatar: 'chegada (aclimatar)', viagem: 'dia de viagem' };

/** "Pôr no dia N": lista os dias da parada com o que já tem em cada um; o dia sugerido vem marcado. */
export function ChooseDaySheet({ suggestion, stop, initial, onClose }: { suggestion: Suggestion; stop: Stop; initial?: string | null; onClose: () => void }) {
  const { bundle: b, source, reload } = useBundle();
  const { run, busy } = useAction();
  const slots = stopSlots(b, stop);
  const [day, setDay] = useState(initial ?? slots.find((x) => x.state === 'vazio' || x.state === 'folga')?.date ?? slots[0]?.date ?? stop.arrival_date);
  const sel = slots.find((x) => x.date === day);
  const save = () =>
    run(async () => {
      await acceptSuggestion(source, b, suggestion, day);
      await reload();
      onClose();
    }, { success: `${suggestion.payload.title} entrou no dia ${sel?.dayNumber ?? ''}.` });
  return (
    <Sheet open onClose={onClose} title="Escolher dia" description={suggestion.payload.title} footer={<Footer onClose={onClose} onSave={() => void save()} saveLabel={sel ? `Pôr no dia ${sel.dayNumber}` : 'Pôr no dia'} disabled={busy} />}>
      <div role="radiogroup" aria-label="Dia" className={s.days}>
        {slots.map((x) => (
          <button key={x.date} type="button" role="radio" aria-checked={day === x.date} className={s.dayOpt} onClick={() => setDay(x.date)}>
            <span className={s.dayNum}><small>DIA</small>{x.dayNumber}</span>
            <span className={s.dayText}><b>{dayWeekU(x.date).toLowerCase()}</b><span>{x.count ? `${x.count} ${x.count === 1 ? 'atividade' : 'atividades'}` : SLOT_LABEL[x.state]}</span></span>
            {initial === x.date ? <span className={s.tagBrand}>sugerido</span> : null}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

// ───────────── Achou um? Cole o link ─────────────

/** Link colado vira opção na votação de hospedagem da parada (cria a votação se não houver). */
export function StayOptionSheet({ stop, link, onClose }: { stop: Stop; link: string; onClose: () => void }) {
  const { bundle: b, source, reload, me } = useBundle();
  const { run, busy } = useAction();
  const host = (() => { try { return new URL(link).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const [v, setV] = useState({ link, label: '', price: '', currency: b.trip.base_currency, detail: '' });
  const save = () =>
    run(async () => {
      const r = await addStayOption(source, b, stop, me, { label: v.label, link: v.link, priceCents: parseMoneyInput(v.price), currency: v.currency, detail: v.detail || (host ? `achado em ${host}` : null) });
      await reload();
      onClose();
      return r;
    }, { success: 'Foi pra votação de hospedagem. A turma vota em Turma › Votos.' });
  return (
    <Sheet open onClose={onClose} title="Mandar pra votação" description="A Trilha não abre o site: confira e preencha o nome e o preço." footer={<Footer onClose={onClose} onSave={() => void save()} saveLabel="Mandar pra votação" disabled={busy || !v.label.trim() || !/^https?:\/\/\S+$/i.test(v.link.trim())} />}>
      <div className={s.form}>
        <Field label="Link"><input type="url" inputMode="url" value={v.link} maxLength={500} onChange={(e) => setV({ ...v, link: e.target.value })} /></Field>
        <Field label="Nome" hint="Como a turma vai reconhecer (ex.: “Casa azul em San Blas”)."><input value={v.label} maxLength={80} autoFocus onChange={(e) => setV({ ...v, label: e.target.value })} /></Field>
        <PriceField label="Preço por noite" text={v.price} currency={v.currency} currencies={tripCurrencies(b)} onText={(x) => setV({ ...v, price: x })} onCurrency={(c) => setV({ ...v, currency: c })} hint="Total do quarto ou da casa por noite, como aparece no site." />
        <Field label="Detalhe (opcional)"><input value={v.detail} maxLength={300} placeholder="café incluso, quarto de 4…" onChange={(e) => setV({ ...v, detail: e.target.value })} /></Field>
      </div>
    </Sheet>
  );
}
