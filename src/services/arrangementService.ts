import { Composition, MusicElement, Note, Staff } from '../types/music';
import { midiToPitch, pitchToMidi } from '../utils/noteUtils';
import { chatCompletionText, isMusicAiConfigured } from './musicAiClient';

export type ArrangementStyle = 'classical' | 'pop' | 'jazz' | 'gospel';
export type ArrangementDifficulty = 'beginner' | 'intermediate' | 'advanced';
export type ArrangementInstrumentation = 'satb-choir' | 'piano-duet' | 'string-section';
type CandidateSource = 'ai' | 'heuristic';

interface ArrangementPartSpec {
  name: string;
  instrument: string;
  clef: 'treble' | 'bass' | 'alto' | 'tenor';
  semitoneShift: number;
  minMidi: number;
  maxMidi: number;
}

export interface GenerateArrangementOptions {
  sourceStaffIndex: number;
  style: ArrangementStyle;
  difficulty: ArrangementDifficulty;
  instrumentation: ArrangementInstrumentation;
}

export interface GeneratedArrangement {
  staves: Staff[];
  summary: string;
}

export interface ArrangementCandidate {
  id: string;
  title: string;
  description: string;
  staves: Staff[];
  source: CandidateSource;
}

export interface ArrangementCandidateResult {
  candidates: ArrangementCandidate[];
  warning?: string;
}

interface ArrangementProfile {
  openness: number; // 0..1
  contrary: number; // 0..1
  activity: number; // 0..1
  intensity: number; // 0..1
}

type DurationText = Note['duration'];

