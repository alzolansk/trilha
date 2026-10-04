# Trilha

Countdown de viagens que vira a central da viagem: roteiro, documentos offline, mala, gastos e diário com a turma. Cada trilha tem uma **identidade visual própria** gerada a partir do destino.

> **Referências de produto:** `ref/SPEC.md` (vence conflitos), `ref/trilha-prototipo.html` (visual e comportamento), `ref/Trilha · Design System.pdf` (conferência visual).
> O antigo `ref/Design.html` **foi substituído** por essas referências e não é mais usado.

## Stack

| Camada | Escolha | Por quê |
|---|---|---|
| App | Next.js 16 (App Router), React 19, TypeScript estrito | SPEC §2 |
| Estilo | CSS Modules + custom properties (tokens de tema injetados no `<html>`) | SPEC §4 |
| Dados | Supabase: Auth, Postgres com RLS, Storage privado, Realtime | sem servidor próprio |
| IA | Rotas `/api/ai/*` com Gemini → Groq → OpenRouter (alternância e fallback por regras) | SPEC §9 |
| Offline | Service worker próprio (`public/sw.js`) + IndexedDB por usuário | SPEC §2.1 |
| Hospedagem | Vercel Hobby (uso pessoal, não comercial) + Supabase Free | custo zero |

## Rodar localmente

```bash
npm install
cp .env.example .env.local   # preencha as variáveis (veja abaixo)
npm run dev                  # http://localhost:3000
```

Sem Supabase configurado, a **demonstração** funciona: `http://localhost:3000/identidades` → "Ver demonstração" (4 trilhas fictícias, nada é salvo).

Comandos:

```bash
npm run typecheck   # TypeScript
npm test            # Vitest: cálculos, identidades, regras + RLS num Postgres em WASM (PGlite)
npm run build       # build de produção
BASE_URL=http://localhost:3000 npm run test:e2e   # Playwright (usa o Chrome instalado)
```

## Variáveis de ambiente

| Variável | Pública? | Para quê |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | sim | URL do projeto |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | sim | chave publishable/anon (segurança vem do RLS) |
| `NEXT_PUBLIC_SITE_URL` | sim | URL pública (links de convite, retorno do login) |
| `NEXT_PUBLIC_AUTH_GOOGLE` / `_APPLE` / `_MAGIC_LINK` | sim | `1` mostra o botão depois que o provedor estiver configurado |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | sim | push (gere com `npx web-push generate-vapid-keys`) |
| `SUPABASE_SECRET_KEY` | **não** | só a rotina diária de notificações (`/api/cron/daily`) |
| `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | **não** | envio de push |
| `CRON_SECRET` | **não** | protege o cron (o Vercel envia `Authorization: Bearer …`) |
| `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` (+ `*_MODEL`) | **não** | IA (todas opcionais) |
| `AI_DAILY_LIMIT_PER_USER` | **não** | limite diário de chamadas de IA por pessoa (padrão 60) |

Nunca use o prefixo `NEXT_PUBLIC_` para segredos. A service-role/secret key não é usada no navegador.

## Configurar o Supabase

1. Crie um projeto (plano Free) em https://supabase.com.
2. Aplique as migrations de `supabase/migrations/` **em ordem** (SQL Editor, `supabase db push` ou MCP):
   `…0001_schema.sql` → `…0002_policies.sql` → `…0003_spec_v3.sql`.
   Elas criam tabelas, RLS em todas as tabelas, RPCs de convite (`create_invite`, `preview_invite`, `accept_invite`), `save_expense`, buckets privados (`documents` 25 MB, `journal`, `covers`) e políticas de Storage.
3. **Authentication → Providers → Email:** para seus amigos entrarem sem SMTP próprio, **desligue "Confirm email"**. O SMTP embutido do Supabase só envia para membros da equipe do projeto e no máximo 2 e-mails/hora; link mágico e "esqueci a senha" só funcionam de verdade com um SMTP próprio (ex.: Brevo gratuito, 300/dia) em *Authentication → SMTP Settings*. Depois ligue `NEXT_PUBLIC_AUTH_MAGIC_LINK=1`.
4. **Authentication → URL Configuration:**
   - Site URL: `https://SEU-APP.vercel.app`
   - Redirect URLs: `http://localhost:3000/auth/callback`, `https://SEU-APP.vercel.app/auth/callback`, `https://*-SEU-USUARIO.vercel.app/auth/callback` (previews)
