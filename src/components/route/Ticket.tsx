'use client';
// "Como chego" como bilhete (canvas "cidade e reservas", fase 3). Três estados:
//  · estimado: o trecho que falta comprar, com a estimativa e a busca pronta;
//  · registrando: soltar o PDF/foto ou colar o e-mail (lido no aparelho), ou responder 3 perguntas curtas;
//  · comprado: o bilhete, onde tocar num dado corrige só aquele dado.
// O formulário completo continua em "Mais detalhes" (TransportSheet), para trem, ônibus, carro e o resto.
import { useMemo, useRef, useState } from 'react';
import { PayItem } from '../money/ExpenseSheet';
import { EstimateBadge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { useAction } from '../ui/feedback';
import { Busy } from '../ui/Loader';
import { formatMoneyTyping, parseMoneyInput } from '../ui/MoneyInput';
import { Icon } from '../ui/primitives';
import { Sheet } from '../ui/Sheet';
import { useBundle } from '../../data/TripContext';
import type { Stop, Transport, TransportMode, TripBundle } from '../../data/types';
import { airport } from '../../lib/airports';
import { durationLabel, sortedStops, transportMinutes } from '../../lib/derive';
import { dayMonth, hhmm, MODE_LABEL } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { isBooked } from '../../lib/route';
import { parsedCount, parseTicket, type ParsedTicket } from '../../lib/ticketParse';
import { TransportSheet } from './RouteSheets';
import s from './ticket.module.css';

const NOUN: Record<TransportMode, [string, string]> = {
  plane: ['voo', 'voos'], train: ['trem', 'trens'], bus: ['ônibus', 'ônibus'], boat: ['barco', 'barcos'], car: ['carro', 'carros'], walk: ['caminho', 'caminhos'], other: ['trecho', 'trechos'],
};
const BOOKABLE: TransportMode[] = ['plane', 'train', 'bus', 'boat'];
const nn = (v: string | null | undefined) => (v == null || v.trim() === '' ? null : v.trim());

interface Ends { fromName: string; fromCode: string | null; toName: string; toCode: string | null; fromTz: string | null; toTz: string | null }

/** Pontas do trecho: o que está gravado; senão a parada anterior (ou a origem da viagem) e a parada. */
function endsOf(b: TripBundle, stop: Stop, t: Transport | null, isReturn: boolean): Ends {
  const stops = sortedStops(b);
  const i = stops.findIndex((x) => x.id === stop.id);
  const prev = isReturn ? stop : stops[i - 1] ?? null;
  const fromCode = t?.origin_code ?? (prev ? prev.code ?? null : null);
  const toCode = t?.dest_code ?? (isReturn ? null : stop.code ?? null);
  return {
    fromName: t?.origin_name ?? prev?.name ?? airport(fromCode)?.city ?? b.trip.origin ?? 'casa',
    fromCode: fromCode?.length === 3 ? fromCode : null,
    toName: t?.dest_name ?? (isReturn ? b.trip.origin ?? 'casa' : stop.name),
    toCode: toCode?.length === 3 ? toCode : null,
    fromTz: t?.depart_tz ?? airport(fromCode)?.tz ?? prev?.tz ?? b.trip.home_tz ?? null,
    toTz: t?.arrive_tz ?? airport(toCode)?.tz ?? (isReturn ? b.trip.home_tz ?? null : stop.tz ?? null),
  };
}

function searchUrl(mode: TransportMode, e: Ends, date: string | null): string {
  if (mode === 'plane') {
    const q = `Voos de ${e.fromCode ?? e.fromName} para ${e.toCode ?? e.toName}${date ? ` em ${date}` : ''}`;
    return `https://www.google.com/travel/flights?hl=pt-BR&q=${encodeURIComponent(q)}`;
  }
  return `https://www.rome2rio.com/map/${encodeURIComponent(e.fromName)}/${encodeURIComponent(e.toName)}`;
}

/** "à tarde" / "de manhã" / "à noite" / "de madrugada" a partir do horário local. */
function turno(time: string | null | undefined): string | null {
  if (!time) return null;
  const h = Number(time.slice(0, 2));
  return h < 5 ? 'de madrugada' : h < 12 ? 'de manhã' : h < 18 ? 'à tarde' : 'à noite';
}

export function TicketSheet({ stop, t, isReturn = false, onClose }: { stop: Stop; t: Transport | null; isReturn?: boolean; onClose: () => void }) {
  const { bundle: b, canEdit } = useBundle();
  const [advanced, setAdvanced] = useState(false);
  const [registering, setRegistering] = useState(false);
  const ends = useMemo(() => endsOf(b, stop, t, isReturn), [b, stop, t, isReturn]);
  if (advanced) return <TransportSheet stop={stop} t={t} onClose={onClose} />;
  const mode: TransportMode = t?.mode ?? (isReturn ? 'plane' : stop.arrival_mode ?? 'plane');
  const bookable = BOOKABLE.includes(mode);
  const bought = !!t && (isBooked(b, t) || !bookable);
  const title = isReturn ? `Volta para ${ends.toName}` : `Como vocês chegam em ${stop.name}`;

  return (
    <Sheet
      open onClose={onClose} variant="panel" title={title}
      description={bought ? `${MODE_LABEL[mode] ?? 'Trecho'} · ${t?.booking_ref ? 'comprado' : bookable ? 'pago' : 'sem reserva'}` : registering ? 'Registrar a compra' : `${MODE_LABEL[mode] ?? 'Trecho'} · falta comprar`}
      footer={canEdit && !registering ? (
        <Button variant="ghost" onClick={() => setAdvanced(true)}>Mais detalhes</Button>
      ) : undefined}
    >
      {registering ? (
        <Register stop={stop} t={t} mode={mode} ends={ends} isReturn={isReturn} onDone={() => setRegistering(false)} />
      ) : bought ? (
        <Bought t={t!} mode={mode} ends={ends} />
      ) : (
        <Estimate stop={stop} t={t} mode={mode} ends={ends} onBought={canEdit ? () => setRegistering(true) : undefined} />
      )}
    </Sheet>
  );
}

// ───────────── Estimado ─────────────

function Estimate({ stop, t, mode, ends, onBought }: { stop: Stop; t: Transport | null; mode: TransportMode; ends: Ends; onBought?: () => void }) {
  const date = t?.depart_date ?? stop.arrival_date;
  const min = t ? transportMinutes(t) ?? t.duration_min : null;
  const price = t?.price_cents;
  const cur = t?.price_currency ?? 'BRL';
  return (
    <div className={s.wrap}>
      <div className={s.dashed}>
        <div className={s.route}>
          <span className={s.end}><b>{ends.fromCode ?? ends.fromName}</b>{ends.fromCode ? <small>{ends.fromName}</small> : null}</span>
          <Icon name="arrow" size={22} />
          <span className={`${s.end} ${s.endRight}`}><b>{ends.toCode ?? ends.toName}</b>{ends.toCode ? <small>{ends.toName}</small> : null}</span>
        </div>
        <span className={s.when}>{dayMonth(date)}{min ? ` · umas ${durationLabel(min)} de viagem` : ''}</span>
      </div>
      <p className={s.lead}>
        {price != null
          ? <>Para esse trecho, {t?.price_is_estimate ? 'a Trilha estima' : 'a turma anotou'} <b className="num">{t?.price_is_estimate ? 'perto de ' : ''}{formatMoney(price, cur, { compact: true })} por pessoa</b>. {t?.price_is_estimate ? <EstimateBadge /> : null}</>
          : `Ainda sem valor para esse ${NOUN[mode][0]}.`}
      </p>
      <div className={s.actions}>
        <a className={s.primary} href={searchUrl(mode, ends, date)} target="_blank" rel="noopener noreferrer">
          Procurar {NOUN[mode][1]} para {dayMonth(date)} <span aria-hidden="true">↗</span>
        </a>
        {onBought ? <button type="button" className={s.secondary} onClick={onBought}>Já compramos</button> : null}
      </div>
      <p className={s.note}>A Trilha não vende passagem: a busca abre fora, com origem, destino e data.</p>
    </div>
  );
}

// ───────────── Registrar ─────────────

function Register({ stop, t, mode, ends, isReturn, onDone }: { stop: Stop; t: Transport | null; mode: TransportMode; ends: Ends; isReturn: boolean; onDone: () => void }) {
  const { bundle: b, source, reload } = useBundle();
  const { run, busy } = useAction();
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [readErr, setReadErr] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [read, setRead] = useState<ParsedTicket | null>(null);
  const [step, setStep] = useState(0);
  const [v, setV] = useState({
    booking_ref: t?.booking_ref ?? '', depart_time: hhmm(t?.depart_time), arrive_time: hhmm(t?.arrive_time),
    depart_date: t?.depart_date ?? stop.arrival_date, arrive_date: t?.arrive_date ?? stop.arrival_date, seat: t?.seat ?? '',
    origin_code: t?.origin_code ?? ends.fromCode ?? '', dest_code: t?.dest_code ?? ends.toCode ?? '', flight: '',
    price: '', samePrice: null as boolean | null,
  });
  const cur = t?.price_currency ?? b.trip.base_currency;
  const year = Number(stop.arrival_date.slice(0, 4));

  const apply = (p: ParsedTicket) => {
    setRead(p);
    setV((cur0) => ({
      ...cur0,
      booking_ref: p.booking_ref ?? cur0.booking_ref, depart_time: p.depart_time ?? cur0.depart_time, arrive_time: p.arrive_time ?? cur0.arrive_time,
      depart_date: p.depart_date ?? cur0.depart_date, arrive_date: p.arrive_date ?? p.depart_date ?? cur0.arrive_date, seat: p.seat ?? cur0.seat,
      origin_code: p.origin_code ?? cur0.origin_code, dest_code: p.dest_code ?? cur0.dest_code, flight: p.flight ?? cur0.flight,
    }));
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setReading(true);
    setReadErr(null);
    const { extract, validateFile } = await import('../../lib/extract');
    const bad = validateFile(f);
    if (bad) { setReadErr(bad); setReading(false); return; }
    const r = await extract(f);
    setReading(false);
    if (r.error) { setReadErr(r.error); return; }
    const p = parseTicket(r.text, year);
    if (!parsedCount(p)) { setReadErr('Não achei os dados do bilhete nesse arquivo. Responda abaixo, é rapidinho.'); return; }
    apply(p);
  };
  const onPaste = () => {
    const p = parseTicket(pasted, year);
    if (!parsedCount(p)) { setReadErr('Não achei os dados do bilhete nesse texto. Responda abaixo, é rapidinho.'); return; }
    setReadErr(null);
    apply(p);
  };

  const save = () =>
    run(async () => {
      const oc = nn(v.origin_code.toUpperCase());
      const dc = nn(v.dest_code.toUpperCase());
      const cents = v.samePrice === false ? parseMoneyInput(v.price) : null;
      const row = {
        mode, origin_code: oc, dest_code: dc,
        origin_name: t?.origin_name ?? (airport(oc)?.city ?? ends.fromName),
        dest_name: t?.dest_name ?? (airport(dc)?.city ?? ends.toName),
        depart_date: nn(v.depart_date), depart_time: nn(v.depart_time), arrive_date: nn(v.arrive_date), arrive_time: nn(v.arrive_time),
        // Fuso deduzido do aeroporto (ou das paradas): a duração sai sozinha, ninguém digita fuso.
        depart_tz: t?.depart_tz ?? airport(oc)?.tz ?? ends.fromTz, arrive_tz: t?.arrive_tz ?? airport(dc)?.tz ?? ends.toTz,
        booking_ref: nn(v.booking_ref.toUpperCase()), seat: nn(v.seat),
        notes: v.flight ? [t?.notes, `Voo ${v.flight}`].filter(Boolean).join('\n').slice(0, 2000) : t?.notes ?? null,
        ...(v.samePrice === true && t?.price_cents != null ? { price_is_estimate: false } : {}),
        ...(cents != null ? { price_cents: cents, price_currency: cur, price_is_estimate: false } : {}),
      };
      if (t) await source.update('transports', t.id, row, t.version);
      else await source.insert('transports', { ...row, trip_id: b.trip.id, stop_id: stop.id, is_return: isReturn, duration_min: null, document_id: null });
      await reload();
      onDone();
    }, { success: 'Bilhete guardado. Bom voo!', onConflict: async () => { if (t) await source.update('transports', t.id, { booking_ref: nn(v.booking_ref.toUpperCase()) }); await reload(); onDone(); } });

  const estimate = t?.price_cents != null ? formatMoney(t.price_cents, cur, { compact: true }) : null;
  const STEPS = 3;

  return (
    <div className={s.wrap}>
      {!read ? (
        <>
          <h3 className={s.h3}>Boa! Manda o que a companhia mandou</h3>
          <button type="button" className={s.drop} onClick={() => fileRef.current?.click()} disabled={reading}>
            <Icon name="upload" size={26} />
            <b>{reading ? <Busy>Lendo no seu aparelho</Busy> : 'Escolher o PDF ou a foto da passagem'}</b>
            <span>A Trilha lê aqui mesmo: horários, localizador e poltrona.</span>
          </button>
          <input ref={fileRef} type="file" accept="application/pdf,image/*" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
          <label className={s.pasteLabel} htmlFor="ticket-paste">ou cole o e-mail de confirmação</label>
          <textarea id="ticket-paste" className={s.paste} rows={3} value={pasted} placeholder="Cole aqui o texto do e-mail" onChange={(e) => setPasted(e.target.value)} />
          {pasted.trim().length > 20 ? <Button variant="secondary" size="sm" onClick={onPaste}>Ler o e-mail</Button> : null}
          {readErr ? <p className={s.err} role="alert">{readErr}</p> : null}
          <div className={s.or}><span />ou responda rapidinho<span /></div>
          <div className={s.steps} aria-live="polite">
            <span className={s.stepCount}>{step + 1} de {STEPS}</span>
            {step === 0 ? (
              <label className={s.q}>
                <span>Qual é o localizador?</span>
                <input autoFocus value={v.booking_ref} maxLength={12} placeholder="Ex.: QX7P2M" onChange={(e) => setV({ ...v, booking_ref: e.target.value.toUpperCase() })} />
                <small>Seis letras e números, no e-mail da companhia.</small>
              </label>
            ) : step === 1 ? (
              <div className={s.q}>
                <span>Que horas sai e que horas chega?</span>
                <div className={s.timeRow}>
                  <label>sai {dayMonth(v.depart_date)}<input type="time" value={v.depart_time} onChange={(e) => setV({ ...v, depart_time: e.target.value })} /></label>
                  <label>chega<input type="date" value={v.arrive_date} onChange={(e) => setV({ ...v, arrive_date: e.target.value })} /></label>
                  <label>às<input type="time" value={v.arrive_time} onChange={(e) => setV({ ...v, arrive_time: e.target.value })} /></label>
                </div>
                <small>Horário local de cada cidade, como está no bilhete. O fuso a Trilha descobre.</small>
              </div>
            ) : (
              <div className={s.q}>
                <span>Quanto pagaram por pessoa?</span>
                <div className={s.chips}>
                  {estimate ? <button type="button" aria-pressed={v.samePrice === true} className={s.chip} onClick={() => setV({ ...v, samePrice: true })}>{t?.price_is_estimate ? `≈ ${estimate}, como estimado` : estimate}</button> : null}
                  <button type="button" aria-pressed={v.samePrice === false} className={s.chip} onClick={() => setV({ ...v, samePrice: false })}>Outro valor</button>
                </div>
                {v.samePrice === false ? <input inputMode="decimal" autoFocus value={v.price} placeholder={`0,00 ${cur}`} onChange={(e) => setV({ ...v, price: formatMoneyTyping(e.target.value) })} /> : null}
              </div>
            )}
          </div>
          <div className={s.actions}>
            {step < STEPS - 1 ? (
              <>
                <button type="button" className={s.primaryBtn} onClick={() => setStep(step + 1)}>{step === 0 && !v.booking_ref ? 'Pular' : 'Próxima'}</button>
                {step > 0 ? <button type="button" className={s.secondary} onClick={() => setStep(step - 1)}>Voltar</button> : <button type="button" className={s.secondary} onClick={onDone}>Cancelar</button>}
              </>
            ) : (
              <>
                <button type="button" className={s.primaryBtn} onClick={() => void save()} disabled={busy}>{busy ? <Busy>Guardando</Busy> : 'Guardar o bilhete'}</button>
                <button type="button" className={s.secondary} onClick={() => setStep(step - 1)}>Voltar</button>
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <h3 className={s.h3}>A Trilha leu {parsedCount(read)} {parsedCount(read) === 1 ? 'dado' : 'dados'}. Está certo?</h3>
          <div className={s.readList}>
            {([
              ['flight', 'voo'], ['origin_code', 'sai de'], ['dest_code', 'chega em'], ['depart_date', 'data de saída'], ['depart_time', 'hora de saída'],
              ['arrive_date', 'data de chegada'], ['arrive_time', 'hora de chegada'], ['booking_ref', 'localizador'], ['seat', 'poltronas'],
            ] as [keyof typeof v, string][]).map(([k, label]) => (
              <label key={k} className={`${s.readRow} ${read[k as keyof ParsedTicket] ? s.found : ''}`}>
                <span>{label}</span>
                <input type={k.endsWith('date') ? 'date' : k.endsWith('time') ? 'time' : 'text'} value={String(v[k] ?? '')} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
              </label>
            ))}
          </div>
          <p className={s.note}>Em destaque o que veio do arquivo. Corrija o que precisar antes de guardar.</p>
          <div className={s.actions}>
            <button type="button" className={s.primaryBtn} onClick={() => void save()} disabled={busy}>{busy ? <Busy>Guardando</Busy> : 'Está certo, guardar'}</button>
            <button type="button" className={s.secondary} onClick={() => setRead(null)}>Ler outro arquivo</button>
          </div>
        </>
      )}
    </div>
  );
}

// ───────────── Comprado ─────────────

type EditKey = 'booking_ref' | 'seat' | 'depart_time' | 'arrive_time' | 'depart_date' | 'arrive_date';

function Bought({ t, mode, ends }: { t: Transport; mode: TransportMode; ends: Ends }) {
  const { bundle: b, source, reload, canEdit, base } = useBundle();
  const { run } = useAction();
  const [edit, setEdit] = useState<EditKey | null>(null);
  const [val, setVal] = useState('');
  const min = transportMinutes(t) ?? t.duration_min;
  const doc = t.document_id ? b.documents.find((d) => d.id === t.document_id) : null;
  const flight = t.notes?.match(/Voo ([A-Z0-9]{2} ?\d{1,4})/)?.[1] ?? null;
  const when = turno(t.arrive_time);
  const open = (k: EditKey) => { if (!canEdit) return; setEdit(k); setVal(k.endsWith('time') ? hhmm(t[k]) : String(t[k] ?? '')); };
  const commit = () =>
    run(async () => {
      if (!edit) return;
      const v = edit === 'booking_ref' ? nn(val.toUpperCase()) : nn(val);
      await source.update('transports', t.id, { [edit]: v }, t.version);
      await reload();
      setEdit(null);
    }, { success: 'Corrigido.', onConflict: async () => { if (edit) await source.update('transports', t.id, { [edit]: nn(val) }); await reload(); setEdit(null); } });

  // Função de render (não componente): um componente criado aqui dentro remontaria o input a cada tecla.
  const field = (k: EditKey, label: string, children: React.ReactNode) => (
    edit === k ? (
      <form className={s.inlineEdit} onSubmit={(e) => { e.preventDefault(); void commit(); }}>
        <label className="sr" htmlFor={`tk-${k}`}>{label}</label>
        <input id={`tk-${k}`} autoFocus type={k.endsWith('date') ? 'date' : k.endsWith('time') ? 'time' : 'text'} value={val} onChange={(e) => setVal(e.target.value)} onBlur={() => void commit()} />
      </form>
    ) : canEdit ? (
      <button type="button" className={s.cell} onClick={() => open(k)} aria-label={`${label}: corrigir`}>{children}</button>
    ) : <span className={s.cell}>{children}</span>
  );

  return (
    <div className={s.wrap}>
      <article className={s.ticket} aria-label="Bilhete">
        <div className={s.ticketTop}>
          <div className={s.ticketHead}>
            <span className={s.carrier}>{[MODE_LABEL[mode], flight].filter(Boolean).join(' · ')}</span>
            {t.booking_ref ? <span className={s.paid}>Comprado</span> : null}
          </div>
          <div className={s.ticketRoute}>
            <div className={s.tEnd}>
              <b>{t.origin_code ?? ends.fromCode ?? ends.fromName}</b>
              {field('depart_time', 'Hora de saída', <><small>{dayMonth(t.depart_date)}{t.depart_time ? ` · ${hhmm(t.depart_time)}` : ' · horário?'}</small></>)}
            </div>
            <span className={s.dur}>{min ? durationLabel(min) : ''}</span>
            <div className={`${s.tEnd} ${s.tRight}`}>
              <b>{t.dest_code ?? ends.toCode ?? ends.toName}</b>
              {field('arrive_time', 'Hora de chegada', <><small>{dayMonth(t.arrive_date)}{t.arrive_time ? ` · ${hhmm(t.arrive_time)}` : ' · horário?'}</small></>)}
            </div>
          </div>
          {when ? <p className={s.story}>Vocês chegam em {ends.toName} {when}, no horário local.{t.depart_tz && t.arrive_tz && t.depart_tz !== t.arrive_tz ? ' O fuso muda no caminho: a Trilha já conta isso na duração.' : ''}</p> : null}
        </div>
        <div className={s.perf} aria-hidden="true" />
        <dl className={s.ticketGrid}>
          <div><dt>localizador</dt><dd>{field('booking_ref', 'Localizador', <>{t.booking_ref ?? 'tocar para pôr'}</>)}</dd></div>
          <div><dt>poltronas</dt><dd>{field('seat', 'Poltronas', <>{t.seat ?? '—'}</>)}</dd></div>
          <div><dt>por pessoa</dt><dd><span className={s.cell}>{t.price_cents != null ? formatMoney(t.price_cents, t.price_currency ?? b.trip.base_currency, { compact: true }) : '—'}</span></dd></div>
        </dl>
      </article>
      {canEdit ? <p className={s.note}>Toque num dado do bilhete para corrigir só ele.</p> : null}
      <div className={s.links}>
        {doc ? <a className={s.linkRow} href={`${base}/turma/documentos?doc=${doc.id}`}><Icon name="doc" size={18} />Abrir a passagem: {doc.title}</a> : null}
        <PayItem type="transport" id={t.id} />
      </div>
    </div>
  );
}
