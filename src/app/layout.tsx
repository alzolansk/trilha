import type { Metadata, Viewport } from 'next';
import { AppProviders } from '../components/shell/AppProviders';
import { Grain } from '../components/shell/Grain';
import { fontVariables } from '../lib/fonts';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: { default: 'Trilha', template: 'Trilha · %s' },
  description: 'Countdown de viagens que vira a central da viagem: roteiro, documentos offline, mala, gastos e diário com a turma.',
  applicationName: 'Trilha',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icons/icon.svg', apple: '/icons/icon-192.png' },
  appleWebApp: { capable: true, title: 'Trilha', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#EEEBE4',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={fontVariables} suppressHydrationWarning>
      <body>
        <a href="#main" className="skip">
          Pular para o conteúdo
        </a>
        <AppProviders>{children}</AppProviders>
        <Grain />
      </body>
    </html>
  );
}
