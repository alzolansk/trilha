# TRILHA · Votação da turma (adendo ao SPEC)

> Especificação de uma feature nova para ser desenvolvida de forma independente.
> Complementa `ref/SPEC.md`. Em conflito sobre **esta feature**, este documento vence. Para todo o resto (tokens, componentes, tom, acessibilidade, movimento), vale o `ref/SPEC.md`.
> Antes de escrever código: leia `AGENTS.md`, `README.md`, `docs/CHECKLIST.md` e os arquivos citados na seção 9. O Next.js deste projeto tem mudanças em relação ao que você conhece; consulte `node_modules/next/dist/docs/` quando mexer em rotas ou layouts.

---

## 1. Objetivo

Hoje a turma não tem como decidir junto dentro do app. As inspirações do Diário ficam paradas e escolhas como "qual hospedagem" acontecem no WhatsApp. Esta feature cria duas formas de decisão em grupo:

1. **Termômetro nas inspirações**: cada pessoa reage a uma inspiração (quero muito / topo / passo). Quem edita pode **levar a inspiração para o roteiro**, virando uma atividade.
2. **Enquetes**: decisões com uma resposta (hospedagem, passeio, data, destino). A turma vota, quem criou ou o organizador decide, e o resultado **vira dado real** (hospedagem pendente ou atividade no roteiro).

Princípios que continuam valendo: nada decide sozinho (nem prazo, nem IA); todo efeito colateral é visível e editável depois; regras de acesso valem no banco, a interface só esconde botões.

## 2. Decisões já tomadas

| Tema | Decisão |
|---|---|
| Quem vota | **Todo membro, inclusive `viewer` (Só consulta).** Vale para enquetes e para o termômetro. É a única escrita que o `viewer` pode fazer. |
| Quem cria enquete | `organizer` e `editor`. |
| Quem fecha/decide | Quem criou a enquete ou qualquer `organizer`. |
| Quem leva inspiração ao roteiro | `organizer` e `editor`. |
| Votos secretos | Não. Votos são visíveis com nome para todos da viagem. |
| Prazo | Opcional. Depois do prazo ninguém vota, mas a enquete **não fecha sozinha**: espera a decisão de quem criou ou do organizador. |
| Empate | Quem decide escolhe. Pode até escolher uma opção menos votada, com aviso na tela. |
| Offline | Ler funciona offline (vem no bundle). Votar, criar e decidir exigem internet (padrão atual: `ensureOnline()` lança `OfflineError`). Não criar fila offline. |
| IA | Fora do escopo. Não usar `/api/ai/*` nesta feature. |

## 3. Fora do escopo

- Votação anônima, voto ranqueado, pesos.
- Comentários nas enquetes.
- Fila de votos offline.
- Enquete que cria parada nova no roteiro (o alvo `free` cobre "qual cidade" só como registro).
- Arrastar atividades entre dias.

---

## 4. Modelo de dados

Criar **uma** migration nova: `supabase/migrations/20261011000007_votes.sql`. Siga o estilo das existentes: comentários em pt-BR, `set search_path = ''` em toda função, `check` de tamanho em todo texto, chaves compostas `(id, trip_id)` para garantir que tudo é da mesma viagem, gatilho `bump_version` nas tabelas versionadas, RLS ligado, `revoke ... from anon`, grants explícitos, tabelas na publicação `supabase_realtime` e revogar `execute` de funções de gatilho (como em `…0004_hardening.sql`).

### 4.1 Tabelas

