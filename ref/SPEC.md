# TRILHA · Especificação para desenvolvimento

> Documento de handoff para a IA (ou pessoa) que vai construir o produto em **Next.js + React + TypeScript**.
> Leia inteiro antes de escrever código. Quando algo aqui e o protótipo divergirem, **este documento vence**; quando este documento for omisso, **o protótipo é a referência visual e de comportamento**.

---

## 0. O que vem neste pacote

| Arquivo | Para que serve |
|---|---|
| `trilha-prototipo.html` | Protótipo funcional em um único arquivo (HTML + CSS + JS puro). Abra no navegador. É a referência de visual, de movimento e de interação. Todo o CSS de referência e os dados de exemplo estão dentro dele (`window.TRILHA_DATA`). |
| `SPEC.md` (este arquivo) | Regras, tokens, fórmulas, contratos de dados, componentes, critérios de aceite. |
| Deck "Trilha · Design System" | Versão visual do design system: paletas, tipografia, motifs, fendas, componentes, telas. Use para conferir visualmente o que está descrito aqui. |

Como explorar o protótipo:
- Rotas por hash: `#/onboarding`, `#/inicio`, `#/roteiro`, `#/documentos`, `#/mala`, `#/diario`, `#/identidades`.
- O botão **Identidade** no topo troca o destino de demonstração (Andes, Japão, Marrocos, Islândia). Tudo muda junto: cores, fonte, símbolos, roteiro, documentos, mala, moeda, turma.
- Estado salvo em `localStorage` (chave `trilha.v3`). Para recomeçar: `localStorage.removeItem('trilha.v3')`.
- As fontes vêm do Google Fonts (precisa de internet para ver as fontes certas).

---

## 1. Produto

**Trilha** é um countdown de viagens que vira o centro de controle da viagem. Público principal: viajantes aventureiros e mochileiros, sozinhos ou em grupo.

O que o produto faz:
1. **Contagem regressiva** até o embarque, em destaque, com a foto da viagem escolhida pelo usuário.
2. **Roteiro** com paradas configuradas pelo usuário (cidade, datas, transporte, hospedagem, plano do dia, notas).
3. **Hub de documentos**: passagens, identidade, reservas, ingressos, seguro, fotos e prints. Tudo disponível offline.
4. **Mala e gastos**: checklist com sugestões, pendências da turma, orçamento, gasto por parada, conversor de moeda, acerto de contas.
5. **Diário**: inspirações antes, registro durante, retrospectiva depois.
6. **Turma**: convidar acompanhantes que editam junto.
7. **IA em soft launch**: não existe uma página de IA. A IA aparece **dentro do contexto** (dicas por parada, alertas de documento, itens sugeridos na mala, classificação de arquivos, retrospectiva), sempre marcada com a etiqueta `IA`.

### 1.1 O conceito central: identidade gerada por destino

Cada trilha (viagem) ganha **uma identidade visual própria** gerada a partir do destino, da época e do estilo da viagem. O app de uma viagem pro Japão não se parece com o de uma viagem pro Marrocos.

| Muda por destino (tokens de tema) | Fica igual sempre (sistema base) |
|---|---|
| Paleta de 5 cores + derivadas | Layout, grid e espaçamentos |
| Fonte display (títulos e números) | Fonte de texto (Instrument Sans) e mono (JetBrains Mono) |
| Motif (forma-símbolo) | Ritmo e curvas das animações |
| Padrão gráfico (pattern SVG) | Componentes e sua anatomia |
| Formato da fenda que abre a foto | Regras de contraste e acessibilidade |
| Paisagem placeholder (antes da foto) | Tom de voz e microcopy |

### 1.2 Princípios de design

1. **Uma coisa por vez.** A primeira tela é só o countdown. O resto aparece conforme o scroll. Nada de painel lotado.
2. **Vida com propósito.** Motifs flutuando, faixas rolando, quiques e parallax existem para dar personalidade, nunca para competir com o conteúdo. Sempre atrás do conteúdo, sempre respeitando `prefers-reduced-motion`.
3. **O símbolo do destino é a assinatura.** O motif aparece no logo, nos números, nos checkboxes, nas molduras de foto, no botão flutuante, nos bullets.
4. **IA discreta.** Ajuda onde o usuário já está. Nunca bloqueia, nunca decide sozinha, sempre identificada.
5. **Offline primeiro para o que importa na estrada.** Passagens e documentos de identidade abrem sem internet.

---

## 2. Arquitetura recomendada (Next.js)

### 2.1 Stack
- **Next.js 14+ (App Router)**, React 18+, **TypeScript estrito**.
- Estilo: **CSS Modules + CSS custom properties** (os tokens de tema são variáveis CSS, ver seção 4). Tailwind é aceitável se as cores e fontes vierem das mesmas variáveis (`bg-[var(--bg)]` etc.). Não usar paleta fixa do Tailwind.
- Fontes: `next/font/google` para Instrument Sans, JetBrains Mono e as fontes display (Bricolage Grotesque, Shippori Mincho B1, Gloock, Big Shoulders Display). Carregar a display **só do tema ativo** (ou todas com `display: swap` e `preload: false` nas que não estão em uso).
- Animação: CSS para tudo que for keyframe; um hook `useScrollProgress` (rAF + `scroll` passivo) para a história de scroll do Início; `IntersectionObserver` para revelações. Framer Motion é opcional, não obrigatório.
- Estado de servidor: banco relacional (ex.: Postgres + Prisma ou Drizzle). Estado de cliente: React state + um store leve (ex.: Zustand) para preferências e cache offline.
- Offline: **PWA** com service worker (ex.: `next-pwa` ou Workbox) cacheando o shell e os arquivos marcados como offline (documentos). IndexedDB para os blobs.
- Arquivos: storage de objetos (S3, R2, Supabase Storage). URLs assinadas.
- IA: rota de servidor (`/api/ai/*`) chamando um LLM com saída em JSON validada por schema (Zod). Ver seção 9.

### 2.2 Rotas

| Rota | Tela | Observação |
|---|---|---|
| `/` | Redireciona para a trilha ativa ou para `/nova-trilha` | |
| `/nova-trilha` | Onboarding em 3 passos | Gera a identidade |
| `/t/[tripId]` | Início (história de scroll) | |
| `/t/[tripId]/roteiro` | Roteiro | `?parada=<stopId>` seleciona a parada |
| `/t/[tripId]/documentos` | Documentos | `?tipo=Passagens` filtra |
| `/t/[tripId]/mala` | Mala e gastos | |
| `/t/[tripId]/diario` | Diário | `?momento=antes|durante|depois` |
| `/identidades` | Galeria das identidades disponíveis | Útil para QA e marketing |
| `/convite/[token]` | Aceitar convite da turma | |

O layout `/t/[tripId]/layout.tsx` carrega a trilha, resolve a identidade e injeta os tokens no `<html>` (ver 4.4). Assim todas as páginas da trilha herdam o tema sem prop drilling.

