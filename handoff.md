# Handoff — Fase 6 (Dinheiro) · parcial

Data: 08/11/2026 · branch `docs/planning-redesign`

A implementação da Fase 6 (planning §5.5, §5.6, §6.1–6.4 e §9 Fase 6) foi **interrompida a pedido** no meio. Só a **camada de lógica pura** foi escrita. **Nenhuma tela mudou ainda**: `Dinheiro`, `Orcamento`, `Extrato` e `Acerto` continuam sendo os embrulhos temporários da Fase 2 sobre pedaços de `Mala.tsx`.

**Base:** rebaseado por cima da Fase 5 (`c6015fd`).

**Estado verificado ao parar (depois do rebase):** `npx tsc --noEmit` limpo; `npx vitest run tests/unit` com 114 de 114 verdes. Não rodei os testes de banco, o build nem o e2e. As funções novas **ainda não têm testes**.

---

## 1. O que foi feito

### `src/data/types.ts`
- Novo tipo `BudgetFood = 'econ' | 'medio' | 'solto'`.
- `BudgetPlan` ganhou 2 campos opcionais. Ficam dentro do `trips.budget_plan` (jsonb), então **não precisa de migration**:
  - `food?: BudgetFood | null`: ritmo de comida escolhido;
  - `transport_cents?: Record<transportId, number> | null`: valor por pessoa aceito no Orçamento para trechos sem preço.

### `src/lib/budgetPlan.ts`
- **`STYLES` agora são Hostel / Pousada / Hotel**, como no canvas. As chaves continuam `economico | equilibrado | conforto`. Cada estilo ganhou `detail` e `note`, a frase da Trilha. As notas são genéricas de propósito: não citam hotel e não afirmam preço.
- **Referências recalibradas para o canvas:**
  - `DEFAULTS.nightPerPerson` passou de 12000 para 9000;
  - `STYLE_FACTOR` passou a `{0.6, 1, 1.9}`, o que dá ≈ R$ 54 / 90 / 171 por noite e por pessoa;
  - `DEFAULTS.foodPerDay` passou de 9000 para 7000.
- **Comida:** `FOODS` (Econômico 0.65 / Médio 1 / Solto 1.7) e `foodLevels(range?)`. Com a faixa da IA (`/api/ai/estimate kind:'daily'`), os 3 ritmos usam o mínimo, a média e o máximo da faixa; sem ela, usam a referência × fator.
- `nightFor(style)`: noite por pessoa de cada estilo.
- **Mudanças em `budgetFromPlan`:**
  - Trecho sem preço usa `plan.transport_cents[id]`, que conta como estimativa (`estimatedCents` da linha de transporte).
  - **Com `plan.activities` definido**, entram só os escolhidos (via `tourOptions`): atividades **e sugestões** da Trilha. A reserva de "dias livres × ritmo" deixa de entrar.
  - **Sem `plan.activities`**, o comportamento antigo continua igual: todos com preço mais a reserva por ritmo. Os testes antigos dependem disso.
- **Funções novas para os passos da conversa:**
  - `legTitle`, `transportLegs(b, plan, rates)`: passo 1. Cada trecho vem com `from: 'roteiro' | 'trilha' | null`;
  - `stayOptions(b, rates)`: passo 2. As 3 opções com o total por pessoa, mais `nights` e `fixed` (paradas com estadia que já tem preço);
  - `tourOptions(b, rates)`: passo 3. Atividades com custo ("no roteiro · dia N") e sugestões `activity` com status `new`/`voting` ("sugestão da Trilha" / "em votação");
  - `initialPlan(b, rates)`: o plano gravado, ou Pousada + Médio + passeios do roteiro marcados e sugestões desmarcadas. Tira ids que sumiram;
  - `capPerPerson(b)`: `budget_total ÷ turma`;
  - `describeChanges(changes)`: texto do aviso "Mudou desde a última vez".
- Agora importa `estimateCents` de `lib/suggestions.ts`. Não há ciclo: `suggestions` não importa `budgetPlan`.

### `src/lib/money.ts` (bloco "Fase 6" no fim do arquivo)
- **`ledger(b)`**: o Extrato. Junta gastos, aportes, devoluções e pagamentos num `Movement[]` (valor na base, original quando a moeda é outra, categoria, parada, item ligado e quem dividiu), do mais recente para o mais antigo.
- **`filterMovements(list, {type, categoryId, stopId, person, q})`**: os filtros da §6.3. O filtro de pessoa pega quem pagou, quem dividiu, quem aportou e os dois lados de um pagamento.
- **`movementsCsv(list, {...})`**: CSV com `;` e vírgula decimal, para o Excel em pt-BR.
- **`unpaidItems(b, rates)`**: itens do roteiro ainda sem gasto ligado. Alimenta a autocompletar da descrição no Sheet de gasto.
- **`paymentPreset(b, type, id, rates)`**: descrição, categoria, parada e valor para "Marcar como pago".
- **`itemLabel(b, type, id)`**: o último elo da cadeia "Caixa → Passeios → Dia 7 ✓ pago".
- **`categoryContext(b, cat)`**: a linha do cartão da categoria, com estes casos:
  - "X pago · falta Y";
  - "Tudo pago: …";
  - comida mostra "Reserva para a viagem, R$ 70 por pessoa/dia";
  - hospedagem sem nada pago e com enquete de estadia aberta mostra "{parada} em votação".
