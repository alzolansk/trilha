'use client';
import { AuthProvider, useAuth } from '../../data/AuthContext';
import { VaultProvider } from '../../data/VaultContext';
import { ConfirmProvider, ToastProvider } from '../ui/feedback';
import { Icon } from '../ui/primitives';
import { ServiceWorker } from './ServiceWorker';

function OfflineBanner() {
  const { online } = useAuth();
  if (online) return null;
  return (
    <div className="banner-offline" role="status">
      <Icon name="cloud" size={18} />
      Você está offline. Passagens e documentos baixados continuam disponíveis.
    </div>
  );
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ToastProvider>
        <ConfirmProvider>
          <VaultProvider>
            <OfflineBanner />
            {children}
            <ServiceWorker />
          </VaultProvider>
        </ConfirmProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
