/** Esqueleto no formato do conteúdo (nunca spinner). */
export function Skeleton({ h = 120, w = '100%', r }: { h?: number | string; w?: number | string; r?: number | string }) {
  return <div className="skel" aria-hidden="true" style={{ height: h, width: w, borderRadius: r }} />;
}

/** Esqueleto de tela: título + hero + cartões. */
export function ScreenSkeleton() {
  return (
    <div className="wrap" style={{ paddingTop: 48, display: 'grid', gap: 16 }} aria-busy="true">
      <span className="sr">Carregando…</span>
      <Skeleton h={40} w="55%" r={12} />
      <Skeleton h={220} />
      <Skeleton h={88} />
      <Skeleton h={88} />
    </div>
  );
}
