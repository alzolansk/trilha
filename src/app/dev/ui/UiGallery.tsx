'use client';
import { useState } from 'react';
import { Avatar, AvatarStack } from '../../../components/ui/Avatar';
import { Badge, EstimateBadge } from '../../../components/ui/Badge';
import { Button, IconButton } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Checkbox } from '../../../components/ui/Checkbox';
import { Chip, ChipGroup } from '../../../components/ui/Chip';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorBox } from '../../../components/ui/ErrorBox';
import { ListRow } from '../../../components/ui/ListRow';
import { Logo } from '../../../components/ui/Logo';
import { MoneyInput } from '../../../components/ui/MoneyInput';
import { Photo } from '../../../components/ui/Photo';
import { PhotoCard } from '../../../components/ui/PhotoCard';
import { Progress } from '../../../components/ui/Progress';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { Segmented } from '../../../components/ui/Segmented';
import { Sheet } from '../../../components/ui/Sheet';
import { Skeleton } from '../../../components/ui/Skeleton';
import { Stat } from '../../../components/ui/Stat';
import { ChatOptions, ReplyBubble, StepChat, TrilhaBubble } from '../../../components/ui/StepChat';
import { SuggestionCard } from '../../../components/ui/SuggestionCard';
import { TabBar } from '../../../components/ui/TabBar';
import { AiNote } from '../../../components/ui/primitives';
import { ACCENT_CHOICES } from '../../../lib/identity/accent';
import s from './gallery.module.css';

const COLORS: [string, string][] = [
  ['--bg', 'Névoa'], ['--surface', 'Superfície'], ['--ink', 'Tinta'], ['--ink-2', 'Texto 2'], ['--mute', 'Rótulos'], ['--line', 'Linha'], ['--field', 'Campo'],
  ['--brand', 'Ultramar'], ['--brand-ink', 'Brand ink'], ['--brand-soft', 'Brand soft'], ['--brand-on-dark', 'Brand on dark'],
  ['--sun', 'Tangerina'], ['--sun-soft', 'Sun soft'], ['--sun-ink', 'Sun ink'], ['--warn', 'Alerta'], ['--ok', 'Ok'], ['--ok-soft', 'Ok soft'],
  ['--cat-transporte', 'Transporte'], ['--cat-hospedagem', 'Hospedagem'], ['--cat-passeios', 'Passeios'], ['--cat-comida', 'Comida'],
];

const TYPE: [string, string, string][] = [
  ['--t-hero', 'hero', '65'],
  ['--t-display', 'display', 'Roteiro'],
  ['--t-title', 'title', 'Hoje a Trilha sugere'],
  ['--t-card', 'card', 'Montanha Colorida, saindo de Cusco'],
  ['--t-body', 'body', 'Dia inteiro, 5.000 m. O dia 4 é o primeiro depois de aclimatar.'],
  ['--t-small', 'small', '12 → 26 jan · 3 noites · San Blas'],
  ['--t-micro', 'micro', 'Foto · Vinicunca'],
];

// Imagem local só para a vitrine mostrar legenda e crédito. As fotos reais vêm da Wikimedia
// Commons pela /api/photos (Fase 3), sempre com autor e licença.
const VINICUNCA = {
  url: '/icons/icon-512.png',
  width: 512,
  height: 512,
  author: 'Trilha (imagem de exemplo da vitrine)',
  license: 'uso interno',
  source_url: null,
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={s.section}>
      <h2 className={s.h2}>{title}</h2>
      {children}
    </section>
  );
}

