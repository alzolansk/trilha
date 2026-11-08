import { Suspense } from 'react';
import Inicio from '@/screens/Inicio';

export default function Page() {
  return (
    <Suspense>
      <Inicio />
    </Suspense>
  );
}
