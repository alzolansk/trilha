'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Dialog, useAction, useConfirm, useToast } from '../components/ui/feedback';
import { AiNote, Floaters, Icon, PageTitle, Pattern, useReveal } from '../components/ui/primitives';
import { useBundle } from '../data/TripContext';
import type { JournalEntry, JournalPhoto, Stop } from '../data/types';
import { callAi } from '../lib/ai/client';
import { sortedStops, stopDates, stopIndexOn, tripPhase } from '../lib/derive';
import { dayMonth } from '../lib/format';
import { colorCycle } from '../lib/identity/theme';
import { compressImage } from '../lib/image';
import { ruleRetro } from '../lib/rules';
import { todayIn } from '../lib/time';
import s from './diario.module.css';

type Tab = 'antes' | 'durante' | 'depois';
const TABS: [Tab, string, string, string, string][] = [
  ['antes', 'Antes', 'Mural de inspirações', 'Salve fotos, links e lugares que você quer ver. Eles aparecem na parada certa do roteiro.', 'Salvar inspiração'],
  ['durante', 'Durante', 'Um registro por dia', 'Escreva uma linha sobre o dia e junte as fotos. Fica organizado por parada.', 'Escrever hoje'],
  ['depois', 'Depois', 'Sua retrospectiva', 'Quando a viagem acaba, montamos um resumo com o trajeto, as melhores fotos e os números, na identidade da sua trilha.', 'Gerar retrospectiva'],
];
const SHAPES = ['var(--motif)', 'inset(0 round 28px)', 'inset(0 round 50% 50% 24px 24px)', 'var(--motif)', 'ellipse(50% 50% at 50% 50%)', 'inset(0 round 24px 90px 24px 90px)'];

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
  const { bundle: b, identity, canEdit, source, reload, me } = useBundle();
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const { run } = useAction();
  const phase = tripPhase(b.trip);
  const tabParam = params.get('momento') as Tab | null;
  const tab: Tab = tabParam && ['antes', 'durante', 'depois'].includes(tabParam) ? tabParam : phase.kind === 'after' ? 'depois' : phase.kind === 'before' ? 'antes' : 'durante';
  const t = TABS.find((x) => x[0] === tab)!;
  const stops = useMemo(() => sortedStops(b), [b]);
  const cols = colorCycle(identity);
  const [entryDlg, setEntryDlg] = useState<{ entry: JournalEntry | null; stopId: string | null } | null>(null);
  const [stopDlg, setStopDlg] = useState<Stop | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  useReveal([tab, b.journalEntries.length]);

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
      <Floaters />
      <PageTitle
        title="Diário"
        eyebrow={b.trip.title}
        sub="Fotos e memórias organizadas por parada."
        actions={
          <div role="group" aria-label="Momento" className={s.tabs}>
            {TABS.map((x) => (
              <button key={x[0]} className="chip tap" style={{ border: 0 }} aria-pressed={x[0] === tab} onClick={() => setTab(x[0])}>{x[1]}</button>
            ))}
          </div>
        }
      />
      <div className={`${s.banner} rv`}>
        <div style={{ position: 'absolute', inset: 0, opacity: 0.12 }}><Pattern identity={identity} /></div>
        <div aria-hidden="true" style={{ position: 'absolute', right: -40, top: -60, width: 220, height: 220, clipPath: 'var(--motif)', background: 'var(--acc)', opacity: 0.7, animation: 'floaty 8s ease-in-out infinite' }} />
        <div style={{ position: 'relative', flex: '1 1 420px' }}>
          <div className="disp" style={{ fontSize: 34 }}>{t[2]}</div>
          <p style={{ margin: '10px 0 0', fontSize: 17, maxWidth: 620 }}>{t[3]}</p>
        </div>
        {canEdit ? (
          <button className="btn tap" style={{ position: 'relative', background: 'var(--acc2)', color: 'var(--fg-acc2)', border: 0 }} onClick={cta} disabled={genBusy}>
            <Icon name="sparkle" size={16} sw={1.4} fill="currentColor" />
            {genBusy ? 'Gerando…' : tab === 'depois' && b.retro ? 'Gerar de novo' : t[4]}
          </button>
        ) : null}
      </div>

      {tab === 'depois' ? <Retro /> : null}

      {stops.length ? (
        <section aria-label="Paradas" className={s.grid}>
          {stops.map((st, i) => {
            const es = entries.filter((e) => e.stop_id === st.id);
            const photos = b.journalPhotos.filter((p) => es.some((e) => e.id === p.entry_id));
            const last = es.at(-1);
            return (
              <DiaryCard key={st.id} stop={st} i={i} color={cols[i % 4]} entry={last ?? null} photos={photos} count={es.length} tab={tab}
                onOpen={() => setStopDlg(st)} onFav={last ? () => void favorite(last) : undefined} />
            );
          })}
        </section>
      ) : (
        <div className="empty" style={{ marginTop: 40 }}><h2 className="disp">Sem paradas ainda</h2><p style={{ margin: 0 }}>O diário se organiza pelas paradas do roteiro.</p></div>
      )}
      {entries.some((e) => !e.stop_id) ? (
        <section style={{ marginTop: 48 }}>
          <h2 className="disp" style={{ fontSize: 30 }}>Sem parada</h2>
          <EntryList entries={entries.filter((e) => !e.stop_id)} onEdit={(e) => setEntryDlg({ entry: e, stopId: null })} />
        </section>
      ) : null}

      {stopDlg ? (
        <Dialog open onClose={() => setStopDlg(null)} title={stopDlg.name}>
          <span className="mono" style={{ fontSize: 12 }}>{stopDates(stopDlg, true)} · {tab === 'antes' ? 'INSPIRAÇÕES' : 'REGISTROS'}</span>
          <EntryList entries={entries.filter((e) => e.stop_id === stopDlg.id)} onEdit={(e) => { setStopDlg(null); setEntryDlg({ entry: e, stopId: stopDlg.id }); }} />
          {canEdit ? <button className="btn btn-primary tap" onClick={() => { setEntryDlg({ entry: null, stopId: stopDlg.id }); setStopDlg(null); }}><Icon name="plus" size={16} />{tab === 'antes' ? 'Nova inspiração' : 'Novo registro'}</button> : null}
        </Dialog>
      ) : null}
      {entryDlg ? <EntryDialog entry={entryDlg.entry} stopId={entryDlg.stopId} kind={kind} phase={tab} onClose={() => setEntryDlg(null)} me={me} /> : null}
    </div>
  );
}

