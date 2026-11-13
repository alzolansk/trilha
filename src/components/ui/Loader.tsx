'use client';
import { useEffect, useState } from 'react';
import { Icon } from './primitives';
import s from './Loader.module.css';

/*
 * Loaders da Trilha. Tudo sai da marca: a trilha pontilhada do logo, o quadrado ultramar
 * e o ponto tangerina que percorre o caminho. Regras:
 *  - conteúdo com formato conhecido continua usando Skeleton (nunca spinner);
 *  - estes loaders cobrem o que não tem formato: abrir o app, esperar a IA, botões ocupados;
 *  - com prefers-reduced-motion as animações param (globals.css) e só o texto informa o estado.
 */

const TRAIL = 'M9 29C15 29 14 18 20 18S26 11 31 11';

/** Troca a mensagem a cada `every` ms; para na última se `loop` for falso. */
function useCycle(n: number, every: number, loop = true) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (n < 2) return;
    const t = setInterval(() => setI((x) => (x + 1 < n ? x + 1 : loop ? 0 : x)), every);
    return () => clearInterval(t);
  }, [n, every, loop]);
  return Math.min(i, Math.max(0, n - 1));
}

/** Marca animada: a trilha se desenha ponto a ponto e o sol percorre o caminho. */
export function TrailMark({ size = 56, tone = 'brand' }: { size?: number; tone?: 'brand' | 'plain' }) {
  return (
    <svg className={s.mark} data-tone={tone} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      {tone === 'brand' ? <rect className={s.markBg} width="40" height="40" rx="12" /> : null}
      <path className={s.markGhost} d={TRAIL} />
      <path className={s.markTrail} d={TRAIL} pathLength={100} />
      <circle className={s.markGoal} cx="31" cy="11" r="3.5" />
      <circle className={s.markSun} r="3.5" style={{ offsetPath: `path('${TRAIL}')` }} />
    </svg>
  );
}

/** Carregamento de tela inteira (abrir o app, entrar numa trilha). */
export function PageLoader({ messages = ['Abrindo a trilha', 'Juntando a turma', 'Arrumando o roteiro'] }: { messages?: string[] }) {
  const i = useCycle(messages.length, 1600);
  return (
    <div className={s.page} role="status" aria-busy="true">
      <TrailMark size={72} />
      <span className={s.pageMsg} key={i}>
        {messages[i]}
        <LoadingDots />
      </span>
    </div>
  );
}

/** Faixa fina no topo de uma tela que está carregando: pontos marchando e o sol indo e voltando. */
export function TrailBar({ label = 'Carregando' }: { label?: string }) {
  return (
    <div className={s.bar} role="progressbar" aria-label={label} aria-busy="true">
      <span className={s.barSun} />
    </div>
  );
}

/** Três pontos que pulam em fila, como passos numa trilha. Para dentro de botões e textos. */
export function LoadingDots({ label }: { label?: string }) {
  return (
    <span className={s.dots} aria-hidden={label ? undefined : true} role={label ? 'status' : undefined}>
      <i />
      <i />
      <i />
      {label ? <span className="sr">{label}</span> : null}
    </span>
  );
}

/** Conteúdo de botão ocupado: pontos + texto. Ex.: `{busy ? <Busy>Salvando</Busy> : 'Salvar'}`. */
export function Busy({ children }: { children: React.ReactNode }) {
  return (
    <span className={s.busy} aria-live="polite">
      <LoadingDots />
      {children}
    </span>
  );
}

/** Conteúdo de botão de IA ocupado: brilho girando + texto que vai mudando. */
export function AiBusy({ steps }: { steps: string[] }) {
  const i = useCycle(steps.length, 1800, false);
  return (
    <span className={s.busy} aria-live="polite">
      <span className={s.sparkSm} aria-hidden="true"><Icon name="sparkle" size={16} sw={1.4} fill="currentColor" /></span>
      <span key={i} className={s.swap}>{steps[i]}</span>
    </span>
  );
}

export const AI_STEPS = {
  explore: ['Lendo o que vocês querem', 'Pensando em destinos', 'Conferindo o orçamento', 'Montando a lista'],
  acts: ['Olhando a parada', 'Pensando em passeios', 'Conferindo o teto por pessoa', 'Montando as sugestões'],
  areas: ['Olhando o mapa', 'Comparando bairros', 'Montando as sugestões'],
  packing: ['Lendo o roteiro', 'Checando o clima', 'Pensando no que levar', 'Montando a lista'],
  tips: ['Olhando a parada', 'Pensando numa dica', 'Escrevendo'],
  retro: ['Relendo o diário', 'Juntando as memórias', 'Escrevendo a retrospectiva'],
  classify: ['Lendo o arquivo', 'Entendendo o documento', 'Sugerindo categoria e parada'],
  places: ['Lendo o que a turma curte', 'Pensando em cidades', 'Conferindo noites e distâncias', 'Montando os cartões'],
  route: ['Juntando os indispensáveis', 'Ordenando as cidades', 'Encaixando as noites', 'Montando a rota'],
  tours: ['Olhando a cidade', 'Pensando em passeios', 'Separando os melhores'],
  estimate: ['Lendo o roteiro', 'Buscando preços de referência', 'Calculando a faixa por pessoa'],
  suggest: ['Olhando a parada', 'Pensando em sugestões', 'Montando os cartões'],
  identity: ['Lendo o destino', 'Escolhendo as cores', 'Testando contraste', 'Combinando as fontes', 'Recortando a fenda'],
} satisfies Record<string, string[]>;

/**
 * Bloco "a IA está trabalhando": brilho com o sol orbitando, etapas que acendem uma a uma
 * (lendo → pensando → montando) e linhas-fantasma sendo montadas no lugar do resultado.
 */
export function AiThinking({ steps, title = 'A IA está montando', lines = 3, compact = false }: {
  steps: string[];
  title?: string;
  /** Linhas-fantasma no lugar do resultado (0 para nenhuma). */
  lines?: number;
  compact?: boolean;
}) {
  const i = useCycle(steps.length, 1800, false);
  return (
    <div className={s.think} data-compact={compact || undefined} role="status" aria-live="polite" aria-busy="true">
      <div className={s.thinkHead}>
        <span className={s.orb} aria-hidden="true">
          <span className={s.orbRing} />
          <span className={s.orbSun} />
          <Icon name="sparkle" size={compact ? 16 : 20} sw={1.4} fill="currentColor" />
        </span>
        <div className={s.thinkText}>
          <span className={s.thinkTitle}>{title}</span>
          <span key={i} className={`${s.thinkStep} ${s.swap}`}>
            {steps[i]}
            <LoadingDots />
          </span>
        </div>
      </div>
      {!compact && steps.length > 1 ? (
        <ol className={s.track} aria-hidden="true">
          {steps.map((x, k) => (
            <li key={x} data-state={k < i ? 'done' : k === i ? 'now' : 'next'}>
              <span className={s.trackDot} />
              <span className={s.trackLabel}>{x}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {lines > 0 ? (
        <div className={s.ghosts} aria-hidden="true">
          {Array.from({ length: lines }, (_, k) => (
            <span key={k} className={s.ghost} style={{ animationDelay: `${k * 180}ms`, width: `${[92, 74, 84, 62][k % 4]}%` }} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
