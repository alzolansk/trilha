import { Suspense } from 'react';
import Documentos from '@/screens/Documentos';

export default function Page() {
  return (
    <Suspense>
      <Documentos />
    </Suspense>
  );
}
