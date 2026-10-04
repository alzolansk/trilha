'use client';
import { notFound, useParams } from 'next/navigation';
import { useMemo } from 'react';
import { TripShell } from '../../../components/shell/TripShell';
import { createDemoSource } from '../../../data/demoSource';
import { TripProvider } from '../../../data/TripContext';
import { buildDemoBundle, DEMO_KEYS, type DemoKey } from '../../../lib/demo/build';

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  const { key } = useParams<{ key: string }>();
  const valid = (DEMO_KEYS as readonly string[]).includes(key);
  const source = useMemo(() => (valid ? createDemoSource(key as DemoKey) : null), [key, valid]);
  const initial = useMemo(() => (valid ? buildDemoBundle(key as DemoKey) : null), [key, valid]);
  if (!source) notFound();
  return (
    <TripProvider source={source} base={`/demo/${key}`} initialBundle={initial}>
      <TripShell>{children}</TripShell>
    </TripProvider>
  );
}