```sql
-- Reação de cada pessoa a uma inspiração do Diário.
-- value: 2 = quero muito · 1 = topo · -1 = passo
create table public.inspiration_votes (
  entry_id uuid not null,
  trip_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  value smallint not null check (value in (-1, 1, 2)),
  updated_at timestamptz not null default now(),
  primary key (entry_id, user_id),
  foreign key (entry_id, trip_id) references public.journal_entries (id, trip_id) on delete cascade
);
create index inspiration_votes_trip_idx on public.inspiration_votes (trip_id);

create table public.polls (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  question text not null check (char_length(question) between 1 and 140),
  detail text check (char_length(detail) <= 300),
  -- stay: vencedora vira hospedagem da parada · activity: vira atividade · free: só registra
  target text not null default 'free' check (target in ('stay', 'activity', 'free')),
  stop_id uuid,
  multi boolean not null default false,          -- true: cada pessoa marca várias opções
  closes_at timestamptz,                         -- prazo para votar (opcional)
  status text not null default 'open' check (status in ('open', 'closed')),
  decided_option_id uuid,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (id, trip_id),
  foreign key (stop_id, trip_id) references public.stops (id, trip_id) on delete set null (stop_id),
  check (target = 'free' or stop_id is not null or status = 'closed'),
  check ((status = 'closed') = (decided_at is not null))
);
create index polls_trip_idx on public.polls (trip_id, status);
create trigger polls_version before update on public.polls
  for each row execute function public.bump_version();

create table public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null,
  trip_id uuid not null,
  label text not null check (char_length(label) between 1 and 80),
  detail text check (char_length(detail) <= 300),
  link_url text check (char_length(link_url) <= 500 and (link_url is null or link_url ~ '^https?://')),
  price numeric(14, 2) check (price is null or price >= 0),
  currency char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  address text check (char_length(address) <= 200),   -- usado quando target = 'stay'
  position integer not null default 0,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (id, poll_id),
  unique (id, trip_id),
  foreign key (poll_id, trip_id) references public.polls (id, trip_id) on delete cascade,
  check ((price is null) = (currency is null))
);
create index poll_options_poll_idx on public.poll_options (poll_id, position);

alter table public.polls add constraint polls_decided_option_fk
  foreign key (decided_option_id, id) references public.poll_options (id, poll_id) on delete set null (decided_option_id);

create table public.poll_votes (
  poll_id uuid not null,
  option_id uuid not null,
  trip_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (option_id, user_id),
  foreign key (option_id, poll_id) references public.poll_options (id, poll_id) on delete cascade,
  foreign key (poll_id, trip_id) references public.polls (id, trip_id) on delete cascade
);
create index poll_votes_poll_idx on public.poll_votes (poll_id);
create index poll_votes_trip_idx on public.poll_votes (trip_id);

-- Rastreabilidade: de onde veio a atividade/hospedagem.
alter table public.activities
  add column if not exists from_entry_id uuid,
  add column if not exists from_poll_id uuid references public.polls (id) on delete set null;
alter table public.activities add constraint activities_from_entry_fk
  foreign key (from_entry_id, trip_id) references public.journal_entries (id, trip_id) on delete set null (from_entry_id);
create unique index activities_from_entry_uniq on public.activities (from_entry_id) where from_entry_id is not null;

alter table public.stays
  add column if not exists from_poll_id uuid references public.polls (id) on delete set null;

alter table public.notification_prefs
  add column if not exists poll_reminders boolean not null default true;
```

> Se o `on delete set null (coluna)` com FK composta autorreferente der problema no PGlite dos testes, troque por gatilho equivalente; o comportamento é o que importa.

### 4.2 Gatilhos de integridade

- `inspiration_votes` (before insert/update): a entrada precisa ter `kind = 'inspiracao'` (erro `22023`, "Só dá pra reagir a inspirações"); `user_id` precisa ser membro (`require_trip_member`). Atualiza `updated_at`.
- `poll_options` (before insert/update/delete): se a enquete está `closed`, recusa (`P0001`, "Enquete encerrada"). Se a opção já tem voto, recusa **update** de `label` e **delete** (`P0001`, "Esta opção já tem votos"). Inserir opção nova em enquete aberta é permitido. Máximo de 6 opções por enquete (`22023`).
- `polls` (before update): `status`, `decided_option_id`, `decided_by` e `decided_at` só mudam dentro de `close_poll` (ver 4.4). Garanta isso com privilégio de coluna: `grant update (question, detail, closes_at, multi, version, updated_at) on public.polls to authenticated`. `multi` e `target` não mudam depois do primeiro voto (erro `P0001`).
- Membro removido (after delete em `trip_members`, `security definer`): apaga os `poll_votes` e `inspiration_votes` dessa pessoa naquela viagem. Enquetes criadas por ela continuam (o organizador decide).

