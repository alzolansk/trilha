'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, useAction, useConfirm, useToast } from '../components/ui/feedback';
import { AiNote, Floaters, Icon, Marquee, PageTitle, useReveal } from '../components/ui/primitives';
import { documentReaders, grantKey } from '../data/docKeys';
import { useBundle } from '../data/TripContext';
import { MissingKeyError, useVault, VaultLockedError } from '../data/VaultContext';
import { getFile, storageEstimate } from '../data/offline';
import { downloadOne, removeLocal, useLocalDocs, wantsOffline } from '../data/offlineSync';
import type { DocCategory, DocVisibility, DocumentRow } from '../data/types';
import { callAi } from '../lib/ai/client';
import { decryptBlob, encryptBlob, fileAad, newDocumentKey } from '../lib/crypto/e2e';
import { track } from '../lib/analytics';
import { suggestFromText, guessTitleFromFileName } from '../lib/classify';
import { sortedStops, tripPhase, tripTarget } from '../lib/derive';
import { extract, normalizedMime, validateFile } from '../lib/extract';
import { CATEGORY_LABEL, dayMonth, formatBytes, normalize } from '../lib/format';
import { colorCycle, DOC_CAT_VAR } from '../lib/identity/theme';
import { ruleAlerts } from '../lib/rules';
import { countdown } from '../lib/time';
import s from './documentos.module.css';

const CATS: DocCategory[] = ['passagem', 'identidade', 'reserva', 'ingresso', 'seguro', 'outro'];
const LABEL_TO_CAT: Record<string, DocCategory> = Object.fromEntries(Object.entries(CATEGORY_LABEL).map(([k, v]) => [v, k as DocCategory]));
const PERSONAL: DocCategory[] = ['identidade', 'seguro'];

interface Pending {
  key: string;
  file: File;
  mime: string;
  status: 'reading' | 'ready' | 'saving' | 'error';
  progress: number;
  text: string;
  preview: Blob | null;
  note: string | null;
  by: 'ai' | 'rules' | 'user';
  confidence: number | null;
  title: string;
  subtitle: string;
  category: DocCategory;
  stopId: string;
  visibility: DocVisibility;
  validUntil: string;
  isShot: boolean;
  reason: string | null;
}

