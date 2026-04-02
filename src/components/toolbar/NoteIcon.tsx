import { NoteDuration } from '../../types/music';

// ── Shared building-blocks ────────────────────────────────────────────────────
const HEAD_FILL = (
  <ellipse cx="7" cy="19.5" rx="5.5" ry="3.5"
    fill="currentColor" transform="rotate(-20,7,19.5)" />
);
const HEAD_OPEN = (
  <ellipse cx="7" cy="19.5" rx="5.5" ry="3.5"
    fill="none" stroke="currentColor" strokeWidth="1.6"
    transform="rotate(-20,7,19.5)" />
);
const stem  = (x: number, y1: number, y2: number) => (
  <line x1={x} y1={y1} x2={x} y2={y2}
    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
);
const flag  = (y: number) => (
  <path d={`M12.5,${y} C18,${y + 2} 17,${y + 7} 12.5,${y + 9}`}
    fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
);

// ── Note head SVG icons (6 base durations only) ───────────────────────────────
// All use viewBox="0 0 18 26", rendered at 14×20 px
const NOTE_ICONS: Partial<Record<NoteDuration, JSX.Element>> = {
  whole: (
    <svg viewBox="0 0 18 26" width="14" height="20" aria-hidden>
      {/* Hollow ellipse with inner cutout to mimic open whole-note head */}
      <ellipse cx="9" cy="18" rx="7"   ry="4.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <ellipse cx="9" cy="18" rx="3.5" ry="2"   fill="currentColor" />
      <ellipse cx="9" cy="18" rx="2"   ry="1.1" fill="white" />
    </svg>
  ),
  half: (
    <svg viewBox="0 0 18 26" width="14" height="20" aria-hidden>
      {HEAD_OPEN}
      {stem(12.5, 17.5, 3)}
    </svg>
  ),
  quarter: (
    <svg viewBox="0 0 18 26" width="14" height="20" aria-hidden>
      {HEAD_FILL}
      {stem(12.5, 17.5, 3)}
    </svg>
  ),
  eighth: (
    <svg viewBox="0 0 18 26" width="14" height="20" aria-hidden>
      {HEAD_FILL}
      {stem(12.5, 17.5, 3)}
      {flag(3)}
    </svg>
  ),
  sixteenth: (
    <svg viewBox="0 0 18 26" width="14" height="20" aria-hidden>
      {HEAD_FILL}
      {stem(12.5, 17.5, 2)}
      {flag(2)}
      {flag(7)}
    </svg>
  ),
  'thirty-second': (
    <svg viewBox="0 0 18 26" width="14" height="20" aria-hidden>
      {HEAD_FILL}
      {stem(12.5, 17.5, 1)}
      {flag(1)}
      {flag(5.5)}
      {flag(10)}
    </svg>
  ),
};

// ── Rest SVG icons ────────────────────────────────────────────────────────────
const REST_ICONS: Partial<Record<NoteDuration, JSX.Element>> = {
  whole: (
    // Whole rest: filled block HANGING below a ledger line
    <svg viewBox="0 0 18 26" width="14" height="20" aria-hidden>
      <line x1="2" y1="12" x2="16" y2="12" stroke="currentColor" strokeWidth="1" />
      <rect x="4" y="12" width="10" height="5" fill="currentColor" />
    </svg>
  ),
  half: (
    // Half rest: filled block SITTING above a ledger line
    <svg viewBox="0 0 18 26" width="14" height="20" aria-hidden>
      <rect x="4" y="11" width="10" height="5" fill="currentColor" />
      <line x1="2" y1="16" x2="16" y2="16" stroke="currentColor" strokeWidth="1" />
    </svg>
  ),
  quarter: (
    // Quarter rest: squiggle
    <svg viewBox="0 0 18 26" width="14" height="20" aria-hidden>
      <path d="M11,4 L8,9 L13,13 L6,18 L10,23"
        fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  eighth: (
    // Eighth rest: diagonal beam + dot
    <svg viewBox="0 0 18 26" width="14" height="20" aria-hidden>
      <circle cx="7.5" cy="16" r="2.8" fill="currentColor" />
      <line x1="10" y1="14" x2="8.5" y2="6"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="8.5" y1="6" x2="14" y2="4"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  sixteenth: (
    // Sixteenth rest: two beams + two dots
    <svg viewBox="0 0 18 26" width="14" height="20" aria-hidden>
      <circle cx="6.5" cy="17" r="2.4" fill="currentColor" />
      <circle cx="9"   cy="11" r="2.4" fill="currentColor" />
      <line x1="9"  y1="15" x2="7.5" y2="5"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="7.5" y1="5"  x2="13"  y2="3"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="12"  y1="9"  x2="15"  y2="8"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  'thirty-second': (
    // 32nd rest: three beams + three dots
    <svg viewBox="0 0 18 26" width="14" height="20" aria-hidden>
      <circle cx="5.5" cy="19" r="2.1" fill="currentColor" />
      <circle cx="7.5" cy="14" r="2.1" fill="currentColor" />
      <circle cx="9.5" cy="9"  r="2.1" fill="currentColor" />
      <line x1="9.5" y1="17" x2="7.5" y2="4"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="7.5" y1="4" x2="13" y2="2"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="12"  y1="8" x2="15" y2="7"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="13"  y1="13" x2="16" y2="12"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
};

/**
 * Renders the SVG icon for a note duration.
 * Dotted durations (e.g. 'dotted-quarter') strip the prefix and render the
 * base icon — the dot modifier is shown separately by the toolbar toggle.
 */
export const NoteIcon = ({ duration }: { duration: NoteDuration }) => {
  const base = (duration.startsWith('dotted-') || duration.startsWith('triplet-'))
    ? (duration.replace('dotted-', '').replace('triplet-', '') as NoteDuration)
    : duration;
  return NOTE_ICONS[base] ?? null;
};

export const RestIcon = ({ duration }: { duration: NoteDuration }) =>
  REST_ICONS[
    (duration.startsWith('dotted-') || duration.startsWith('triplet-'))
      ? (duration.replace('dotted-', '').replace('triplet-', '') as NoteDuration)
      : duration
  ] ?? null;
