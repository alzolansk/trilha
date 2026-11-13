import { Suspense } from 'react';
import Dinheiro from '@/screens/Dinheiro';

export default function Page() {
  return (
    <Suspense>
      <Dinheiro />
    </Suspense>
  );
}