### 2.3 Estrutura de pastas sugerida
```
app/
  layout.tsx                 # fontes base, <body>, grain
  nova-trilha/page.tsx
  identidades/page.tsx
  t/[tripId]/
    layout.tsx               # ThemeProvider + AppHeader + TabBar
    page.tsx                 # Início
    roteiro/page.tsx
    documentos/page.tsx
    mala/page.tsx
    diario/page.tsx
  api/ai/{identity,tips,packing,classify,retro}/route.ts
components/
  shell/  AppHeader, IdentityMenu, TabBar, Toast, Grain, BackgroundPattern, Floaters
  ui/     Button, Chip, Tag, AiNote, Field, Card, Marquee, MotifCheckbox, ProgressRing
  home/   HeroSlit, Countdown, CircularBadge, RouteStory, StatsCounter, PendingReveal, FinalCta
  roteiro/ SegmentBar, StopList, StopButton, LegConnector, StopDetail, BoardingPass, NewStopForm
  docs/   DocTicket, DocFilters, DropZone, ShotsGallery
  mala/   ChecklistGroup, PendingList, BudgetCard, CategoryBar, StopSpendColumns, Converter, DebtList
  diario/ MomentTabs, DiaryBanner, DiaryCard
  onboarding/ StepDestination, StepDates, StepGenerate
lib/
  identity/  dictionary.ts, generate.ts, validate.ts, contrast.ts, shapes.ts, patterns.tsx, landscapes.tsx
  data/      types.ts, mock.ts
  motion/    useScrollProgress.ts, useReveal.ts, easing.ts
styles/ tokens.css, globals.css
```

---

## 3. Modelo de dados (TypeScript)

```ts
export type ThemeKey = string;                 // ex.: 'andes' | 'japao' | 'marrocos' | 'islandia' | 'gen_<hash>'
export type SlitShape = 'diamond' | 'lens' | 'arch' | 'band';
export type CountdownSplit = 'v' | 'h';        // v = números à esquerda/direita da fenda; h = acima/abaixo

export interface DestinationIdentity {
  key: ThemeKey;
  idName: string;              // nome da identidade, ex.: "Andes Têxtil"
  palette: {
    bg: string; ink: string; mute: string; line: string;    // line pode ter alpha (rgba)
    acc: string; acc2: string; acc3: string;
    deep: string; onDeep: string; onAcc: string;
    routeLine: string;          // cor da linha da rota sobre deep
  };
  display: { family: string; googleFont: string; weight: 400 | 500 | 600 | 700 | 800 };
  motif: string;               // valor CSS de clip-path
  motifSolid: string;          // variante "cheia" do motif para formas que carregam texto (igual ao motif quando ele já é largo)
  pattern: PatternSpec;        // ver 6.2
  slit: SlitShape;
  split: CountdownSplit;
  landscape: LandscapeSpec;    // placeholder antes da foto do usuário
  sources: string[];           // 4 inspirações mostradas no onboarding
  generatedBy: 'dictionary' | 'ai';
  version: number;             // "Gerar outra versão" incrementa
}

export interface Trip {
  id: string;
  title: string;               // ex.: "Peru + Bolívia"
  departureAt: string;         // ISO com fuso, ex.: "2027-01-15T06:40:00-03:00"
  returnAt: string;
  origin: string;              // IATA ou cidade, ex.: "GRU"
  style: 'Mochilão' | 'Conforto' | 'Aventura' | 'Cultural';
  identity: DestinationIdentity;
  coverPhotoUrl?: string;      // foto escolhida pelo usuário (substitui a paisagem)
  travelers: Traveler[];
  stops: Stop[];
  documents: TripDocument[];
  packing: PackingGroup[];
  tasks: Task[];
  budget: Budget;
  diary: DiaryEntry[];
}

export interface Traveler { id: string; initials: string; name: string; role: 'owner' | 'editor' | 'viewer'; }

export interface Stop {
  id: string; order: number;
  city: string; country: string; code: string;   // code: 3 letras (IATA ou abreviação), ex.: "CUZ"
  arriveOn: string; leaveOn: string;            // datas ISO (yyyy-mm-dd)
  meta?: string;                                // linha curta: "altitude 3.400 m", "medina e souks"
  tip?: AiTip;
  arrival?: Ticket;                             // como chego nesta parada
  legToNext?: { mode: TransportMode; duration: string };   // ex.: { mode: 'Ônibus', duration: '7h' }
  stay?: { name: string; status: 'Reserva anexada' | 'Sem reserva'; documentId?: string };
  plan: { date?: string; text: string }[];
  notes?: string;
}
export type TransportMode = 'Avião' | 'Ônibus' | 'Trem' | 'Trem-bala' | 'Carro' | 'Barco' | 'A pé';
export interface Ticket { from: string; to: string; mode: TransportMode; departAt?: string; arriveAt?: string; seat?: string; locator?: string; documentId?: string; }

export type DocCategory = 'Passagens' | 'Identidade' | 'Reservas' | 'Ingressos' | 'Seguro' | 'Outros';
export interface TripDocument {
  id: string; category: DocCategory; title: string; subtitle: string;
  stopId?: string; fileUrl: string; mime: string; sizeBytes: number;
  offline: boolean;                             // Passagens e Identidade: true por padrão
  classifiedBy?: 'user' | 'ai';
}

export interface PackingGroup { id: string; name: string; items: PackingItem[]; }
export interface PackingItem { id: string; label: string; done: boolean; suggestedByAi: boolean; reason?: string; }

export interface Task { id: string; title: string; detail: string; assigneeId?: string; dueOn?: string; done: boolean; fromAi: boolean; link: 'documentos' | 'mala' | 'roteiro' | 'turma'; }

export interface Budget {
  currency: 'BRL';
  planned: number;                              // total previsto
  categories: { name: 'Transporte' | 'Hospedagem' | 'Passeios' | 'Comida'; spent: number; planned: number }[];
  expenses: Expense[];
  localCurrencies: { code: string; symbol: string }[];    // ex.: PEN S/, BOB Bs
}
export interface Expense { id: string; amount: number; category: string; stopId?: string; paidBy: string; splitWith: string[]; createdAt: string; }

export interface AiTip { text: string; kind: 'clima' | 'altitude' | 'fronteira' | 'reserva' | 'logistica' | 'cultura' | 'outro'; source?: string; }
export interface DiaryEntry { id: string; stopId: string; moment: 'antes' | 'durante' | 'depois'; text?: string; photoUrls: string[]; favorite: boolean; }
```

Os dados de exemplo das 4 trilhas estão em `window.TRILHA_DATA.themes` dentro do protótipo e podem virar `lib/data/mock.ts`.

---

## 4. Tokens

### 4.1 Tokens base (fixos, iguais em todos os temas)

