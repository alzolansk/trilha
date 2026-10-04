import { NextResponse } from 'next/server';
import { z } from 'zod';
import { aiConfigured, runWithFallback } from '@/lib/ai/providers';
import { BASE_RULES } from '@/lib/ai/prompts';
import { consumeQuota, handle, HttpError, readJson, requireUser } from '@/lib/ai/server';
import { dictionaryIdentity, matchDictionary } from '@/lib/identity/dictionary';
import { generateRulesIdentity, slugKey } from '@/lib/identity/generate';
import { ALLOWED_FONTS, validateIdentity } from '@/lib/identity/validate';

const input = z.object({
  destination: z.string().trim().min(2).max(80),
  departDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  style: z.enum(['Mochilão', 'Conforto', 'Aventura', 'Cultural']).default('Mochilão'),
  version: z.number().int().min(1).max(50).default(1),
});

const SCHEMA_HINT = `{
 "idName": "2 a 3 palavras, formato 'Coisa & Coisa' ou 'Lugar Coisa'",
 "palette": {"bg":"#RRGGBB","ink":"#RRGGBB","mute":"#RRGGBB","acc":"#RRGGBB","acc2":"#RRGGBB","acc3":"#RRGGBB","deep":"#RRGGBB","onDeep":"#RRGGBB","routeLine":"#RRGGBB"},
 "display": {"family": "uma de: ${ALLOWED_FONTS.join(', ')}", "weight": 400},
 "motif": "circle(50% at 50% 50%) ou polygon(x% y%, ...) com até 24 pontos",
 "pattern": {"w": 40, "h": 40, "shapes": [{"t":"circle","cx":20,"cy":20,"r":6,"fill":"acc"}, {"t":"rect","x":0,"y":0,"w":5,"h":5,"rot":45,"fill":"deep"}, {"t":"poly","points":[[0,0],[10,0],[5,8]],"fill":"acc3"}, {"t":"wave","y":9,"amp":8,"stroke":"acc","sw":1.4}]},
 "slit": "diamond | lens | arch | band",
 "landscape": {"sky":["#RRGGBB","#RRGGBB"],"sun":{"cx":1000,"cy":260,"r":110,"color":"acc2"},"layers":[{"style":"peaks | hills | dunes | waves | mesas | city","color":"acc3","base":560,"amp":220,"seed":17}]},
 "sources": ["4 inspirações reais do destino e da época, até 5 palavras cada"]
}
Cores de fill/stroke/color dos padrões e camadas são nomes de token: bg, ink, acc, acc2, acc3, deep ou none. Padrão: até 16 formas, tile até 120px, no máximo 3 cores. Paisagem: 1 a 3 camadas, do fundo para a frente; sun pode ser null.`;

export async function POST(req: Request) {
  return handle(async () => {
    const { sb } = await requireUser();
    const parsed = input.safeParse(await readJson(req));
    if (!parsed.success) throw new HttpError(400, 'Dados inválidos.');
    const { destination, departDate, returnDate, style, version } = parsed.data;

    // 1-2. Normaliza e consulta o dicionário (versão 1 = identidade curada).
    const dictKey = matchDictionary(destination);
    if (dictKey && version === 1) {
      return NextResponse.json({ data: dictionaryIdentity(dictKey, 1), by: 'dictionary' });
    }

    // 3-4. IA com validação; se nada passar, gerador local por regras (sem etiqueta IA).
    if (aiConfigured().length) {
      await consumeQuota(sb);
      const key = dictKey ? `${dictKey}_v${version}` : slugKey(destination);
      const res = await runWithFallback(
        'identity',
        `${BASE_RULES}\nVocê cria a identidade visual de uma viagem dentro do app Trilha.`,
        `Destino: ${destination}. Datas: ${departDate ?? '?'} a ${returnDate ?? '?'}. Estilo: ${style}. Versão: ${version} (gere uma variação diferente das anteriores).
Regras:
- Inspire-se em elementos culturais, naturais e climáticos reais do destino e da época. Evite clichês ofensivos e símbolos religiosos ou nacionais oficiais (bandeiras, brasões).
- palette: bg claro (L>90%) para destinos diurnos ou escuro (L<20%) para noturnos/polares; ink com contraste >= 7:1 sobre bg; acc, acc2, acc3 vivos e harmônicos; deep escuro o bastante para texto claro; routeLine visível sobre deep.
- slit: "band" só para destinos de horizonte/faixa (aurora, deserto plano).
Responda só com JSON neste formato:
${SCHEMA_HINT}`,
        (raw) => {
          const v = validateIdentity(raw, { key, generatedBy: 'ai', version });
          return v.ok ? v.identity : null;
        },
        { maxTokens: 1800, temperature: 0.8 },
      );
      if (res) {
        const model = `${res.provider}:${res.model}`;
        return NextResponse.json({ data: { ...res.data, model }, by: 'ai', model });
      }
    }
    const rules = generateRulesIdentity({ destination, departDate, style, version });
    return NextResponse.json({ data: rules, by: 'rules', note: 'IA indisponível: identidade gerada por regras locais.' });
  });
}
