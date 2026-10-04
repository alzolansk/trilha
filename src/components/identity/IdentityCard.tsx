'use client';
import { useId, useMemo } from 'react';
import { fallbackFor } from '../../lib/identity/validate';
import { LOCAL_DISPLAY } from '../../lib/identity/fontmap';
import { landscapeInner, patternSvg } from '../../lib/identity/render';
import { MINI_CLIP, SLIT_LABEL } from '../../lib/identity/shapes';
import type { DestinationIdentity } from '../../lib/identity/types';

/** Cartão da identidade com cores próprias (não depende do tema ativo da página). */
export function IdentityCard({ identity: t, title, action }: { identity: DestinationIdentity; title: string; action?: React.ReactNode }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const land = useMemo(() => landscapeInner(t, `l${uid}`), [t, uid]);
  const pat = useMemo(() => patternSvg(t, `p${uid}`), [t, uid]);
  const family = `${LOCAL_DISPLAY[t.display.family] ? `${LOCAL_DISPLAY[t.display.family]}, ` : ''}'${t.display.family}', ${fallbackFor(t.display.family)}`;
  return (
    <article className="lift" style={{ display: 'flex', flexDirection: 'column', borderRadius: 26, overflow: 'hidden', border: '1px solid rgba(28,27,25,.14)', background: '#fff', color: '#1C1B19' }}>
      <div style={{ position: 'relative', height: 220, overflow: 'hidden', background: t.palette.deep }}>
        <svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: land }} />
      </div>
      <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 18, background: t.palette.bg, color: t.palette.ink, flex: 1 }}>
        <div>
          <div className="mono" style={{ fontSize: 11, letterSpacing: '.18em', opacity: 0.75 }}>
            {t.idName.toUpperCase()} {t.generatedBy === 'ai' ? '· IA' : t.generatedBy === 'rules' ? '· REGRAS' : ''}
          </div>
          <div style={{ fontFamily: family, fontWeight: t.display.weight, fontSize: 44, lineHeight: 1, letterSpacing: '-.02em', marginTop: 6 }}>{title}</div>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '.14em', opacity: 0.7, marginTop: 6 }}>{t.display.family.toUpperCase()} {t.display.weight}</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[t.palette.bg, t.palette.acc, t.palette.acc2, t.palette.acc3, t.palette.deep].map((c, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <span style={{ height: 52, borderRadius: 10, background: c, border: '1px solid rgba(0,0,0,.12)' }} />
              <span className="mono" style={{ fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1, height: 90, borderRadius: 14, overflow: 'hidden', border: `1px solid ${t.palette.line}`, background: t.palette.bg }} dangerouslySetInnerHTML={{ __html: pat }} />
          <div style={{ flex: 1, height: 90, borderRadius: 14, position: 'relative', overflow: 'hidden', border: `1px solid ${t.palette.line}` }}>
            <div style={{ position: 'absolute', inset: 0, background: t.palette.deep, clipPath: t.miniClip ?? MINI_CLIP[t.slit] }} />
          </div>
          <div style={{ width: 90, height: 90, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: 14, border: `1px solid ${t.palette.line}` }}>
            <span style={{ width: 46, height: 46, clipPath: t.motif, background: t.palette.acc }} />
          </div>
        </div>
        <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, letterSpacing: '.14em', opacity: 0.75 }}>
          <span>PADRÃO</span>
          <span>FENDA · {(t.shapeName ?? SLIT_LABEL[t.slit]).toUpperCase()}</span>
          <span>MOTIF</span>
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
          {t.sources.map((x) => (
            <li key={x} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, clipPath: t.motif, background: t.palette.acc, flex: 'none' }} />
              {x}
            </li>
          ))}
        </ul>
        {action}
      </div>
    </article>
  );
}