### 4.3 RLS

| Tabela | select | insert | update | delete |
|---|---|---|---|---|
| `inspiration_votes` | `is_trip_member(trip_id)` | `user_id = auth.uid() and is_trip_member(trip_id)` | idem | `user_id = auth.uid()` |
| `polls` | `is_trip_member(trip_id)` | `can_edit_trip(trip_id) and created_by = auth.uid()` | `status = 'open' and (created_by = auth.uid() or is_trip_organizer(trip_id))` | `created_by = auth.uid() or is_trip_organizer(trip_id)` |
| `poll_options` | `is_trip_member(trip_id)` | `can_edit_trip(trip_id) and created_by = auth.uid()` | sem grant de update (opção é imutável; para corrigir, apague e crie se ainda não tem voto) | `can_edit_trip(trip_id)` |
| `poll_votes` | `is_trip_member(trip_id)` | **sem grant**: só via `cast_vote` | **sem grant** | **sem grant**: só via `cast_vote` |

`viewer` grava apenas `inspiration_votes` (direto) e `poll_votes` (via RPC). Nada mais muda para o `viewer`.

### 4.4 RPCs

Todas com `set search_path = ''`, mensagens em pt-BR, `grant execute ... to authenticated`, e incluídas no bloco de `grant execute` final como nas migrations anteriores.

**`cast_vote(p_poll uuid, p_options uuid[]) returns void`** · `security definer`
1. `auth.uid()` não nulo e `is_trip_member` da viagem da enquete (`42501`).
2. Enquete `open` e (`closes_at is null or closes_at > now()`) (`P0001`, "Votação encerrada").
3. Todas as opções pertencem à enquete (`22023`).
4. `multi = false` ⇒ exatamente 1 opção; `multi = true` ⇒ de 1 até o total de opções. Array vazio = **retirar voto** (permitido).
5. Na mesma transação: apaga os votos da pessoa nessa enquete e insere os novos com `user_id = auth.uid()`.

**`close_poll(p_poll uuid, p_option uuid, p_day date default null, p_apply boolean default true) returns jsonb`** · `security definer`
1. Quem chama é `created_by` da enquete ou `organizer` (`42501`). Enquete `open` (`P0001`). Opção pertence à enquete (`22023`).
2. Grava `status = 'closed'`, `decided_option_id`, `decided_by = auth.uid()`, `decided_at = now()`.
3. Se `p_apply` e `target = 'stay'`:
   - se a parada já tem hospedagem `booked`: não mexe nela; retorna `{"applied": false, "reason": "stay_booked"}`;
   - se tem hospedagem `pending`: atualiza `name`, `address`, `notes` (detalhe + link), `from_poll_id`;
   - senão: insere `stays` com `status = 'pending'`, `checkin_date = arrival_date` e `checkout_date = departure_date` da parada, `from_poll_id`.
4. Se `p_apply` e `target = 'activity'`: insere `activities` com `title = label`, `notes` (detalhe + link), `day = coalesce(p_day, arrival_date da parada)`, `position` no fim do dia, `suggested_by = null`, `from_poll_id`. `p_day` fora das datas da parada ⇒ `22023`.
5. Retorna `{"applied": bool, "reason": text|null, "stay_id"|"activity_id": uuid|null}`.

Como é `security definer`, faça os checks de papel explicitamente antes de qualquer escrita.

**`promote_inspiration(p_entry uuid, p_stop uuid, p_day date, p_time time default null) returns uuid`** · `security invoker`
1. `can_edit_trip` (a política de `activities` já garante; deixe a mensagem humana).
2. Entrada `kind = 'inspiracao'` (`22023`). Já existe atividade com `from_entry_id = p_entry` ⇒ `23505` (o app mostra "Isso já existe.", via `humanError`).
3. `p_day` entre `arrival_date` e `departure_date` da parada (`22023`).
4. Insere `activities` com `title = coalesce(title, place_name, 'Inspiração')` (cortado em 160), `notes` = corpo + link (cortado em 2000), `from_entry_id`, `position` no fim do dia. Se a inspiração não tinha `stop_id`, grava `p_stop` nela.
5. Retorna o id da atividade.

