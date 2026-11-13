import { Suspense } from 'react';
import Montar from '@/screens/Montar';

export default function Page() {
  return (
    <Suspense>
      <Montar />
    </Suspense>
  );
}
