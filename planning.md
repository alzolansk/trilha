# planning.md — Trilha 2.0: implementar o novo design no app existente

## Contexto

O dono do produto testou o Trilha e não sente vontade de usar. Os motivos:

- Explorar é opcional e ninguém abre a aba.
- Passeios e bairros ficam escondidos no roteiro.
- Os links de hotel só abrem a página inicial do site.
- O orçamento não conversa com o roteiro.
- O caixa da turma não mexe no orçamento.
- O visual rústico (grão, sombras duras, motivos) não agrada.

Por isso foi feito um redesign completo, publicado como canvas em https://claude.ai/artifact/7NwQ6QpbZmuYb3GzDvYpVC. Ele tem 8 artboards, descritos na seção 2.

Este plano implementa esse design **no app Next.js atual**:
- No celular, ele deve parecer e se comportar como um app.
- No desktop, continua responsivo.
- O app nativo vem depois e reaproveita as decisões daqui. Por isso os componentes e regras de dados ficam desacoplados de CSS e de rotas sempre que possível.

**Decisões já tomadas**

1. **Identidade por destino vira uma cor só.** O app inteiro usa o visual novo, fixo. Cada trilha guarda apenas `accent`, uma cor de destaque usada na capa sem foto e em pequenos detalhes. Saem paletas de 11 cores, padrões, motivos, recortes, paisagens geradas, fontes por destino, grão e a página `/identidades`.
2. **Fotos vêm da Wikipedia/Wikimedia Commons, com upload como alternativa.** Sempre mostrar autor e licença. Sem foto, cai num placeholder ilustrado na cor `accent`. A turma pode trocar qualquer foto por uma própria.
3. **Continuam valendo as regras de honestidade da IA** (`ref/SPEC.md` §9.1 e §13, `lib/ai/prompts.ts`):
   - preço é sempre **faixa com rótulo ESTIMATIVA**;
   - não citar nome de hotel;
   - não dizer que reservou ou verificou nada;
   - dado sensível só com fonte oficial.
   Os valores únicos do canvas (ex.: "R$ 6.470") são **dados de exemplo**. No app real, estimativa aparece como faixa ou como "≈ valor médio" com o selo ESTIMATIVA. Valor confirmado pela turma aparece sem selo.
4. **Sem fila de escrita offline.** Fica como hoje: escrever exige internet (`ensureOnline`), e ler funciona com cache.
5. `ref/SPEC.md` continua valendo para dados, segurança, IA e acessibilidade. **Para visual, navegação e telas, valem este planning e o canvas.** A Fase 0 adiciona essa nota no topo do SPEC.

> **Atenção (AGENTS.md):** este Next.js 16 tem APIs diferentes das conhecidas. Antes de mexer em rotas, layouts, `redirects`, metadata ou viewport, leia o guia correspondente em `node_modules/next/dist/docs/`.

---

## Status da implementação (atualizado em 08/11/2026)

| Fase | Status | Onde |
|---|---|---|
| 0 — Preparação | ✅ concluída | nota de precedência no `ref/SPEC.md`, link no README, linha de base registrada |
| 1 — Fundação visual | ✅ concluída (com ressalvas abaixo) | branch `docs/planning-redesign` |
| 2 — Shell e navegação | ✅ concluída (com ressalvas abaixo) | branch `docs/planning-redesign` |
| 3 — Dados e serviços base | ✅ concluída (com ressalvas abaixo) | branch `docs/planning-redesign` |
| 4 — Início | ✅ concluída (com ressalvas abaixo) | branch `docs/planning-redesign` |
| 5 — Roteiro e página da parada | ✅ concluída (com ressalvas abaixo) | branch `docs/planning-redesign` |
| 6 — Dinheiro | ✅ implementada e validada localmente (ressalvas abaixo; validação remota pendente) | branch `docs/planning-redesign` |
| 7 — Turma | ✅ implementada e validada localmente (ressalvas abaixo; validação remota pendente) | branch `docs/planning-redesign` |
| 8 — Descobrir e nova trilha | ✅ implementada e validada localmente (ressalvas abaixo; validação com IA/Supabase pendente) | branch `docs/planning-redesign` |
| 9 — Polimento, PWA, acessibilidade e testes | ✅ parcialmente concluída (Lighthouse e aparelho real pendentes; ressalvas abaixo) | branch `docs/planning-redesign` |
| 10 — Onboarding roteirizado | ✅ implementada e validada localmente (ressalvas abaixo; IA real e Supabase remoto pendentes) | branch `docs/planning-redesign` |

**Verificação da Fase 8 (08/11/2026):** `npx tsc --noEmit` ok; `npm test` com **208/208** (entraram 5 em `tests/unit/discover.test.ts`; saíram os testes de gerador/validação/fendas de identidade); `npm run build` ok; `npx playwright test` **46/46** (entraram 2 do Descobrir). Uma execução completa teve 1 falha intermitente em `money.spec.ts:4` (`pool-balance`, tela que a Fase 8 não toca); o arquivo passou 6/6 isolado e a suíte voltou a passar. **Nenhuma migration nova**: `trip_preferences` já vem da `00008`. Comparação visual com `Descobrir.dc.html`/PDF **não feita**.

**Verificação da Fase 7 (08/11/2026):** `npx tsc --noEmit`, `npm test` (211/211) e `npm run build` ok; `npx playwright test` passou **45/45** contra o build de produção (os testes de voto passaram a abrir `/turma/votos`; entraram 3 do hub: conteúdo/navegação, sem rolagem horizontal de 360 a 1440 px e o campo "Quem leva" na Mala). **Nenhuma migration nova**: `packing_items.assignee_id` já vem da `00008`. A comparação visual com `Turma.dc.html`/PDF **não foi feita nesta execução**.

**Verificação da Fase 6 (08/11/2026):** `npm run typecheck` e `npm run build` ok; `npm test` com **211/211 testes** (unitários e banco PGlite). `npx playwright test` passou **41/41** contra o build de produção; depois, a suíte financeira ganhou a conferência do selo pago no Roteiro e o teste de lembretes/CSV, e `npx playwright test tests/e2e/money.spec.ts --timeout=30000` passou **6/6**. São 42 cenários E2E na base atual (36 anteriores + 6 financeiros). Capturas de Dinheiro e Orçamento conferidas em **390 e 1280 px** contra as páginas 6 e 7 de `ref/Trilha — nova proposta.pdf`; as quatro telas financeiras foram testadas sem rolagem horizontal em 360, 390, 768, 1280 e 1440 px. O PDF foi usado como referência visual; os valores financeiros já existentes na demo foram preservados.

**Para usar a Fase 6 com dados reais, aplicar também `supabase/migrations/20261108000009_money.sql`, após a `00008`.** Ela cria `close_budget`, restringe aportes/devoluções pelo papel e confirma a estadia pendente no mesmo salvamento do gasto ligado. Esta execução **não aplicou migrations no Supabase remoto**. Sem a `00009`, fechar orçamento falha por RPC ausente e as novas garantias do caixa ainda não existem no banco remoto.

**Verificação ao fim da Fase 5:** `npm run typecheck` ok; `npm test` com 196 testes verdes (eram 181: entraram 15 em `tests/unit/route.test.ts`); `npm run build` ok; `npx playwright test` com 36 de 36 verdes contra o build de produção (entraram 9 da Fase 5 e `/roteiro?vista=mapa` no teste de rolagem; os testes que usavam `?parada=` e o botão `CUZ` foram atualizados). `/demo/andes/roteiro` e `/demo/andes/roteiro/<Cusco>` conferidos em 390 e 1280 px contra `Roteiro.dc.html` e `Parada.dc.html`, sem rolagem horizontal de 360 a 1440 px.

**Verificação ao fim da Fase 4:** `npm run typecheck` ok; `npm test` com 181 testes verdes (eram 143: entraram 18 de banco em `tests/db/redesign.test.ts` e 20 unitários em `tests/unit/redesign.test.ts`); `npm run build` ok; `npx playwright test` com 27 de 27 verdes contra o build de produção (saíram os 2 testes da história de scroll e entraram 5 da Início); `/demo/andes` conferida em 390 e 1280 px contra `Inicio.dc.html`, sem rolagem horizontal. As Fases 3 e 4 também foram feitas juntas, na mesma branch das anteriores.

**Para testar com dados reais é obrigatório aplicar a migration `supabase/migrations/20261108000008_redesign.sql`** no projeto Supabase (SQL Editor ou `supabase db push`). Sem ela, a leitura continua funcionando (colunas novas são opcionais e as tabelas novas estão marcadas `optional`), mas estas escritas falham com erro de coluna: escolher a cor em Ajustes e "Adicionar ao roteiro" no `StopSuggestions` (que agora grava `cost_cents`).

**Verificação ao fim da Fase 2:** `npm run typecheck` ok; `npm test` com 143 testes verdes (a linha de base era 139; entraram 4 de accent); `npm run build` ok; `npx playwright test` com 24 de 24 verdes contra o build de produção; conferência manual em `/demo/andes` com 360, 390, 768, 1280 e 1440 px, sem rolagem horizontal. As Fases 1 e 2 foram feitas juntas na mesma branch, a pedido; não houve um PR por fase.

### Ressalvas de handoff: Fase 1

- **Compatibilidade com as telas antigas.** `globals.css` tem os tokens novos (§3.1) e um bloco marcado "compatibilidade". Ele mantém as classes antigas (`.btn`, `.chip`, `.card`, `.field`, `.page-title`, `.check`, `.pill`, `.ticket` etc.) com o visual novo, e os aliases de variáveis antigas (`--acc`, `--acc2`, `--card`, `--soft`, `--deep`, `--font-display`, `--font-mono`…) apontando para os tokens novos. É isso que deixa as telas antigas abrirem. Cada fase que redesenhar uma tela deve parar de usar essas classes; a limpeza final fica na Fase 9.
- **`lib/identity/` foi reduzida só em parte.** Saíram `theme.ts`, `IdentityCard`, `/identidades`, `Grain`, `grain.png`, `Pattern`, `Marquee`, `Floaters` e `MotifCheck` (que virou `ui/Checkbox`). Ficam por enquanto `render.ts`, `shapes.ts`, `fontmap.ts`, `generate.ts`, `validate.ts` e o `dictionary.data.ts` completo, porque ainda são usados pela história de scroll da Home antiga (sai na **Fase 4**), pelo passo de identidade de `/nova-trilha` e por `api/ai/identity` (saem na **Fase 8**). `TripContext` ainda expõe `identity`, marcado `@deprecated`; o substituto é `accent`.
- **`accent` ainda não tem coluna.** `tripAccent()` (`lib/identity/accent.ts`) segue esta ordem: `trips.accent` (quando a Fase 3 criar a coluna), depois a cor do dicionário ou da identidade antiga, depois o padrão `#2B3FF5`. Em Ajustes, a seção "Aparência" só mostra a cor atual; o seletor das 8 cores (`ACCENT_CHOICES`, já testadas para contraste) entra junto com a coluna. A Fase 3 deve fazer o backfill a partir de `DICTIONARY_ACCENT`/`identity->palette->acc`, passando por `safeAccent`.
- **Fontes.** Inter e Bricolage entram como fontes variáveis, sem lista de pesos: com `weight: [...]`, o Turbopack deste ambiente falhou com "next/font/google queries have exactly one entry".
- **Ícones.** Entraram `route`, `back`, `next`, `close`, `info`, `more`, `lock`, `list`, `minus` e `settings`, e o traço padrão passou a 2 px. Os ícones antigos não foram redesenhados um a um.
- **Componentes.** Os componentes da §3.3 estão em `src/components/ui/`, cada um com seu CSS Module, e são exportados por `ui/index.ts`. O `Dialog` de `feedback.tsx` virou alias do `Sheet` (mesma API), então todos os formulários já abrem como bottom sheet. Componentes ainda sem uso em tela real: `Photo` com foto de verdade (a `/api/photos` chega na Fase 3), `SuggestionCard`, `StepChat`, `MoneyInput`, `Segmented` e `PhotoCard`. Estão todos na vitrine.
- **`/dev/ui`.** A vitrine só funciona em desenvolvimento (em produção responde 404). A imagem de exemplo é um arquivo local identificado como tal, porque este ambiente não alcança a Wikimedia. A conferência contra `Main.dc.html` foi feita por screenshot em 390 e 1280 px: paleta, tipografia, botões e chips batem; não é comparação pixel a pixel.
- **Placeholder de foto.** As silhuetas usam `color-mix()` sobre `--trip-accent`.
- **Modo escuro.** Continua fora do escopo. Os componentes novos usam só tokens.

### Ressalvas de handoff: Fase 2

- **`/roteiro/[stopId]` é temporária.** Hoje ela redireciona para `/roteiro?parada=X` (`screens/Parada.tsx`), o contrário do que pede a §4.3. Na **Fase 5**, a `Parada` real ocupa a rota e o `Roteiro` passa a fazer `router.replace` de `?parada=X` para `/roteiro/X`.
- **Telas temporárias nas rotas novas.** `Dinheiro`, `Orcamento`, `Extrato`, `Acerto` e `Votos` (em `src/screens/`) só embrulham pedaços que agora são exportados de `Mala.tsx` (`Budget`, `Pool`, `StopSpend`, `Converter`, `Debts`, `ExpenseList`) e de `Turma.tsx` (`Decisions`). Esse era o estado ao fim da Fase 2. **Atualização da Fase 6:** os quatro wrappers financeiros foram substituídos e os pedaços de dinheiro removidos de `Mala.tsx`; a **Fase 7** (concluída) trocou `TurmaHub` e `Votos`.
- **`/turma` ainda é a tela Turma antiga**, agora com uma lista de atalhos para Votos, Documentos, Mala, Diário, Ajustes e Conta, que saíram da navegação principal. `Decisions` continua em `/turma`, porque links existentes (`plan.ts`, push de `polls.ts`) usam `/turma#decisoes` e `#nova-votacao`. **Atualização da Fase 7:** os links (`plan.ts`, `polls.ts`, `suggestions.ts`, `Explorar`, `PlanningHome`) agora apontam para `/turma/votos`; a antiga âncora `/turma#decisoes` não existe mais (push já enviados com ela caem em `/turma`).
- **Topo da Início no celular.** ✅ Resolvido na Fase 4: o seletor e a `AvatarStack` estão dentro do hero de `Inicio.tsx`, e o bloco `homeTop` saiu do shell.
- **`OfflineBanner`** continua em `AppProviders`, que é global e cobre também `/entrar`, `/conta` etc. Não foi para o `TripShell`.
- **Sheet e o botão Voltar.** O Sheet empurra uma entrada no histórico (`history.pushState`, integrado ao router do Next 16) e a remove ao fechar. Um clique em link interno dentro do Sheet é detectado e não chama `back()`. Se uma ação chamar `router.push` logo depois de fechar o Sheet, sobra uma entrada extra no histórico: inofensiva, mas pede um Voltar a mais. O diálogo de confirmação usa `closeOnBack={false}`. Ainda não existe fechar o Sheet arrastando para baixo.
- **TabBar.** A lista `HIDE_TABBAR` em `TripShell.tsx` já esconde a barra em `/dinheiro/orcamento`; cada subtela com CTA fixa deve entrar nessa lista. A posição de rolagem de cada aba fica guardada em memória por rota e se perde ao recarregar a página.
- **SideNav.** Além de Conta e Nova trilha, o rodapé tem "Ajustes da trilha", que não está na §4.2. Na demo, mostra "Criar trilha real", "Entrar" e o selo de demonstração.
- **Redirects** em `next.config.ts` usam 307 de propósito, porque as rotas ainda podem mudar até a Fase 9. Trocar para 308 no fim.
- **Faixa de cópia salva.** Ela mostra a hora: `saveBundle` agora grava `saved-at:<tripId>` no IndexedDB, e `TripContext` expõe `staleSince`.
- **`sw.js`** usa as rotas novas no `warmTripPages`. Na Fase 3 foi para `v3`, com o cache da Wikimedia. Os comentários do arquivo tinham caracteres corrompidos (texto em UTF-8 lido como cp1252) e foram corrigidos.
- **Testes e2e.** Os testes de tokens por identidade viraram testes de accent; entraram testes de abas, redirects e Voltar fechando o Sheet; as rotas foram atualizadas. Os testes da "história de scroll do Início" saíram na Fase 4. No `next dev`, o teste de reduced motion falha por tempo de hidratação; no build de produção ele passa.
- **Ambiente.** Neste sandbox, `/api/fx` (conversor) responde 502 por falta de rede externa. Isso já acontecia antes destas fases.

### Ressalvas de handoff: Fase 3

- **Migration `20261108000008_redesign.sql`.** Tudo da §7, aditivo. Decisões tomadas na implementação:
  - **`trips.accent`:** o backfill usa a cor curada para as identidades do dicionário (andes, japão, marrocos, islândia) e o `identity->palette->acc` só quando ele passa 3:1 com branco (função `hex_luminance`). O resto fica `null`, que significa "automática": o app calcula com `tripAccent()`/`safeAccent()`, escurecendo em OKLCH. Não força `#2B3FF5`.
  - **`budget_categories.kind`:** backfill pelo nome (`budget_kind_of`) e um gatilho `default_budget_kind` que preenche o tipo pelo nome quando o insert não manda `kind`. Assim `/nova-trilha` e o app atual continuam criando categorias certas sem mudar o código. No app, `categoryKind()` também cai no nome quando `kind` falta ou é `outro`.
  - **Vínculo gasto ↔ item:** `unique (id, trip_id)` novos em `activities`, `stays` e `transports`; FKs compostas com `on delete set null`; check de no máximo um vínculo. `save_expense` aceita `activity_id`/`stay_id`/`transport_id` e recusa item de outra trilha com mensagem humana.
  - **`suggestions`:** membros leem; **só organizador/editor muda status, inclusive dispensar**. O leitor não dispensa, nem só para si: isso exigiria uma tabela por pessoa e foi deixado de fora. `acted_by`/`acted_at` são carimbados pelo gatilho `stamp_suggestion` (o cliente não escolhe). Ao apagar a parada, as sugestões dela saem em cascata.
  - **`trip_preferences`:** todos da trilha leem (o Descobrir mostra o que a turma quer); cada um grava só a própria linha; sai junto quando a pessoa deixa a trilha.
  - **`trip_members.pool_target_cents`:** segue a política atual de `trip_members`, então só o organizador edita.
  - **`packing_items.assignee_id`:** precisa ser da trilha (gatilho `check_expense_people`, ampliado).