```css
:root{
  --font-body: 'Instrument Sans', ui-sans-serif, system-ui, sans-serif;   /* 400 500 600 */
  --font-mono: 'JetBrains Mono', ui-monospace, Menlo, monospace;          /* 400 500 */
  --r-sm:12px; --r-md:16px; --r-lg:22px; --r-xl:30px; --r-pill:999px;
  --s1:4px; --s2:8px; --s3:12px; --s4:16px; --s5:24px; --s6:32px; --s7:48px; --s8:64px; --s9:96px;
  --ease-out: cubic-bezier(.2,.8,.2,1);       /* entradas, revelações */
  --ease-spring: cubic-bezier(.3,1.7,.5,1);   /* quiques, hover, seleção */
  --gutter: clamp(16px, 4vw, 56px);
  --maxw: 1280px;                              /* largura máxima do conteúdo */
}
```

### 4.2 Tokens de tema (sobrescritos por trilha)

| Variável | Uso |
|---|---|
| `--bg` | Fundo da página |
| `--ink` | Texto principal, botões escuros, bordas fortes |
| `--mute` | Texto secundário, eyebrows |
| `--line` | Bordas finas (1px), divisórias |
| `--acc` | Cor de ação principal (botão primário, etiqueta IA, faixa marquee, CTA final, motif do logo) |
| `--acc2` | Segundo acento (aba ativa mobile, sticker, swatches, motifs flutuando) |
| `--acc3` | Terceiro acento (categorias, motifs) |
| `--deep` | Blocos escuros de destaque (seção da rota, anel da mala, conversor, banner do diário, barra de abas mobile) |
| `--on-deep` | Texto sobre `--deep` |
| `--on-acc` | Texto sobre `--acc` definido pela identidade (no código use `--fg-acc`, calculado) |
| `--route` | Linha e paradas acesas na rota sobre `--deep` |
| `--font-display` / `--display-weight` | Títulos, números grandes, nomes de cidade |
| `--motif` | `clip-path` do símbolo do destino |

**Derivados (calculados no cliente/servidor, nunca definidos à mão):**
- `--fg-acc`, `--fg-acc2`, `--fg-acc3`: cor de texto sobre cada acento = `fgOn(cor)`.
- `--card`: `#FFFFFF` em tema claro, `#152A31` em tema escuro.
- `--soft`: `rgba(255,255,255,.6)` claro, `rgba(255,255,255,.06)` escuro.
- Tema é **escuro** quando `luminância(--bg) < 0.2`. Em tema escuro: atributo `data-dark` no `<html>`, grain em `mix-blend-mode: screen` com opacidade .05.
- **Ciclo de cores** para itens em sequência (paradas, categorias, barras): `[acc, acc2, acc3, deep]`, e em tema escuro `[acc, acc2, acc3, ink]` (porque `deep` some sobre o fundo).

```ts
export function luminance(hex: string) {
  const c = [0, 2, 4].map(i => parseInt(hex.slice(1 + i, 3 + i), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
export const fgOn = (hex: string) => (luminance(hex) > 0.22 ? '#141414' : '#FFFFFF');
```

### 4.3 As 4 identidades do dicionário inicial

| Token | Andes Têxtil (Peru + Bolívia) | Sol & Seigaiha (Japão) | Zellige & Duna (Marrocos) | Aurora & Gelo (Islândia) |
|---|---|---|---|---|
| bg | `#F3E6D3` | `#F5F0E6` | `#F6E9DA` | `#0D1B21` (escuro) |
| ink | `#2A1712` | `#161616` | `#2B1B17` | `#E8F1EE` |
| mute | `#6B4F43` | `#5B5650` | `#6A5248` | `#9FB3B0` |
| line | `rgba(42,23,18,.18)` | `rgba(22,22,22,.16)` | `rgba(43,27,23,.16)` | `rgba(232,241,238,.16)` |
| acc | `#C8452C` | `#D7262E` | `#2A4BD7` | `#53F0A6` |
| acc2 | `#E8A33D` | `#F2B8C6` | `#E9A23B` | `#7FC8F8` |
| acc3 | `#B5246B` | `#1E3A5F` | `#B4532A` | `#9B7BFF` |
| deep | `#17403C` | `#1E3A5F` | `#2A4BD7` | `#132A31` |
| onDeep | `#F7EFE3` | `#F5F0E6` | `#FFF4E6` | `#E8F1EE` |
| onAcc | `#FFF6EA` | `#FFFFFF` | `#FFFFFF` | `#0D1B21` |
| routeLine | `#E8A33D` | `#F2B8C6` | `#E9A23B` | `#53F0A6` |
| Fonte display | Bricolage Grotesque 800 | Shippori Mincho B1 800 | Gloock 400 | Big Shoulders Display 800 |
| Fallback | 'Arial Black', sans-serif | Georgia, serif | Georgia, serif | Impact, sans-serif |
| Motif | Losango | Círculo (sol) | Estrela de 8 pontas (zellige) | Estrela de 6 pontas fina (floco) |
| Padrão | Losango têxtil andino | Ondas seigaiha | Estrela zellige | Curvas de nível |
| Fenda | `diamond` | `lens` | `arch` | `band` |
| Split do countdown | `v` | `v` | `v` | `h` |
| Inspirações | Têxteis andinos · Altiplano a 3.800 m · Salar de Uyuni · Janeiro: época de chuva | Hinomaru, o sol vermelho · Ondas seigaiha · Papel washi · Abril: florada das cerejeiras | Azulejos zellige · Azul majorelle · Dunas do Saara · Outubro: dias amenos | Aurora boreal · Curvas de nível · Gelo glacial · Fevereiro: noites longas |

Contrastes medidos (todos passam AA para o uso indicado):

| Par | Andes | Japão | Marrocos | Islândia |
|---|---|---|---|---|
| ink / bg | 13.9 | 15.9 | 13.8 | 15.3 |
| mute / bg | 6.0 | 6.4 | 6.0 | 8.0 |
| onDeep / deep | 10.0 | 10.1 | 6.3 | 13.0 |
| fgOn(acc) / acc | 4.8 | 5.0 | 6.8 | 12.6 |
| routeLine / deep (gráfico, mínimo 3:1) | 5.3 | 6.8 | 3.1 | 10.2 |

### 4.4 Como aplicar o tema
No `app/t/[tripId]/layout.tsx`, gere um objeto de variáveis a partir de `trip.identity` e aplique no `<html>` (via `style` no elemento raiz do layout ou um `<style>` com `:root{...}`), para que o fundo da página e a barra do navegador (`<meta name="theme-color">`) também mudem. A troca de tema anima `background` e `color` em 500ms.

```ts
export function themeVars(id: DestinationIdentity): Record<string, string> {
  const p = id.palette; const dark = luminance(p.bg) < 0.2;
  return {
    '--bg': p.bg, '--ink': p.ink, '--mute': p.mute, '--line': p.line,
    '--acc': p.acc, '--acc2': p.acc2, '--acc3': p.acc3, '--deep': p.deep,
    '--on-deep': p.onDeep, '--on-acc': p.onAcc, '--route': p.routeLine,
    '--fg-acc': fgOn(p.acc), '--fg-acc2': fgOn(p.acc2), '--fg-acc3': fgOn(p.acc3),
    '--card': dark ? '#152A31' : '#FFFFFF', '--soft': dark ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.6)',
    '--font-display': `'${id.display.family}', ${fallbackFor(id.display.family)}`, '--display-weight': String(id.display.weight),
    '--motif': id.motif,
  };
}
```

