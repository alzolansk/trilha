'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Dialog, useAction, useConfirm, useToast } from '../components/ui/feedback';
import { AiNote, Icon } from '../components/ui/primitives';
import { useBundle } from '../data/TripContext';
import type { InspirationValue, JournalEntry, JournalPhoto, Stop, TripBundle } from '../data/types';
import { callAi } from '../lib/ai/client';
import { track } from '../lib/analytics';
import { sortedStops, stopDates, stopIndexOn, tripPhase } from '../lib/derive';
import { dayMonth, initials, plural } from '../lib/format';
import { CYCLE } from '../lib/identity/accent';
import { compressImage } from '../lib/image';
import { inspirationScore, myInspirationVote } from '../lib/polls';
import { ruleRetro } from '../lib/rules';
import { dateRange, todayIn } from '../lib/time';
import { Badge, Button, Card, Chip, EmptyState, Field, FieldGrid, IconButton, ScreenHeader, Segmented } from '../components/ui';
import s from './diario.module.css';

type Tab = 'antes' | 'durante' | 'depois';
const TABS: [Tab, string, string, string, string][] = [
  ['antes', 'Antes', 'Mural de inspirações', 'Salve fotos, links e lugares que você quer ver. Eles aparecem na parada certa do roteiro.', 'Salvar inspiração'],
  ['durante', 'Durante', 'Um registro por dia', 'Escreva uma linha sobre o dia e junte as fotos. Fica organizado por parada.', 'Escrever hoje'],
  ['depois', 'Depois', 'Sua retrospectiva', 'Quando a viagem acaba, montamos um resumo com o trajeto, as melhores fotos e os números, na identidade da sua trilha.', 'Gerar retrospectiva'],
];

/** URLs temporárias (assinadas) das fotos do diário, com cache em memória. */
const urlCache = new Map<string, { url: string; exp: number }>();
function usePhotoUrl(path: string | null | undefined) {
  const { source } = useBundle();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return setUrl(null);
    const hit = urlCache.get(path);
    if (hit && hit.exp > Date.now()) return setUrl(hit.url);
    let alive = true;
    source.signedUrl('journal', path, 3600).then((u) => {
      urlCache.set(path, { url: u, exp: Date.now() + 3300_000 });
      if (alive) setUrl(u);
    }).catch(() => alive && setUrl(null));
    return () => {
      alive = false;
    };
  }, [path, source]);
  return url;
}

