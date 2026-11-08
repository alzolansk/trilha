import { Suspense } from 'react';
import Parada from '@/screens/Parada';

export default function Page() {
  return (
    <Suspense>
      <Parada />
    </Suspense>
  );
}