---

## 5. Tipografia

| Papel | Fonte | Tamanho | Peso | Outros |
|---|---|---|---|---|
| Número do countdown | display | `clamp(44px, 11vw, 190px)` | do tema | `line-height .85`, `letter-spacing -0.03em`, `tabular-nums` |
| Título do destino sobre a foto | display | `clamp(56px, 10vw, 168px)` | do tema | `line-height .88`, branco |
| Título de página (H1) | display | `clamp(56px, 8vw, 120px)` | do tema | `line-height .9`, motif ao lado (0.32em) |
| Cidade na rota (H2) | display | `clamp(48px, 6.5vw, 108px)` | do tema | `line-height .92` |
| Cidade no detalhe da parada | display | `clamp(52px, 6.5vw, 96px)` | do tema | entra com `popin` |
| Números de estatística | display | `clamp(48px, 5.5vw, 88px)` | do tema | `tabular-nums` |
| H2 de seção | display | 26 a 40px | do tema | |
| Nome em card/ticket | display | 22 a 28px | do tema | |
| Texto | Instrument Sans | 16px (15 a 18) | 400, 500, 600 | `line-height 1.45` |
| Eyebrow | JetBrains Mono | 12px | 400 | MAIÚSCULAS, `letter-spacing .22em`, cor `--mute` |
| Metadados (datas, códigos, tamanhos) | JetBrains Mono | 11 a 14px | 400 a 500 | `letter-spacing .1em` a `.2em` |
| Etiqueta IA / tags | JetBrains Mono | 10px | 400 | `letter-spacing .14em` |

Regras: a fonte display **nunca** é usada em texto corrido. Texto corrido e interface usam Instrument Sans. Datas, códigos IATA, valores técnicos e eyebrows usam mono.

---

## 6. Elementos de identidade

### 6.1 Motifs (clip-path)
```
andes     polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)
japao     circle(50% at 50% 50%)
marrocos  polygon(50% 0%, 63.8% 16.7%, 85.4% 14.6%, 83.3% 36.2%, 100% 50%, 83.3% 63.8%, 85.4% 85.4%, 63.8% 83.3%, 50% 100%, 36.2% 83.3%, 14.6% 85.4%, 16.7% 63.8%, 0% 50%, 16.7% 36.2%, 14.6% 14.6%, 36.2% 16.7%)
islandia  polygon(50% 0%, 58% 36.1%, 93.3% 25%, 66% 50%, 93.3% 75%, 58% 63.9%, 50% 100%, 42% 63.9%, 6.7% 75%, 34% 50%, 6.7% 25%, 42% 36.1%)
```
**Motif sólido (`--motif-solid`).** Motifs finos (como a estrela de 6 pontas da Islândia) não comportam texto. Toda forma que contém número, iniciais ou ícone usa `--motif-solid`: badge numérico das paradas, sticker "por pessoa", avatares do acerto de contas, checkbox da mala, ícone da área de upload. Islândia: `polygon(50% 0%, 93.3% 25%, 93.3% 75%, 50% 100%, 6.7% 75%, 6.7% 25%)` (hexágono, como um cristal de gelo). Nas outras três identidades `motifSolid = motif`. Regra para identidades geradas: se a área do polígono do motif for menor que 55% do quadrado, gerar um `motifSolid` (círculo ou hexágono).

Gerador para novos motifs (estrela de n pontas):
```ts
export function starPolygon(n: number, outer = 50, inner = 36, rotDeg = -90) {
  const pts = Array.from({ length: n * 2 }, (_, i) => {
    const r = i % 2 === 0 ? outer : inner; const a = ((rotDeg + (180 * i) / n) * Math.PI) / 180;
    return `${(50 + r * Math.cos(a)).toFixed(1)}% ${(50 + r * Math.sin(a)).toFixed(1)}%`;
  });
  return `polygon(${pts.join(', ')})`;
}
```
Onde o motif aparece (obrigatório): logo (18px, balançando), ao lado do H1 (0.32em, flutuando), badge numérico das paradas (52px), bullets de plano e pendências (12 a 14px), checkbox da mala, avatares do acerto de contas (36px), sticker "por pessoa" (130px), molduras de foto alternadas, ícone da área de upload (76px), botão flutuante mobile, motifs flutuantes de fundo, separador da faixa marquee.

### 6.2 Padrões (pattern SVG)
Desenhados como `<pattern patternUnits="userSpaceOnUse">` e usados como fundo em opacidade baixa.
- **Andes (48×48):** losango vazado `stroke acc` 3px + losango interno preenchido `acc3` + quadradinhos 5×5 `deep` nos 4 cantos.
- **Japão (40×20):** seigaiha. Em (0,10), (40,10), (20,20), (0,30), (40,30) desenhar 3 círculos concêntricos r=18, 12, 6, `fill bg`, `stroke acc3` 1.6px, nessa ordem.
- **Marrocos (40×40):** dois quadrados 18×18 `acc` em (11,11), um girado 45°, formando estrela de 8; círculo r=4 `acc2` no centro; triângulos `acc3` nos cantos.
- **Islândia (120×36):** duas ondas `M0 9 Q30 1 60 9 T120 9` (`acc`) e `M0 27 Q30 19 60 27 T120 27` (`acc2`), 1.4px.

Opacidades de uso: fundo de página 6%; hero antes de abrir 12% (some ao rolar); seção da rota 12% (girado 8°, deslocado à direita); cabeçalho do detalhe da parada 18%; CTA final 14%; banner do diário 12%.

Os SVGs exatos estão no protótipo em `TRILHA_DATA.themes[key].patternDefs`.

### 6.3 Fendas (a foto que se abre)
A foto (ou paisagem) fica numa camada `position:absolute; inset:0` com `clip-path` animado pelo progresso do scroll `e` (0 fechado, 1 aberto), já com easing `easeOutCubic`. `inv = 1 - e`, `vw` = largura da viewport em px.

| Forma | clip-path |
|---|---|
| `diamond` | `polygon(50% {50-h}%, {50+w}% 50%, 50% {50+h}%, {50-w}% 50%)` com `w = 1.4 + 104e`, `h = 24 + 82e` |
| `lens` | `ellipse({0.7 + 90e}% {24 + 66e}% at 50% 50%)` |
| `arch` | `inset({14inv}% {L}% {14inv}% {L}% round {r}px {r}px 0 0)` com `L = 48.6inv`, `r = ((100 - 2L)/200) * vw * (1 - e²)` |
| `band` | `inset({49.4inv}% {6inv}% {49.4inv}% {6inv}%)` |

Para novas identidades, a IA escolhe uma destas 4 formas (não inventa formas novas sem revisão de design).

