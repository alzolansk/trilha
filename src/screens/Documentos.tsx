'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, useAction, useConfirm, useToast } from '../components/ui/feedback';
import { AiNote, Icon } from '../components/ui/primitives';
import { AI_STEPS, AiThinking } from '../components/ui/Loader';
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
import { CYCLE, DOC_CAT_VAR } from '../lib/identity/accent';
import { ruleAlerts } from '../lib/rules';
import { countdown } from '../lib/time';
import { Badge, Button, Card, Checkbox, Chip, EmptyState, Field, FieldGrid, Progress, ScreenHeader, buttonClass } from '../components/ui';
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
  const { bundle: b, canEdit, source, reload, me } = useBundle();
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
  const cols = CYCLE;
  const ready = b.documents.filter((d) => d.status === 'ready' || d.owner_id === me);
  const tipoParam = params.get('tipo');
  const cat = tipoParam && LABEL_TO_CAT[tipoParam] ? LABEL_TO_CAT[tipoParam] : 'todos';
  const tickets = ready.filter((d) => !d.is_shot);
  const shots = ready.filter((d) => d.is_shot);

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
      <ScreenHeader
        eyebrow={`${b.trip.title} · ${phase.kind === 'before' ? `faltam ${days} dias` : phase.kind === 'after' ? 'viagem concluída' : 'em andamento'}`}
        title="Documentos"
        subtitle="Tudo da viagem num lugar só, disponível mesmo sem internet."
        action={
          <div className={s.headActions}>
            <label className={`${buttonClass({ variant: 'secondary' })} ${s.searchBtn}`}>
              <Icon name="search" size={18} />
              <span className="sr">Buscar documento</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar" className={s.searchInput} />
            </label>
            {canEdit ? (
              <label className={buttonClass({ variant: 'primary' })}>
                <Icon name="upload" size={18} />
                Enviar arquivo
                <input type="file" multiple className="sr" accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/jpeg,image/png,image/heic,image/heif" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
              </label>
            ) : null}
          </div>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(420px,100%),1fr))', gap: 14, marginTop: 32 }}>
        {alert ? <div><AiNote by="rules"><b>{alert.title}.</b> {alert.detail}</AiNote></div> : null}
        <div>
          <AiNote by="rules">
            Passagens e documentos de identidade ficam no topo e são baixados para este aparelho automaticamente. Só aparece OFFLINE quando a cópia já está salva aqui.
            {est ? <small>{formatBytes(est.usage)} usados de {formatBytes(est.quota)} disponíveis neste navegador{est.persisted ? ' · armazenamento protegido' : ' · o navegador pode apagar cópias se faltar espaço'}.</small> : null}
          </AiNote>
        </div>
      </div>

      {source.kind === 'supabase' ? <VaultNote /> : null}

      {pendingUploads.length ? (
        <div className={s.errbox} style={{ marginTop: 18 }}>
          <span style={{ flex: 1 }}>{pendingUploads.length} envio(s) não terminaram. Exclua e envie de novo.</span>
          <Button variant="secondary" size="sm" onClick={async () => {
            for (const d of pendingUploads) {
              await source.removeFiles('documents', [d.storage_path, ...(d.preview_path ? [d.preview_path] : [])]).catch(() => undefined);
              await source.remove('documents', { id: d.id }).catch(() => undefined);
            }
            await reload();
          }}>Limpar envios incompletos</Button>
        </div>
      ) : null}

      {tickets.length ? (
        <div role="group" aria-label="Filtrar por tipo" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 32 }}>
          {cats.map((c) => (
            <Chip key={c} selected={c === cat} onClick={() => setCat(c)} count={c === 'todos' ? tickets.length : tickets.filter((d) => d.category === c).length}>
              {c === 'todos' ? 'Todos' : CATEGORY_LABEL[c]}
            </Chip>
          ))}
        </div>
      ) : null}

      <section className={s.grid} aria-label="Arquivos">
        {visible.map((d) => (
          <DocTicket key={d.id} d={d} stopName={stops.find((x) => x.id === d.stop_id)?.name} state={local[d.id]?.state ?? 'none'} onOpen={() => setOpenId(d.id)} />
        ))}
      </section>
      {tickets.length && !visible.length ? <p style={{ marginTop: 20, color: 'var(--mute)' }}>Nada encontrado para “{q}”.</p> : null}


      {shots.length ? (
        <section style={{ marginTop: 64 }}>
          <h2 className={s.h2}>Fotos e prints</h2>
          <div className={s.shots}>
            {shots.map((d, i) => (
              <Shot key={d.id} d={d} i={i} color={cols[i % 4]} onOpen={() => setOpenId(d.id)} />
            ))}
          </div>
        </section>
      ) : null}

      {canEdit ? (
        <label
          className={`${s.drop} ${over ? s.over : ''} ${!tickets.length ? s.dropHero : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
        >
          <input type="file" multiple className="sr" accept=".pdf,.jpg,.jpeg,.png,.heic,.heif" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
          <span className={s.ic}><Icon name="upload" size={28} /></span>
          <h2 className={s.h2} style={{ margin: 0 }}>{tickets.length ? 'Solta aqui' : 'Comece pelos documentos'}</h2>
          <p style={{ margin: 0, maxWidth: 520, fontSize: 17, color: 'var(--mute)' }}>PDFs, prints e fotos. A gente lê o texto, sugere se é passagem, reserva ou ingresso e a parada certa. Você confirma antes de salvar.</p>
          <span className={s.mono}>PDF · JPG · PNG · HEIC · ATÉ 25 MB</span>
        </label>
      ) : !tickets.length ? (
        <EmptyState icon="doc" title="Nenhum documento compartilhado" text="Quando a turma compartilhar documentos da viagem, eles aparecem aqui." />
      ) : null}

      {queue.length ? <UploadReview queue={queue} stops={stops} patch={patchQ} save={saveOne} remove={(k) => setQueue((qq) => qq.filter((x) => x.key !== k))} /> : null}
      {openId ? <DocViewer id={openId} onClose={() => { setOpenId(null); if (params.get('doc')) router.replace('?', { scroll: false }); }} /> : null}
    </div>
  );
}

function stateBadge(state: string) {
  if (state === 'saved') return <span className={s.off}><Icon name="cloud" size={13} />OFFLINE</span>;
  if (state === 'downloading') return <Badge upper>BAIXANDO…</Badge>;
  if (state === 'failed') return <Badge tone="brand" upper>FALHOU</Badge>;
  if (state === 'outdated') return <Badge upper>DESATUALIZADO</Badge>;
  return null;
}

function DocTicket({ d, stopName, state, onOpen }: { d: DocumentRow; stopName?: string; state: string; onOpen: () => void }) {
  const [bg, fg] = DOC_CAT_VAR[d.category];
  return (
    <article className={s.ticket} data-doc>
      <button className={s.ticketBtn} onClick={onOpen} aria-label={`Abrir ${d.title}`}>
        <div className={s.ticketHead} style={{ background: bg, color: fg }}>
          <span className={s.cat}>{CATEGORY_LABEL[d.category].toUpperCase()}</span>
          <Icon name="doc" size={18} />
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 6, flex: 1, textAlign: 'left' }}>
          <h2 className={s.ticketTitle}>{d.title}</h2>
          <div style={{ fontSize: 14, color: 'var(--mute)' }}>
            {d.subtitle ?? [stopName, d.valid_until ? `válido até ${dayMonth(d.valid_until)}` : null].filter(Boolean).join(' · ') ?? ''}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {d.visibility === 'private' ? <Badge upper>PRIVADO</Badge> : d.visibility === 'shared' ? <Badge upper>COMPARTILHADO</Badge> : null}
            {d.status === 'uploading' ? <Badge tone="brand" upper>ENVIO INCOMPLETO</Badge> : null}
            {d.classified_by === 'ai' ? <Badge tone="brand">IA</Badge> : null}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 'auto', paddingTop: 14 }}>
            <span className={s.mono}>{(d.original_name.split('.').pop() ?? '').toUpperCase()} · {formatBytes(d.size_bytes)}</span>
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
    <Card variant="suggest" pad="sm" className={s.vault}>
      <Badge tone={vault.status === 'unlocked' ? 'neutral' : 'brand'} upper>E2E</Badge>
      <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 14px' }}>
        {vault.status === 'unlocked' ? (
          <>
            <span style={{ flex: 1, minWidth: 220 }}>Cofre desbloqueado neste aparelho. Os arquivos são cifrados com AES-256-GCM antes do envio, e só quem tem acesso na turma consegue abrir.</span>
            <Button variant="secondary" size="sm" onClick={vault.openChange}>Trocar frase</Button>
            <Button variant="secondary" size="sm" onClick={() => void vault.lock()}>Trancar</Button>
          </>
        ) : (
          <>
            <span style={{ flex: 1, minWidth: 220 }}>
              {vault.status === 'none'
                ? 'Crie seu cofre para enviar e abrir documentos com criptografia ponta a ponta: o servidor guarda só o arquivo cifrado.'
                : 'Cofre trancado neste aparelho. Desbloqueie para enviar ou abrir documentos cifrados.'}
            </span>
            <Button size="sm" onClick={vault.ask}>{vault.status === 'none' ? 'Criar cofre' : 'Desbloquear'}</Button>
          </>
        )}
      </span>
    </Card>
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
  const shape = i % 2 ? 'inset(0 round 28px)' : 'circle(50%)';
  return (
    <figure style={{ transform: `rotate(${[-3, 2, -1.5, 3, -2][i % 5]}deg)` }}>
      <button onClick={onOpen} className={s.shotBtn} aria-label={`Abrir ${d.title}`}>
        <div className={s.ph} style={{ clipPath: shape, background: url ? undefined : `repeating-linear-gradient(135deg, color-mix(in srgb, ${color} 22%, var(--field)) 0 14px, var(--surface) 14px 28px)` }}>
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
      footer={<Button disabled={!readyAll} onClick={async () => { for (const it of queue.filter((x) => x.status === 'ready')) await save(it); }}>Salvar {queue.length > 1 ? 'todos' : ''}</Button>}>
      <p style={{ margin: 0, color: 'var(--mute)', fontSize: 14 }}>Confira as sugestões antes de salvar. Nada é inventado: se a leitura falhou, os campos ficam em branco para você preencher.</p>
      {queue.map((it) => (
        <div key={it.key} className={s.review}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <b style={{ wordBreak: 'break-all' }}>{it.file.name}</b>
            <span className={s.mono}>{formatBytes(it.file.size)}</span>
          </div>
          {it.status === 'reading' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}><AiThinking steps={AI_STEPS.classify} title={it.progress ? `Lendo · ${Math.round(it.progress * 100)}%` : 'Lendo o arquivo'} lines={0} compact /><Progress value={Math.max(0.08, it.progress)} height={8} label="Lendo o arquivo" /></div>
          ) : (
            <>
              {it.by !== 'user' ? <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}><Badge tone={it.by === 'ai' ? 'brand' : 'neutral'}>{it.by === 'ai' ? 'IA' : 'AUTO'}</Badge>Sugestão{it.reason ? `: ${it.reason}` : ''}. Corrija se precisar.</div> : <div style={{ fontSize: 13, color: 'var(--mute)' }}>Sem sinais claros no texto: escolha a categoria e a parada.</div>}
              {it.note ? <p className={s.err} role="alert">{it.note}</p> : null}
              <FieldGrid>
                <Field label="Título"><input value={it.title} maxLength={120} onChange={(e) => patch(it.key, { title: e.target.value, by: it.by })} /></Field>
                <Field label="Categoria"><select value={it.category} onChange={(e) => patch(it.key, { category: e.target.value as DocCategory })}>{CATS.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></Field>
                <Field label="Parada"><select value={it.stopId} onChange={(e) => patch(it.key, { stopId: e.target.value })}><option value="">Nenhuma</option>{stops.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
                <Field label="Quem vê"><select value={it.visibility} onChange={(e) => patch(it.key, { visibility: e.target.value as DocVisibility })}><option value="private">Só eu (privado)</option><option value="trip">Toda a turma da viagem</option></select></Field>
                <Field label="Subtítulo"><input value={it.subtitle} maxLength={120} onChange={(e) => patch(it.key, { subtitle: e.target.value })} placeholder={b.trip.title} /></Field>
                <Field label="Válido até (se houver)"><input type="date" value={it.validUntil} onChange={(e) => patch(it.key, { validUntil: e.target.value })} /></Field>
              </FieldGrid>
              {it.mime.startsWith('image/') ? <Checkbox checked={it.isShot} onChange={(v) => patch(it.key, { isShot: v })} label="Mostrar em “Fotos e prints”" /> : null}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Button variant="secondary" size="sm" onClick={() => remove(it.key)} disabled={it.status === 'saving'}>Descartar</Button>
                {it.status === 'error' ? <Button size="sm" onClick={() => void save(it)}>Tentar de novo</Button> : null}
                {it.status === 'saving' ? <Badge upper>ENVIANDO…</Badge> : null}
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
        {err ? <div className={s.errbox}><span style={{ flex: 1 }}>{err}</span>{d.encrypted && vault.status !== 'unlocked' ? <Button variant="secondary" size="sm" onClick={vault.ask}>{vault.status === 'none' ? 'Criar cofre' : 'Desbloquear'}</Button> : null}</div> : !url ? <div className="skel" style={{ height: 300 }} /> : d.mime === 'application/pdf' ? (
          <iframe ref={iframeRef} src={url} title={d.title} style={{ width: '100%', height: '60vh', border: 0, borderRadius: 14, background: '#fff' }} />
        ) : isImg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={d.title} style={{ maxWidth: '100%', maxHeight: '60vh', borderRadius: 14, display: 'block', margin: '0 auto' }} />
        ) : (
          <div className={s.errbox}>Pré-visualização de HEIC indisponível neste navegador. Baixe o arquivo original para abrir.</div>
        )}
      </div>
      <div className={`${s.mono} ${s.meta}`}>
        <span>{CATEGORY_LABEL[d.category].toUpperCase()}</span>
        <span>{d.original_name}</span>
        <span>{formatBytes(d.size_bytes)}</span>
        <span>{d.visibility === 'private' ? 'SÓ VOCÊ' : d.visibility === 'shared' ? 'COMPARTILHADO' : 'TODA A TURMA'}</span>
        {!owner ? <span>ENVIADO POR {profileOf(d.owner_id)?.display_name?.toUpperCase() ?? '—'}</span> : null}
      </div>
      {source.kind === 'supabase' ? (
        <div className={s.offRow}>
          <Checkbox checked={keep} disabled={busy} onChange={(v) => void setKeep(v)} label="Manter offline neste aparelho" />
          <span>{stateBadge(state) ?? <Badge upper>SÓ ONLINE</Badge>}</span>
          {state === 'failed' ? <><span style={{ fontSize: 13 }}>{local[d.id]?.error}</span><Button variant="secondary" size="sm" onClick={() => void downloadOne(source, d)}>Tentar de novo</Button></> : null}
          {state === 'saved' && !keep ? <Button variant="secondary" size="sm" onClick={() => void removeLocal(source, d.id)}>Remover cópia</Button> : null}
        </div>
      ) : null}
      <div className={s.actions}>
        {url ? <a className={buttonClass({ variant: 'secondary', size: 'sm' })} href={url} download={d.original_name}><Icon name="upload" size={16} />Baixar</a> : null}
        {canMeta ? <Button variant="secondary" size="sm" onClick={() => setEdit((e) => !e)}><Icon name="edit" size={16} />Editar dados</Button> : null}
        {owner || (isOrganizer && d.visibility === 'trip') ? <Button variant="secondary" size="sm" className={s.danger} onClick={del} disabled={busy}>Excluir</Button> : null}
      </div>
      {edit ? (
        <div className={s.review}>
          <FieldGrid>
            <Field label="Título"><input value={v.title} maxLength={120} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
            <Field label="Categoria"><select value={v.category} onChange={(e) => setV({ ...v, category: e.target.value as DocCategory })}>{CATS.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></Field>
            <Field label="Parada"><select value={v.stop_id} onChange={(e) => setV({ ...v, stop_id: e.target.value })}><option value="">Nenhuma</option>{sortedStops(b).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
            <Field label="Válido até"><input type="date" value={v.valid_until} onChange={(e) => setV({ ...v, valid_until: e.target.value })} /></Field>
            <Field label="Subtítulo"><input value={v.subtitle} maxLength={120} onChange={(e) => setV({ ...v, subtitle: e.target.value })} /></Field>
            {owner ? <Field label="Quem vê"><select value={v.visibility} onChange={(e) => setV({ ...v, visibility: e.target.value as DocVisibility })}><option value="private">Só eu</option><option value="shared">Pessoas escolhidas</option><option value="trip">Toda a turma</option></select></Field> : null}
          </FieldGrid>
          <Field label="Notas"><textarea rows={2} maxLength={2000} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Button onClick={saveMeta} disabled={busy}>Salvar</Button></div>
        </div>
      ) : null}
      {owner && d.visibility === 'shared' ? (
        <fieldset className={s.review} style={{ margin: 0 }}>
          <legend className={s.legend}>Compartilhado com</legend>
          {others.length ? others.map((m) => (
            <Checkbox key={m.user_id} checked={shares.includes(m.user_id)} onChange={(v) => void toggleShare(m.user_id, v)} label={profileOf(m.user_id)?.display_name ?? 'Pessoa'} />
          )) : <p style={{ margin: 0 }}>Convide alguém para a trilha para compartilhar.</p>}
          <small style={{ color: 'var(--mute)' }}>Tirar o acesso não apaga cópias já baixadas num aparelho que está desconectado; elas somem quando ele sincronizar.</small>
        </fieldset>
      ) : null}
    </Dialog>
  );
}