export function UiGallery() {
  const [vibe, setVibe] = useState<string[]>(['natureza']);
  const [style, setStyle] = useState<string | null>('pousada');
  const [view, setView] = useState<'lista' | 'mapa'>('lista');
  const [money, setMoney] = useState<number | null>(647000);
  const [checked, setChecked] = useState(true);
  const [sheet, setSheet] = useState(false);
  const [accent, setAccent] = useState(ACCENT_CHOICES[0].hex);

  return (
    <main id="main" className={s.page} style={{ ['--trip-accent' as string]: accent }}>
      <div className="wrap" style={{ paddingBottom: 160 }}>
        <ScreenHeader eyebrow="Trilha 2.0 · interno" title="Componentes" subtitle="Vitrine para conferir com o canvas (Main.dc.html). Só aparece em desenvolvimento." action={<Logo size={30} />} />

        <Section title="Cores">
          <div className={s.swatches}>
            {COLORS.map(([v, n]) => (
              <div key={v} className={s.swatch}>
                <span style={{ background: `var(${v})` }} />
                <b>{n}</b>
                <code>{v}</code>
              </div>
            ))}
          </div>
          <h3 className={s.h3}>Accent da trilha (8 aprovadas)</h3>
          <ChipGroup label="Accent" options={ACCENT_CHOICES.map((c) => ({ value: c.hex, label: c.name }))} value={accent} onChange={setAccent} size="sm" />
        </Section>

        <Section title="Tipografia">
          <div className="stack">
            {TYPE.map(([v, n, ex]) => (
              <div key={v} className={s.typeRow}>
                <code>{n}</code>
                <span style={{ font: `var(${v})`, letterSpacing: v === '--t-hero' || v === '--t-display' ? '-0.035em' : undefined }}>{ex}</span>
              </div>
            ))}
            <p className="num" style={{ margin: 0 }}>Números tabulares: R$ 6.470 · R$ 19.410 · 48%</p>
          </div>
        </Section>

        <Section title="Botões">
          <div className={s.row}>
            <Button>Pôr no dia 4</Button>
            <Button variant="secondary">Votar</Button>
            <Button variant="dark">Mandar as 3 para votação</Button>
            <Button variant="ghost">Rever orçamento</Button>
            <Button variant="dashed" icon="plus">Parada</Button>
            <Button disabled>Desabilitado</Button>
          </div>
          <div className={s.row}>
            <Button size="sm" icon="plus">Pequeno</Button>
            <Button size="sm" variant="secondary" iconEnd="link">Abrir no Booking, já filtrado</Button>
            <IconButton icon="close" label="Dispensar" />
            <IconButton icon="back" label="Voltar" variant="light" />
            <IconButton icon="more" label="Mais" variant="ghost" />
          </div>
          <div style={{ maxWidth: 390 }}><Button block>Lançar gasto ou aporte</Button></div>
        </Section>

        <Section title="Chips e controles">
          <ChipGroup multiple label="Vibe" value={vibe} onChange={setVibe} options={['natureza', 'cidade', 'praia', 'cultura', 'aventura', 'comida'].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))} />
          <ChipGroup label="Estilo" value={style} onChange={setStyle} options={[{ value: 'hostel', label: 'Hostel' }, { value: 'pousada', label: 'Pousada' }, { value: 'hotel', label: 'Hotel' }]} />
          <div className={s.row}>
            <Chip selected count={3}>Gastos</Chip>
            <Chip size="sm">Pequeno</Chip>
            <Segmented label="Vista" value={view} onChange={setView} options={[{ value: 'lista', label: 'Lista' }, { value: 'mapa', label: 'Mapa' }]} />
          </div>
          <div className={s.row}>
            <Checkbox label="Passaporte" checked={checked} onChange={setChecked} strike />
            <Checkbox label="Seguro" checked={!checked} onChange={(v) => setChecked(!v)} type="radio" name="g" />
          </div>
        </Section>

        <Section title="Selos, números e progresso">
          <div className={s.row}>
            <Badge tone="ok">pronto</Badge>
            <Badge tone="warn">falta hospedagem</Badge>
            <Badge tone="brand">em votação</Badge>
            <Badge tone="sun">faltam R$ 120</Badge>
            <Badge>neutro</Badge>
            <EstimateBadge />
          </div>
          <div className={s.grid3}>
            <Card><div className={s.stats}><Stat label="Planejado" value="R$ 19.410" /><Stat label="Juntado" value="R$ 9.360" /><Stat label="Já gasto" value="R$ 4.120" /></div>
              <div style={{ marginTop: 16 }}><Progress label="Juntado e gasto" height={12} layers={[{ value: 0.48, color: 'var(--brand-soft)' }, { value: 0.21, color: 'var(--sun)' }]} /></div>
            </Card>
            <Card variant="dark">
              <Stat tone="on-dark" size="lg" label="Dinheiro da turma" value="R$ 9.360" sub="juntados, de R$ 19.410 planejados" />
              <div style={{ marginTop: 14 }}><Progress label="Juntado" value={0.48} color="var(--sun)" track="var(--dark-2)" /></div>
            </Card>
            <Card>
              <Stat label="Por pessoa" value="R$ 6.470" />
              <div style={{ marginTop: 16 }}><Progress label="Categorias" height={14} segments={[{ value: 0.32, color: 'var(--cat-transporte)' }, { value: 0.3, color: 'var(--cat-hospedagem)' }, { value: 0.18, color: 'var(--cat-passeios)' }, { value: 0.2, color: 'var(--cat-comida)' }]} /></div>
            </Card>
          </div>
          <div className={s.row}>
            <Avatar name="Você" me />
            <Avatar name="Bia Lima" color="#FFD8A8" />
            <Avatar name="Rafa Souza" color="#C7CEFF" />
            <AvatarStack people={[{ id: '1', name: 'Você', me: true }, { id: '2', name: 'Bia', color: '#FFD8A8' }, { id: '3', name: 'Rafa', color: '#C7CEFF' }, { id: '4', name: 'Duda', color: '#BDEBD3' }, { id: '5', name: 'Leo', color: '#FFC7D6' }]} max={3} />
          </div>
        </Section>

        <Section title="Cartões e listas">
          <div className={s.grid3}>
            <SuggestionCard reason="Passeio · cabe no dia 4" title="Montanha Colorida, saindo de Cusco" text="Dia inteiro, 5.000 m. O dia 4 é o primeiro depois de aclimatar." photo={VINICUNCA} place="Vinicunca" by="ai" onAccept={() => undefined} acceptLabel="Pôr no dia 4" onVote={() => undefined} onDismiss={() => undefined} />
            <div className="stack">
              <ListRow card icon="users" iconTone="dark" eyebrow="Falta você votar" eyebrowTone="warn" title="Onde dormir em Aguas Calientes?" subtitle="Bia: Pirwa · Rafa: Inti Wasi" onClick={() => undefined} />
              <ListRow card icon="train" eyebrow="Reserve logo" title="Trem Cusco → Aguas Calientes" subtitle="Em janeiro esgota com antecedência" onClick={() => undefined} />
              <SuggestionCard variant="inline" reason="Dia com folga" title="Sacsayhuamán" text="15 min de táxi · 2 h" onAccept={() => undefined} acceptLabel="Pôr no dia" />
            </div>
            <Card pad="none">
              <div style={{ padding: '4px 16px' }}>
                <ListRow icon="plane" title="Voo Lima → Cusco" subtitle="1h20 · R$ 520 / pessoa" right={<Badge tone="warn">não reservado</Badge>} />
                <ListRow icon="bed" iconTone="sun" title="Hospedagem" subtitle="San Blas · 3 noites" chevron href="#" />
                <ListRow icon="wallet" iconTone="ok" title="Último movimento" subtitle="Caixa → Passeios → Dia 7 ✓ pago" right="R$ 1.050" />
              </div>
            </Card>
          </div>
          <div className={s.grid3}>
            <PhotoCard photo={VINICUNCA} place="Vinicunca" title="Montanha Colorida" meta="Dia inteiro · esforço alto" badge={<Badge tone="light">Bia quer muito</Badge>} actions={<Button size="sm" block icon="plus">Pôr no roteiro</Button>} />
            <div className="stack">
              <PhotoCard variant="row" place="Sacsayhuamán" title="Sacsayhuamán" meta={<Badge tone="ok">No roteiro · dia 4</Badge>} />
              <PhotoCard variant="row" place="Vale Sagrado" title="Vale Sagrado" meta={<Badge tone="brand">Em votação · 1 de 3</Badge>} actions={<IconButton icon="plus" label="Pôr no roteiro" />} />
              <PhotoCard variant="row" selected place="San Blas" title="San Blas" meta="Fiquem aqui" />
            </div>
            <Card variant="suggest">
              <AiNote by="ai">Pousadas em San Blas cabem nesse valor. <EstimateBadge /></AiNote>
            </Card>
          </div>
        </Section>

        <Section title="Foto e placeholder">
          <div className={s.grid3}>
            <Photo photo={VINICUNCA} place="Vinicunca" ratio="4/3" />
            <Photo place="Uyuni" ratio="4/3" />
            <Photo place="Cusco" ratio="4/3" overlay radius="var(--r-card)">
              <div style={{ position: 'absolute', left: 16, bottom: 16, color: 'var(--on-dark)' }}>
                <div style={{ font: 'var(--t-small)', opacity: 0.9 }}>Parada 2 de 6</div>
                <div style={{ font: '800 40px/1 var(--font-title)', letterSpacing: '-0.03em' }}>Cusco</div>
              </div>
            </Photo>
          </div>
        </Section>

        <Section title="Formulários e conversa">
          <div className={s.grid3}>
            <Card><MoneyInput label="Valor" value={money} onChange={setMoney} currency="PEN" onCurrencyClick={() => undefined} hint="≈ R$ 132 · cotação de hoje" /></Card>
            <Card>
              <StepChat>
                <TrilhaBubble step="Passo 2 de 4 · Hospedagem">São 14 noites. Que estilo a turma topa?</TrilhaBubble>
                <ChatOptions><ChipGroup label="Estilo" value={style} onChange={setStyle} options={[{ value: 'hostel', label: 'Hostel' }, { value: 'pousada', label: 'Pousada' }, { value: 'hotel', label: 'Hotel' }]} /></ChatOptions>
                <ReplyBubble onEdit={() => undefined}>Pousada, R$ 180/noite</ReplyBubble>
              </StepChat>
            </Card>
            <Card className="stack">
              <label className="field">Descrição<input placeholder="Ingresso Machu Picchu" /></label>
              <Button onClick={() => setSheet(true)}>Abrir Sheet</Button>
            </Card>
          </div>
        </Section>

        <Section title="Estados">
          <div className={s.grid3}>
            <EmptyState title="Nenhuma parada ainda" text="Comece pela primeira cidade." action={<Button icon="plus">Adicionar parada</Button>} />
            <div className="stack"><Skeleton h={160} /><Skeleton h={56} /><Skeleton h={56} /></div>
            <div className="stack"><ErrorBox message="Não deu para carregar. Confira a conexão." onRetry={() => undefined} /><div className="banner-offline" style={{ position: 'static', borderRadius: 14 }}>Sem internet. Dá pra consultar tudo; para salvar, precisa de conexão.</div></div>
          </div>
        </Section>

        <Section title="Cabeçalho de subtela">
          <Card><ScreenHeader back="#" title="Acerto de contas" subtitle="Quem deve para quem" action={<IconButton icon="more" label="Mais" />} /></Card>
        </Section>
      </div>

      <TabBar items={[
        { href: '#', label: 'Início', icon: 'home', active: true },
        { href: '#', label: 'Roteiro', icon: 'route', active: false },
        { href: '#', label: 'Dinheiro', icon: 'wallet', active: false },
        { href: '#', label: 'Turma', icon: 'users', active: false },
      ]} />

      <Sheet open={sheet} onClose={() => setSheet(false)} title="Lançar gasto" description="Bottom sheet no celular, modal no desktop." footer={<><Button variant="secondary" onClick={() => setSheet(false)}>Cancelar</Button><Button onClick={() => setSheet(false)}>Salvar gasto</Button></>}>
        <MoneyInput label="Valor" value={money} onChange={setMoney} autoFocus />
        <label className="field">Descrição<input placeholder="Ingresso Machu Picchu" /></label>
        <ChipGroup label="Categoria" value={style} onChange={setStyle} options={[{ value: 'transporte', label: 'Transporte' }, { value: 'hospedagem', label: 'Hospedagem' }, { value: 'passeios', label: 'Passeios' }, { value: 'comida', label: 'Comida' }]} />
        <p className="muted" style={{ margin: 0 }}>Conteúdo longo rola por dentro; o rodapé fica preso.</p>
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} h={48} />)}
      </Sheet>
    </main>
  );
}