---

## 5. Tipos e camada de dados

`src/data/types.ts`:

```ts
export type InspirationValue = -1 | 1 | 2;
export interface InspirationVote { entry_id: string; trip_id: string; user_id: string; value: InspirationValue; updated_at: string }
export type PollTarget = 'stay' | 'activity' | 'free';
export interface Poll extends Versioned {
  trip_id: string; question: string; detail: string | null; target: PollTarget; stop_id: string | null;
  multi: boolean; closes_at: string | null; status: 'open' | 'closed';
  decided_option_id: string | null; decided_by: string | null; decided_at: string | null; created_by: string;
}
export interface PollOption {
  id: string; poll_id: string; trip_id: string; label: string; detail: string | null; link_url: string | null;
  price: string | number | null; currency: string | null; address: string | null; position: number;
  created_by: string; created_at: string;
}
export interface PollVote { poll_id: string; option_id: string; trip_id: string; user_id: string; created_at: string }
```

- `Activity` ganha `from_entry_id: string | null` e `from_poll_id: string | null`; `Stay` ganha `from_poll_id: string | null`.
- `TripBundle` ganha `polls`, `pollOptions`, `pollVotes`, `inspirationVotes`.
- `TableName` e `BUNDLE_KEYS` recebem as 4 tabelas.
- `supabaseSource.ts`: as 4 tabelas em `CHILD_TABLES` (ordem: polls por `created_at desc`, options por `position`) e em `REALTIME_TABLES`.
- `demoSource.ts`: implementar `cast_vote`, `close_poll` e `promote_inspiration` dentro de `rpc` com as mesmas validações e mensagens (inclusive lançar erro para opção de outra enquete e para votar com prazo vencido). Bundles antigos no IndexedDB podem não ter os campos novos: trate ausência como `[]` onde o bundle é lido do cache (veja `offline.ts`).
- `lib/demo/demo.data.ts` / `build.ts`: em pelo menos uma das 4 trilhas de demonstração, uma enquete aberta de hospedagem com 3 opções e votos de 2 pessoas, uma enquete encerrada de passeio já aplicada, e reações em 2 inspirações.

### 5.1 `src/lib/polls.ts` (novo, puro, com testes)

```ts
tallyPoll(b, pollId): { optionId: string; votes: number; voters: string[] }[]   // ordenado por votos desc, depois position
pollWinners(b, pollId): string[]                                                // ids empatados no topo ([] sem votos)
pollState(b, pollId, now = Date.now()): 'open' | 'awaiting_decision' | 'closed' // awaiting = prazo passou e ainda open
votersCount(b, pollId): { voted: number; total: number }                        // total = membros atuais
myPendingVotes(b, me, now = Date.now()): Poll[]                                 // abertas, no prazo, sem voto meu
inspirationScore(b, entryId): { score: number; muito: string[]; topo: string[]; passo: string[] } // score = soma dos values
```

Votos de quem não é mais membro são ignorados na contagem (defesa extra além do gatilho).

---

## 6. Interface

Use os componentes e classes existentes (`card`, `btn`, `chip`, `pill`, `Dialog`, `useAction`, `useConfirm`, `useToast`, `MotifCheck`, `AiNote` não se aplica). Nenhuma cor fixa: só variáveis do tema. Tudo acessível por teclado, alvos ≥ 44px, `aria-pressed` nas reações, contagens com texto (não só cor).

### 6.1 Diário · aba Antes (`src/screens/Diario.tsx`)

Em cada inspiração do `EntryList` (só quando `kind === 'inspiracao'`):
- Três botões de reação: **Quero muito**, **Topo**, **Passo**, com a contagem ao lado e `aria-pressed` no que eu marquei. Clicar no já marcado retira a reação. Visíveis para todos os membros, inclusive `viewer`.
- Linha mono com quem reagiu (iniciais com `title` do nome).
- Se já virou atividade: pílula **NO ROTEIRO · {dia}** que leva a `/t/{id}/roteiro?parada={stopId}`.
- Se não virou e `canEdit`: botão **Levar pro roteiro** → diálogo com parada (pré-selecionada se a inspiração tem), dia (`<select>` com os dias da parada; padrão: primeiro dia sem atividade, senão o primeiro), horário opcional. Sucesso: toast "Foi pro roteiro de {parada}."

