// Textura de grão (SPEC §6.5). Tile de ruído pré-gerado em vez de feTurbulence ao vivo:
// mesmo efeito visual, mas o movimento é só um transform no compositor (barato no celular).
export function Grain() {
  return <div className="grain" aria-hidden="true" />;
}
