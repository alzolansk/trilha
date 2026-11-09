'use client';
// Passo 2: a turma conta a viagem do jeito dela ("quero uma Itália babadeira, comer muito, sem correria")
// e a Trilha devolve o que entendeu. A pessoa confere, tira o que não é verdade e segue. Nada é inventado:
// cada traço mostra o trecho do texto que o justifica.
import type { TravelProfile } from '../../data/types';
import { VIBES } from '../../lib/discover';
import { Busy } from '../ui/Loader';
import { Button, Icon } from '../ui';
import s from './travelStory.module.css';

export const STORY_MIN = 12;
export const STORY_MAX = 1500;
const EXAMPLES = [
  'Quero uma viagem babadeira: comer muito bem, ver coisas lindas e tirar foto de tudo, mas sem correria.',
  'Vamos em casal, primeira vez na Europa. Gostamos de museu, vinho e cidade pequena. Nada de balada.',
  'Somos 4 amigos querendo natureza e aventura, gastando pouco. Topamos acordar cedo.',
];

export function StoryInput({ value, onChange, onRead, busy, disabled, error }: {
  value: string; onChange: (v: string) => void; onRead: () => void; busy: boolean; disabled?: boolean; error?: string;
}) {
  const left = STORY_MAX - value.length;
  return (
    <div className={s.story}>
      <label htmlFor="story" className={s.label}>Como vocês imaginam essa viagem?</label>
      <textarea
        id="story" className={s.area} rows={5} maxLength={STORY_MAX} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={EXAMPLES[0]} aria-describedby="story-hint"
      />
      <div id="story-hint" className={s.hint}>
        <span>Do seu jeito: quem vai, o clima que querem, o que não pode faltar e o que querem evitar.</span>
        {left < 200 ? <span>{left} caracteres</span> : null}
      </div>
      <div className={s.examples} aria-label="Exemplos">
        {EXAMPLES.slice(1).map((e) => (
          <button key={e} type="button" className={s.example} onClick={() => onChange(e)}>“{e}”</button>
        ))}
      </div>
      {error ? <p className={s.error} role="alert">{error}</p> : null}
      <Button variant="secondary" disabled={busy || disabled || value.trim().length < STORY_MIN} onClick={onRead}>
        {busy ? <Busy>A Trilha está lendo</Busy> : <><Icon name="sparkle" size={16} /> Entender a nossa viagem</>}
      </Button>
    </div>
  );
}

/** "O que entendi de vocês": resumo, traços (com o trecho que justifica) e o que querem evitar. Traços removíveis. */
export function ProfileCard({ profile, onChange, onRedo }: { profile: TravelProfile; onChange: (p: TravelProfile) => void; onRedo: () => void }) {
  const vibeLabel = (id: string) => VIBES.find((v) => v.id === id)?.label ?? id;
  return (
    <section className={s.card} aria-labelledby="profile-title" data-testid="profile-card">
      <div className={s.cardHead}>
        <h3 id="profile-title"><Icon name="sparkle" size={17} />O que entendi de vocês</h3>
        <button type="button" className={s.redo} onClick={onRedo}>Reescrever</button>
      </div>
      <p className={s.summary}>{profile.summary}</p>
      {profile.traits.length ? (
        <ul className={s.traits}>
          {profile.traits.map((t) => (
            <li key={t.label} className={s.trait}>
              <span className={s.traitText}>
                <b>{t.label}</b>
                {t.detail ? <small>{t.detail}</small> : null}
                {t.evidence ? <q>{t.evidence}</q> : null}
              </span>
              <button
                type="button" className={s.remove} aria-label={`Tirar “${t.label}”: não é a gente`}
                onClick={() => onChange({ ...profile, traits: profile.traits.filter((x) => x.label !== t.label) })}
              >
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {profile.avoid.length ? (
        <p className={s.avoid}><b>Evitar:</b> {profile.avoid.join(' · ')}</p>
      ) : null}
      {profile.group || profile.vibes.length ? (
        <p className={s.meta}>
          {profile.group ? <>Quem vai: <b>{profile.group}</b>. </> : null}
          {profile.vibes.length ? <>Já marquei abaixo: {profile.vibes.map(vibeLabel).join(', ')}.</> : null}
        </p>
      ) : null}
      <p className={s.meta}>Tire o que não for verdade. A Trilha usa isso para escolher lugares e explicar por que cada um combina.</p>
    </section>
  );
}