const clampToRange = (midi: number, minMidi: number, maxMidi: number): number => {
  let value = midi;
  while (value < minMidi) value += 12;
  while (value > maxMidi) value -= 12;
  return Math.max(minMidi, Math.min(maxMidi, value));
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const seeded01 = (seed: number): number => {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

const isShortDuration = (duration: DurationText): boolean =>
  duration.includes('eighth') || duration.includes('sixteenth') || duration.includes('thirty-second');

const isLongDuration = (duration: DurationText): boolean =>
  duration.includes('whole') || duration.includes('half') || duration.includes('dotted');

const applySemitoneShift = (sourcePitch: string, semitoneShift: number, minMidi: number, maxMidi: number): string => {
  const midi = pitchToMidi(sourcePitch) + semitoneShift;
  return midiToPitch(clampToRange(midi, minMidi, maxMidi));
};

const transposeElement = (
  element: MusicElement,
  semitoneShift: number,
  minMidi: number,
  maxMidi: number
): MusicElement => {
  if (!('pitch' in element)) return { ...element };
  const sourceNote = element as Note;
  const midi = pitchToMidi(sourceNote.pitch) + semitoneShift;
  const clamped = clampToRange(midi, minMidi, maxMidi);
  return {
    ...sourceNote,
    pitch: midiToPitch(clamped),
    // Generated accompaniment should not duplicate lyric lines by default.
    lyric: undefined,
  };
};

const dynamicForProgress = (
  progress: number,
  intensity: number,
  style: ArrangementStyle
): 'p' | 'mp' | 'mf' | 'f' | 'ff' => {
  const arc = Math.sin(progress * Math.PI); // 0..1..0
  const level = intensity * 0.7 + arc * 0.3;
  if (style === 'gospel') {
    if (level < 0.3) return 'mp';
    if (level < 0.55) return 'mf';
    if (level < 0.8) return 'f';
    return 'ff';
  }
  if (level < 0.2) return 'p';
  if (level < 0.4) return 'mp';
  if (level < 0.65) return 'mf';
  if (level < 0.85) return 'f';
  return 'ff';
};

const articulationForNote = (
  duration: DurationText,
  style: ArrangementStyle,
  activity: number,
  seed: number
): Note['articulation'] | undefined => {
  const roll = seeded01(seed);
  if (style === 'jazz' && isShortDuration(duration) && roll < 0.28) return '>';
  if (style === 'pop' && isShortDuration(duration) && roll < 0.24) return 'a.';
  if (style === 'classical' && isLongDuration(duration) && roll < 0.32) return '-';
  if (style === 'gospel' && roll < 0.18 + activity * 0.12) return '^';
  if (roll < 0.1 * activity) return 'a.';
  return undefined;
};

const styleShiftDelta = (style: ArrangementStyle, difficulty: ArrangementDifficulty): number => {
  if (style === 'jazz') return difficulty === 'advanced' ? 2 : 1;
  if (style === 'gospel') return 1;
  if (style === 'pop') return -1;
  return 0;
};

const getParts = (
  instrumentation: ArrangementInstrumentation,
  style: ArrangementStyle,
  difficulty: ArrangementDifficulty
): ArrangementPartSpec[] => {
  const delta = styleShiftDelta(style, difficulty);
  switch (instrumentation) {
    case 'piano-duet':
      return [
        { name: 'Piano RH', instrument: 'piano', clef: 'treble', semitoneShift: 0 + delta, minMidi: 60, maxMidi: 88 },
        { name: 'Piano LH', instrument: 'piano', clef: 'bass', semitoneShift: -12 + delta, minMidi: 36, maxMidi: 67 },
      ];
    case 'string-section':
      return [
        { name: 'Violin I', instrument: 'violin', clef: 'treble', semitoneShift: 0 + delta, minMidi: 62, maxMidi: 96 },
        { name: 'Violin II', instrument: 'violin', clef: 'treble', semitoneShift: -5 + delta, minMidi: 55, maxMidi: 86 },
        { name: 'Viola', instrument: 'strings', clef: 'alto', semitoneShift: -12 + delta, minMidi: 48, maxMidi: 79 },
        { name: 'Cello', instrument: 'strings', clef: 'bass', semitoneShift: -19 + delta, minMidi: 36, maxMidi: 67 },
      ];
    case 'satb-choir':
    default:
      return [
        { name: 'Soprano', instrument: 'choir', clef: 'treble', semitoneShift: 0 + delta, minMidi: 60, maxMidi: 84 },
        { name: 'Alto', instrument: 'choir', clef: 'treble', semitoneShift: -5 + delta, minMidi: 53, maxMidi: 76 },
        { name: 'Tenor', instrument: 'choir', clef: 'tenor', semitoneShift: -12 + delta, minMidi: 45, maxMidi: 69 },
        { name: 'Bass', instrument: 'choir', clef: 'bass', semitoneShift: -24 + delta, minMidi: 36, maxMidi: 60 },
      ];
  }
};

const defaultProfileForStyle = (
  style: ArrangementStyle,
  difficulty: ArrangementDifficulty
): ArrangementProfile => {
  const diffBoost = difficulty === 'advanced' ? 0.2 : difficulty === 'intermediate' ? 0.1 : 0;
  if (style === 'classical') return { openness: 0.45 + diffBoost, contrary: 0.65, activity: 0.42, intensity: 0.45 };
  if (style === 'jazz') return { openness: 0.7, contrary: 0.55, activity: 0.72 + diffBoost, intensity: 0.66 };
  if (style === 'gospel') return { openness: 0.58, contrary: 0.48, activity: 0.6 + diffBoost, intensity: 0.78 };
  return { openness: 0.52, contrary: 0.45, activity: 0.65 + diffBoost, intensity: 0.62 };
};

const blendProfiles = (base: ArrangementProfile, override?: Partial<ArrangementProfile>): ArrangementProfile => ({
  openness: clamp01(override?.openness ?? base.openness),
  contrary: clamp01(override?.contrary ?? base.contrary),
  activity: clamp01(override?.activity ?? base.activity),
  intensity: clamp01(override?.intensity ?? base.intensity),
});

const extractMelodyMidis = (sourceStaff: Staff): number[] => {
  const values: number[] = [];
  sourceStaff.measures.forEach((measure) => {
    const voice = measure.voices[0] ?? { notes: [] };
    voice.notes.forEach((el) => {
      if ('pitch' in el) values.push(pitchToMidi(el.pitch));
    });
  });
  return values;
};

const extractJson = (text: string): string | null => {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return null;
};

const getFallbackShiftMatrix = (partCount: number): number[][] => {
  const base = [
    [0, 0, 0, 0],
    [2, -2, -5, -12],
    [-2, -4, -7, -19],
  ];
  return base.map((row) => row.slice(0, partCount).concat(Array(Math.max(0, partCount - row.length)).fill(-12)));
};

const buildCandidateStaves = (
  sourceStaff: Staff,
  parts: ArrangementPartSpec[],
  partShifts: number[],
  profile: ArrangementProfile,
  style: ArrangementStyle
): Staff[] =>
  parts.map((part, idx): Staff => {
    const semitoneShiftBase = partShifts[idx] ?? part.semitoneShift;
    const melodyMidis = extractMelodyMidis(sourceStaff);
    let melodyNoteCursor = 0;
    let prevPartMidi: number | null = null;
    const partSeedBase = (idx + 1) * 7919;
    const measures = sourceStaff.measures.map((measure) => {
      const sourceVoice = measure.voices[0] ?? { notes: [] };
      const lastPitchedIndex = (() => {
        for (let i = sourceVoice.notes.length - 1; i >= 0; i--) {
          if ('pitch' in sourceVoice.notes[i]) return i;
        }
        return -1;
      })();
      let noteInMeasure = 0;
      return {
        number: measure.number,
        voices: [
          {
            notes: sourceVoice.notes.map((el, sourceIndex): MusicElement => {
              if (!('pitch' in el)) return { ...el };

              const melodyMidi = melodyMidis[melodyNoteCursor] ?? pitchToMidi(el.pitch);
              const prevMelody = melodyMidis[Math.max(0, melodyNoteCursor - 1)] ?? melodyMidi;
              const melodyDirection = Math.sign(melodyMidi - prevMelody);
              const progress = melodyMidis.length <= 1 ? 0 : melodyNoteCursor / (melodyMidis.length - 1);

              const opennessLift = Math.round((profile.openness - 0.5) * 8);
              const wave = Math.round(Math.sin((melodyNoteCursor + idx * 1.4) / 3.25) * (1 + profile.openness * 3));
              const contraryOffset = idx > 0 ? Math.round(-melodyDirection * profile.contrary * (idx + 1)) : 0;
              const styleColor = style === 'jazz' && (melodyNoteCursor + idx) % 4 === 0 ? 2 : 0;
              const targetRaw = melodyMidi + semitoneShiftBase + opennessLift + wave + contraryOffset + styleColor;
              let targetMidi = clampToRange(targetRaw, part.minMidi, part.maxMidi);

              if (prevPartMidi !== null && Math.abs(targetMidi - prevPartMidi) > 7) {
                targetMidi = prevPartMidi + Math.sign(targetMidi - prevPartMidi) * 7;
                targetMidi = clampToRange(targetMidi, part.minMidi, part.maxMidi);
              }

              const restChance = (idx === 0 ? 0 : 0.04 + (1 - profile.activity) * 0.22 + idx * 0.03);
              const seed = partSeedBase + (melodyNoteCursor + 1) * 157 + noteInMeasure * 53;
              const shouldRest =
                idx > 0 &&
                isShortDuration(el.duration) &&
                seeded01(seed) < restChance;

              const dynamic = noteInMeasure === 0 && measure.number % 2 === 1
                ? dynamicForProgress(progress, profile.intensity, style)
                : undefined;
              const articulation = articulationForNote(el.duration, style, profile.activity, seed + 41);
              const startsPhrase = sourceIndex === 0;
              const endsPhrase = sourceIndex === lastPitchedIndex;
              const phraseCycle = (measure.number - 1) % 4;
              const hairpinStart =
                startsPhrase && profile.intensity >= 0.45
                  ? (phraseCycle < 2 ? 'crescendo' : 'decrescendo')
                  : undefined;
              const hairpinEnd = endsPhrase && profile.intensity >= 0.45;

              melodyNoteCursor += 1;
              noteInMeasure += 1;

              if (shouldRest) {
                prevPartMidi = null;
                return { duration: el.duration };
              }

              prevPartMidi = targetMidi;
              return {
                ...(transposeElement(el, targetMidi - melodyMidi, part.minMidi, part.maxMidi) as Note),
                dynamic,
                articulation,
                hairpinStart,
                hairpinEnd,
                lyric: undefined,
              };
            }),
          },
        ],
      };
    });
    return {
      name: `AI ${part.name}`,
      instrument: part.instrument,
      clef: part.clef,
      aiGenerated: true,
      measures,
    };
  });

const buildHeuristicCandidates = (
  sourceStaff: Staff,
  parts: ArrangementPartSpec[],
  style: ArrangementStyle,
  difficulty: ArrangementDifficulty
): ArrangementCandidate[] => {
  const labels = [
    { title: 'Balanced Chorale', description: 'Smooth voice-leading with moderate movement.', profile: { openness: 0.45, contrary: 0.6, activity: 0.46, intensity: 0.5 } },
    { title: 'Open Cinematic', description: 'Wider spread and stronger dynamic shape.', profile: { openness: 0.82, contrary: 0.45, activity: 0.56, intensity: 0.7 } },
    { title: 'Rhythmic Lift', description: 'More active inner voices and articulated phrases.', profile: { openness: 0.55, contrary: 0.58, activity: 0.78, intensity: 0.66 } },
  ];
  const matrix = getFallbackShiftMatrix(parts.length);
  const baseProfile = defaultProfileForStyle(style, difficulty);
  return labels.map((label, idx) => ({
    id: `fallback-${idx + 1}`,
    title: label.title,
    description: label.description,
    staves: buildCandidateStaves(
      sourceStaff,
      parts,
      parts.map((p, partIdx) => p.semitoneShift + (matrix[idx][partIdx] ?? 0)),
      blendProfiles(baseProfile, label.profile),
      style
    ),
    source: 'heuristic' as const,
  }));
};

const toCompactMelody = (sourceStaff: Staff): string => {
  const notes = sourceStaff.measures.flatMap((m) => {
    const voice = m.voices[0] ?? { notes: [] };
    return voice.notes.map((el) => {
      if ('pitch' in el) return `${el.pitch}:${el.duration}`;
      return `rest:${el.duration}`;
    });
  });
  return notes.slice(0, 120).join(', ');
};

export async function generateArrangementCandidates(
  composition: Composition,
  options: GenerateArrangementOptions
): Promise<ArrangementCandidateResult> {
  const sourceStaff = composition.staves[options.sourceStaffIndex];
  if (!sourceStaff) return { candidates: [], warning: 'No source staff selected.' };

  const parts = getParts(options.instrumentation, options.style, options.difficulty);
  const fallback = buildHeuristicCandidates(sourceStaff, parts, options.style, options.difficulty);
  const baseProfile = defaultProfileForStyle(options.style, options.difficulty);
  if (!isMusicAiConfigured()) {
    return {
      candidates: fallback,
      warning:
        'Music AI not configured. Add VITE_MUSIC_AI_API_KEY (Groq free tier: console.groq.com) or use smart fallback.',
    };
  }

  const prompt = `You are arranging a melody into multiple parts.
Return strict JSON only (no markdown), with this schema:
{
  "candidates": [
    {
      "title": "string",
      "description": "string",
      "partShifts": [int, ...],
      "profile": { "openness": 0-1, "contrary": 0-1, "activity": 0-1, "intensity": 0-1 }
    }
  ]
}

Rules:
- Exactly 3 candidates.
- partShifts length must be ${parts.length}.
- Each shift is semitone offset from melody and must be between -30 and 12.
- profile controls human-like behavior:
  - openness: wider spacing / registral spread
  - contrary: how much voices move against melody
  - activity: rhythmic activity in inner/lower voices
  - intensity: dynamic arc strength
- Style: ${options.style}
- Difficulty: ${options.difficulty}
- Instrumentation: ${options.instrumentation}
- Preferred baseline shifts: [${parts.map((p) => p.semitoneShift).join(', ')}]
- Melody excerpt: ${toCompactMelody(sourceStaff)}
`;

  try {
    const text = await chatCompletionText(prompt, { temperature: 0.9, maxTokens: 900 });
    if (text === null) {
      return {
        candidates: fallback,
        warning: 'Music AI request failed. Showing smart fallback suggestions.',
      };
    }
    const jsonText = extractJson(text);
    if (!jsonText) {
      return {
        candidates: fallback,
        warning: 'Music AI response was not valid JSON. Showing fallback suggestions.',
      };
    }

    const parsed = JSON.parse(jsonText) as {
      candidates?: Array<{
        title?: string;
        description?: string;
        partShifts?: number[];
        profile?: Partial<ArrangementProfile>;
      }>;
    };
    const aiCandidates = (parsed.candidates ?? [])
      .slice(0, 3)
      .map((candidate, idx): ArrangementCandidate => {
        const shifts = (candidate.partShifts ?? []).map((shift, partIdx) => {
          const base = parts[partIdx]?.semitoneShift ?? -12;
          const val = Number.isFinite(shift) ? shift : base;
          return Math.max(-30, Math.min(12, Math.round(val)));
        });
        const completedShifts = parts.map((p, i) => shifts[i] ?? p.semitoneShift);
        const profile = blendProfiles(baseProfile, candidate.profile);
        return {
          id: `ai-${idx + 1}`,
          title: candidate.title?.trim() || `AI Idea ${idx + 1}`,
          description: candidate.description?.trim() || 'AI-generated harmonization with phrase expression.',
          staves: buildCandidateStaves(sourceStaff, parts, completedShifts, profile, options.style),
          source: 'ai',
        };
      });

    if (aiCandidates.length === 3) return { candidates: aiCandidates };
    return {
      candidates: fallback,
      warning: 'AI returned incomplete ideas. Showing fallback suggestions.',
    };
  } catch {
    return {
      candidates: fallback,
      warning: 'AI is temporarily unavailable. Showing fallback suggestions.',
    };
  }
}

export function generateArrangement(
  composition: Composition,
  options: GenerateArrangementOptions
): GeneratedArrangement {
  const sourceStaff = composition.staves[options.sourceStaffIndex];
  if (!sourceStaff) {
    return { staves: [], summary: 'No source staff selected.' };
  }

  const parts = getParts(options.instrumentation, options.style, options.difficulty);
  const baseProfile = defaultProfileForStyle(options.style, options.difficulty);

  const styleLabel = options.style[0].toUpperCase() + options.style.slice(1);
  const diffLabel = options.difficulty[0].toUpperCase() + options.difficulty.slice(1);
  return {
    staves: buildCandidateStaves(
      sourceStaff,
      parts,
      parts.map((part) => part.semitoneShift),
      baseProfile,
      options.style
    ),
    summary: `Generated ${parts.length} arranged staves from "${sourceStaff.name ?? 'Staff 1'}" (${styleLabel}, ${diffLabel}).`,
  };
}
