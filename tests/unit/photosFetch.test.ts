// Fotos buscadas no navegador (ajuste de 08/11/2026): fila, nova tentativa em 429, inglês como reserva
// e regra de título por palavras inteiras.
import { describe, expect, it, vi } from 'vitest';
import { fetchPhoto, titleMatches } from '@/lib/photos';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const info = (file: string) => ({ query: { pages: [{ imageinfo: [{ thumburl: `https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/${file}/1280px-${file}`, thumbwidth: 1280, thumbheight: 800, descriptionurl: `https://commons.wikimedia.org/wiki/File:${file}`, extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: 'Fulano' } } }] }] } });
const search = (title: string, file: string) => ({ query: { pages: [{ title, index: 1, pageimage: file }] } });

describe('titleMatches por palavras inteiras', () => {
  it('aceita o lugar e variações, recusa outro assunto com o mesmo nome', () => {
    expect(titleMatches('Osaka', 'Osaka')).toBe(true);
    expect(titleMatches('Cusco', 'Cusco (província)')).toBe(true);
    expect(titleMatches('Tóquio Shibuya', 'Shibuya')).toBe(true);
    expect(titleMatches('Osaka Dotonbori', 'Dōtonbori')).toBe(true);
    expect(titleMatches('Quioto', 'Romell Quioto')).toBe(false);
    expect(titleMatches('Nara', 'Nara Leão')).toBe(false);
    expect(titleMatches('Roma', 'Romania')).toBe(false);
  });

  it('não troca o lugar por uma pessoa com o mesmo nome', async () => {
    const { pickPageImage } = await import('@/lib/photos');
    const json = { query: { pages: [{ title: 'Nara Leão', index: 1, pageimage: 'Nara_Leao.jpg' }, { title: 'Nara', index: 3, pageimage: 'Todaiji.jpg' }] } };
    expect(pickPageImage(json, 'Nara, Japão')?.file).toBe('Todaiji.jpg');
    expect(pickPageImage({ query: { pages: [json.query.pages[0]] } }, 'Nara')).toBeNull();
  });
});

describe('fetchPhoto no navegador', () => {
  it('tenta de novo quando a Wikimedia limita (429) e acha a foto', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetcher = vi.fn(async (url: string) => {
      calls++;
      if (calls === 1) return new Response('limite', { status: 429 });
      return url.includes('imageinfo') ? json(info('Tokyo.jpg')) : json(search('Tóquio', 'Tokyo.jpg'));
    }) as unknown as typeof fetch;
    const p = fetchPhoto('Tóquio-429', 'pt', fetcher);
    await vi.runAllTimersAsync();
    expect((await p)?.url).toContain('thumb.wikimedia.org');
    vi.useRealTimers();
  });

  it('cai para o inglês e depois para a segunda busca', async () => {
    const seen: string[] = [];
    const fetcher = vi.fn(async (url: string) => {
      const u = new URL(url);
      seen.push(`${u.hostname.split('.')[0]}:${u.searchParams.get('gsrsearch') ?? 'info'}`);
      if (u.searchParams.has('gsrsearch')) {
        return u.searchParams.get('gsrsearch') === 'Dotonbori' && u.hostname.startsWith('en') ? json(search('Dōtonbori', 'Dotonbori.jpg')) : json({ query: { pages: [] } });
      }
      return json(info('Dotonbori.jpg'));
    }) as unknown as typeof fetch;
    const p = await fetchPhoto(['Lugar-sem-pagina', 'Dotonbori'], 'pt', fetcher);
    expect(p?.url).toContain('Dotonbori.jpg');
    expect(seen.slice(0, 3)).toEqual(['pt:Lugar-sem-pagina', 'en:Lugar-sem-pagina', 'pt:Dotonbori']);
  });

  it('falha de rede não fica guardada como "sem foto"', async () => {
    vi.useFakeTimers();
    let up = false;
    const fetcher = vi.fn(async (url: string) => {
      if (!up) throw new TypeError('Failed to fetch');
      return url.includes('imageinfo') ? json(info('Osaka.jpg')) : json(search('Osaka', 'Osaka.jpg'));
    }) as unknown as typeof fetch;
    const first = fetchPhoto('Osaka-rede', 'pt', fetcher);
    await vi.runAllTimersAsync();
    expect(await first).toBeNull();
    up = true;
    const second = fetchPhoto('Osaka-rede', 'pt', fetcher);
    await vi.runAllTimersAsync();
    expect((await second)?.url).toContain('Osaka.jpg');
    vi.useRealTimers();
  });
});