### 6.4 Paisagem placeholder e foto do usuário
Antes do usuário escolher a foto, a camada mostra uma **paisagem vetorial do tema** (1440×900, `preserveAspectRatio="xMidYMid slice"`) com 4 camadas de parallax: céu/sol (`par0`), montanhas ao fundo (`par1`), meio (`par2`), primeiro plano (`par3`). Velocidades: `translateY(scrollY * [0.05, 0.10, 0.16, 0.24])`. O SVG inteiro também faz `scale(1.18 → 1.0)` enquanto a fenda abre.
Quando o usuário envia uma foto (botão **Trocar foto**), ela substitui a paisagem (`object-fit: cover`), mantendo o zoom. Na produção: recortar/comprimir no upload (lado maior 2400px, WebP/AVIF), guardar no storage, gerar blurhash para o carregamento.

### 6.5 Textura
Grain fixo por cima de tudo: SVG `feTurbulence type=fractalNoise baseFrequency=.8 numOctaves=2`, opacidade .09, `mix-blend-mode: multiply` (tema escuro: screen, .05), animação `grain` 1.2s `steps(3)`, `pointer-events: none`.

---

## 7. Componentes

Para cada componente: anatomia, estados e regras. Os estilos exatos estão no CSS do protótipo (procure pelo nome da classe indicada).

**AppHeader** (`.top`): sticky, `background: color-mix(in srgb, var(--bg) 82%, transparent)` + `backdrop-filter: blur(14px)`, borda inferior `--line`. Esquerda: logo (motif + "trilha" em display 24px). Centro: nav em pílula (`--card`, borda `--line`, item ativo `--ink`/`--bg`, `aria-current="page"`). Direita: **IdentityPill**. No Início o header é `position: fixed` (sobrepõe o hero). Abaixo de 820px a nav some e entra a **TabBar**.

**IdentityPill + IdentityMenu**: pílula com 3 bolinhas (acc, acc2, deep) + "Identidade **{idName}**". Abre menu (popin .35s spring) com as trilhas do usuário (motif colorido + destino + idName), "Nova trilha" e "Ver todas as identidades". Fecha com Esc e clique fora. Em produção lista as trilhas do usuário, não identidades de demonstração.

**TabBar** (mobile ≤ 820px): fixa a 12px das laterais e 14px do fundo, `--deep`, raio 26px, sombra `0 5px 0 var(--acc)`. 5 itens (Início, Roteiro, Docs, Mala, Diário) com ícone 22px + rótulo 11px. Ativo: `--acc2` / `--fg-acc2`. Alvos ≥ 52px.

**Button**: altura 50px, raio pílula, padding 0 22px, peso 600, ícone 18px à esquerda. Variantes: padrão (`--card` + borda `--line`), `primary` (`--acc` / `--fg-acc`), `ink` (`--ink` / `--bg`), `ghost` (transparente + borda `--ink`). Hover: `lift`. Active: `tap` (scale .94).

**Chip** (filtros, abas): altura 46px, pílula, borda `--line`, `aria-pressed`. Pressionado: `--ink`/`--bg`. Contador em mono 12px, opacidade .7.

**AiNote** (`.ai`): caixa `--soft`, borda `--line`, raio 16px, padding 14×16. À esquerda a etiqueta **IA** (mono 10px, `--acc`/`--fg-acc`, raio 6px, ícone sparkle 10px). Texto 15 a 16px.

**Tag IA** (`.tag`): versão mínima, só borda `--acc` e texto "IA". Usada em itens sugeridos (mala, pendências).

**Marquee**: faixa `--acc` girada -1.5°, sangrando 40px para fora das laterais, texto em display `clamp(36px, 5vw, 64px)`, itens separados por motif `--acc2` de 0.35em, rolagem infinita 34s linear (conteúdo triplicado). `aria-hidden`.

**Floaters** (motifs flutuantes de fundo): `position:absolute` atrás do conteúdo (`z-index:-1` dentro do container), cada um com cor de acento, opacidade .35 a .55, animação `floaty` 7 a 10s, e parallax `translateY(scrollY * speed)` com `speed` entre -0.3 e 0.2. Máximo 5 por página.

**Countdown** (hero): meses, dias, horas, minutos (2 dígitos, display). Atualiza a cada 1s. Meses são meses de calendário completos até a data; o resto é dias/horas/minutos. Rótulos em mono 11px `--mute`.

**CircularBadge**: 132px, texto mono 10.5px em `textPath` circular ("TRILHA · IDENTIDADE {idName} · GERADA PARA {destino} ·"), girando 30s, motif 26px no centro. Some com o scroll. Oculto abaixo de 600px.

**SegmentBar** (roteiro): uma barra horizontal com um segmento por parada, largura proporcional às noites (`flex: noites 1 0`), cores do ciclo, código da parada em mono + noites. Selecionado sobe 8px com sombra `0 8px 0 var(--ink)` (spring). Abaixo de 600px mostra só o código.

**StopButton**: card 100%, raio 22px, badge motif 52px com número, cidade em display 24px, datas em mono 12px. Selecionado: fundo `--ink`, texto `--bg`. Entre paradas: **LegConnector** (linha tracejada vertical animada `dashmove` + pílula mono com "Ônibus · 7h").

**StopDetail**: card com cabeçalho na cor da parada (padrão 18% + motif gigante flutuando + "PARADA n DE N · PAÍS" + cidade em display + datas/noites/meta). Corpo: AiNote com a dica, **BoardingPass**, grade com "Onde durmo" (status: `Reserva anexada` em `--acc2`, `Sem reserva` em `--acc`) e "Documentos" ligados (links para o hub), "Plano" (lista com bullets motif), "Notas" (textarea).

**BoardingPass**: fundo `--bg`, raio 22px, recortes circulares de 22px nas laterais (cor `--card`), lado principal com origem e destino em display 44px + horários em mono, pílula do modo no meio sobre linha tracejada animada, lado direito separado por borda tracejada com localizador e datas.

**DocTicket**: card raio 22px com cabeçalho colorido por categoria (Passagens `acc`, Identidade `acc2`, Reservas `acc3`, Ingressos `deep`, Seguro `acc`, Outros `acc3`), borda inferior tracejada, recortes de 20px nas laterais na altura do picote, título display 22px, subtítulo `--mute`, rodapé com "PDF · 212 KB" e selo **OFFLINE**.

**DropZone**: área raio 34px com borda tracejada animada (SVG `rect` com `dashmove`), ícone de upload dentro de motif `--acc` flutuando, título "Solta aqui", texto explicando que a IA classifica e liga à parada. Aceita clique, arrastar e soltar, múltiplos arquivos. Estado `over` muda o fundo para `--soft`.

**MotifCheckbox**: input nativo visualmente escondido (continua focável) + caixa 26px em forma de motif: borda `--ink`, miolo `--card`, marca interna 14px `--acc` quando marcado; ao marcar faz `pop` (scale 1.25 em .3s spring) e o rótulo ganha `line-through` + opacidade .5. Foco visível no motif.