export default function Diario() {
  const { bundle: b, canEdit, source, reload, me } = useBundle();
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const { run } = useAction();
  const phase = tripPhase(b.trip);
  const tabParam = params.get('momento') as Tab | null;
  const tab: Tab = tabParam && ['antes', 'durante', 'depois'].includes(tabParam) ? tabParam : phase.kind === 'after' ? 'depois' : phase.kind === 'before' ? 'antes' : 'durante';
  const t = TABS.find((x) => x[0] === tab)!;
  const stops = useMemo(() => sortedStops(b), [b]);
  const cols = CYCLE;
  const [entryDlg, setEntryDlg] = useState<{ entry: JournalEntry | null; stopId: string | null } | null>(null);
  const [stopDlg, setStopDlg] = useState<Stop | null>(null);
  const [genBusy, setGenBusy] = useState(false);

  const kind = tab === 'antes' ? 'inspiracao' : 'registro';
  const entries = b.journalEntries.filter((e) => e.kind === kind);

  const setTab = (k: Tab) => router.replace(`?momento=${k}`, { scroll: false });

  const cta = async () => {
    if (tab === 'depois') {
      setGenBusy(true);
      if (source.kind === 'supabase') {
        const r = await callAi('retro', { tripId: b.trip.id });
        if (r) await reload();
        else toast('Não deu pra gerar agora. Confira a conexão e tente de novo.');
      } else toast('Na demonstração a retrospectiva não é salva.');
      setGenBusy(false);
      return;
    }
    const today = todayIn(b.trip.departure_tz);
    setEntryDlg({ entry: null, stopId: stops.length ? stops[stopIndexOn(stops, today)].id : null });
  };

  const favorite = (e: JournalEntry) => run(() => source.update('journal_entries', e.id, { favorite: !e.favorite }).then(reload));

  return (
    <div className="wrap">
      <ScreenHeader
        title="Diário"
        eyebrow={b.trip.title}
        subtitle="Fotos e memórias organizadas por parada."
        action={<Segmented label="Momento" value={tab} onChange={setTab} options={TABS.map((x) => ({ value: x[0], label: x[1] }))} />}
      />
      <Card variant="dark" pad="lg" className={s.banner}>
        <div className={s.bannerText}>
          <h2 className={s.bannerTitle}>{t[2]}</h2>
          <p>{t[3]}</p>
        </div>
        {canEdit ? <Button variant="primary" icon="sparkle" onClick={cta} disabled={genBusy}>{genBusy ? 'Gerando…' : tab === 'depois' && b.retro ? 'Gerar de novo' : t[4]}</Button> : null}
      </Card>

      {tab === 'depois' ? <Retro /> : null}

      {stops.length ? (
        <section aria-label="Paradas" className={s.grid}>
          {stops.map((st, i) => {
            const es = entries.filter((e) => e.stop_id === st.id);
            const photos = b.journalPhotos.filter((p) => es.some((e) => e.id === p.entry_id));
            const last = es.at(-1);
            return (
              <DiaryCard key={st.id} stop={st} color={cols[i % 4]} entry={last ?? null} photos={photos} count={es.length} tab={tab} summary={tab === 'antes' ? favoriteSummary(b, es) : null}
                onOpen={() => setStopDlg(st)} onFav={last ? () => void favorite(last) : undefined} />
            );
          })}
        </section>
      ) : (
        <EmptyState icon="route" title="Sem paradas ainda" text="O diário se organiza pelas paradas do roteiro." />
      )}
      {entries.some((e) => !e.stop_id) ? (
        <section className={s.loose}>
          <h2 className={s.h2}>Sem parada</h2>
          <EntryList entries={entries.filter((e) => !e.stop_id)} onEdit={(e) => setEntryDlg({ entry: e, stopId: null })} />
        </section>
      ) : null}

      {stopDlg ? (
        <Dialog open onClose={() => setStopDlg(null)} title={stopDlg.name}>
          <span className={s.mono}>{stopDates(stopDlg, true)} · {tab === 'antes' ? 'INSPIRAÇÕES' : 'REGISTROS'}</span>
          <EntryList entries={byScore(b, entries.filter((e) => e.stop_id === stopDlg.id), tab === 'antes')} onEdit={(e) => { setStopDlg(null); setEntryDlg({ entry: e, stopId: stopDlg.id }); }} />
          {canEdit ? <Button icon="plus" onClick={() => { setEntryDlg({ entry: null, stopId: stopDlg.id }); setStopDlg(null); }}>{tab === 'antes' ? 'Nova inspiração' : 'Novo registro'}</Button> : null}
        </Dialog>
      ) : null}
      {entryDlg ? <EntryDialog entry={entryDlg.entry} stopId={entryDlg.stopId} kind={kind} phase={tab} onClose={() => setEntryDlg(null)} me={me} /> : null}
    </div>
  );
}

/** Inspirações mais queridas primeiro (score do termômetro); empate mantém a ordem original. */
function byScore(b: TripBundle, es: JournalEntry[], on: boolean): JournalEntry[] {
  if (!on) return es;
  const score = new Map(es.map((e) => [e.id, inspirationScore(b, e.id).score]));
  return [...es].sort((x, y) => score.get(y.id)! - score.get(x.id)!);
}

