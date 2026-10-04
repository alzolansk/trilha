'use client';
import { useEffect } from 'react';
import { isDark } from '../../lib/identity/contrast';
import { googleFontHref, LOCAL_DISPLAY } from '../../lib/identity/fontmap';
import { cycleExtras, NEUTRAL_VARS, themeVars } from '../../lib/identity/theme';
import type { DestinationIdentity } from '../../lib/identity/types';
import { fallbackFor } from '../../lib/identity/validate';

/** Injeta os tokens da identidade no <html> (fundo, barra do navegador e todas as telas). */
export function applyIdentity(id: DestinationIdentity | null) {
  const root = document.documentElement;
  const vars = id ? { ...themeVars(id), ...cycleExtras(id) } : NEUTRAL_VARS;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  if (id) {
    const local = LOCAL_DISPLAY[id.display.family];
    root.style.setProperty('--font-display', `${local ? `${local}, ` : ''}'${id.display.family}', ${fallbackFor(id.display.family)}`);
    if (!local) {
      const href = googleFontHref(id.display.family, id.display.weight);
      let link = document.getElementById('display-font') as HTMLLinkElement | null;
      if (!link) {
        link = document.createElement('link');
        link.id = 'display-font';
        link.rel = 'stylesheet';
        document.head.appendChild(link);
      }
      if (link.href !== href) link.href = href;
    }
  }
  if (id && isDark(id.palette.bg)) root.setAttribute('data-dark', '');
  else root.removeAttribute('data-dark');
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.setAttribute('content', id ? id.palette.bg : NEUTRAL_VARS['--bg']);
}

export function ThemeApplier({ identity }: { identity: DestinationIdentity | null }) {
  useEffect(() => {
    applyIdentity(identity);
  }, [identity]);
  useEffect(() => () => applyIdentity(null), []);
  return null;
}