- **`recentHit(b, now)`**: o gasto das últimas 24 h que dá o destaque "Acabou de baixar".
- **`poolQuickAmounts(member)`**: os chips "O que falta" e "Metade".
- **`customSplit(total, values)`**: a divisão "valores diferentes" e a diferença que falta para fechar o total.

---

## 2. O que falta (na ordem sugerida)

1. **Testes unitários** das funções novas, em `tests/unit/redesign.test.ts` ou num `money6.test.ts`:
   - `transportLegs`, `stayOptions` (Hostel < Pousada < Hotel; estadia com preço não muda entre estilos), `tourOptions`, `initialPlan`, `foodLevels`;
   - `budgetFromPlan` com `activities` explícito (inclui sugestão e não soma a reserva) e com `transport_cents`;
   - `ledger`/`filterMovements`/`movementsCsv`, `categoryContext` com os números da demo Andes, `recentHit`, `customSplit`.
2. **`src/components/money/`** (novo):
   - `useFx.ts`, movido de `Mala.tsx`. `rates[c]` é base→c, então a taxa para a base é `1 / rates[c]`;
   - **`ExpenseSheet`** (§6.1):
     - `MoneyInput` com os chips de moeda (base + moedas das paradas + USD) e "≈ R$ x · cotação de {data}, fonte {X}"; taxa manual quando o `/api/fx` falhar;
     - descrição com as sugestões de `unpaidItems`; escolher uma preenche o vínculo, a categoria, a parada e o valor;
     - chips de categoria; quem pagou (Caixa é o padrão quando o saldo é > 0);
     - "Dividir entre": Todos / Escolher / Valores diferentes. Quando o caixa paga, a divisão é igual entre todos;
     - data e parada recolhidas; prévia com `expenseImpact`, em `--warn` se estourar;
     - botões "Salvar e marcar como pago" (estadia `pending` vira `booked`) e "Salvar sem ligar"; na edição, "Excluir".
     - Salva pelo RPC `save_expense` com `activity_id`/`stay_id`/`transport_id` dentro de `p_expense`. A demo já aceita.
   - **`ContributionSheet`** (§6.2): pessoa (só o organizador lança por outros), valor com os chips de `poolQuickAmounts`, data, nota, Aporte/Devolução (devolução só para o organizador) e a prévia com `memberPoolStatus` sobre um bundle simulado. **`pool_contributions` não aceita UPDATE no RLS**: o modo edição só mostra os dados e oferece "Excluir".
   - **`QuotasSheet`**: só o organizador. `source.updateWhere('trip_members', {trip_id, user_id}, {pool_target_cents})`, que a política `members_update` permite.
   - **"Lembrar quem está atrasado"**: cria uma `tasks` por pessoa atrasada com `source:'rules'`, `assignee_id`, `due_date` = hoje e `alert_key` `pool:<uid>`, sem duplicar as que ainda estão abertas. O push sai pelo `cron/daily`, que já avisa as tasks que vencem em 0–1 dia.
   - **`CategorySheet`**: ajustar o planejado, ver os gastos da categoria e os itens não pagos (cada um abre o `ExpenseSheet` já preenchido).
   - `Converter` restilizado e recolhível.
