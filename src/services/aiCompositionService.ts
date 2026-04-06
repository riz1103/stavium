/**
 * AI Composition Service — Reharmonize, SATB Voicing, and Countermelody generation.
 * Uses OpenAI-compatible API (default: Groq free tier via VITE_MUSIC_AI_API_KEY); falls back to heuristics.
 * Help chat uses Google Gemini separately (VITE_GEMINI_API_KEY).
 */

import { Key } from 'tonal';
import { Composition, ChordSymbol, Staff, MusicElement, Note } from '../types/music';
import { pitchToMidi, midiToPitch } from '../utils/noteUtils';
import { getChordData } from '../utils/chordSymbolUtils';
import { buildSatbStavesMelodyFirst } from '../music/theory/satbVoicing';
import { ArrangementCandidate } from './arrangementService';
import { chatCompletionText, isMusicAiConfigured } from './musicAiClient';

const MUSIC_AI_FALLBACK_WARN =
  'Music AI not configured. Add VITE_MUSIC_AI_API_KEY (Groq: console.groq.com) or use smart fallback.';

// ─── Public types ────────────────────────────────────────────────────────────

export type HarmonyStyle = 'classical' | 'jazz' | 'pop' | 'modal';

export interface ChordProgressionCandidate {
  id: string;
  title: string;
  description: string;
  /** One entry per measure. Each entry is an array of chord symbols for that measure. */
  progressions: ChordSymbol[][];
  source: 'ai' | 'heuristic';
}

export interface ReharmonizationResult {
  candidates: ChordProgressionCandidate[];
  warning?: string;
}

export interface CountermelodyCandidate {
  id: string;
  title: string;
  description: string;
  staff: Staff;
  source: 'ai' | 'heuristic';
}

export interface CountermelodyResult {
  candidates: CountermelodyCandidate[];
  warning?: string;
}