**ProgressRing** (mala): bloco `--deep`, anel SVG r=48, traço 14px, trilho `currentColor` 18%, valor `--acc2` com ponta arredondada; `stroke-dasharray` anima .6s spring. Texto "{feitos} de {total}" em display.

**BudgetCard**: valor gasto em display `clamp(48px, 5vw, 72px)`, previsto e restante em `--mute`, sticker em motif `--acc2` com "por pessoa" girando levemente; barras por categoria (altura 16px, cor do ciclo, crescem da esquerda ao aparecer), alerta "N% ACIMA DO PREVISTO" e AiNote se alguma categoria passar.

**StopSpendColumns**: colunas por parada (altura proporcional), crescendo de baixo ao aparecer, código mono embaixo.

**Converter**: bloco `--deep`, input numérico em reais, uma linha por moeda local com símbolo e valor (sem casas decimais quando a taxa > 5, ex. iene, coroa islandesa). Na produção: taxa de API de câmbio com timestamp; no protótipo as taxas são exemplo.

**DebtList**: linhas "A → B · R$ X" com avatares em motif (cores acc, acc2, acc3 por pessoa). Viagem solo mostra mensagem de convite.

**DiaryCard**: card levemente girado (-2° a 2°), moldura de foto com formas alternadas (motif, retângulo arredondado, arco, elipse), cidade em display 28px, datas, texto placeholder, contador de fotos, botão favoritar (coração, `aria-pressed`).

**Toast**: centro inferior (acima da TabBar), fundo `--ink`, texto `--bg`, entra com spring, some em 3.2s, `role="status"`.

---

## 8. Telas

### 8.1 Nova trilha (onboarding) · `/nova-trilha`
Fundo neutro `#EEEBE4` / `#1C1B19` até um destino ser escolhido; a partir daí a página **assume o tema do destino** com transição de 800ms.
1. **Destino**: título "Pra onde vai a próxima trilha?", campo de busca (autocomplete de lugares na produção) e cards de destino. Ao digitar, se casar com o dicionário, o tema já aparece e uma linha mono diz "IDENTIDADE ENCONTRADA NO DICIONÁRIO: …"; se não casar, "FORA DO DICIONÁRIO: A IA GERA UMA IDENTIDADE NOVA". Botão Continuar desabilitado sem destino.
2. **Datas e estilo**: ida e volta (date inputs), estilo da viagem (chips: Mochilão, Conforto, Aventura, Cultural), turma (opcional, pode ficar para depois). Botões Voltar e **Gerar identidade**.
3. **Geração**: coluna esquerda com as 4 inspirações aparecendo marcadas uma a uma; à direita o cartão de identidade revelando em sequência: nome da identidade + 5 swatches com hex (fase 2), especime da fonte "Aa {destino}" (fase 3), tile do padrão (fase 4), miniatura da fenda abrindo (fase 5), botões (fase 6). Cada fase dura ~650ms. Em produção as fases acompanham o progresso real da chamada de IA (com mínimo de 3s para a sensação de criação). Botões: **Abrir minha trilha** (cria a trilha e vai para o Início), **Gerar outra versão** (nova chamada, `version+1`), **Ajustar dados**.

### 8.2 Início · `/t/[tripId]`
História de scroll em 5 atos. Alturas relativas à viewport (`vh`):

| Ato | Altura | Sticky | Progresso | O que acontece |
|---|---|---|---|---|
| Hero (fenda) | 260vh | palco 100vh | `p1 = clamp((scrollY - heroTop) / 1.6vh)` | Fenda abre (`e = easeOut(p1)`); números do countdown se afastam `±560px` (split h: `±380px` vertical) e somem (`opacity = 1 - 1.8·p1`); padrão do fundo some; título do destino + "Trocar foto" entram quando `p1 > .62` (`opacity = (p1 - .62)/.3`, sobe 60px); dica "ROLE PARA ABRIR" some (`1 - 5·p1`). |
| Rota | 300vh, fundo `--deep` | palco 100vh | `p2 = clamp((scrollY - rotaTop) / 2vh)` | Linha da rota desenha (`pathLength=1`, `stroke-dashoffset = 1 - p2`). Cada parada acende quando `p2 ≥ fração do comprimento do caminho até ela`; a atual cresce (r 7 → 12). À esquerda: "PARADA n DE N", cidade (troca com popin), país · meta, datas, noites, segmentos de progresso, dica IA da parada, próximo trecho. |
| Faixa | marquee com as cidades | | | Separa a rota dos números (sobrepõe -28px). |
| Números | min 120vh | não | `p3 = easeOut(clamp((scrollY - (numTop - .7vh)) / .6vh))` | 5 estatísticas contam de 0 até o valor (`round(v·p3)`, formato pt-BR, prefixo R$ ou sufixo %), linha superior colorida cresce com `p3`. |
| Antes de embarcar | min 140vh | não | `p4 = clamp((scrollY - (pendTop - .6vh)) / .9vh)` | 5 pendências entram em sequência: item k usa `q = easeOut(clamp(p4·5 - k))` → opacidade q, `translateY((1-q)·40px)`, divisória cresce `q·100%`. Cada uma tem link de ação para a tela certa. |
| Final | min 100vh, fundo `--acc` | não | `p5 = easeOut(clamp((scrollY - (finalTop - .6vh)) / .6vh))` | "Faltam N dias." gigante (scale .92 → 1), botões "Abrir roteiro completo" e "Ver pendências". |

Barra de progresso de 3px `--acc` fixa no topo (largura = scroll total). Floaters com parallax nas seções Números e Pendências. Tudo calculado num único handler de scroll com `requestAnimationFrame` e escrita direta de estilos (sem re-render React por frame).

Conteúdo das estatísticas: dias de viagem, nº de paradas, km (por terra/trem/carro conforme a viagem), gastos até agora, % da mala pronta.

### 8.3 Roteiro · `/t/[tripId]/roteiro`
Título com eyebrow "{DESTINO} · FALTAM N DIAS", subtítulo, ações "Ver no mapa" e "Adicionar parada". SegmentBar. Duas colunas (empilham no mobile): lista de paradas + formulário "Nova parada" (cidade, chegada, saída, como chega) | StopDetail da parada selecionada (selecionar no mobile rola até o detalhe). Adicionar parada cria a parada no fim, liga o trecho anterior e seleciona a nova; a IA preenche dica, plano sugerido e hospedagem sugerida de forma assíncrona.

### 8.4 Documentos · `/t/[tripId]/documentos`
Título, busca (filtra por texto), botão "Enviar arquivo". Duas AiNotes (alerta mais importante da trilha + regra do offline). Filtros por categoria (só mostra categorias com itens) com contagem. Grade de DocTickets. Marquee com títulos de documentos. "Fotos e prints" (galeria com molduras em motif). DropZone. Ao enviar: a IA classifica (categoria + parada) e mostra toast "Identificado como X e ligado a Y". O usuário pode corrigir a categoria e a parada.

