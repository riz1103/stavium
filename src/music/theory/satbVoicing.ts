/**
 * SATB harmonization: soprano follows the source melody; A/T/B are chord tones
 * with simple voice-leading. Replaces the old "one block chord per measure" model.
 */

import { Note as TonalNote } from 'tonal';
import type { ChordSymbol, Measure, MusicElement, Note, Staff } from '../../types/music';
import { durationToBeats } from '../../utils/durationUtils';
import { getChordData } from '../../utils/chordSymbolUtils';
import { midiToPitch, pitchToMidi } from '../../utils/noteUtils';

const BASS = [40, 60] as const;
const TENOR = [48, 67] as const;
const ALTO = [55, 72] as const;
const SOP = [60, 79] as const;

export interface SatbHarmonyProfile {
  /** 0 = tight inner parts, 1 = wider spacing between A/T/B */
  openness: number;
  /** Prefer doubling the root in an inner voice when harmonizing triads */
  doubleRoot: boolean;
}

interface FourVoices {
  s: number;
  a: number;
  t: number;
  b: number;
}

const chordPitchClasses = (symbol: string): Set<number> => {
  const data = getChordData(symbol);
  const set = new Set<number>();
  for (const name of data.notes ?? []) {
    const midi = TonalNote.midi(`${name}4`);
    if (midi != null) set.add(((midi % 12) + 12) % 12);
  }
  return set;
};

const isChordToneMidi = (midi: number, symbol: string): boolean => {
  const pcs = chordPitchClasses(symbol);
  return pcs.has(((midi % 12) + 12) % 12);
};