- **Testes de banco.** `tests/db/harness.ts` ganhou `createDb({ before })` e `applyMigrations(from)`, para semear dados antigos e testar os backfills de verdade.
- **Tipos.** Os campos novos em `types.ts` são **opcionais** (`?:`), porque cópias offline antigas e projetos com a migration pendente não os têm. `upgradeBundle` preenche `suggestions` e `tripPreferences` com listas vazias. Quem ler `cost_cents`, `price_cents`, `kind` etc. trata `undefined` como `null`.
- **Demo.** A Andes bate com o canvas: R$ 6.470 por pessoa, R$ 19.410 planejados para 3 e R$ 9.360 juntados (48%), mais custos em BRL nos trechos, diárias e passeios, bairros (Miraflores, San Blas, Sopocachi), 4 sugestões (3 passeios e 1 bairro), preferências, quem leva 4 itens da mala, e 3 gastos ligados (voo e hostel pagos pelo caixa, ingresso de Machu Picchu pelo Léo). Para sobrar um dia vazio para a sugestão, a demo tira "Montanha Colorida" do plano de Cusco (`DROP_PLAN` em `lib/demo/build.ts`); ela volta como sugestão "cabe no dia 6". As outras 3 demos só ganharam `accent`, `kind` e listas vazias. **As fotos da demo continuam `null` (placeholder):** este ambiente não conseguiu resolver fotos reais da Wikimedia (ver abaixo), e não inventei URLs.
- **`lib/money.ts`:** entraram `budgetOverview`, `categoryStatus` (itens por tipo, pagos/não pagos pelos vínculos), `memberPoolStatus` (status `completo | em_dia | atrasado | sem_meta`; "em dia" compara com uma meta linear entre a criação da trilha e o embarque), `expenseImpact` (considera edição), `categoryKind`, `toBaseCents` e `itemCost`. Preço em moeda diferente da base só entra com uma taxa (`rates`); sem ela vira `null`, e a UI mostra como "sem preço". A Fase 6 precisa passar as taxas do conversor.
- **`lib/budgetPlan.ts`:** `budgetFromPlan` (estilo multiplica hospedagem sem preço e comida; ritmo define passeios por dia livre), `plannedUpdates` (casa por tipo), `snapshotOf` e `diffSince`. As referências de preço (`DEFAULTS`) são chutes conservadores em centavos de BRL. A Fase 6 deve trocá-las pelo `/api/ai/estimate` (diária) quando houver IA, sempre como estimativa.
- **`lib/suggestions.ts`:** `rankForHome`, `slotsForDay`/`stopSlots` (estados `vazio | folga | cheio | aclimatar | viagem`; acima de 2.500 m o dia da chegada fica para aclimatar), `bestDayFor`, `suggestionsForDay`, `stopsNeedingSuggestions` e `estimateCents`. **Lembretes de regra não são gravados com `source:'rules'`:** saem na hora de `ruleAlerts`, `myPendingVotes` e `memberPoolStatus`, então nunca ficam velhos. A coluna `source` continua aceitando `rules` para uso futuro. "Documento faltando para alguém" usa só os alertas de validade e de seguro: documentos privados não são visíveis para a turma, então não dá para saber, de forma honesta, quem está sem documento. A matriz de documentos da Fase 7 decide isso.
- **Ações:** `data/suggestionActions.ts` (`acceptSuggestion`, `voteSuggestions`, `dismissSuggestion`). Com 2 ou mais sugestões da mesma parada, a votação vira uma enquete `activity` com preço por opção, e a vencedora entra no roteiro ao decidir. Com 1 só, vira uma enquete livre "Bora: X?" (Topo/Passo), que não mexe no roteiro. A atividade aceita grava `cost_cents` com a média da faixa, `cost_is_estimate = true`.
- **`/api/ai/suggest`:** só editor; no máximo 1 chamada por parada por dia (confere `suggestions.created_at` no banco); respeita `consumeQuota`; grava passeios e até 2 bairros, com `day_fit`, `effort` e `photo_query`. A Início chama para a próxima parada sem sugestão ou com sugestões de mais de 14 dias, uma vez por dia por parada neste aparelho (`sessionStorage`). Sem IA, a rota responde 503 e a Início segue só com as regras.
- **`/api/ai/estimate`:** `transport` (faixa por pessoa para trechos sem preço) e `daily` (comida por dia). Só devolve faixas, não grava nada e ainda não tem tela: a Fase 6 usa.
- **`/api/photos` e `lib/photos.ts`:** usam a Action API (`generator=search` + `pageimages`, depois `imageinfo` com `extmetadata`) e não a REST `page/summary`, porque a REST devolvia brasões e mapas como imagem principal. Descartam SVG, bandeira, brasão, mapa e logo; **só aceitam a página se o título bater com o lugar pedido** (nunca foto de outro lugar); exigem licença; tentam pt e depois en. `User-Agent` sem e-mail. Cache de 30 dias no `fetch` da rota e `cache-first` no `sw.js` (agora **`v3`**, cache `trilha-photos`, ~300 entradas). **Não foi possível conferir o aceite "`/api/photos?q=Cusco` devolve foto" neste ambiente:** a Wikipedia respondeu 429 (limite de requisições) para o IP compartilhado do sandbox, mesmo depois de liberada na rede. O parse está coberto por testes com respostas reais de exemplo; falta a conferência ao vivo no Vercel.
- **Ajustes.** A seção "Aparência" agora tem o seletor das 8 cores e a opção "Automática" (grava `trips.accent`, ou `null`).
- **`StopSuggestions`** grava o custo em `cost_cents`/`cost_currency`/`cost_is_estimate`, e a nota fica só com a duração.
- **README.** Entrou a migration 0008 e a frase "só os documentos são cifrados ponta a ponta; caixa, gastos e orçamento ficam protegidos pelo RLS". Não havia frase dizendo que o caixa era criptografado; a frase nova deixa isso explícito.
- **Ambiente de desenvolvimento.** Foi criado um ambiente de nuvem pessoal "trilha", com acesso a `pt/en.wikipedia.org`, `commons.wikimedia.org` e `upload.wikimedia.org`, para testar as fotos.

### Ressalvas de handoff: Fase 5

- **Rotas.** `/roteiro/[stopId]` agora é a `Parada` real. O `Roteiro` faz `router.replace` de `?parada=X` para `/roteiro/X`. Links internos foram migrados: `Turma` ("Ver no roteiro"), `Diario` ("No roteiro · data") e `plan.ts` (chegada e hospedagem levam direto à parada). `#nova-votacao-stay-<id>` deixou de ser usado pelo Roteiro (a Parada cria a votação de hospedagem sozinha); o tratamento em `Turma.tsx` continua, para links antigos.
- **Lógica pura em `lib/route.ts`** (testada): `focusStopId`, `stopBadge` (pronto / falta hospedagem / em votação), `legInto` (linha do trecho), `isBooked` (localizador **ou** gasto ligado conta como reservado, então o voo pago pelo caixa não aparece como "não reservado"), `dayPending` (a pendência aparece no dia em que o trecho **sai** da parada), `placeDaySuggestions` (dia vazio recebe até 3 opções, dia com folga 1, sem repetir), `stopAreas`, `stopTours` e `waitingCount`.
- **Parada em foco no Roteiro:** a de hoje durante a viagem; antes, a próxima que não acabou (na demo, Lima). Tocar na faixa ou numa parada compacta troca o foco; o último foco fica no `sessionStorage` (voltar da Parada mantém o lugar). Só uma parada fica expandida por vez.
- **Chegada em altitude:** `bestDayFor` (Início) e o Roteiro não encaixam passeio no dia de chegada acima de 2.500 m, mesmo com algo leve planejado (`isRestDay` em `lib/suggestions.ts`). Por isso a Início e o Roteiro sempre dizem o mesmo dia.
- **Mapa:** `RouteMap` restilizado (pino numerado na `accent`, linha brand pontilhada, tocar no pino abre a parada). No celular, `?vista=mapa` em tela cheia acima da TabBar; no desktop, mapa fixo à direita (sem o `Segmented`). Os tiles do OSM não carregam neste sandbox (sem rede externa); o resto funciona.
- **Fotos:** a capa da Parada, o bairro escolhido e o passeio em destaque resolvem a foto na Wikimedia (`useResolvedPhoto` em `data/usePhoto.ts`) e gravam em `stops.photo`, `suggestions.payload.photo` ou `activities.photo`, **só para editor em conta real e online**. Miniaturas (faixa, linhas compactas, mini-cartões e linhas de passeio) usam só a foto já gravada, para não disparar dezenas de buscas; sem ela, placeholder. Em "Editar parada" dá para buscar a foto na Wikipedia ou tirar a foto. **Upload de foto própria da capa ainda não existe** (fica para a Fase 9 ou quando houver bucket de fotos de parada). Como em fases anteriores, a busca ao vivo não foi conferida aqui (Wikimedia bloqueada/429).
- **Fatos rápidos:** altitude e moeda (`currencyLabel`, ex.: "sol (PEN)"). Clima só com previsão Open-Meteo quando a parada está a ≤ 16 dias; fora disso mostra "—". **Não extraímos "clima típico" do texto da dica da IA** (não dá para fazer isso de forma confiável); a dica aparece inteira logo abaixo, como `AiNote`.
- **Onde ficar:** bairros vêm de `suggestions kind:'area'`; o escolhido é `stops.area` (casado pelo nome com a sugestão; sem sugestão, cartão só com o nome). Os campos novos `good`, `watch` e `walk` em `SuggestionPayload` aparecem só quando existem; o prompt de `/api/ai/suggest` passou a pedir `good`/`watch` (opcionais no schema). `walk` ("8 min a pé da praça") **não é gerado por ninguém ainda**: exigiria geocodificar o bairro e a praça. "Mandar bairros para votação" cria uma enquete **livre** (decidir não muda `stops.area`; quem organiza escolhe o bairro na Parada).
- **Hospedagem:** `staySearchLinks` ganhou `area`, `maxNightCents` e `currency`. Booking recebe bairro, datas, adultos, 1 quarto e o teto (`nflt=price=BRL-0-X-1`); Airbnb recebe bairro, datas, adultos e `price_max`; Hostelworld só bairro, datas e pessoas (não aceita teto na URL). Os parâmetros de preço seguem o formato atual dos sites e podem mudar sem aviso. Os chips (pessoas e teto) abrem "Filtros da busca"; o ajuste vale só nesta sessão (memória do módulo), começando no tamanho da turma e em `nightlyCap`. A busca aparece também quando a hospedagem já está reservada ("Quer comparar?").
- **Cole o link:** `addStayOption` cria a opção na enquete `stay` aberta da parada (ou cria a enquete). Nome e preço são digitados pela turma: a Trilha não lê o site (nada de "foto e preço automáticos" como no texto do canvas). Só aceita `http(s)://`.
- **Passeios:** sugestões (novas, em votação, aceitas) + atividades do plano que são passeio (têm custo, vieram de IA, votação ou inspiração, ou têm foto). Atividades sem custo como "Dia livre pra aclimatar" não entram. O destaque é quem tem mais "quero muito" no Diário e ainda não está no roteiro; empatando, o que alguém salvou no Diário ("Bia salvou no Diário"). "Em votação · k de n" casa pelo nome da opção na enquete aberta da parada.
- **Sheets (§6.5)** em `components/route/RouteSheets.tsx`: adicionar parada (pede dica **e** sugestões em segundo plano), editar parada (agora com bairro, notas, foto e excluir), trecho (valor por pessoa + moeda), hospedagem (valor por noite, moeda, link), atividade (custo por pessoa), escolher dia e "mandar pra votação". Valor digitado vira `*_is_estimate = false`; sem mexer, o selo ESTIMATIVA continua. **Atualização da Fase 6:** “Marcar como pago” entrou nos três Sheets, abrindo o gasto ligado. Reordenar paradas fica em "⋯ > Mover para cima/baixo"; arrastar não foi feito.
- **Componente novo `ui/Field`** (`Field`, `FieldGrid`): os Sheets do Roteiro já não usam as classes antigas `.field`/`.grid2`. As outras telas continuam com elas até serem redesenhadas.
- **Removidos:** `components/plan/StopSuggestions.tsx`. `PlanBits.tsx` e `plan.module.css` continuam porque o `Explorar` (Fase 8) usa.
- **Demo Andes:** entraram 3 passeios em Cusco (Laguna Humantay, Aula de cozinha peruana, Sacsayhuamán) e 3 bairros (San Blas aceito, com Bom/Atenção; Centro histórico; San Pedro). Assim o dia 6 vazio mostra as 3 opções e o dia 4 mostra a sugestão tracejada, como no canvas. A Início passou de 6 para 9 itens em "ver todas" (o teste foi ajustado).
- **Testes e2e:** a demo guarda tudo em memória, então depois de uma ação o teste navega pelo app (abas/links) em vez de `page.goto`, que recarrega e perde o estado. Alguns `getByText` precisaram de escopo por papel (`getByRole(...)`) porque, durante o streaming do React, o conteúdo existe duas vezes por um instante (uma cópia oculta).
- **Fora do escopo da fase, mas feito a pedido:** o login (`/entrar`) passou a voltar sempre para a origem onde começou (`window.location.origin`), e não mais para `NEXT_PUBLIC_SITE_URL`. Isso conserta o login com Google nas previews do Vercel, que caía na produção. Falta no Supabase: incluir as URLs de preview em Authentication → URL Configuration → Redirect URLs (ex.: `https://*-<time>.vercel.app/**`).

### Ressalvas de handoff: Fase 4

- **`screens/Inicio.tsx`** substitui a Home antiga nas duas árvores de rota. `Home.tsx` e `home.module.css` foram apagados, junto com a história de scroll. O bloco `homeTop` saiu do `TripShell`: o seletor de trilhas (botão novo `TripSwitcherButton variant="photo"`) e a `AvatarStack` estão dentro do hero. No desktop o seletor do hero some, porque já está na SideNav.
- **Ordem dos cartões.** `rankForHome` define *quais* entram (os 3 primeiros por prioridade). O cartão grande com foto aparece **primeiro**, como no canvas, mesmo que um voto tenha prioridade maior; os demais seguem a ordem. "3 de N · ver todas" abre um Sheet com todos.
- **Foto do hero:** capa da turma (`cover_path`) → `stops.photo` da primeira parada → placeholder. A foto da Wikimedia da primeira parada só aparece quando `stops.photo` já estiver gravado: ainda não há quem resolva e grave a foto das paradas (a Fase 5, na Parada, deve fazer isso com `fetchPhoto` e gravar em `stops.photo`). A foto do cartão grande é resolvida na hora para editor em conta real e gravada em `suggestions.payload.photo`.
- **Variações do hero:** antes (N dias), menos de 48 h (`31h20`), "É hoje.", durante ("5 / dia de 15 / Cusco" + seção "Hoje em Cusco" com as atividades do dia) e depois ("Como foi?", que leva ao Diário). As variações durante e depois não têm teste e2e, porque as demos são todas futuras.
- **Leitor (viewer):** vê as sugestões, sem os botões aceitar/votar/dispensar.
- **Próximo passo** aparece como faixa tracejada abaixo do Dinheiro enquanto `planStage` não for "viajar". Os links de `plan.ts` ainda usam `/turma#decisoes` (ver Fase 2/7).
- **`PlanningHome`** foi reestilizado com `Button`, `ListRow` e `Stat`; a CTA principal é "Descobrir destino", que leva a `/descobrir` (ainda o Explorar antigo até a Fase 8). Não tem teste e2e (as demos têm destino).
- **Identidade antiga.** Com a Home antiga fora, `lib/identity/render.ts` e `fontmap.ts` não são mais usados pelo app (só pelos testes de identidade); `shapes.ts`, `generate.ts` e `validate.ts` continuam por causa de `/nova-trilha` e `api/ai/identity`. Tudo sai na Fase 8/9.
- **Testes e2e.** Saíram os 2 da história de scroll. Entraram: hero e números do Dinheiro, 3 visíveis + "ver todas", "Pôr no dia 6" cria a atividade e o cartão some (conferido na Parada Cusco do Roteiro), dispensar, e reduced motion. O teste de lembrete de voto agora vai para `/turma/votos`.

---

### Ressalvas e decisões da Fase 10

- **Verificação (08/11/2026):** `npx tsc --noEmit` ok; `npx vitest run` com **238/238** (entraram `tests/unit/onboarding.test.ts`, 21 testes, e `tests/db/onboarding.test.ts`, 9 testes); `npm run build` ok; `npx playwright test` **51/51** contra o build de produção (entrou `tests/e2e/onboarding.spec.ts`, 4 cenários). Capturas dos passos 3 a 6 em 390 px conferidas.
- **Aplicar `supabase/migrations/20261108000010_onboarding.sql` no Supabase, depois da `00009`.** Esta execução **não aplicou nada no remoto**. Sem ela, `/nova-trilha` falha ao criar a trilha (colunas `party_size` e `onboarding`) e o passo 4 falha (RPC ausente).
- **Não validado com IA real nem com Supabase real.** Os prompts `places`/`route` e as extensões de `activities`/`estimate` foram testados só com respostas simuladas (e2e) e pelos schemas. Conferir a qualidade das sugestões e o tempo de resposta (o pedido `route` usa ~2.400 tokens e pode repetir uma vez) com o provedor configurado.
- **Mudanças em relação à §10:**
  - **Substituir roteiro** só é bloqueado por **gasto ligado** a trecho, hospedagem ou passeio. Documentos, diário e votações só perdem o vínculo com a parada (o banco já faz `on delete set null`).
  - **Bate-voltas da rota** viram passeios do passo 5, já marcados (`dayTripTours`), e não sugestões aceitas no passo 4. Assim viram atividades com dia e custo, como os outros passeios. A RPC aceita `suggestions`, mas o app manda lista vazia.
  - **Trecho que muda de par ao reordenar** fica "preço a calcular no Orçamento". Não há botão "Atualizar preços dos trechos" no passo 4: o "Estimar com a Trilha" do Orçamento resolve depois.
  - **Rótulo "Indispensável"** no lugar de "Não pode faltar" no seletor do passo 3 (o texto longo quebrava em três linhas no celular).
  - **Ids das paradas** são gerados no cliente e mandados à RPC, para gravar `budget_plan.stay_estimates` por parada na mesma transação.
  - **Teto e pessoas:** o passo 2 grava `trips.budget_total = teto × headcount`. Ajustes ganhou "Pessoas na viagem"; a Turma mostra "N pessoas na viagem · M no app" quando há diferença.
  - **Descobrir:** em conta real, "Montar esta trilha" grava o destino e `onboarding.discover_stops` e segue para o passo 2 (as cidades entram no prompt de lugares). Na demo continua criando as paradas na hora, como antes.
  - **Demo:** `/demo/[key]/montar` existe e funciona em memória (a RPC foi espelhada em `demoSource`), mas não há link para ela na demo e a IA não responde lá (cai em "A Trilha não conseguiu sugerir agora"). Existe para os testes e2e com a IA simulada.