### 8.5 Mala e gastos · `/t/[tripId]/mala`
Coluna esquerda: ProgressRing, AiNote explicando as sugestões, grupos do checklist (Documentos, Roupas, Equipamento, Farmácia, + "Seus itens"), campo para adicionar item, Pendências (com responsável e prazo na produção). Coluna direita: BudgetCard, StopSpendColumns, Converter, DebtList + "Registrar gasto" (abre formulário: valor, categoria, parada, quem pagou, dividir com).

### 8.6 Diário · `/t/[tripId]/diario`
Abas Antes / Durante / Depois (muda o banner e o comportamento): Antes = mural de inspirações (salvar links, fotos, lugares e ligar à parada); Durante = um registro por dia (lembrete à noite com as fotos do dia); Depois = retrospectiva gerada (trajeto, melhores fotos, números) na identidade da trilha, exportável como imagem/vídeo curto. Grade de DiaryCards por parada.

### 8.7 Identidades · `/identidades`
Título "Uma trilha, quatro caras.", explicação do que muda e do que fica, e um card por identidade: paisagem, nome da identidade, destino na fonte display, 5 swatches com hex, tile do padrão, miniatura da fenda, inspirações, botão "Usar esta identidade".

### 8.8 Estados obrigatórios (não estão no protótipo, mas devem existir)
- **Vazio**: roteiro sem paradas (CTA para adicionar a primeira), documentos vazios (DropZone em destaque), mala sem itens (botão "Pedir sugestões à IA").
- **Carregando**: skeletons nas cores `--soft`/`--line`, nunca spinners genéricos no conteúdo principal.
- **Erro**: mensagem humana + tentar de novo; IA indisponível nunca bloqueia o uso manual.
- **Offline**: banner discreto "Você está offline. Passagens e documentos continuam disponíveis."
- **Viagem passou**: o countdown vira "Há N dias você voltou de {destino}" e o Diário abre em "Depois".
- **Dia da viagem**: "É hoje." no lugar dos números, com confete de motifs (uma vez).

---

## 9. IA

### 9.1 Regras de produto
- A IA **sugere, nunca decide**. Tudo que ela cria é editável e removível.
- Toda saída de IA visível leva a etiqueta **IA** (AiNote ou Tag).
- Tom: curto, prático, segunda pessoa, português do Brasil informal ("pra", "dá pra"). Uma ou duas frases.
- Fatos sensíveis (vistos, vacinas, regras de fronteira, saúde) devem citar fonte oficial e data de verificação; se não houver fonte, a IA não afirma, sugere conferir.
- Falha de IA nunca quebra a tela; o espaço da dica simplesmente não aparece.

### 9.2 Endpoints

| Endpoint | Entrada | Saída | Quando |
|---|---|---|---|
| `POST /api/ai/identity` | destino, datas, estilo, `version` | `DestinationIdentity` | Onboarding; "Gerar outra versão" |
| `POST /api/ai/tips` | trilha, parada | `AiTip` | Ao criar/editar parada; recalcular perto da data |
| `POST /api/ai/packing` | destino, datas, paradas (altitude, clima), estilo | `PackingItem[]` com `reason` | Ao criar a trilha; botão "Pedir sugestões" |
| `POST /api/ai/classify` | nome do arquivo, texto extraído (OCR/PDF), paradas | `{ category, stopId?, title, subtitle, confidence }` | Upload de documento |
| `POST /api/ai/alerts` | trilha completa | lista de `Task` com `fromAi: true` | Diário (cron) e ao mudar a trilha. Ex.: seguro não cobre o último dia, hospedagem faltando, trecho longo demais |
| `POST /api/ai/retro` | trilha, diário, fotos favoritas | roteiro da retrospectiva | Aba "Depois" |

### 9.3 Geração de identidade (pipeline)
1. **Normalizar** o destino (país, região, cidades) com um serviço de lugares.
2. **Dicionário local** (`lib/identity/dictionary.ts`): se o destino casa com uma identidade curada, usar ela (`generatedBy: 'dictionary'`). Começar com as 4 deste documento e crescer com os destinos mais buscados.
3. **IA** para o resto: pedir JSON que siga o schema abaixo (validar com Zod).
4. **Validar e corrigir**:
   - `contrast(ink, bg) ≥ 7`, `contrast(mute, bg) ≥ 4.5`, `contrast(onDeep, deep) ≥ 4.5`, `contrast(fgOn(acc), acc) ≥ 4.5`, `contrast(routeLine, deep) ≥ 3`.
   - Se falhar, ajustar a luminosidade (OKLCH L) da cor problemática em passos de 2% até passar; se não passar em 20 passos, cair para a identidade do dicionário mais próxima.
   - `display.family` deve existir no Google Fonts e ter peso disponível; caso contrário usar a lista permitida (ver abaixo).
   - `slit` ∈ {diamond, lens, arch, band}; `motif` deve ser `circle()` ou `polygon()` com até 24 pontos.
   - Paleta: 0 a 2 acentos "fortes"; acentos com croma parecido.
5. **Persistir** a identidade na trilha (ela não muda sozinha depois de criada).

Fontes display permitidas para a IA (todas no Google Fonts): Bricolage Grotesque, Shippori Mincho B1, Gloock, Big Shoulders Display, Abril Fatface, DM Serif Display, Unbounded, Rubik, Space Grotesk, Playfair Display, Archivo Black, Familjen Grotesk, Young Serif, Instrument Serif.
Proibidas (o validador recusa): **Syne** (rejeitada pelo cliente), Inter, Roboto, Arial, Fraunces (genéricas demais ou já descartadas).

Prompt base (servidor):
```
Você cria a identidade visual de uma viagem dentro do app Trilha.
Destino: {destino} ({país/região}). Datas: {ida} a {volta}. Estilo: {estilo}.
Responda APENAS com JSON válido no schema DestinationIdentity.
Regras:
- Inspire-se em elementos culturais, naturais e climáticos reais do destino e da época. Liste 4 em "sources" (máx. 5 palavras cada).
- Evite clichês ofensivos e símbolos religiosos ou nacionais oficiais (bandeiras, brasões).
- "palette": bg claro (L > 90%) para destinos diurnos ou escuro (L < 20%) para destinos noturnos/polares; ink com contraste ≥ 7:1 sobre bg;
  acc, acc2, acc3 vivos e harmônicos; deep escuro o bastante para texto claro; routeLine visível sobre deep.
- "display": uma fonte da lista permitida que combine com o destino.
- "motif": clip-path CSS simples e reconhecível (circle() ou polygon() com até 24 pontos).
- "pattern": descreva um padrão repetível em SVG (tile ≤ 120px) com no máximo 3 cores da paleta.
- "slit": uma de diamond | lens | arch | band. "split": "h" só para band.
- "idName": 2 a 3 palavras, formato "Coisa & Coisa" ou "Lugar Coisa".
```

