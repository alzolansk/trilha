import { Bricolage_Grotesque, Instrument_Serif, Inter } from 'next/font/google';

// Trilha 2.0 (planning §1): duas famílias fixas no app inteiro, mais uma serifada só para o caderno do Roteiro.
// As duas são fontes variáveis (um arquivo por subset, todos os pesos 400–800).
// Inter para texto e números (tabular-nums nos valores); Bricolage Grotesque para títulos.
export const inter = Inter({ subsets: ['latin', 'latin-ext'], variable: '--nf-inter', display: 'swap' });
export const bricolage = Bricolage_Grotesque({ subsets: ['latin', 'latin-ext'], variable: '--nf-bricolage', display: 'swap' });

// Roteiro como caderno de viagem (11/2026): nomes de cidade, datas dos dias e "Antes de ir".
export const serif = Instrument_Serif({ subsets: ['latin', 'latin-ext'], weight: '400', style: ['normal', 'italic'], variable: '--nf-serif', display: 'swap' });

export const fontVariables = [inter, bricolage, serif].map((f) => f.variable).join(' ');
