import { Bricolage_Grotesque, Inter } from 'next/font/google';

// Trilha 2.0 (planning §1): só duas famílias, fixas no app inteiro.
// As duas são fontes variáveis (um arquivo por subset, todos os pesos 400–800).
// Inter para texto e números (tabular-nums nos valores); Bricolage Grotesque para títulos.
export const inter = Inter({ subsets: ['latin', 'latin-ext'], variable: '--nf-inter', display: 'swap' });
export const bricolage = Bricolage_Grotesque({ subsets: ['latin', 'latin-ext'], variable: '--nf-bricolage', display: 'swap' });

export const fontVariables = [inter, bricolage].map((f) => f.variable).join(' ');
