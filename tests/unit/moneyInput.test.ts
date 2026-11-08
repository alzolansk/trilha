// Campo de dinheiro (MoneyInput): digitação com milhar e decimal em pt-BR.
import { describe, expect, it } from 'vitest';
import { nextMoneyText, parseMoneyInput } from '@/components/ui/MoneyInput';

/** Simula digitar `keys` um a um no fim do campo, como no teclado. */
function type(keys: string, start = ''): string {
  let text = start;
  for (const k of keys) {
    const value = text + k;
    text = nextMoneyText(text, value, value.length);
  }
  return text;
}

describe('MoneyInput · digitação', () => {
  it('passa de 2.000 sem virar 2,00 (bug do teto por pessoa)', () => {
    expect(type('2000')).toBe('2.000');
    expect(type('20000')).toBe('20.000');
    expect(type('200000')).toBe('200.000');
    expect(type('1500000')).toBe('1.500.000');
    expect(parseMoneyInput(type('20000'))).toBe(2_000_000);
  });

  it('ponto recém-digitado vira vírgula decimal (teclado do celular)', () => {
    expect(type('12.5')).toBe('12,5');
    expect(type('2000.50')).toBe('2.000,50');
    expect(parseMoneyInput(type('2000.50'))).toBe(200_050);
  });

  it('vírgula digitada continua sendo o decimal', () => {
    expect(type('3000,9')).toBe('3.000,9');
    expect(type('3000,999')).toBe('3.000,99');
  });

  it('apagar o último dígito refaz o milhar', () => {
    const t = type('20000');
    expect(nextMoneyText(t, t.slice(0, -1), t.length - 1)).toBe('2.000');
  });

  it('dígito no meio do número (cursor antes do ponto de milhar)', () => {
    // "2.000" com o cursor depois do 2, digita 5 → "25.000"
    expect(nextMoneyText('2.000', '25.000', 2)).toBe('25.000');
  });

  it('valor colado', () => {
    expect(nextMoneyText('', '1234.56', 7)).toBe('1.234,56');
    expect(nextMoneyText('', '1.234', 5)).toBe('1.234');
    expect(nextMoneyText('', '1.234,56', 8)).toBe('1.234,56');
  });
});