No `DiaryCard` da aba Antes, abaixo do texto: "{n} inspirações · mais querida: {título}" quando houver reações. Dentro do diálogo da parada, inspirações ordenadas por `score` desc.

O `canEdit` atual esconde ações para o `viewer`; as reações **não** podem depender de `canEdit`, só de ser membro e não estar na demonstração com bloqueio.

### 6.2 Turma · seção Decisões (`src/screens/Turma.tsx`)

Nova seção com `id="decisoes"` acima de "Convidar" na coluna principal (no mobile, logo depois da lista de membros):
- Cabeçalho "Decisões" + botão **Nova votação** (só `canEdit`).
- Lista de cards: abertas primeiro (prazo mais próximo no topo), depois "Aguardando decisão", depois encerradas (colapsadas em "Encerradas ({n})").
- **Card de enquete aberta**: pergunta (display 22 a 26px), detalhe, pílula do alvo (HOSPEDAGEM · {PARADA} / PASSEIO · {PARADA} / LIVRE), prazo em mono ("ATÉ 18 JAN 23:59" no fuso `departure_tz`), "{x} de {y} votaram". Cada opção: `MotifCheck` (rádio quando `multi = false`, checkbox quando `true`), rótulo, detalhe, preço formatado ("R$ 240 / noite" se a pessoa escreveu no detalhe; o campo `price` mostra só valor e moeda), link abre em nova aba (`noopener noreferrer nofollow`), barra horizontal proporcional aos votos na cor do ciclo, avatares de quem votou. Botão **Votar** / **Mudar voto** / **Retirar voto**.
- **Aguardando decisão** (prazo passou): votação desabilitada com texto "Prazo encerrado. {Nome} decide." Para quem pode decidir, botão **Decidir**.
- **Decidir** (diálogo): opções com votos, a mais votada pré-selecionada; empate mostra "Empate entre A e B. Você desempata."; escolher opção menos votada mostra aviso "Essa não foi a mais votada." Para `target = 'activity'`, campo de dia. Checkbox **Aplicar no roteiro** (marcado; desmarcar = só registrar). Confirmar chama `close_poll`. Retorno `stay_booked` mostra toast "Decidido. {Parada} já tem hospedagem reservada, então nada foi trocado."
- **Encerrada**: opção vencedora destacada, "Decidido por {nome} em {data}", link para o item criado no roteiro.
- Editar (pergunta, detalhe, prazo) e excluir: só quem criou ou organizador, só enquanto aberta. Excluir pede `useConfirm`.

**Nova votação** (diálogo): pergunta, detalhe opcional, tipo (Hospedagem · Passeio · Livre), parada (obrigatória para hospedagem e passeio), "Cada pessoa pode marcar mais de uma" (switch), prazo opcional (data + hora), 2 a 6 opções (rótulo obrigatório; detalhe, link, preço+moeda; endereço só em hospedagem). Validações no cliente espelhando os `check` do banco. Inserir enquete e opções: gere os ids no cliente e insira com `returning: false`, como o resto do app; se a inserção das opções falhar, apague a enquete (sem órfãos).

O texto de introdução da Turma passa a ser: "Quem viaja junto. Organizador administra; editores mexem no conteúdo; leitores consultam e votam."

### 6.3 Roteiro (`src/screens/Roteiro.tsx`)

- No detalhe da parada, se houver enquete aberta ou aguardando com `stop_id` dela: chip **{n} votação aberta** que leva a `/t/{id}/turma#decisoes`.
- Em "Onde durmo", hospedagem com `from_poll_id`: linha mono "ESCOLHIDA NA VOTAÇÃO".
- Atividades com `from_entry_id` ou `from_poll_id`: marcador pequeno ("DA INSPIRAÇÃO" / "DA VOTAÇÃO").

