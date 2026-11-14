import { describe, expect, it } from 'vitest';
import { docMatrix } from '../../src/lib/docMatrix';
import type { TripBundle } from '../../src/data/types';

const members = [{ user_id: 'ana' }, { user_id: 'bia' }] as TripBundle['members'];
const doc = (owner_id: string, category: string, status = 'ready') => ({ owner_id, category, status }) as unknown as TripBundle['documents'][number];

describe('docMatrix', () => {
  it('conta os documentos visíveis', () => {
    const [id] = docMatrix({ members, documents: [doc('ana', 'identidade')] });
    expect(id.has.get('ana')).toBe(true);
    expect(id.has.get('bia')).toBe(false);
    expect(id.missing).toBe(1);
  });

  it('documento privado alheio conta pela presença, sem o documento', () => {
    const [id, pass] = docMatrix({ members, documents: [], documentPresence: [{ owner_id: 'bia', category: 'identidade' }] });
    expect(id.has.get('bia')).toBe(true);
    expect(pass.has.get('bia')).toBe(false);
  });

  it('documento ainda enviando não conta', () => {
    const [id] = docMatrix({ members, documents: [doc('ana', 'identidade', 'uploading')] });
    expect(id.has.get('ana')).toBe(false);
  });
});