5. **Google (opcional, gratuito):** Google Cloud Console → Credenciais → ID do cliente OAuth (Aplicativo da Web), URI de redirecionamento `https://SEU-PROJETO.supabase.co/auth/v1/callback`; cole Client ID/Secret em *Supabase → Auth → Providers → Google*; depois `NEXT_PUBLIC_AUTH_GOOGLE=1`.
6. **Apple (opcional, pago):** exige conta Apple Developer (US$ 99/ano). Sem ela, deixe `NEXT_PUBLIC_AUTH_APPLE=0`.
7. Realtime: as migrations adicionam as tabelas à publicação `supabase_realtime`.

## Publicar no Vercel (Hobby)

1. Suba o repositório para o GitHub (repositório pessoal, não de organização).
2. https://vercel.com → *Add New Project* → importe o repo (framework Next.js detectado).
3. Cadastre as variáveis da tabela acima (Production e Preview).
4. Deploy. O `vercel.json` agenda `/api/cron/daily` uma vez por dia (limite do Hobby: 1x/dia, precisão de ±59 min).
5. Atualize `NEXT_PUBLIC_SITE_URL` e as URLs de retorno no Supabase com o domínio `*.vercel.app` final.

Rotas internas (`/t/<id>/roteiro`, `/convite/…`) funcionam com navegação direta: o Next serve todas no servidor; o service worker guarda as telas visitadas para abrir offline.

## IA

- Sem nenhuma chave, tudo funciona: identidades do dicionário + gerador por regras, dicas/alertas/sugestões por regras verificáveis (etiqueta **AUTO**). Nada estático é apresentado como IA.
- Com chaves, cada tarefa tenta provedores numa ordem (Gemini primeiro para identidade e retrospectiva; Groq para dicas/mala/alertas; Gemma via OpenRouter para classificação). Erro 429/5xx põe o provedor em resfriamento. Saídas validadas com Zod; frases como "baixei/reservei" e fatos sensíveis sem fonte são descartados.
- O texto dos documentos é extraído no navegador (pdf.js / tesseract.js); só um trecho do texto vai para a IA, nunca o arquivo.
- Cotas gratuitas mudam com frequência; confira em cada painel. `GEMINI_MODEL` deve ser um ID existente na sua conta (`GET https://generativelanguage.googleapis.com/v1beta/models?key=…`).

## Offline e privacidade

- Passagens e identidade ficam com "manter offline" ligado por padrão; a preferência é por pessoa (banco) e o estado "baixado neste aparelho" fica no IndexedDB (`trilha-u-<id>`). O selo OFFLINE só aparece com a cópia salva.
- Sair da conta apaga todos os dados locais. Remover alguém da trilha não apaga remotamente cópias já baixadas num aparelho desconectado; elas somem quando ele sincronizar.
- O navegador pode apagar armazenamento sob pressão de espaço; o app pede armazenamento persistente, mas não há garantia.

## Estrutura

```
src/app/          rotas (t/[tripId]/…, demo/[key]/…, nova-trilha, identidades, convite, entrar, conta, api/…)
src/screens/      telas da trilha (Início, Roteiro, Documentos, Mala, Diário, Turma, EditTrip)
src/components/   shell (header, tabbar, tema), ui, mapa, formulários, cartão de identidade
src/lib/          identidade (dicionário, validação, gerador, fendas), tempo, dinheiro, regras, IA
src/data/         tipos, fontes de dados (Supabase e demonstração), offline
supabase/         migrations
tests/            unit, db (RLS em PGlite), e2e (Playwright)
docs/CHECKLIST.md checklist rastreável de requisitos e verificação
```
