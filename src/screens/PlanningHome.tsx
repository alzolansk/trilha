'use client';
import Link from 'next/link';
import { useMemo } from 'react';
import { AiTag, Icon } from '../components/ui/primitives';
import { useBundle } from '../data/TripContext';
import { dateSpan, plural } from '../lib/format';
import { formatMoney, toCents } from '../lib/money';
import { PLAN_STAGES, planStage, planSteps } from '../lib/plan';
import { daysBetween } from '../lib/time';
import s from './planning.module.css';

/** Início de uma trilha sem destino: uma decisão por vez, sem countdown. */
export default function PlanningHome() {
  const { bundle: b, base, me, canEdit } = useBundle();
  const trip = b.trip;
  const now = Date.now();
  const stage = planStage(b, now);
  const steps = useMemo(() => planSteps(b, me, now), [b, me]); // eslint-disable-line react-hooks/exhaustive-deps
  const next = steps.find((x) => !x.locked) ?? null;
  const rest = steps.filter((x) => x !== next);
  const stageIdx = PLAN_STAGES.findIndex((x) => x.key === stage);
  const days = daysBetween(trip.start_date, trip.end_date) + 1;
  const budget = trip.budget_total != null ? toCents(String(trip.budget_total)) : 0;
  const people = b.members.length;

  return (
    <div className="wrap view" style={{ paddingTop: 120 }}>
      <main id="main" className={s.page}>
        <header className={s.head}>
          <span className="eyebrow">Ainda sem destino</span>
          <h1 className={s.title}>{trip.title}</h1>
          <p className={s.sub}>
            {plural(days, 'dia', 'dias')} · {dateSpan(trip.start_date, trip.end_date)}{trip.origin ? ` · saindo de ${trip.origin}` : ''}
          </p>
        </header>

        <ol className={s.stages} aria-label="Fases do planejamento">
          {PLAN_STAGES.map((x, i) => (
            <li key={x.key} data-state={i < stageIdx ? 'done' : i === stageIdx ? 'now' : 'next'} aria-current={i === stageIdx ? 'step' : undefined}>
              <span className={s.bar} aria-hidden="true" />
              {x.label}
            </li>
          ))}
        </ol>

        {next ? (
          <section className={s.next} aria-labelledby="proximo-passo">
            <span className={s.nextEyebrow}>Próximo passo <AiTag by="rules" solid /></span>
            <h2 id="proximo-passo" className={s.nextTitle}>{next.title}</h2>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.45 }}>{next.detail}</p>
            <div className={s.nextActions}>
              <Link className={`${s.cta} tap`} href={base + next.link}>{next.cta}<Icon name="arrow" size={18} /></Link>
              {canEdit && next.key === 'destination' ? (
                <>
                  <Link className={`${s.cta2} tap`} href={`${base}/turma#nova-votacao`}>Já temos opções: votar</Link>
                  <Link className={`${s.cta2} tap`} href={`${base}/editar`}>Já sei o destino</Link>
                </>
              ) : null}
            </div>
          </section>
        ) : null}

        <div className={s.cols}>
          {rest.length ? (
            <section className={s.block} aria-labelledby="depois">
              <h2 id="depois" className="eyebrow" style={{ margin: 0 }}>Depois disso</h2>
              <ul className={s.list}>
                {rest.map((x) => (
                  <li key={x.key} data-locked={x.locked ? '' : undefined}>
                    <span className={`motif ${s.dot}`} aria-hidden="true" />
                    {x.locked ? (
                      <span className={s.item}><b>{x.title}</b><span>{x.detail}</span></span>
                    ) : (
                      <Link className={s.item} href={base + x.link}><b>{x.title}</b><span>{x.detail}</span></Link>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className={s.block} aria-labelledby="decidido">
            <h2 id="decidido" className="eyebrow" style={{ margin: 0 }}>Já decidido</h2>
            <div className={s.facts}>
              <div className={s.fact}><span>Datas</span><b>{dateSpan(trip.start_date, trip.end_date)}</b></div>
              <div className={s.fact}><span>Estilo</span><b>{trip.style}</b></div>
              <div className={s.fact}><span>Turma</span><b>{plural(people, 'pessoa', 'pessoas')}</b></div>
              {budget ? <div className={s.fact}><span>Orçamento</span><b>{formatMoney(budget, trip.base_currency, { compact: true })}</b></div> : null}
            </div>
            {people < 2 && canEdit ? <Link href={`${base}/turma`} className={s.invite}>Chamar a turma pra decidir junto →</Link> : null}
          </section>
        </div>

        <p className={s.note}>Quando o destino fechar, a trilha ganha a identidade dele e o countdown começa.</p>
      </main>
    </div>
  );
}
