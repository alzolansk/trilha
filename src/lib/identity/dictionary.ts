// Dicionário de identidades curadas (SPEC §4.3) e reconhecimento do destino.
import { normalize } from '../format';
import { DICTIONARY, DICTIONARY_ORDER } from './dictionary.data';
import type { DestinationIdentity } from './types';

export { DICTIONARY, DICTIONARY_ORDER };

const MATCH: Record<string, RegExp> = {
  andes: /\b(peru|bolivia|lima|cusco|cuzco|machu|uyuni|la paz|titicaca|andes|arequipa|puno|sucre|potosi|atacama)\b/,
  japao: /\b(japao|japan|toquio|tokyo|kyoto|quioto|osaka|nara|hakone|hiroshima|hokkaido|sapporo|okinawa|fuji)\b/,
  marrocos: /\b(marrocos|morocco|marrakech|marraquexe|fez|fes|saara|sahara|chefchaouen|essaouira|casablanca|merzouga|tanger|ouarzazate)\b/,
  islandia: /\b(islandia|iceland|reykjavik|vik|akureyri|aurora|husavik|landmannalaugar)\b/,
};

/** Chave do dicionário que casa com o texto do destino, ou null. */
export function matchDictionary(text: string): string | null {
  const v = normalize(text);
  for (const k of DICTIONARY_ORDER) if (MATCH[k].test(v)) return k;
  return null;
}

export function dictionaryIdentity(key: string, version = 1): DestinationIdentity | null {
  const base = DICTIONARY[key];
  return base ? { ...base, version } : null;
}

/** Identidade do dicionário mais próxima (por fundo claro/escuro e cor do acento). */
export function closestDictionaryIdentity(bgDark: boolean, accHue?: number): DestinationIdentity {
  if (bgDark) return DICTIONARY.islandia;
  if (accHue == null) return DICTIONARY.andes;
  const h = ((accHue % 360) + 360) % 360;
  if (h >= 190 && h < 290) return DICTIONARY.marrocos;
  if (h >= 330 || h < 15) return DICTIONARY.japao;
  return DICTIONARY.andes;
}