/** "3 inspirações · mais querida: X", só quando alguém já reagiu. */
function favoriteSummary(b: TripBundle, es: JournalEntry[]): string | null {
  const scored = es.map((e) => ({ e, t: inspirationScore(b, e.id) })).filter(({ t }) => t.muito.length + t.topo.length + t.passo.length > 0);
  if (!scored.length) return null;
  const top = scored.reduce((a, c) => (c.t.score > a.t.score ? c : a));
  return `${plural(es.length, 'inspiração', 'inspirações')} · mais querida: ${entryTitle(top.e)}`;
}

const entryTitle = (e: JournalEntry) => e.title || e.place_name || (e.entry_date ? dayMonth(e.entry_date) : 'Registro');

function DiaryCard({ stop, color, entry, photos, count, tab, summary, onOpen, onFav }: { stop: Stop; color: string; entry: JournalEntry | null; photos: JournalPhoto[]; count: number; tab: Tab; summary: string | null; onOpen: () => void; onFav?: () => void }) {
  const url = usePhotoUrl(photos[0]?.storage_path);
  return (
    <Card as="article" pad="md" className={s.stopCard}>
      <button className={s.cardBtn} onClick={onOpen} aria-label={`Abrir ${tab === 'antes' ? 'inspirações' : 'registros'} de ${stop.name}`}>
        <div className={s.cover} style={url ? { background: `center/cover no-repeat url("${url}")` } : { background: `repeating-linear-gradient(135deg, color-mix(in srgb, ${color} 22%, var(--field)) 0 16px, var(--field) 16px 32px)` }}>
          {!url ? <span className={s.coverIcon}><Icon name="camera" size={26} /></span> : null}
        </div>
        <div className={s.cardHead}>
          <h2 className={s.cardTitle}>{stop.name}</h2>
          <span className={s.mono}>{stopDates(stop, true)}</span>
        </div>
        <p className={s.cardText}>
          {entry?.body?.slice(0, 140) || entry?.title || (tab === 'antes' ? `[Salve lugares que quer ver em ${stop.name}]` : `[Escreva como foi em ${stop.name}]`)}
        </p>
        {summary ? <p className={`${s.mono} ${s.summary}`}>{summary}</p> : null}
      </button>
      <div className={s.cardFoot}>
        <Badge upper>{photos.length} {photos.length === 1 ? 'FOTO' : 'FOTOS'}</Badge>
        {count > 1 ? <Badge upper>{count} REGISTROS</Badge> : null}
        <button aria-label="Favoritar" aria-pressed={!!entry?.favorite} disabled={!onFav} className={s.fav} onClick={onFav}>
          <Icon name="heart" size={20} fill={entry?.favorite ? 'currentColor' : 'none'} />
        </button>
      </div>
    </Card>
  );
}

function Photo({ p, onDelete }: { p: JournalPhoto; onDelete?: () => void }) {
  const url = usePhotoUrl(p.storage_path);
  return (
    <figure className={s.photo}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt={p.caption ?? 'Foto do diário'} loading="lazy" /> : <div className="skel" style={{ height: '100%' }} />}
      {onDelete ? <IconButton icon="close" label="Remover foto" variant="light" size={40} className={s.rm} onClick={onDelete} /> : null}
    </figure>
  );
}