### 9.4 Dicas por parada (exemplos reais do protótipo)
- Cusco: "Cusco fica a 3.400 m. Deixei o primeiro dia livre no roteiro pra você aclimatar antes das trilhas."
- Hakone: "Em dia limpo dá pra ver o Fuji do lago Ashi. A previsão aparece aqui 3 dias antes."
- Marrakech: "Na medina o GPS se perde. Baixei o mapa offline dos souks pra você."
- Vík: "Na praia de areia preta as ondas surpreendem: fique longe da beira."

---

## 10. Movimento

| Nome | Definição | Uso |
|---|---|---|
| `floaty` | `translateY(0 → -18px)` + `rotate(0 → 10deg)`, 7 a 10s ease-in-out infinito | motifs flutuantes, motif do título |
| `wig` | `rotate(-6deg ↔ 6deg)`, 3.4s | logo, sticker |
| `marquee` | `translateX(0 → -50%)`, 34s linear infinito | faixas |
| `dashmove` | `stroke-dasharray 10 10`, `stroke-dashoffset → -200`, 8s linear | conectores, picote do bilhete, borda da DropZone |
| `popin` | `scale(.6) rotate(-6deg), opacity 0` → `scale(1.04)` → normal, .35 a .6s spring | menu, título da parada, cidade na rota |
| `pop` | `scale(1.25)` no meio, .3s spring | checkbox, favoritar |
| `grain` | translada ±2% em 3 passos, 1.2s | textura |
| `hint` | linha vertical que cresce e encolhe, 2s | "Role para abrir" |
| Reveal `.rv` | `opacity 0, translateY(48px) scale(.97)` → normal; opacidade .8s ease-out, transform .9s spring | todo card/bloco ao entrar na tela |
| Crescer `.gw` / `.gy` | `scaleX/scaleY 0 → 1`, 1 a 1.1s | barras do orçamento, colunas por parada |
| Lift (hover) | `translateY(-6px) rotate(-.8deg)` + `box-shadow 6px 8px 0 currentColor`, .35s spring | cards, tickets, botões |
| Tap (active) | `scale(.94)`, .2s spring | todo elemento clicável |
| Troca de tema | `background`, `color` 500ms | html/body |
| Entrada de página | `opacity 0 → 1`, .5s | conteúdo da rota (não usar transform no container: quebra `position: fixed` dos filhos) |

Reveal: `IntersectionObserver` com `threshold .08` e `rootMargin '0px 0px -8% 0px'`; anima uma vez (desobserva). Em re-render por interação (selecionar parada, filtrar) **não** repetir o reveal.

`prefers-reduced-motion: reduce`: desligar todas as animações e transições; reveals já aparecem; a fenda fica aberta (mostra a foto e o countdown abaixo dela, sem história de scroll); marquee parado.

Performance: animar só `transform`, `opacity` e `clip-path`; `will-change` só nos floaters e na camada da foto; handler de scroll passivo + rAF; nada de setState por frame.

---

## 11. Acessibilidade
- Contraste conforme 4.3; validador obrigatório para identidades geradas.
- Controles reais: `<button>`, `<a href>`, `<input>` com `<label>`. Nada de `div` clicável.
- `aria-current="page"` na nav, `aria-pressed` em chips/segmentos/favoritar, `aria-expanded` em menus e acordeões, `role="status"` no toast.
- Ícones decorativos com `aria-hidden`; botões só com ícone têm `aria-label`.
- Foco visível: `outline 2.5px solid var(--acc); outline-offset 3px`.
- Alvos de toque ≥ 44px (TabBar 52px).
- Elementos decorativos (marquee, floaters, badge, padrões, grain) com `aria-hidden` e `pointer-events: none`.
- A rota tem `role="img"` + `aria-label`; o conteúdo textual da parada atual está fora do SVG.
- Countdown: atualizar o texto visível a cada segundo, mas expor para leitores de tela só uma frase estável ("Faltam 103 dias para Peru + Bolívia").

## 12. Responsivo
- Breakpoints: ≤ 600px (telefone), ≤ 820px (tablet/telefone grande: TabBar no lugar da nav), > 820px (desktop).
- Grades: `repeat(auto-fit, minmax(min(Npx, 100%), 1fr))`.
- Colunas lado a lado viram pilha via `flex-wrap` (`flex: 1 1 340px` e `flex: 999 1 560px`).
- Countdown: números `clamp(44px, 11vw, 190px)`; no telefone o badge circular some.
- `overflow-x: clip` em html e body (as faixas sangram para fora).
- Conteúdo inferior com `padding-bottom: 140px` no mobile para não ficar atrás da TabBar.

## 13. Conteúdo e tom
- Português do Brasil, informal e direto, segunda pessoa ("sua trilha", "dá pra", "pra").
- Frases curtas. Sem jargão de marketing.
- Datas: "15 jan 2027", intervalos "15 → 17 jan", horários 24h "06:40".
- Moeda: "R$ 6.840" (sem centavos em totais), moedas locais com símbolo ("S/", "Bs", "¥", "DH", "kr").
- Dados ausentes aparecem como marcadores visíveis: `[CÓDIGO]`, `[HORÁRIO]`, `[DATA]`. Nunca inventar.
- Os dados das 4 trilhas são **exemplos de demonstração**. Na produção tudo vem do usuário, de integrações ou da IA.

## 14. Fora do protótipo (a construir)
- Autenticação (e-mail mágico + Google/Apple) e convites da turma com papéis.
- Persistência real, sincronização entre acompanhantes (tempo real opcional).
- Mapa interativo ("Ver no mapa"), autocomplete de lugares, distâncias reais.
- Upload real com OCR/extração de PDF para a classificação e preenchimento de bilhetes.
- API de câmbio com cache e data da cotação.
- PWA/offline real dos documentos.
- Notificações (lembretes de pendências, previsão do tempo, aurora, check-in).
- Exportação da retrospectiva.
- Analytics de produto.

## 15. Critérios de aceite
- [ ] Trocar a identidade muda **todas** as telas sem recarregar e sem nenhuma cor fixa sobrando.
- [ ] As 4 identidades do dicionário batem com os valores da seção 4.3.
- [ ] A fenda de cada identidade abre com a forma e as fórmulas da seção 6.3, a 60fps em um notebook comum.
- [ ] A rota desenha e acende as paradas nas frações corretas do caminho.
- [ ] Números contam, pendências entram em sequência, CTA final aparece, barra de progresso acompanha.
- [ ] Reveals acontecem uma vez; interações não repetem a animação.
- [ ] Checkbox em motif funciona com teclado e leitor de tela.
- [ ] Upload classifica e liga à parada, com correção manual possível.
- [ ] Converter atualiza enquanto digita.
- [ ] `prefers-reduced-motion` respeitado em tudo.
- [ ] Contraste validado automaticamente em identidades geradas pela IA.
- [ ] Layout funciona em 360px, 390px, 768px, 1280px e 1440px sem rolagem horizontal.
- [ ] Lighthouse: Acessibilidade ≥ 95, Performance ≥ 85 no mobile.
