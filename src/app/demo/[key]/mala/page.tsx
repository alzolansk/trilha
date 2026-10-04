import { Suspense } from 'react';
import Mala from '@/screens/Mala';

export default function Page() {
  return (
    <Suspense>
      <Mala />
    </Suspense>
  );
}
