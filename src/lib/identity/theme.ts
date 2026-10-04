// Tokens de tema aplicados no <html> (SPEC §4.4).
import { fgOn, isDark } from './contrast';
import type { DestinationIdentity } from './types';
import { fallbackFor } from './validate';

export function themeVars(id: DestinationIdentity): Record<string, string> {
  const p = id.palette;
  const dark = isDark(p.bg);
  return {
    '--bg': p.bg,
    '--ink': p.ink,
    '--mute': p.mute,
    '--line': p.line,
    '--acc': p.acc,
    '--acc2': p.acc2,
    '--acc3': p.acc3,
    '--deep': p.deep,
    '--on-deep': p.onDeep,
    '--on-acc': p.onAcc,
    '--route': p.routeLine,
    '--fg-acc': fgOn(p.acc),
    '--fg-acc2': fgOn(p.acc2),
    '--fg-acc3': fgOn(p.acc3),
    '--fg-deep': fgOn(p.deep),
    '--card': dark ? '#152A31' : '#FFFFFF',
    '--soft': dark ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.6)',
    '--font-display': `'${id.display.family}', ${fallbackFor(id.display.family)}`,
    '--display-weight': String(id.display.weight),
    '--motif': id.motif,
    '--motif-solid': id.motifSolid,
  };
}

/** Ciclo de cores para itens em sequência (SPEC §4.2). */
export function colorCycle(id: DestinationIdentity): string[] {
  const p = id.palette;
  return [p.acc, p.acc2, p.acc3, isDark(p.bg) ? p.ink : p.deep];
}

/** Mesmo ciclo como variáveis CSS (para não fixar cores no markup). */
export const CYCLE_VARS = ['var(--acc)', 'var(--acc2)', 'var(--acc3)', 'var(--cycle4)'];
export const CYCLE_FG = ['var(--fg-acc)', 'var(--fg-acc2)', 'var(--fg-acc3)', 'var(--fg-cycle4)'];

export function cycleExtras(id: DestinationIdentity): Record<string, string> {
  const dark = isDark(id.palette.bg);
  const c4 = dark ? id.palette.ink : id.palette.deep;
  return { '--cycle4': c4, '--fg-cycle4': fgOn(c4) };
}

/** Cor por categoria de documento (SPEC §7 DocTicket). */
export const DOC_CAT_VAR: Record<string, [string, string]> = {
  passagem: ['var(--acc)', 'var(--fg-acc)'],
  identidade: ['var(--acc2)', 'var(--fg-acc2)'],
  reserva: ['var(--acc3)', 'var(--fg-acc3)'],
  ingresso: ['var(--deep)', 'var(--fg-deep)'],
  seguro: ['var(--acc)', 'var(--fg-acc)'],
  outro: ['var(--acc3)', 'var(--fg-acc3)'],
};

export const NEUTRAL_VARS: Record<string, string> = {
  '--bg': '#EEEBE4',
  '--ink': '#1C1B19',
  '--mute': '#55524C',
  '--line': 'rgba(28,27,25,.18)',
  '--acc': '#1C1B19',
  '--acc2': '#1C1B19',
  '--acc3': '#55524C',
  '--deep': '#1C1B19',
  '--on-deep': '#EEEBE4',
  '--on-acc': '#FFFFFF',
  '--route': '#EEEBE4',
  '--fg-acc': '#FFFFFF',
  '--fg-acc2': '#FFFFFF',
  '--fg-acc3': '#FFFFFF',
  '--fg-deep': '#FFFFFF',
  '--card': '#FFFFFF',
  '--soft': 'rgba(255,255,255,.6)',
  '--font-display': 'var(--font-body)',
  '--display-weight': '500',
  '--motif': 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
  '--motif-solid': 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
  '--cycle4': '#1C1B19',
  '--fg-cycle4': '#FFFFFF',
};
