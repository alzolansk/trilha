import { Suspense } from 'react';
import Turma from '@/screens/Turma';

export default function Page() {
  return (
    <Suspense>
      <Turma />
    </Suspense>
  );
}