function DiaryCard({ stop, i, color, entry, photos, count, tab, onOpen, onFav }: { stop: Stop; i: number; color: string; entry: JournalEntry | null; photos: JournalPhoto[]; count: number; tab: Tab; onOpen: () => void; onFav?: () => void }) {
  const url = usePhotoUrl(photos[0]?.storage_path);
  return (
    <article className="rv lift card" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 18, borderRadius: 28, transform: `rotate(${[-2, 1.5, -1, 2, -1.5, 1][i % 6]}deg)` }}>
      <button className={s.cardBtn} onClick={onOpen} aria-label={`Abrir ${tab === 'antes' ? 'inspirações' : 'registros'} de ${stop.name}`}>
        <div style={{ position: 'relative', aspectRatio: '4/3', display: 'grid', placeItems: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, clipPath: SHAPES[i % 6], background: url ? `center/cover no-repeat url("${url}")` : `repeating-linear-gradient(135deg, ${color} 0 16px, var(--bg) 16px 32px)` }} />
          {!url ? <span style={{ position: 'relative', display: 'flex', padding: 10, borderRadius: '50%', background: 'var(--card)' }}><Icon name="camera" size={26} /></span> : null}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginTop: 14 }}>
          <h2 className="disp" style={{ margin: 0, fontSize: 28 }}>{stop.name}</h2>
          <span className="mono" style={{ fontSize: 12 }}>{stopDates(stop, true)}</span>
        </div>
        <p style={{ margin: '10px 0 0', fontSize: 15, color: 'var(--mute)', textAlign: 'left' }}>
          {entry?.body?.slice(0, 140) || entry?.title || (tab === 'antes' ? `[Salve lugares que quer ver em ${stop.name}]` : `[Escreva como foi em ${stop.name}]`)}
        </p>
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="pill">{photos.length} {photos.length === 1 ? 'FOTO' : 'FOTOS'}</span>
        {count > 1 ? <span className="pill">{count} REGISTROS</span> : null}
        <button aria-label="Favoritar" aria-pressed={!!entry?.favorite} disabled={!onFav} className="tap" onClick={onFav}
          style={{ marginLeft: 'auto', width: 44, height: 44, borderRadius: '50%', border: '1px solid var(--line)', background: entry?.favorite ? 'var(--acc)' : 'transparent', color: entry?.favorite ? 'var(--fg-acc)' : 'inherit', cursor: onFav ? 'pointer' : 'default', display: 'grid', placeItems: 'center' }}>
          <Icon name="heart" size={20} fill={entry?.favorite ? 'currentColor' : 'none'} />
        </button>
      </div>
    </article>
  );
}

