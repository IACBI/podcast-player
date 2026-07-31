import { describe, expect, it } from 'vitest';
import ru from './langs/ru';

/**
 * Russian is the only locale with numeral agreement baked into a message, so
 * the one/few/many buckets are worth pinning — including the 11–14 teens that
 * take the genitive plural despite ending in 1–4.
 */
describe('ru numeral agreement', () => {
  it('picks the right case for each bucket', () => {
    const f = ru.status_ok as (n: number) => string;
    expect([1, 2, 5, 11, 21, 44, 112].map((n) => f(n))).toEqual([
      'Загружено 1 выпуск ✓',
      'Загружено 2 выпуска ✓',
      'Загружено 5 выпусков ✓',
      'Загружено 11 выпусков ✓',
      'Загружено 21 выпуск ✓',
      'Загружено 44 выпуска ✓',
      'Загружено 112 выпусков ✓',
    ]);
  });

  it('applies the same agreement to the library download total', () => {
    const f = ru.lib_dl_total as (n: number, size: string) => string;
    expect(f(1, '12 MB')).toBe('1 выпуск · 12 MB');
    expect(f(3, '40 MB')).toBe('3 выпуска · 40 MB');
    expect(f(9, '1,2 GB')).toBe('9 выпусков · 1,2 GB');
  });
});
