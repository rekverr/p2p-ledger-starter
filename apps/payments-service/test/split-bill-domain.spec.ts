import {
  deriveSplitBillStatus,
  SplitBillStatus,
} from '../src/split-bills/domain/split-bill-status';
import {
  formatMinorUnits,
  parseMoneyToMinor,
} from '../src/split-bills/domain/money';

describe('split bill domain', () => {
  it('uses exact minor-unit arithmetic', () => {
    expect(parseMoneyToMinor('123456789.01', 'amount')).toBe(12_345_678_901n);
    expect(formatMinorUnits(12_345_678_901n)).toBe('123456789.01');
    expect(() => parseMoneyToMinor('0.10e2', 'amount')).toThrow();
    expect(() => parseMoneyToMinor('1.001', 'amount')).toThrow();
    expect(() => parseMoneyToMinor('0.00', 'amount')).toThrow();
  });

  it('derives aggregate status only from paid share counts', () => {
    expect(deriveSplitBillStatus(0, 2)).toBe(SplitBillStatus.Pending);
    expect(deriveSplitBillStatus(1, 2)).toBe(SplitBillStatus.PartiallyPaid);
    expect(deriveSplitBillStatus(2, 2)).toBe(SplitBillStatus.Settled);
  });
});
