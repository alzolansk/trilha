import { Suspense } from 'react';
import Home from '@/screens/Home';

export default function Page() {
  return (
    <Suspense>
      <Home />
    </Suspense>
  );
}
