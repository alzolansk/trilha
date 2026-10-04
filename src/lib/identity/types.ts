// Contrato da identidade visual por destino (SPEC §3), com duas extensões documentadas:
//  - pattern/landscape aceitam a forma "raw" (SVG curado do dicionário, confiável) ou uma
//    descrição estruturada (gerada por IA/algoritmo) que o app renderiza com segurança;
//  - generatedBy inclui 'rules' para identidades criadas pelo algoritmo local quando a IA
//    não está disponível (não recebem etiqueta IA).

export type ThemeKey = string;
export type SlitShape = 'diamond' | 'lens' | 'arch' | 'band';
export type CountdownSplit = 'v' | 'h';
export type PaletteToken = 'bg' | 'ink' | 'acc' | 'acc2' | 'acc3' | 'deep';

export interface Palette {
  bg: string;
  ink: string;
  mute: string;
  line: string;
  acc: string;
  acc2: string;
  acc3: string;
  deep: string;
  onDeep: string;
  onAcc: string;
  routeLine: string;
}

export type PatternShape =
  | { t: 'circle'; cx: number; cy: number; r: number; fill?: PaletteToken | 'none'; stroke?: PaletteToken; sw?: number }
  | { t: 'rect'; x: number; y: number; w: number; h: number; rot?: number; fill?: PaletteToken | 'none'; stroke?: PaletteToken; sw?: number }
  | { t: 'poly'; points: [number, number][]; fill?: PaletteToken | 'none'; stroke?: PaletteToken; sw?: number }
  | { t: 'wave'; y: number; amp: number; stroke: PaletteToken; sw?: number };

export type PatternSpec =
  | { kind: 'raw'; svg: string }
  | { kind: 'tiles'; w: number; h: number; shapes: PatternShape[] };

export type RidgeStyle = 'peaks' | 'hills' | 'dunes' | 'waves' | 'mesas' | 'city';

export type LandscapeSpec =
  | { kind: 'raw'; svg: string }
  | {
      kind: 'layers';
      sky: [string, string];
      sun: { cx: number; cy: number; r: number; color: PaletteToken } | null;
      layers: { style: RidgeStyle; color: PaletteToken; base: number; amp: number; seed: number }[];
    };

export interface DestinationIdentity {
  key: ThemeKey;
  idName: string;
  palette: Palette;
  display: { family: string; googleFont: string; weight: 400 | 500 | 600 | 700 | 800 | 900 };
  motif: string;
  motifSolid: string;
  pattern: PatternSpec;
  slit: SlitShape;
  split: CountdownSplit;
  landscape: LandscapeSpec;
  sources: string[];
  generatedBy: 'dictionary' | 'ai' | 'rules';
  version: number;
  /** rótulo da fenda para a UI (ex.: "Losango têxtil") */
  shapeName?: string;
  /** clip-path da miniatura da fenda (onboarding/galeria) */
  miniClip?: string;
  /** modelo usado quando generatedBy = 'ai' */
  model?: string;
}
