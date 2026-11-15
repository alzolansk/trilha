import type { TripSource } from '../data/source';
import type { TripBundle } from '../data/types';

/** Contexto completo da viagem, sem material criptográfico do cofre. */
export function buildTripExport(bundle: TripBundle, source: TripSource['kind'], exportedAt = new Date().toISOString()) {
  const { documentKeys: _documentKeys, publicKeys: _publicKeys, ...data } = bundle;
  return {
    format: 'trilha-trip-context',
    version: 1,
    exportedAt,
    source,
    language: 'pt-BR',
    guide: {
      purpose: 'Contexto da viagem para conversar, revisar planos e tirar dúvidas no ChatGPT.',
      snapshot: 'Retrato dos dados salvos e acessíveis a quem exportou, consultados na data fetchedAt. Não acompanha mudanças futuras nem recupera itens excluídos.',
      reading: [
        'data.trip reúne datas, destinos, moeda base, orçamento e onboarding completo: relato da turma, perfil, preferências, desejos, lugares avaliados, detalhes e propostas de roteiro.',
        'O roteiro atual está em stops, transports, stays e activities. Propostas do onboarding e suggestions podem ainda não ter sido aceitas; confira os campos de status.',
        'members liga user_id a profiles.id (nome da pessoa). stop_id liga à parada; category_id liga à categoria correspondente. Os demais campos *_id preservam os vínculos originais.',
        'budgetCategories, expenses, expenseShares, poolContributions e settlements guardam planejamento, gastos, divisões, aportes e acertos.',
        'packingCategories/packingItems são a mala; tasks são pendências; journalEntries/journalPhotos são o diário; polls/pollOptions/pollVotes e inspirationVotes guardam decisões e votos. tripPreferences são respostas da turma; retro é a retrospectiva, se houver.',
        'Os dados podem conter notas e sugestões geradas por IA. Não trate estimativas ou sugestões como reservas confirmadas nem como informações verificadas em tempo real.',
      ],
      money: [
        'Campos *_cents, share_cents e faixas cost_low/cost_high são centavos: 12345 = 123,45 na moeda indicada.',
        'trip.budget_total, budgetCategories.planned, expenses.amount/base_amount e pollOptions.price são unidades monetárias decimais, às vezes armazenadas como texto.',
        'Preço de transporte e custo de atividade são por pessoa; preço de hospedagem é por noite para o quarto/casa inteiro. Confira price_is_estimate e cost_is_estimate.',
        'rate_to_base converte a moeda do gasto para trip.base_currency. Datas e fontes das taxas estão nos próprios gastos.',
      ],
      limits: [
        'Inclui todos os registros acessíveis da viagem, respeitando as permissões e a privacidade de documentos de outras pessoas. Tabelas de recursos ainda não instalados podem aparecer vazias.',
        'Documentos, fotos do diário e capa incluem seus metadados e referências. O conteúdo de PDFs, imagens e outros anexos não está embutido nem transcrito neste JSON; caminhos de armazenamento não são links públicos.',
        'Chaves do cofre, credenciais, sessões, links de convite e configurações da conta não fazem parte deste contexto.',
      ],
    },
    data,
  };
}

export function tripExportFilename(title: string, exportedAt: string) {
  const name = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'viagem';
  return `trilha-${name}-${exportedAt.replace(/[:.]/g, '-')}.json`;
}

export async function prepareTripExport(source: TripSource) {
  // Consulta direta: falhas não geram silenciosamente um arquivo com a cópia offline antiga.
  const bundle = await source.load({ allRows: true });
  const context = buildTripExport(bundle, source.kind);
  return {
    filename: tripExportFilename(bundle.trip.title, context.exportedAt),
    content: JSON.stringify(context, null, 2) + '\n',
  };
}
