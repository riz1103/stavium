import { Chord } from 'tonal';

/**
 * Tonal doesn't parse some parenthesized alteration spellings (for example, Dm7(b5), G7(#5)).
 * Normalize those variants so parsing is consistent across playback and AI tools.
 */
export const normalizeChordSymbol = (symbol: string): string =>
  symbol
    .replace(/\(([^)]+)\)/g, '$1')
    .replace(/\s+/g, '');

/**
 * Parse a chord symbol with a normalization fallback for common alias spellings.
 */
export const getChordData = (symbol: string) => {
  const direct = Chord.get(symbol);
  if (direct?.notes?.length) return direct;

  const normalized = normalizeChordSymbol(symbol);
  if (normalized === symbol) return direct;

  const fallback = Chord.get(normalized);
  return fallback?.notes?.length ? fallback : direct;
};

