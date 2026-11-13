import { Suspense } from 'react';
import Acerto from '@/screens/Acerto';

export default function Page() {
  return (
    <Suspense>
      <Acerto />
    </Suspense>
  );
}
