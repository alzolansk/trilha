import { Suspense } from 'react';
import Diario from '@/screens/Diario';

export default function Page() {
  return (
    <Suspense>
      <Diario />
    </Suspense>
  );
}
