import { Note as TonalNote } from 'tonal';
import type { Staff } from '../../types/music';
import { pitchToMidi } from '../../utils/noteUtils';

type SatbVoice = 'Soprano' | 'Alto' | 'Tenor' | 'Bass';

interface VoiceRangeRule {
  name: SatbVoice;
  min: number;
  max: number;
}

interface VerticalSonority {
  midis: [number, number, number, number]; // S, A, T, B
}

const VOICE_RANGES: VoiceRangeRule[] = [
  { name: 'Soprano', min: 60, max: 79 },
  { name: 'Alto', min: 55, max: 72 },
  { name: 'Tenor', min: 48, max: 67 },
  { name: 'Bass', min: 40, max: 60 },
];

const VOICE_PAIRS: Array<[number, number]> = [
  [0, 1], [0, 2], [0, 3],
  [1, 2], [1, 3],
  [2, 3],
];

const tonicPitchClass = (keySignature: string): number | null => {
  const keyRoot = (keySignature || 'C').replace(/m(in)?$/i, '').trim() || 'C';
  const midi = TonalNote.midi(`${keyRoot}4`);
  return midi == null ? null : ((midi % 12) + 12) % 12;
};

const sonoritiesFromStaves = (staves: Staff[]): VerticalSonority[] => {
  if (staves.length < 4) return [];
  const out: VerticalSonority[] = [];
  const measureCount = Math.min(...staves.slice(0, 4).map((s) => s.measures.length));

  for (let mi = 0; mi < measureCount; mi++) {
    const perVoiceNotes = staves.slice(0, 4).map((staff) => staff.measures[mi]?.voices[0]?.notes ?? []);
    const eventCount = Math.min(...perVoiceNotes.map((notes) => notes.length));
    for (let ni = 0; ni < eventCount; ni++) {
      const tuple = perVoiceNotes.map((notes) => notes[ni]);
      if (tuple.some((el) => !el || !('pitch' in el))) continue;
      out.push({
        midis: [
          pitchToMidi((tuple[0] as { pitch: string }).pitch),
          pitchToMidi((tuple[1] as { pitch: string }).pitch),
          pitchToMidi((tuple[2] as { pitch: string }).pitch),
          pitchToMidi((tuple[3] as { pitch: string }).pitch),
        ],
      });
    }
  }
  return out;
};

const isPerfectConsonance = (intervalSemitones: number): boolean => {
  const mod = ((intervalSemitones % 12) + 12) % 12;
  return mod === 0 || mod === 7;
};

const countRangeIssues = (staves: Staff[]): number => {
  if (staves.length < 4) return 0;
  let issues = 0;
  for (let vi = 0; vi < 4; vi++) {
    const rule = VOICE_RANGES[vi]!;
    const staff = staves[vi]!;
    for (const measure of staff.measures) {
      for (const el of measure.voices[0]?.notes ?? []) {
        if (!('pitch' in el)) continue;
        const midi = pitchToMidi(el.pitch);
        if (midi < rule.min || midi > rule.max) issues++;
      }
    }
  }
  return issues;
};

const countParallelPerfects = (sonorities: VerticalSonority[]): number => {
  let warnings = 0;
  for (let i = 0; i < sonorities.length - 1; i++) {
    const curr = sonorities[i]!.midis;
    const next = sonorities[i + 1]!.midis;
    for (const [a, b] of VOICE_PAIRS) {
      const intA = curr[a] - curr[b];
      const intB = next[a] - next[b];
      if (!isPerfectConsonance(intA) || !isPerfectConsonance(intB)) continue;
      const motionA = next[a] - curr[a];
      const motionB = next[b] - curr[b];
      if (motionA === 0 || motionB === 0) continue;
      if (Math.sign(motionA) === Math.sign(motionB)) warnings++;
    }
  }
  return warnings;
};

const countLeadingToneResolutionSuggestions = (sonorities: VerticalSonority[], keySignature: string): number => {
  const tonicPc = tonicPitchClass(keySignature);
  if (tonicPc == null) return 0;
  const leadingPc = (tonicPc + 11) % 12;

  let suggestions = 0;
  for (let i = 0; i < sonorities.length - 1; i++) {
    const curr = sonorities[i]!.midis;
    const next = sonorities[i + 1]!.midis;
    for (let vi = 0; vi < 4; vi++) {
      const currPc = ((curr[vi] % 12) + 12) % 12;
      const nextPc = ((next[vi] % 12) + 12) % 12;
      if (currPc !== leadingPc) continue;
      const step = next[vi] - curr[vi];
      const resolvesUp = nextPc === tonicPc && (step === 1 || step === 2);
      if (!resolvesUp) suggestions++;
    }
  }
  return suggestions;
};

export const summarizeSatbTheoryLint = (staves: Staff[], keySignature: string): string => {
  const sonorities = sonoritiesFromStaves(staves);
  const rangeIssues = countRangeIssues(staves);
  const parallelWarnings = countParallelPerfects(sonorities);
  const resolutionSuggestions = countLeadingToneResolutionSuggestions(sonorities, keySignature);

  if (rangeIssues === 0 && parallelWarnings === 0 && resolutionSuggestions === 0) {
    return 'Theory lint: no major range/parallels/resolution flags.';
  }

  const parts: string[] = [];
  if (rangeIssues > 0) {
    parts.push(`${rangeIssues} voice-range check${rangeIssues === 1 ? '' : 's'}`);
  }
  if (parallelWarnings > 0) {
    parts.push(`${parallelWarnings} parallel perfect warning${parallelWarnings === 1 ? '' : 's'}`);
  }
  if (resolutionSuggestions > 0) {
    parts.push(`${resolutionSuggestions} resolution suggestion${resolutionSuggestions === 1 ? '' : 's'}`);
  }
  return `Theory lint: ${parts.join(', ')}.`;
};
