import { Suspense } from 'react';
import Explorar from '@/screens/Explorar';

export default function Page() {
  return (
    <Suspense>
      <Explorar />
    </Suspense>
  );
}