/** All MIDI values in [lo, hi] that belong to this chord. */
const chordToneMidisInRange = (symbol: string, lo: number, hi: number): number[] => {
  const data = getChordData(symbol);
  if (!data.notes?.length) return [];
  const out: number[] = [];
  for (const name of data.notes) {
    for (let oct = 2; oct <= 7; oct++) {
      const m = TonalNote.midi(`${name}${oct}`);
      if (m != null && m >= lo && m <= hi) out.push(m);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
};

const clampSoprano = (midi: number): number => {
  let m = midi;
  while (m < SOP[0]) m += 12;
  while (m > SOP[1]) m -= 12;
  return Math.max(SOP[0], Math.min(SOP[1], m));
};

const resolveChordSymbol = (chords: ChordSymbol[] | undefined, beat: number, fallback: string): string => {
  if (!chords?.length) return fallback;
  const sorted = [...chords].sort((a, b) => a.beat - b.beat);
  let sym = sorted[0].symbol;
  for (const c of sorted) {
    if (c.beat <= beat + 1e-6) sym = c.symbol;
    else break;
  }
  return sym || fallback;
};

/** Pick bass–tenor–alto below soprano; prefers smooth motion from previous voicing. */
const voiceInnerParts = (
  sMidi: number,
  symbol: string,
  prev: FourVoices | null,
  profile: SatbHarmonyProfile
): FourVoices => {
  const rootPc = (() => {
    const t = getChordData(symbol).tonic;
    if (!t) return null;
    const m = TonalNote.midi(`${t}3`);
    return m != null ? ((m % 12) + 12) % 12 : null;
  })();

  const spreadW = profile.openness * 4;

  const tryVoicing = (s: number): FourVoices | null => {
    if (s <= BASS[0] + 5) return null;
    const bs = chordToneMidisInRange(symbol, BASS[0], Math.min(BASS[1], s - 9));
    const candidates: FourVoices[] = [];
    for (const b of bs) {
      const tLo = Math.max(b + 1, TENOR[0]);
      const tHi = Math.min(TENOR[1], s - 2);
      if (tLo > tHi) continue;
      const ts = chordToneMidisInRange(symbol, tLo, tHi);
      for (const t of ts) {
        if (t <= b) continue;
        const aLo = Math.max(t + 1, ALTO[0]);
        const aHi = Math.min(ALTO[1], s - 1);
        if (aLo > aHi) continue;
        const as = chordToneMidisInRange(symbol, aLo, aHi);
        for (const a of as) {
          if (a <= t || a >= s) continue;
          candidates.push({ s, a, t, b });
        }
      }
    }

    if (candidates.length === 0) return null;

    const score = (v: FourVoices): number => {
      let cost = 0;
      if (prev) {
        cost += Math.abs(v.b - prev.b) + Math.abs(v.t - prev.t) + Math.abs(v.a - prev.a);
      }
      const innerSpread = v.a - v.t + v.t - v.b;
      cost -= spreadW * innerSpread * 0.08;
      if (rootPc != null && ((v.b % 12) + 12) % 12 === rootPc) cost -= 3;
      if (profile.doubleRoot) {
        const doubles = [v.a, v.t, v.b].filter((m) => ((m % 12) + 12) % 12 === rootPc).length;
        cost -= doubles * 1.5;
      }
      return cost;
    };

    let best = candidates[0]!;
    let bestS = score(best);
    for (let i = 1; i < candidates.length; i++) {
      const sc = score(candidates[i]!);
      if (sc < bestS) {
        bestS = sc;
        best = candidates[i]!;
      }
    }
    return best;
  };

  let s = sMidi;
  for (let attempt = 0; attempt < 4; attempt++) {
    const v = tryVoicing(s);
    if (v) return v;
    s = s < 72 ? s + 12 : s - 12;
    s = clampSoprano(s);
  }

  // Last resort: stack from chord close to melody
  const midis = chordToneMidisInRange(symbol, BASS[0], sMidi - 1).filter((m) => m < sMidi);
  if (midis.length >= 3) {
    const b = midis[0]!;
    const t = midis[Math.floor(midis.length / 2)]!;
    const a = midis[midis.length - 1]!;
    if (b < t && t < a && a < sMidi) return { s: sMidi, a, t, b };
  }

  return {
    s: sMidi,
    a: Math.max(ALTO[0], sMidi - 12),
    t: Math.max(TENOR[0], sMidi - 19),
    b: Math.max(BASS[0], sMidi - 24),
  };
};

/**
 * Build four SATB staves: soprano = melody (octave-adjusted), inner voices = chord harmony per note.
 * Voice leading carries across barlines.
 */
export function buildSatbStavesMelodyFirst(
  sourceStaff: Staff,
  chordsByMeasure: ChordSymbol[][],
  profile: SatbHarmonyProfile,
  keyFallback: string,
): Staff[] {
  type Row = { rest: true; duration: MusicElement['duration'] } | { rest: false; duration: MusicElement['duration']; v: FourVoices };
  const rows: Row[] = [];
  let prevVoicing: FourVoices | null = null;

  sourceStaff.measures.forEach((measure, mi) => {
    const chords = chordsByMeasure[mi] ?? [];
    const source = measure.voices[0]?.notes ?? [];
    let beat = 0;

    for (const el of source) {
      const beats = durationToBeats(el.duration);
      if (!('pitch' in el)) {
        rows.push({ rest: true, duration: el.duration });
        beat += beats;
        continue;
      }

      const sym = resolveChordSymbol(chords, beat, keyFallback);
      let sMidi = pitchToMidi(el.pitch);
      sMidi = clampSoprano(sMidi);
      const voicing = voiceInnerParts(sMidi, sym, prevVoicing, profile);
      prevVoicing = voicing;
      rows.push({ rest: false, duration: el.duration, v: voicing });
      beat += beats;
    }
  });

  const staffDefs: Array<{
    name: string;
    clef: 'treble' | 'bass' | 'tenor';
    instrument: string;
    part: 's' | 'a' | 't' | 'b';
  }> = [
    { name: 'AI Soprano', clef: 'treble', instrument: 'choir', part: 's' },
    { name: 'AI Alto', clef: 'treble', instrument: 'choir', part: 'a' },
    { name: 'AI Tenor', clef: 'tenor', instrument: 'choir', part: 't' },
    { name: 'AI Bass', clef: 'bass', instrument: 'choir', part: 'b' },
  ];

  let rowIdx = 0;
  return staffDefs.map((def) => {
    rowIdx = 0;
    return {
      name: def.name,
      instrument: def.instrument,
      clef: def.clef,
      aiGenerated: true,
      measures: sourceStaff.measures.map((measure) => {
        const source = measure.voices[0]?.notes ?? [];
        const notes: MusicElement[] = [];
        for (let i = 0; i < source.length; i++) {
          const row = rows[rowIdx++]!;
          const el = source[i]!;
          if (row.rest || !('pitch' in el)) {
            notes.push({ duration: row.duration });
            continue;
          }
          const midiVal = row.v[def.part];
          notes.push({
            pitch: midiToPitch(midiVal),
            duration: row.duration,
            lyric: undefined,
          } satisfies Note);
        }
        return { number: measure.number, voices: [{ notes }] };
      }),
    };
  });
}

export { chordPitchClasses, isChordToneMidi };
