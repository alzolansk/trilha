# Checklist rastreável

Legenda: **✅ verificado** (teste automatizado ou inspeção visual registrada) · **🟡 implementado, verificação pendente** · **⛔ bloqueado por configuração externa**.
Nada é marcado ✅ só porque a interface existe.

## Critérios de aceite (SPEC §15)

| # | Critério | Implementação | Verificação | Status |
|---|---|---|---|---|
| 1 | Trocar identidade muda todas as telas sem recarregar, sem cor fixa | `ThemeApplier.applyIdentity`, `theme.ts`, ciclo `CYCLE_VARS` | e2e `trocar de trilha troca o tema sem sobrar cor anterior` | ✅ |
| 2 | 4 identidades batem com §4.3 | `dictionary.data.ts` (gerado do protótipo) | unit `dicionário bate com o SPEC §4.3`, e2e tokens no `<html>` | ✅ |
| 3 | Fendas seguem §6.3 a 60fps | `shapes.clipFor`, rAF + escrita direta | unit valores das 4 fendas; e2e clip-path muda com scroll. 60fps **não medido** | 🟡 |
| 4 | Rota desenha e acende nas frações do caminho | `pathFractions` (comprimento real das cúbicas) | unit frações crescentes não uniformes; e2e acendimento parcial | ✅ |
| 5 | Números contam, pendências em sequência, CTA, barra de progresso | `Home.tsx` (p3, p4, p5, progress) | inspeção visual 1440/390 (Andes, Japão) | ✅ |
| 6 | Reveals uma vez; checkbox em motif com teclado/leitor | `useReveal` (unobserve), `MotifCheck` com input nativo | e2e teclado (Espaço marca) | ✅ |
| 7 | Upload classifica e liga à parada com correção manual | `extract.ts`, `classify.ts`, `/api/ai/classify`, `UploadReview` | unit classificação; upload real | ⛔ Supabase |
| 8 | reduced motion; contraste validado em identidades de IA | CSS `.reduced`, `validate.ts` + `repairPalette` | e2e reduced motion; unit correção de contraste | ✅ |
| 9 | Sem rolagem horizontal 360/390/768/1280/1440 | layouts flex/grid com `min()` | e2e 5 larguras × 6 telas × 2 identidades | ✅ |
| 10 | Lighthouse a11y ≥95, perf mobile ≥85 | SSR da demo, tokens no HTML, Shippori sob demanda (−165 KB CSS), grão em PNG, reveal sem esconder o 1º paint | Lighthouse 12 mobile, build de produção local (4 out 2026): **a11y 100** em 6 telas; **perf 72–84** (simulado) e 76–87 (throttling real). LCP simulado 4,3–5,0 s ligado ao JS inicial | 🟡 perf abaixo da meta |

## Requisitos do pedido

| Requisito | Onde | Verificação | Status |
|---|---|---|---|
| Next.js App Router + TS estrito | `src/app`, `tsconfig.json` | `npm run build`, `npm run typecheck` | ✅ |
| Countdown meses de calendário/dias/horas/min, fusos | `lib/time.ts` | unit (dia 31, DST Lisboa, referência) | ✅ |
| Estados antes/hoje/durante/depois | `derive.tripPhase`, `Home.tsx` | unit fases | ✅ |
| RLS em todas as tabelas, papéis organizer/editor/viewer | migrations 0001–0003 | 26 testes RLS em PGlite + `tmp/real-e2e.mjs` no projeto real (6 out 2026): papéis, leitora não edita nem se promove | ✅ |
| Convites com hash, expiração, revogação, limite | RPCs + `Turma.tsx` | testes RLS | ✅ local |
| Storage privado + políticas | migration 0002 | projeto real: envio, leitura por visibilidade, terceiro não baixa nem assina link, bucket não público | ✅ |
| Upload sem órfãos (linha uploading → arquivo → ready; desfaz em erro) | `Documentos.saveOne` | protocolo testado por script no projeto real; fluxo pela tela pendente | 🟡 |
| Offline real de documentos (IndexedDB, estado separado da preferência) | `offline.ts`, `offlineSync.ts`, `sw.js` | — | ⛔ Supabase (precisa de arquivo real) |
| Limpeza local ao sair | `wipeAllLocalData` | — | 🟡 |
| Colaboração em tempo real e conflitos (versão) | `supabaseSource.subscribe`, `update(..., version)` | projeto real: duas sessões, evento recebido; gravação com versão antiga não altera | ✅ |
| Gastos: rateio em centavos, taxa gravada, acertos registrados | `money.ts`, `save_expense`, `Mala.tsx` | unit + RLS local; projeto real: gasto com rateio grava, rateio que não fecha é recusado | ✅ |
| Câmbio com fonte e data, taxa manual | `/api/fx`, `ExpenseDialog` | fontes testadas por curl | ✅ |
| Mapa com atribuição, linha não é trajeto | `RouteMap.tsx` | — | 🟡 |
| Busca de lugares (Nominatim) | `/api/geo` | requer login | ⛔ Supabase |
| IA: 6 endpoints, alternância, validação, fallback | `lib/ai/*`, `api/ai/*` | pelo app logado (6 out 2026): identidade, dicas, mala, alertas, classificação e retrospectiva respondem via Gemini `gemini-3.5-flash-lite` e Groq `openai/gpt-oss-120b`; troca de provedor observada. OpenRouter sem chave | ✅ (Gemini/Groq) / ⛔ OpenRouter |
| Identidade: dicionário → IA → validação → regras → persistência | `api/ai/identity`, onboarding | unit gerador/validador; real: Cusco/Marrakech → dicionário, Lisboa/Hanói/Ushuaia → Gemini, Cartagena → Groq | ✅ |
| Notificações push diárias | `api/cron/daily`, `conta` | — | ⛔ VAPID + deploy |
| Analytics opt-in | migration 0003, `analytics.ts` | teste RLS opt-in | ✅ local |
| Demonstração separada dos dados reais | `/demo/[key]`, `demoSource` (memória) | e2e | ✅ |
| Fluxos de duas contas, acesso de terceiro negado | convites, RLS | projeto real com 3 contas de teste: convite, aceite, token inválido, terceiro sem leitura/escrita/convite | ✅ |