- **Efeito nos números da demo:** a Andes tem 1 noite sem cidade (ônibus noturno 22→23/01). Pela regra nova ela entra em hospedagem pela referência do estilo, e o Orçamento da Andes mostra o voo de volta "Uyuni → GRU" pendente (não bloqueia fechar). O total por pessoa do Orçamento da Andes subiu um pouco; os R$ 6.470 do Dinheiro (planejado gravado) não mudam.
- **Não feito:** teste e2e de "recarregar no passo 4 não chama a IA de novo" (a demo guarda tudo em memória e perde o estado ao recarregar; em conta real o rascunho fica em `trips.onboarding`). `lib/identity/dictionary` continua em uso pelo `TripContext` (accent de trilhas antigas) e pela demo; `/nova-trilha` não usa mais.

### Ressalvas e decisões da Fase 9

- **Escopo desta rodada:** restilização de `Mala`, `Documentos` e `Diário`, `srcset` das fotos, limpeza e testes. A validação com Supabase real e em aparelho físico (PWA Android/iOS, modo avião) foi **dada como feita pelo responsável do projeto**, que tem ressalvas próprias; elas não estão registradas aqui e não foram reproduzidas por mim.
- **Mala / Documentos / Diário** usam `Button`, `Field`, `FieldGrid`, `Chip`, `Segmented`, `Checkbox`, `Badge`, `Card`, `EmptyState`, `Progress`, `ScreenHeader` e `IconButton`; os módulos CSS usam só tokens novos. Mudanças visíveis: Mala com cartão `dark` de progresso, Pendências sem a cor rotativa; Documentos como cartões com faixa da categoria (sem "furos" de ingresso), zona de soltar com borda tracejada, aviso do cofre como `Card suggest`; Diário com `Segmented` Antes/Durante/Depois, cartões de parada sem rotação e sem recortes de forma (`clip-path`), placeholder listrado mais suave, reações com `Chip`. A comparação visual foi por screenshot em 375 e ~1280 px, **não** pixel a pixel contra o canvas (ele não tem artboard para essas três telas). O visualizador de documento, a revisão de upload e os Sheets de item/pendência/inspiração mantêm o fluxo anterior, só com os componentes novos.
- **Seletor de teste:** os cartões de documento têm `data-doc` (`article[data-doc]`), porque a classe `ticket` virou CSS Module.
- **Foto de Fotos e prints** deixou de girar e de ter formas; a variável `CYCLE` ainda colore os placeholders (misturada a 22% com `--field`).
- **`srcset`:** `Photo` usa `photoSrcSet()` (`lib/photos.ts`, `PHOTO_WIDTHS = 400/800/1200`) para URLs de `upload.wikimedia.org/.../NNNpx-arquivo`, com `sizes` padrão `(min-width: 1024px) 480px, 100vw`. Se o `srcset` falhar, o `<img>` volta ao `src` simples antes de cair no placeholder. **Não validado ao vivo (sem rede para a Wikimedia):** a Wikimedia tem restringido thumbs a larguras "oficiais"; se 400/800 forem recusadas, ajuste `PHOTO_WIDTHS`. Fotos próprias (URL assinada do Supabase) não ganham `srcset`: seguem no tamanho original comprimido.
- **Compatibilidade em `globals.css` NÃO foi removida por inteiro.** Saíram os aliases de variáveis (`--acc`, `--card`, `--soft`, `--deep`, `--font-display`, `--font-mono`, `--r-*`, `--motif`…; os 4 CSS Modules que ainda os usavam foram migrados) e as classes sem uso (`.av`, `.bar`, `.bullet`, `.ticket*`, `.notch`, `.view`, `.btn-ghost`, `.btn-icon`, `.rv`/`.gw`/`.gy`). **Continuam** `.btn*`, `.field`, `.grid2`, `.card`, `.chip`, `.check`, `.pill`, `.tag`, `.ai*`, `.disp`, `.mono`, `.h3`, `.hint`/`.err`, `.page-title`, `.split`/`.col-*`, `.tap`, `.motif`, usadas por telas fora desta rodada: `conta`, `entrar`, `convite`, `offline`, `EditTrip`, `Votos` (partes), `Turma` (partes), `Descobrir` (partes), `VaultContext`, `feedback` (confirmação), `ErrorBox`, `PlaceSearch`, `money/ExpenseSheet`, `PoolSheets`, `Converter` e `dev/ui`. Foi feita uma conversão automática de botões, campos e selos de uma linha nessas telas (`<button className="btn…">` → `Button`, `label.field` → `Field`, `.pill` → `Badge`), validada só por typecheck e pelos e2e; o que ficou em várias linhas ou com formato diferente continua com a classe antiga. Para fechar a limpeza, migrar esses arquivos e apagar o bloco "compatibilidade".
- **`Botão perigoso`:** `btn-danger` virou `Button variant="secondary"` com texto na cor `--warn` (não há variante `danger` no `Button`).
- **Limpeza que já estava feita:** `dinheiro.module.css` removido; ícones `map`, `book` e `chev` removidos (`minus` fica); `ORS_API_KEY` fora do `.env.example`; README sem referências a identidade e com a nota "Colunas sem uso". `plan.module.css` e `planning.module.css` seguem em uso.
- **Redirects** passaram de 307 para **308** (`permanent: true`): navegadores guardam o 308 em cache.
- **Testes:** a suíte e2e já cobria abas, sugestão aceita, links da Parada, Orçamento, gasto ligado, aporte, votação, teclado, reduced motion e overflow de 360 a 1440 px; não foi reescrita. Entrou 1 asserção nova de unidade (`photoSrcSet`). `hookTimeout: 120000` no `vitest.config.ts`, porque o PGlite estourava 10 s de inicialização sob carga.
- **Verificação:** `npm run typecheck` ok; `npm run build` ok; `vitest` 208 testes verdes (unitários e banco); `npx playwright test` 47 de 47 verdes contra o build de produção. **Lighthouse (acessibilidade ≥ 95, performance ≥ 85) não foi medido**: o ambiente do agente não roda o Lighthouse; falta rodar no celular contra o deploy. Se um `next dev` ficou rodando antes do `typecheck`/`build`, apague `.next` (o dev gera tipos que quebram o `tsc`).

### Ressalvas e decisões da Fase 8

- **Descobrir** (`screens/Descobrir.tsx`, `lib/discover.ts`): 5 perguntas em `StepChat` (teto por pessoa, quando/dias, pessoas, vibe, origem), respostas viram chips editáveis no resultado e são gravadas por pessoa em `trip_preferences` (upsert; se a tabela não existir, o resultado sai mesmo assim). Resultado: três lugares (o 1º com foto), "% com a turma", custo ≈ por pessoa com selo ESTIMATIVA e `fitOf`, roteiro resumido, chips de fatos, **"Montar esta trilha"** e **"Votar"** (poll `free`, como era em Explorar).
- **"% com a turma"** (`groupAffinity`): média, entre quem respondeu, da adequação por teto e vibe (`personFit`); com menos de 2 respondentes o selo some. A vibe vem de `tags` devolvidas pela IA; é uma heurística local, não uma medida de preferência real.
- **"Montar esta trilha"**: grava `trips.destinations` e cria as paradas do `stops[]` da IA, repartindo as noites da viagem (`planStops`; o resto vai para as primeiras paradas; menos noites que paradas reduz a lista) e vai para a Início. **As paradas ficam sem coordenadas, altitude e transporte**: o mapa e os trechos precisam ser preenchidos depois. Se uma etapa falhar no meio, o destino pode ficar gravado com parte das paradas (as escritas não são atômicas).
- **Chip "sem visto" não existe**: sem fonte oficial a regra manda deixar de fora (§5.4). Os fatos mostrados são nº de paradas, tempo/modo e vibes.
- **API** `explore kind:'destinations'` agora devolve `stops[]`, `photo_query` e `tags` (campos com padrão vazio, então respostas antigas continuam válidas). **Não foi testado com provedor de IA real.**
- **Sem destino leva ao Descobrir pela trilha:** como a IA e a cota exigem uma trilha existente, "Começar sem destino" em `/nova-trilha` pede só nome e datas, **cria a trilha** e abre `/t/[id]/descobrir`, em vez de rodar o questionário antes de criar (o planning previa o questionário dentro do passo 2).
- **Trilha com destino:** o Descobrir ainda abre, mas só mostra as sugestões; "Montar" e "Votar" ficam ocultos. O antigo modo "O que mais dá pra ver?" (bate-voltas perto das paradas) **foi removido** com `Explorar.tsx`; as extras por parada vivem na página da parada (Fase 5). Na demonstração o questionário funciona, mas a IA fica desligada.
- **`/nova-trilha`:** reescrita em `StepChat` (destino → [nome] → datas), sem passo de identidade, sem a tela de geração e sem `onboarding.module.css`; só a cor de destaque acompanha o destino do dicionário (grava `trips.accent`). A trilha passa a ser criada com `identity: null`.
- **Identidade removida:** saíram `api/ai/identity`, `lib/identity/{generate,validate,render,shapes,fontmap}`, a tarefa `identity` de `lib/ai` e os testes correspondentes. `/identidades` já tinha saído na Fase 1. **Continuam**, de propósito, `dictionary(.data)`, `types`, `accent` e `contrast` (usados pela demo, pelo accent e pelos destinos sugeridos), a coluna `trips.identity` (agora nula nas trilhas novas) e `identity` no `TripContext` (`@deprecated`). A limpeza final do que sobrou fica para a Fase 9.

### Ressalvas e decisões da Fase 7

- **Hub:** `Turma.tsx` virou o `TurmaHub` (§5.7): grid de membros com pendência principal (voto › documento › aporte; `memberPending`), "Decidir juntos" (poll aberto mais urgente expandido, demais em `ListRow`, "Ver todas (N)"), matriz de documentos (`docMatrix`), Mala da turma com "quem leva o quê" e 2 cartões do Diário. Convite e membro viraram Sheets (`InviteSheet`, `MemberSheet`); o membro abre para o organizador e para a própria pessoa (necessário para "Sair da trilha").
- **Votos:** toda a lógica (votar, decidir/empate/aplicar ao roteiro, nova votação, editar) foi movida **sem mudança de regras** para `Votos.tsx`; `/turma/votos` é a tela completa. No hub, tocar nas opções leva a Votos, onde o voto acontece (o hub não vota inline). O texto do empate cita "Dinheiro › Hospedagem" como no canvas, mas o hub só avisa; a aplicação continua sendo a do `close_poll`.
- **Matriz de documentos:** colunas Passaporte/RG, Passagens e Seguro. **Vacina ficou de fora** (sem regra com fonte oficial, SPEC §9.1). Documento **privado de outra pessoa não chega ao cliente (RLS)**, então aparece "—" mesmo existindo; mostrar "existente sem revelar" exigiria uma RPC/view agregada, não criada aqui.
- **Mala:** campo "Quem leva" (pessoa ou "Todos") ao adicionar e no editar item, chip na cor da pessoa nas linhas. A escrita usa `packing_items.assignee_id` (migration `00008`); sem ela, salvar com responsável falha. A tela de Mala em si ganhou só isso: **o redesign completo de `Mala`, `Documentos` e `Diario` ainda não foi feito** (continuam com o visual da compatibilidade da Fase 1; a limpeza fica para a Fase 9).
- **Sheets 6.6:** convite (com Compartilhar quando há `navigator.share`) e membro foram feitos. Nova votação, votar/decidir e item da mala usam o `Dialog` (já é o `Sheet`) com o formulário anterior, só trocando de lugar. Documento (OCR/visualizador) e entrada do diário **não foram restilizados**.
- **Diário no hub:** mostra as 2 últimas entradas só com texto (sem foto) e sem o "Hoje" durante a viagem.
- **Não validado:** fluxos com Supabase real, realtime entre aparelhos e comparação visual com o PDF.

### Ressalvas e decisões da Fase 6

- **Telas entregues:** Orçamento em quatro passos, Dinheiro integrado, Extrato com busca/filtros/CSV e Acerto com saldos e transferências. `components/money/` contém gasto, aporte/devolução, cotas, categoria, conversor recolhível e câmbio. Os componentes financeiros antigos saíram de `Mala.tsx`. A barra da Início agora recebe a fração 0–1 esperada por `Progress`.
- **Gasto ligado:** usa `save_expense` com rateio e vínculo. Caixa, categoria e selo pago derivam do mesmo registro. A migration `00009` também muda estadia `pending` para `booked` na mesma transação; excluir o gasto remove o selo pago, mas não desfaz uma reserva real. Atividade, estadia e transporte têm o atalho “Marcar como pago”. O E2E verifica gasto pelo caixa, edição preservando vínculo e “Pago ✓” no Sheet da atividade.
- **Moeda e rateio:** chips com base/moedas das paradas/USD; taxa com fonte e data, fallback manual obrigatório quando não há cotação. A edição conserva a taxa histórica. Todos igual, seleção de pessoas e valores diferentes são suportados; a soma precisa fechar em centavos. Gastos pelo caixa dividem igualmente entre os membros. A falha de FX e o caminho manual foram testados com resposta 502 controlada; cotação externa ao vivo não foi certificada.
- **Orçamento atômico:** `close_budget` grava preços digitados, categorias, plano e votação juntos, com controle de versões e RLS. Falha no fim desfaz as escritas anteriores (teste de banco). `budget_total` continua sendo o teto. Categorias do mesmo tipo são consolidadas na primeira; as demais desse tipo ficam com planejado zero, sem apagar gastos. Categorias `outro` são preservadas e incluídas no total. Uma votação livre aberta com a mesma pergunta é reutilizada para evitar duplicatas; opções Sim/Ajustar.
- **Hospedagem e estimativas:** reserva feita ou preço confirmado mantém o valor. Estimativa de estadia pendente acompanha Hostel/Pousada/Hotel. A ação “Estimar hospedagem neste estilo” chama `explore stays` por parada sem preço confirmado, com o estilo, e usa as medianas das faixas por pessoa, salvas em `budget_plan.stay_estimates`. Transporte usa `estimate transport`; comida usa `estimate daily` para o primeiro país informado no roteiro. Em viagens com vários países essa diária ainda é uma referência única, não uma ponderação por país. Sem IA, permanecem referências gerais ou preços já informados. As chamadas com provedores reais **não foram validadas**; regras, cálculo e falha controlada foram. Valores estimados mantêm o selo; não se inventam nomes de hotéis ou preços confirmados.
- **Reabertura:** respostas e valores aceitos voltam preenchidos. `diffSince` avisa mudanças de paradas, noites e tamanho da turma; ainda não discrimina mudanças individuais de preço/atividade no texto do aviso. O cálculo utiliza o roteiro atual ao reabrir. Transporte/passeio selecionado sem preço ou sem taxa impede fechar com total incompleto. As sugestões selecionadas entram no orçamento, mas não são adicionadas automaticamente ao roteiro.
- **Caixa e permissões:** organizador lança por outros e faz devoluções; editor só insere o próprio aporte. A nova política cobre também exclusão: editor só exclui o próprio aporte criado por ele. Não há UPDATE de aportes; abrir um movimento permite consultar e, quando autorizado, excluir para corrigir. Cotas são opcionais por pessoa (zero é válido; vazio volta à divisão igual). RLS foi testado em PGlite, não em conta real.
- **Lembretes:** usa `source:'rules'` (valor aceito pelo schema), `link:'mala'`, `assignee_id`, prazo de hoje e `alert_key=pool:<pessoa>`. Reutiliza tarefa concluída/dispensada e não duplica uma aberta. Aparece nas pendências; a Início já deriva o atraso de `memberPoolStatus`. O envio continua dependendo de `cron/daily`, preferências, VAPID e assinaturas; **nenhum push real foi disparado/validado**. O cron aceita lembrete de aporte com prazo de ontem (janela testada), para cobrir o clique feito após a execução diária; as demais tarefas mantêm a janela de 0–1 dia. Não é um envio imediato ao clicar.
- **Acerto:** transferências entre pessoas viram settlements; envolvendo o caixa viram aporte ou refund, respeitando papel. A sobra é devolvida conforme os saldos individuais, sem presumir que aportes/despesas foram iguais. Não há pagamento bancário automático.
- **Visual e navegação:** segue o PDF, mas não força os números fictícios do artboard sobre a demo. As telas mostram os valores já registrados (ex.: R$ 6.470 gastos e R$ 3.850 no caixa). Ajustado o histórico de Sheet para a troca direta escolha → formulário não fechar o novo modal; Voltar e navegação anteriores passaram na suíte. Não foi certificado em aparelho físico.
- **Aceite remoto ainda pendente:** realtime entre dois aparelhos/contas, fluxo autenticado no Supabase com as migrations aplicadas, push real, PWA instalado Android/iOS e comportamento offline em aparelho. A implementação reutiliza a assinatura realtime existente, mas teste local da demo não prova esses cenários. As Fases 7–9 continuam fora deste trabalho.

## 1. Panorama: o que existe e o que muda

### Dependências (package.json)

