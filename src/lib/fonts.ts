import { Big_Shoulders, Bricolage_Grotesque, Gloock, Instrument_Sans, JetBrains_Mono } from 'next/font/google';

// Texto e mono: fixos em todos os temas (SPEC §5).
export const instrument = Instrument_Sans({ subsets: ['latin', 'latin-ext'], weight: ['400', '500', '600'], variable: '--nf-instrument', display: 'swap' });
export const jetbrains = JetBrains_Mono({ subsets: ['latin', 'latin-ext'], weight: ['400', '500'], variable: '--nf-jetbrains', display: 'swap' });

// Display das 4 identidades do dicionário: auto-hospedadas (funcionam offline), sem preload.
export const bricolage = Bricolage_Grotesque({ subsets: ['latin', 'latin-ext'], weight: ['600', '800'], variable: '--nf-bricolage', display: 'swap', preload: false });
// Shippori Mincho B1 (fonte japonesa) NÃO é auto-hospedada: o next/font gera ~240 @font-face
// bloqueando a renderização de todas as páginas. Ela carrega sob demanda só no tema Japão.
export const gloock = Gloock({ subsets: ['latin', 'latin-ext'], weight: '400', variable: '--nf-gloock', display: 'swap', preload: false });
// "Big Shoulders Display" passou a ser servida como "Big Shoulders" no Google Fonts (mesmo desenho).
export const bigShoulders = Big_Shoulders({ subsets: ['latin', 'latin-ext'], weight: ['600', '800'], variable: '--nf-bigshoulders', display: 'swap', preload: false });

export const fontVariables = [instrument, jetbrains, bricolage, gloock, bigShoulders].map((f) => f.variable).join(' ');