### 6.4 Início (`src/screens/Home.tsx`)

No bloco "Antes de embarcar", antes dos alertas, um item por enquete de `myPendingVotes(b, me)`: "Falta seu voto: {pergunta}" com CTA **Votar** para `/t/{id}/turma#decisoes`. Para quem pode decidir, um item por enquete em `awaiting_decision`: "Hora de decidir: {pergunta}". Não criar `tasks` no banco para isso (é por pessoa e derivado).

### 6.5 Conta (`src/app/conta/page.tsx`)

Nas preferências de notificação, novo interruptor **Lembretes de votação** ligado a `notification_prefs.poll_reminders`.

### 6.6 Microcopy

| Situação | Texto |
|---|---|
| Sem enquetes | "Nada pra decidir agora. Quando tiver dúvida entre opções, abre uma votação." |
| Votou | toast "Voto registrado." |
| Retirou | toast "Voto retirado." |
| Offline | (mensagem padrão do `OfflineError`) |
| Viewer na Turma | o viewer vê a seção e vota; não vê "Nova votação" |
| Demonstração | votar, decidir e promover funcionam em memória; nada é salvo (mesmo padrão das outras telas) |

---

## 7. Notificações (`src/app/api/cron/daily/route.ts`)

Respeitando `poll_reminders`, no máximo 4 mensagens por pessoa como hoje:
- Enquete aberta com `closes_at` nas próximas 24h e sem voto da pessoa: título "{trip}: falta seu voto", corpo a pergunta, `url: /t/{id}/turma#decisoes`, `tag: poll-{pollId}`.
- Enquete `open` com prazo vencido, para quem criou e organizadores: "{trip}: hora de decidir", `tag: poll-decide-{pollId}`.

Buscar `polls`, `poll_options` (só ids) e `poll_votes` das viagens já carregadas, com a admin key como o resto da rotina.

## 8. Analytics

Via `lib/analytics.ts` (só com opt-in): `poll.created` (`{target, options}`), `poll.voted`, `poll.closed` (`{applied, tie}`), `inspiration.reacted` (`{value}`), `inspiration.promoted`. Nenhum texto do usuário nas props.

---

## 9. Arquivos que serão tocados

| Arquivo | Mudança |
|---|---|
| `supabase/migrations/20261011000007_votes.sql` | novo (seção 4) |
| `src/data/types.ts` | tipos, `TripBundle`, `TableName`, `BUNDLE_KEYS` |
| `src/data/supabaseSource.ts` | `CHILD_TABLES`, `REALTIME_TABLES` |
| `src/data/demoSource.ts` | 3 RPCs em memória |
| `src/data/offline.ts` | bundle antigo sem campos novos |
| `src/lib/polls.ts` | novo |
| `src/lib/demo/*` | dados de exemplo |
| `src/screens/Diario.tsx`, `diario.module.css` | reações e "Levar pro roteiro" |
| `src/screens/Turma.tsx` (+ CSS module novo se precisar) | seção Decisões e diálogos |
| `src/screens/Roteiro.tsx` | chip e marcadores |
| `src/screens/Home.tsx` | pendências de voto |
| `src/app/conta/page.tsx` | preferência |
| `src/app/api/cron/daily/route.ts` | lembretes |
| `tests/db/rls.test.ts` (ou `tests/db/votes.test.ts`) | seção 10 |
| `tests/unit/polls.test.ts` | novo |
| `tests/e2e/demo.spec.ts` | fluxo da demo |
| `README.md` | ordem das migrations atualizada (inclui 0004 a 0007) |
| `docs/CHECKLIST.md` | linhas novas (seção 11) |

---

## 10. Testes obrigatórios