function Photo({ p, onDelete }: { p: JournalPhoto; onDelete?: () => void }) {
  const url = usePhotoUrl(p.storage_path);
  return (
    <figure className={s.photo}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt={p.caption ?? 'Foto do diário'} loading="lazy" /> : <div className="skel" style={{ height: '100%' }} />}
      {onDelete ? <button className="btn btn-icon btn-sm" aria-label="Remover foto" onClick={onDelete}>✕</button> : null}
    </figure>
  );
}

function EntryList({ entries, onEdit }: { entries: JournalEntry[]; onEdit: (e: JournalEntry) => void }) {
  const { bundle: b, me, profileOf, canEdit } = useBundle();
  if (!entries.length) return <p className="muted" style={{ margin: 0 }}>Nada por aqui ainda.</p>;
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {entries.map((e) => (
        <li key={e.id} className={s.entry}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
            <b>{e.title || (e.entry_date ? dayMonth(e.entry_date) : 'Registro')}</b>
            <span className="mono" style={{ fontSize: 11 }}>{profileOf(e.author_id)?.display_name ?? ''}{e.favorite ? ' · ♥' : ''}</span>
          </div>
          {e.body ? <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{e.body}</p> : null}
          {e.place_name ? <span className="pill">{e.place_name}</span> : null}
          {e.link_url ? <a href={e.link_url} target="_blank" rel="noopener noreferrer nofollow" style={{ wordBreak: 'break-all' }}>{e.link_url}</a> : null}
          <div className={s.photos}>{b.journalPhotos.filter((p) => p.entry_id === e.id).map((p) => <Photo key={p.id} p={p} />)}</div>
          {canEdit && e.author_id === me ? <button className="btn btn-sm tap" style={{ alignSelf: 'flex-start' }} onClick={() => onEdit(e)}>Editar</button> : null}
        </li>
      ))}
    </ul>
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
      {entry ? <button className="btn btn-danger tap" onClick={del}>Excluir</button> : null}
      <button className="btn tap" onClick={onClose}>Cancelar</button>
      <button className="btn btn-primary tap" disabled={busy || !linkOk || !(v.body.trim() || v.title.trim() || v.link_url.trim() || files.length)} onClick={save}>{busy ? 'Salvando…' : 'Salvar'}</button>
    </>}>
      <div className="grid2">
        <label className="field">Parada<select value={v.stop_id} onChange={(e) => setV({ ...v, stop_id: e.target.value })}><option value="">Sem parada</option>{stops.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label className="field">Dia<input type="date" value={v.entry_date} onChange={(e) => setV({ ...v, entry_date: e.target.value })} /></label>
      </div>
      <label className="field">{kind === 'inspiracao' ? 'Lugar ou ideia' : 'Título (opcional)'}<input value={v.title} maxLength={120} onChange={(e) => setV({ ...v, title: e.target.value })} /></label>
      <label className="field">{kind === 'inspiracao' ? 'Por que quer ver' : 'Como foi'}<textarea rows={4} maxLength={10000} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} /></label>
      {kind === 'inspiracao' ? (
        <div className="grid2">
          <label className="field">Link<input type="url" value={v.link_url} maxLength={500} onChange={(e) => setV({ ...v, link_url: e.target.value })} placeholder="https://" />{!linkOk ? <span className="err">Use um link http(s).</span> : null}</label>
          <label className="field">Nome do lugar<input value={v.place_name} maxLength={120} onChange={(e) => setV({ ...v, place_name: e.target.value })} /></label>
        </div>
      ) : null}
      {photos.length ? <div className={s.photos}>{photos.map((p) => <Photo key={p.id} p={p} onDelete={() => void delPhoto(p)} />)}</div> : null}
      <label className="field">Fotos (comprimidas para economizar espaço)
        <input type="file" accept="image/*,.heic,.heif" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 12))} />
        {files.length ? <span className="hint">{files.length} foto(s) serão enviadas ao salvar.</span> : null}
      </label>
    </Dialog>
  );
}

