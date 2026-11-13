import { Suspense } from 'react';
import Votos from '@/screens/Votos';

export default function Page() {
  return (
    <Suspense>
      <Votos />
    </Suspense>
  );
}
