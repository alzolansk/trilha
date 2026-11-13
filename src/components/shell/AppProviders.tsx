'use client';
import { AuthProvider, useAuth } from '../../data/AuthContext';
import { VaultProvider } from '../../data/VaultContext';
import { ConfirmProvider, ToastProvider } from '../ui/feedback';
import { OfflineBanner } from '../ui/OfflineBanner';
import { ServiceWorker } from './ServiceWorker';

function Offline() {
  const { online } = useAuth();
  return <OfflineBanner online={online} />;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ToastProvider>
        <ConfirmProvider>
          <VaultProvider>
            <Offline />
            {children}
            <ServiceWorker />
          </VaultProvider>
        </ConfirmProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