| Pacote | Destino |
|---|---|
| next 16, react 19, @supabase/*, idb, zod, web-push, server-only | **mantém** |
| leaflet | **mantém**: mapa do Roteiro, aba "Mapa", restilizado |
| pdfjs-dist, tesseract.js, heic2any | **mantém**: Documentos e fotos |
| devDeps (vitest, playwright, pglite, fake-indexeddb, jsdom) | **mantém** |
| Nova dependência | **nenhuma obrigatória**. O bottom sheet é feito com `<dialog>` + CSS. Não usar biblioteca de UI nem de animação. |

### Fontes (`src/lib/fonts.ts`)

- **Ficam:** Bricolage Grotesque (títulos, pesos 500–800) e **Inter** (texto e números, 400–700, com `font-variant-numeric: tabular-nums` nos valores).
- **Saem:** Instrument Sans, JetBrains Mono, Gloock, Big Shoulders, Shippori Mincho e a injeção dinâmica de fonte por destino em `ThemeApplier`.

### Excluir

- `src/components/shell/Grain.tsx`, `public/grain.png` e `.grain` no CSS.
- Em `primitives.tsx`: `Pattern`, `Marquee`, `Floaters`/`FloatSpot`/`PAGE_FLOAT` e `MotifCheck`, que vira o `Checkbox` padrão.
- `src/components/identity/IdentityCard.tsx`, `src/app/identidades/page.tsx` (vira redirect para `/nova-trilha`) e `src/app/api/ai/identity/route.ts`.
- Em `src/lib/identity/`: `render.ts`, `shapes.ts`, `fontmap.ts`, `generate.ts`, `validate.ts` e a maior parte de `theme.ts`.
  - Fica um `accent.ts` com: cor do dicionário por destino, `fgOn` e o contraste de `contrast.ts`.
  - Também ficam as entradas de `dictionary.data.ts`, reduzidas a `{ key, accent }`, para a demo.
- Em `globals.css`: `.bg-pattern`, `.floaters`, `.marquee`, `.ticket`/`.notch`, `.lift`, `.check` com motivo, os keyframes `grain`/`wig`/`floaty`/`marquee`/`confetti` e as sombras duras `0 4px 0`.
- A história de scroll da Home (hero de 260vh, "A rota" de 300vh, marquee, estatísticas animadas). O countdown continua, como hero estático.
- `screens/Explorar.tsx` como aba. A lógica de `lib/explore.ts` é reaproveitada no Descobrir, nas sugestões e no Orçamento.
- Não apagar as colunas `trips.identity` / `identity_version` agora. Elas ficam sem uso e saem numa migração futura.

### Alterar (principais)

- `src/styles/globals.css`: reescrever com os tokens e componentes novos (seção 3).
- `src/components/shell/TripShell.tsx` + `shell.module.css`: 4 abas, barra inferior de app e layout de desktop (seção 4).
- `src/components/shell/ThemeApplier.tsx`: só aplica `--trip-accent` e a `theme-color`.
- `src/components/ui/primitives.tsx` e `feedback.tsx`: componentes novos; `Dialog` ganha a variante bottom sheet.
- `src/app/layout.tsx`: viewport com `viewportFit: 'cover'` e `themeColor` novo.
- `src/app/manifest.ts`, `public/icon*`: logo novo (quadrado ultramar, trilha pontilhada branca, ponto tangerina) e cores novas.
- Todas as telas em `src/screens/*`: reestruturadas, ver seções 5 e 6.
- Dados: `types.ts`, `supabaseSource.ts`, `demoSource.ts`, `offline.ts` (`upgradeBundle`), `lib/demo/*`, `lib/money.ts`, `lib/explore.ts`, `lib/plan.ts`, `lib/ai/prompts.ts`.
- Testes: `tests/e2e/demo.spec.ts` (reescrita grande), `tests/unit/identity.test.ts` (reduzido a accent e contraste) e testes novos (seção 9).

### Criar

- Migração `supabase/migrations/20261108000008_redesign.sql` (seção 7).
- Rotas novas (seção 4.3).
- `src/app/api/photos/route.ts`: proxy da Wikipedia/Commons com cache.
- `src/app/api/ai/suggest/route.ts`: gera sugestões persistidas.
- `src/app/api/ai/estimate/route.ts`: estimativas de transporte e comida para o Orçamento.
- `src/screens/Inicio.tsx`, `Parada.tsx`, `Dinheiro.tsx`, `Orcamento.tsx`, `Descobrir.tsx`, `TurmaHub.tsx`, além das subtelas de Dinheiro.
- `src/components/ui/*` com os componentes da seção 3.3.
- `src/lib/suggestions.ts` (regras e seleção do que mostrar), `src/lib/budgetPlan.ts` (cálculo do orçamento em conversa), `src/lib/photos.ts` (cliente e fallback).

---

## 2. Referência visual: o canvas

O Claude Code tem acesso ao canvas. Cada artboard é a fonte da verdade visual da tela correspondente:

| Artboard | Tela no app | Rota |
|---|---|---|
| `Main.dc.html` | Princípios, paleta, tipografia, navegação | — |
| `Descobrir.dc.html` | Descobrir destino | `/nova-trilha` passo 2 e `/t/[id]/descobrir` |
| `Inicio.dc.html` | Início | `/t/[id]` |
| `Roteiro.dc.html` | Roteiro com sugestões | `/t/[id]/roteiro` |
| `Parada.dc.html` | Página da parada (Cusco) | `/t/[id]/roteiro/[stopId]` |
| `Orcamento.dc.html` | Orçamento em conversa (interativo) | `/t/[id]/dinheiro/orcamento` |
| `Dinheiro.dc.html` | Dinheiro: caixa + orçamento | `/t/[id]/dinheiro` |
| `Turma.dc.html` | Turma: votos, documentos, mala, diário | `/t/[id]/turma` |

Os artboards medem 390 px de largura (celular). As telas que não estão no canvas (formulários, subtelas, desktop) estão especificadas na seção 6 e seguem os mesmos tokens e componentes.

---

## 3. Fundação visual

### 3.1 Tokens (`:root` em `globals.css`)

**Cores**

```
--bg:        #F5F6F8   /* Névoa: fundo das telas */
--surface:   #FFFFFF   /* cartões */
--ink:       #0D1017   /* Tinta: texto e cartões escuros */
--ink-2:     #3A404C   /* texto secundário */
--mute:      #5B6270   /* rótulos e metadados (passa 4.5:1 em --surface e --bg) */
--line:      #E3E6EB   /* divisórias e bordas de chip */
--line-2:    #ECEEF1   /* divisórias internas de listas */
--field:     #F0F1F4   /* botão secundário e campos */
--brand:     #2B3FF5   /* Ultramar: ação principal, links, aba ativa */
--brand-ink: #1A2BC4   /* texto sobre --brand-soft */
--brand-soft:#E8EBFF
--brand-on-dark: #8E9BFF
--sun:       #FF6B3D   /* Tangerina: destaque, progresso do caixa, avatar "você" */
--sun-soft:  #FFE9E1
--sun-ink:   #8A2E0E   /* texto sobre --sun-soft; alerta "falta você" */
--warn:      #B23A12
--ok:        #0F7A4A   --ok-soft: #E2F4EA   --ok-ink: #0B5A37
--cat-transporte:#8E9BFF  --cat-hospedagem:#FF6B3D  --cat-passeios:#4FC08D  --cat-comida:#E3E6EB
--dark-2:    #2A2F3A   /* chips e trilhos dentro de cartões escuros */
--dark-mute: #A9B0BE   --dark-text: #C9CEDA
--trip-accent: (por trilha; padrão #2B3FF5). Uso: capa sem foto, cor do pino no mapa. Nunca para texto sem checar o contraste (fgOn).
```

**Modo escuro:** fica fora do escopo desta entrega. Mesmo assim, os tokens precisam permitir um tema escuro depois: nunca usar hex direto em componentes.

**Tipografia** (títulos em Bricolage com `letter-spacing: -0.02em` a `-0.035em`; texto em Inter)

| Token | Celular | Desktop | Uso |
|---|---|---|---|
| `--t-hero` | 112/0.9 800 | 140 | número do countdown |
| `--t-display` | 36/1.02 800 | 48 | título de tela ("Roteiro", "Dinheiro") |
| `--t-title` | 24–28/1.1 800 | 28–32 | título de seção ("Hoje a Trilha sugere") |
| `--t-card` | 17–20/1.3 700 | igual | título de cartão |
| `--t-body` | 15/1.45 400 | 16 | texto |
| `--t-small` | 13/1.4 500–600 | igual | metadados |
| `--t-micro` | 11–12/1.3 700 | igual | selos e legendas de foto (uppercase só em selos) |

**Raios:** `--r-chip 999px`, `--r-btn 14px`, `--r-card 22px`, `--r-card-lg 24–28px`, `--r-thumb 12–18px`, `--r-hero 0 0 32px 32px`.

**Espaçamentos:**
- Escala de 4 px: `--s1` 4 · `--s2` 8 · `--s3` 12 · `--s4` 16 · `--s5` 20 · `--s6` 24 · `--s7` 32 · `--s8` 48 · `--s9` 64.
- Margem lateral no celular: 20 px.

**Sombras:** só existe `--shadow-float: 0 6px 24px rgba(13,16,23,.08)`, usada na barra de abas, no bottom sheet e no FAB. Cartões não têm sombra.

**Movimento:**
- Transições de 160–240 ms com `cubic-bezier(.2,.8,.2,1)`.
- O sheet sobe com spring curto.
- `prefers-reduced-motion` desliga tudo.

### 3.2 Regras de estilo

- Nada de gradiente decorativo, textura, borda lateral colorida ou emoji. Ícones são SVG de traço (`Icon` com 2 px de traço, cantos redondos), e o conjunto atual de `icons.data.ts` é reaproveitado e redesenhado no mesmo traço.
- Alvos de toque têm no mínimo 44 px.
- Foto vem antes de texto: paradas, bairros, passeios e destinos sempre têm uma área de foto, real ou placeholder.
- Cartão escuro (`--ink`) aparece no máximo uma vez por tela, para o bloco mais importante (Dinheiro na Início, hospedagem na Parada, total no Orçamento).
- Sugestão da Trilha tem um visual próprio: borda tracejada `--brand-on-dark` sobre fundo `#F4F5FF`, ou cartão com selo "Sugestão". O selo `IA` existente (`AiTag`) continua quando o conteúdo vem de IA.

### 3.3 Componentes (`src/components/ui/`)

Cada componente fica num arquivo próprio, com CSS Module. As props são pensadas para serem portáveis para o app nativo.

| Componente | Descrição |
|---|---|
| `Button` | Variantes `primary` (brand), `secondary` (field), `dark` (ink), `ghost`, `dashed`. Tamanhos `md` (48) e `sm` (40). Prop `block`. Também `IconButton` (44×44, redondo, `aria-label` obrigatório). |
| `Chip` / `ChipGroup` | Pill com borda `--line`. Selecionado = fundo brand e texto branco. `aria-pressed` ou radiogroup. |
| `Card` | Superfície branca com raio 22. Variantes `dark`, `soft` (brand-soft), `outline-selected` (contorno brand de 3 px). |
| `Photo` | Imagem com `object-fit: cover` e raio configurável. Mostra a legenda "foto · {lugar}" no canto e o crédito (autor e licença) num botão ⓘ. Sem foto, desenha o placeholder ilustrado (silhuetas em camadas na `--trip-accent`, como no canvas). Faz lazy loading e reserva o espaço para evitar CLS. |
| `PhotoCard` | Foto grande com título e ações embaixo (passeio, destino, bairro). Variante `row`: miniatura de 84 px à esquerda. |
| `SuggestionCard` | Selo do motivo ("Passeio · cabe no dia 4", "Falta você votar", "Reserve logo"), foto opcional e ações padrão: `[Pôr no dia N]` `[Votar]` `[✕ Dispensar]`. |
| `ListRow` | Ícone ou miniatura, título, subtítulo e um elemento à direita (valor, chevron, selo). Divisória `--line-2`. |
| `Stat` | Rótulo pequeno com valor grande. |
| `Progress` | Trilho de 8–14 px. Aceita várias camadas (juntado sob gasto) e segmentos por categoria. |
| `Badge` | Selo pequeno nos tons `ok`, `warn`, `brand`, `sun`, `neutral`. |
| `AvatarStack` / `Avatar` | Iniciais num círculo. Cores fixas por pessoa vêm de `profiles.color`; o "você" é sempre tangerina. |
| `Segmented` | Lista/Mapa, Antes/Durante/Depois. |
| `Sheet` | `<dialog>` que vira bottom sheet no celular (≤ 820 px: preso embaixo, alça, altura até 92 vh, rolagem interna, rodapé de ações fixo) e modal centralizado de 560 px no desktop. Substitui o `Dialog` em todos os formulários. Foco preso dentro, Esc fecha, botão Voltar do Android fecha (`history.pushState`). |
| `MoneyInput` | Valor grande (40 px), `inputmode="decimal"`, prefixo de moeda trocável e formatação pt-BR enquanto digita. |
| `StepChat` | Bolha da Trilha (logo de 30 px), bolha de resposta (brand, alinhada à direita), bloco de opções. Usado no Orçamento e no Descobrir. |
| `TabBar` / `SideNav` | Ver seção 4. |
| `ScreenHeader` | Título grande, subtítulo e ação à direita. Variante `back` com botão voltar redondo. |
| `EmptyState`, `Skeleton`, `ErrorBox`, `OfflineBanner` | Restilizados. Os estados obrigatórios do SPEC §8.8 continuam. |
| `Toast` | Restilizado e posicionado acima da TabBar. |
| `Checkbox` | Caixa de 24 px com raio 7 e check branco sobre brand. Substitui o `MotifCheck`. |

---

## 4. Shell, navegação e comportamento de app

### 4.1 Celular (≤ 820 px)

- **Sem header global.** Cada tela começa com o `ScreenHeader` dela. O seletor de trilha fica na Início, no canto superior ("Minhas trilhas" com o logo).
- **TabBar fixa embaixo**, flutuante:
  - margem de 12 px, fundo branco, raio 24, `--shadow-float`;
  - 4 abas em grid: **Início · Roteiro · Dinheiro · Turma**;
  - a aba ativa tem pílula `--brand-soft` e texto `--brand-ink`;
  - `padding-bottom: env(safe-area-inset-bottom)`;
  - o conteúdo das telas tem `padding-bottom` de 120 px.
- **Subtelas** (Parada, Orçamento, Acerto, Votos...) usam `ScreenHeader back` e **escondem a TabBar** se tiverem uma CTA fixa no rodapé.
- **Formulários sempre em `Sheet`**, nunca em página nova, exceto o Orçamento, que é uma tela.
- `viewport`:
  - `viewportFit: 'cover'`;
  - `themeColor` igual a `#F5F6F8`, ou à cor do hero na Início;
  - nada de `user-scalable=no`.
- Detalhes de app:
  - `overscroll-behavior-y: contain` nas áreas roláveis;
  - `-webkit-tap-highlight-color: transparent`;
  - estado `:active` com `scale(.98)`;
  - transição curta entre abas (só opacidade);
  - a posição de rolagem de cada aba é preservada.
- PWA: `display: standalone`, ícones novos (incluindo maskable) e splash com fundo `#F5F6F8`.

### 4.2 Desktop (> 820 px)

- **SideNav fixa à esquerda** (240 px): logo, seletor de trilha, as 4 abas na vertical e, no rodapé, Conta e Nova trilha.
- O conteúdo vai ao lado, com `max-width: 1120px`.
- Layouts em 2 colunas onde ajuda:
  - **Início:** hero com countdown à esquerda; "Hoje a Trilha sugere" e o Dinheiro à direita.
  - **Roteiro:** lista de paradas e dias (coluna principal) com o mapa fixo à direita (sticky).
  - **Parada:** capa larga; "Onde ficar" e "Passeios" em grid de 2–3 colunas.
  - **Dinheiro:** resumo e categorias à esquerda; movimentos e "cada um no caixa" à direita.
  - **Turma:** grid de 2 colunas com os blocos.
- O `Sheet` vira modal centralizado.
- Não pode haver rolagem horizontal entre 360 e 1440 px (o teste atual continua).

### 4.3 Rotas

O padrão atual se mantém: wrappers finos em `/t/[tripId]/*` e espelhados em `/demo/[key]/*`, com a tela em `src/screens`.

| Rota nova | Tela | Substitui |
|---|---|---|
| `/t/[id]` | `Inicio` (ou `PlanningHome` restilizada quando a trilha não tem destino) | Home |
| `/t/[id]/descobrir` | `Descobrir` (só faz sentido sem destino) | explorar (modo planejamento) |
| `/t/[id]/roteiro` | `Roteiro` (`?vista=mapa`) | roteiro |
| `/t/[id]/roteiro/[stopId]` | `Parada` | o `StopDetail` dentro do roteiro, o `?parada=` e o explorar por parada |
| `/t/[id]/dinheiro` | `Dinheiro` | a metade "gastos" da mala |
| `/t/[id]/dinheiro/orcamento` | `Orcamento` | `BudgetDialog` |
| `/t/[id]/dinheiro/extrato` | `Extrato` | `ExpenseList` |
| `/t/[id]/dinheiro/acerto` | `Acerto` | `Debts` |
| `/t/[id]/turma` | `TurmaHub` | turma (membros e convites) |
| `/t/[id]/turma/votos` | `Votos` (lista completa, inclusive encerradas) | `Decisions` |
| `/t/[id]/turma/documentos` | `Documentos` | documentos |
| `/t/[id]/turma/mala` | `Mala` (só mala e pendências) | a metade "mala" |
| `/t/[id]/turma/diario` | `Diario` | diario |
| `/t/[id]/ajustes` | `EditTrip` restilizada | editar |

**Redirects** em `next.config.ts`, com parâmetros (vale para `/t/:id` e `/demo/:key`):
- `/explorar` → `/descobrir`
- `/mala` → `/turma/mala`
- `/documentos` → `/turma/documentos`
- `/diario` → `/turma/diario`
- `/editar` → `/ajustes`
- `/identidades` → `/nova-trilha`
- `?parada=X` em `/roteiro` → `/roteiro/X`. Este é feito na própria tela, com `router.replace`.

**Também:**
- Atualizar `warmTripPages` (`ServiceWorker.tsx`) com as rotas novas.
- Subir `VERSION` em `public/sw.js` para `v2`.
- Corrigir os links do menu que usam `/t/${tripId}` fixo: usar sempre `base` de `useTrip()`.

---

## 5. Telas do canvas: especificação para implementação

### 5.1 Início (`Inicio.dc.html`)

1. **Hero de 430 px** (celular), com raio só embaixo:
   - Fundo: foto de capa (`trips.cover_path`); senão, foto Wikimedia da primeira parada; senão, o placeholder ilustrado.
   - Escurecimento embaixo só o suficiente para o texto ter contraste 4.5:1. Isso é um overlay de legibilidade, não um "gradient wash".
   - Topo: logo + "Minhas trilhas" (abre o seletor de trilha num `Sheet`) e a `AvatarStack` da turma (abre a Turma).
   - Base:
     - linha "Nome da trilha · 12 → 26 jan";
     - número gigante `--t-hero` com "dias para {primeira parada}";
     - legenda da foto.
   - Variações do countdown:
     - menos de 2 dias: horas e minutos;
     - dia da viagem: "É hoje.";
     - durante a viagem: o hero vira "Dia 5 de 15 · Cusco" e "Hoje em Cusco" lista as atividades do dia;
     - viagem terminada: "Como foi?" leva ao Diário/Retro.
2. **"Hoje a Trilha sugere"**: lista de `SuggestionCard` com contador "3 de 9" e o link "ver todas", que abre um Sheet com a lista completa. A ordem é dada por `lib/suggestions.ts`:
   1. voto meu pendente (`myPendingVotes`);
   2. reserva urgente (regras de `ruleAlerts` e `planSteps`, como estadia não reservada ou chegada sem transporte, com prazo);
   3. sugestão de passeio para um dia vazio ou com folga (tabela `suggestions`);
   4. documento faltando para alguém (Turma);
   5. aporte atrasado (Dinheiro).
   O primeiro cartão é sempre o "grande" com foto. Os outros são `ListRow` com ícone.
3. **Cartão escuro "Dinheiro da turma"**: valor juntado, "de R$ X planejados", `Progress` tangerina e o link "Abrir". Sem orçamento ainda, mostra "Montar orçamento", que leva ao Orçamento.
4. **Próximo passo do planejamento** (`lib/plan.ts` `nextStep`): faixa discreta abaixo do Dinheiro, enquanto o estágio não for "viajar".
- **Sem destino:** a Início vira o `PlanningHome` restilizado, com a CTA principal "Descobrir destino" levando ao Descobrir.
- **IA indisponível:** a seção de sugestões mostra só os itens de regra (votos, reservas, documentos). Não aparece erro (SPEC §9.1).

### 5.2 Roteiro (`Roteiro.dc.html`)

- `ScreenHeader` "Roteiro" com o `Segmented` Lista | Mapa (`?vista=mapa` mostra o `RouteMap` restilizado em tela cheia, acima da TabBar).
- Subtítulo: "15 dias · 6 paradas · N sugestões esperando".
- **Faixa horizontal de paradas**: miniaturas de 76 px com foto e nome. Tocar rola até a parada; a parada atual tem contorno brand. O último item é "+ parada", que abre o Sheet "Adicionar parada".
- **Por parada:**
  - Parada fora de foco: `ListRow` compacto com miniatura, "datas · noites · bairro" e um selo (`pronto` / `falta hospedagem` / `em votação`).
  - Parada em foco ou atual: capa de 240 px, que é um link para `/roteiro/[stopId]`, com datas, nome grande, chip "Fiquem em {bairro}" (quando há bairro escolhido) e "Ver a cidade →".
- **Entre paradas**: linha de transporte com ícone, "Voo Lima → Cusco · 1h20 · R$ 520 / pessoa" (valor confirmado ou ESTIMATIVA) e o selo "não reservado" quando faltar `booking_ref`. Tocar abre o Sheet de transporte.
- **Dias da parada** (cartão branco com uma linha por dia):
  - número do dia e as atividades (título e nota);
  - **dia com folga** (menos de 2 atividades): uma `SuggestionCard` inline tracejada com foto, nome, "15 min de táxi" e um botão "+" de 44 px que insere a atividade;
  - **dia vazio**: "A Trilha separou 3 opções" mostra 3 mini-cartões com foto e o botão escuro "Mandar as 3 para votação", que cria um poll `target:'activity'` com 3 opções e `price` preenchido;
  - pendência do dia (ex.: "Trem ainda não reservado") em `--warn`.
- Tocar numa atividade abre o Sheet da atividade (editar, custo, marcar como paga, remover).
- Toda a edição e reordenação que existe hoje continua, agora em Sheets. Reordenar paradas usa o menu "⋯ > Mover para cima/baixo"; arrastar fica opcional.

### 5.3 Página da parada (`Parada.dc.html`), `/roteiro/[stopId]`

1. **Capa de 400 px** com foto, botão voltar, legenda, "Parada 2 de 6 · datas · noites" e o nome em 64 px.
2. **Fatos rápidos**, em grid de 3:
   - Altitude, de `stops.altitude_m`;
   - Clima no mês: previsão da Open-Meteo quando faltam ≤ 16 dias; senão, "clima típico" vindo da dica de IA (`stops.tip`);
   - Moeda (`currencyForCountry`).
   Fato sem dado mostra "—", nunca um valor inventado.
3. **"Onde ficar"**:
   - Primeiro, os bairros (até 4). Vêm de `suggestions` com `kind:'area'`, gerados pelo `explore stays` atual com foto.
   - O bairro escolhido (`stops.area`) ganha contorno brand, o selo "Fiquem aqui", foto grande, distância a pé da praça (marcada como em linha reta, se for o caso), descrição e os blocos **Bom / Atenção**.
   - Os outros bairros aparecem em grid de 2 cartões com foto. Tocar abre o Sheet do bairro, com "Escolher este bairro" e "Mandar bairros para votação".
4. **Cartão escuro "Hospedagem em {bairro}"**:
   - Chips com o filtro já aplicado: bairro, datas, nº de pessoas (`headcount`), teto por noite (`nightlyCap`). Tocar num chip ajusta o valor.
   - Botões "Abrir no Booking/Airbnb/Hostelworld, já filtrado ↗", gerados por `staySearchLinks()` (já existe em `lib/explore.ts`) **incluindo o bairro na busca e o preço máximo**, onde o site aceitar.
   - Campo "Achou um? Cole o link aqui": cria uma opção num poll `target:'stay'` (cria o poll se não existir) com o link. O título e o preço são preenchidos à mão.
   - Se já existe estadia: mostra a estadia (nome, status reservado/pendente, check-in/out, documento ligado) e o link "trocar".
5. **"Passeios"**:
   - O primeiro é um `PhotoCard` grande, priorizando o passeio com mais reações na turma ("Bia quer muito").
   - Os demais são `PhotoCard row` com o status: "No roteiro · dia 4" (`--ok`), "Em votação · 1 de 3" (brand) ou o botão "+".
   - Mostra a duração, o esforço e o custo como ESTIMATIVA com `FitBadge` (cabe / passa R$ x).
   - Fonte: tabela `suggestions` com `kind:'activity'` mais as atividades e inspirações já existentes da parada.
6. **Seções secundárias** (abaixo, colapsáveis): "Como chego" (transporte), "Documentos desta parada" (`docsOfStop`), "Notas", "Ideias da turma" (inspirações do Diário).

### 5.4 Descobrir (`Descobrir.dc.html`)

- Aparece em dois lugares: no passo 2 de `/nova-trilha` ("Começar sem destino" leva ao questionário) e em `/t/[id]/descobrir`, para trilhas sem destino.
- **Questionário** (`StepChat`, uma pergunta por vez):
  1. orçamento por pessoa;
  2. quando e quantos dias;
  3. quantas pessoas;
  4. vibe (chips: natureza, cidade, praia, cultura, aventura, comida);
  5. de onde saem.
  As respostas viram chips editáveis no topo da tela de resultado.
- **Resultado:** "Três lugares que cabem na turma". O primeiro é um cartão grande com foto e os outros dois são `row`. Cada um mostra:
  - "% com a turma" (afinidade calculada localmente; ver regra abaixo);
  - custo ≈ por pessoa (ESTIMATIVA, `fitOf` contra o teto);
  - roteiro resumido;
  - chips de fatos ("6 paradas", "altitude", "sem visto" só com fonte, senão o chip fica fora);
  - ações "Montar esta trilha" (grava os destinos e as paradas sugeridas e vai para a Início) e "Votar" (poll `free`, que já existe em Explorar).
- **"% com a turma"**: quando mais membros responderam o questionário (cada membro responde no próprio celular; respostas em `trip_preferences`, seção 7), a afinidade é a média de quanto cada destino atende às respostas de cada um (teto, vibe). Com uma pessoa só, o selo não aparece.
- Rodapé: aviso em `--sun-soft` sobre como o custo é estimado, e "Já sei para onde vou" volta à busca de destino.
- Backend: `api/ai/explore kind:'destinations'`, que já existe, ampliado para devolver `stops[]` (2–6 nomes) e `photo_query`.

### 5.5 Orçamento em conversa (`Orcamento.dc.html`), `/dinheiro/orcamento`

- **Topo fixo:** cartão escuro com o total por pessoa e o total da turma, barra segmentada por categoria (cores `--cat-*`), legenda com o valor de cada categoria e a linha "Sobram / Passou R$ x do teto de R$ y" (teto = `trips.budget_total ÷ headcount`, quando existir).
- **Passo 1, Transporte:** a Trilha lista cada trecho do roteiro (ida, entre paradas, volta) com valor:
  - valor confirmado (`transports.price_cents`) sem selo;
  - estimado via `api/ai/estimate kind:'transport'` com faixa e ESTIMATIVA;
  - "[preço]" editável quando não houver nada.
  Respostas: "Confere, pode seguir" ou tocar num trecho para editar o valor.
- **Passo 2, Hospedagem:** "São N noites. Que estilo a turma topa?" com 3 opções (Hostel / Pousada / Hotel), cada uma com descrição, valor por noite e total.
  - O valor por noite é a mediana das faixas de `explore stays` das paradas para aquele estilo. Sem IA, usa a tabela de regras por estilo (`BUDGET_SPLIT` como último recurso).
  - Uma nota da Trilha explica a escolha ("pousadas em San Blas cabem nesse valor").
  - Estadias já reservadas entram com o valor real e não podem ser trocadas aqui.
- **Passo 3, Passeios:** checklist com as atividades do roteiro que têm custo e as sugestões aceitas, cada uma com selo de origem ("no roteiro · dia 7" / "sugestão da Trilha") e valor. Desmarcar tira do orçamento, não do roteiro.
- **Passo 4, Comida e compras:** 3 ritmos (Econômico / Médio / Solto) em valor por dia. Os valores vêm da estimativa por país (`api/ai/estimate kind:'daily'`) ou da tabela de regras.
- **CTA "Fechar orçamento e abrir o caixa":**
  - grava `budget_categories.planned` (total da turma por categoria) e `trips.budget_plan` (as respostas, para reabrir a conversa já preenchida);
  - cria o poll `free` "Aprovar orçamento de R$ X por pessoa?" com Sim/Ajustar, que aparece na Início dos outros;
  - leva ao Dinheiro.
- **Reabrir:** a conversa volta preenchida. Mudou o roteiro? A Trilha avisa: "Mudou desde a última vez: +1 parada (Arequipa), +R$ 380 em transporte".
- Toda a lógica fica em `lib/budgetPlan.ts`, como funções puras testáveis: `planTransport`, `planStay(style)`, `planTours(selection)`, `planFood(pace)`, `planTotal`, `diffSince(plan, bundle)`.

### 5.6 Dinheiro (`Dinheiro.dc.html`)

É aqui que caixa e orçamento passam a ser uma conta só.

- `ScreenHeader` "Dinheiro" com o link "Rever orçamento" e o subtítulo "Orçamento e caixa são a mesma conta."
- **Resumo** (cartão branco):
  - 3 `Stat`: **Planejado** (soma de `planned`), **Juntado** (aportes − devoluções, de `poolSummary`) e **Já gasto** (`totalSpentCents`);
  - `Progress` em 2 camadas: juntado (brand-soft) e gasto (sun), sobre o planejado;
  - a linha "Saldo no caixa agora".
- **Por categoria:** um cartão por `BudgetCategory` com gasto/planejado, barra na cor da categoria e uma linha de contexto gerada a partir dos itens ligados:
  - "Voos SP ⇄ Lima pagos · falta o trem e os ônibus": itens do roteiro daquela categoria com e sem gasto ligado;
  - o último cartão afetado recebe destaque por 24 h: contorno e "Acabou de baixar: {gasto}".
  Tocar num cartão abre o Sheet da categoria: ajustar o planejado, ver os gastos da categoria e os itens ainda não pagos.
- **"Último movimento":** o gasto ou aporte mais recente, com a cadeia **Caixa → Categoria → item do roteiro ✓ pago** quando há ligação. "Ver extrato" leva ao Extrato.
- **"Cada um no caixa":** por membro, juntado / meta pessoal (planejado ÷ headcount, ou a cota definida no Sheet de aporte), com selo "em dia" ou "faltam R$ x".
- **Ações:**
  - Celular: botão principal fixo "Lançar gasto ou aporte", que abre um Sheet de escolha com 2 opções grandes: **Gasto** e **Aporte no caixa**.
  - Desktop: dois botões.
- **Abaixo:** "Acerto de contas" (resumo de `suggestTransfers`, levando ao Acerto) e "Conversor" (o `Converter` atual, restilizado e recolhível).
- **Sem orçamento:** EmptyState "Ainda não tem orçamento" com o botão "Montar com a Trilha", que leva ao Orçamento. O caixa continua funcionando sem orçamento.

### 5.7 Turma (`Turma.dc.html`)

- Header "Turma" com o botão "Convidar", que abre o Sheet de convite.
- **Membros:** grid de 3 cartões (rolagem horizontal quando há mais de 3) com avatar, nome e a pendência principal da pessoa (voto, documento, aporte) ou "em dia". Tocar abre o Sheet do membro (papel, remover, pendências), disponível só para o organizador.
- **Decidir juntos:**
  - o poll aberto mais urgente fica expandido, com opções como botões grandes (foto, preço, barra de votos, quem votou) e uma nota quando há empate ("Seu voto decide — e a escolha já vai para Dinheiro › Hospedagem");
  - os demais polls aparecem em `ListRow`;
  - o link "ver todas", com o contador de abertas, leva a `/turma/votos`.
- **Documentos:** matriz documento × pessoa (✓ / —), montada a partir das categorias de `documents` por membro, com o contador "faltam N" e a nota do cadeado "criptografados e disponíveis sem internet". Tocar leva a `/turma/documentos`.
  - Tipos de documento esperados por viagem: passaporte/RG, passagens, seguro e "vacina" **só se a regra tiver fonte oficial** (SPEC §9.1).
  - "—" só aparece para quem não subiu o documento. Documento privado de outra pessoa conta como existente sem revelar o conteúdo.
- **Mala da turma:** progresso "18 de 30" e "Quem leva o quê": itens com `assignee` (coluna nova) mostrados em chip com a cor da pessoa, e "todos" para itens individuais. Tocar leva a `/turma/mala`.
- **Diário:** 2 cartões com foto das últimas inspirações e reações. Durante a viagem, mostra "Hoje" com a última entrada. Tocar leva a `/turma/diario`.
- Rodapé: links para "Ajustes da trilha" e "Conta".

---

## 6. Telas e fluxos que não estão no canvas

Todos seguem os tokens e componentes da seção 3, em `Sheet` no celular, e usam `useAction` (toast e conflito) como hoje.

### 6.1 Lançar gasto (Sheet, a partir do Dinheiro, de um item do roteiro ou do Extrato)

1. **Valor:** `MoneyInput` grande no topo, com foco automático e teclado decimal. A moeda vem da parada atual (S/, Bs) e é trocável por chips (BRL + moedas das paradas). Abaixo, a conversão ao vivo: "≈ R$ 132 · cotação de hoje, fonte X" (`/api/fx`, com a fonte e a data visíveis).
2. **Descrição** (campo de texto) com sugestões de itens do roteiro ainda não pagos enquanto digita ("Ingresso Machu Picchu"). Escolher uma sugestão preenche a categoria, a parada e o **vínculo** (`activity_id` / `stay_id` / `transport_id`).
3. **Categoria:** chips com as categorias do orçamento. É inferida pelo vínculo ou pelo nome (regra de `explore.ts`) e pode ser alterada.
4. **Quem pagou:** chips "Caixa da turma" (padrão quando o caixa tem saldo) e cada membro.
5. **Dividir entre** (só aparece quando quem pagou é uma pessoa): "Todos igual" (padrão), "Escolher pessoas" (checkboxes) ou "Valores diferentes" (um campo por pessoa, que precisa somar ao total; o erro aparece inline). Quando o caixa pagou, a divisão é implícita (caixa), como já faz o `save_expense`.
6. **Data e parada** (recolhido por padrão, já preenchido com hoje e a parada atual).
7. **Prévia do impacto**, antes de salvar: "Baixa R$ 1.050 de Passeios (sobram R$ 2.370) · Caixa fica com R$ 2.610 · Dia 7 marcado como pago". Fica em `--warn` se estourar a categoria ou deixar o caixa negativo.
8. **Botões:** "Salvar gasto" e, quando há vínculo, "Salvar e marcar como pago".

- **Editar gasto:** o mesmo Sheet, com "Excluir" no rodapé (confirmação).
- **Atalhos:** "Marcar como pago" no Sheet de atividade, estadia ou transporte abre este Sheet já preenchido com o vínculo e o valor estimado.

### 6.2 Aporte no caixa (Sheet)

1. **Quem:** chips com os membros. O padrão sou eu. Só o organizador lança por outros; editor só lança o próprio aporte (alinhar com o RLS da seção 7).
2. **Valor:** `MoneyInput` em BRL. Chips rápidos: "O que falta (R$ 3.350)", "Metade (R$ 1.675)" e "Outro".
3. **Data** (hoje) e **nota** opcional ("Pix 12/11").
4. **Tipo:** "Aporte" (padrão) ou "Devolução", esta só para o organizador (`kind:'refund'`).
5. **Prévia:** "Você fica com R$ 6.470 de 6.470 · em dia ✓ · Caixa vai a R$ 12.710".

- Na lista "Cada um no caixa", o organizador tem a ação "Definir cotas": por padrão todos iguais; ou valores por pessoa, gravados em `trip_members.pool_target_cents`.
- **"Lembrar quem está atrasado"** (organizador): cria uma `Task` para cada pessoa atrasada (título "Aporte de R$ x no caixa", `source:'pool'`) e dispara push pelo mecanismo existente em `cron/daily`. A Task aparece na Início da pessoa como sugestão.

### 6.3 Extrato (`/dinheiro/extrato`)

- Lista cronológica de gastos e aportes, agrupada por dia. Cada item mostra ícone, descrição, quem, categoria, valor original e o valor em BRL quando houver conversão.
- Filtros por chips: Todos / Gastos / Aportes / por categoria / por parada / por pessoa.
- Busca por descrição. Tocar abre o Sheet de edição (6.1 ou 6.2).
- Exportar CSV: download local, gerado no navegador.

### 6.4 Acerto de contas (`/dinheiro/acerto`)

- Saldo por pessoa (`balances`) com o caixa como participante, igual a hoje, mais a lista de transferências sugeridas (`suggestTransfers`): "Bia → Rafa · R$ 120" com o botão "Marcar como pago", que cria um `settlement`.
- Fim de viagem: "Sobrou R$ 340 no caixa: devolver R$ 113 para cada" (gera `refund`s), ou "Faltou R$ 90: pedir aporte" (6.2).

### 6.5 Sheets do Roteiro

- **Adicionar parada:** `PlaceSearch` (restilizado), datas de chegada e saída, e "Como chega" (opcional, abre o transporte). Ao salvar, gera sugestões da parada em segundo plano (seção 8.2).
- **Editar parada:** nome, datas, notas, bairro escolhido, foto da capa (escolher entre as fotos Wikimedia sugeridas ou fazer upload), excluir.
- **Transporte:** modo, origem/destino, datas e horas, localizador, assento, **valor por pessoa** e moeda, documento ligado, "Marcar como pago" (6.1).
- **Hospedagem:** nome, endereço, check-in/out, status, **valor por noite** e moeda, link, documento ligado, "Marcar como pago".
- **Atividade** (inclui adicionar a partir de sugestão): dia, hora, título, notas, **custo por pessoa** (o estimado vem preenchido com o selo ESTIMATIVA até alguém confirmar), "Marcar como pago", remover.
- **Escolher dia** (a partir de "Pôr no dia N" de uma sugestão): lista de dias da parada com o número de atividades em cada um. O dia sugerido vem pré-selecionado.

### 6.6 Sheets da Turma

- **Convidar:** papel, validade e usos (formulário atual), link com "Copiar" e "Compartilhar" (`navigator.share`).
- **Nova votação:** pergunta, tipo (hospedagem / passeio / livre), parada, opções (rótulo, detalhe, link, preço, endereço), escolha múltipla, prazo. Fluxo atual restilizado.
- **Votar e decidir:** regras atuais (`cast_vote`, `close_poll`); empate decidido por uma pessoa. Restilizar `PollCard` e o diálogo "Decidir".
- **Documento:** upload com revisão (o fluxo `UploadReview` atual, com OCR e classificação), visualizador em tela cheia no celular e o cofre (`VaultNote`) como Sheet.
- **Item da mala:** nome, categoria, "quem leva" (pessoa ou todos), feito.
- **Entrada do diário:** fase, tipo (inspiração/registro), título, texto, link, lugar, fotos. "Levar pro roteiro" usa o `PromoteDialog` atual em Sheet.

### 6.7 Outras telas restilizadas

- **`/entrar`, `/convite/[token]`, `/conta`, `/offline`:** mesma lógica, visual novo. Telas cheias no celular, com o logo novo, sem cartão centralizado; botões em bloco de 48 px.
- **`/nova-trilha`:** passos com `StepChat`:
  1. "Pra onde?" (busca de destino ou "Ainda não sei", que leva ao Descobrir);
  2. datas, origem e estilo;
  3. turma ("convidar agora ou depois").
  - Sai o passo "Identidade". A cor `accent` é escolhida automaticamente (dicionário ou cor dominante da foto) e pode ser trocada em Ajustes, entre 8 cores pré-aprovadas com contraste validado.
- **`/t/[id]/ajustes`:** formulário atual em seções (Viagem, Datas, Dinheiro, Aparência — só capa e accent —, Zona de perigo).
- **Seletor de trilhas** (Sheet a partir da Início ou da SideNav): cartões com foto e countdown de cada trilha, mais "Nova trilha". Substitui o `IdentityMenu`.

### 6.8 Estados obrigatórios (todas as telas)

| Estado | Comportamento |
|---|---|
| Carregando | `Skeleton` no formato do conteúdo (cartões e foto), nunca spinner |
| Vazio | `EmptyState` com ilustração de traço, frase e uma CTA. Exemplos: "Nenhuma parada ainda → Adicionar parada"; "Sem gastos → Lançar primeiro gasto" |
| Erro | `ErrorBox` com mensagem humana (`humanError`) e "Tentar de novo" |
| Offline | `OfflineBanner` no topo. Ações de escrita desabilitadas, com o texto "Precisa de internet para salvar". Documentos marcados como offline continuam abrindo |
| Cópia salva | Faixa discreta "Mostrando cópia salva de {hora}" |
| Demo | Selo "Demonstração", com ações locais sem salvar, como hoje |
| Viewer | Esconder ações de edição. Voto e reação continuam |

---

## 7. Dados: migração `20261108000008_redesign.sql`

Todas as mudanças são aditivas, nada é apagado. Seguir o padrão das migrações atuais:
- FKs compostas com `trip_id`;
- RLS por papel (`can_edit_trip`, `is_trip_member`);
- tabelas novas em `bump_version` onde houver `version`;
- inclusão na publicação realtime.

| Mudança | Detalhe |
|---|---|
| `trips.accent text` | Hex validado por `check`. Backfill a partir de `identity->palette->acc` ajustado para contraste, ou `#2B3FF5` |
| `trips.budget_plan jsonb` | Respostas do Orçamento: estilo, ritmo, seleção de passeios, snapshot do roteiro usado (para `diffSince`) |
| `transports.price_cents int`, `price_currency text`, `price_is_estimate bool default true` | Custo por pessoa |
| `stays.price_cents int` (por noite, quarto inteiro), `price_currency`, `price_is_estimate`, `link_url text` | |
| `activities.cost_cents int` (por pessoa), `cost_currency`, `cost_is_estimate`, `photo jsonb` | Para de usar `notes` para guardar o custo |
| `stops.area text`, `stops.photo jsonb` | Bairro escolhido; foto escolhida `{url, author, license, source_url}` ou o `cover_path` de upload |
| `expenses.activity_id`, `stay_id`, `transport_id` (nullable, FK composta, `on delete set null`) | Vínculo gasto ↔ item. Atualizar o RPC `save_expense` para aceitar e validar (o item tem de ser da mesma trilha) |
| `budget_categories.kind text check in ('transporte','hospedagem','passeios','comida','outro')` | Backfill pelo nome. Passa a ser usado em vez de casar pelo nome |
| `trip_members.pool_target_cents int null` | Cota individual no caixa (null = planejado ÷ headcount) |
| `packing_items.assignee_id uuid null` | Quem leva |
| **Nova tabela `suggestions`** | `id, trip_id, stop_id null, kind ('destination','activity','area','reminder'), day int null, payload jsonb` (título, por quê, duração, esforço, `cost_low/high`, moeda, `photo_query`, foto resolvida), `status ('new','accepted','voting','dismissed')`, `source ('ai','rules')`, `created_at`, `acted_by`, `acted_at`, `version`. RLS: membros leem, editores escrevem, viewers podem dispensar só para si (ou fica só para editores; decidir na implementação e testar) |
| **Nova tabela `trip_preferences`** | `trip_id, user_id, answers jsonb` (questionário do Descobrir). Cada um edita só a própria linha |

**Também:**
- **Pipeline de tabela nova** (obrigatório para cada uma): `TableName`, `CHILD_TABLES` (marcar `optional` como foi feito com polls, para tolerar migração pendente), `REALTIME_TABLES`, `BUNDLE_KEYS`, `upgradeBundle` em `offline.ts`, `DEFAULTS` em `demoSource.ts` e `lib/demo/build.ts`/`demo.data.ts`.
- **Demo:** atualizar os dados das 4 trilhas com custos, `area`, sugestões, preferências, cotas, `assignee` e gastos ligados. Os números da demo Andes devem bater com o canvas (R$ 6.470/pessoa etc.) para facilitar a conferência visual.
- **Tipos:** atualizar `src/data/types.ts` com todos os campos novos.
- **Dinheiro (`lib/money.ts`):** novas funções puras:
  - `budgetOverview(bundle)`: planejado, juntado, gasto, saldo;
  - `categoryStatus(bundle)`: por categoria, com os itens pagos e não pagos via vínculos;
  - `memberPoolStatus(bundle)`: juntado, meta e status por pessoa;
  - `expenseImpact(draft, bundle)`: a prévia do 6.1.
  Reaproveitar `budgetByCategory`, `poolSummary`, `balances` e `suggestTransfers`.
- **Criptografia:** não muda. O caixa e os gastos continuam protegidos só por RLS, como hoje. Corrigir a frase do README e do SPEC que sugere que o caixa é criptografado.

---

## 8. Serviços novos

### 8.1 Fotos: `src/app/api/photos/route.ts` + `src/lib/photos.ts`

- Entrada: `?q=Cusco&lang=pt` (ou `title=`). Busca o resumo da página na Wikipedia pt/en (`/api/rest_v1/page/summary/{title}`, com fallback de busca por `q`) e, para a imagem, os metadados do Commons (`extmetadata`: Artist, LicenseShortName).
- Resposta: `{url, width, height, author, license, source_url} | null`.
- `User-Agent` identificando o app, **sem e-mail pessoal**.
- Cache: `revalidate` de 30 dias na rota e `cache-first` no `sw.js` para `upload.wikimedia.org` (limite de ~300 entradas).
- Autenticação: exigir usuário logado, como `/api/geo`. A demo usa as fotos já resolvidas e gravadas no `demo.data.ts`.
- **Bairros e passeios** podem não ter página própria. Tentar `"{bairro}, {cidade}"`; se não achar, o `Photo` mostra o placeholder. Nunca usar foto de outro lugar.
- O resultado resolvido é gravado em `stops.photo`, `activities.photo` e `suggestions.payload.photo` para não buscar de novo.

### 8.2 Sugestões automáticas: `src/app/api/ai/suggest/route.ts` + `src/lib/suggestions.ts`

- **Quando gera:**
  - ao criar ou editar uma parada;
  - ao abrir a Início ou o Roteiro, se uma parada não tiver sugestões, ou se as dela tiverem mais de 14 dias e o usuário for editor.
  - Limites: 1 chamada por parada por dia; respeita `consumeQuota`.
- **O que gera:** usa os prompts existentes de `explore` (`activities` com `capPerPerson`, `stays` com `nightlyCap`) e grava o resultado em `suggestions` com `photo_query`. Os prompts são ampliados para devolver `day_fit` (manhã/tarde/dia todo), `effort` e `photo_query`.
- **Sem IA:** `source:'rules'` gera só lembretes (reservas, documentos, aportes, votos), a partir de `ruleAlerts`, `planSteps`, `myPendingVotes` e `memberPoolStatus`.
- **`lib/suggestions.ts`** (puro, testável):
  - `rankForHome(bundle, me)`: ordem da seção 5.1;
  - `slotsForDay(stop, day)`: detecta dia vazio ou com folga;
  - `suggestionsForDay(...)`: escolhe até 3 que cabem no dia e no orçamento (`fitOf`).
- **Ações:**
  - aceitar insere uma `activity` (com `cost_cents` estimado e `suggested_by:'ai'`) e marca `accepted`;
  - votar cria um poll e marca `voting`;
  - dispensar marca `dismissed`.
  Tudo passa pelo `source.insert`/`update` atual.
- Sessão de Explorar em `sessionStorage`: some. Agora tudo é persistido e compartilhado com a turma.

### 8.3 Estimativas: `src/app/api/ai/estimate/route.ts`

- `kind:'transport'` `{tripId}`: para cada trecho sem preço, uma faixa por pessoa e o modo provável.
- `kind:'daily'` `{country, pace}`: faixa de gasto diário com comida.
- Saída sempre como faixa, com `EXPLORE_RULES` e `EstimateNote` na UI. Nada é gravado sem a turma confirmar no Orçamento.

---

## 9. Fases de implementação

Cada fase termina com `npm run typecheck`, `npm test` e o app rodando em `/demo/andes` no celular (390) e no desktop (1280). Um PR por fase, a partir de `main`.

### Fase 0 — Preparação · ✅ concluída

- Ler os guias do Next 16 em `node_modules/next/dist/docs/` (rotas, layouts, redirects, metadata e viewport).
- Criar `planning.md` (este arquivo) na raiz. Adicionar a nota de precedência no topo de `ref/SPEC.md` e o link no README.
- Rodar a suíte atual e anotar a linha de base. Marcar `tests/e2e/demo.spec.ts` como a ser reescrito na Fase 9 (`test.describe.skip` por blocos à medida que cada tela muda, com comentário apontando a fase).

### Fase 1 — Fundação visual · ✅ concluída (ver ressalvas no topo)

- Reescrever `globals.css`: tokens 3.1, reset, utilitários (`.sr`, `.wrap`, `.skip`) e estados.
- Atualizar `lib/fonts.ts` (Inter e Bricolage) e `layout.tsx` (viewport `cover`, `themeColor`).
- Criar os componentes da seção 3.3 em `src/components/ui/`. Montar uma página interna `/dev/ui`, só em desenvolvimento, com todos os componentes e variantes para conferir contra o canvas.
- Reduzir a identidade a `accent` (`lib/identity/accent.ts`, `ThemeApplier`). Remover Grain, Pattern, Marquee, Floaters e MotifCheck, e atualizar quem usava.
- Novo logo (`icon.svg`, PNG 192/512 e maskable) e `manifest.ts`.
- **Aceite:** `/dev/ui` bate visualmente com `Main.dc.html` (paleta, tipografia, botões, chips); as telas antigas ainda abrem, mesmo feias; o typecheck passa.

### Fase 2 — Shell e navegação · ✅ concluída (ver ressalvas no topo)

- `TripShell`: `TabBar` (celular), `SideNav` (desktop), `ScreenHeader`, `OfflineBanner`, faixa de cópia salva e selo de demo.
- Rotas novas (4.3) nos dois árvores (`/t` e `/demo`), redirects em `next.config.ts`, `warmTripPages`, `sw.js` v2 e o seletor de trilhas em Sheet.
- `Sheet` substitui o `Dialog` em toda a base: mesma API, aparência nova.
- Mover as telas existentes para as rotas novas sem redesenhá-las ainda (Documentos, Mala e Diário vão para `/turma/*`; gastos para `/dinheiro`).
- **Aceite:** navegar pelas 4 abas no celular e no desktop; links antigos redirecionam; sem rolagem horizontal entre 360 e 1440 px; Voltar do Android fecha o Sheet.

### Fase 3 — Dados e serviços base · ✅ concluída (ver ressalvas no topo)

- Migração da seção 7, com testes em `tests/db` (RLS das tabelas novas, `save_expense` com vínculos, backfills).
- Atualizar `types.ts`, as sources, `offline.ts` e a demo.
- `lib/money.ts` (funções novas), `lib/photos.ts` + `/api/photos`, `lib/suggestions.ts` + `/api/ai/suggest`, `/api/ai/estimate`, `lib/budgetPlan.ts`.
- **Aceite:** testes unitários novos verdes; a demo carrega com os campos novos; `/api/photos?q=Cusco` devolve foto com autor e licença.

### Fase 4 — Início · ✅ concluída (ver ressalvas no topo)

- `screens/Inicio.tsx` conforme 5.1, incluindo as variações de fase (antes, é hoje, durante, depois) e o `PlanningHome` restilizado.
- **Aceite:** comparar com `Inicio.dc.html` em 390 px; sem IA, as sugestões mostram só regras; "Pôr no dia 4" cria a atividade e o cartão some.

### Fase 5 — Roteiro e página da parada · ✅ concluída (ver ressalvas no topo)

- `Roteiro.tsx` (5.2) e `Parada.tsx` (5.3), mais os Sheets 6.5. Mapa restilizado (pino na cor `accent`, linha brand).
- Mover `StopSuggestions` para dentro da Parada, alimentado pela tabela `suggestions`.
- Links de hospedagem com bairro, datas, pessoas e teto.
- **Aceite:** comparar com `Roteiro.dc.html` e `Parada.dc.html`; os links abrem a busca já filtrada; enviar 3 sugestões para votação cria o poll com preço.

### Fase 6 — Dinheiro · ✅ implementada e validada localmente (ver ressalvas no topo)

- `Orcamento.tsx` (5.5), `Dinheiro.tsx` (5.6), Sheets de gasto e aporte (6.1, 6.2), `Extrato` (6.3), `Acerto` (6.4) e "Marcar como pago" nos itens do roteiro.
- Remover os pedaços de dinheiro de `Mala.tsx`.
- **Aceite:**
  - um gasto pago pelo caixa e ligado a uma atividade baixa o saldo do caixa, aumenta o gasto da categoria e marca a atividade como paga, de uma vez e em tempo real nos outros aparelhos;
  - um aporte muda "Juntado" e o status da pessoa;
  - o Orçamento recalcula ao trocar o estilo ou o ritmo, igual ao artboard interativo.

### Fase 7 — Turma · ✅ implementada e validada localmente (ver ressalvas no topo; Documentos/Diário/Mala restilizados na Fase 9)

- `TurmaHub` (5.7), `Votos`, e `Documentos`, `Mala` e `Diario` restilizados como subtelas. Sheets 6.6.
- Matriz de documentos e "quem leva o quê".
- **Aceite:** comparar com `Turma.dc.html`; os fluxos de voto atuais continuam funcionando (decidir, empate, aplicar ao roteiro).

### Fase 8 — Descobrir e nova trilha · ✅ implementada e validada localmente (ver ressalvas no topo)

- `Descobrir.tsx` (5.4), `trip_preferences`, `/nova-trilha` em `StepChat` sem o passo de identidade, `/t/[id]/descobrir`.
- Remover `screens/Explorar.tsx` e `/identidades`.
- **Aceite:** comparar com `Descobrir.dc.html`; "Montar esta trilha" cria as paradas e leva à Início; "Votar" cria o poll de destino.

### Fase 9 — Polimento, PWA, acessibilidade e testes · ✅ implementada e validada localmente (ver ressalvas no topo; faltam o Lighthouse e remover o resto da compatibilidade em `globals.css`)

- Reescrever `tests/e2e/demo.spec.ts` com as rotas e textos novos:
  - abas;
  - sugestão aceita;
  - links da Parada;
  - Orçamento interativo;
  - gasto ligado baixando a categoria;
  - aporte;
  - votação (reaproveitar os cenários atuais);
  - sem overflow de 360 a 1440 px;
  - `prefers-reduced-motion`;
  - teclado (Tab pelos Sheets).
- Reduzir `tests/unit/identity.test.ts` a accent e contraste. Novos testes: `budgetPlan`, `suggestions`, `money` (`overview`/`impact`), `photos` (parse de `extmetadata`).
- Lighthouse no celular: acessibilidade ≥ 95, performance ≥ 85 (SPEC §15), com atenção ao tamanho das fotos (`srcset` com thumbs da Wikimedia de 400/800/1200).
- Limpeza final:
  - CSS Modules órfãos (`home.module.css`, `planning.module.css`, `plan.module.css`, `onboarding.module.css` antigos);
  - ícones sem uso;
  - `ORS_API_KEY` em `.env.example`, que não é usada;
  - nota no README sobre as colunas de identidade sem uso.

### Fase 10 — Onboarding roteirizado · ✅ implementada e validada localmente (ver ressalvas no topo)

- Especificação completa na **§10**. Esboço aprovado: https://claude.ai/artifact/2M7hXXkoteBPkG1ntmEqr2 (cópia local em `ref/jornada-nova-trilha.html`).
- Ordem sugerida de trabalho, cada item fechando com typecheck e testes:
  1. migration `20261108000010_onboarding.sql` + tipos + pipeline de dados (§10.11);
  2. `headcount` único com `trips.party_size` (§10.9);
  3. correções do Orçamento: noites pela viagem, voo, roteiro vazio, faixa (§10.10);
  4. `lib/onboarding.ts` puro e testado (§10.12);
  5. `explore kind:'places'` e `kind:'route'` + ajustes em `activities` (§10.13);
  6. telas `/nova-trilha` (passo 1) e `/t/[id]/montar` (passos 2 a 6) (§10.3 a §10.8);
  7. limpeza do que sobrou da identidade no onboarding (§10.14);
  8. testes e2e com a IA simulada (§10.16).
- **Aceite:** criar "Itália, 15 dias, 2 pessoas, saindo de São Paulo" termina na Início com 4 a 6 paradas, trechos com preço estimado (incluindo ida e volta), passeios no roteiro e um orçamento por pessoa com hospedagem de 14 noites, voo, trens, passeios e comida. Nenhuma linha de 14 noites ou de voo aparece como R$ 0.

---

## 10. Onboarding roteirizado (Fase 10)

### 10.0 Por que

O teste real com "Itália, 10 dias" mostrou o Orçamento dizendo **≈ R$ 700 por pessoa**: transporte R$ 0, hospedagem "São 0 noites" e R$ 0, passeios R$ 0, comida R$ 700. As causas, no código atual:

- `/nova-trilha` cria a trilha **sem nenhuma parada** (só `destinations: ['Itália']`).
- `budgetFromPlan` conta as noites **pelas paradas** (`for (const s of b.stops)`), então sem parada há 0 noites.
- Transporte e passeios só existem se alguém cadastrar à mão; não existe linha de voo de ida e volta.
- Comida é a única linha que usa as datas da trilha: 10 dias × `DEFAULTS.foodPerDay` (R$ 70) = R$ 700.
- A trilha é dividida por `members.length`, que é 1 enquanto ninguém aceitou convite.

O problema de fundo é a trilha nascer sem roteiro, e o usuário ter de inventar tudo. A Fase 10 faz a Trilha **propor** a viagem inteira no onboarding (lugares, rota, trechos, passeios e custo) e deixa a pessoa ajustar. Junto, corrige o Orçamento para nunca mais mostrar um total baixo que parece certo.

### 10.1 Decisões tomadas (comentários no esboço, 08/11/2026)

1. **Quem cria decide sozinho.** O onboarding não tem votação. Mas a pessoa informa **quantas pessoas vão**, sem precisar convidar ninguém: vira `trips.party_size` e passa a ser o divisor de todas as contas por pessoa (§10.9).
2. **"Perto daqui" aparece sempre.** Além de países vizinhos, a Trilha sugere **cidades próximas que a pessoa provavelmente não sabe que estão perto** (ex.: Siena e Lucca a partir de Florença, Nice a partir de Gênova, Lugano a partir de Milão). Cada uma diz de onde e em quanto tempo se chega.
3. **Voo internacional: estimativa da IA basta.** Sem API de passagens. Sempre faixa com selo ESTIMATIVA.
4. **Sem IA: vai direto para o roteiro manual.** Nenhuma rota "de referência" curada. A tela explica que as sugestões estão indisponíveis e leva ao Roteiro.
5. **Escopo:** este módulo é a **Fase 10**. A antiga seção "10. Verificação ponta a ponta" passa a ser a **§11**.

Continuam valendo as regras de honestidade da IA (decisão 3 do topo): preço sempre como faixa com ESTIMATIVA, sem nome de hotel, sem dizer que reservou ou verificou.

### 10.2 Fluxo, rotas e estado

```
/nova-trilha                      passo 1  pra onde, quando, quantos  → cria a trilha
/t/[id]/montar?passo=2            passo 2  do que vocês gostam
/t/[id]/montar?passo=3            passo 3  o que não pode faltar (+ perto daqui)
/t/[id]/montar?passo=4            passo 4  roteiro sugerido
/t/[id]/montar?passo=5            passo 5  passeios por cidade
/t/[id]/montar?passo=6            passo 6  quanto custa → concluir
```

- **A trilha é criada no fim do passo 1.** As rotas de IA (`loadTripForUser`, `consumeQuota`) e o RLS exigem uma trilha existente; a Fase 8 já esbarrou nisso. Criar cedo também faz o progresso sobreviver a recarregar a página ou trocar de aparelho.
- **`trips.onboarding jsonb`** guarda o rascunho (§10.11): passo atual, marcações do passo 3, desejos, a rota proposta, a seleção de passeios e o `status` (`'em_andamento' | 'concluido' | 'manual' | 'pulado'`). Nada vira parada, trecho ou atividade antes do passo 4 ser aceito.
- **`/t/[id]/montar`** é uma tela nova, `screens/Montar.tsx`, dentro do `TripShell`, com a TabBar escondida (entra em `HIDE_TABBAR`). Usa `StepChat` como `/nova-trilha` e o Descobrir: uma pergunta por vez, respostas anteriores viram `ReplyBubble` editável no topo. Cabeçalho com "Passo N de 6", barra de progresso e "Montar depois".
- **Só editor** abre `/montar`. Leitor é redirecionado para a Início.
- **Retomar:** com `onboarding.status = 'em_andamento'`, a Início mostra no topo um cartão "Continuar montando a viagem · passo N de 6". `/nova-trilha` não reabre: o passo 1 é editado em Ajustes, como hoje.
- **"Montar depois"** (em qualquer passo) grava `status: 'pulado'` e vai para a Início. A trilha fica como as de hoje, e o Orçamento cai no estado "roteiro vazio" (§10.10).
- **Voltar um passo** nunca apaga o que veio depois; só marca como "desatualizado". Ex.: mudar o ritmo no passo 2 depois de ter a rota mostra no passo 4 a faixa "Você mudou o ritmo. Refazer a rota?" com "Refazer" e "Manter".
- **Demo:** `/demo/[key]/montar` não existe (a IA fica desligada na demo). O fluxo é coberto pelos e2e com a IA simulada (§10.16).

### 10.3 Passo 1 — Pra onde, quando e quantos (`/nova-trilha`)

Reescrita da tela atual numa pergunta só, com os campos juntos:

| Campo | Regra |
|---|---|
| Destino | Texto livre, 2–80 caracteres: país, região ou cidade. Vários destinos separados por vírgula viram vários itens em `destinations`. |
| Ida e volta | Obrigatórias, volta ≥ ida. Mostrar abaixo "15 dias · 14 noites". |
| Sem data certa | Chip que troca as datas por **mês + número de dias** (3 a 60). Grava `start_date` = dia 1 do mês e `end_date` = início + dias − 1, e `onboarding.flexible_dates = true`. A Início mostra "datas aproximadas" até alguém editar em Ajustes. |
| Saindo de | Texto, opcional, mas com aviso: "Sem isso a Trilha não estima o voo". Vai para `trips.origin`. |
| Pessoas | Contador de 1 a 50, começa em 2. Vai para `trips.party_size`. Ajuda abaixo: "Contando com você. Dá pra convidar depois, mas não precisa." |
| Horário do embarque | Sai daqui (vai para Ajustes). |
| Estilo (`TripStyle`) | Sai daqui. Passa a ser derivado do passo 2 (hospedagem). |

- **"Ainda não sei o destino"** segue o fluxo atual da Fase 8: pede nome, cria a trilha e abre o Descobrir. **Muda o fim do Descobrir:** "Montar esta trilha" grava o destino escolhido e leva para `/montar?passo=2` (e não mais direto para a Início). O Descobrir deixa de criar paradas sozinho com `planStops`; quem cria a rota passa a ser o passo 4. As cidades do `stops[]` do destino escolhido entram pré-marcadas como "talvez" no passo 3.
- **CTA:** "Continuar". Cria a trilha (mesmo insert de hoje, mais `party_size`, `onboarding: { status: 'em_andamento', step: 2 }`, `identity: null`, `accent: null`) e vai para `/t/[id]/montar?passo=2`.
- **Sai da tela:** chips de destinos do dicionário, `matchDictionary`, a cor de destaque acompanhando o destino e o parâmetro `?identidade=` (§10.14).

### 10.4 Passo 2 — Do que vocês gostam

Três perguntas na mesma tela, todas com uma opção pré-escolhida para dar pra seguir com um toque:

1. **Gostos** (multi, até 6): Natureza, Cidade, Praia, Cultura e história, Arte e museus, Comida, Aventura, Vida noturna, Compras. Amplia `VIBES` de `lib/discover.ts` (hoje são 6; entram `arte`, `noturna`, `compras`; `cultura` passa a se chamar "Cultura e história"). `personFit` continua funcionando, porque compara ids.
2. **Ritmo** (um): "Calmo · poucas cidades" → `leve`; "Equilibrado" → `moderado` (padrão); "Ver tudo" → `intenso`. Mesmo `BudgetPace` do Orçamento.
3. **Onde dormir** (um): Hostel → `economico`; "Pousada / Airbnb" → `equilibrado` (padrão); Hotel → `conforto`. Mesmo `BudgetStyle`. Também define `trips.style` (`economico` → Mochilão, `equilibrado` → Cultural, `conforto` → Conforto), só para manter o campo coerente.
4. **Teto por pessoa** (opcional): `MoneyInput` na moeda base. Grava `trips.budget_total = teto × party_size`, o que o Orçamento já usa para "Sobram / Passou".

Gravação: `trip_preferences` (linha de quem cria, `answers` com `vibes`, `pace`, `stay`, `budget`, `people`, `origin`) e `trips.budget_plan` já iniciado com `{ style, pace }`. Assim o Orçamento abre preenchido mais tarde.

### 10.5 Passo 3 — O que não pode faltar

Tela principal da proposta. Ao entrar, chama `explore kind:'places'` (§10.13) uma vez e guarda o resultado em `onboarding.places`. Recarregar não chama de novo.

**Lista "Lugares para vocês"** (8 a 10 cartões, ordenados pela IA):
- foto (primeiros 3 cartões com `Photo` grande; demais em `row` com miniatura), nome, região, "costuma pedir 2 a 3 noites", uma linha do porquê;
- controle de 3 estados: **Não pode faltar** / **Talvez** (padrão) / **Pular** (`Segmented` compacto);
- tocar no cartão abre um Sheet com mais detalhes: 3 destaques, melhor época se a IA souber, como se chega.

**Seção "Perto daqui"** (decisão 2; aparece sempre, 4 a 8 itens):
- cidades próximas dos lugares da lista, inclusive em países vizinhos, que a pessoa pode não conhecer;
- cada item diz **de onde e em quanto tempo**: "Siena · 1h15 de ônibus de Florença", "Nice, França · 2h de trem de Gênova";
- custo extra por pessoa (transporte ida e volta) como faixa ESTIMATIVA;
- tipo: `bate_volta` (cabe num dia, sem dormir) ou `parada` (pede pelo menos 1 noite);
- mesmo controle de 3 estados, mas o padrão é **Pular**, para não inflar a rota sem a pessoa pedir.

**"Algo que vocês querem fazer?"**: campo livre com chips (até 5 desejos de 80 caracteres): "aula de massa", "ver a Última Ceia". Vai para `onboarding.wishes`. O passo 4 tenta encaixar cada um.

**"Adicionar um lugar"**: campo com `PlaceSearch` para incluir um lugar que não apareceu. Entra como "Não pode faltar".

**CTA:** "Montar o roteiro". Se nada foi marcado como "Não pode faltar", o botão vira "Deixar a Trilha escolher" (a rota usa os "talvez" mais bem ranqueados). Antes de seguir, se a soma das noites mínimas dos "não pode faltar" passar das noites da viagem, aviso: "Esses lugares pedem pelo menos 17 noites e a viagem tem 14. A Trilha vai encurtar ou deixar algum de fora."

**Falha da IA** (503 sem provedor, 502, cota acabou): decisão 4. Tela com "As sugestões estão indisponíveis agora." + "Montar o roteiro eu mesmo" (grava `status: 'manual'`, vai ao Roteiro) + "Tentar de novo" (só para 502).

### 10.6 Passo 4 — Roteiro sugerido

Ao entrar, chama `explore kind:'route'` (§10.13) com as marcações, os desejos, o ritmo e a origem. Guarda a proposta em `onboarding.route`.

**Tela:**
- balão: "Montei 14 noites com os seus indispensáveis. Mexa no que quiser.";
- linha do tempo vertical: **ida** (origem → primeira cidade), paradas, trechos entre elas e **volta** (última cidade → origem). Entrar por uma cidade e sair por outra (open-jaw) é normal e esperado;
- cada parada: nome, país, datas calculadas ("02 a 06/05"), contador **− N noites +**, ↑ ↓ para reordenar (mesmo padrão do "Mover para cima/baixo" do Roteiro, sem arrastar), "Tirar" e a lista de bate-voltas encaixados ("Bate-volta: Siena, dia 7");
- cada trecho: modo, duração e faixa por pessoa com ESTIMATIVA;
- **"Ficou de fora"**: lugares marcados que não couberam, com o motivo da IA ("Costa Amalfitana: precisaria de 3 noites a mais"). Tocar em "Incluir" pede a rota de novo forçando o lugar;
- **"Seus pedidos"**: onde cada desejo foi encaixado ("Aula de massa → Florença") ou "Não achei onde encaixar";
- atalhos que refazem a rota: **Mais calmo**, **Mais lugares**, e um chip "Incluir X" para cada item de "Perto daqui" que ficou como Pular.

**Regras de ajuste** (funções puras em `lib/onboarding.ts`, §10.12):
- as noites somam sempre as noites da viagem. "+" numa parada tira uma noite da parada vizinha com mais noites; "−" dá a noite à vizinha com menos. Mínimo de 1 noite por parada (bate-volta não tem noite);
- reordenar refaz as datas, mas não os trechos: os trechos afetados viram "trecho a recalcular" (sem preço) e o botão "Atualizar preços dos trechos" chama `estimate kind:'transport'` com trechos virtuais (§10.13);
- tirar um lugar marcado como "Não pode faltar" pede confirmação;
- cada regeneração gasta uma chamada de IA. Limite de **6 rotas por trilha** no onboarding (`onboarding.route_calls`); depois disso os atalhos somem e só o ajuste manual continua.

**CTA "Gostei, ver passeios"** aplica a rota de forma atômica pela RPC nova `apply_onboarding_route` (§10.11):
- cria as paradas (`position`, `name`, `country`, `lat`, `lng`, `arrival_date`, `departure_date`, `arrival_mode`);
- cria um trecho por parada com `origin_name` = parada anterior (ou `trips.origin` na primeira), `dest_name`, `mode`, `depart_date`, `duration_min`, `price_cents` = média da faixa, `price_is_estimate = true`;
- cria o **trecho de volta** ligado à última parada, com `is_return = true`, `dest_name = trips.origin`, `depart_date = end_date`;
- grava os bate-voltas como `suggestions` `kind:'activity'`, `status:'accepted'`, com o dia escolhido;
- grava `budget_plan.stay_estimates` e `budget_plan.daily_food_cents` com o que a rota trouxe (§10.13), para o passo 6 não precisar de outra chamada.

Se a trilha já tiver paradas (alguém criou pelo Roteiro em outra aba), a RPC recusa, e a tela mostra "Já existe um roteiro nesta trilha. Substituir?" com confirmação explícita. Substituir apaga só paradas sem gastos ligados e sem documentos; se houver, a RPC recusa com mensagem humana.

### 10.7 Passo 5 — Passeios por cidade

- Ao entrar, chama `explore kind:'activities'` para cada parada (no máximo 3 em paralelo; a cota é consumida por chamada). Mostra cada cidade assim que a resposta dela chega; as outras ficam em skeleton.
- Cada cidade: cabeçalho "Roma · 4 noites" e lista com caixinha, nome, duração e faixa por pessoa com ESTIMATIVA. Desejos encaixados nesta cidade aparecem com o selo **"seu pedido"** e vêm marcados.
- **Pré-seleção** pelo ritmo: `round(dias livres na parada × PACE_PER_DAY[pace])`, escolhendo os que mais combinam com os gostos (`tags` da resposta × `vibes`), excluindo o dia de chegada acima de 2.500 m (`isRestDay`).
- Rodapé fixo: "11 passeios · ≈ R$ 1.650 por pessoa".
- **CTA "Ver quanto custa":**
  - marcados viram `activities` com dia escolhido por `placeDaySuggestions`/`bestDayFor`, `cost_cents` = média da faixa, `cost_is_estimate = true`, `suggested_by: 'ai'`;
  - desmarcados viram `suggestions` `kind:'activity'`, `status:'new'`, para aparecerem depois na Parada e na Início;
  - `budget_plan.activities` recebe os ids dos marcados.
- Falha da IA numa cidade: a cidade mostra "Sem sugestões agora" e o resto segue. Falha em todas: "Pular passeios" leva ao passo 6 com passeios estimados pelo ritmo (regra atual de `budgetFromPlan` sem seleção).

### 10.8 Passo 6 — Quanto custa

- Mesmo cartão escuro do Orçamento (§5.5), já com as correções da §10.10, calculado sobre o bundle recém-gravado:
  - por pessoa: valor do meio e a faixa ("entre R$ 14 e 19 mil");
  - linhas: **Voo ida e volta**, **Trens/ônibus · N trechos**, **Hospedagem · 14 noites** (com estilo), **Passeios · N**, **Comida · 15 dias × R$ X**;
  - total da viagem para `headcount` pessoas;
  - com teto: "Cabe no teto, com folga de R$ 1.900" ou "Passa R$ 2.300 do teto" com 2 sugestões de corte calculadas localmente (trocar o estilo de hospedagem por um mais barato; tirar os 2 passeios mais caros), cada uma com o valor que economiza.
- **CTA "Concluir"**:
  - chama `close_budget` (já existe) com o plano e as categorias. Com 1 membro no app, sem votação (`p_question null`); com mais membros (caso raro: alguém entrou durante o onboarding), cria a votação de aprovação como hoje;
  - grava `onboarding.status = 'concluido'`;
  - vai para a Início, que mostra a viagem já montada.
- **Secundário "Chamar a turma"**: abre o `InviteSheet` da Turma e depois conclui igual. Não cria votação de lugares (decisão 1).

### 10.9 Pessoas na viagem: `trips.party_size`

- Coluna `trips.party_size smallint null check (party_size between 1 and 50)`. `null` em trilhas antigas significa "use os membros".
- **Uma função só:** `headcount(b) = Math.max(b.members.length, b.trip.party_size ?? 1)` em `lib/explore.ts` (já existe com outra regra). Substituir as cópias locais: `ppl` em `lib/budgetPlan.ts`, `people` em `lib/money.ts` e a contagem de `trip_members` em `api/ai/explore` (que passa a usar `headcount(bundle)`).
- **Efeitos:** por pessoa do Orçamento e da Início, cota de cada um no caixa (planejado ÷ headcount), `staySearchLinks` (adultos), prompts de IA (`Pessoas: N`), `diffSince` (tamanho da turma).
- **Não muda:** rateio de gastos e acerto de contas continuam só entre membros no app. Votações contam membros.
- **Onde editar:** Ajustes ("Pessoas na viagem"). Na Turma, o topo passa a dizer "4 pessoas na viagem · 1 no app · Convidar". Se mais membros entrarem do que o `party_size`, vale o maior (pela função) e Ajustes mostra o número atualizado.

### 10.10 Correções no "Quanto custa essa trilha?" (`lib/budgetPlan.ts` e `Orcamento.tsx`)

Valem para qualquer trilha, com ou sem onboarding:

1. **Noites pela viagem.** `nights = daysBetween(start, end)` da trilha. Noites cobertas por paradas seguem a regra atual; **noites sem parada** entram como `nightFor(style) × noites descobertas`, marcadas como estimativa, e o passo de hospedagem diz "São 14 noites, 3 delas ainda sem cidade no roteiro".
2. **Roteiro vazio.** Sem nenhuma parada, o Orçamento **não mostra total**. Mostra `EmptyState`: "A Trilha ainda não sabe por onde vocês vão." com **"Montar o roteiro com a Trilha"** (vai para `/montar?passo=3`, reabrindo o onboarding) e **"Adicionar paradas eu mesmo"** (Roteiro). A Início também troca o número do Dinheiro por "monte o roteiro" nesse caso.
3. **Voo de ida e volta.** Se `trips.origin` existe e falta trecho de ida (ou de volta), a linha de transporte inclui um **trecho virtual** "São Paulo → Roma" (e "Veneza → São Paulo") estimado por `estimate kind:'transport'`, que passa a aceitar trechos sem id (§10.13). O valor aceito vai para `budget_plan.transport_cents` com as chaves `'ida'`/`'volta'`. Sem origem: linha "Voo · informe de onde saem" que abre Ajustes.
4. **Faixa mínima e máxima.** `budgetRange(b, plan, rates)` devolve `{ low, mid, high }` usando os extremos de cada faixa guardada (`stay_estimates`, faixas de transporte e passeios, `foodLevels`). O cartão mostra o `mid` e a faixa abaixo. Valores confirmados entram iguais nos três.
5. **Comida por país.** Em viagem com vários países, `estimate kind:'daily'` é chamado por país e ponderado pelas noites de cada um (fecha a ressalva da Fase 6).
6. **Aviso de mudança com valores.** `diffSince` passa a citar diferenças de preço: "+1 noite em Roma, +R$ 310 em hospedagem" (fecha outra ressalva da Fase 6).
7. **Trecho de volta.** `legInto` (`lib/route.ts`) ignora trechos com `is_return`; o Roteiro mostra a volta como última linha depois da última parada ("Voo Veneza → São Paulo"). `budgetFromPlan` já soma todos os trechos, então a volta entra no total.

### 10.11 Dados: migration `20261108000010_onboarding.sql`

Aditiva, no padrão das anteriores.

| Mudança | Detalhe |
|---|---|
| `trips.party_size smallint null` | `check (party_size between 1 and 50)`. Sem backfill. |
| `trips.onboarding jsonb null` | Rascunho do onboarding (formato abaixo). Só editor escreve (política atual de `trips`). |
| `transports.is_return boolean not null default false` | Trecho de volta para casa, ligado à última parada. No máximo um por trilha (índice único parcial `where is_return`). |
| RPC `apply_onboarding_route(p_trip uuid, p_version int, p_route jsonb, p_replace boolean default false)` | `security invoker`, exige `can_edit_trip`. Numa transação: confere versão; recusa se já houver paradas e `p_replace` for falso; com `p_replace`, recusa se alguma parada tiver gasto ligado ou documento; insere paradas, trechos (com o de volta), sugestões de bate-volta, e atualiza `budget_plan` e `onboarding`. Mensagens humanas nos erros. |

Formato de `trips.onboarding` (tipado em `types.ts` como `OnboardingState`; ler sempre com um `parseOnboarding` que tolera lixo, como `parseAnswers`):

```ts
interface OnboardingState {
  status: 'em_andamento' | 'concluido' | 'manual' | 'pulado';
  step: 2 | 3 | 4 | 5 | 6;
  flexible_dates?: boolean;
  places?: { items: PlaceIdea[]; nearby: NearbyIdea[]; fetched_at: string };
  marks?: Record<string, 'must' | 'maybe' | 'skip'>; // chave = nome normalizado
  wishes?: string[];
  route?: RouteProposal;        // última proposta (antes de aplicar)
  route_calls?: number;         // limite 6
  stale?: ('places' | 'route' | 'tours')[]; // passos desatualizados por edição anterior
}
```

**Pipeline:** `types.ts` (campos opcionais, como na Fase 3), `upgradeBundle` em `offline.ts`, `DEFAULTS` em `demoSource.ts` e `lib/demo/build.ts` (demos com `party_size` igual ao número de membros e `onboarding: null`), `supabaseSource` sem mudança de tabela. Testes de banco em `tests/db/onboarding.test.ts`.

### 10.12 Lógica pura: `src/lib/onboarding.ts`

Testável, sem rede, sem React:

- `parseOnboarding(raw): OnboardingState | null`
- `nightsOf(trip)`: noites da viagem.
- `defaultMarks(places, nearby, preset?)`: "talvez" para lugares, "pular" para perto daqui, "não pode faltar" para os adicionados à mão e "talvez" para as cidades vindas do Descobrir.
- `minNightsOfMust(places, marks)`: para o aviso do passo 3.
- `fitNights(stops, total)`: corrige a soma das noites que a IA devolver (tira das maiores, dá às menores, nunca abaixo de 1); remove paradas do fim se houver mais paradas que noites, levando-as para "ficou de fora".
- `adjustNights(route, index, delta)`: regra do +/−.
- `moveStop(route, from, to)`: reordena e marca trechos afetados como `stale`.
- `datesFor(route, start)`: datas de chegada e saída de cada parada, contíguas.
- `routeToRows(route, trip)`: payload da RPC (paradas, trechos com ida e volta, bate-voltas com o dia).
- `preselectTours(stop, items, vibes, pace)`: pré-seleção do passo 5.
- `tourDay(...)`: reaproveita `placeDaySuggestions`/`bestDayFor`.
- `cutSuggestions(result, cap)`: as 2 sugestões de corte do passo 6.

### 10.13 IA: novos pedidos e ajustes

Todos em `api/ai/explore` (mesma cota, mesma autenticação, só editor), com schemas novos em `lib/ai/prompts.ts`, `EXPLORE_RULES` e o filtro `fair` (sem "reservei", "verifiquei", nome de hotel).

**`kind:'places'`** `{ tripId }` (lê destino, datas, `party_size`, origem e preferências da própria trilha):
```json
{ "items": [{ "name": "", "region": "", "country": "", "lat": 0, "lng": 0, "why": "",
              "nights_min": 1, "nights_max": 3, "highlights": ["", "", ""], "photo_query": "", "tags": [""] }],
  "nearby": [{ "name": "", "country": "", "lat": 0, "lng": 0, "why": "", "from": "Florença",
               "mode": "bus|train|car|boat|plane", "hours": 0, "kind": "bate_volta|parada",
               "cost_low": 0, "cost_high": 0, "photo_query": "" }] }
```
- 8 a 10 `items` do destino e **4 a 8 `nearby`**, sempre (decisão 2): o prompt pede explicitamente "cidades próximas que viajantes costumam não saber que ficam perto, inclusive em países vizinhos, a até ~3h de algum dos lugares".
- O servidor descarta `nearby` com `hours > 4` e duplicados entre listas; calcula a distância em linha reta (`haversineKm`) a partir do `from` para conferir que é perto (> 300 km cai fora).

**`kind:'route'`** `{ tripId, must: string[], maybe: string[], skip: string[], wishes: string[], variant?: 'calmo' | 'mais_lugares', force?: string[] }`:
```json
{ "outbound": { "to": "", "mode": "plane", "hours": 0, "cost_low": 0, "cost_high": 0 },
  "stops": [{ "name": "", "country": "", "lat": 0, "lng": 0, "nights": 1, "why": "",
              "day_trips": [{ "name": "", "day_offset": 1, "cost_low": 0, "cost_high": 0 }],
              "stay_pp_night": { "economico": [0, 0], "equilibrado": [0, 0], "conforto": [0, 0] } }],
  "legs": [{ "from": "", "to": "", "mode": "train", "hours": 0, "cost_low": 0, "cost_high": 0 }],
  "return": { "from": "", "mode": "plane", "hours": 0, "cost_low": 0, "cost_high": 0 },
  "food_pp_day": [{ "country": "", "low": 0, "high": 0 }],
  "left_out": [{ "name": "", "reason": "" }],
  "wishes": [{ "wish": "", "stop": "" }] }
```
- O prompt diz: total de noites exato, todos os `must` incluídos ou explicados em `left_out`, entrada e saída podem ser cidades diferentes, ordem geográfica que evita voltar caminho, ritmo (`leve` ≈ 3+ noites por parada, `intenso` ≈ 2), sem nomes de hotel, preços por pessoa em faixa na moeda base.
- O servidor valida com zod, aplica `fitNights`, confere que `legs` liga as paradas em ordem (refaz `from`/`to` pelos nomes se vier fora) e, se faltar algum `must` sem explicação, pede **uma** nova tentativa; persistindo, devolve mesmo assim com o lugar em `left_out` ("A Trilha não conseguiu encaixar").
- `maxTokens` ~2.400, `temperature` 0,5.

**`kind:'activities'`** (existe): ganha `vibes`, `wishes` e `pace` opcionais no input, e `tags`, `day_fit`, `photo_query` e `wish` (qual desejo atende, se algum) na saída. Respostas sem esses campos continuam válidas.

**`estimate kind:'transport'`** (existe): aceita também `virtual: [{ key: 'ida' | 'volta', from, to }]` para os trechos que não existem no banco (§10.10.3).

**Testes:** schemas com respostas de exemplo em `tests/unit/onboardingAi.test.ts` (resposta boa, noites somando errado, `must` faltando, `nearby` longe demais, texto com "reservei").

### 10.14 O que sai (resto da identidade visual)

- `/nova-trilha`: `DEST`, chips de `DICTIONARY_ORDER`, `matchDictionary`, `applyAccent` pelo destino, gravação de `accent` pelo dicionário e o parâmetro `?identidade=`.
- Links que ainda mandam `?identidade=` (procurar em `src/` e nos e2e) passam a abrir `/nova-trilha` limpo.
- Depois disso, conferir quem ainda usa `lib/identity/dictionary(.data)`. Se só a demo usar, mover os dados necessários para `lib/demo/` e apagar o dicionário. `accent.ts` e `contrast` ficam (cor da trilha em Ajustes).
- `trips.identity` e `identity_version` continuam no banco, sem uso (já documentado no README).

### 10.15 Estados obrigatórios (além da §6.8)

| Estado | Comportamento |
|---|---|
| Carregando IA | Skeleton do passo + balão da Trilha com o que está fazendo ("Procurando lugares que combinam com vocês…", "Montando a rota…"). Sem spinner solto. |
| IA indisponível (503) | Decisão 4: mensagem + "Montar o roteiro eu mesmo". |
| IA falhou (502) ou cota | "Tentar de novo" + "Montar o roteiro eu mesmo". A cota acabada diz quando volta. |
| Offline | `ensureOnline` antes de cada chamada; o passo mostra a faixa de offline e mantém o que já carregou. |
| Leitor | `/montar` redireciona para a Início. |
| Recarregar no meio | Volta ao passo salvo, com os dados do `onboarding`, sem chamar a IA de novo. |
| Duas abas | A RPC confere a versão; a outra aba recebe "A viagem mudou em outra tela" e recarrega. |

### 10.16 Testes

- **Unitários:** `lib/onboarding.ts` (todas as funções da §10.12, incluindo open-jaw, trecho de volta, 1 noite mínima, mais paradas que noites); `budgetPlan` (noites pela viagem, roteiro vazio, voo virtual, `budgetRange`, comida ponderada por país, `party_size` como divisor); `headcount`; schemas da §10.13.
- **Banco (PGlite):** `party_size` fora de 1–50 recusado; `is_return` único por trilha; `apply_onboarding_route` atômica (falha no meio desfaz tudo), recusa com paradas existentes, recusa substituir parada com gasto ligado, só editor; RLS de `onboarding`.
- **E2E (Playwright, IA simulada com `page.route` em `/api/ai/explore` e `/api/ai/estimate`, contra um Supabase de teste ou o caminho já usado pelos testes de conta real; se não houver, cobrir pela demo com uma trilha local):**
  1. fluxo completo "Itália, 15 dias, 2 pessoas, São Paulo" até a Início com paradas, trechos (com volta) e passeios;
  2. o passo 6 mostra hospedagem de 14 noites, voo e total por pessoa dividido por 2;
  3. IA 503 no passo 3 leva ao Roteiro manual;
  4. recarregar no passo 4 volta ao passo 4 sem nova chamada à IA (contar requisições);
  5. "+" e "−" de noites mantêm a soma;
  6. Orçamento de trilha sem paradas mostra o estado vazio e não um total;
  7. sem rolagem horizontal de 360 a 1440 px em `/nova-trilha` e `/montar`.

### 10.17 Fora do escopo

- Busca de preço real de passagens (decisão 3).
- Votação de lugares no onboarding (decisão 1). A turma pode votar depois, pelos fluxos existentes.
- Rota de referência sem IA (decisão 4).
- Arrastar para reordenar (continua ↑ ↓).
- Mapa no passo 4: a linha do tempo basta nesta fase. O mapa do Roteiro já mostra a rota depois de aplicada (agora com coordenadas vindas da IA, o que também fecha a ressalva da Fase 8 sobre paradas sem coordenadas).

---

## 11. Verificação ponta a ponta

1. `npm run typecheck && npm test`: unitários e banco (pglite) verdes, incluindo RLS das tabelas novas.
2. `npm run build && npm run test:e2e`: Playwright na demo.
3. Manualmente, em `npm run dev`:
   - `/demo/andes` no navegador com emulação de iPhone (390×844) e em 1280 px, comparando cada tela lado a lado com o artboard do canvas;
   - instalar como PWA no celular (Android/iOS): sem barra do navegador, TabBar respeitando a área segura, Sheet com Voltar;
   - fluxo real com Supabase: criar trilha por "Ainda não sei" → Descobrir → Montar esta trilha → passos 2 a 6 do onboarding → Orçamento → aporte → gasto ligado → conferir em outro aparelho (realtime);
   - onboarding com destino e IA real (Fase 10): "Itália, 15 dias, 2 pessoas, São Paulo" → conferir lugares e "Perto daqui", rota com ida e volta, passeios e orçamento de 14 noites; repetir com a IA desligada e conferir que cai no Roteiro manual;
   - modo avião: ler a Início, o Roteiro e os documentos offline; as ações de escrita mostram o aviso.
4. Conferir a honestidade: toda estimativa com o selo ESTIMATIVA; nenhum nome de hotel vindo da IA; foto sempre com crédito; nada de "verificado"/"reservado" dito pela IA.

## Arquivos críticos

- `src/styles/globals.css`, `src/lib/fonts.ts`, `src/app/layout.tsx`, `src/app/manifest.ts`, `public/sw.js`, `next.config.ts`
- `src/components/shell/TripShell.tsx`, `ThemeApplier.tsx`, `ServiceWorker.tsx`, `src/components/ui/*`
- `src/screens/*` (todas) e as novas `Inicio`, `Parada`, `Dinheiro`, `Orcamento`, `Descobrir`, `TurmaHub`
- `src/data/types.ts`, `supabaseSource.ts`, `demoSource.ts`, `offline.ts`, `src/lib/demo/*`
- `src/lib/money.ts`, `explore.ts` (`staySearchLinks`, `fitOf`, `nightlyCap`), `plan.ts`, `polls.ts`, `rules.ts`, `lib/ai/prompts.ts`
- Novos: `supabase/migrations/20261108000008_redesign.sql`, `src/app/api/photos`, `src/app/api/ai/suggest`, `src/app/api/ai/estimate`, `src/lib/suggestions.ts`, `budgetPlan.ts`, `photos.ts`
- `tests/e2e/demo.spec.ts`, `tests/unit/*`, `tests/db/*`
- Fase 10: `src/app/nova-trilha/page.tsx`, novo `src/screens/Montar.tsx` + `src/app/t/[tripId]/montar/page.tsx`, novo `src/lib/onboarding.ts`, `src/lib/budgetPlan.ts`, `src/lib/explore.ts` (`headcount`), `src/lib/money.ts`, `src/lib/route.ts` (`legInto`), `src/lib/discover.ts` (`VIBES`), `src/screens/Descobrir.tsx`, `src/screens/Orcamento.tsx`, `src/screens/Inicio.tsx`, `src/screens/EditTrip.tsx`, `src/app/api/ai/explore/route.ts`, `src/app/api/ai/estimate/route.ts`, `src/lib/ai/prompts.ts`, nova `supabase/migrations/20261108000010_onboarding.sql`
