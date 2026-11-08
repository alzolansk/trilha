import { Suspense } from 'react';
import EditTrip from '@/screens/EditTrip';

export default function Page() {
  return (
    <Suspense>
      <EditTrip />
    </Suspense>
  );
}
