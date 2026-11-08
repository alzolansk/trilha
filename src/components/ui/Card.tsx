import s from './Card.module.css';

export type CardVariant = 'default' | 'dark' | 'soft' | 'outline-selected' | 'suggest';

/** Superfície (raio 22, sem sombra). Cartão `dark` no máximo um por tela (planning §3.2). */
export function Card({ variant = 'default', pad = 'md', as: Tag = 'div', className, children, ...rest }: React.HTMLAttributes<HTMLElement> & { variant?: CardVariant; pad?: 'none' | 'sm' | 'md' | 'lg'; as?: 'div' | 'section' | 'article' | 'li' }) {
  return (
    <Tag className={[s.card, s[variant.replace('-', '_')], s[`p_${pad}`], className ?? ''].filter(Boolean).join(' ')} {...rest}>
      {children}
    </Tag>
  );
}
