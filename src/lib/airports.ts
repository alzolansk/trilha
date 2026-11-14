// Aeroportos mais comuns para quem sai do Brasil (canvas "cidade e reservas", fase 3): código IATA →
// cidade e fuso. Serve para o bilhete não perguntar fuso nem nome de cidade quando o código é conhecido.
// Lista curta de propósito: código fora dela continua valendo, só não deduz nada.
export interface Airport { city: string; tz: string }

const A: Record<string, [string, string]> = {
  // Brasil
  GRU: ['São Paulo', 'America/Sao_Paulo'], CGH: ['São Paulo', 'America/Sao_Paulo'], VCP: ['Campinas', 'America/Sao_Paulo'],
  GIG: ['Rio de Janeiro', 'America/Sao_Paulo'], SDU: ['Rio de Janeiro', 'America/Sao_Paulo'], BSB: ['Brasília', 'America/Sao_Paulo'],
  CNF: ['Belo Horizonte', 'America/Sao_Paulo'], POA: ['Porto Alegre', 'America/Sao_Paulo'], CWB: ['Curitiba', 'America/Sao_Paulo'],
  FLN: ['Florianópolis', 'America/Sao_Paulo'], SSA: ['Salvador', 'America/Bahia'], REC: ['Recife', 'America/Recife'],
  FOR: ['Fortaleza', 'America/Fortaleza'], NAT: ['Natal', 'America/Fortaleza'], BEL: ['Belém', 'America/Belem'],
  MAO: ['Manaus', 'America/Manaus'], VIX: ['Vitória', 'America/Sao_Paulo'], GYN: ['Goiânia', 'America/Sao_Paulo'],
  IGU: ['Foz do Iguaçu', 'America/Sao_Paulo'], MCZ: ['Maceió', 'America/Maceio'], CGB: ['Cuiabá', 'America/Cuiaba'],
  // América do Sul
  EZE: ['Buenos Aires', 'America/Argentina/Buenos_Aires'], AEP: ['Buenos Aires', 'America/Argentina/Buenos_Aires'],
  SCL: ['Santiago', 'America/Santiago'], LIM: ['Lima', 'America/Lima'], CUZ: ['Cusco', 'America/Lima'],
  LPB: ['La Paz', 'America/La_Paz'], VVI: ['Santa Cruz de la Sierra', 'America/La_Paz'], BOG: ['Bogotá', 'America/Bogota'],
  MDE: ['Medellín', 'America/Bogota'], CTG: ['Cartagena', 'America/Bogota'], UIO: ['Quito', 'America/Guayaquil'],
  MVD: ['Montevidéu', 'America/Montevideo'], ASU: ['Assunção', 'America/Asuncion'], PTY: ['Cidade do Panamá', 'America/Panama'],
  MDZ: ['Mendoza', 'America/Argentina/Mendoza'], BRC: ['Bariloche', 'America/Argentina/Salta'], USH: ['Ushuaia', 'America/Argentina/Ushuaia'],
  // América do Norte e Caribe
  MIA: ['Miami', 'America/New_York'], MCO: ['Orlando', 'America/New_York'], JFK: ['Nova York', 'America/New_York'],
  EWR: ['Nova York', 'America/New_York'], ATL: ['Atlanta', 'America/New_York'], IAH: ['Houston', 'America/Chicago'],
  LAX: ['Los Angeles', 'America/Los_Angeles'], SFO: ['São Francisco', 'America/Los_Angeles'], YYZ: ['Toronto', 'America/Toronto'],
  MEX: ['Cidade do México', 'America/Mexico_City'], CUN: ['Cancún', 'America/Cancun'], PUJ: ['Punta Cana', 'America/Santo_Domingo'],
  // Europa
  LIS: ['Lisboa', 'Europe/Lisbon'], OPO: ['Porto', 'Europe/Lisbon'], MAD: ['Madri', 'Europe/Madrid'], BCN: ['Barcelona', 'Europe/Madrid'],
  CDG: ['Paris', 'Europe/Paris'], ORY: ['Paris', 'Europe/Paris'], NCE: ['Nice', 'Europe/Paris'], LHR: ['Londres', 'Europe/London'],
  LGW: ['Londres', 'Europe/London'], STN: ['Londres', 'Europe/London'], DUB: ['Dublin', 'Europe/Dublin'], AMS: ['Amsterdã', 'Europe/Amsterdam'],
  BRU: ['Bruxelas', 'Europe/Brussels'], FRA: ['Frankfurt', 'Europe/Berlin'], MUC: ['Munique', 'Europe/Berlin'], BER: ['Berlim', 'Europe/Berlin'],
  ZRH: ['Zurique', 'Europe/Zurich'], GVA: ['Genebra', 'Europe/Zurich'], VIE: ['Viena', 'Europe/Vienna'], PRG: ['Praga', 'Europe/Prague'],
  BUD: ['Budapeste', 'Europe/Budapest'], FCO: ['Roma', 'Europe/Rome'], CIA: ['Roma', 'Europe/Rome'], MXP: ['Milão', 'Europe/Rome'],
  LIN: ['Milão', 'Europe/Rome'], VCE: ['Veneza', 'Europe/Rome'], FLR: ['Florença', 'Europe/Rome'], NAP: ['Nápoles', 'Europe/Rome'],
  BLQ: ['Bolonha', 'Europe/Rome'], PSA: ['Pisa', 'Europe/Rome'], ATH: ['Atenas', 'Europe/Athens'], IST: ['Istambul', 'Europe/Istanbul'],
  CPH: ['Copenhague', 'Europe/Copenhagen'], ARN: ['Estocolmo', 'Europe/Stockholm'], OSL: ['Oslo', 'Europe/Oslo'], HEL: ['Helsinque', 'Europe/Helsinki'],
  KEF: ['Reykjavík', 'Atlantic/Reykjavik'],
  // África, Oriente Médio e Ásia
  DXB: ['Dubai', 'Asia/Dubai'], DOH: ['Doha', 'Asia/Qatar'], CMN: ['Casablanca', 'Africa/Casablanca'], RAK: ['Marrakech', 'Africa/Casablanca'],
  CPT: ['Cidade do Cabo', 'Africa/Johannesburg'], JNB: ['Joanesburgo', 'Africa/Johannesburg'], CAI: ['Cairo', 'Africa/Cairo'],
  NRT: ['Tóquio', 'Asia/Tokyo'], HND: ['Tóquio', 'Asia/Tokyo'], ICN: ['Seul', 'Asia/Seoul'], BKK: ['Bangkok', 'Asia/Bangkok'],
  SIN: ['Singapura', 'Asia/Singapore'], HKG: ['Hong Kong', 'Asia/Hong_Kong'], SYD: ['Sydney', 'Australia/Sydney'],
};

export function airport(code: string | null | undefined): Airport | null {
  const c = code?.trim().toUpperCase();
  const a = c ? A[c] : undefined;
  return a ? { city: a[0], tz: a[1] } : null;
}

export const KNOWN_AIRPORTS = new Set(Object.keys(A));
