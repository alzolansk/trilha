import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { UiGallery } from './UiGallery';

export const metadata: Metadata = { title: 'Componentes', robots: { index: false, follow: false } };

/** Vitrine interna dos componentes da Trilha 2.0 (planning Fase 1). Só em desenvolvimento. */
export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <UiGallery />;
}
