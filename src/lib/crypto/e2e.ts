// Criptografia ponta a ponta dos documentos, só com a Web Crypto API.
//
//   arquivo  ── AES-256-GCM (chave aleatória por documento, IV de 96 bits, AAD = id do documento)
//   chave do documento ── embrulhada para cada pessoa: ECDH P-256 efêmero → HKDF-SHA-256 → AES-GCM
//   chave privada da pessoa ── embrulhada com a frase de segurança: PBKDF2-SHA-256 → AES-GCM
//
// A chave privada desembrulhada nunca é exportável: fica só como CryptoKey (memória e IndexedDB).

const subtle = () => {
  if (typeof crypto === 'undefined' || !crypto.subtle) throw new Error('Este navegador não tem criptografia segura (Web Crypto). Use HTTPS e um navegador atual.');
  return crypto.subtle;
};

const enc = new TextEncoder();
const MAGIC = enc.encode('TRL1');
const IV_BYTES = 12;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
const HKDF_INFO = enc.encode('trilha/document-key/v1');
export const KDF_ITERATIONS = 600_000;

export class WrongPassphraseError extends Error {
  constructor() {
    super('Frase de segurança incorreta.');
    this.name = 'WrongPassphraseError';
  }
}

// ───── base64url ─────
export function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

// ───── Cofre da pessoa ─────
export interface VaultRecord {
  public_key: JsonWebKey;
  wrapped_private_key: string;
  wrap_iv: string;
  kdf_salt: string;
  kdf_iterations: number;
}

async function passphraseKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const base = await subtle().importKey('raw', enc.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}

async function wrapPrivate(privateKey: CryptoKey, passphrase: string) {
  const salt = random(16);
  const iv = random(IV_BYTES);
  const kek = await passphraseKey(passphrase, salt, KDF_ITERATIONS);
  const wrapped = await subtle().wrapKey('pkcs8', privateKey, kek, { name: 'AES-GCM', iv });
  return { wrapped_private_key: toB64(wrapped), wrap_iv: toB64(iv), kdf_salt: toB64(salt), kdf_iterations: KDF_ITERATIONS };
}

async function unwrapPrivate(v: VaultRecord, passphrase: string, extractable: boolean) {
  const kek = await passphraseKey(passphrase, fromB64(v.kdf_salt), v.kdf_iterations);
  try {
    return await subtle().unwrapKey('pkcs8', fromB64(v.wrapped_private_key), kek, { name: 'AES-GCM', iv: fromB64(v.wrap_iv) }, ECDH, extractable, ['deriveBits']);
  } catch {
    throw new WrongPassphraseError();
  }
}

/** Gera o par de chaves da pessoa e o cofre protegido pela frase. */
export async function createVault(passphrase: string): Promise<{ record: VaultRecord; privateKey: CryptoKey }> {
  const pair = await subtle().generateKey(ECDH, true, ['deriveBits']);
  const public_key = await subtle().exportKey('jwk', pair.publicKey);
  const record: VaultRecord = { public_key: { kty: public_key.kty, crv: public_key.crv, x: public_key.x, y: public_key.y }, ...(await wrapPrivate(pair.privateKey, passphrase)) };
  // daqui em diante só a versão não exportável circula
  const privateKey = await unwrapPrivate(record, passphrase, false);
  return { record, privateKey };
}

export const unlockVault = (v: VaultRecord, passphrase: string) => unwrapPrivate(v, passphrase, false);

/** Reembrulha a mesma chave privada com uma frase nova (a chave pública não muda). */
export async function changePassphrase(v: VaultRecord, oldPass: string, newPass: string) {
  const pk = await unwrapPrivate(v, oldPass, true);
  return wrapPrivate(pk, newPass);
}

// ───── Chave de cada documento ─────
export const newDocumentKey = () => subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);

async function sharedWrapKey(privateKey: CryptoKey, publicKey: CryptoKey, salt: Uint8Array<ArrayBuffer>) {
  const bits = await subtle().deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const hk = await subtle().importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: HKDF_INFO }, hk, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}

/** Embrulha a chave do documento para uma pessoa. O AAD amarra o embrulho ao documento e à pessoa. */
export async function wrapDocumentKey(docKey: CryptoKey, recipient: JsonWebKey, docId: string, userId: string): Promise<string> {
  const recipientKey = await subtle().importKey('jwk', recipient, ECDH, false, []);
  const eph = await subtle().generateKey(ECDH, true, ['deriveBits']);
  const ephRaw = new Uint8Array(await subtle().exportKey('raw', eph.publicKey));
  const kek = await sharedWrapKey(eph.privateKey, recipientKey, ephRaw);
  const iv = random(IV_BYTES);
  const wrapped = await subtle().wrapKey('raw', docKey, kek, { name: 'AES-GCM', iv, additionalData: enc.encode(`${docId}:${userId}`) });
  return ['v1', toB64(ephRaw), toB64(iv), toB64(wrapped)].join('.');
}

export async function unwrapDocumentKey(wrappedKey: string, privateKey: CryptoKey, docId: string, userId: string): Promise<CryptoKey> {
  const [v, eph, iv, ct] = wrappedKey.split('.');
  if (v !== 'v1' || !eph || !iv || !ct) throw new Error('Formato de chave desconhecido.');
  const ephRaw = fromB64(eph);
  const ephKey = await subtle().importKey('raw', ephRaw, ECDH, false, []);
  const kek = await sharedWrapKey(privateKey, ephKey, ephRaw);
  // exportável para poder liberar a outras pessoas; vive só na memória desta aba
  return subtle().unwrapKey('raw', fromB64(ct), kek, { name: 'AES-GCM', iv: fromB64(iv), additionalData: enc.encode(`${docId}:${userId}`) }, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

// ───── Arquivos ─────
// Formato: "TRL1" | IV (12 bytes) | texto cifrado + tag GCM (16 bytes)

export async function encryptBlob(key: CryptoKey, data: Blob, aad: string): Promise<Blob> {
  const iv = random(IV_BYTES);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, await data.arrayBuffer());
  return new Blob([MAGIC, iv, ct], { type: 'application/octet-stream' });
}

export async function decryptBlob(key: CryptoKey, data: Blob, aad: string, mime: string): Promise<Blob> {
  const buf = new Uint8Array(await data.arrayBuffer());
  if (buf.length < MAGIC.length + IV_BYTES + 16 || MAGIC.some((b, i) => buf[i] !== b)) throw new Error('Arquivo cifrado inválido.');
  const iv = buf.slice(MAGIC.length, MAGIC.length + IV_BYTES);
  try {
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, buf.subarray(MAGIC.length + IV_BYTES));
    return new Blob([pt], { type: mime });
  } catch {
    throw new Error('Não foi possível decifrar: o arquivo foi alterado ou a chave não confere.');
  }
}

/** AAD de cada parte do documento: impede trocar o arquivo de um documento pelo de outro. */
export const fileAad = (docId: string, part: 'file' | 'preview') => `trilha/${docId}/${part}`;
