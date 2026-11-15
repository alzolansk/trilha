// Frase do dia (Início 3.0, planning §13): uma expressão útil no idioma do destino, a mesma o dia inteiro.
// Só aparece quando o idioma do país não é português. Lista fixa e curta, revisada à mão (sem IA).
import { normalize } from './format';

export interface Phrase { text: string; say?: string; meaning: string }
export interface PhraseSet { lang: string; label: string; phrases: Phrase[] }

const SETS: Record<string, PhraseSet> = {
  ja: { lang: 'ja', label: 'japonês', phrases: [
    { text: 'すみません', say: 'sumimasen', meaning: 'com licença / desculpa: serve pra chamar alguém e pra pedir passagem' },
    { text: 'ありがとうございます', say: 'arigatō gozaimasu', meaning: 'muito obrigado' },
    { text: 'これをください', say: 'kore o kudasai', meaning: 'quero este, por favor (apontando)' },
    { text: 'いくらですか', say: 'ikura desu ka', meaning: 'quanto custa?' },
    { text: 'トイレはどこですか', say: 'toire wa doko desu ka', meaning: 'onde fica o banheiro?' },
    { text: 'お会計お願いします', say: 'okaikei onegaishimasu', meaning: 'a conta, por favor' },
    { text: 'いただきます', say: 'itadakimasu', meaning: 'dito antes de comer, como um “bom apetite” agradecido' },
    { text: '大丈夫です', say: 'daijōbu desu', meaning: 'está tudo bem / não precisa' },
  ] },
  es: { lang: 'es', label: 'espanhol', phrases: [
    { text: '¿Cuánto cuesta?', meaning: 'quanto custa?' },
    { text: 'La cuenta, por favor', meaning: 'a conta, por favor' },
    { text: '¿Dónde está el baño?', meaning: 'onde fica o banheiro?' },
    { text: 'Una mesa para dos', meaning: 'uma mesa para dois' },
    { text: '¿Me lo puede envolver?', meaning: 'pode embrulhar pra mim?' },
    { text: 'Sin hielo, por favor', meaning: 'sem gelo, por favor' },
    { text: '¿Aceptan tarjeta?', meaning: 'aceitam cartão?' },
    { text: 'Disculpe', meaning: 'com licença / desculpe' },
  ] },
  it: { lang: 'it', label: 'italiano', phrases: [
    { text: 'Il conto, per favore', meaning: 'a conta, por favor' },
    { text: 'Quanto costa?', meaning: 'quanto custa?' },
    { text: "Dov'è il bagno?", meaning: 'onde fica o banheiro?' },
    { text: 'Un tavolo per due', meaning: 'uma mesa para dois' },
    { text: 'Permesso', meaning: 'com licença (pra passar)' },
    { text: 'Un caffè, per favore', meaning: 'um café (espresso), por favor' },
    { text: 'Acqua naturale o frizzante?', meaning: 'água sem gás ou com gás?' },
    { text: 'Grazie mille', meaning: 'muito obrigado' },
  ] },
  fr: { lang: 'fr', label: 'francês', phrases: [
    { text: "L'addition, s'il vous plaît", meaning: 'a conta, por favor' },
    { text: 'Combien ça coûte ?', meaning: 'quanto custa?' },
    { text: 'Où sont les toilettes ?', meaning: 'onde fica o banheiro?' },
    { text: 'Bonjour', meaning: 'bom dia: diga ao entrar em qualquer loja, é falta de educação não dizer' },
    { text: 'Excusez-moi', meaning: 'com licença / desculpe' },
    { text: 'Une carafe d’eau, s’il vous plaît', meaning: 'uma jarra de água (da torneira, grátis)' },
    { text: 'Je voudrais…', meaning: 'eu gostaria de…' },
    { text: 'Merci beaucoup', meaning: 'muito obrigado' },
  ] },
  de: { lang: 'de', label: 'alemão', phrases: [
    { text: 'Die Rechnung, bitte', meaning: 'a conta, por favor' },
    { text: 'Wie viel kostet das?', meaning: 'quanto custa?' },
    { text: 'Wo ist die Toilette?', meaning: 'onde fica o banheiro?' },
    { text: 'Entschuldigung', meaning: 'com licença / desculpe' },
    { text: 'Kann ich mit Karte zahlen?', meaning: 'posso pagar com cartão?' },
    { text: 'Zusammen oder getrennt?', meaning: 'junto ou separado? (o garçom pergunta ao fechar a conta)' },
    { text: 'Danke schön', meaning: 'muito obrigado' },
    { text: 'Ein Wasser, bitte', meaning: 'uma água, por favor' },
  ] },
  en: { lang: 'en', label: 'inglês', phrases: [
    { text: 'Could I get the check, please?', meaning: 'a conta, por favor' },
    { text: 'How much is it?', meaning: 'quanto custa?' },
    { text: 'Where is the restroom?', meaning: 'onde fica o banheiro?' },
    { text: 'A table for two, please', meaning: 'uma mesa para dois, por favor' },
    { text: 'Can I pay by card?', meaning: 'posso pagar com cartão?' },
    { text: 'Excuse me', meaning: 'com licença' },
    { text: 'Is this seat taken?', meaning: 'este lugar está ocupado?' },
    { text: 'Just looking, thanks', meaning: 'só olhando, obrigado' },
  ] },
  ar: { lang: 'ar', label: 'árabe marroquino', phrases: [
    { text: 'السلام عليكم', say: 'salam alaikum', meaning: 'olá (a resposta é “wa alaikum salam”)' },
    { text: 'شكرا', say: 'shukran', meaning: 'obrigado' },
    { text: 'بشحال؟', say: 'bshhal?', meaning: 'quanto custa?' },
    { text: 'لا، شكرا', say: 'la, shukran', meaning: 'não, obrigado (útil nos souks)' },
    { text: 'غالي بزاف', say: 'ghali bzaf', meaning: 'muito caro (começo da pechincha)' },
    { text: 'فين؟', say: 'fin?', meaning: 'onde?' },
    { text: 'بسلامة', say: 'bslama', meaning: 'tchau' },
    { text: 'إن شاء الله', say: 'inshallah', meaning: 'se Deus quiser: resposta comum para planos' },
  ] },
  is: { lang: 'is', label: 'islandês', phrases: [
    { text: 'Takk fyrir', meaning: 'obrigado' },
    { text: 'Góðan daginn', meaning: 'bom dia' },
    { text: 'Hvað kostar þetta?', meaning: 'quanto custa?' },
    { text: 'Skál!', meaning: 'saúde! (no brinde)' },
    { text: 'Já / Nei', meaning: 'sim / não' },
    { text: 'Bless', meaning: 'tchau' },
  ] },
};