function Retro() {
  const { bundle: b, identity } = useBundle();
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
    const p = identity.palette;
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = p.deep;
    ctx.fillRect(0, 0, W, 520);
    await document.fonts.ready;
    const disp = getComputedStyle(document.documentElement).getPropertyValue('--font-display');
    ctx.fillStyle = p.onDeep;
    ctx.font = `${identity.display.weight} 84px ${disp}`;
    wrap(ctx, b.trip.title, 80, 200, W - 160, 92);
    ctx.font = `500 26px ${getComputedStyle(document.documentElement).getPropertyValue('--font-mono')}`;
    ctx.fillStyle = p.routeLine;
    ctx.fillText(`${dayMonth(b.trip.start_date).toUpperCase()} → ${dayMonth(b.trip.end_date).toUpperCase()}`, 80, 120);
    ctx.fillStyle = p.ink;
    ctx.font = `400 30px ${getComputedStyle(document.body).fontFamily}`;
    let y = wrap(ctx, content.intro, 80, 600, W - 160, 40) + 30;
    content.chapters.slice(0, 6).forEach((ch, i) => {
      ctx.fillStyle = [p.acc, p.acc2, p.acc3, p.deep][i % 4];
      ctx.fillRect(80, y - 22, 18, 18);
      ctx.fillStyle = p.ink;
      ctx.font = `${identity.display.weight} 36px ${disp}`;
      ctx.fillText(ch.heading, 116, y);
      ctx.font = `400 24px ${getComputedStyle(document.body).fontFamily}`;
      y = wrap(ctx, ch.text, 116, y + 36, W - 200, 32) + 26;
    });
    ctx.font = `500 24px ${getComputedStyle(document.documentElement).getPropertyValue('--font-mono')}`;
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
    <section className={`${s.retro} rv`} aria-label="Retrospectiva">
      <AiNote by={by}>{b.retro ? (by === 'ai' ? 'Roteiro da retrospectiva gerado por IA a partir do seu diário. Edite o diário e gere de novo quando quiser.' : 'Resumo montado por regras a partir dos seus dados.') : 'Prévia por regras: ainda não foi gerada uma retrospectiva.'}</AiNote>
      <h2 className="disp" style={{ margin: 0, fontSize: 'clamp(36px,5vw,64px)', lineHeight: 0.95 }}>{content.title}</h2>
      <p style={{ margin: 0, fontSize: 18 }}>{content.intro}</p>
      <ol className={s.chapters}>
        {content.chapters.map((ch, i) => (
          <li key={i}><b className="disp">{ch.heading}</b><span>{ch.text}</span></li>
        ))}
      </ol>
      {favPhotos.length ? <div className={s.photos}>{favPhotos.map((p) => <Photo key={p.id} p={p} />)}</div> : <p className="muted" style={{ margin: 0 }}>Marque registros com ♥ para as melhores fotos entrarem aqui.</p>}
      <p className="mono" style={{ margin: 0, fontSize: 12 }}>{content.closing}</p>
      <button className="btn btn-ink tap" style={{ alignSelf: 'flex-start' }} onClick={() => void exportPng()}><Icon name="upload" size={16} />Exportar como imagem</button>
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
