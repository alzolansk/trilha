// Fontes display auto-hospedadas (next/font). As demais da lista permitida carregam sob
// demanda do Google Fonts, somente a da identidade ativa (SPEC §2.1).
export const LOCAL_DISPLAY: Record<string, string> = {
  'Bricolage Grotesque': 'var(--nf-bricolage)',
  Gloock: 'var(--nf-gloock)',
  'Big Shoulders Display': 'var(--nf-bigshoulders)',
};

export function googleFontHref(family: string, weight: number): string {
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@${weight}&display=swap`;
}
