import { initials } from '../../lib/format';
import s from './Avatar.module.css';

/** Iniciais num círculo. Cor fixa por pessoa (`profiles.color`); o "você" é sempre tangerina. */
export function Avatar({ name, color, me = false, size = 36, ring = false }: { name: string; color?: string | null; me?: boolean; size?: number; ring?: boolean }) {
  return (
    <span
      className={`${s.av} ${ring ? s.ring : ''}`}
      title={me ? `${name} (você)` : name}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.36)), background: me ? 'var(--sun)' : color || 'var(--field)' }}
    >
      {me ? 'VC' : initials(name)}
    </span>
  );
}

export interface AvatarPerson {
  id: string;
  name: string;
  color?: string | null;
  me?: boolean;
}

/** Pilha de avatares sobrepostos, com "+N" quando passa do máximo. */
export function AvatarStack({ people, max = 4, size = 32, label }: { people: AvatarPerson[]; max?: number; size?: number; label?: string }) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className={s.stack} role="img" aria-label={label ?? people.map((p) => (p.me ? `${p.name} (você)` : p.name)).join(', ')}>
      {shown.map((p) => <Avatar key={p.id} name={p.name} color={p.color} me={p.me} size={size} ring />)}
      {rest > 0 ? <span className={`${s.av} ${s.ring} ${s.more}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}>+{rest}</span> : null}
    </span>
  );
}
