// Fotos do Unsplash (ajuste de 14/11/2026): filtro de qualidade, conferência do lugar, URLs redimensionadas
// e "servidor primeiro" com reserva na Wikipedia.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimPhoto, fetchPlacePhoto, parseRatio, photoCredit, photoSrcSet, resetPhotoClaims, setPhotoServer, unsplashAt } from '@/lib/photos';
import { isUsable, mentions, needFor, pickVerified, placeCheck, toPhotoRef, type UnsplashPhoto } from '@/lib/unsplash';

const RAW = 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?ixid=M3wxfDB8MXxzZWFyY2g&ixlib=rb-4.0.3';
const photo = (over: Partial<UnsplashPhoto> = {}): UnsplashPhoto => ({
  id: 'abc123XYZ', width: 6000, height: 4000, color: '#a0b0c0', blur_hash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
  description: null, alt_description: 'a red and white temple', urls: { raw: RAW },
  user: { name: 'Sora Sagano', links: { html: 'https://unsplash.com/@sora' } }, links: { html: 'https://unsplash.com/photos/abc123XYZ' },
  ...over,
});

afterEach(() => {
  setPhotoServer(null);
  resetPhotoClaims();
});

describe('qualidade', () => {
  it('aceita paisagem grande e recusa retrato, foto pequena e Unsplash+', () => {
    expect(isUsable(photo())).toBe(true);
    expect(isUsable(photo({ width: 3000, height: 4000 }))).toBe(false);
    expect(isUsable(photo({ width: 1200, height: 800 }))).toBe(false);
    expect(isUsable(photo({ premium: true }))).toBe(false);
    expect(isUsable(photo({ urls: { raw: 'https://plus.unsplash.com/premium_photo-1?x=1' } }))).toBe(false);
  });
});

describe('conferência do lugar', () => {
  const kyoto = { names: ['Quioto', 'Kyoto'], lat: 35.0116, lng: 135.7681, radiusKm: 40 };

  it('coordenadas da foto mandam: perto vale, longe não', () => {
    expect(placeCheck(photo({ location: { position: { latitude: 34.97, longitude: 135.77 } } }), kyoto)).toBe('yes');
    expect(placeCheck(photo({ location: { city: 'Kyoto', position: { latitude: 35.68, longitude: 139.69 } } }), kyoto)).toBe('no');
  });

  it('sem coordenadas, vale o texto citar o nome por palavra inteira', () => {
    expect(placeCheck(photo({ description: 'Morning in Kyoto, Japan' }), kyoto)).toBe('yes');
    expect(placeCheck(photo({ tags: [{ title: 'kyoto' }] }), kyoto)).toBe('yes');
    expect(placeCheck(photo({ description: 'Kyotoesque garden' }), kyoto)).toBe('unknown');
    expect(placeCheck(photo(), kyoto)).toBe('unknown');
    expect(mentions('nara park deer', ['Nara'])).toBe(true);
    expect(mentions('narayan temple', ['Nara'])).toBe(false);
  });

  it('passeio usa as palavras próprias, não a cidade', () => {
    expect(needFor({ kind: 'activity', names: ['Passeio pelo Fushimi Inari'], city: 'Kyoto' })).toEqual(['fushimi', 'inari']);
    expect(needFor({ kind: 'place', names: ['Cambuí (Campinas)', 'Cambui, Campinas'] })).toEqual(['Cambuí', 'Cambui']);
  });

  it('pega direto pelo texto da busca, sem abrir detalhe', async () => {
    const detail = vi.fn();
    const hit = await pickVerified([photo({ id: 'one' }), photo({ id: 'two', description: 'Kyoto streets' })], { names: ['Kyoto'] }, detail);
    expect(hit?.id).toBe('two');
    expect(detail).not.toHaveBeenCalled();
  });

  it('abre o detalhe (com local) das primeiras fotos e para na primeira que passa', async () => {
    const detail = vi.fn(async (id: string) => (id === 'b' ? photo({ id: 'b', location: { position: { latitude: 35.0, longitude: 135.76 } } }) : photo({ id })));
    const hit = await pickVerified([photo({ id: 'a' }), photo({ id: 'b' }), photo({ id: 'c' })], { names: ['Kyoto'], lat: 35.01, lng: 135.77, radiusKm: 40 }, detail);
    expect(hit?.id).toBe('b');
    expect(detail).toHaveBeenCalledTimes(2);
  });

  it('sem nenhuma conferida, não há foto (nunca foto de outro lugar)', async () => {
    const detail = vi.fn(async (id: string) => photo({ id }));
    expect(await pickVerified([photo({ id: 'a' }), photo({ id: 'b' }), photo({ id: 'c' }), photo({ id: 'd' })], { names: ['Kyoto'] }, detail, 3)).toBeNull();
    expect(detail).toHaveBeenCalledTimes(3);
  });
});

describe('PhotoRef e URLs', () => {
  it('grava crédito com UTM, cor e prévia', () => {
    const p = toPhotoRef(photo());
    expect(p).toMatchObject({ provider: 'unsplash', provider_id: 'abc123XYZ', author: 'Sora Sagano', color: '#A0B0C0', license: 'Licença Unsplash' });
    expect(p.author_url).toBe('https://unsplash.com/@sora?utm_source=trilha&utm_medium=referral');
    expect(p.source_url).toContain('utm_medium=referral');
    expect(photoCredit(p)).toBe('Foto de Sora Sagano no Unsplash');
  });

  it('pede largura, formato automático e, com proporção, recorte pela área interessante', () => {
    const u = new URL(unsplashAt(RAW, 960, 16 / 9));
    expect(u.searchParams.get('ixid')).toBe('M3wxfDB8MXxzZWFyY2g');
    expect(u.searchParams.get('w')).toBe('960');
    expect(u.searchParams.get('h')).toBe('540');
    expect(u.searchParams.get('crop')).toBe('entropy');
    expect(u.searchParams.get('auto')).toBe('format');
    expect(new URL(unsplashAt(RAW, 400)).searchParams.has('h')).toBe(false);
    expect(photoSrcSet(RAW)?.split(', ')).toHaveLength(6);
    expect(parseRatio('16/9')).toBeCloseTo(1.778, 2);
    expect(parseRatio('auto')).toBeNull();
  });

  it('a mesma foto em larguras diferentes conta como uma só para não repetir', () => {
    expect(claimPhoto(unsplashAt(RAW, 400), 'quioto')).toBe(true);
    expect(claimPhoto(unsplashAt(RAW, 1280), 'osaka')).toBe(false);
  });
});

describe('servidor primeiro', () => {
  const place = { name: 'Quioto', context: 'Japão', lat: 35.0116, lng: 135.7681, radiusKm: 40 };

  it('com foto do servidor, nem chama a Wikipedia', async () => {
    const fromServer = toPhotoRef(photo());
    setPhotoServer(async () => fromServer);
    const wiki = vi.fn();
    expect(await fetchPlacePhoto({ ...place, name: 'Quioto A' }, wiki as unknown as typeof fetch)).toEqual(fromServer);
    expect(wiki).not.toHaveBeenCalled();
  });

  it('servidor sem chave ou fora do ar: segue para a Wikipedia', async () => {
    setPhotoServer(async () => undefined);
    const wiki = vi.fn(async () => new Response(JSON.stringify({ query: { pages: [] } }), { headers: { 'content-type': 'application/json' } }));
    expect(await fetchPlacePhoto({ ...place, name: 'Quioto B' }, wiki as unknown as typeof fetch)).toBeNull();
    expect(wiki).toHaveBeenCalled();
  });
});
