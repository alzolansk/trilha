'use client';
import { useBundle } from '../data/TripContext';
import { prepareTripExport } from '../lib/tripExport';
import { Button } from './ui';
import { useAction } from './ui/feedback';
import s from './TripExport.module.css';

export function TripExport() {
  const { source } = useBundle();
  const { run, busy } = useAction();
  const download = () => run(async () => {
    const { filename, content } = await prepareTripExport(source);
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    try { a.click(); } finally {
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }, { success: 'JSON da viagem pronto. Adicione o arquivo ao seu projeto no ChatGPT.' });

  return (
    <details className={s.advanced}>
      <summary>Opções avançadas</summary>
      <div className={s.content}>
        <h2>Levar a viagem para o ChatGPT</h2>
        <p>Baixe um JSON com todos os dados salvos da viagem que você pode acessar: perfil, preferências, roteiro, orçamento, gastos, tarefas, votos e diário.</p>
        <p>Os anexos ficam de fora; seus nomes e informações entram no arquivo. Depois, adicione o JSON aos arquivos do seu projeto no ChatGPT.</p>
        <Button variant="secondary" disabled={busy} aria-busy={busy} onClick={download}>
          {busy ? 'Preparando JSON…' : 'Exportar viagem completa (JSON)'}
        </Button>
      </div>
    </details>
  );
}
