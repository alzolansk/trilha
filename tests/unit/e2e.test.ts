import { describe, expect, it } from 'vitest';
import {
  changePassphrase, createVault, decryptBlob, encryptBlob, fileAad, newDocumentKey, unlockVault, unwrapDocumentKey,
  wrapDocumentKey, WrongPassphraseError,
} from '@/lib/crypto/e2e';

const text = (b: Blob) => b.text();

describe('criptografia ponta a ponta (Web Crypto)', () => {
  it('cifra e decifra o arquivo com AES-256-GCM; o conteúdo não aparece no cifrado', async () => {
    const key = await newDocumentKey();
    const plain = new Blob(['PASSAPORTE BR123456'], { type: 'application/pdf' });
    const ct = await encryptBlob(key, plain, fileAad('d1', 'file'));
    expect(ct.type).toBe('application/octet-stream');
    expect(ct.size).toBe(plain.size + 4 + 12 + 16);
    expect(await text(ct)).not.toContain('BR123456');
    const back = await decryptBlob(key, ct, fileAad('d1', 'file'), 'application/pdf');
    expect(back.type).toBe('application/pdf');
    expect(await text(back)).toBe('PASSAPORTE BR123456');
  });

  it('recusa arquivo adulterado ou de outro documento', async () => {
    const key = await newDocumentKey();
    const ct = new Uint8Array(await (await encryptBlob(key, new Blob(['x'.repeat(64)]), fileAad('d1', 'file'))).arrayBuffer());
    await expect(decryptBlob(key, new Blob([ct]), fileAad('d2', 'file'), 'text/plain')).rejects.toThrow(/decifrar/);
    ct[ct.length - 1] ^= 1;
    await expect(decryptBlob(key, new Blob([ct]), fileAad('d1', 'file'), 'text/plain')).rejects.toThrow(/decifrar/);
  });

  it('chave do documento só abre para quem recebeu, e só naquele documento', async () => {
    const ana = await createVault('frase longa da ana');
    const bia = await createVault('frase longa da bia');
    const docKey = await newDocumentKey();
    const wrapped = await wrapDocumentKey(docKey, bia.record.public_key, 'doc1', 'bia');
    const ct = await encryptBlob(docKey, new Blob(['segredo']), fileAad('doc1', 'file'));

    const got = await unwrapDocumentKey(wrapped, bia.privateKey, 'doc1', 'bia');
    expect(await text(await decryptBlob(got, ct, fileAad('doc1', 'file'), 'text/plain'))).toBe('segredo');
    await expect(unwrapDocumentKey(wrapped, ana.privateKey, 'doc1', 'bia')).rejects.toThrow();
    await expect(unwrapDocumentKey(wrapped, bia.privateKey, 'doc2', 'bia')).rejects.toThrow();
  });

  it('cofre: frase certa abre, errada não; chave privada não é exportável', async () => {
    const { record, privateKey } = await createVault('cavalo bateria grampo correto');
    expect(privateKey.extractable).toBe(false);
    expect(JSON.stringify(record)).not.toContain('"d"');
    const pk = await unlockVault(record, 'cavalo bateria grampo correto');
    expect(pk.extractable).toBe(false);
    await expect(unlockVault(record, 'outra frase qualquer')).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('trocar a frase mantém o mesmo par de chaves', async () => {
    const { record } = await createVault('primeira frase segura');
    const docKey = await newDocumentKey();
    const wrapped = await wrapDocumentKey(docKey, record.public_key, 'd', 'u');
    const next = { ...record, ...(await changePassphrase(record, 'primeira frase segura', 'segunda frase segura')) };
    await expect(unlockVault(next, 'primeira frase segura')).rejects.toBeInstanceOf(WrongPassphraseError);
    const pk = await unlockVault(next, 'segunda frase segura');
    await expect(unwrapDocumentKey(wrapped, pk, 'd', 'u')).resolves.toBeTruthy();
  });
});
