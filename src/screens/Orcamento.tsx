'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useBundle } from '../data/TripContext';
import { useAuth } from '../data/AuthContext';
import Link from 'next/link';
import { budgetFromPlan, budgetRange, capPerPerson, describeChanges, diffSince, foodLevels, FOODS, initialPlan, ROOMS, stayOptions, tourOptions, transportLegs, virtualLegs } from '../lib/budgetPlan';
import { foodByCountry } from '../lib/onboarding';
import { EmptyState } from '../components/ui/EmptyState';
import { categoryKind, formatMoney, toCents } from '../lib/money';
import { closeBudget } from '../data/budgetActions';
import { callAi } from '../lib/ai/client';
import { Button } from '../components/ui/Button';
import { Checkbox } from '../components/ui/Checkbox';
import { EstimateBadge } from '../components/ui/Badge';
import { Progress } from '../components/ui/Progress';
import { Segmented } from '../components/ui/Segmented';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { StepChat, TrilhaBubble, ChatOptions, ReplyBubble } from '../components/ui/StepChat';
import { useAction } from '../components/ui/feedback';
import { AI_STEPS, AiBusy, AiThinking, Busy } from '../components/ui/Loader';
import { useFx } from '../components/money/useFx';
import s from '../components/money/money.module.css';
const LABEL = { transporte: 'Transporte', hospedagem: 'Hospedagem', passeios: 'Passeios', comida: 'Comida e compras' };
const COLOR = { transporte: '#8E9BFF', hospedagem: '#FF6B3D', passeios: '#4FC08D', comida: '#E3E6EB' };
type Range = { low: number; high: number };
export default function Orcamento() {
  const { bundle: b, base, source, reload, canEdit } = useBundle();
  const { online } = useAuth();
  const router = useRouter();
  const { run, busy } = useAction();
  const { rates } = useFx(b.trip.base_currency);
  const [plan, setPlan] = useState(() => initialPlan(b));
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [ranges, setRanges] = useState<Record<string, Range>>({});
  const [daily, setDaily] = useState<Range | null>(null);
  const [notice, setNotice] = useState('');
  const [asking, setAsking] = useState<false | 'transport' | 'daily' | 'stays'>(false);
  const [confirmed, setConfirmed] = useState(false);
  // Valores digitados têm precedência sobre o roteiro, inclusive quando já havia preço.
  const edited = { ...b, transports: b.transports.map((t) => typed[t.id] !== undefined ? { ...t, price_cents: typed[t.id].trim() ? toCents(typed[t.id]) : null, price_currency: b.trip.base_currency, price_is_estimate: false } : t) };
  const result = budgetFromPlan(edited, plan, rates);
  const legs = transportLegs(edited, plan, rates), stays = stayOptions(edited, rates, plan), tours = tourOptions(edited, rates);
  const levels = foodLevels(daily);
  const range = budgetRange(result, plan);
  const extras = b.budgetCategories.filter((c) => categoryKind(c) === 'outro').reduce((sum, c) => sum + toCents(c.planned), 0);
  const perPerson = Math.round((result.totalCents + extras) / result.people);
  const cap = capPerPerson(b);
  const money = (v: number) => formatMoney(v, b.trip.base_currency, { compact: true });
  const changes = describeChanges(diffSince(plan.snapshot, b, result), money);
  const virtualIds = new Set<string>(virtualLegs(b).map((v) => v.key));
  const invalid = Object.values(typed).some((v) => v.trim() && (!Number.isFinite(toCents(v)) || toCents(v) < 0 || toCents(v) > 100000000000));
  const missing = result.lines.filter((l) => l.kind !== 'hospedagem').reduce((n, l) => n + l.missing, 0);
  const estimate = async (kind: 'transport' | 'daily' | 'stays') => {
    setAsking(kind);
    try {
      if (source.kind !== 'supabase') { setNotice('Na demonstração, use os valores do roteiro e as referências de planejamento. Você pode digitar os preços que conhece.'); return; }
      if (kind === 'stays') {
        const estimates = { ...plan.stay_estimates };
        let found = 0;
        for (const st of b.stops) {
          const stay = b.stays.find((x) => x.stop_id === st.id);
          if (stay?.status === 'booked' || stay?.price_cents != null && stay.price_is_estimate === false) continue;
          const r = await callAi<{ areas: { price_low: number; price_high: number }[] }>('explore', { kind, tripId: b.trip.id, stopId: st.id, nightlyCap: null, budgetStyle: plan.style });
          if (!r?.data.areas.length) continue;
          const median = (xs: number[]) => { const v = [...xs].sort((a, c) => a - c); return (v[Math.floor((v.length - 1) / 2)] + v[Math.floor(v.length / 2)]) / 2; };
          estimates[st.id] = { ...estimates[st.id], [plan.style]: { low: Math.round(median(r.data.areas.map((a) => a.price_low)) * 100 / result.people), high: Math.round(median(r.data.areas.map((a) => a.price_high)) * 100 / result.people) } };
          found++;
        }
        setPlan((p) => ({ ...p, stay_estimates: estimates }));
        setNotice(found ? `Estimativa de hospedagem atualizada para ${found} parada(s), no estilo escolhido. As demais mantêm a referência anterior.` : 'Sem estimativa de hospedagem agora. Continuamos com as referências de planejamento.');
      } else if (kind === 'transport') {
        const virtual = virtualLegs(b).map((v) => ({ key: v.key, title: v.title }));
        const r = await callAi<{ items: ({ transport_id: string } & Range)[] }>('estimate', { kind, tripId: b.trip.id, virtual });
        if (!r) { setNotice('Não foi possível estimar agora. Preencha os trechos sem preço ou tente novamente.'); return; }
        const accepted = r.data.items.filter((i) => typed[i.transport_id] === undefined && (virtualIds.has(i.transport_id) || !b.transports.find((t) => t.id === i.transport_id)?.price_cents));
        setRanges(Object.fromEntries(accepted.map((i) => [i.transport_id, i])));
        setPlan((p) => ({
          ...p,
          transport_cents: { ...p.transport_cents, ...Object.fromEntries(accepted.map((i) => [i.transport_id, Math.round((i.low + i.high) / 2)])) },
          transport_ranges: { ...p.transport_ranges, ...Object.fromEntries(accepted.map((i) => [i.transport_id, { low: i.low, high: i.high }])) },
        }));
      } else {
        // Um pedido por país, ponderado pelas noites em cada um (planning §10.10.5).
        const countries = [...new Set(b.stops.map((st) => st.country?.trim()).filter((c): c is string => !!c))];
        if (!countries.length) { setNotice('Informe o país de uma parada para estimar comida.'); return; }
        const found: { country: string; low: number; high: number }[] = [];
        for (const country of countries.slice(0, 6)) {
          const r = await callAi<Range>('estimate', { kind, tripId: b.trip.id, country, pace: plan.pace });
          if (r) found.push({ country, ...r.data });
        }
        const weighted = foodByCountry(b.stops, found);
        if (!weighted) { setNotice('Sem estimativa agora. Continuamos usando as referências de planejamento.'); return; }
        setDaily(weighted); setPlan((p) => ({ ...p, food_range: weighted, daily_food_cents: foodLevels(weighted)[p.food ?? 'medio'] }));
      }
    } finally { setAsking(false); }
  };
  const save = () => run(async () => {
    if (invalid || !canEdit || !online) return;
    await closeBudget(source, b, plan, result, typed);
    await reload(); router.push(`${base}/dinheiro`);
  }, { success: 'Orçamento salvo. O caixa está aberto.' });
  // Roteiro vazio: sem total (um número só com a comida engana). Planning §10.10.2.
  if (result.empty) return <div className="wrap"><div className={s.budget}><ScreenHeader back={`${base}/dinheiro`} title="Quanto custa essa trilha?" subtitle="Dinheiro · montar orçamento" />
    <EmptyState icon="route" title="A Trilha ainda não sabe por onde vocês vão." text={`Sem cidades no roteiro, não dá pra calcular hospedagem, trechos e passeios dos ${result.days} dias. Monte o roteiro e o orçamento sai pronto.`}
      action={canEdit ? <div className={s.stack}>{source.kind === 'supabase' ? <Link className="btn" href={`${base}/montar?passo=3`}>Montar o roteiro com a Trilha</Link> : null}<Link className="btn btn-ghost" href={`${base}/roteiro`}>Adicionar paradas eu mesmo</Link></div> : null} />
  </div></div>;
  return <div className="wrap"><div className={s.budget}><ScreenHeader back={`${base}/dinheiro`} title="Quanto custa essa trilha?" subtitle="Dinheiro · montar orçamento" /><div className={s.stack}>
    <section className={s.summary} aria-label="Total do orçamento" aria-live="polite"><div className={s.row}><div><small>Por pessoa</small><br /><strong data-testid="budget-total">≈ {money(perPerson)}</strong></div><div><small>Turma ({result.people})</small><br /><b>≈ {money(result.totalCents + extras)}</b></div></div><EstimateBadge />
      {range.high > range.low ? <small data-testid="budget-range">entre {money(range.low + Math.round(extras / result.people))} e {money(range.high + Math.round(extras / result.people))} por pessoa</small> : null}
      <Progress label="Composição do orçamento" segments={result.lines.map((l) => ({ value: l.perPersonCents / (result.perPersonCents || 1), color: COLOR[l.kind], label: LABEL[l.kind] }))} />
      <div className={s.legend}>{result.lines.map((l) => <span key={l.kind}><i className={s.dot} style={{ background: COLOR[l.kind] }} />{LABEL[l.kind]} {money(l.perPersonCents)}</span>)}</div>
      {cap != null ? <small style={{ color: perPerson > cap ? '#ffb99e' : '#8ee1b9' }}>{perPerson > cap ? 'Passou' : 'Sobram'} {money(Math.abs(cap - perPerson))} do teto de {money(cap)}</small> : null}
    </section>
    {extras > 0 ? <p className={s.note}>Outras categorias: {money(extras)} para a turma, mantidas no total.</p> : null}
    {changes.length ? <p className={s.note}>Mudou desde a última vez: {changes.join(' · ')}. O total acima já considera o roteiro atual.</p> : null}
    {asking ? <AiThinking steps={AI_STEPS.estimate} title={asking === 'transport' ? 'A IA está estimando o transporte' : asking === 'stays' ? 'A IA está estimando a hospedagem' : 'A IA está estimando a comida'} lines={0} compact /> : notice ? <p role="status" className={s.note}>{notice}</p> : null}
    <StepChat label="Montar orçamento">
      <TrilhaBubble step="1 · Transporte">Calculei o <b>transporte</b> pelo roteiro. Confere?</TrilhaBubble><ChatOptions><div className={s.panel}>{legs.map((l) => <div className={s.item} key={l.id}><span>{l.title}<small>{l.isEstimate ? <><EstimateBadge /> {ranges[l.id] ? `${money(ranges[l.id].low)}–${money(ranges[l.id].high)}` : 'valor médio de planejamento'}</> : l.from === 'roteiro' ? 'informado pela turma' : 'sem preço'}</small></span><label className="field" style={{ width: 125, flexShrink: 0 }}><span className="sr">Preço {l.title}</span><input inputMode="decimal" disabled={!canEdit || busy} placeholder="Preço" value={typed[l.id] ?? (l.perPersonCents == null ? '' : (l.perPersonCents / 100).toFixed(2).replace('.', ','))} onChange={(e) => {
        const v = e.target.value; setTyped({ ...typed, [l.id]: v }); setConfirmed(false);
        // Voo virtual (ida/volta) não tem trecho: o valor digitado vai direto para o plano.
        if (l.virtual) setPlan((p) => ({ ...p, transport_cents: { ...p.transport_cents, [l.id]: v.trim() && Number.isFinite(toCents(v)) ? toCents(v) : undefined } as Record<string, number> }));
        else setPlan((p) => ({ ...p, transport_cents: { ...p.transport_cents, [l.id]: undefined } as Record<string, number> }));
      }} /></label></div>)}{!legs.length ? <p>Adicione os trechos no Roteiro para calcular transporte.</p> : null}</div><div className={s.chips}><Button size="sm" variant="secondary" disabled={!!asking || !canEdit || !online} onClick={() => void estimate('transport')}>{asking === 'transport' ? <AiBusy steps={['Estimando', 'Somando os trechos']} /> : 'Estimar com a Trilha'}</Button><Button size="sm" disabled={invalid} onClick={() => setConfirmed(true)}>Confere, pode seguir</Button></div></ChatOptions>{confirmed ? <ReplyBubble>Confere, pode seguir</ReplyBubble> : null}
      <TrilhaBubble step="2 · Hospedagem">São {result.nights} noites{result.uncoveredNights ? `, ${result.uncoveredNights} delas ainda sem cidade no roteiro` : ''}. Que <b>estilo de hospedagem</b> a turma topa?</TrilhaBubble><ChatOptions><div className={s.stack}>{stays.options.map((o) => <button key={o.key} type="button" className={s.choice} aria-pressed={plan.style === o.key} disabled={!canEdit || busy} onClick={() => setPlan({ ...plan, style: o.key })}><div className={s.row}><b>{o.label}</b><b>≈ {money(o.perPersonCents)}</b></div><small>{o.detail} · ≈ {money(o.nightCents)}/noite por pessoa · ESTIMATIVA</small></button>)}</div>{result.people > 1 ? <Segmented label="Como dividem o quarto" value={plan.room ?? 'shared'} onChange={(room) => canEdit && !busy && setPlan({ ...plan, room })} options={ROOMS.map((x) => ({ value: x.key, label: x.label }))} block /> : null}<Button size="sm" variant="ghost" disabled={!!asking || !canEdit || !online} onClick={() => void estimate('stays')}>{asking === 'stays' ? <AiBusy steps={['Estimando', 'Comparando bairros']} /> : 'Estimar hospedagem neste estilo'}</Button>{Object.entries(plan.stay_estimates ?? {}).filter(([, options]) => options[plan.style]).map(([id, options]) => <p key={id} className={s.muted}>{b.stops.find((st) => st.id === id)?.name}: {money(options[plan.style]!.low)}–{money(options[plan.style]!.high)} / pessoa / noite · ESTIMATIVA</p>)}<p className={s.note}>{stays.options.find((o) => o.key === plan.style)?.note} {stays.fixed ? `${stays.fixed} parada(s) com preço informado mantêm o valor do roteiro.` : ''}</p></ChatOptions>
      <TrilhaBubble step="3 · Passeios">Estes <b>passeios</b> estão no roteiro ou sugeridos. Desmarque o que ficar de fora do orçamento.</TrilhaBubble><ChatOptions><div className={s.panel}>{tours.map((t) => <div key={t.id} className={`${s.item} ${s.tour}`}><Checkbox hideLabel label={t.title} checked={plan.activities?.includes(t.id) ?? false} disabled={!canEdit || busy} onChange={(on) => setPlan({ ...plan, activities: on ? [...plan.activities ?? [], t.id] : plan.activities?.filter((id) => id !== t.id) })}><span aria-hidden="true"><b>{t.title}</b><small>{t.tag}</small></span></Checkbox><span>{t.perPersonCents == null ? 'Sem preço' : `${t.isEstimate ? '≈ ' : ''}${money(t.perPersonCents)}`}{t.isEstimate ? <small><EstimateBadge /></small> : null}</span></div>)}{!tours.length ? <p>Nenhum passeio com custo no roteiro ainda.</p> : null}</div></ChatOptions>
      <TrilhaBubble step="4 · Comida e compras"><b>Comida e compras</b> ficam numa reserva à parte, por dia. Qual ritmo?</TrilhaBubble><ChatOptions><div className={s.choices}>{FOODS.map((f) => <button type="button" className={s.choice} key={f.key} aria-pressed={plan.food === f.key} disabled={!canEdit || busy} onClick={() => setPlan({ ...plan, food: f.key, daily_food_cents: levels[f.key] })}><b>{f.label}</b><span>≈ {money(plan.food === f.key ? plan.daily_food_cents ?? levels[f.key] : levels[f.key])}/dia</span><small>por pessoa · ESTIMATIVA</small></button>)}</div><Button size="sm" variant="ghost" disabled={!!asking || !canEdit || !online} onClick={() => void estimate('daily')}>{asking === 'daily' ? <AiBusy steps={['Estimando', 'Olhando preços do país']} /> : 'Estimar comida pelo país'}</Button><p className={s.muted}>{daily ? `Faixa de comida: ${money(daily.low)}–${money(daily.high)} por pessoa/dia. Compras pessoais podem exigir uma reserva adicional.` : 'Referências gerais de planejamento; não são cotações de fornecedores.'}</p></ChatOptions>
    </StepChat>
    {result.pendingVirtual > 0 ? <p className={s.note}>O voo de {virtualLegs(b).filter((v) => plan.transport_cents?.[v.key] == null).map((v) => v.key).join(' e ')} ainda não entra no total. Use “Estimar com a Trilha” ou digite o valor.</p> : null}
    {missing > 0 ? <p className={`${s.note} ${s.warning}`}>{missing} item(ns) sem preço ou cotação não entram no total. Complete os valores antes de fechar.</p> : null}
    {!online ? <p>Precisa de internet para salvar.</p> : null}
    {canEdit ? <Button disabled={busy || !!asking || invalid || missing > 0 || !online} onClick={() => void save()}>{busy ? <Busy>Salvando</Busy> : 'Fechar orçamento e abrir o caixa'}</Button> : <p>Você pode consultar o orçamento. Só organizadores e editores alteram as respostas.</p>}
  </div></div></div>;
}
