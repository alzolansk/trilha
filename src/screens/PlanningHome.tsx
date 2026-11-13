'use client';
// Início de uma trilha sem destino (planning §5.1, "Sem destino"): uma decisão por vez, sem countdown.
// CTA principal leva ao Descobrir.
import Link from 'next/link';
import { useMemo } from 'react';
import { TripSwitcherButton } from '../components/shell/TripSwitcher';
import { AvatarStack } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { ListRow } from '../components/ui/ListRow';
import { Stat } from '../components/ui/Stat';
import { AiTag } from '../components/ui/primitives';
import { useBundle } from '../data/TripContext';
import { dateSpan, plural } from '../lib/format';
import { formatMoney, toCents } from '../lib/money';
import { PLAN_STAGES, planStage, planSteps } from '../lib/plan';
import { daysBetween } from '../lib/time';
import s from './planning.module.css';

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
  const people = b.members.map((m) => {
    const p = b.profiles.find((x) => x.id === m.user_id);
    return { id: m.user_id, name: p?.display_name ?? 'Pessoa', color: p?.color, me: m.user_id === me };
  });

  return (
    <div className={s.page}>
      <div className={s.top}>
        <TripSwitcherButton variant="hero" />
        <Link href={`${base}/turma`} className={s.turma} aria-label="Abrir a turma"><AvatarStack people={people} max={3} size={32} /></Link>
      </div>

      <header className={s.head}>
        <span className={s.eyebrow}>Ainda sem destino</span>
        <h1 className={s.title}>{trip.title}</h1>
        <p className={s.sub}>{plural(days, 'dia', 'dias')} · {dateSpan(trip.start_date, trip.end_date)}{trip.origin ? ` · saindo de ${trip.origin}` : ''}</p>
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
          <span className={s.nextEyebrow}>Próximo passo <AiTag by="rules" /></span>
          <h2 id="proximo-passo" className={s.nextTitle}>{next.title}</h2>
          <p className={s.nextText}>{next.detail}</p>
          <div className={s.actions}>
            <Button href={base + next.link} iconEnd="arrow">{next.key === 'destination' ? 'Descobrir destino' : next.cta}</Button>
            {canEdit && next.key === 'destination' ? (
              <>
                <Button variant="secondary" href={`${base}/turma/votos#nova-votacao`}>Já temos opções: votar</Button>
                <Button variant="ghost" href={`${base}/ajustes`}>Já sei o destino</Button>
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className={s.cols}>
        {rest.length ? (
          <section className={s.block} aria-labelledby="depois">
            <h2 id="depois" className={s.h2}>Depois disso</h2>
            <div>
              {rest.map((x) => (
                <ListRow
                  key={x.key}
                  icon={x.locked ? 'lock' : 'next'}
                  iconTone="neutral"
                  title={x.title.replace(/\.$/, '')}
                  subtitle={x.detail}
                  href={x.locked ? undefined : base + x.link}
                  chevron={!x.locked}
                />
              ))}
            </div>
          </section>
        ) : null}

        <section className={s.block} aria-labelledby="decidido">
          <h2 id="decidido" className={s.h2}>Já decidido</h2>
          <div className={s.facts}>
            <Stat label="Datas" value={dateSpan(trip.start_date, trip.end_date)} />
            <Stat label="Estilo" value={trip.style} />
            <Stat label="Turma" value={plural(people.length, 'pessoa', 'pessoas')} />
            {budget ? <Stat label="Orçamento" value={formatMoney(budget, trip.base_currency, { compact: true })} /> : null}
          </div>
          {people.length < 2 && canEdit ? <Link href={`${base}/turma`} className={s.invite}>Chamar a turma pra decidir junto</Link> : null}
        </section>
      </div>
    </div>
  );
}