function EntryList({ entries, onEdit }: { entries: JournalEntry[]; onEdit: (e: JournalEntry) => void }) {
  const { bundle: b, me, profileOf, canEdit } = useBundle();
  if (!entries.length) return <p className={s.none}>Nada por aqui ainda.</p>;
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {entries.map((e) => (
        <li key={e.id} className={s.entry}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
            <b>{entryTitle(e)}</b>
            <span className={s.mono}>{profileOf(e.author_id)?.display_name ?? ''}{e.favorite ? ' · ♥' : ''}</span>
          </div>
          {e.body ? <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{e.body}</p> : null}
          {e.place_name ? <Badge>{e.place_name}</Badge> : null}
          {e.link_url ? <a href={e.link_url} target="_blank" rel="noopener noreferrer nofollow" style={{ wordBreak: 'break-all' }}>{e.link_url}</a> : null}
          <div className={s.photos}>{b.journalPhotos.filter((p) => p.entry_id === e.id).map((p) => <Photo key={p.id} p={p} />)}</div>
          {e.kind === 'inspiracao' ? <Reactions entry={e} /> : null}
          <div className={s.entryActions}>
            {e.kind === 'inspiracao' ? <InRoute entry={e} /> : null}
            {canEdit && e.author_id === me ? <Button variant="secondary" size="sm" onClick={() => onEdit(e)}>Editar</Button> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

const REACTIONS: [InspirationValue, string, string][] = [[2, 'Quero muito', 'QUERO MUITO'], [1, 'Topo', 'TOPO'], [-1, 'Passo', 'PASSO']];

/** Termômetro da turma: todo membro reage (inclusive quem só consulta). Clicar de novo retira. */
function Reactions({ entry }: { entry: JournalEntry }) {
  const { bundle: b, me, role, source, reload, profileOf } = useBundle();
  const { run, busy } = useAction();
  const t = inspirationScore(b, entry.id);
  const mine = myInspirationVote(b, entry.id, me);
  const who: Record<InspirationValue, string[]> = { 2: t.muito, 1: t.topo, [-1]: t.passo };
  const react = (value: InspirationValue) =>
    run(async () => {
      if (mine === value) await source.remove('inspiration_votes', { entry_id: entry.id, user_id: me });
      else {
        await source.upsert('inspiration_votes', { entry_id: entry.id, trip_id: b.trip.id, user_id: me, value, updated_at: new Date().toISOString() }, 'entry_id,user_id');
        if (source.kind === 'supabase') track('inspiration.reacted', { value }, b.trip.id);
      }
      await reload();
    });
  const name = (uid: string) => profileOf(uid)?.display_name ?? 'Ex-membro';
  return (
    <div className={s.reactions}>
      <div role="group" aria-label={`Termômetro da turma para ${entryTitle(entry)}`} className={s.reactBtns}>
        {REACTIONS.map(([v, label]) => (
          <Chip key={v} size="sm" selected={mine === v} disabled={!role || busy} onClick={() => void react(v)} count={who[v].length}
            aria-label={`${label}, ${plural(who[v].length, 'pessoa', 'pessoas')}`}>
            {label}
          </Chip>
        ))}
      </div>
      {t.muito.length + t.topo.length + t.passo.length ? (
        <p className={s.voters}>
          {REACTIONS.filter(([v]) => who[v].length).map(([v, , tag], i) => (
            <span key={v}>
              {i ? ' · ' : ''}{tag}:{' '}
              {who[v].map((uid, j) => <span key={uid}>{j ? ', ' : ''}<abbr title={name(uid)}>{initials(name(uid))}</abbr></span>)}
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

/** Pílula "NO ROTEIRO · dia" quando a inspiração já virou atividade; senão, botão para levar. */
function InRoute({ entry }: { entry: JournalEntry }) {
  const { bundle: b, base, canEdit } = useBundle();
  const [open, setOpen] = useState(false);
  const act = b.activities.find((a) => a.from_entry_id === entry.id);
  if (act) {
    return (
      <Link className={s.inRoute} href={`${base}/roteiro/${act.stop_id}`}>
        NO ROTEIRO · {dayMonth(act.day).toUpperCase()}
      </Link>
    );
  }
  if (!canEdit || !b.stops.length) return null;
  return (
    <>
      <Button size="sm" variant="secondary" icon="plus" onClick={() => setOpen(true)}>Levar pro roteiro</Button>
      {open ? <PromoteDialog entry={entry} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function PromoteDialog({ entry, onClose }: { entry: JournalEntry; onClose: () => void }) {
  const { bundle: b, source, reload } = useBundle();
  const { run, busy } = useAction();
  const stops = sortedStops(b);
  // Padrão: primeiro dia da parada sem atividade; senão, o primeiro.
  const defaultDay = (st: Stop) => {
    const days = dateRange(st.arrival_date, st.departure_date);
    return days.find((d) => !b.activities.some((a) => a.stop_id === st.id && a.day === d)) ?? days[0];
  };
  const first = stops.find((x) => x.id === entry.stop_id) ?? stops[0];
  const [v, setV] = useState({ stop_id: first.id, day: defaultDay(first), time: '' });
  const stop = stops.find((x) => x.id === v.stop_id) ?? first;
  const save = async () => {
    const ok = await run(async () => {
      await source.rpc('promote_inspiration', { p_entry: entry.id, p_stop: stop.id, p_day: v.day, p_time: v.time || null });
      if (source.kind === 'supabase') track('inspiration.promoted', {}, b.trip.id);
      await reload();
      return true;
    }, { success: `Foi pro roteiro de ${stop.name}.` });
    if (ok) onClose();
  };
  return (
    <Dialog open onClose={onClose} title="Levar pro roteiro" footer={<>
      <Button variant="secondary" onClick={onClose}>Cancelar</Button>
      <Button disabled={busy || !v.day} onClick={() => void save()}>{busy ? 'Salvando…' : 'Levar pro roteiro'}</Button>
    </>}>
      <p style={{ margin: 0 }}><b>{entryTitle(entry)}</b> vira uma atividade no plano da parada. Dá pra editar ou excluir depois no Roteiro.</p>
      <Field label="Parada">
        <select value={v.stop_id} onChange={(e) => { const st = stops.find((x) => x.id === e.target.value)!; setV({ ...v, stop_id: st.id, day: defaultDay(st) }); }}>
          {stops.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </Field>
      <FieldGrid>
        <Field label="Dia">
          <select value={v.day} onChange={(e) => setV({ ...v, day: e.target.value })}>
            {dateRange(stop.arrival_date, stop.departure_date).map((d) => <option key={d} value={d}>{dayMonth(d)}</option>)}
          </select>
        </Field>
        <Field label="Horário (opcional)"><input type="time" value={v.time} onChange={(e) => setV({ ...v, time: e.target.value })} /></Field>
      </FieldGrid>
    </Dialog>
  );
}

function EntryDialog({ entry, stopId, kind, phase, onClose, me }: { entry: JournalEntry | null; stopId: string | null; kind: 'inspiracao' | 'registro'; phase: Tab; onClose: () => void; me: string }) {
  const { bundle: b, source, reload } = useBundle();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const toast = useToast();
  const stops = sortedStops(b);
  const [v, setV] = useState({ stop_id: entry?.stop_id ?? stopId ?? '', entry_date: entry?.entry_date ?? todayIn(b.trip.departure_tz), title: entry?.title ?? '', body: entry?.body ?? '', link_url: entry?.link_url ?? '', place_name: entry?.place_name ?? '' });
  const [files, setFiles] = useState<File[]>([]);
  const photos = entry ? b.journalPhotos.filter((p) => p.entry_id === entry.id) : [];
  const linkOk = !v.link_url || /^https?:\/\//.test(v.link_url);
  const save = () =>
    run(async () => {
      const row = { stop_id: v.stop_id || null, entry_date: v.entry_date || null, title: v.title.trim() || null, body: v.body.trim() || null, link_url: v.link_url.trim() || null, place_name: v.place_name.trim() || null };
      let id = entry?.id;
      if (entry) await source.update('journal_entries', entry.id, row, entry.version);
      else {
        id = crypto.randomUUID();
        await source.insert('journal_entries', { ...row, id, trip_id: b.trip.id, author_id: me, kind, phase }, { returning: false });
      }
      let failed = 0;
      for (const [i, f] of files.entries()) {
        try {
          const img = await compressImage(f, 1600, 0.8);
          if (img.blob.size > 10 * 1024 * 1024) throw new Error('grande');
          const path = `${b.trip.id}/${id}/${crypto.randomUUID()}.${img.type === 'image/webp' ? 'webp' : 'jpg'}`;
          await source.upload('journal', path, img.blob, img.type);
          try {
            await source.insert('journal_photos', { trip_id: b.trip.id, entry_id: id, storage_path: path, width: img.width, height: img.height, size_bytes: img.blob.size, position: photos.length + i }, { returning: false });
          } catch (e) {
            await source.removeFiles('journal', [path]).catch(() => undefined); // sem órfãos
            throw e;
          }
        } catch {
          failed++;
        }
      }
      if (failed) toast(`${failed} foto(s) não foram enviadas. O texto foi salvo.`);
      await reload();
      onClose();
    }, { success: 'Diário salvo.', onConflict: async () => { if (entry) await source.update('journal_entries', entry.id, { body: v.body.trim() || null, title: v.title.trim() || null }); await reload(); onClose(); } });
  const delPhoto = (p: JournalPhoto) => run(async () => {
    await source.removeFiles('journal', [p.storage_path]);
    await source.remove('journal_photos', { id: p.id });
    await reload();
  });
  const del = async () => {
    if (!entry || !(await confirm({ title: 'Excluir registro?', message: 'O texto e as fotos deste registro serão apagados.' }))) return;
    await run(async () => {
      if (photos.length) await source.removeFiles('journal', photos.map((p) => p.storage_path));
      await source.remove('journal_entries', { id: entry.id });
      await reload();
      onClose();
    }, { success: 'Registro excluído.' });
  };
  return (
    <Dialog open onClose={onClose} title={entry ? 'Editar' : kind === 'inspiracao' ? 'Nova inspiração' : 'Novo registro'} footer={<>
      {entry ? <Button variant="secondary" className={s.danger} onClick={del}>Excluir</Button> : null}
      <Button variant="secondary" onClick={onClose}>Cancelar</Button>
      <Button disabled={busy || !linkOk || !(v.body.trim() || v.title.trim() || v.link_url.trim() || files.length)} onClick={save}>{busy ? 'Salvando…' : 'Salvar'}</Button>
    </>}>
      <FieldGrid>
        <Field label="Parada"><select value={v.stop_id} onChange={(e) => setV({ ...v, stop_id: e.target.value })}><option value="">Sem parada</option>{stops.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label="Dia"><input type="date" value={v.entry_date} onChange={(e) => setV({ ...v, entry_date: e.target.value })} /></Field>
      </FieldGrid>
      <Field label={kind === 'inspiracao' ? 'Lugar ou ideia' : 'Título (opcional)'}><input value={v.title} maxLength={120} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
      <Field label={kind === 'inspiracao' ? 'Por que quer ver' : 'Como foi'}><textarea rows={4} maxLength={10000} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} /></Field>
      {kind === 'inspiracao' ? (
        <FieldGrid>
          <Field label="Link" error={!linkOk ? 'Use um link http(s).' : undefined}><input type="url" value={v.link_url} maxLength={500} onChange={(e) => setV({ ...v, link_url: e.target.value })} placeholder="https://" /></Field>
          <Field label="Nome do lugar"><input value={v.place_name} maxLength={120} onChange={(e) => setV({ ...v, place_name: e.target.value })} /></Field>
        </FieldGrid>
      ) : null}
      {photos.length ? <div className={s.photos}>{photos.map((p) => <Photo key={p.id} p={p} onDelete={() => void delPhoto(p)} />)}</div> : null}
      <Field label="Fotos (comprimidas para economizar espaço)" hint={files.length ? `${files.length} foto(s) serão enviadas ao salvar.` : undefined}>
        <input type="file" accept="image/*,.heic,.heif" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 12))} />
      </Field>
    </Dialog>
  );
}

function Retro() {
  const { bundle: b } = useBundle();
  const r = b.retro?.content ?? null;
  const fallback = useMemo(() => ruleRetro(b), [b]);
  const favs = b.journalEntries.filter((e) => e.favorite);
  const favPhotos = b.journalPhotos.filter((p) => favs.some((e) => e.id === p.entry_id)).slice(0, 6);
  const content = r ?? fallback;
  const by = b.retro?.generated_by ?? 'rules';

  const exportPng = async () => {
    const W = 1080, H = 1350;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    // Paleta fixa da Trilha 2.0 (tokens de globals.css).
    const p = { bg: '#F5F6F8', deep: '#0D1017', onDeep: '#FFFFFF', routeLine: '#8E9BFF', ink: '#0D1017', mute: '#5B6270' };
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = p.deep;
    ctx.fillRect(0, 0, W, 520);
    await document.fonts.ready;
    const disp = getComputedStyle(document.documentElement).getPropertyValue('--font-title');
    ctx.fillStyle = p.onDeep;
    ctx.font = `800 84px ${disp}`;
    wrap(ctx, b.trip.title, 80, 200, W - 160, 92);
    ctx.font = `500 26px ${getComputedStyle(document.documentElement).getPropertyValue('--font-body')}`;
    ctx.fillStyle = p.routeLine;
    ctx.fillText(`${dayMonth(b.trip.start_date).toUpperCase()} → ${dayMonth(b.trip.end_date).toUpperCase()}`, 80, 120);
    ctx.fillStyle = p.ink;
    ctx.font = `400 30px ${getComputedStyle(document.body).fontFamily}`;
    let y = wrap(ctx, content.intro, 80, 600, W - 160, 40) + 30;
    content.chapters.slice(0, 6).forEach((ch, i) => {
      ctx.fillStyle = CYCLE[i % CYCLE.length];
      ctx.fillRect(80, y - 22, 18, 18);
      ctx.fillStyle = p.ink;
      ctx.font = `800 36px ${disp}`;
      ctx.fillText(ch.heading, 116, y);
      ctx.font = `400 24px ${getComputedStyle(document.body).fontFamily}`;
      y = wrap(ctx, ch.text, 116, y + 36, W - 200, 32) + 26;
    });
    ctx.font = `500 24px ${getComputedStyle(document.documentElement).getPropertyValue('--font-body')}`;
    ctx.fillStyle = p.mute;
    ctx.fillText(`${content.closing} · trilha`, 80, H - 70);
    c.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `retrospectiva-${b.trip.title.replace(/\W+/g, '-').toLowerCase()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
  };

  return (
    <section className={s.retro} aria-label="Retrospectiva">
      <AiNote by={by}>{b.retro ? (by === 'ai' ? 'Roteiro da retrospectiva gerado por IA a partir do seu diário. Edite o diário e gere de novo quando quiser.' : 'Resumo montado por regras a partir dos seus dados.') : 'Prévia por regras: ainda não foi gerada uma retrospectiva.'}</AiNote>
      <h2 className={s.retroTitle}>{content.title}</h2>
      <p style={{ margin: 0, fontSize: 18 }}>{content.intro}</p>
      <ol className={s.chapters}>
        {content.chapters.map((ch, i) => (
          <li key={i}><b>{ch.heading}</b><span>{ch.text}</span></li>
        ))}
      </ol>
      {favPhotos.length ? <div className={s.photos}>{favPhotos.map((p) => <Photo key={p.id} p={p} />)}</div> : <p className={s.none}>Marque registros com ♥ para as melhores fotos entrarem aqui.</p>}
      <p className={s.mono} style={{ margin: 0 }}>{content.closing}</p>
      <Button variant="dark" icon="upload" className={s.exportBtn} onClick={() => void exportPng()}>Exportar como imagem</Button>
    </section>
  );
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lh: number): number {
  const words = text.split(/\s+/);
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > max && line) {
      ctx.fillText(line, x, y);
      line = w;
      y += lh;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y);
  return y;
}
