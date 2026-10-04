import { Suspense } from 'react';
import Roteiro from '@/screens/Roteiro';

export default function Page() {
  return (
    <Suspense>
      <Roteiro />
    </Suspense>
  );
}