const LANG_BY_COUNTRY: Record<string, string> = {
  japao: 'ja',
  espanha: 'es', mexico: 'es', argentina: 'es', chile: 'es', peru: 'es', colombia: 'es', uruguai: 'es', paraguai: 'es', bolivia: 'es', equador: 'es',
  cuba: 'es', 'costa rica': 'es', panama: 'es', guatemala: 'es', venezuela: 'es',
  italia: 'it', franca: 'fr', alemanha: 'de', austria: 'de',
  'estados unidos': 'en', eua: 'en', 'reino unido': 'en', inglaterra: 'en', escocia: 'en', irlanda: 'en', canada: 'en', australia: 'en', 'nova zelandia': 'en',
  marrocos: 'ar', islandia: 'is',
};

/** Idioma da parada ("Japão · Kanto" → japonês); null para países de língua portuguesa ou fora da lista. */
export function phraseSetFor(country: string | null | undefined): PhraseSet | null {
  if (!country) return null;
  const lang = LANG_BY_COUNTRY[normalize(country.split('·')[0].trim())];
  return lang ? SETS[lang] : null;
}

/** A frase do dia: muda à meia-noite, igual para toda a turma. `seed` = número estável (ex.: dayHash). */
export function phraseOfDay(set: PhraseSet, seed: number): Phrase {
  return set.phrases[seed % set.phrases.length];
}
