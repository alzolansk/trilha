'use client';
import { useEffect, useId, useRef, useState } from 'react';
import styles from '../../screens/roteiro.module.css';

export interface Place {
  name: string;
  label: string;
  country: string | null;
  countryCode: string | null;
  lat: number;
  lng: number;
  altitude: number | null;
}

/**
 * Campo de lugar com sugestões do OpenStreetMap (via /api/geo). O texto digitado vale
 * sozinho; escolher uma sugestão preenche país e coordenadas reais.
 */
export function PlaceSearch({ label, value, onText, onPick, placeholder, required, enabled = true }: {
  label: string;
  value: string;
  onText: (v: string) => void;
  onPick: (p: Place) => void;
  placeholder?: string;
  required?: boolean;
  enabled?: boolean;
}) {
  const id = useId();
  const [results, setResults] = useState<Place[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'empty'>('idle');
  const [open, setOpen] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const picked = useRef(false);

  useEffect(() => {
    if (!enabled || picked.current || value.trim().length < 3) {
      picked.current = false;
      setResults([]);
      return;
    }
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(async () => {
      if (!navigator.onLine) return setStatus('error');
      setStatus('loading');
      try {
        const r = await fetch(`/api/geo?q=${encodeURIComponent(value)}`);
        const j = (await r.json()) as { results?: Place[]; error?: string };
        if (!r.ok) throw new Error(j.error);
        setResults(j.results ?? []);
        setStatus(j.results?.length ? 'idle' : 'empty');
        setOpen(true);
      } catch {
        setStatus('error');
      }
    }, 600);
    return () => {
      if (t.current) clearTimeout(t.current);
    };
  }, [value, enabled]);

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={value}
        required={required}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={`${id}-list`}
        onChange={(e) => onText(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      />
      {enabled ? (
        <span className="hint" aria-live="polite">
          {status === 'loading' ? 'Buscando lugares…' : status === 'error' ? 'Busca de lugares indisponível: o texto digitado será usado.' : status === 'empty' ? 'Nenhum lugar encontrado. Pode salvar só com o nome.' : results.length ? 'Escolha uma sugestão para salvar país e coordenadas.' : ''}
        </span>
      ) : null}
      {open && results.length ? (
        <ul className={styles.results} id={`${id}-list`} role="listbox">
          {results.map((p, i) => (
            <li key={i} role="option" aria-selected="false">
              <button
                type="button"
                onClick={() => {
                  picked.current = true;
                  onPick(p);
                  setOpen(false);
                  setResults([]);
                }}
              >
                <b>{p.name}</b>
                <br />
                <span style={{ fontSize: 12, color: 'var(--mute)' }}>{p.label}</span>
              </button>
            </li>
          ))}
          <li className="mono" style={{ fontSize: 10, padding: '6px 12px', color: 'var(--mute)' }}>© OpenStreetMap contributors</li>
        </ul>
      ) : null}
    </div>
  );
}