export interface SATBResult {
  candidates: ArrangementCandidate[];
  warning?: string;
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

const extractJson = (text: string): string | null => {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return null;
};

/** Pitch class from a full pitch string, e.g. "Eb4" → "Eb". */
const pitchClass = (pitch: string): string => {
  const m = pitch.match(/^([A-G](?:#|b|##|bb)?)/);
  return m ? m[1] : pitch;
};

/** Build a compact melody description for AI prompts. */
const toCompactMelody = (staff: Staff, maxNotes = 80): string =>
  staff.measures
    .flatMap((m) => (m.voices[0]?.notes ?? []).map((el) =>
      'pitch' in el ? `${el.pitch}:${el.duration}` : `rest:${el.duration}`
    ))
    .slice(0, maxNotes)
    .join(', ');

// ─── Reharmonization ────────────────────────────────────────────────────────

/**
 * Returns the 7 diatonic triads of a major key in Tonal's chord name format,
 * e.g. for "C": ["C", "Dm", "Em", "F", "G", "Am", "Bdim"].
 */
const getDiatonicTriads = (keyRoot: string): string[] => {
  try {
    const key = Key.majorKey(keyRoot);
    return [...(key.triads ?? [])];
  } catch {
    return ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim'];
  }
};

/** Score a chord name against a set of melody pitch classes. */
const scoreChordAgainstMelody = (chordName: string, melodyPCs: Set<string>): number => {
  const chordData = getChordData(chordName);
  const notes = chordData.notes ?? [];
  if (notes.length === 0 || melodyPCs.size === 0) return 0;
  let common = 0;
  for (const n of notes) {
    if (melodyPCs.has(n)) common++;
  }
  return common / notes.length;
};

/** Get pitch classes of melody notes in a single staff measure (voice 0). */
const getMeasurePitchClasses = (staff: Staff, measureIndex: number): Set<string> => {
  const measure = staff.measures[measureIndex];
  if (!measure) return new Set();
  const pcs = new Set<string>();
  for (const el of measure.voices[0]?.notes ?? []) {
    if ('pitch' in el) pcs.add(pitchClass(el.pitch));
  }
  return pcs;
};

interface HarmonicVariant {
  title: string;
  description: string;
  chordPool: (triads: string[]) => string[];
  chordsPerMeasure: 1 | 2;
  addColor: boolean;
}

const HARMONIC_VARIANTS: HarmonicVariant[] = [
  {
    title: 'Simple Diatonic',
    description: 'Clean, singable harmonization using the most common chords (I, IV, V, vi).',
    chordPool: (t) => [t[0], t[3], t[4], t[5]].filter(Boolean),
    chordsPerMeasure: 1,
    addColor: false,
  },
  {
    title: 'Rich Diatonic',
    description: 'All seven diatonic chords with occasional two-chord measures for momentum.',
    chordPool: (t) => t.filter(Boolean),
    chordsPerMeasure: 2,
    addColor: false,
  },
  {
    title: 'Colorful',
    description: 'Adds secondary dominants and borrowed chords for expressive color.',
    chordPool: (t) => t.filter(Boolean),
    chordsPerMeasure: 2,
    addColor: true,
  },
];

/** Get secondary dominant for a target chord, e.g. V7/V for G → D7. */
const getSecondaryDominant = (targetChordName: string): string | null => {
  const chord = getChordData(targetChordName);
  if (!chord.tonic) return null;
  // Secondary dominant = major 3rd interval up from tonic = dominant 7th chord
  // We raise the tonic by a P5 to get its own dominant
  const noteMap: Record<string, string> = {
    C: 'G7', D: 'A7', E: 'B7', F: 'C7', G: 'D7', A: 'E7', B: 'F#7',
    Db: 'Ab7', Eb: 'Bb7', Gb: 'Db7', Ab: 'Eb7', Bb: 'F7',
    'C#': 'G#7', 'D#': 'A#7', 'F#': 'C#7', 'G#': 'D#7', 'A#': 'E#7',
  };
  return noteMap[chord.tonic] ?? null;
};

const buildHeuristicProgressions = (
  staff: Staff,
  keyRoot: string,
): ChordProgressionCandidate[] => {
  const triads = getDiatonicTriads(keyRoot);

  return HARMONIC_VARIANTS.map((variant, idx): ChordProgressionCandidate => {
    const pool = variant.chordPool(triads);
    const progressions: ChordSymbol[][] = staff.measures.map((_, mi) => {
      const pcs = getMeasurePitchClasses(staff, mi);

      // Score all pool chords; pick best
      const scored = pool
        .map((c) => ({ chord: c, score: scoreChordAgainstMelody(c, pcs) }))
        .sort((a, b) => b.score - a.score);

      const best = scored[0]?.chord ?? triads[0] ?? 'C';
      const chords: ChordSymbol[] = [{ symbol: best, beat: 0 }];

      if (variant.chordsPerMeasure === 2 && scored.length > 1 && mi % 2 === 1) {
        // Add a passing chord on beat 2 from the second-best
        const second = scored[1].chord;
        chords.push({ symbol: second, beat: 2 });
      }

      if (variant.addColor && chords.length > 0 && mi % 3 === 2) {
        // Insert a secondary dominant before the last chord
        const lastSymbol = chords[chords.length - 1].symbol;
        const secDom = getSecondaryDominant(lastSymbol);
        if (secDom) {
          chords.unshift({ symbol: secDom, beat: 0 });
          chords[1] = { symbol: lastSymbol, beat: 2 };
        }
      }

      return chords;
    });

    return {
      id: `reharm-${idx + 1}`,
      title: variant.title,
      description: variant.description,
      progressions,
      source: 'heuristic',
    };
  });
};

export async function reharmonizeMelody(
  composition: Composition,
  staffIndex: number,
  style: HarmonyStyle,
): Promise<ReharmonizationResult> {
  const staff = composition.staves[staffIndex];
  if (!staff) return { candidates: [], warning: 'No source staff selected.' };

  const keyRoot = composition.keySignature ?? 'C';
  const fallback = buildHeuristicProgressions(staff, keyRoot);

  if (!isMusicAiConfigured()) {
    return { candidates: fallback, warning: MUSIC_AI_FALLBACK_WARN };
  }

  const measureCount = staff.measures.length;
  const beatsPerMeasure = parseInt(composition.timeSignature?.split('/')[0] ?? '4', 10);
  const prompt = `You are a music theorist reharmonizing a melody.
Return strict JSON only (no markdown), matching this schema exactly:
{
  "candidates": [
    {
      "title": "string",
      "description": "string",
      "progressions": [
        [{"symbol": "C", "beat": 0}]
      ]
    }
  ]
}

Rules:
- Exactly 3 candidates (titles: "Simple Diatonic", "Rich Diatonic", "Colorful").
- progressions array length MUST be exactly ${measureCount}.
- Each element is an array of 1-2 chord symbols for that measure.
- beat values: 0 to ${beatsPerMeasure - 1}.
- Chord symbols must be valid (e.g., "C", "Am", "G7", "Dm7", "F/A", "Bb", "E7").
- Key: ${keyRoot} major, Style: ${style}
- Melody excerpt: ${toCompactMelody(staff)}
`;

  try {
    const raw = await chatCompletionText(prompt, { temperature: 0.85, maxTokens: 1200 });
    if (raw === null) return { candidates: fallback, warning: 'Music AI request failed. Showing smart fallback suggestions.' };
    const jsonText = extractJson(raw);
    if (!jsonText) return { candidates: fallback, warning: 'Music AI response was not valid JSON. Showing fallback suggestions.' };

    const parsed = JSON.parse(jsonText) as {
      candidates?: Array<{
        title?: string;
        description?: string;
        progressions?: Array<Array<{ symbol?: string; beat?: number }>>;
      }>;
    };

    const aiCandidates = (parsed.candidates ?? []).slice(0, 3).map((c, idx): ChordProgressionCandidate => {
      const rawProgs = c.progressions ?? [];
      const progressions: ChordSymbol[][] = staff.measures.map((_, mi) => {
        const chords = (rawProgs[mi] ?? [])
          .filter((ch) => typeof ch.symbol === 'string' && ch.symbol.length > 0)
          .map((ch) => ({ symbol: ch.symbol!, beat: Number.isFinite(ch.beat) ? ch.beat! : 0 }))
          .sort((a, b) => a.beat - b.beat);
        return chords.length > 0 ? chords : [{ symbol: 'C', beat: 0 }];
      });
      return {
        id: `ai-reharm-${idx + 1}`,
        title: c.title?.trim() || `AI Idea ${idx + 1}`,
        description: c.description?.trim() || 'AI-suggested chord progression.',
        progressions,
        source: 'ai',
      };
    });

    if (aiCandidates.length === 3) return { candidates: aiCandidates };
    return { candidates: fallback, warning: 'AI returned incomplete data. Showing fallback suggestions.' };
  } catch {
    return { candidates: fallback, warning: 'AI is temporarily unavailable. Showing fallback suggestions.' };
  }
}

// ─── SATB Voicing ────────────────────────────────────────────────────────────

interface SATBProfile {
  title: string;
  description: string;
  // 0=close, 1=open spacing; affects inner-voice spread in the harmonizer
  openness: number;
  /** Prefer doubling the root in inner voices when harmonizing triads */
  doubleRoot: boolean;
}

const SATB_PROFILES: SATBProfile[] = [
  {
    title: 'Smooth Voice Leading',
    description: 'Close position with minimal movement between chords for a legato chorale texture.',
    openness: 0,
    doubleRoot: false,
  },
  {
    title: 'Open Spacing',
    description: 'Wider spread between voices for a full, resonant sound with doubled roots.',
    openness: 1,
    doubleRoot: true,
  },
  {
    title: 'Mixed Texture',
    description: 'Alternating close and open voicings following the phrase shape.',
    openness: 0.5,
    doubleRoot: false,
  },
];

const buildSATBStaves = (
  sourceStaff: Staff,
  chordsByMeasure: ChordSymbol[][],
  profile: SATBProfile,
  keyFallback: string,
): Staff[] =>
  buildSatbStavesMelodyFirst(
    sourceStaff,
    chordsByMeasure,
    { openness: profile.openness, doubleRoot: profile.doubleRoot },
    keyFallback,
  );

const buildHeuristicSATBCandidates = (
  sourceStaff: Staff,
  chordsByMeasure: ChordSymbol[][],
  keyFallback: string,
): ArrangementCandidate[] =>
  SATB_PROFILES.map((profile, idx): ArrangementCandidate => ({
    id: `satb-${idx + 1}`,
    title: profile.title,
    description: profile.description,
    staves: buildSATBStaves(sourceStaff, chordsByMeasure, profile, keyFallback),
    source: 'heuristic',
  }));

export async function generateSATBVoicing(
  composition: Composition,
  staffIndex: number,
  style: HarmonyStyle,
): Promise<SATBResult> {
  const staff = composition.staves[staffIndex];
  if (!staff) return { candidates: [], warning: 'No source staff selected.' };

  // Collect chord symbols from the source staff (or fall back to key-based harmonization)
  const keyRoot = composition.keySignature ?? 'C';
  const chordsByMeasure: ChordSymbol[][] = staff.measures.map((m) => {
    if (m.chords && m.chords.length > 0) return m.chords;
    // No chords on this measure — use simple key-based tonic
    const triads = getDiatonicTriads(keyRoot);
    const pcs = getMeasurePitchClasses(staff, staff.measures.indexOf(m));
    const scored = triads
      .map((c) => ({ chord: c, score: scoreChordAgainstMelody(c, pcs) }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0]?.chord ?? triads[0] ?? 'C';
    return [{ symbol: best, beat: 0 }];
  });

  const fallback = buildHeuristicSATBCandidates(staff, chordsByMeasure, keyRoot);

  if (!isMusicAiConfigured()) {
    return { candidates: fallback, warning: MUSIC_AI_FALLBACK_WARN };
  }

  // AI: ask for voicing profiles (openness + spacing)
  const prompt = `You are a choral arranger creating SATB voicings.
Return strict JSON only (no markdown):
{
  "candidates": [
    {
      "title": "string",
      "description": "string",
      "openness": 0-1,
      "doubleRoot": true/false
    }
  ]
}

Rules:
- Exactly 3 candidates.
- openness: 0 = close position, 1 = open/spread
- doubleRoot: true to prefer doubling the root in inner voices (triads)
- Style: ${style}, Key: ${keyRoot}
- Chord progression: ${chordsByMeasure.map((cs) => cs.map((c) => c.symbol).join('+')).join(', ')}
`;

  try {
    const raw = await chatCompletionText(prompt, { temperature: 0.7, maxTokens: 600 });
    if (raw === null) return { candidates: fallback, warning: 'Music AI request failed. Showing smart fallback suggestions.' };
    const jsonText = extractJson(raw);
    if (!jsonText) return { candidates: fallback, warning: 'Music AI response was not valid JSON. Showing fallback suggestions.' };

    const parsed = JSON.parse(jsonText) as {
      candidates?: Array<{ title?: string; description?: string; openness?: number; doubleRoot?: boolean }>;
    };

    const aiCandidates = (parsed.candidates ?? []).slice(0, 3).map((c, idx): ArrangementCandidate => {
      const profile: SATBProfile = {
        title: c.title?.trim() || `AI SATB ${idx + 1}`,
        description: c.description?.trim() || 'AI-tuned SATB voicing.',
        openness: typeof c.openness === 'number' ? Math.max(0, Math.min(1, c.openness)) : 0.5,
        doubleRoot: c.doubleRoot ?? false,
      };
      return {
        id: `ai-satb-${idx + 1}`,
        title: profile.title,
        description: profile.description,
        staves: buildSATBStaves(staff, chordsByMeasure, profile, keyRoot),
        source: 'ai',
      };
    });

    if (aiCandidates.length === 3) return { candidates: aiCandidates };
    return { candidates: fallback, warning: 'AI returned incomplete data. Showing fallback suggestions.' };
  } catch {
    return { candidates: fallback, warning: 'AI is temporarily unavailable. Showing fallback suggestions.' };
  }
}

// ─── Countermelody ───────────────────────────────────────────────────────────

interface CountermelodyProfile {
  title: string;
  description: string;
  /** 0 = stay close, 1 = leap widely */
  intervalWeight: number;
  /** 0 = parallel, 1 = strictly contrary motion */
  contraryWeight: number;
  /** -1 = below melody, 0 = same range, 1 = above melody */
  register: -1 | 0 | 1;
  /** -1 = slower (use longer notes), 0 = same rhythm, 1 = faster (fill gaps) */
  rhythmOffset: -1 | 0 | 1;
  instrument: string;
  clef: 'treble' | 'bass';
}

const COUNTER_PROFILES: CountermelodyProfile[] = [
  {
    title: 'Upper Counterpoint',
    description: 'High-register countermelody moving against the main melody in contrary motion.',
    intervalWeight: 0.4,
    contraryWeight: 0.8,
    register: 1,
    rhythmOffset: 0,
    instrument: 'flute',
    clef: 'treble',
  },
  {
    title: 'Lower Response',
    description: 'Bass-clef countermelody that fills rhythmic gaps and responds to the melody.',
    intervalWeight: 0.3,
    contraryWeight: 0.6,
    register: -1,
    rhythmOffset: 1,
    instrument: 'strings',
    clef: 'bass',
  },
  {
    title: 'Inner Voice',
    description: 'Flowing inner-voice line with smooth steps and occasional thirds.',
    intervalWeight: 0.2,
    contraryWeight: 0.5,
    register: 0,
    rhythmOffset: 0,
    instrument: 'violin',
    clef: 'treble',
  },
];

const buildCountermelodyStaff = (sourceStaff: Staff, profile: CountermelodyProfile): Staff => {
  const melodyMidis: number[] = sourceStaff.measures.flatMap((m) =>
    (m.voices[0]?.notes ?? []).map((el) => ('pitch' in el ? pitchToMidi(el.pitch) : null)).filter((v): v is number => v !== null)
  );

  const minMidi = profile.register === 1 ? 60 : profile.register === -1 ? 36 : 48;
  const maxMidi = profile.register === 1 ? 84 : profile.register === -1 ? 67 : 76;
  const targetCenter = profile.register === 1 ? 72 : profile.register === -1 ? 52 : 62;

  let melodyIdx = 0;
  let prevMidi: number | null = null;

  // Preferred consonant intervals to jump to from melody (semitones)
  const consonantIntervals =
    profile.register >= 0
      ? [16, 15, 12, 9, 7, 4, 3] // above: 10th, M9, octave, M6, P5, M3, m3
      : [-3, -4, -7, -9, -12, -15, -16]; // below: m3, M3, P5, M6, octave, M9, m10

  const measures = sourceStaff.measures.map((measure) => {
    const sourceVoice = measure.voices[0] ?? { notes: [] };
    const counterNotes: MusicElement[] = sourceVoice.notes.map((el) => {
      if (!('pitch' in el)) {
        if (profile.rhythmOffset === 1 && prevMidi !== null) {
          // Fill rests with notes in faster counter
          return { pitch: midiToPitch(prevMidi), duration: el.duration } satisfies Note;
        }
        return { duration: el.duration };
      }

      const melMidi = melodyMidis[melodyIdx] ?? pitchToMidi(el.pitch);
      const prevMelMidi = melodyMidis[Math.max(0, melodyIdx - 1)] ?? melMidi;
      const melDir = Math.sign(melMidi - prevMelMidi);
      melodyIdx++;

      // Pick interval: contrary motion bias
      const contraryBias = Math.round(profile.contraryWeight * -melDir * 4);
      const intervalIdx = Math.floor(profile.intervalWeight * (consonantIntervals.length - 1));
      const baseInterval = consonantIntervals[intervalIdx];
      let targetMidi = melMidi + baseInterval + contraryBias;

      // Nudge toward center if drifting
      if (Math.abs(targetMidi - targetCenter) > 12) {
        targetMidi += Math.sign(targetCenter - targetMidi) * 5;
      }

      // Clamp to voice range
      while (targetMidi < minMidi) targetMidi += 12;
      while (targetMidi > maxMidi) targetMidi -= 12;
      targetMidi = Math.max(minMidi, Math.min(maxMidi, targetMidi));

      // Smooth voice leading: limit leaps > a 6th
      if (prevMidi !== null && Math.abs(targetMidi - prevMidi) > 9) {
        targetMidi = prevMidi + Math.sign(targetMidi - prevMidi) * 7;
        targetMidi = Math.max(minMidi, Math.min(maxMidi, targetMidi));
      }

      prevMidi = targetMidi;

      return {
        pitch: midiToPitch(targetMidi),
        duration: profile.rhythmOffset === -1 && el.duration.includes('eighth')
          ? 'quarter'
          : el.duration,
        lyric: undefined,
      } satisfies Note;
    });

    return { number: measure.number, voices: [{ notes: counterNotes }] };
  });

  return {
    name: `AI ${profile.title}`,
    instrument: profile.instrument,
    clef: profile.clef,
    aiGenerated: true,
    measures,
  };
};

export async function generateCountermelody(
  composition: Composition,
  staffIndex: number,
  style: HarmonyStyle,
): Promise<CountermelodyResult> {
  const staff = composition.staves[staffIndex];
  if (!staff) return { candidates: [], warning: 'No source staff selected.' };

  const fallback: CountermelodyCandidate[] = COUNTER_PROFILES.map((profile, idx) => ({
    id: `counter-${idx + 1}`,
    title: profile.title,
    description: profile.description,
    staff: buildCountermelodyStaff(staff, profile),
    source: 'heuristic' as const,
  }));

  if (!isMusicAiConfigured()) {
    return { candidates: fallback, warning: MUSIC_AI_FALLBACK_WARN };
  }

  const prompt = `You are a composer creating a countermelody.
Return strict JSON only (no markdown):
{
  "candidates": [
    {
      "title": "string",
      "description": "string",
      "intervalWeight": 0-1,
      "contraryWeight": 0-1,
      "register": -1 | 0 | 1,
      "rhythmOffset": -1 | 0 | 1,
      "instrument": "flute" | "violin" | "strings" | "piano"
    }
  ]
}

Rules:
- Exactly 3 candidates.
- intervalWeight: 0=close intervals (3rds/6ths), 1=wider leaps
- contraryWeight: 0=parallel motion, 1=strict contrary motion
- register: -1=below melody, 0=same range, 1=above
- rhythmOffset: -1=slower, 0=same rhythm, 1=fill gaps
- Style: ${style}, Key: ${composition.keySignature ?? 'C'}
- Melody excerpt: ${toCompactMelody(staff, 40)}
`;

  try {
    const raw = await chatCompletionText(prompt, { temperature: 0.9, maxTokens: 700 });
    if (raw === null) return { candidates: fallback, warning: 'Music AI request failed. Showing smart fallback suggestions.' };
    const jsonText = extractJson(raw);
    if (!jsonText) return { candidates: fallback, warning: 'Music AI response was not valid JSON. Showing fallback suggestions.' };

    const parsed = JSON.parse(jsonText) as {
      candidates?: Array<{
        title?: string;
        description?: string;
        intervalWeight?: number;
        contraryWeight?: number;
        register?: number;
        rhythmOffset?: number;
        instrument?: string;
      }>;
    };

    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    const clampReg = (v: number): -1 | 0 | 1 => (v < 0 ? -1 : v > 0 ? 1 : 0);

    const validInstruments = new Set(['flute', 'violin', 'strings', 'piano', 'choir', 'brass', 'synth']);

    const aiCandidates = (parsed.candidates ?? []).slice(0, 3).map((c, idx): CountermelodyCandidate => {
      const instrument = validInstruments.has(c.instrument ?? '') ? (c.instrument as string) : 'violin';
      const reg = clampReg(typeof c.register === 'number' ? c.register : 0);
      const profile: CountermelodyProfile = {
        title: c.title?.trim() || `AI Counter ${idx + 1}`,
        description: c.description?.trim() || 'AI-generated countermelody.',
        intervalWeight: clamp01(typeof c.intervalWeight === 'number' ? c.intervalWeight : 0.4),
        contraryWeight: clamp01(typeof c.contraryWeight === 'number' ? c.contraryWeight : 0.7),
        register: reg,
        rhythmOffset: clampReg(typeof c.rhythmOffset === 'number' ? c.rhythmOffset : 0),
        instrument,
        clef: reg < 0 ? 'bass' : 'treble',
      };
      return {
        id: `ai-counter-${idx + 1}`,
        title: profile.title,
        description: profile.description,
        staff: buildCountermelodyStaff(staff, profile),
        source: 'ai',
      };
    });

    if (aiCandidates.length === 3) return { candidates: aiCandidates };
    return { candidates: fallback, warning: 'AI returned incomplete data. Showing fallback suggestions.' };
  } catch {
    return { candidates: fallback, warning: 'AI is temporarily unavailable. Showing fallback suggestions.' };
  }
}
