'use client';
import { useEffect } from 'react';
import { fgOn } from '../../lib/identity/accent';

const DEFAULT_THEME_COLOR = '#F5F6F8';

/** Aplica só o que varia por trilha: `--trip-accent` e a cor da barra do navegador (planning §1). */
export function applyAccent(accent: string | null, themeColor: string = DEFAULT_THEME_COLOR) {
  const root = document.documentElement;
  if (accent) {
    root.style.setProperty('--trip-accent', accent);
    root.style.setProperty('--trip-accent-fg', fgOn(accent));
  } else {
    root.style.removeProperty('--trip-accent');
    root.style.removeProperty('--trip-accent-fg');
  }
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.setAttribute('content', themeColor);
}

export function ThemeApplier({ accent, themeColor }: { accent: string | null; themeColor?: string }) {
  useEffect(() => {
    applyAccent(accent, themeColor);
  }, [accent, themeColor]);
  useEffect(() => () => applyAccent(null), []);
  return null;
}
