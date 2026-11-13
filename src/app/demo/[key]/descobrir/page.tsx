import { Suspense } from 'react';
import Descobrir from '@/screens/Descobrir';

export default function Page() {
  return (
    <Suspense>
      <Descobrir />
    </Suspense>
  );
}