export default function Documentos() {
  const { bundle: b, identity, canEdit, source, reload, me } = useBundle();
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const vault = useVault();
  const local = useLocalDocs();
  const [q, setQ] = useState('');
  const [queue, setQueue] = useState<Pending[]>([]);
  const [over, setOver] = useState(false);
  const [openId, setOpenId] = useState<string | null>(params.get('doc'));
  const stops = useMemo(() => sortedStops(b), [b]);
  const cols = colorCycle(identity);
  const ready = b.documents.filter((d) => d.status === 'ready' || d.owner_id === me);
  const tipoParam = params.get('tipo');
  const cat = tipoParam && LABEL_TO_CAT[tipoParam] ? LABEL_TO_CAT[tipoParam] : 'todos';
  const tickets = ready.filter((d) => !d.is_shot);
  const shots = ready.filter((d) => d.is_shot);
  useReveal([cat, ready.length]);

  const cats = ['todos', ...CATS.filter((c) => tickets.some((d) => d.category === c))] as const;
  const nq = normalize(q);
  const visible = tickets
    .filter((d) => cat === 'todos' || d.category === cat)
    .filter((d) => !nq || normalize(`${d.title} ${d.subtitle ?? ''} ${d.original_name} ${CATEGORY_LABEL[d.category]} ${stops.find((x) => x.id === d.stop_id)?.name ?? ''}`).includes(nq))
    // passagens e identidade no topo (SPEC)
    .sort((a, c) => Number(c.category === 'passagem' || c.category === 'identidade') - Number(a.category === 'passagem' || a.category === 'identidade'));

  const alert = ruleAlerts(b).find((a) => a.link === 'documentos');
  const phase = tripPhase(b.trip);
  const days = countdown(Date.now(), tripTarget(b.trip), b.trip.departure_tz).totalDays;
  const [est, setEst] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null);
  useEffect(() => {
    void storageEstimate().then(setEst);
  }, [local]);

  const setCat = (c: string) => {
    const p = new URLSearchParams(params.toString());
    if (c === 'todos') p.delete('tipo');
    else p.set('tipo', CATEGORY_LABEL[c]);
    router.replace(`?${p.toString()}`, { scroll: false });
  };

  // ───── upload ─────
  const addFiles = (files: FileList | File[]) => {
    if (!canEdit) return toast('Você só pode consultar nesta trilha.');
    if (source.kind === 'demo') return toast('Na demonstração os arquivos não são enviados. Crie uma trilha real.');
    const list = Array.from(files);
    const errors = list.map(validateFile).filter(Boolean) as string[];
    if (errors.length) toast(errors[0]);
    const ok = list.filter((f) => !validateFile(f));
    const presetStop = params.get('parada') ?? '';
    const items: Pending[] = ok.map((f) => ({
      key: crypto.randomUUID(), file: f, mime: normalizedMime(f)!, status: 'reading', progress: 0, text: '', preview: null, note: null, by: 'user', confidence: null,
      title: guessTitleFromFileName(f.name), subtitle: '', category: 'outro', stopId: presetStop, visibility: 'private', validUntil: '', isShot: false, reason: null,
    }));
    setQueue((qq) => [...qq, ...items]);
    for (const it of items) void analyze(it);
  };

  const patchQ = (key: string, p: Partial<Pending>) => setQueue((qq) => qq.map((x) => (x.key === key ? { ...x, ...p } : x)));

  async function analyze(it: Pending) {
    const ex = await extract(it.file, (p) => patchQ(it.key, { progress: p }));
    let sug = suggestFromText(ex.text, it.file.name, b.stops, b.transports);
    let by: Pending['by'] = sug.category || sug.stopId ? 'rules' : 'user';
    let confidence: number | null = null;
    let subtitle = '';
    let validUntil = '';
    let reason = [sug.categoryReason, sug.stopReason].filter(Boolean).join(' · ') || null;
    if (ex.text.trim().length > 20) {
      const ai = await callAi<{ category: DocCategory; stop_id: string | null; title: string; subtitle: string | null; confidence: number; valid_until?: string | null }>('classify', { tripId: b.trip.id, fileName: it.file.name, text: ex.text.slice(0, 5000) });
      if (ai?.by === 'ai' && ai.data) {
        sug = { ...sug, category: ai.data.category, stopId: ai.data.stop_id, title: ai.data.title };
        subtitle = ai.data.subtitle ?? '';
        validUntil = ai.data.valid_until ?? '';
        confidence = ai.data.confidence;
        by = 'ai';
        reason = `Confiança ${Math.round(ai.data.confidence * 100)}% · ${ai.model ?? ''}`;
      }
    }
    const category = sug.category ?? 'outro';
    const isImg = it.mime.startsWith('image/');
    patchQ(it.key, {
      status: 'ready', text: ex.text, preview: ex.preview, note: ex.error, by, confidence, reason,
      category, stopId: it.stopId || sug.stopId || '', title: sug.title ?? it.title, subtitle, validUntil,
      visibility: PERSONAL.includes(category) ? 'private' : 'trip', isShot: isImg && category === 'outro',
    });
  }

  async function saveOne(it: Pending) {
    if (vault.status !== 'unlocked' || !vault.publicKey) {
      vault.ask();
      return toast('Desbloqueie o cofre para enviar: o arquivo é cifrado neste aparelho antes de sair dele.');
    }
    patchQ(it.key, { status: 'saving' });
    const id = crypto.randomUUID();
    // o nome original fica só nos metadados; no Storage vai apenas conteúdo cifrado
    const path = `${b.trip.id}/${id}/arquivo.bin`;
    const previewPath = it.preview ? `${b.trip.id}/${id}/previa.bin` : null;
    let rowCreated = false;
    const uploaded: string[] = [];
    try {
      // 0) cifra aqui: chave AES-256 nova para este documento
      const key = await newDocumentKey();
      const body = await encryptBlob(key, it.file, fileAad(id, 'file'));
      const preview = it.preview ? await encryptBlob(key, it.preview, fileAad(id, 'preview')) : null;
      // 1) metadados em "uploading" (só o dono vê); 2) chaves embrulhadas; 3) arquivos; 4) "ready".
      await source.insert('documents', {
        id, trip_id: b.trip.id, owner_id: me, title: it.title.trim().slice(0, 120) || 'Documento', category: it.category, visibility: it.visibility,
        stop_id: it.stopId || null, storage_path: path, preview_path: previewPath, original_name: it.file.name.slice(0, 200), mime: it.mime,
        size_bytes: it.file.size, valid_until: it.validUntil || null, subtitle: it.subtitle.trim() || null, status: 'uploading',
        classified_by: it.by, ai_confidence: it.confidence, is_shot: it.isShot, encrypted: true,
      }, { returning: false });
      rowCreated = true;
      const withMe = { ...b, publicKeys: [...(b.publicKeys ?? []).filter((p) => p.user_id !== me), { user_id: me, public_key: vault.publicKey }] };
      await grantKey(source, withMe, id, key, [me]);
      for (const u of documentReaders(withMe, { id, owner_id: me, visibility: it.visibility })) {
        // quem não receber agora recebe depois (docKeys.grantMissingKeys)
        if (u !== me) await grantKey(source, withMe, id, key, [u]).catch(() => undefined);
      }
      await source.upload('documents', path, body, 'application/octet-stream');
      uploaded.push(path);
      if (previewPath && preview) {
        await source.upload('documents', previewPath, preview, 'application/octet-stream');
        uploaded.push(previewPath);
      }
      await source.update('documents', id, { status: 'ready' });
      setQueue((qq) => qq.filter((x) => x.key !== it.key));
      track('doc.upload', { category: it.category, by: it.by, mime: it.mime }, b.trip.id);
      const stopName = stops.find((x) => x.id === it.stopId)?.name;
      toast(`Salvo como ${CATEGORY_LABEL[it.category]}${stopName ? ` e ligado a ${stopName}` : ''}.`);
      await reload();
    } catch (e) {
      // Evita registro quebrado ou arquivo órfão: desfaz o que deu certo.
      if (uploaded.length) await source.removeFiles('documents', uploaded).catch(() => undefined);
      if (rowCreated) await source.remove('documents', { id }).catch(() => undefined);
      patchQ(it.key, { status: 'error', note: (e as Error).message || 'Falha no envio.' });
    }
  }

  const pendingUploads = b.documents.filter((d) => d.status === 'uploading' && d.owner_id === me);

  return (
    <div className="wrap">
      <Floaters />
      <PageTitle
        eyebrow={`${b.trip.title} · ${phase.kind === 'before' ? `faltam ${days} dias` : phase.kind === 'after' ? 'viagem concluída' : 'em andamento'}`}
        title="Documentos"
        sub="Tudo da viagem num lugar só, disponível mesmo sem internet."
        actions={
          <>
            <label className="btn tap" style={{ cursor: 'text' }}>
              <Icon name="search" size={18} />
              <span className="sr">Buscar documento</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar" style={{ border: 0, outline: 0, background: 'transparent', width: 150 }} />
            </label>
            {canEdit ? (
              <label className="btn btn-primary tap lift">
                <Icon name="upload" size={18} />
                Enviar arquivo
                <input type="file" multiple className="sr" accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/jpeg,image/png,image/heic,image/heif" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
              </label>
            ) : null}
          </>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(420px,100%),1fr))', gap: 14, marginTop: 32 }}>
        {alert ? <div className="rv"><AiNote by="rules"><b>{alert.title}.</b> {alert.detail}</AiNote></div> : null}
        <div className="rv">
          <AiNote by="rules">
            Passagens e documentos de identidade ficam no topo e são baixados para este aparelho automaticamente. Só aparece OFFLINE quando a cópia já está salva aqui.
            {est ? <small>{formatBytes(est.usage)} usados de {formatBytes(est.quota)} disponíveis neste navegador{est.persisted ? ' · armazenamento protegido' : ' · o navegador pode apagar cópias se faltar espaço'}.</small> : null}
          </AiNote>
        </div>
      </div>

      {source.kind === 'supabase' ? <VaultNote /> : null}

      {pendingUploads.length ? (
        <div className="errbox" style={{ marginTop: 18 }}>
          <span style={{ flex: 1 }}>{pendingUploads.length} envio(s) não terminaram. Exclua e envie de novo.</span>
          <button className="btn btn-sm tap" onClick={async () => {
            for (const d of pendingUploads) {
              await source.removeFiles('documents', [d.storage_path, ...(d.preview_path ? [d.preview_path] : [])]).catch(() => undefined);
              await source.remove('documents', { id: d.id }).catch(() => undefined);
            }
            await reload();
          }}>Limpar envios incompletos</button>
        </div>
      ) : null}

      {tickets.length ? (
        <div role="group" aria-label="Filtrar por tipo" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 32 }}>
          {cats.map((c) => (
            <button key={c} className="chip tap" aria-pressed={c === cat} onClick={() => setCat(c)}>
              {c === 'todos' ? 'Todos' : CATEGORY_LABEL[c]}
              <small>{c === 'todos' ? tickets.length : tickets.filter((d) => d.category === c).length}</small>
            </button>
          ))}
        </div>
      ) : null}

      <section className={s.grid} aria-label="Arquivos">
        {visible.map((d) => (
          <DocTicket key={d.id} d={d} stopName={stops.find((x) => x.id === d.stop_id)?.name} state={local[d.id]?.state ?? 'none'} onOpen={() => setOpenId(d.id)} />
        ))}
      </section>
      {tickets.length && !visible.length ? <p style={{ marginTop: 20, color: 'var(--mute)' }}>Nada encontrado para “{q}”.</p> : null}

      {tickets.length ? (
        <div style={{ marginTop: 72 }}>
          <Marquee words={tickets.slice(0, 8).map((d) => d.title)} />
        </div>
      ) : null}

      {shots.length ? (
        <section style={{ marginTop: 64 }}>
          <h2 className="disp rv" style={{ margin: '0 0 24px', fontSize: 40 }}>Fotos e prints</h2>
          <div className={s.shots}>
            {shots.map((d, i) => (
              <Shot key={d.id} d={d} i={i} color={cols[i % 4]} onOpen={() => setOpenId(d.id)} />
            ))}
          </div>
        </section>
      ) : null}

      {canEdit ? (
        <label
          className={`${s.drop} rv ${over ? s.over : ''} ${!tickets.length ? s.dropHero : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
        >
          <svg className={s.bd} aria-hidden="true"><rect x="1" y="1" width="99.8%" height="99.6%" rx="34" fill="none" stroke="currentColor" strokeWidth="2" className="dm" /></svg>
          <input type="file" multiple className="sr" accept=".pdf,.jpg,.jpeg,.png,.heic,.heif" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
          <span className={s.ic}><Icon name="upload" size={28} /></span>
          <h2 className="disp" style={{ margin: 0, fontSize: 32 }}>{tickets.length ? 'Solta aqui' : 'Comece pelos documentos'}</h2>
          <p style={{ margin: 0, maxWidth: 520, fontSize: 17, color: 'var(--mute)' }}>PDFs, prints e fotos. A gente lê o texto, sugere se é passagem, reserva ou ingresso e a parada certa. Você confirma antes de salvar.</p>
          <span className="mono" style={{ fontSize: 12, color: 'var(--mute)' }}>PDF · JPG · PNG · HEIC · ATÉ 25 MB</span>
        </label>
      ) : !tickets.length ? (
        <div className="empty" style={{ marginTop: 40 }}><h2 className="disp">Nenhum documento compartilhado</h2><p style={{ margin: 0 }}>Quando a turma compartilhar documentos da viagem, eles aparecem aqui.</p></div>
      ) : null}

      {queue.length ? <UploadReview queue={queue} stops={stops} patch={patchQ} save={saveOne} remove={(k) => setQueue((qq) => qq.filter((x) => x.key !== k))} /> : null}
      {openId ? <DocViewer id={openId} onClose={() => { setOpenId(null); if (params.get('doc')) router.replace('?', { scroll: false }); }} /> : null}
    </div>
  );
}

function stateBadge(state: string) {
  if (state === 'saved') return <span className={s.off}><Icon name="cloud" size={13} />OFFLINE</span>;
  if (state === 'downloading') return <span className="pill">BAIXANDO…</span>;
  if (state === 'failed') return <span className="pill" data-tone="acc">FALHOU</span>;
  if (state === 'outdated') return <span className="pill">DESATUALIZADO</span>;
  return null;
}

function DocTicket({ d, stopName, state, onOpen }: { d: DocumentRow; stopName?: string; state: string; onOpen: () => void }) {
  const [bg, fg] = DOC_CAT_VAR[d.category];
  return (
    <article className="ticket lift rv">
      <button className={s.ticketBtn} onClick={onOpen} aria-label={`Abrir ${d.title}`}>
        <div className="ticket-head" style={{ background: bg, color: fg }}>
          <span className="mono" style={{ fontSize: 11, letterSpacing: '.16em' }}>{CATEGORY_LABEL[d.category].toUpperCase()}</span>
          <Icon name="doc" size={18} />
        </div>
        <span className="notch l" />
        <span className="notch r" />
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 6, flex: 1, textAlign: 'left' }}>
          <h2 className="disp" style={{ margin: 0, fontSize: 22, lineHeight: 1.1, letterSpacing: '-.01em' }}>{d.title}</h2>
          <div style={{ fontSize: 14, color: 'var(--mute)' }}>
            {d.subtitle ?? [stopName, d.valid_until ? `válido até ${dayMonth(d.valid_until)}` : null].filter(Boolean).join(' · ') ?? ''}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {d.visibility === 'private' ? <span className="pill">PRIVADO</span> : d.visibility === 'shared' ? <span className="pill">COMPARTILHADO</span> : null}
            {d.status === 'uploading' ? <span className="pill" data-tone="acc">ENVIO INCOMPLETO</span> : null}
            {d.classified_by === 'ai' ? <span className="tag">IA</span> : null}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 'auto', paddingTop: 14 }}>
            <span className="mono" style={{ fontSize: 12 }}>{(d.original_name.split('.').pop() ?? '').toUpperCase()} · {formatBytes(d.size_bytes)}</span>
            {stateBadge(state)}
          </div>
        </div>
      </button>
    </article>
  );
}

function VaultNote() {
  const vault = useVault();
  if (vault.status === 'off' || vault.status === 'loading') return null;
  return (
    <div className="ai rv" style={{ marginTop: 14 }}>
      <span className="pill" data-tone={vault.status === 'unlocked' ? undefined : 'acc'}>E2E</span>
      <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 14px' }}>
        {vault.status === 'unlocked' ? (
          <>
            <span style={{ flex: 1, minWidth: 220 }}>Cofre desbloqueado neste aparelho. Os arquivos são cifrados com AES-256-GCM antes do envio, e só quem tem acesso na turma consegue abrir.</span>
            <button className="btn btn-sm tap" onClick={vault.openChange}>Trocar frase</button>
            <button className="btn btn-sm tap" onClick={() => void vault.lock()}>Trancar</button>
          </>
        ) : (
          <>
            <span style={{ flex: 1, minWidth: 220 }}>
              {vault.status === 'none'
                ? 'Crie seu cofre para enviar e abrir documentos com criptografia ponta a ponta: o servidor guarda só o arquivo cifrado.'
                : 'Cofre trancado neste aparelho. Desbloqueie para enviar ou abrir documentos cifrados.'}
            </span>
            <button className="btn btn-primary btn-sm tap" onClick={vault.ask}>{vault.status === 'none' ? 'Criar cofre' : 'Desbloquear'}</button>
          </>
        )}
      </span>
    </div>
  );
}

function useDocUrl(d: DocumentRow | undefined, preferPreview = true) {
  const { source, bundle: b } = useBundle();
  const vault = useVault();
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const me = source.userId;
  const myKey = d?.encrypted ? (b.documentKeys ?? []).find((k) => k.document_id === d.id && k.user_id === me)?.wrapped_key : undefined;
  const bRef = useRef(b);
  bRef.current = b;
  useEffect(() => {
    if (!d) return;
    let obj: string | null = null;
    let alive = true;
    setErr(null);
    (async () => {
      try {
        const usePreview = preferPreview && !!d.preview_path;
        const key = usePreview ? `${d.id}:preview` : d.id;
        const local = source.kind === 'supabase' ? await getFile(source.userId, key) : null;
        let blob: Blob;
        if (local) blob = local.blob;
        else blob = await source.download('documents', usePreview ? d.preview_path! : d.storage_path);
        const mime = usePreview ? 'image/jpeg' : d.mime;
        // cifrado: decifra aqui, a partir da cópia local ou do Storage
        if (d.encrypted) blob = await decryptBlob(await vault.docKey(bRef.current, d), blob, fileAad(d.id, usePreview ? 'preview' : 'file'), mime);
        obj = URL.createObjectURL(blob.type && !d.encrypted ? blob : new Blob([blob], { type: mime }));
        if (alive) setUrl(obj);
      } catch (e) {
        if (!alive) return;
        if (e instanceof VaultLockedError || e instanceof MissingKeyError) setErr(e.message);
        else setErr(!navigator.onLine ? 'Sem internet e sem cópia neste aparelho.' : (e as Error).message);
      }
    })();
    return () => {
      alive = false;
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [d, source, preferPreview, myKey, vault.docKey]);
  return { url, err };
}

function Shot({ d, i, color, onOpen }: { d: DocumentRow; i: number; color: string; onOpen: () => void }) {
  const { url } = useDocUrl(d);
  const shape = i % 2 ? 'inset(0 round 28px)' : 'var(--motif)';
  return (
    <figure className="rv lift" style={{ transform: `rotate(${[-3, 2, -1.5, 3, -2][i % 5]}deg)` }}>
      <button onClick={onOpen} className={s.shotBtn} aria-label={`Abrir ${d.title}`}>
        <div className={s.ph} style={{ clipPath: shape, background: url ? undefined : `repeating-linear-gradient(135deg, ${color} 0 14px, var(--card) 14px 28px)` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {url && d.mime !== 'application/pdf' && !/hei[cf]/.test(d.mime) || (url && d.preview_path) ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name="camera" size={30} />}
        </div>
      </button>
      <figcaption style={{ fontSize: 14, fontWeight: 500, textAlign: 'center' }}>{d.title}</figcaption>
    </figure>
  );
}

function UploadReview({ queue, stops, patch, save, remove }: { queue: Pending[]; stops: ReturnType<typeof sortedStops>; patch: (k: string, p: Partial<Pending>) => void; save: (p: Pending) => Promise<void>; remove: (k: string) => void }) {
  const { bundle: b } = useBundle();
  const readyAll = queue.every((x) => x.status === 'ready' || x.status === 'error');
  return (
    <Dialog open onClose={() => queue.filter((x) => x.status !== 'saving').forEach((x) => remove(x.key))} title={`Confirmar ${queue.length === 1 ? 'arquivo' : `${queue.length} arquivos`}`}
      footer={<button className="btn btn-primary tap" disabled={!readyAll} onClick={async () => { for (const it of queue.filter((x) => x.status === 'ready')) await save(it); }}>Salvar {queue.length > 1 ? 'todos' : ''}</button>}>
      <p style={{ margin: 0, color: 'var(--mute)', fontSize: 14 }}>Confira as sugestões antes de salvar. Nada é inventado: se a leitura falhou, os campos ficam em branco para você preencher.</p>
      {queue.map((it) => (
        <div key={it.key} className={s.review}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <b style={{ wordBreak: 'break-all' }}>{it.file.name}</b>
            <span className="mono" style={{ fontSize: 11 }}>{formatBytes(it.file.size)}</span>
          </div>
          {it.status === 'reading' ? (
            <div aria-live="polite" className="mono" style={{ fontSize: 12 }}>LENDO O ARQUIVO… {it.progress ? `${Math.round(it.progress * 100)}%` : ''}<div className="bar" style={{ height: 6, marginTop: 6 }}><i className="" style={{ width: `${Math.max(8, it.progress * 100)}%`, background: 'var(--acc)' }} /></div></div>
          ) : (
            <>
              {it.by !== 'user' ? <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}><span className="tag" data-src={it.by}>{it.by === 'ai' ? 'IA' : 'AUTO'}</span>Sugestão{it.reason ? `: ${it.reason}` : ''}. Corrija se precisar.</div> : <div style={{ fontSize: 13, color: 'var(--mute)' }}>Sem sinais claros no texto: escolha a categoria e a parada.</div>}
              {it.note ? <span className="field"><span className="err">{it.note}</span></span> : null}
              <div className="grid2">
                <label className="field">Título<input value={it.title} maxLength={120} onChange={(e) => patch(it.key, { title: e.target.value, by: it.by })} /></label>
                <label className="field">Categoria<select value={it.category} onChange={(e) => patch(it.key, { category: e.target.value as DocCategory })}>{CATS.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></label>
                <label className="field">Parada<select value={it.stopId} onChange={(e) => patch(it.key, { stopId: e.target.value })}><option value="">Nenhuma</option>{stops.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                <label className="field">Quem vê<select value={it.visibility} onChange={(e) => patch(it.key, { visibility: e.target.value as DocVisibility })}><option value="private">Só eu (privado)</option><option value="trip">Toda a turma da viagem</option></select></label>
                <label className="field">Subtítulo<input value={it.subtitle} maxLength={120} onChange={(e) => patch(it.key, { subtitle: e.target.value })} placeholder={b.trip.title} /></label>
                <label className="field">Válido até (se houver)<input type="date" value={it.validUntil} onChange={(e) => patch(it.key, { validUntil: e.target.value })} /></label>
              </div>
              {it.mime.startsWith('image/') ? <label className="check" style={{ minHeight: 36 }}><input type="checkbox" checked={it.isShot} onChange={(e) => patch(it.key, { isShot: e.target.checked })} /><span className="box" aria-hidden="true" /><span>Mostrar em “Fotos e prints”</span></label> : null}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-sm tap" onClick={() => remove(it.key)} disabled={it.status === 'saving'}>Descartar</button>
                {it.status === 'error' ? <button className="btn btn-sm btn-primary tap" onClick={() => void save(it)}>Tentar de novo</button> : null}
                {it.status === 'saving' ? <span className="pill">ENVIANDO…</span> : null}
              </div>
            </>
          )}
        </div>
      ))}
    </Dialog>
  );
}

function DocViewer({ id, onClose }: { id: string; onClose: () => void }) {
  const { bundle: b, source, reload, me, canEdit, isOrganizer, profileOf } = useBundle();
  const d = b.documents.find((x) => x.id === id);
  const local = useLocalDocs();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const { url, err } = useDocUrl(d);
  const vault = useVault();
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(() => ({ title: d?.title ?? '', subtitle: d?.subtitle ?? '', category: d?.category ?? 'outro', stop_id: d?.stop_id ?? '', valid_until: d?.valid_until ?? '', visibility: d?.visibility ?? 'private', notes: d?.notes ?? '' }));
  const iframeRef = useRef<HTMLIFrameElement>(null);
  if (!d) return <Dialog open onClose={onClose} title="Documento"><p>Documento não encontrado ou sem acesso.</p></Dialog>;
  const owner = d.owner_id === me;
  const canMeta = owner || (d.visibility === 'trip' && canEdit);
  const state = local[d.id]?.state ?? 'none';
  const keep = wantsOffline(b, d);
  const shares = b.documentShares.filter((x) => x.document_id === d.id).map((x) => x.user_id);
  const others = b.members.filter((m) => m.user_id !== me);

  const setKeep = (k: boolean) =>
    run(async () => {
      await source.upsert('document_offline_prefs', { user_id: me, document_id: d.id, keep_offline: k, updated_at: new Date().toISOString() }, 'user_id,document_id');
      if (k) await downloadOne(source, d);
      else await removeLocal(source, d.id);
      await reload();
    }, { success: k ? 'Guardado neste aparelho.' : 'Cópia local removida deste aparelho.' });

  const saveMeta = () =>
    run(async () => {
      const patch: Record<string, unknown> = { title: v.title.trim() || d.title, subtitle: v.subtitle.trim() || null, category: v.category, stop_id: v.stop_id || null, valid_until: v.valid_until || null, notes: v.notes.trim() || null, classified_by: 'user' };
      if (owner) patch.visibility = v.visibility;
      await source.update('documents', d.id, patch, d.version);
      if (owner && v.visibility !== 'shared' && shares.length) for (const u of shares) await source.remove('document_shares', { document_id: d.id, user_id: u });
      await reload();
      setEdit(false);
    }, { success: 'Documento atualizado.', onConflict: async () => { await source.update('documents', d.id, { title: v.title, category: v.category, stop_id: v.stop_id || null }); await reload(); setEdit(false); } });

  const toggleShare = (uid: string, on: boolean) =>
    run(async () => {
      if (on) await source.insert('document_shares', { document_id: d.id, user_id: uid }, { returning: false });
      else await source.remove('document_shares', { document_id: d.id, user_id: uid });
      await reload();
    });

  const del = async () => {
    if (!(await confirm({ title: `Excluir “${d.title}”?`, message: 'O arquivo é apagado do armazenamento e da lista da turma. Cópias já baixadas em aparelhos desconectados só somem quando eles voltarem a sincronizar.' }))) return;
    await run(async () => {
      await source.removeFiles('documents', [d.storage_path, ...(d.preview_path ? [d.preview_path] : [])]);
      await source.remove('documents', { id: d.id });
      await removeLocal(source, d.id).catch(() => undefined);
      await reload();
      onClose();
    }, { success: 'Documento excluído.' });
  };

  const isImg = d.mime.startsWith('image/') && (!/hei[cf]/.test(d.mime) || !!d.preview_path);
  return (
    <Dialog open onClose={onClose} title={d.title}>
      <div className={s.viewer}>
        {err ? <div className="errbox"><span style={{ flex: 1 }}>{err}</span>{d.encrypted && vault.status !== 'unlocked' ? <button className="btn btn-sm tap" onClick={vault.ask}>{vault.status === 'none' ? 'Criar cofre' : 'Desbloquear'}</button> : null}</div> : !url ? <div className="skel" style={{ height: 300 }} /> : d.mime === 'application/pdf' ? (
          <iframe ref={iframeRef} src={url} title={d.title} style={{ width: '100%', height: '60vh', border: 0, borderRadius: 14, background: '#fff' }} />
        ) : isImg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={d.title} style={{ maxWidth: '100%', maxHeight: '60vh', borderRadius: 14, display: 'block', margin: '0 auto' }} />
        ) : (
          <div className="errbox">Pré-visualização de HEIC indisponível neste navegador. Baixe o arquivo original para abrir.</div>
        )}
      </div>
      <div className="mono" style={{ fontSize: 12, color: 'var(--mute)', display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
        <span>{CATEGORY_LABEL[d.category].toUpperCase()}</span>
        <span>{d.original_name}</span>
        <span>{formatBytes(d.size_bytes)}</span>
        <span>{d.visibility === 'private' ? 'SÓ VOCÊ' : d.visibility === 'shared' ? 'COMPARTILHADO' : 'TODA A TURMA'}</span>
        {!owner ? <span>ENVIADO POR {profileOf(d.owner_id)?.display_name?.toUpperCase() ?? '—'}</span> : null}
      </div>
      {source.kind === 'supabase' ? (
        <div className={s.offRow}>
          <label className="check">
            <input type="checkbox" checked={keep} disabled={busy} onChange={(e) => void setKeep(e.target.checked)} />
            <span className="box" aria-hidden="true" />
            <span>Manter offline neste aparelho</span>
          </label>
          <span>{stateBadge(state) ?? <span className="pill">SÓ ONLINE</span>}</span>
          {state === 'failed' ? <><span style={{ fontSize: 13 }}>{local[d.id]?.error}</span><button className="btn btn-sm tap" onClick={() => void downloadOne(source, d)}>Tentar de novo</button></> : null}
          {state === 'saved' && !keep ? <button className="btn btn-sm tap" onClick={() => void removeLocal(source, d.id)}>Remover cópia</button> : null}
        </div>
      ) : null}
      <div className="actions">
        {url ? <a className="btn btn-sm tap" href={url} download={d.original_name}><Icon name="upload" size={16} />Baixar</a> : null}
        {canMeta ? <button className="btn btn-sm tap" onClick={() => setEdit((e) => !e)}><Icon name="edit" size={16} />Editar dados</button> : null}
        {owner || (isOrganizer && d.visibility === 'trip') ? <button className="btn btn-sm btn-danger tap" onClick={del} disabled={busy}>Excluir</button> : null}
      </div>
      {edit ? (
        <div className={s.review}>
          <div className="grid2">
            <label className="field">Título<input value={v.title} maxLength={120} onChange={(e) => setV({ ...v, title: e.target.value })} /></label>
            <label className="field">Categoria<select value={v.category} onChange={(e) => setV({ ...v, category: e.target.value as DocCategory })}>{CATS.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></label>
            <label className="field">Parada<select value={v.stop_id} onChange={(e) => setV({ ...v, stop_id: e.target.value })}><option value="">Nenhuma</option>{sortedStops(b).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label className="field">Válido até<input type="date" value={v.valid_until} onChange={(e) => setV({ ...v, valid_until: e.target.value })} /></label>
            <label className="field">Subtítulo<input value={v.subtitle} maxLength={120} onChange={(e) => setV({ ...v, subtitle: e.target.value })} /></label>
            {owner ? <label className="field">Quem vê<select value={v.visibility} onChange={(e) => setV({ ...v, visibility: e.target.value as DocVisibility })}><option value="private">Só eu</option><option value="shared">Pessoas escolhidas</option><option value="trip">Toda a turma</option></select></label> : null}
          </div>
          <label className="field">Notas<textarea rows={2} maxLength={2000} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></label>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary tap" onClick={saveMeta} disabled={busy}>Salvar</button></div>
        </div>
      ) : null}
      {owner && d.visibility === 'shared' ? (
        <fieldset className={s.review} style={{ margin: 0 }}>
          <legend className="h3">Compartilhado com</legend>
          {others.length ? others.map((m) => (
            <label key={m.user_id} className="check">
              <input type="checkbox" checked={shares.includes(m.user_id)} onChange={(e) => void toggleShare(m.user_id, e.target.checked)} />
              <span className="box" aria-hidden="true" />
              <span>{profileOf(m.user_id)?.display_name ?? 'Pessoa'}</span>
            </label>
          )) : <p style={{ margin: 0 }}>Convide alguém para a trilha para compartilhar.</p>}
          <small style={{ color: 'var(--mute)' }}>Tirar o acesso não apaga cópias já baixadas num aparelho que está desconectado; elas somem quando ele sincronizar.</small>
        </fieldset>
      ) : null}
    </Dialog>
  );
}

