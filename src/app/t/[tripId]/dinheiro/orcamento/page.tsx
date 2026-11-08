import { Suspense } from 'react';
import Orcamento from '@/screens/Orcamento';

export default function Page() {
  return (
    <Suspense>
      <Orcamento />
    </Suspense>
  );
}
