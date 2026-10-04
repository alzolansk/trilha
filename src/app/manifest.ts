import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Trilha',
    short_name: 'Trilha',
    description: 'Countdown e central da viagem, com a turma.',
    lang: 'pt-BR',
    start_url: '/',
    display: 'standalone',
    background_color: '#EEEBE4',
    theme_color: '#1C1B19',
    icons: [
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
