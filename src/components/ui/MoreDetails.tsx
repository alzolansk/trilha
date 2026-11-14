'use client';
// "Mais detalhes" (canvas "cidade e reservas", fase 5): o que é raro de preencher fica recolhido, para
// nenhum formulário abrir com mais de 4 ou 5 campos à vista. Nada some do modelo: só sai da frente.
import s from './MoreDetails.module.css';

export function MoreDetails({ label = 'Mais detalhes', hint, open, children }: { label?: string; hint?: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details className={s.more} open={open}>
      <summary>
        <span>{label}</span>
        {hint ? <small>{hint}</small> : null}
      </summary>
      <div className={s.body}>{children}</div>
    </details>
  );
}