**Banco (PGlite, mesmo harness de `tests/db/rls.test.ts`, com Ana organizadora, Bia editora, Léo viewer, Zé terceiro):**
1. Léo (viewer) vota numa enquete e reage a uma inspiração.
2. Léo não cria enquete, não cria opção, não promove inspiração, não fecha enquete.
3. Zé não lê enquetes, opções, votos nem reações, e `cast_vote` recusa.
4. Ninguém insere em `poll_votes` direto (sem grant); ninguém vota em nome de outra pessoa.
5. `cast_vote` recusa: opção de outra enquete; 2 opções em enquete `multi = false`; enquete fechada; prazo vencido.
6. `cast_vote` com array vazio retira o voto; votar de novo substitui.
7. Opção com voto não pode ser apagada nem ter o rótulo alterado; enquete fechada não aceita opção nova; sétima opção é recusada.
8. Bia não fecha enquete criada pela Ana; Ana (organizadora) fecha enquete criada pela Bia.
9. `close_poll` com `target = 'stay'`: sem hospedagem cria `pending`; com `pending` atualiza; com `booked` não mexe e retorna `stay_booked`.
10. `close_poll` com `target = 'activity'` e dia fora da parada é recusado.
11. Ninguém muda `status`/`decided_*` por `update` direto.
12. `promote_inspiration`: cria atividade com `from_entry_id`; segunda vez dá `23505`; entrada `registro` é recusada.
13. Reação em entrada `registro` é recusada.
14. Remover Léo da viagem apaga os votos e reações dele.

**Unitários (`tests/unit/polls.test.ts`):** apuração simples e múltipla, empate, `pollState` antes e depois do prazo, `myPendingVotes` ignora fechadas, vencidas e já votadas, voto de ex-membro ignorado, `inspirationScore`.

**e2e (demo):** reagir a uma inspiração e ver a contagem; levar inspiração ao roteiro e ver a atividade na parada; votar na enquete da demo; decidir e ver a hospedagem "ESCOLHIDA NA VOTAÇÃO" no roteiro; navegação só por teclado no card de votação; sem rolagem horizontal em 360/390/768/1280/1440 na Turma.

## 11. Critérios de aceite

- [ ] Viewer vota e reage; não faz nenhuma outra escrita nova.
- [ ] Todas as regras da seção 4 valem no banco (testes 1 a 14 passando).
- [ ] Decidir uma enquete de hospedagem gera hospedagem pendente e o alerta "sem reserva" existente passa a aparecer para ela.
- [ ] Levar inspiração ao roteiro cria a atividade no dia escolhido, com o vínculo visível nos dois lados.
- [ ] Votos aparecem para as outras pessoas sem recarregar (Realtime).
- [ ] Início mostra "Falta seu voto" só para quem não votou.
- [ ] Offline: tudo é lido do cache; ações mostram a mensagem de offline e nada quebra.
- [ ] Demonstração funciona sem Supabase.
- [ ] `npm run typecheck`, `npm test` e `npm run build` passam; e2e da demo passa.
- [ ] Contraste e foco visível nas 4 identidades; Lighthouse a11y da Turma ≥ 95.
- [ ] `docs/CHECKLIST.md` atualizado com uma linha por critério, no mesmo formato (status honesto: só ✅ com verificação).

## 12. Ordem de entrega

Entregue em 3 fases. Ao fim de cada uma: `npm run typecheck && npm test && npm run build`, atualizar o `CHECKLIST.md` e parar para revisão antes da próxima.

1. **Fase 1 · Termômetro e promover inspiração**: `inspiration_votes`, colunas `from_entry_id`, `promote_inspiration`, tipos, fontes de dados, Diário, marcador no Roteiro, testes 1 (parte de reação), 12, 13, 14 e unitário de `inspirationScore`.
2. **Fase 2 · Enquetes**: `polls`, `poll_options`, `poll_votes`, `cast_vote`, `close_poll`, `lib/polls.ts`, Turma, chip e marcadores no Roteiro, demo, demais testes de banco e e2e.
3. **Fase 3 · Lembretes**: Início, preferência na Conta, cron, analytics.

A migration pode ser uma só (`…0007_votes.sql`) escrita na fase 1 e completada na fase 2, desde que ainda não tenha sido aplicada no projeto real. Se já tiver sido aplicada, a fase 2 vai numa migration nova (`…0008`). Nunca edite migration já aplicada no Supabase.
