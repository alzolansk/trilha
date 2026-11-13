import { Suspense } from 'react';
import Extrato from '@/screens/Extrato';

export default function Page() {
  return (
    <Suspense>
      <Extrato />
    </Suspense>
  );
}
