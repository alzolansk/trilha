'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import { applyIdentity } from '../../components/shell/ThemeApplier';
import { Icon, Pattern } from '../../components/ui/primitives';
import { useAction } from '../../components/ui/feedback';
import { useAuth } from '../../data/AuthContext';
import type { TripStyle } from '../../data/types';
import { aiStatus, callAi } from '../../lib/ai/client';
import { DICTIONARY, DICTIONARY_ORDER, matchDictionary } from '../../lib/identity/dictionary';
import { MINI_CLIP, SLIT_LABEL } from '../../lib/identity/shapes';
import type { DestinationIdentity } from '../../lib/identity/types';
import { getSupabase } from '../../lib/supabase/client';
import { localTimeZone, wallToInstant } from '../../lib/time';
import s from './onboarding.module.css';

const DEST: Record<string, string> = { andes: 'Peru + Bolívia', japao: 'Japão', marrocos: 'Marrocos', islandia: 'Islândia' };
const STYLES: TripStyle[] = ['Mochilão', 'Conforto', 'Aventura', 'Cultural'];

function Onboarding() {
  const { ready, user, refreshTrips } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const { run, busy } = useAction();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const preset = params.get('identidade');
  const [step, setStep] = useState(0);
  const [text, setText] = useState(preset && DEST[preset] ? DEST[preset] : '');
  const [v, setV] = useState({ start: '', end: '', time: '', tz: 'America/Sao_Paulo', origin: '', style: 'Mochilão' as TripStyle });
  const [identity, setIdentity] = useState<DestinationIdentity | null>(null);
  const [by, setBy] = useState<string>('dictionary');
  const [version, setVersion] = useState(1);
  const [phase, setPhase] = useState(0);
  const [genError, setGenError] = useState<string | null>(null);
  const [aiOn, setAiOn] = useState<boolean | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (ready && !user) router.replace('/entrar?next=/nova-trilha');
  }, [ready, user, router]);
  useEffect(() => {
    setV((x) => ({ ...x, tz: localTimeZone() }));
    void aiStatus().then((st) => setAiOn(!!st?.configured));
    return () => applyIdentity(null);
  }, []);

  const hit = matchDictionary(text);
  const previewId = identity ?? (hit ? DICTIONARY[hit] : null);
  // A página assume o tema do destino assim que ele é reconhecido (transição de 800ms).
  useEffect(() => {
    applyIdentity(previewId);
  }, [previewId]);

  const generate = async (ver: number) => {
    setStep(2);
    setPhase(0);
    setGenError(null);
    setIdentity(null);
    timers.current.forEach(clearTimeout);
    const started = Date.now();
    const req = callAi<DestinationIdentity>('identity', { destination: text.trim(), departDate: v.start || null, returnDate: v.end || null, style: v.style, version: ver });
    // Fases de ~650ms; avançam no máximo até a 1 enquanto a resposta não chega, mínimo de 3s no total.
    timers.current.push(setTimeout(() => setPhase(1), 400));
    const r = await req;
    if (!r) {
      setGenError('Não deu pra gerar a identidade agora. Confira a conexão e tente de novo.');
      return;
    }
    const wait = Math.max(0, 3000 - (Date.now() - started));
    timers.current.push(setTimeout(() => {
      setIdentity(r.data);
      setBy(r.by);
      for (let i = 2; i <= 6; i++) timers.current.push(setTimeout(() => setPhase(i), (i - 2) * 650));
    }, wait));
  };

  const create = () =>
    run(async () => {
      const sb = getSupabase();
      if (!sb || !user || !identity) throw new Error('Entre na sua conta para criar a trilha.');
      const id = crypto.randomUUID();
      const [y, mo, d] = v.start.split('-').map(Number);
      const [h, mi] = (v.time || '00:00').split(':').map(Number);
      const departure = v.time ? new Date(wallToInstant(v.tz, { y, mo, d, h, mi, s: 0 })).toISOString() : null;
      const ins = await sb.from('trips').insert({
        id, title: text.trim().slice(0, 80), destinations: [text.trim().slice(0, 80)], start_date: v.start, end_date: v.end, departure_at: departure,
        departure_tz: v.tz, home_tz: localTimeZone(), origin: v.origin.trim().toUpperCase() || null, style: v.style, created_by: user.id,
        identity, identity_version: identity.version,
      });
      if (ins.error) throw ins.error;
      // Grupos iniciais (vazios) para a mala e categorias do orçamento (SPEC: Transporte, Hospedagem, Passeios, Comida).
      await sb.from('packing_categories').insert(['Documentos', 'Roupas', 'Equipamento', 'Farmácia'].map((name, i) => ({ trip_id: id, name, position: i })));
      await sb.from('budget_categories').insert(['Transporte', 'Hospedagem', 'Passeios', 'Comida'].map((name, i) => ({ trip_id: id, name, position: i, planned: 0, color: '#000000' })));
      await refreshTrips();
      router.replace(`/t/${id}`);
    });

  const datesOk = v.start && v.end && v.end >= v.start;
  const steps = ['01 Destino', '02 Datas', '03 Identidade'];
  const msg = hit
    ? `IDENTIDADE ENCONTRADA NO DICIONÁRIO: ${DICTIONARY[hit].idName.toUpperCase()}`
    : text.trim().length > 3
      ? aiOn === false
        ? 'FORA DO DICIONÁRIO: GERAMOS UMA IDENTIDADE POR REGRAS (IA NÃO CONFIGURADA)'
        : 'FORA DO DICIONÁRIO: A IA GERA UMA IDENTIDADE NOVA'
      : '';

  if (!ready || !user) return <div className="wrap" style={{ paddingTop: 120 }}><div className="skel" style={{ height: 300 }} /></div>;
  return (
    <div className={s.ob}>
      {previewId && step > 0 ? <div className="bg-pattern" style={{ opacity: 0.07 }}><Pattern identity={previewId} /></div> : null}
      <div className="wrap" style={{ display: 'flex', flexDirection: 'column', gap: 48, paddingTop: 28 }}>
        <header style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
          <Link href="/" className={s.logo}><span className="motif" />trilha</Link>
          <ol className={s.steps} aria-label="Etapas">
            {steps.map((x, i) => <li key={x} aria-current={i === step ? 'step' : undefined}>{x.toUpperCase()}</li>)}
          </ol>
        </header>
        <main id="main">
          {step === 0 ? (
            <section className="view" style={{ display: 'flex', flexWrap: 'wrap', gap: 48, alignItems: 'flex-start', paddingTop: '4vh' }}>
              <div style={{ flex: '1 1 360px', display: 'flex', flexDirection: 'column', gap: 22 }}>
                <h1 style={{ margin: 0, fontSize: 'clamp(48px,6vw,96px)', fontWeight: 500, letterSpacing: '-.04em', lineHeight: 0.95 }}>Pra onde vai a próxima trilha?</h1>
                <p style={{ margin: 0, fontSize: 18, opacity: 0.8, maxWidth: 460 }}>Cada destino ganha uma identidade própria: cores, fonte, padrões e o jeito que a sua foto se abre.</p>
                <label className="field">Digite um destino
                  <span className={s.search}>
                    <Icon name="search" size={20} />
                    <input value={text} maxLength={80} onChange={(e) => { setText(e.target.value); setIdentity(null); setVersion(1); }} placeholder="Cidade, país ou região" />
                  </span>
                </label>
                <p className="mono" style={{ margin: 0, fontSize: 12, letterSpacing: '.06em', minHeight: '1.4em' }} aria-live="polite">{msg}</p>
              </div>
              <div style={{ flex: '1 1 420px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(200px,100%),1fr))', gap: 14 }}>
                <span className="eyebrow" style={{ gridColumn: '1/-1', color: 'inherit', opacity: 0.7 }}>Ou escolha um destino do dicionário</span>
                {DICTIONARY_ORDER.map((k) => (
                  <button key={k} className={`${s.destcard} tap`} aria-pressed={hit === k} onClick={() => { setText(DEST[k]); setIdentity(null); setVersion(1); }}>
                    <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-.02em' }}>{DEST[k]}</span>
                    <span className="mono" style={{ fontSize: 12, letterSpacing: '.1em', opacity: 0.7 }}>{DICTIONARY[k].idName.toUpperCase()}</span>
                  </button>
                ))}
                <Link href="/identidades" className="mono" style={{ gridColumn: '1/-1', fontSize: 12 }}>VER AS IDENTIDADES E AS DEMONSTRAÇÕES →</Link>
              </div>
              <div style={{ flex: '1 1 100%', display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn btn-ink tap" disabled={text.trim().length < 2} onClick={() => setStep(1)}>Continuar<Icon name="arrow" size={18} /></button>
              </div>
            </section>
          ) : step === 1 ? (
            <section className="view" style={{ display: 'flex', flexDirection: 'column', gap: 34, paddingTop: '4vh', maxWidth: 820 }}>
              <h1 className="disp" style={{ margin: 0, fontSize: 'clamp(44px,5.5vw,84px)', lineHeight: 0.95 }}>{text.trim()}. Quando e como?</h1>
              <div className="grid2">
                <label className="field">Ida<input type="date" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} required /></label>
                <label className="field">Volta<input type="date" value={v.end} min={v.start} onChange={(e) => setV({ ...v, end: e.target.value })} required /></label>
                <label className="field">Horário do embarque (opcional)<input type="time" value={v.time} onChange={(e) => setV({ ...v, time: e.target.value })} /></label>
                <label className="field">Saindo de (opcional)<input value={v.origin} maxLength={60} onChange={(e) => setV({ ...v, origin: e.target.value })} placeholder="GRU" /></label>
              </div>
              {v.start && v.end && v.end < v.start ? <span className="field"><span className="err">A volta precisa ser depois da ida.</span></span> : null}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 500 }}>Estilo da viagem</span>
                <div role="group" aria-label="Estilo" style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {STYLES.map((x) => <button key={x} className="chip tap" aria-pressed={x === v.style} onClick={() => setV({ ...v, style: x })}>{x}</button>)}
                </div>
              </div>
              <p style={{ margin: 0, color: 'var(--mute)' }}>Turma: dá pra convidar depois, em Turma e convites. Fuso do embarque: {v.tz} (muda nos dados da trilha).</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 }}>
                <button className="btn btn-ghost tap" style={{ background: 'transparent' }} onClick={() => setStep(0)}>Voltar</button>
                <button className="btn btn-ink tap" disabled={!datesOk} onClick={() => void generate(version)}><Icon name="sparkle" size={18} sw={1.6} fill="currentColor" />Gerar identidade</button>
              </div>
            </section>
          ) : (
            <Generation
              text={text.trim()} style={v.style} identity={identity} phase={phase} by={by} error={genError} uid={uid} busy={busy}
              onOpen={create} onAgain={() => { const nv = version + 1; setVersion(nv); void generate(nv); }} onBack={() => setStep(1)} onRetry={() => void generate(version)}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function Generation({ text, style, identity: t, phase, by, error, busy, onOpen, onAgain, onBack, onRetry }: {
  text: string; style: string; identity: DestinationIdentity | null; phase: number; by: string; error: string | null; uid: string; busy: boolean;
  onOpen: () => void; onAgain: () => void; onBack: () => void; onRetry: () => void;
}) {
  const sources = t?.sources ?? ['Destino e região', 'Época da viagem', `Estilo ${style.toLowerCase()}`, 'Cores e formas'];
  const on = (n: number) => (phase >= n ? `${s.g} ${s.on}` : s.g);
  const mini = useMemo(() => (t ? t.miniClip ?? MINI_CLIP[t.slit] : 'inset(50% 50% 50% 50%)'), [t]);
  if (error) {
    return (
      <section className="view" style={{ paddingTop: '4vh', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="errbox">{error}</div>
        <div className="actions"><button className="btn btn-primary tap" onClick={onRetry}>Tentar de novo</button><button className="btn tap" onClick={onBack}>Ajustar dados</button></div>
      </section>
    );
  }
  return (
    <section className="view" style={{ display: 'flex', flexWrap: 'wrap', gap: 40, alignItems: 'stretch', paddingTop: '2vh' }}>
      <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 26 }}>
        <span className="eyebrow" style={{ color: 'inherit', opacity: 0.7 }}>{phase >= 6 ? 'Pronto' : 'Gerando'} · estilo {style}</span>
        <h1 style={{ margin: 0, fontSize: 'clamp(36px,4vw,60px)', fontWeight: 500, letterSpacing: '-.03em', lineHeight: 1 }}>Criando a identidade da sua trilha</h1>
        <p style={{ margin: 0, fontSize: 17, opacity: 0.8 }}>A partir do destino, da época e do estilo, montamos cores, tipografia, padrão gráfico e o formato da fenda que abre a sua foto.</p>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {sources.map((x, i) => (
            <li key={x} className={`${s.genItem} ${phase >= 2 + Math.floor(i / 2) || (phase >= 1 && i === 0) ? s.genOn : ''}`}>
              <span className={s.ok}><Icon name="check" size={16} sw={2} /></span>{x}
            </li>
          ))}
        </ul>
        {t && phase >= 2 ? (
          <p className="mono" style={{ margin: 0, fontSize: 11, letterSpacing: '.1em' }}>
            {by === 'ai' ? `GERADA POR IA (${t.model ?? ''}) · VALIDADA: CONTRASTE, FONTE, FENDA, MOTIF` : by === 'dictionary' ? 'IDENTIDADE CURADA DO DICIONÁRIO' : 'GERADA POR REGRAS LOCAIS (IA INDISPONÍVEL)'}
          </p>
        ) : null}
      </div>
      <div className="card" style={{ flex: '1.3 1 440px', display: 'flex', flexDirection: 'column', gap: 22, padding: 30, borderRadius: 28, background: 'var(--soft)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span className="eyebrow" style={{ color: 'inherit' }}>Identidade</span>
          <b className={on(2)}>{t?.idName}</b>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {(t ? [t.palette.bg, t.palette.acc, t.palette.acc2, t.palette.acc3, t.palette.deep] : ['#ddd', '#ccc', '#bbb', '#aaa', '#999']).map((h, i) => (
            <div key={i} className={on(2)} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, transitionDelay: `${i * 0.08}s` }}>
              <span style={{ height: 74, borderRadius: 14, background: h, border: '1px solid rgba(0,0,0,.12)' }} />
              <span className="mono" style={{ fontSize: 11 }}>{t ? h : ''}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
          <div className={on(3)} style={{ flex: '2 1 220px', padding: '18px 20px', borderRadius: 18, border: '1px solid var(--line)' }}>
            <div className="mono" style={{ fontSize: 11, letterSpacing: '.18em', opacity: 0.7 }}>FONTE DISPLAY · {t?.display.family.toUpperCase()}</div>
            <div className="disp" style={{ fontSize: 64, lineHeight: 1, marginTop: 8, overflowWrap: 'anywhere' }}>Aa {text}</div>
          </div>
          <div className={on(4)} style={{ flex: '1 1 140px', minHeight: 130, borderRadius: 18, overflow: 'hidden', background: 'var(--bg)', position: 'relative' }}>
            {t ? <Pattern identity={t} /> : null}
          </div>
          <div className={on(5)} style={{ flex: '1 1 160px', minHeight: 130, borderRadius: 18, background: 'var(--bg)', border: '1px solid var(--line)', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'var(--deep)', clipPath: phase >= 5 ? mini : 'inset(50% 50% 50% 50%)', transition: 'clip-path .8s var(--ease-out)' }} />
            <span className="mono" style={{ position: 'absolute', left: 12, bottom: 10, fontSize: 10, letterSpacing: '.14em', padding: '3px 6px', background: 'var(--bg)', borderRadius: 4 }}>FENDA · {t ? (t.shapeName ?? SLIT_LABEL[t.slit]).toUpperCase() : ''}</span>
          </div>
        </div>
        <div className={on(6)} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 'auto' }}>
          <button className="btn btn-primary tap" onClick={onOpen} disabled={!t || busy || phase < 6}>{busy ? 'Criando…' : 'Abrir minha trilha'}<Icon name="arrow" size={18} /></button>
          <button className="btn btn-ghost tap" style={{ background: 'transparent' }} onClick={onAgain} disabled={busy || phase < 6}>Gerar outra versão</button>
          <button className="btn tap" style={{ background: 'transparent', border: 0, textDecoration: 'underline' }} onClick={onBack}>Ajustar dados</button>
        </div>
      </div>
    </section>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Onboarding />
    </Suspense>
  );
}