3. **Telas:**
   - **`Dinheiro.tsx`** (§5.6, canvas `Dinheiro.dc.html`, que tem uma cópia em `scratchpad/artifact-files/.../project/`):
     - resumo com 3 `Stat` e `Progress` em 2 camadas (juntado `#C7CEFF`-ish e gasto `--sun`);
     - cartões por categoria com a barra `--cat-*` pelo tipo, `categoryContext` e o destaque de `recentHit`;
     - último movimento com a cadeia, "Cada um no caixa" e as ações;
     - no celular, o botão fixo "Lançar gasto ou aporte" acima da TabBar, que abre um Sheet de escolha; no desktop, 2 botões;
     - Acerto e Extrato em `ListRow`; EmptyState quando não há orçamento.
   - **`Orcamento.tsx`** (§5.5, canvas `Orcamento.dc.html`):
     - cartão escuro fixo no topo com por pessoa, turma, barra segmentada, legenda e "Sobram/Passou R$ x do teto";
     - aviso de `diffSince` + `describeChanges`;
     - 4 passos em `StepChat`:
       - transporte: editar o valor de um trecho; "Estimar com a Trilha" chama `/api/ai/estimate kind:'transport'`;
       - estilo;
       - passeios em checklist;
       - comida, com a estimativa `daily` opcional.
     - **"Fechar orçamento e abrir o caixa":**
       - grava `budget_categories.planned` com `plannedUpdates` e cria as categorias que faltarem, com `kind`;
       - grava `trips.budget_plan` com `snapshotOf`;
       - grava em `transports.price_cents` (`price_is_estimate=false`) só os valores **digitados** pela turma; estimativas da IA ficam só no plano;
       - com mais de uma pessoa na turma, cria o poll `free` "Aprovar orçamento de R$ X por pessoa?" com Sim/Ajustar;
       - leva ao Dinheiro.
     - **Não sobrescrever `trips.budget_total`**: ele é o teto.
   - **`Extrato.tsx`** (§6.3): busca, chips de filtro, lista agrupada por dia, toque abre o Sheet e "Exportar CSV" com Blob.
   - **`Acerto.tsx`** (§6.4): saldo por pessoa (`balances`, com o caixa), transferências com "Marcar como pago" (a lógica de `settle` do `Debts` atual) e "Sobrou/Faltou no caixa".
4. **"Marcar como pago" no Roteiro:** a Fase 5 entrou na branch enquanto esta fase andava, e os Sheets do roteiro agora estão em `src/components/route/RouteSheets.tsx` (`TransportSheet`, `StaySheet`, `ActivitySheet`, que já têm `PriceField`). Falta um botão "Marcar como pago" em cada um, que abre o `ExpenseSheet` com `paymentPreset`; se o item já está pago, mostra "Pago ✓". Confira também se `RouteSheets.tsx` já tem helpers de moeda (`tripCurrencies`) para reaproveitar no `ExpenseSheet`.
5. **Limpar `Mala.tsx`:** apagar `useFx`, `Budget`, `BudgetDialog`, `Pool`, `PoolDialog`, `StopSpend`, `Converter`, `Debts`, `ExpenseList` e `ExpenseDialog`, e os imports que sobrarem. Hoje só as 4 telas temporárias de dinheiro os usam.
6. **e2e** (`tests/e2e/demo.spec.ts`), um teste para cada aceite:
   - gasto pelo caixa ligado à atividade "Vale Sagrado" (demo Andes) baixa o caixa, sobe Passeios e marca o item como pago;
   - aporte muda "Juntado" e o selo da pessoa;
   - no Orçamento, trocar Hostel/Hotel e o ritmo de comida muda o total.
7. **Verificação:** `npm run typecheck`, `npm test`, `npm run build`, `npx playwright test`, e `/demo/andes/dinheiro` em 390 e 1280 px sem rolagem horizontal. Depois disso, atualizar `planning.md`: status e ressalvas da Fase 6.

---

## 3. Ressalvas e decisões já tomadas

- **Bug da Fase 4 encontrado, ainda não corrigido.** Em `screens/Inicio.tsx` (cartão do dinheiro), o `<Progress value={Math.min(100, money.pooledPct ?? 0)}>` passa uma porcentagem de 0 a 100, mas o `Progress` espera um valor de 0 a 1. A barra aparece sempre cheia. A correção é `value={(money.pooledPct ?? 0) / 100}`.
- **Semântica nova de `budgetFromPlan`.** Com uma seleção explícita de passeios, o total é exatamente o que aparece na tela, sem reserva escondida. O campo `pace` fica gravado, mas a tela nova não o usa: o "ritmo" do canvas é o de comida (`food`).
- **Comida da demo.** A Andes tem `daily_food_cents: 9000` e Comida planejada em R$ 4.200. O canvas mostra R$ 70/dia e R$ 3.150. Não mexi nos dados da demo: o cartão vai mostrar "R$ 90 por pessoa/dia".
- **Hospedagem pela mediana do `explore stays` (§5.5): não implementado.** Fica a tabela de regras (`nightFor`). Se fizer, entra como faixa com ESTIMATIVA.
- **Editor só lança o próprio aporte.** Isso será garantido só na interface: o RLS de `pool_contributions` deixa qualquer editor inserir para qualquer `user_id`. Para valer no banco, é preciso uma migration nova, que não foi criada.
- **A task de "lembrar atrasados" não vira cartão novo na Início.** A Início já mostra "aporte atrasado" a partir de `memberPoolStatus`; a task serve para o push e para a lista de pendências.
- **Ambiente.** Neste sandbox, `/api/fx` responde 502 (sem rede externa). O `ExpenseSheet` precisa do caminho da taxa manual. A IA também não está configurada aqui, então as estimativas caem nas regras.
