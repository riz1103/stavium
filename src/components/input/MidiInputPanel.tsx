import { useEffect, useMemo, useRef, useState } from 'react';
import * as Tone from 'tone';
import { useScoreStore } from '../../app/store/scoreStore';
import { usePlaybackStore } from '../../app/store/playbackStore';
import { sharedScheduler } from '../../music/playback/toneScheduler';
import { Composition, Note, NoteDuration, Rest } from '../../types/music';
import { durationToBeats } from '../../utils/durationUtils';
import { applyKeySignatureAndMeasureAccidentals, midiToPitch, pitchToMidi } from '../../utils/noteUtils';

type CaptureMode = 'step' | 'realtime';
type QuantizationId = 'off' | 'quarter' | 'eighth' | 'sixteenth' | 'triplet-eighth';
type PianoViewMode = 'simple' | 'extended' | 'ultra';
type MidiChordWindowId = 'off' | 'tight' | 'normal' | 'loose';
type KeyboardMapping = Record<string, number>;

type RecordedNoteEvent = {
  midi: number;
  startBeats: number;
  durationBeats: number;
  velocity: number;
};

type ActiveRecordNote = {
  startedAtMs: number;
  velocity: number;
};

type ProvisionalRealtimeNote = {
  staffIndex: number;
  measureIndex: number;
  voiceIndex: number;
  noteIndex: number;
  startedAtMs: number;
  startMeasureIndex: number;
  startBeatInMeasure: number;
  provisionalSegments: ProvisionalSegmentRef[];
  lastPreviewBeats: number;
};

type ActiveStepHoldNote = {
  startedAtMs: number | null;
  startMeasureIndex: number;
  startBeatInMeasure?: number;
  staffIndex?: number;
  measureIndex?: number;
  voiceIndex?: number;
  noteIndex?: number;
  provisionalSegments?: ProvisionalSegmentRef[];
  lastPreviewBeats?: number;
};

type ProvisionalSegmentRef = {
  staffIndex: number;
  measureIndex: number;
  voiceIndex: number;
  noteIndex: number;
};

type RealtimeSilencePreview = {
  startCursor: CursorState;
  startElapsedBeats: number;
  lastPreviewBeats: number;
  segments: ProvisionalSegmentRef[];
};

type CursorState = {
  staffIndex: number;
  measureIndex: number;
  voiceIndex: number;
  beatInMeasure: number;
};

type DurationDefinition = {
  duration: NoteDuration;
  beats: number;
};

type TimelinePlacementEvent = RecordedNoteEvent & {
  provisional?: boolean;
};

const QUANTIZATION_OPTIONS: Array<{ id: QuantizationId; label: string; stepBeats: number | null }> = [
  { id: 'off', label: 'Off', stepBeats: null },
  { id: 'quarter', label: '1/4', stepBeats: 1 },
  { id: 'eighth', label: '1/8', stepBeats: 0.5 },
  { id: 'sixteenth', label: '1/16', stepBeats: 0.25 },
  { id: 'triplet-eighth', label: '1/8T', stepBeats: 1 / 3 },
];
const MIDI_CHORD_WINDOW_OPTIONS: Array<{ id: MidiChordWindowId; label: string; beats: number }> = [
  { id: 'off', label: 'Off', beats: 0 },
  { id: 'tight', label: 'Tight', beats: 0.05 },
  { id: 'normal', label: 'Normal', beats: 0.08 },
  { id: 'loose', label: 'Loose', beats: 0.14 },
];
const KEYBOARD_INPUT_ENABLED_LS_KEY = 'stavium_midi_keyboard_input_enabled_v1';
const KEYBOARD_MAPPING_LS_KEY = 'stavium_midi_keyboard_mapping_v1';
const DEFAULT_KEYBOARD_MAPPING: KeyboardMapping = {
  KeyZ: 48, KeyS: 49, KeyX: 50, KeyD: 51, KeyC: 52, KeyV: 53, KeyG: 54, KeyB: 55, KeyH: 56, KeyN: 57, KeyJ: 58, KeyM: 59,
  Comma: 60, KeyL: 61, Period: 62, Semicolon: 63, Slash: 64,
  KeyQ: 60, Digit2: 61, KeyW: 62, Digit3: 63, KeyE: 64, KeyR: 65, Digit5: 66, KeyT: 67, Digit6: 68, KeyY: 69, Digit7: 70, KeyU: 71,
  KeyI: 72, Digit9: 73, KeyO: 74, Digit0: 75, KeyP: 76, BracketLeft: 77, Equal: 78, BracketRight: 79,
};

const DURATION_CANDIDATES: NoteDuration[] = [
  'whole',
  'dotted-half',
  'half',
  'dotted-quarter',
  'quarter',
  'triplet-half',
  'triplet-quarter',
  'dotted-eighth',
  'eighth',
  'triplet-eighth',
  'dotted-sixteenth',
  'sixteenth',
  'triplet-sixteenth',
  'thirty-second',
  'triplet-thirty-second',
];

const EXTENDED_MIDI_START = 36; // C2
const EXTENDED_MIDI_END = 96;   // C7
const ULTRA_MIDI_START = 21;    // A0
const ULTRA_MIDI_END = 108;     // C8
const SIMPLE_C_MIN = 24; // C1
const SIMPLE_C_MAX = 96; // C7 (range ends at C8)
const BLACK_NOTE_CLASSES = new Set([1, 3, 6, 8, 10]);
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const EPSILON = 0.0001;
const MIN_NOTATABLE_BEATS = 0.125; // 32nd note
const REALTIME_PREROLL_MS = 2000;
const REALTIME_LEGATO_GAP_MS = 90;
const MIDI_MAX_CHORD_VOICES = 4;

const clampMidi = (midi: number): number => Math.max(21, Math.min(108, midi));
const isBlackMidi = (midi: number): boolean => BLACK_NOTE_CLASSES.has(((midi % 12) + 12) % 12);
const isCMidi = (midi: number): boolean => (((midi % 12) + 12) % 12) === 0;
const midiLabel = (midi: number): string => {
  const note = NOTE_NAMES[((midi % 12) + 12) % 12] ?? 'C';
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
};
const codeToDisplayLabel = (code: string): string => {
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
  const aliases: Record<string, string> = {
    BracketLeft: '[',
    BracketRight: ']',
    Semicolon: ';',
    Quote: '\'',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    Minus: '-',
    Equal: '=',
    Backquote: '`',
    Space: 'Space',
  };
  return aliases[code] ?? code;
};
const isEditableKeyboardCode = (code: string): boolean => {
  if (code.startsWith('Key') && code.length === 4) return true;
  if (code.startsWith('Digit') && code.length === 6) return true;
  return [
    'BracketLeft', 'BracketRight', 'Semicolon', 'Quote', 'Comma', 'Period', 'Slash',
    'Backslash', 'Minus', 'Equal', 'Backquote', 'Space',
  ].includes(code);
};
const loadKeyboardInputEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(KEYBOARD_INPUT_ENABLED_LS_KEY) === '1';
  } catch {
    return false;
  }
};
const loadKeyboardMapping = (): KeyboardMapping => {
  if (typeof window === 'undefined') return { ...DEFAULT_KEYBOARD_MAPPING };
  try {
    const raw = localStorage.getItem(KEYBOARD_MAPPING_LS_KEY);
    if (!raw) return { ...DEFAULT_KEYBOARD_MAPPING };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: KeyboardMapping = {};
    Object.entries(parsed).forEach(([code, midi]) => {
      if (!isEditableKeyboardCode(code)) return;
      if (typeof midi !== 'number' || !Number.isFinite(midi)) return;
      next[code] = clampMidi(Math.round(midi));
    });
    if (Object.keys(next).length === 0) return { ...DEFAULT_KEYBOARD_MAPPING };
    return next;
  } catch {
    return { ...DEFAULT_KEYBOARD_MAPPING };
  }
};
const buildExtendedVirtualKeys = (): Array<{ midi: number; label: string; isBlack: boolean }> => {
  const keys: Array<{ midi: number; label: string; isBlack: boolean }> = [];
  for (let midi = EXTENDED_MIDI_START; midi <= EXTENDED_MIDI_END; midi++) {
    keys.push({
      midi,
      label: midiLabel(midi),
      isBlack: isBlackMidi(midi),
    });
  }
  return keys;
};
const buildSimpleVirtualKeys = (baseCMidi: number): Array<{ midi: number; label: string; isBlack: boolean }> => {
  const clampedBase = Math.max(SIMPLE_C_MIN, Math.min(SIMPLE_C_MAX, baseCMidi));
  const keys: Array<{ midi: number; label: string; isBlack: boolean }> = [];
  for (let midi = clampedBase; midi <= clampedBase + 12; midi++) {
    keys.push({
      midi,
      label: midiLabel(midi),
      isBlack: isBlackMidi(midi),
    });
  }
  return keys;
};
const EXTENDED_VIRTUAL_KEYS = buildExtendedVirtualKeys();
const ULTRA_VIRTUAL_KEYS = (() => {
  const keys: Array<{ midi: number; label: string; isBlack: boolean }> = [];
  for (let midi = ULTRA_MIDI_START; midi <= ULTRA_MIDI_END; midi++) {
    keys.push({
      midi,
      label: midiLabel(midi),
      isBlack: isBlackMidi(midi),
    });
  }
  return keys;
})();

const quantizeBeats = (value: number, stepBeats: number | null): number => {
  if (!stepBeats || stepBeats <= 0) return Math.max(0, value);
  return Math.max(0, Math.round(value / stepBeats) * stepBeats);
};

export const MidiInputPanel = ({ isReadOnly = false }: { isReadOnly?: boolean }) => {
  const composition = useScoreStore((s) => s.composition);
  const selectedDuration = useScoreStore((s) => s.selectedDuration);
  const selectedStaffIndex = useScoreStore((s) => s.selectedStaffIndex ?? 0);
  const selectedMeasureIndex = useScoreStore((s) => s.selectedMeasureIndex ?? 0);
  const selectedVoiceIndex = useScoreStore((s) => s.selectedVoiceIndex);
  const playingNotes = usePlaybackStore((s) => s.playingNotes);
  const playbackState = usePlaybackStore((s) => s.state);
  const addNote = useScoreStore((s) => s.addNote);
  const addMeasure = useScoreStore((s) => s.addMeasure);
  const setAnacrusis = useScoreStore((s) => s.setAnacrusis);
  const setComposition = useScoreStore((s) => s.setComposition);
  const setSelectedMeasureIndex = useScoreStore((s) => s.setSelectedMeasureIndex);
  const setSelectedStaffIndex = useScoreStore((s) => s.setSelectedStaffIndex);

  const [mode, setMode] = useState<CaptureMode>('step');
  const [adaptiveStepEnabled, setAdaptiveStepEnabled] = useState(false);
  const [pianoViewMode, setPianoViewMode] = useState<PianoViewMode>('simple');
  const [chordWindow, setChordWindow] = useState<MidiChordWindowId>('normal');
  const [keyboardInputEnabled, setKeyboardInputEnabled] = useState<boolean>(() => loadKeyboardInputEnabled());
  const [keyboardMapping, setKeyboardMapping] = useState<KeyboardMapping>(() => loadKeyboardMapping());
  const [showKeyboardMapEditor, setShowKeyboardMapEditor] = useState(false);
  const [rebindMidi, setRebindMidi] = useState<number | null>(null);
  const [simpleBaseCMidi, setSimpleBaseCMidi] = useState(60); // C4
  const [pianoFullscreen, setPianoFullscreen] = useState(false);
  const [isCompactViewport, setIsCompactViewport] = useState<boolean>(
    () => (typeof window !== 'undefined' ? window.innerWidth < 768 : false)
  );
  const [isCollapsed, setIsCollapsed] = useState<boolean>(
    () => (typeof window !== 'undefined' ? window.innerWidth < 768 : false)
  );
  const [quantization, setQuantization] = useState<QuantizationId>('sixteenth');
  const [recordClickEnabled, setRecordClickEnabled] = useState(false);
  const [autoPickupEnabled, setAutoPickupEnabled] = useState(false);
  const [isPreparingRecord, setIsPreparingRecord] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordPaused, setIsRecordPaused] = useState(false);
  const [isRecordArming, setIsRecordArming] = useState(false);
  const [recordCountdownMs, setRecordCountdownMs] = useState(0);
  const [recordElapsedMs, setRecordElapsedMs] = useState(0);
  const [midiSupported, setMidiSupported] = useState<boolean>(typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator);
  const [midiInputs, setMidiInputs] = useState<Array<{ id: string; name: string }>>([]);
  const [statusText, setStatusText] = useState<string>('No MIDI device detected');
  const [lastCapturedPitch, setLastCapturedPitch] = useState<string | null>(null);
  const [activeVirtualNotes, setActiveVirtualNotes] = useState<Set<number>>(new Set());
  const [showPlaybackOnKeyboard, setShowPlaybackOnKeyboard] = useState(true);
  const [adaptiveHoldLabels, setAdaptiveHoldLabels] = useState<string[]>([]);
  const [keyRetriggerTick, setKeyRetriggerTick] = useState(0);

  const emitMidiFollowMeasure = (staffIndex: number, measureIndex: number) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('stavium:midi-follow-measure', {
        detail: { staffIndex, measureIndex },
      })
    );
  };

  const triggerKeyRetrigger = (midi: number) => {
    const safeMidi = clampMidi(midi);
    const until = performance.now() + 140;
    keyRetriggerUntilRef.current.set(safeMidi, until);
    setKeyRetriggerTick((n) => n + 1);
    window.setTimeout(() => {
      const activeUntil = keyRetriggerUntilRef.current.get(safeMidi) ?? 0;
      if (activeUntil <= performance.now()) {
        keyRetriggerUntilRef.current.delete(safeMidi);
        setKeyRetriggerTick((n) => n + 1);
      }
    }, 160);
  };

  const midiAccessRef = useRef<any>(null);
  const activeStepHeldNotesRef = useRef<Map<number, ActiveStepHoldNote>>(new Map());
  const realtimeActiveNotesRef = useRef<Map<number, ActiveRecordNote>>(new Map());
  const recordedEventsRef = useRef<RecordedNoteEvent[]>([]);
  const recordStartMsRef = useRef<number | null>(null);
  const realtimeStartCursorRef = useRef<CursorState | null>(null);
  const stepCursorRef = useRef<CursorState | null>(null);
  const activePreviewIdsRef = useRef<Map<number, string>>(new Map());
  const keyRetriggerUntilRef = useRef<Map<number, number>>(new Map());
  const previousPlayingNotesRef = useRef<Set<string>>(new Set());
  const pianoViewModeRef = useRef<PianoViewMode>(pianoViewMode);
  const simpleVisibleMidiRef = useRef<Set<number>>(new Set());
  const inlinePianoScrollRef = useRef<HTMLDivElement | null>(null);
  const fullscreenPianoScrollRef = useRef<HTMLDivElement | null>(null);
  const keyboardMapScrollRef = useRef<HTMLDivElement | null>(null);
  const previousKeyboardInputEnabledRef = useRef<boolean>(false);
  const chordWindowAutoByKeyboardRef = useRef(false);
  const recordArmTimeoutRef = useRef<number | null>(null);
  const recordArmingActionRef = useRef<'start' | 'resume'>('start');
  const recordCountdownTimerRef = useRef<number | null>(null);
  const recordElapsedTimerRef = useRef<number | null>(null);
  const recordPauseStartedAtRef = useRef<number | null>(null);
  const recordClickTimerRef = useRef<number | null>(null);
  const recordClickSynthRef = useRef<Tone.Synth | null>(null);
  const recordClickBeatIndexRef = useRef(0);
  const recordClickNextAtMsRef = useRef(0);
  const lastRecordClickAtSecRef = useRef(0);
  const preRecordCompositionRef = useRef<Composition | null>(null);
  const provisionalRealtimeNotesRef = useRef<Map<number, ProvisionalRealtimeNote>>(new Map());
  const provisionalCursorRef = useRef<CursorState | null>(null);
  const provisionalElapsedBeatsRef = useRef(0);
  const realtimeSilencePreviewRef = useRef<RealtimeSilencePreview | null>(null);
  const realtimeVisualTimerRef = useRef<number | null>(null);
  const stepChordPendingNotesRef = useRef<Set<number>>(new Set());
  const stepChordFlushTimerRef = useRef<number | null>(null);
  const stepChordDownAtMsRef = useRef<Map<number, number>>(new Map());
  const lastTouchAtMsRef = useRef(0);
  const pianoTouchCaptureActiveRef = useRef(false);
  const globalTouchLockRestoreRef = useRef<null | (() => void)>(null);
  const pressedComputerKeysRef = useRef<Set<string>>(new Set());
  const activeComputerKeyToMidiRef = useRef<Map<string, number>>(new Map());

  const durationDefs = useMemo<DurationDefinition[]>(
    () =>
      DURATION_CANDIDATES.map((duration) => ({ duration, beats: durationToBeats(duration) }))
        .filter((item) => item.beats > 0)
        .sort((a, b) => b.beats - a.beats),
    []
  );

  const quantStep = useMemo(() => QUANTIZATION_OPTIONS.find((q) => q.id === quantization)?.stepBeats ?? null, [quantization]);
  const chordOnsetWindowBeats = useMemo(
    () => MIDI_CHORD_WINDOW_OPTIONS.find((opt) => opt.id === chordWindow)?.beats ?? 0.08,
    [chordWindow]
  );
  const chordWindowMsLabel = useMemo(() => {
    if (!composition) return 40;
    const tempo = Math.max(1, getEffectiveTempoForMeasure(selectedMeasureIndex));
    return Math.max(1, Math.round((chordOnsetWindowBeats * 60 * 1000) / tempo));
  }, [composition, chordOnsetWindowBeats, selectedMeasureIndex]);

  useEffect(() => {
    const wasEnabled = previousKeyboardInputEnabledRef.current;
    if (!wasEnabled && keyboardInputEnabled) {
      if (mode === 'step' && chordWindow !== 'off') {
        chordWindowAutoByKeyboardRef.current = true;
        setChordWindow('off');
      } else {
        chordWindowAutoByKeyboardRef.current = false;
      }
    }
    if (wasEnabled && !keyboardInputEnabled) {
      chordWindowAutoByKeyboardRef.current = false;
    }
    previousKeyboardInputEnabledRef.current = keyboardInputEnabled;
  }, [keyboardInputEnabled, chordWindow, mode]);

  useEffect(() => {
    if (!keyboardInputEnabled) return;
    if (mode !== 'realtime') return;
    if (chordWindow !== 'off') return;
    if (!chordWindowAutoByKeyboardRef.current) return;
    chordWindowAutoByKeyboardRef.current = false;
    setChordWindow('normal');
  }, [keyboardInputEnabled, mode, chordWindow]);

  const handleChordWindowChange = (next: MidiChordWindowId) => {
    chordWindowAutoByKeyboardRef.current = false;
    setChordWindow(next);
  };
  const mappedCodesByMidi = useMemo(() => {
    const map = new Map<number, string[]>();
    Object.entries(keyboardMapping).forEach(([code, midi]) => {
      if (!map.has(midi)) map.set(midi, []);
      map.get(midi)!.push(codeToDisplayLabel(code));
    });
    map.forEach((labels) => labels.sort((a, b) => a.localeCompare(b)));
    return map;
  }, [keyboardMapping]);
  const keyboardMapLayout = useMemo(() => {
    let whiteIndex = -1;
    const whiteKeys: Array<{ midi: number; label: string; whiteIndex: number }> = [];
    const blackKeys: Array<{ midi: number; label: string; whiteIndex: number }> = [];
    ULTRA_VIRTUAL_KEYS.forEach((key) => {
      if (!key.isBlack) {
        whiteIndex += 1;
        whiteKeys.push({ midi: key.midi, label: key.label, whiteIndex });
      } else {
        blackKeys.push({ midi: key.midi, label: key.label, whiteIndex });
      }
    });
    return { whiteKeys, blackKeys, totalWhite: whiteKeys.length };
  }, []);
  const simpleVirtualKeys = useMemo(() => buildSimpleVirtualKeys(simpleBaseCMidi), [simpleBaseCMidi]);
  const currentVirtualKeys = useMemo(
    () =>
      pianoViewMode === 'ultra'
        ? ULTRA_VIRTUAL_KEYS
        : pianoViewMode === 'extended'
        ? EXTENDED_VIRTUAL_KEYS
        : simpleVirtualKeys,
    [pianoViewMode, simpleVirtualKeys]
  );
  const virtualPianoLayout = useMemo(() => {
    let whiteIndex = -1;
    const whiteKeys: Array<{ midi: number; label: string; whiteIndex: number }> = [];
    const blackKeys: Array<{ midi: number; label: string; whiteIndex: number }> = [];

    currentVirtualKeys.forEach((key) => {
      if (!key.isBlack) {
        whiteIndex += 1;
        whiteKeys.push({ midi: key.midi, label: key.label, whiteIndex });
      } else {
        blackKeys.push({ midi: key.midi, label: key.label, whiteIndex });
      }
    });

    return { whiteKeys, blackKeys, totalWhite: whiteKeys.length };
  }, [currentVirtualKeys]);
  const cJumpTargets = useMemo(() => {
    return virtualPianoLayout.whiteKeys
      .filter((key) => isCMidi(key.midi))
      .map((key) => ({ midi: key.midi, label: key.label }));
  }, [virtualPianoLayout]);

  const clampSimpleBase = (midi: number): number => {
    const rounded = Math.round(midi);
    return Math.max(SIMPLE_C_MIN, Math.min(SIMPLE_C_MAX, rounded));
  };

  const ensureSimpleViewShowsMidi = (midi: number) => {
    if (pianoViewModeRef.current !== 'simple') return;
    if (simpleVisibleMidiRef.current.has(midi)) return;
    const octaveBase = midi - ((midi % 12) + 12) % 12;
    setSimpleBaseCMidi(clampSimpleBase(octaveBase));
  };

  useEffect(() => {
    pianoViewModeRef.current = pianoViewMode;
  }, [pianoViewMode]);

  useEffect(() => {
    simpleVisibleMidiRef.current = new Set(simpleVirtualKeys.map((key) => key.midi));
  }, [simpleVirtualKeys]);

  useEffect(() => {
    if (!pianoFullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPianoFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pianoFullscreen]);

  useEffect(() => {
    const onResize = () => {
      const compact = window.innerWidth < 768;
      setIsCompactViewport(compact);
      if (!compact) {
        setIsCollapsed(false);
      }
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!pianoFullscreen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [pianoFullscreen]);

  const mapHoldBeatsToDuration = (heldBeats: number): NoteDuration => {
    const minBeats = MIN_NOTATABLE_BEATS;
    const normalized = Math.max(minBeats, heldBeats);
    const quantized = quantizeBeats(normalized, quantStep);
    const target = Math.max(minBeats, quantized || normalized);
    const fallbackDef = durationDefs[durationDefs.length - 1];
    const nearest = durationDefs.reduce(
      (best, candidate) =>
        Math.abs(candidate.beats - target) < Math.abs(best.beats - target) ? candidate : best,
      fallbackDef
    );
    return nearest.duration;
  };

  const getEffectiveTimeSignature = (measureIndex: number): string => {
    if (!composition) return '4/4';
    const referenceMeasures = composition.staves[0]?.measures ?? [];
    for (let i = measureIndex; i >= 0; i--) {
      const sig = referenceMeasures[i]?.timeSignature;
      if (sig) return sig;
    }
    return composition.timeSignature || '4/4';
  };

  const getEffectiveKeySignatureForMeasure = (measureIndex: number): string => {
    if (!composition) return 'C';
    const referenceMeasures = composition.staves[0]?.measures ?? [];
    for (let i = measureIndex; i >= 0; i--) {
      const ks = referenceMeasures[i]?.keySignature;
      if (ks) return ks;
    }
    return composition.keySignature || 'C';
  };

  const parseTimeSignature = (timeSignature: string): { numerator: number; denominator: number } => {
    const [rawNum, rawDen] = timeSignature.split('/').map(Number);
    const numerator = Number.isFinite(rawNum) && rawNum > 0 ? rawNum : 4;
    const denominator = Number.isFinite(rawDen) && rawDen > 0 ? rawDen : 4;
    return { numerator, denominator };
  };

  function getEffectiveTempoForMeasure(measureIndex: number): number {
    if (!composition) return 120;
    const referenceMeasures = composition.staves[0]?.measures ?? [];
    for (let i = measureIndex; i >= 0; i--) {
      const tempo = referenceMeasures[i]?.tempo;
      if (typeof tempo === 'number' && Number.isFinite(tempo) && tempo > 0) return tempo;
    }
    return composition.tempo;
  }

  const getMeasureCapacityQuarterBeats = (measureIndex: number): number => {
    if (!composition) return 4;
    const { numerator, denominator } = parseTimeSignature(getEffectiveTimeSignature(measureIndex));
    const quarterBeats = numerator * (4 / denominator);
    if (composition.anacrusis && measureIndex === 0) {
      const pickupBeats = Math.max(1, composition.pickupBeats ?? 1);
      return pickupBeats * (4 / denominator);
    }
    return Number.isFinite(quarterBeats) && quarterBeats > 0 ? quarterBeats : 4;
  };

  const holdMsToQuarterBeats = (holdMs: number, measureIndex: number): number => {
    const tempo = Math.max(1, getEffectiveTempoForMeasure(measureIndex));
    const measureQuarterBeats = Math.max(MIN_NOTATABLE_BEATS, getMeasureCapacityQuarterBeats(measureIndex));
    const measureSeconds = (measureQuarterBeats * 60) / tempo;
    if (!Number.isFinite(measureSeconds) || measureSeconds <= 0) {
      return Math.max(MIN_NOTATABLE_BEATS, (holdMs / 1000) / (60 / tempo));
    }
    const heldSeconds = Math.max(0.001, holdMs / 1000);
    const measureFraction = heldSeconds / measureSeconds;
    return Math.max(MIN_NOTATABLE_BEATS, measureFraction * measureQuarterBeats);
  };

  const normalizeNotatableBeats = (beats: number): number => {
    const quantized = quantizeBeats(Math.max(MIN_NOTATABLE_BEATS, beats), quantStep);
    return Math.max(MIN_NOTATABLE_BEATS, Math.round(quantized / MIN_NOTATABLE_BEATS) * MIN_NOTATABLE_BEATS);
  };

  const playbackHighlightedMidi = useMemo(() => {
    if (!showPlaybackOnKeyboard || playbackState !== 'playing' || !composition || playingNotes.size === 0) {
      return new Set<number>();
    }
    const highlighted = new Set<number>();
    playingNotes.forEach((serialized) => {
      const [staffIndex, measureIndex, voiceIndex, noteIndex] = serialized.split(':').map(Number);
      if (![staffIndex, measureIndex, voiceIndex, noteIndex].every((n) => Number.isFinite(n))) return;
      const measure = composition.staves[staffIndex]?.measures?.[measureIndex];
      const element = measure?.voices?.[voiceIndex]?.notes?.[noteIndex];
      if (!measure || !element || !('pitch' in element)) return;
      const keySig = getEffectiveKeySignatureForMeasure(measureIndex);
      const playedPitch = applyKeySignatureAndMeasureAccidentals(
        element.pitch,
        keySig,
        measure as any,
        noteIndex,
        element.accidental
      );
      highlighted.add(clampMidi(pitchToMidi(playedPitch)));
    });
    return highlighted;
  }, [showPlaybackOnKeyboard, playbackState, composition, playingNotes]);

  useEffect(() => {
    if (!showPlaybackOnKeyboard || !composition) {
      previousPlayingNotesRef.current = new Set<string>();
      return;
    }
    const previous = previousPlayingNotesRef.current;
    const next = new Set<string>(playingNotes);
    next.forEach((serialized) => {
      if (previous.has(serialized)) return;
      const [staffIndex, measureIndex, voiceIndex, noteIndex] = serialized.split(':').map(Number);
      if (![staffIndex, measureIndex, voiceIndex, noteIndex].every((n) => Number.isFinite(n))) return;
      const measure = composition.staves[staffIndex]?.measures?.[measureIndex];
      const element = measure?.voices?.[voiceIndex]?.notes?.[noteIndex];
      if (!measure || !element || !('pitch' in element)) return;
      const keySig = getEffectiveKeySignatureForMeasure(measureIndex);
      const playedPitch = applyKeySignatureAndMeasureAccidentals(
        element.pitch,
        keySig,
        measure as any,
        noteIndex,
        element.accidental
      );
      triggerKeyRetrigger(pitchToMidi(playedPitch));
    });
    previousPlayingNotesRef.current = next;
  }, [showPlaybackOnKeyboard, composition, playingNotes]);

  const displayActiveVirtualNotes = useMemo(() => {
    if (playbackHighlightedMidi.size === 0) return activeVirtualNotes;
    const merged = new Set<number>(activeVirtualNotes);
    playbackHighlightedMidi.forEach((midi) => merged.add(midi));
    return merged;
  }, [activeVirtualNotes, playbackHighlightedMidi]);

  const getRealtimeGapToleranceBeats = (): number => {
    if (!composition || quantization !== 'off') return 0;
    const tempo = Math.max(1, composition.tempo);
    return Math.max(EPSILON, (REALTIME_LEGATO_GAP_MS / 1000) / (60 / tempo));
  };

  const normalizeTimelineEvents = (events: TimelinePlacementEvent[]): TimelinePlacementEvent[] => {
    let filtered = events
      .map((event) => {
        const qStart = quantizeBeats(event.startBeats, quantStep);
        const rawDuration = quantizeBeats(event.durationBeats, quantStep);
        const start = Math.max(0, Math.round(qStart / MIN_NOTATABLE_BEATS) * MIN_NOTATABLE_BEATS);
        const duration = Math.max(
          MIN_NOTATABLE_BEATS,
          Math.round(Math.max(rawDuration, quantStep ?? MIN_NOTATABLE_BEATS) / MIN_NOTATABLE_BEATS) * MIN_NOTATABLE_BEATS
        );
        return { ...event, startBeats: start, durationBeats: duration };
      })
      .filter((event) => event.durationBeats > EPSILON)
      .sort((a, b) => a.startBeats - b.startBeats);

    const gapToleranceBeats = getRealtimeGapToleranceBeats();
    if (gapToleranceBeats > EPSILON) {
      let previousEndForLegato = 0;
      filtered = filtered.map((event) => {
        const adjustedStart =
          event.startBeats <= previousEndForLegato + gapToleranceBeats
            ? previousEndForLegato
            : event.startBeats;
        const adjusted = { ...event, startBeats: adjustedStart };
        previousEndForLegato = Math.max(previousEndForLegato, adjusted.startBeats + adjusted.durationBeats);
        return adjusted;
      });
    }

    return filtered;
  };

  const getVoicePriorityOrder = (startVoice: number): number[] => {
    const safeStart = Math.max(0, Math.min(3, startVoice));
    return [safeStart, (safeStart + 1) % 4, (safeStart + 2) % 4, (safeStart + 3) % 4];
  };

  const buildLaneEventMap = (
    events: TimelinePlacementEvent[],
    startVoice: number,
    onsetWindowBeats: number
  ): Map<number, TimelinePlacementEvent[]> => {
    const grouped: TimelinePlacementEvent[][] = [];
    events.forEach((event) => {
      const currentGroup = grouped[grouped.length - 1];
      if (!currentGroup) {
        grouped.push([event]);
        return;
      }
      if (onsetWindowBeats <= EPSILON) {
        grouped.push([event]);
        return;
      }
      const groupStart = currentGroup[0]?.startBeats ?? event.startBeats;
      if (Math.abs(event.startBeats - groupStart) <= onsetWindowBeats) {
        currentGroup.push(event);
      } else {
        grouped.push([event]);
      }
    });

    const laneMap = new Map<number, TimelinePlacementEvent[]>();
    const voiceOrder = getVoicePriorityOrder(startVoice).slice(0, MIDI_MAX_CHORD_VOICES);
    grouped.forEach((group) => {
      const sortedGroup = [...group].sort((a, b) => a.midi - b.midi);
      const usable = Math.min(sortedGroup.length, voiceOrder.length);
      for (let i = 0; i < usable; i++) {
        const voiceIndex = voiceOrder[i];
        if (!laneMap.has(voiceIndex)) laneMap.set(voiceIndex, []);
        laneMap.get(voiceIndex)!.push(sortedGroup[i]);
      }
    });
    return laneMap;
  };

  const getVoiceUsedBeatsInDraft = (
    draft: Composition,
    staffIndex: number,
    measureIndex: number,
    voiceIndex: number
  ): number => {
    const voice = draft.staves[staffIndex]?.measures?.[measureIndex]?.voices?.[voiceIndex];
    if (!voice) return 0;
    return voice.notes.reduce((sum, element) => sum + durationToBeats(element.duration), 0);
  };

  const buildDraftLaneStartCursor = (
    draft: Composition,
    startCursor: CursorState,
    voiceIndex: number
  ): CursorState | null => {
    ensureTransientMeasure(draft, startCursor.staffIndex, startCursor.measureIndex);
    const used = getVoiceUsedBeatsInDraft(draft, startCursor.staffIndex, startCursor.measureIndex, voiceIndex);
    if (used > startCursor.beatInMeasure + EPSILON) return null;
    return {
      ...startCursor,
      voiceIndex,
      beatInMeasure: used,
    };
  };

  const buildLiveLaneStartCursor = (
    startCursor: CursorState,
    voiceIndex: number
  ): CursorState | null => {
    ensureMeasureExists(startCursor.staffIndex, startCursor.measureIndex);
    const used = getVoiceUsedBeats(startCursor.staffIndex, startCursor.measureIndex, voiceIndex);
    if (used > startCursor.beatInMeasure + EPSILON) return null;
    return {
      ...startCursor,
      voiceIndex,
      beatInMeasure: used,
    };
  };

  const applyTimelineToDraftAcrossVoices = (
    draft: Composition,
    startCursor: CursorState,
    events: TimelinePlacementEvent[],
    totalBeats: number
  ): CursorState => {
    const laneMap = buildLaneEventMap(events, startCursor.voiceIndex, chordOnsetWindowBeats);
    let baseCursor = { ...startCursor };
    let baseVoiceApplied = false;
    const voiceIndices = Array.from(laneMap.keys()).sort((a, b) => a - b);
    for (const voiceIndex of voiceIndices) {
      const laneEvents = laneMap.get(voiceIndex) ?? [];
      let laneCursor = buildDraftLaneStartCursor(draft, startCursor, voiceIndex);
      if (!laneCursor) continue;
      const alignGap = Math.max(0, startCursor.beatInMeasure - laneCursor.beatInMeasure);
      if (alignGap > EPSILON) {
        laneCursor = appendRestToDraft(draft, laneCursor, alignGap);
      }
      let previousEnd = 0;
      for (const event of laneEvents) {
        const eventStart = Math.max(previousEnd, event.startBeats);
        const gap = Math.max(0, eventStart - previousEnd);
        if (gap > EPSILON) {
          laneCursor = appendRestToDraft(draft, laneCursor, gap);
        }
        laneCursor = appendNoteToDraft(draft, laneCursor, event.midi, event.durationBeats, Boolean(event.provisional));
        previousEnd = Math.max(previousEnd, eventStart + event.durationBeats);
      }
      if (voiceIndex === startCursor.voiceIndex) {
        const trailingSilence = Math.max(0, totalBeats - previousEnd);
        if (trailingSilence > EPSILON) {
          laneCursor = appendRestToDraft(draft, laneCursor, trailingSilence);
        }
        baseCursor = laneCursor;
        baseVoiceApplied = true;
      }
    }

    if (!baseVoiceApplied) {
      const fallbackBase = buildDraftLaneStartCursor(draft, startCursor, startCursor.voiceIndex);
      if (fallbackBase) {
        const alignGap = Math.max(0, startCursor.beatInMeasure - fallbackBase.beatInMeasure);
        let laneCursor = fallbackBase;
        if (alignGap > EPSILON) {
          laneCursor = appendRestToDraft(draft, laneCursor, alignGap);
        }
        const trailingSilence = Math.max(0, totalBeats);
        if (trailingSilence > EPSILON) {
          laneCursor = appendRestToDraft(draft, laneCursor, trailingSilence);
        }
        baseCursor = laneCursor;
      }
    }
    return baseCursor;
  };

  const applyTimelineToLiveAcrossVoices = (
    startCursor: CursorState,
    events: TimelinePlacementEvent[],
    totalBeats: number
  ): CursorState => {
    const laneMap = buildLaneEventMap(events, startCursor.voiceIndex, chordOnsetWindowBeats);
    let baseCursor = { ...startCursor };
    let baseVoiceApplied = false;
    const voiceIndices = Array.from(laneMap.keys()).sort((a, b) => a - b);
    for (const voiceIndex of voiceIndices) {
      const laneEvents = laneMap.get(voiceIndex) ?? [];
      let laneCursor = buildLiveLaneStartCursor(startCursor, voiceIndex);
      if (!laneCursor) continue;
      const alignGap = Math.max(0, startCursor.beatInMeasure - laneCursor.beatInMeasure);
      if (alignGap > EPSILON) {
        laneCursor = appendRest(laneCursor, alignGap);
      }
      let previousEnd = 0;
      for (const event of laneEvents) {
        const eventStart = Math.max(previousEnd, event.startBeats);
        const gap = Math.max(0, eventStart - previousEnd);
        if (gap > EPSILON) {
          laneCursor = appendRest(laneCursor, gap);
        }
        laneCursor = appendNote(laneCursor, event.midi, event.durationBeats);
        previousEnd = Math.max(previousEnd, eventStart + event.durationBeats);
      }
      if (voiceIndex === startCursor.voiceIndex) {
        const trailingSilence = Math.max(0, totalBeats - previousEnd);
        if (trailingSilence > EPSILON) {
          laneCursor = appendRest(laneCursor, trailingSilence);
        }
        baseCursor = laneCursor;
        baseVoiceApplied = true;
      }
    }

    if (!baseVoiceApplied) {
      const fallbackBase = buildLiveLaneStartCursor(startCursor, startCursor.voiceIndex);
      if (fallbackBase) {
        const alignGap = Math.max(0, startCursor.beatInMeasure - fallbackBase.beatInMeasure);
        let laneCursor = fallbackBase;
        if (alignGap > EPSILON) {
          laneCursor = appendRest(laneCursor, alignGap);
        }
        const trailingSilence = Math.max(0, totalBeats);
        if (trailingSilence > EPSILON) {
          laneCursor = appendRest(laneCursor, trailingSilence);
        }
        baseCursor = laneCursor;
      }
    }
    return baseCursor;
  };

  const cloneComposition = (source: Composition): Composition =>
    JSON.parse(JSON.stringify(source)) as Composition;

  const syncPreRecordStructureFromCurrent = () => {
    const baseline = preRecordCompositionRef.current;
    const current = useScoreStore.getState().composition as Composition | undefined;
    if (!baseline || !current) return;

    const merged = cloneComposition(baseline);
    merged.timeSignature = current.timeSignature;
    merged.keySignature = current.keySignature;
    merged.tempo = current.tempo;
    merged.anacrusis = current.anacrusis;
    merged.pickupBeats = current.pickupBeats;
    merged.notationSystem = current.notationSystem;

    merged.staves = current.staves.map((currentStaff, staffIndex) => {
      const baseStaff = merged.staves[staffIndex];
      const baseMeasures = baseStaff?.measures ?? [];
      const mergedMeasures = currentStaff.measures.map((currentMeasure, measureIndex) => {
        const baseMeasure = baseMeasures[measureIndex];
        const safeVoices =
          baseMeasure?.voices && baseMeasure.voices.length > 0
            ? baseMeasure.voices.map((voice) => ({ notes: [...voice.notes] }))
            : [{ notes: [] }, { notes: [] }, { notes: [] }, { notes: [] }];
        return {
          ...(baseMeasure ?? { number: currentMeasure.number, voices: safeVoices }),
          number: currentMeasure.number,
          timeSignature: currentMeasure.timeSignature,
          keySignature: currentMeasure.keySignature,
          tempo: currentMeasure.tempo,
          clef: currentMeasure.clef,
          chantDivision: currentMeasure.chantDivision,
          repeatStart: currentMeasure.repeatStart,
          repeatEnd: currentMeasure.repeatEnd,
          ending: currentMeasure.ending,
          navigation: currentMeasure.navigation,
          segno: currentMeasure.segno,
          coda: currentMeasure.coda,
          voices: safeVoices,
        };
      });

      return {
        ...(baseStaff ?? currentStaff),
        name: currentStaff.name,
        instrument: currentStaff.instrument,
        clef: currentStaff.clef,
        hidden: currentStaff.hidden,
        measures: mergedMeasures,
      };
    });

    preRecordCompositionRef.current = merged;
  };

  const updateCompositionTransient = (mutate: (draft: Composition) => boolean | void) => {
    const current = useScoreStore.getState().composition;
    if (!current) return;
    const draft = cloneComposition(current);
    const changed = mutate(draft);
    if (changed === false) return;
    setComposition(draft);
  };

  const ensureTransientMeasure = (draft: Composition, staffIndex: number, measureIndex: number) => {
    const staff = draft.staves[staffIndex];
    if (!staff) return;
    while (staff.measures.length <= measureIndex) {
      staff.measures.push({
        number: staff.measures.length + 1,
        voices: [{ notes: [] }, { notes: [] }, { notes: [] }, { notes: [] }],
      });
    }
    const measure = staff.measures[measureIndex];
    while (measure.voices.length < 4) {
      measure.voices.push({ notes: [] });
    }
  };

  const getVoiceUsedBeats = (staffIndex: number, measureIndex: number, voiceIndex: number): number => {
    const latestComposition = useScoreStore.getState().composition;
    if (!latestComposition) return 0;
    const voice = latestComposition.staves[staffIndex]?.measures[measureIndex]?.voices[voiceIndex];
    if (!voice) return 0;
    return voice.notes.reduce((sum, element) => sum + durationToBeats(element.duration), 0);
  };

  const ensureMeasureExists = (staffIndex: number, measureIndex: number) => {
    let guard = 0;
    while (guard < 256) {
      const latestComposition = useScoreStore.getState().composition;
      const currentLength = latestComposition?.staves[staffIndex]?.measures.length ?? 0;
      if (measureIndex < currentLength) return;
      addMeasure(staffIndex);
      guard++;
    }
  };

  const ensureCursor = (): CursorState => {
    const scoreState = useScoreStore.getState();
    const latestComposition = scoreState.composition;
    const selectedStaff = scoreState.selectedStaffIndex ?? 0;
    const selectedMeasure = scoreState.selectedMeasureIndex ?? 0;
    const selectedVoice = scoreState.selectedVoiceIndex ?? 0;
    const safeStaffIndex = latestComposition?.staves[selectedStaff] ? selectedStaff : 0;
    const safeMeasureIndex = Math.max(0, selectedMeasure);
    const safeVoiceIndex = Math.max(0, Math.min(3, selectedVoice));
    ensureMeasureExists(safeStaffIndex, safeMeasureIndex);
    const used = getVoiceUsedBeats(safeStaffIndex, safeMeasureIndex, safeVoiceIndex);
    const capacity = (() => {
      if (!latestComposition) return 4;
      const referenceMeasures = latestComposition.staves[0]?.measures ?? [];
      let effectiveTimeSig = latestComposition.timeSignature || '4/4';
      for (let i = safeMeasureIndex; i >= 0; i--) {
        const sig = referenceMeasures[i]?.timeSignature;
        if (sig) {
          effectiveTimeSig = sig;
          break;
        }
      }
      const { numerator, denominator } = parseTimeSignature(effectiveTimeSig);
      if (latestComposition.anacrusis && safeMeasureIndex === 0) {
        const pickupBeats = Math.max(1, latestComposition.pickupBeats ?? 1);
        return pickupBeats * (4 / denominator);
      }
      const quarterBeats = numerator * (4 / denominator);
      return Number.isFinite(quarterBeats) && quarterBeats > 0 ? quarterBeats : 4;
    })();
    const cursor: CursorState = {
      staffIndex: safeStaffIndex,
      measureIndex: safeMeasureIndex,
      voiceIndex: safeVoiceIndex,
      beatInMeasure: Math.min(used, capacity),
    };
    stepCursorRef.current = cursor;
    return cursor;
  };

  useEffect(() => {
    stepCursorRef.current = null;
  }, [selectedStaffIndex, selectedMeasureIndex, selectedVoiceIndex]);

  const appendDurationAsElements = (
    cursor: CursorState,
    totalBeats: number,
    buildElement: (duration: NoteDuration, hasMoreSegments: boolean) => Note | Rest
  ): CursorState => {
    let remaining = Math.max(0, totalBeats);
    let current = { ...cursor };

    while (remaining > EPSILON) {
      ensureMeasureExists(current.staffIndex, current.measureIndex);
      const measureCapacity = getMeasureCapacityQuarterBeats(current.measureIndex);
      if (current.beatInMeasure >= measureCapacity - EPSILON) {
        current = { ...current, measureIndex: current.measureIndex + 1, beatInMeasure: 0 };
        continue;
      }

      const available = Math.max(0, measureCapacity - current.beatInMeasure);
      const targetChunk = Math.min(remaining, available);
      if (targetChunk <= EPSILON) {
        current = { ...current, measureIndex: current.measureIndex + 1, beatInMeasure: 0 };
        continue;
      }

      const fallbackDef = durationDefs[durationDefs.length - 1];
      const chosenDef =
        durationDefs.find((def) => def.beats <= targetChunk + EPSILON) ??
        durationDefs.reduce((best, candidate) =>
          Math.abs(candidate.beats - targetChunk) < Math.abs(best.beats - targetChunk) ? candidate : best
        , fallbackDef);

      const segmentBeats = Math.min(chosenDef.beats, targetChunk);
      const latestComposition = useScoreStore.getState().composition;
      const voice =
        latestComposition?.staves[current.staffIndex]?.measures[current.measureIndex]?.voices[current.voiceIndex];
      const insertIndex = voice?.notes.length ?? 0;
      const hasMore = remaining - segmentBeats > EPSILON;
      addNote(current.staffIndex, current.measureIndex, current.voiceIndex, buildElement(chosenDef.duration, hasMore), insertIndex);

      remaining -= segmentBeats;
      current = { ...current, beatInMeasure: current.beatInMeasure + segmentBeats };
      if (current.beatInMeasure >= measureCapacity - EPSILON) {
        current = { ...current, measureIndex: current.measureIndex + 1, beatInMeasure: 0 };
      }
    }

    return current;
  };

  const appendRest = (cursor: CursorState, beats: number): CursorState => {
    if (beats <= EPSILON) return cursor;
    return appendDurationAsElements(cursor, beats, (duration) => ({ duration }));
  };

  const appendNote = (cursor: CursorState, midi: number, beats: number): CursorState => {
    const pitch = midiToPitch(clampMidi(midi));
    return appendDurationAsElements(cursor, beats, (duration, hasMoreSegments) => ({
      pitch,
      duration,
      tie: hasMoreSegments || undefined,
    }));
  };

  const sortSegmentsForRemoval = (segments: ProvisionalSegmentRef[]): ProvisionalSegmentRef[] =>
    [...segments].sort((a, b) => {
      if (a.staffIndex !== b.staffIndex) return b.staffIndex - a.staffIndex;
      if (a.measureIndex !== b.measureIndex) return b.measureIndex - a.measureIndex;
      if (a.voiceIndex !== b.voiceIndex) return b.voiceIndex - a.voiceIndex;
      return b.noteIndex - a.noteIndex;
    });

  const removeProvisionalSegmentsFromDraft = (draft: Composition, segments: ProvisionalSegmentRef[]): boolean => {
    let changed = false;
    sortSegmentsForRemoval(segments).forEach((segment) => {
      const voice =
        draft.staves[segment.staffIndex]?.measures?.[segment.measureIndex]?.voices?.[segment.voiceIndex];
      const note = voice?.notes?.[segment.noteIndex];
      if (!voice || !note || !('pitch' in note) || !note.provisional) return;
      voice.notes.splice(segment.noteIndex, 1);
      changed = true;
    });
    return changed;
  };

  const removeSegmentRefsFromDraft = (draft: Composition, segments: ProvisionalSegmentRef[]): boolean => {
    let changed = false;
    sortSegmentsForRemoval(segments).forEach((segment) => {
      const voice =
        draft.staves[segment.staffIndex]?.measures?.[segment.measureIndex]?.voices?.[segment.voiceIndex];
      if (!voice || segment.noteIndex < 0 || segment.noteIndex >= voice.notes.length) return;
      voice.notes.splice(segment.noteIndex, 1);
      changed = true;
    });
    return changed;
  };

  const finalizeProvisionalSegmentsInDraft = (draft: Composition, segments: ProvisionalSegmentRef[]): boolean => {
    let changed = false;
    sortSegmentsForRemoval(segments).forEach((segment) => {
      const voice =
        draft.staves[segment.staffIndex]?.measures?.[segment.measureIndex]?.voices?.[segment.voiceIndex];
      const note = voice?.notes?.[segment.noteIndex];
      if (!voice || !note || !('pitch' in note) || !note.provisional) return;
      delete note.provisional;
      changed = true;
    });
    return changed;
  };

  const findInsertIndexAtBeat = (voice: { notes: Array<Note | Rest> }, beatInMeasure: number): number => {
    let elapsed = 0;
    for (let i = 0; i < voice.notes.length; i++) {
      if (elapsed >= beatInMeasure - EPSILON) {
        return i;
      }
      elapsed += durationToBeats(voice.notes[i].duration);
    }
    return voice.notes.length;
  };

  const advanceCursorByBeats = (cursor: CursorState, beats: number): CursorState => {
    let remaining = Math.max(0, beats);
    let current = { ...cursor };
    while (remaining > EPSILON) {
      const measureCapacity = getMeasureCapacityQuarterBeats(current.measureIndex);
      const available = Math.max(0, measureCapacity - current.beatInMeasure);
      if (available <= EPSILON) {
        current = { ...current, measureIndex: current.measureIndex + 1, beatInMeasure: 0 };
        continue;
      }
      const step = Math.min(remaining, available);
      remaining -= step;
      current = { ...current, beatInMeasure: current.beatInMeasure + step };
      if (current.beatInMeasure >= measureCapacity - EPSILON) {
        current = { ...current, measureIndex: current.measureIndex + 1, beatInMeasure: 0 };
      }
    }
    return current;
  };

  const insertProvisionalSegmentsIntoDraft = (
    draft: Composition,
    cursor: CursorState,
    midi: number,
    totalBeats: number
  ): { nextCursor: CursorState; segments: ProvisionalSegmentRef[] } => {
    let remaining = Math.max(0, totalBeats);
    let current = { ...cursor };
    const pitch = midiToPitch(clampMidi(midi));
    const segments: ProvisionalSegmentRef[] = [];

    while (remaining > EPSILON) {
      ensureTransientMeasure(draft, current.staffIndex, current.measureIndex);
      const measureCapacity = getMeasureCapacityQuarterBeats(current.measureIndex);
      if (current.beatInMeasure >= measureCapacity - EPSILON) {
        current = { ...current, measureIndex: current.measureIndex + 1, beatInMeasure: 0 };
        continue;
      }

      const available = Math.max(0, measureCapacity - current.beatInMeasure);
      const targetChunk = Math.min(remaining, available);
      if (targetChunk <= EPSILON) {
        current = { ...current, measureIndex: current.measureIndex + 1, beatInMeasure: 0 };
        continue;
      }

      const fallbackDef = durationDefs[durationDefs.length - 1];
      const chosenDef =
        durationDefs.find((def) => def.beats <= targetChunk + EPSILON) ??
        durationDefs.reduce((best, candidate) =>
          Math.abs(candidate.beats - targetChunk) < Math.abs(best.beats - targetChunk) ? candidate : best
        , fallbackDef);
      const segmentBeats = Math.min(chosenDef.beats, targetChunk);

      const voice = draft.staves[current.staffIndex].measures[current.measureIndex].voices[current.voiceIndex];
      const insertIndex = findInsertIndexAtBeat(voice, current.beatInMeasure);
      const hasMoreSegments = remaining - segmentBeats > EPSILON;
      voice.notes.splice(insertIndex, 0, {
        pitch,
        duration: chosenDef.duration,
        tie: hasMoreSegments || undefined,
        provisional: true,
      });
      segments.push({
        staffIndex: current.staffIndex,
        measureIndex: current.measureIndex,
        voiceIndex: current.voiceIndex,
        noteIndex: insertIndex,
      });

      remaining -= segmentBeats;
      current = { ...current, beatInMeasure: current.beatInMeasure + segmentBeats };
      if (current.beatInMeasure >= measureCapacity - EPSILON) {
        current = { ...current, measureIndex: current.measureIndex + 1, beatInMeasure: 0 };
      }
    }

    return { nextCursor: current, segments };
  };

  const insertProvisionalRestsIntoDraft = (
    draft: Composition,
    cursor: CursorState,
    totalBeats: number
  ): { nextCursor: CursorState; segments: ProvisionalSegmentRef[] } => {
    let remaining = Math.max(0, totalBeats);
    let current = { ...cursor };
    const segments: ProvisionalSegmentRef[] = [];

    while (remaining > EPSILON) {
      ensureTransientMeasure(draft, current.staffIndex, current.measureIndex);
      const measureCapacity = getMeasureCapacityQuarterBeats(current.measureIndex);
      if (current.beatInMeasure >= measureCapacity - EPSILON) {
        current = { ...current, measureIndex: current.measureIndex + 1, beatInMeasure: 0 };
        continue;
      }

      const available = Math.max(0, measureCapacity - current.beatInMeasure);
      const targetChunk = Math.min(remaining, available);
      if (targetChunk <= EPSILON) {
        current = { ...current, measureIndex: current.measureIndex + 1, beatInMeasure: 0 };
        continue;
      }

      const fallbackDef = durationDefs[durationDefs.length - 1];
      const chosenDef =
        durationDefs.find((def) => def.beats <= targetChunk + EPSILON) ??
        durationDefs.reduce((best, candidate) =>
          Math.abs(candidate.beats - targetChunk) < Math.abs(best.beats - targetChunk) ? candidate : best
        , fallbackDef);
      const segmentBeats = Math.min(chosenDef.beats, targetChunk);

      const voice = draft.staves[current.staffIndex].measures[current.measureIndex].voices[current.voiceIndex];
      const insertIndex = findInsertIndexAtBeat(voice, current.beatInMeasure);
      voice.notes.splice(insertIndex, 0, { duration: chosenDef.duration });
      segments.push({
        staffIndex: current.staffIndex,
        measureIndex: current.measureIndex,
        voiceIndex: current.voiceIndex,
        noteIndex: insertIndex,
      });

      remaining -= segmentBeats;
      current = { ...current, beatInMeasure: current.beatInMeasure + segmentBeats };
      if (current.beatInMeasure >= measureCapacity - EPSILON) {
        current = { ...current, measureIndex: current.measureIndex + 1, beatInMeasure: 0 };
      }
    }

    return { nextCursor: current, segments };
  };

  const appendDurationToDraft = (
    draft: Composition,
    cursor: CursorState,
    totalBeats: number,
    buildElement: (duration: NoteDuration, hasMoreSegments: boolean) => Note | Rest
  ): CursorState => {
    let remaining = Math.max(0, totalBeats);
    let current = { ...cursor };

    while (remaining > EPSILON) {
      ensureTransientMeasure(draft, current.staffIndex, current.measureIndex);
      const measureCapacity = getMeasureCapacityQuarterBeats(current.measureIndex);
      if (current.beatInMeasure >= measureCapacity - EPSILON) {
        current = { ...current, measureIndex: current.measureIndex + 1, beatInMeasure: 0 };
        continue;
      }

      const available = Math.max(0, measureCapacity - current.beatInMeasure);
      const targetChunk = Math.min(remaining, available);
      if (targetChunk <= EPSILON) {
        current = { ...current, measureIndex: current.measureIndex + 1, beatInMeasure: 0 };
        continue;
      }

      const fallbackDef = durationDefs[durationDefs.length - 1];
      const chosenDef =
        durationDefs.find((def) => def.beats <= targetChunk + EPSILON) ??
        durationDefs.reduce((best, candidate) =>
          Math.abs(candidate.beats - targetChunk) < Math.abs(best.beats - targetChunk) ? candidate : best
        , fallbackDef);

      const segmentBeats = Math.min(chosenDef.beats, targetChunk);
      const hasMore = remaining - segmentBeats > EPSILON;
      const voice = draft.staves[current.staffIndex].measures[current.measureIndex].voices[current.voiceIndex];
      voice.notes.push(buildElement(chosenDef.duration, hasMore));

      remaining -= segmentBeats;
      current = { ...current, beatInMeasure: current.beatInMeasure + segmentBeats };
      if (current.beatInMeasure >= measureCapacity - EPSILON) {
        current = { ...current, measureIndex: current.measureIndex + 1, beatInMeasure: 0 };
      }
    }

    return current;
  };

  const appendRestToDraft = (draft: Composition, cursor: CursorState, beats: number): CursorState =>
    appendDurationToDraft(draft, cursor, beats, (duration) => ({ duration }));

  const appendNoteToDraft = (
    draft: Composition,
    cursor: CursorState,
    midi: number,
    beats: number,
    provisional = false
  ): CursorState => {
    const pitch = midiToPitch(clampMidi(midi));
    return appendDurationToDraft(draft, cursor, beats, (duration, hasMoreSegments) => ({
      pitch,
      duration,
      tie: hasMoreSegments || undefined,
      provisional: provisional || undefined,
    }));
  };

  const rebuildAdaptiveProvisionalHold = (midi: number, hold: ActiveStepHoldNote, totalBeats: number) => {
    if (
      hold.staffIndex === undefined ||
      hold.measureIndex === undefined ||
      hold.voiceIndex === undefined ||
      hold.startBeatInMeasure === undefined
    ) {
      return;
    }

    let nextSegments: ProvisionalSegmentRef[] = [];
    let nextCursor: CursorState | null = null;
    updateCompositionTransient((draft) => {
      const previousSegments =
        hold.provisionalSegments && hold.provisionalSegments.length > 0
          ? hold.provisionalSegments
          : hold.noteIndex !== undefined
          ? [{
              staffIndex: hold.staffIndex!,
              measureIndex: hold.measureIndex!,
              voiceIndex: hold.voiceIndex!,
              noteIndex: hold.noteIndex!,
            }]
          : [];
      const removed = removeProvisionalSegmentsFromDraft(draft, previousSegments);
      const inserted = insertProvisionalSegmentsIntoDraft(
        draft,
        {
          staffIndex: hold.staffIndex!,
          measureIndex: hold.measureIndex!,
          voiceIndex: hold.voiceIndex!,
          beatInMeasure: hold.startBeatInMeasure!,
        },
        midi,
        totalBeats
      );
      nextSegments = inserted.segments;
      nextCursor = inserted.nextCursor;
      return removed || inserted.segments.length > 0;
    });

    if (nextSegments.length > 0) {
      hold.provisionalSegments = nextSegments;
      hold.noteIndex = nextSegments[0].noteIndex;
      hold.measureIndex = nextSegments[0].measureIndex;
      hold.voiceIndex = nextSegments[0].voiceIndex;
      hold.staffIndex = nextSegments[0].staffIndex;
    }
    if (nextCursor) {
      stepCursorRef.current = nextCursor;
      if (nextSegments.length > 0) {
        const last = nextSegments[nextSegments.length - 1];
        emitMidiFollowMeasure(last.staffIndex, last.measureIndex);
      }
    }
  };

  const rebuildRealtimeProvisionalHold = (midi: number, entry: ProvisionalRealtimeNote, totalBeats: number) => {
    let nextSegments: ProvisionalSegmentRef[] = [];
    updateCompositionTransient((draft) => {
      const removed = removeProvisionalSegmentsFromDraft(draft, entry.provisionalSegments);
      const inserted = insertProvisionalSegmentsIntoDraft(
        draft,
        {
          staffIndex: entry.staffIndex,
          measureIndex: entry.measureIndex,
          voiceIndex: entry.voiceIndex,
          beatInMeasure: entry.startBeatInMeasure,
        },
        midi,
        totalBeats
      );
      nextSegments = inserted.segments;
      return removed || inserted.segments.length > 0;
    });
    if (nextSegments.length > 0) {
      entry.provisionalSegments = nextSegments;
      entry.noteIndex = nextSegments[0].noteIndex;
      entry.measureIndex = nextSegments[0].measureIndex;
      entry.voiceIndex = nextSegments[0].voiceIndex;
      entry.staffIndex = nextSegments[0].staffIndex;
      const last = nextSegments[nextSegments.length - 1];
      emitMidiFollowMeasure(last.staffIndex, last.measureIndex);
    }
  };

  const rebuildRealtimePreviewComposition = (nowMs: number) => {
    if (!isRecording || isRecordPaused || isRecordArming) return;
    const latestComposition = useScoreStore.getState().composition;
    if (!latestComposition) return;
    if (!preRecordCompositionRef.current || !realtimeStartCursorRef.current || recordStartMsRef.current === null) return;

    const secondsPerBeat = 60 / Math.max(1, latestComposition.tempo);
    const recordedTotalBeats = Math.max(0, (nowMs - recordStartMsRef.current) / 1000 / secondsPerBeat);
    const activeEvents: TimelinePlacementEvent[] = Array.from(realtimeActiveNotesRef.current.entries()).map(
      ([midi, active]) => ({
        midi,
        startBeats: (active.startedAtMs - recordStartMsRef.current!) / 1000 / secondsPerBeat,
        durationBeats: Math.max(0.05, (nowMs - active.startedAtMs) / 1000 / secondsPerBeat),
        velocity: active.velocity,
        provisional: true,
      })
    );
    const completedEvents: TimelinePlacementEvent[] = recordedEventsRef.current.map((event) => ({ ...event }));
    const timelineEvents = normalizeTimelineEvents([...completedEvents, ...activeEvents]);
    const normalizedTotalBeats = normalizeNotatableBeats(recordedTotalBeats);

    const draft = cloneComposition(preRecordCompositionRef.current);
    const cursor = applyTimelineToDraftAcrossVoices(
      draft,
      { ...realtimeStartCursorRef.current },
      timelineEvents,
      normalizedTotalBeats
    );

    setComposition(draft);
    provisionalCursorRef.current = cursor;
    provisionalElapsedBeatsRef.current = normalizedTotalBeats;
    const activeMeasureIndex = cursor.beatInMeasure <= EPSILON ? Math.max(0, cursor.measureIndex - 1) : cursor.measureIndex;
    setSelectedStaffIndex(cursor.staffIndex);
    setSelectedMeasureIndex(cursor.measureIndex);
    emitMidiFollowMeasure(cursor.staffIndex, activeMeasureIndex);
  };

  const commitRecordedEvents = (
    events: RecordedNoteEvent[],
    recordedTotalBeats = 0,
    startCursorOverride: CursorState | null = null
  ) => {
    if (!composition) return;
    let normalizedTotalBeats = normalizeNotatableBeats(Math.max(0, recordedTotalBeats));
    let cursor = startCursorOverride ? { ...startCursorOverride } : ensureCursor();
    if (events.length === 0) {
      if (normalizedTotalBeats <= EPSILON) return;
      cursor = appendRest(cursor, normalizedTotalBeats);
      stepCursorRef.current = cursor;
      setSelectedStaffIndex(cursor.staffIndex);
      setSelectedMeasureIndex(cursor.measureIndex);
      emitMidiFollowMeasure(cursor.staffIndex, Math.max(0, cursor.measureIndex - 1));
      return;
    }
    let filtered = normalizeTimelineEvents(events);
    if (filtered.length === 0) return;

    if (autoPickupEnabled && cursor.measureIndex === 0) {
      const firstStart = filtered[0]?.startBeats ?? 0;
      const measureBeats = getMeasureCapacityQuarterBeats(0);
      if (firstStart > EPSILON && firstStart < measureBeats - EPSILON) {
        const offsetInBar = firstStart % measureBeats;
        const pickupBeats = Math.max(MIN_NOTATABLE_BEATS, measureBeats - offsetInBar);
        const normalizedPickup = normalizeNotatableBeats(pickupBeats);
        setAnacrusis(true, Math.max(1, Math.round(normalizedPickup)));
        filtered = filtered.map((event) => ({
          ...event,
          startBeats: Math.max(0, event.startBeats - firstStart),
        }));
        normalizedTotalBeats = Math.max(0, normalizedTotalBeats - firstStart);
      }
    }

    cursor = applyTimelineToLiveAcrossVoices(cursor, filtered, normalizedTotalBeats);
    const lastEvent = filtered[filtered.length - 1];
    if (lastEvent) {
      setLastCapturedPitch(midiToPitch(clampMidi(lastEvent.midi)));
    }

    stepCursorRef.current = cursor;
    setSelectedStaffIndex(cursor.staffIndex);
    setSelectedMeasureIndex(cursor.measureIndex);
    emitMidiFollowMeasure(cursor.staffIndex, Math.max(0, cursor.measureIndex - 1));
  };

  const stopRealtimeRecording = () => {
    if (recordArmTimeoutRef.current) {
      window.clearTimeout(recordArmTimeoutRef.current);
      recordArmTimeoutRef.current = null;
    }
    if (recordCountdownTimerRef.current) {
      window.clearInterval(recordCountdownTimerRef.current);
      recordCountdownTimerRef.current = null;
    }
    if (recordElapsedTimerRef.current) {
      window.clearInterval(recordElapsedTimerRef.current);
      recordElapsedTimerRef.current = null;
    }
    if (recordClickTimerRef.current) {
      window.clearInterval(recordClickTimerRef.current);
      recordClickTimerRef.current = null;
    }
    if (realtimeVisualTimerRef.current) {
      window.clearInterval(realtimeVisualTimerRef.current);
      realtimeVisualTimerRef.current = null;
    }
    lastRecordClickAtSecRef.current = 0;
    setIsRecordArming(false);
    setIsRecordPaused(false);
    setRecordCountdownMs(0);
    setRecordElapsedMs(0);

    if (!isRecording) {
      provisionalRealtimeNotesRef.current.clear();
      provisionalCursorRef.current = null;
      provisionalElapsedBeatsRef.current = 0;
      realtimeSilencePreviewRef.current = null;
      realtimeStartCursorRef.current = null;
      preRecordCompositionRef.current = null;
      return;
    }
    const startMs = recordStartMsRef.current;
    let recordedTotalBeats = 0;
    if (startMs !== null && composition) {
      const now = recordPauseStartedAtRef.current ?? performance.now();
      const secondsPerBeat = 60 / composition.tempo;
      recordedTotalBeats = Math.max(0, (now - startMs) / 1000 / secondsPerBeat);
      realtimeActiveNotesRef.current.forEach((active, midi) => {
        const startBeats = (active.startedAtMs - startMs) / 1000 / secondsPerBeat;
        const durationBeats = Math.max(0.05, (now - active.startedAtMs) / 1000 / secondsPerBeat);
        recordedEventsRef.current.push({
          midi,
          startBeats,
          durationBeats,
          velocity: active.velocity,
        });
      });
    }

    realtimeActiveNotesRef.current.clear();
    setIsRecording(false);
    const snapshot = [...recordedEventsRef.current];
    recordedEventsRef.current = [];
    recordStartMsRef.current = null;
    recordPauseStartedAtRef.current = null;
    provisionalRealtimeNotesRef.current.clear();
    provisionalCursorRef.current = null;
    provisionalElapsedBeatsRef.current = 0;
    realtimeSilencePreviewRef.current = null;
    if (preRecordCompositionRef.current) {
      syncPreRecordStructureFromCurrent();
      setComposition(cloneComposition(preRecordCompositionRef.current));
      preRecordCompositionRef.current = null;
    }
    commitRecordedEvents(snapshot, recordedTotalBeats, realtimeStartCursorRef.current);
    realtimeStartCursorRef.current = null;
  };

  const triggerRecordClick = (accent: boolean, scheduledSec?: number) => {
    if (!recordClickSynthRef.current) {
      recordClickSynthRef.current = new Tone.Synth({
        oscillator: { type: 'square' },
        envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 },
      }).toDestination();
    }
    const synth = recordClickSynthRef.current;
    const freq = accent ? 1320 : 980;
    const vel = accent ? 0.85 : 0.65;
    const nowSec = Tone.now();
    const base = scheduledSec ?? nowSec + 0.002;
    const safeAt = Math.max(base, nowSec + 0.0015, lastRecordClickAtSecRef.current + 0.0006);
    try {
      synth.triggerAttackRelease(freq, 0.045, safeAt, vel);
      lastRecordClickAtSecRef.current = safeAt;
    } catch {
      // Retry once with a slightly later timestamp so UI never crashes on scheduler edge cases.
      const retryAt = Math.max(Tone.now() + 0.004, lastRecordClickAtSecRef.current + 0.001);
      synth.triggerAttackRelease(freq, 0.045, retryAt, vel);
      lastRecordClickAtSecRef.current = retryAt;
    }
  };

  const startRecordClickTrack = () => {
    if (!recordClickEnabled || !composition) return;
    if (recordClickTimerRef.current) {
      window.clearInterval(recordClickTimerRef.current);
      recordClickTimerRef.current = null;
    }

    const tempo = Math.max(1, getEffectiveTempoForMeasure(selectedMeasureIndex));
    const beatMs = 60000 / tempo;
    const beatsPerBar = Math.max(1, Math.round(getMeasureCapacityQuarterBeats(selectedMeasureIndex)));
    recordClickBeatIndexRef.current = 0;
    recordClickNextAtMsRef.current = performance.now();
    void Tone.start().catch(() => {});

    const tick = () => {
      const now = performance.now();
      while (now + 5 >= recordClickNextAtMsRef.current) {
        const beatIndex = recordClickBeatIndexRef.current;
        const accent = beatIndex % beatsPerBar === 0;
        const delayMs = Math.max(0, recordClickNextAtMsRef.current - now);
        const scheduleAtSec = Tone.now() + delayMs / 1000;
        triggerRecordClick(accent, scheduleAtSec);
        recordClickBeatIndexRef.current += 1;
        recordClickNextAtMsRef.current += beatMs;
      }
    };

    tick();
    recordClickTimerRef.current = window.setInterval(tick, 25);
  };

  const prepareRealtimeRecording = async () => {
    if (!composition) return;
    setIsPreparingRecord(true);
    try {
      // Ensure the audio context is running before arming to avoid first-note lag.
      await Tone.start();
      // Preload score instruments so held preview and capture respond immediately.
      await sharedScheduler.preloadInstruments(composition, false);
      // Warm up the current target staff instrument with a near-silent ping.
      const cursor = stepCursorRef.current ?? ensureCursor();
      const instrument = composition.staves[cursor.staffIndex]?.instrument ?? 'piano';
      const warmId = await sharedScheduler.startHeldPreview('C4', instrument, composition.keySignature);
      sharedScheduler.stopHeldPreview(warmId);
    } finally {
      setIsPreparingRecord(false);
    }
  };

  const clearStepChordPending = () => {
    if (stepChordFlushTimerRef.current) {
      window.clearTimeout(stepChordFlushTimerRef.current);
      stepChordFlushTimerRef.current = null;
    }
    stepChordPendingNotesRef.current.clear();
    stepChordDownAtMsRef.current.clear();
  };

  const getStepChordWindowMs = (): number => {
    if (!composition) return 40;
    const cursor = stepCursorRef.current ?? ensureCursor();
    const tempo = Math.max(1, getEffectiveTempoForMeasure(cursor.measureIndex));
    const seconds = (chordOnsetWindowBeats * 60) / tempo;
    return Math.max(12, Math.round(seconds * 1000));
  };

  const saveKeyboardInputEnabled = (enabled: boolean) => {
    setKeyboardInputEnabled(enabled);
    try {
      localStorage.setItem(KEYBOARD_INPUT_ENABLED_LS_KEY, enabled ? '1' : '0');
    } catch {
      // ignore local storage failures
    }
  };

  const saveKeyboardMapping = (next: KeyboardMapping) => {
    setKeyboardMapping(next);
    try {
      localStorage.setItem(KEYBOARD_MAPPING_LS_KEY, JSON.stringify(next));
    } catch {
      // ignore local storage failures
    }
  };

  const rebindKeyboardMidi = (targetMidi: number, nextCode: string) => {
    if (!isEditableKeyboardCode(nextCode)) return;
    const normalizedCode = nextCode;
    const nextMapping: KeyboardMapping = {};
    Object.entries(keyboardMapping).forEach(([code, midi]) => {
      if (code === normalizedCode) return;
      if (midi === targetMidi) return;
      nextMapping[code] = midi;
    });
    nextMapping[normalizedCode] = clampMidi(targetMidi);
    saveKeyboardMapping(nextMapping);
  };

  const resetKeyboardMapping = () => {
    saveKeyboardMapping({ ...DEFAULT_KEYBOARD_MAPPING });
    setRebindMidi(null);
  };

  const handleStepInputNoteOnAtCursor = (midi: number, cursor: CursorState): CursorState => {
    if (!composition) return cursor;
    const safeMidi = clampMidi(midi);
    const durationBeats = durationToBeats(selectedDuration);
    const nextCursor = appendNote(cursor, safeMidi, durationBeats);
    setLastCapturedPitch(midiToPitch(safeMidi));
    return nextCursor;
  };

  const handleAdaptiveStepInputNoteOnAtCursor = (
    midi: number,
    cursor: CursorState,
    startedAtMs: number
  ): ActiveStepHoldNote | null => {
    if (!composition) return null;
    let workingCursor = { ...cursor };
    const cursorCapacity = getMeasureCapacityQuarterBeats(workingCursor.measureIndex);
    if (workingCursor.beatInMeasure >= cursorCapacity - EPSILON) {
      workingCursor = { ...workingCursor, measureIndex: workingCursor.measureIndex + 1, beatInMeasure: 0 };
      ensureMeasureExists(workingCursor.staffIndex, workingCursor.measureIndex);
    }
    const safeMidi = clampMidi(midi);
    const pitch = midiToPitch(safeMidi);
    let insertedNoteIndex: number | null = null;

    updateCompositionTransient((draft) => {
      ensureTransientMeasure(draft, workingCursor.staffIndex, workingCursor.measureIndex);
      const voice = draft.staves[workingCursor.staffIndex].measures[workingCursor.measureIndex].voices[workingCursor.voiceIndex];
      const noteIndex = voice.notes.length;
      voice.notes.push({ pitch, duration: 'thirty-second', provisional: true });
      insertedNoteIndex = noteIndex;
      return true;
    });

    if (insertedNoteIndex === null) return null;

    const measureCapacity = getMeasureCapacityQuarterBeats(workingCursor.measureIndex);
    let nextCursor = { ...workingCursor, beatInMeasure: workingCursor.beatInMeasure + MIN_NOTATABLE_BEATS };
    if (nextCursor.beatInMeasure >= measureCapacity - EPSILON) {
      nextCursor = { ...nextCursor, measureIndex: nextCursor.measureIndex + 1, beatInMeasure: 0 };
    }

    return {
      startedAtMs,
      startMeasureIndex: workingCursor.measureIndex,
      startBeatInMeasure: workingCursor.beatInMeasure,
      staffIndex: workingCursor.staffIndex,
      measureIndex: workingCursor.measureIndex,
      voiceIndex: workingCursor.voiceIndex,
      noteIndex: insertedNoteIndex,
      provisionalSegments: [{
        staffIndex: workingCursor.staffIndex,
        measureIndex: workingCursor.measureIndex,
        voiceIndex: workingCursor.voiceIndex,
        noteIndex: insertedNoteIndex,
      }],
      lastPreviewBeats: MIN_NOTATABLE_BEATS,
    };
  };

  const flushStepChordGroup = () => {
    if (mode !== 'step' || isReadOnly || !composition) {
      clearStepChordPending();
      return;
    }
    if (stepChordFlushTimerRef.current) {
      window.clearTimeout(stepChordFlushTimerRef.current);
      stepChordFlushTimerRef.current = null;
    }
    const pending = Array.from(stepChordPendingNotesRef.current);
    stepChordPendingNotesRef.current.clear();
    if (pending.length === 0) return;

    const notes = pending.sort((a, b) => a - b);
    const baseCursor = stepCursorRef.current ?? ensureCursor();
    const voices = getVoicePriorityOrder(baseCursor.voiceIndex).slice(0, MIDI_MAX_CHORD_VOICES);
    let baseNextCursor = { ...baseCursor };

    const usableCount = Math.min(notes.length, voices.length);
    for (let i = 0; i < usableCount; i++) {
      const midi = notes[i];
      const voiceIndex = voices[i];
      const laneCursor: CursorState = {
        ...baseCursor,
        voiceIndex,
      };
      if (!adaptiveStepEnabled) {
        const laneNext = handleStepInputNoteOnAtCursor(midi, laneCursor);
        if (voiceIndex === baseCursor.voiceIndex) {
          baseNextCursor = laneNext;
        }
        activeStepHeldNotesRef.current.set(midi, {
          startedAtMs: null,
          startMeasureIndex: laneCursor.measureIndex,
          startBeatInMeasure: laneCursor.beatInMeasure,
          staffIndex: laneCursor.staffIndex,
          measureIndex: laneCursor.measureIndex,
          voiceIndex: laneCursor.voiceIndex,
        });
        continue;
      }

      const startedAtMs = stepChordDownAtMsRef.current.get(midi) ?? performance.now();
      const insertedHold = handleAdaptiveStepInputNoteOnAtCursor(midi, laneCursor, startedAtMs);
      activeStepHeldNotesRef.current.set(
        midi,
        insertedHold ?? {
          startedAtMs,
          startMeasureIndex: laneCursor.measureIndex,
          startBeatInMeasure: laneCursor.beatInMeasure,
          staffIndex: laneCursor.staffIndex,
          measureIndex: laneCursor.measureIndex,
          voiceIndex: laneCursor.voiceIndex,
          lastPreviewBeats: MIN_NOTATABLE_BEATS,
        }
      );
      if (voiceIndex === baseCursor.voiceIndex && insertedHold) {
        const measureCapacity = getMeasureCapacityQuarterBeats(insertedHold.measureIndex ?? laneCursor.measureIndex);
        let laneNext: CursorState = {
          staffIndex: insertedHold.staffIndex ?? laneCursor.staffIndex,
          measureIndex: insertedHold.measureIndex ?? laneCursor.measureIndex,
          voiceIndex: insertedHold.voiceIndex ?? laneCursor.voiceIndex,
          beatInMeasure: (insertedHold.startBeatInMeasure ?? laneCursor.beatInMeasure) + MIN_NOTATABLE_BEATS,
        };
        if (laneNext.beatInMeasure >= measureCapacity - EPSILON) {
          laneNext = { ...laneNext, measureIndex: laneNext.measureIndex + 1, beatInMeasure: 0 };
        }
        baseNextCursor = laneNext;
      }
    }

    if (notes.length > 0) {
      setLastCapturedPitch(midiToPitch(clampMidi(notes[notes.length - 1])));
    }
    stepCursorRef.current = baseNextCursor;
    setSelectedStaffIndex(baseNextCursor.staffIndex);
    setSelectedMeasureIndex(baseNextCursor.measureIndex);
    emitMidiFollowMeasure(baseNextCursor.staffIndex, baseNextCursor.measureIndex);
    notes.forEach((midi) => stepChordDownAtMsRef.current.delete(midi));
  };

  const handleStepInputNoteOn = (midi: number) => {
    if (!composition) return;
    const cursor = stepCursorRef.current ?? ensureCursor();
    const nextCursor = handleStepInputNoteOnAtCursor(midi, cursor);
    stepCursorRef.current = nextCursor;
    setSelectedStaffIndex(nextCursor.staffIndex);
    setSelectedMeasureIndex(nextCursor.measureIndex);
    emitMidiFollowMeasure(nextCursor.staffIndex, nextCursor.measureIndex);
  };

  const handleAdaptiveStepInputNoteOn = (midi: number): ActiveStepHoldNote | null => {
    if (!composition) return null;
    const cursor = stepCursorRef.current ?? ensureCursor();
    const inserted = handleAdaptiveStepInputNoteOnAtCursor(midi, cursor, performance.now());
    if (!inserted) return null;
    const measureCapacity = getMeasureCapacityQuarterBeats(inserted.measureIndex ?? cursor.measureIndex);
    let nextCursor: CursorState = {
      staffIndex: inserted.staffIndex ?? cursor.staffIndex,
      measureIndex: inserted.measureIndex ?? cursor.measureIndex,
      voiceIndex: inserted.voiceIndex ?? cursor.voiceIndex,
      beatInMeasure: (inserted.startBeatInMeasure ?? cursor.beatInMeasure) + MIN_NOTATABLE_BEATS,
    };
    if (nextCursor.beatInMeasure >= measureCapacity - EPSILON) {
      nextCursor = { ...nextCursor, measureIndex: nextCursor.measureIndex + 1, beatInMeasure: 0 };
    }
    stepCursorRef.current = nextCursor;
    setLastCapturedPitch(midiToPitch(clampMidi(midi)));
    setSelectedStaffIndex(nextCursor.staffIndex);
    setSelectedMeasureIndex(nextCursor.measureIndex);
    emitMidiFollowMeasure(nextCursor.staffIndex, nextCursor.measureIndex);
    return inserted;
  };

  const handleAdaptiveStepInputNoteUp = (midi: number, hold: ActiveStepHoldNote, holdMs: number) => {
    if (!composition) return;
    const safeMidi = clampMidi(midi);
    const beatsFromHold = holdMsToQuarterBeats(holdMs, hold.startMeasureIndex);
    const normalizedBeats = normalizeNotatableBeats(beatsFromHold);
    const fallbackCursor = stepCursorRef.current ?? ensureCursor();
    const startCursor: CursorState = {
      staffIndex: hold.staffIndex ?? fallbackCursor.staffIndex,
      measureIndex: hold.measureIndex ?? hold.startMeasureIndex,
      voiceIndex: hold.voiceIndex ?? fallbackCursor.voiceIndex,
      beatInMeasure: Math.max(0, hold.startBeatInMeasure ?? 0),
    };

    const provisionalSegments =
      hold.provisionalSegments && hold.provisionalSegments.length > 0
        ? hold.provisionalSegments
        : hold.staffIndex !== undefined && hold.measureIndex !== undefined && hold.voiceIndex !== undefined && hold.noteIndex !== undefined
        ? [{
            staffIndex: hold.staffIndex,
            measureIndex: hold.measureIndex,
            voiceIndex: hold.voiceIndex,
            noteIndex: hold.noteIndex,
          }]
        : [];
    if (provisionalSegments.length > 0) {
      updateCompositionTransient((draft) => removeProvisionalSegmentsFromDraft(draft, provisionalSegments));
    }

    const nextCursor = appendNote(startCursor, safeMidi, normalizedBeats);
    stepCursorRef.current = nextCursor;
    setLastCapturedPitch(midiToPitch(safeMidi));
    setSelectedStaffIndex(nextCursor.staffIndex);
    setSelectedMeasureIndex(nextCursor.measureIndex);
    emitMidiFollowMeasure(nextCursor.staffIndex, nextCursor.measureIndex);
  };

  const handleRealtimeNoteOn = (midi: number, velocity: number) => {
    if (!isRecording || isRecordPaused || isRecordArming || !composition) return;
    if (recordStartMsRef.current === null) {
      recordStartMsRef.current = performance.now();
    }
    if (!realtimeActiveNotesRef.current.has(midi)) {
      realtimeActiveNotesRef.current.set(midi, { startedAtMs: performance.now(), velocity });
    }
    realtimeSilencePreviewRef.current = null;
    setLastCapturedPitch(midiToPitch(clampMidi(midi)));
    if (!provisionalRealtimeNotesRef.current.has(midi)) {
      const startCursor = realtimeStartCursorRef.current ?? ensureCursor();
      provisionalRealtimeNotesRef.current.set(midi, {
        staffIndex: startCursor.staffIndex,
        measureIndex: startCursor.measureIndex,
        voiceIndex: startCursor.voiceIndex,
        noteIndex: 0,
        startedAtMs: performance.now(),
        startMeasureIndex: startCursor.measureIndex,
        startBeatInMeasure: startCursor.beatInMeasure,
        provisionalSegments: [],
        lastPreviewBeats: 0,
      });
    }
  };

  const handleRealtimeNoteOff = (midi: number) => {
    if (!isRecording || isRecordPaused || isRecordArming || !composition) return;
    const active = realtimeActiveNotesRef.current.get(midi);
    const startMs = recordStartMsRef.current;
    if (!active || startMs === null) return;
    const now = performance.now();
    const secondsPerBeat = 60 / composition.tempo;
    const startBeats = (active.startedAtMs - startMs) / 1000 / secondsPerBeat;
    const durationBeats = Math.max(0.05, (now - active.startedAtMs) / 1000 / secondsPerBeat);
    recordedEventsRef.current.push({
      midi,
      startBeats,
      durationBeats,
      velocity: active.velocity,
    });
    realtimeActiveNotesRef.current.delete(midi);
    provisionalRealtimeNotesRef.current.delete(midi);
  };

  const extendRealtimeSilencePreview = (_nowMs: number) => {};

  const startHeldPreviewForMidi = (midi: number) => {
    if (!composition) return;
    if (activePreviewIdsRef.current.has(midi)) return;
    const safeMidi = clampMidi(midi);
    const staffIndex = isReadOnly
      ? composition.staves[selectedStaffIndex]
        ? selectedStaffIndex
        : 0
      : (stepCursorRef.current ?? ensureCursor()).staffIndex;
    const instrument = composition.staves[staffIndex]?.instrument ?? 'piano';
    void sharedScheduler
      .startHeldPreview(midiToPitch(safeMidi), instrument, composition.keySignature)
      .then((id) => {
        if (id) {
          activePreviewIdsRef.current.set(midi, id);
        }
      });
  };

  const stopHeldPreviewForMidi = (midi: number) => {
    const previewId = activePreviewIdsRef.current.get(midi);
    if (!previewId) return;
    sharedScheduler.stopHeldPreview(previewId);
    activePreviewIdsRef.current.delete(midi);
  };

  const stopAllHeldPreviewNotes = () => {
    activePreviewIdsRef.current.forEach((id) => {
      sharedScheduler.stopHeldPreview(id);
    });
    activePreviewIdsRef.current.clear();
  };

  const handleMidiNoteOn = (midi: number, velocity: number) => {
    if (activePreviewIdsRef.current.has(midi)) {
      stopHeldPreviewForMidi(midi);
    }
    triggerKeyRetrigger(midi);
    startHeldPreviewForMidi(midi);
    setLastCapturedPitch(midiToPitch(clampMidi(midi)));
    if (isReadOnly) return;
    if (mode === 'step') {
      if (activeStepHeldNotesRef.current.has(midi)) return;
      const downAt = performance.now();
      stepChordDownAtMsRef.current.set(midi, downAt);
      activeStepHeldNotesRef.current.set(midi, {
        startedAtMs: adaptiveStepEnabled ? downAt : null,
        startMeasureIndex: (stepCursorRef.current ?? ensureCursor()).measureIndex,
        lastPreviewBeats: adaptiveStepEnabled ? MIN_NOTATABLE_BEATS : undefined,
      });
      stepChordPendingNotesRef.current.add(midi);
      if (chordOnsetWindowBeats <= EPSILON) {
        flushStepChordGroup();
        return;
      }
      if (!stepChordFlushTimerRef.current) {
        stepChordFlushTimerRef.current = window.setTimeout(() => {
          stepChordFlushTimerRef.current = null;
          flushStepChordGroup();
        }, getStepChordWindowMs());
      }
      return;
    }
    handleRealtimeNoteOn(midi, velocity);
  };

  const handleMidiNoteOff = (midi: number) => {
    stopHeldPreviewForMidi(midi);
    if (mode === 'step') {
      if (stepChordPendingNotesRef.current.has(midi)) {
        flushStepChordGroup();
      }
      const hold = activeStepHeldNotesRef.current.get(midi);
      activeStepHeldNotesRef.current.delete(midi);
      stepChordDownAtMsRef.current.delete(midi);
      if (hold?.startedAtMs) {
        const holdMs = Math.max(1, performance.now() - hold.startedAtMs);
        handleAdaptiveStepInputNoteUp(midi, hold, holdMs);
      }
      return;
    }
    handleRealtimeNoteOff(midi);
  };

  const finalizeAdaptiveStepHolds = () => {
    flushStepChordGroup();
    const active = Array.from(activeStepHeldNotesRef.current.entries());
    if (active.length === 0) return;
    active.forEach(([midi, hold]) => {
      if (!hold.startedAtMs) return;
      const holdMs = Math.max(1, performance.now() - hold.startedAtMs);
      handleAdaptiveStepInputNoteUp(midi, hold, holdMs);
    });
    activeStepHeldNotesRef.current.clear();
  };

  useEffect(() => {
    if (isReadOnly) {
      clearStepChordPending();
      if (isRecording || isRecordArming) stopRealtimeRecording();
      finalizeAdaptiveStepHolds();
      stopAllHeldPreviewNotes();
      return;
    }
  }, [isReadOnly, isRecordArming, isRecording]);

  useEffect(() => {
    clearStepChordPending();
    if (mode !== 'realtime' && (isRecording || isRecordArming)) {
      stopRealtimeRecording();
    }
    finalizeAdaptiveStepHolds();
    stopAllHeldPreviewNotes();
    setAdaptiveHoldLabels([]);
  }, [mode, isRecordArming, isRecording]);

  useEffect(() => {
    if (mode !== 'step' || adaptiveStepEnabled) return;
    finalizeAdaptiveStepHolds();
    setAdaptiveHoldLabels((prev) => (prev.length === 0 ? prev : []));
  }, [adaptiveStepEnabled, mode]);

  useEffect(() => {
    if (mode !== 'step' || !adaptiveStepEnabled || isReadOnly) {
      setAdaptiveHoldLabels((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const updateAdaptiveLabels = () => {
      const now = performance.now();
      const activeEntries = Array.from(activeStepHeldNotesRef.current.entries());
      const labels = activeEntries
        .map(([midi, hold]) => {
          if (!hold.startedAtMs) return null;
          const heldMs = Math.max(1, now - hold.startedAtMs);
          const heldBeats = normalizeNotatableBeats(holdMsToQuarterBeats(heldMs, hold.startMeasureIndex));
          const duration = mapHoldBeatsToDuration(heldBeats);
          return `${midiToPitch(clampMidi(midi))}: ${duration}`;
        })
        .filter((label): label is string => Boolean(label));
      setAdaptiveHoldLabels(labels);
      activeEntries.forEach(([midi, hold]) => {
        if (!hold.startedAtMs) return;
        const heldMs = Math.max(1, now - hold.startedAtMs);
        const heldBeatsRaw = holdMsToQuarterBeats(heldMs, hold.startMeasureIndex);
        const heldBeats = normalizeNotatableBeats(heldBeatsRaw);
        if (hold.lastPreviewBeats !== undefined && Math.abs(heldBeats - hold.lastPreviewBeats) < EPSILON) {
          return;
        }
        rebuildAdaptiveProvisionalHold(midi, hold, heldBeats);
        hold.lastPreviewBeats = heldBeats;
      });
    };

    updateAdaptiveLabels();
    const timer = window.setInterval(updateAdaptiveLabels, 70);
    return () => window.clearInterval(timer);
  }, [mode, adaptiveStepEnabled, isReadOnly, quantization]);

  useEffect(() => {
    return () => {
      clearStepChordPending();
    };
  }, []);

  useEffect(() => {
    const enableGlobalTouchGestureLock = () => {
      if (globalTouchLockRestoreRef.current || typeof document === 'undefined') return;
      const html = document.documentElement;
      const body = document.body;
      const prevHtmlTouchAction = html.style.touchAction;
      const prevBodyTouchAction = body.style.touchAction;
      const prevHtmlOverscroll = html.style.overscrollBehavior;
      const prevBodyOverscroll = body.style.overscrollBehavior;
      const bodyStyle = body.style as CSSStyleDeclaration & { WebkitTouchCallout?: string; msTouchAction?: string };
      const htmlStyle = html.style as CSSStyleDeclaration & { msTouchAction?: string };
      const prevBodyCallout = bodyStyle.WebkitTouchCallout ?? '';

      html.style.touchAction = 'none';
      body.style.touchAction = 'none';
      html.style.overscrollBehavior = 'none';
      body.style.overscrollBehavior = 'none';
      bodyStyle.WebkitTouchCallout = 'none';
      htmlStyle.msTouchAction = 'none';
      bodyStyle.msTouchAction = 'none';

      globalTouchLockRestoreRef.current = () => {
        html.style.touchAction = prevHtmlTouchAction;
        body.style.touchAction = prevBodyTouchAction;
        html.style.overscrollBehavior = prevHtmlOverscroll;
        body.style.overscrollBehavior = prevBodyOverscroll;
        bodyStyle.WebkitTouchCallout = prevBodyCallout;
        htmlStyle.msTouchAction = '';
        bodyStyle.msTouchAction = '';
      };
    };

    const disableGlobalTouchGestureLock = () => {
      if (!globalTouchLockRestoreRef.current) return;
      globalTouchLockRestoreRef.current();
      globalTouchLockRestoreRef.current = null;
    };

    const attachMultiTouchGuard = (element: HTMLDivElement | null) => {
      if (!element) return () => {};
      const blockThreeFingerTouch = (event: TouchEvent) => {
        if (event.touches.length >= 3 && event.cancelable) {
          event.preventDefault();
        }
      };
      const blockGesture = (event: Event) => {
        if ((event as { cancelable?: boolean }).cancelable) {
          event.preventDefault();
        }
      };
      element.addEventListener('touchstart', blockThreeFingerTouch, { passive: false, capture: true });
      element.addEventListener('touchmove', blockThreeFingerTouch, { passive: false, capture: true });
      element.addEventListener('touchend', blockThreeFingerTouch, { passive: false, capture: true });
      // iOS Safari gesture events (non-standard), guarded as Event for TS compatibility.
      element.addEventListener('gesturestart', blockGesture as EventListener, { passive: false, capture: true } as AddEventListenerOptions);
      element.addEventListener('gesturechange', blockGesture as EventListener, { passive: false, capture: true } as AddEventListenerOptions);
      element.addEventListener('gestureend', blockGesture as EventListener, { passive: false, capture: true } as AddEventListenerOptions);

      return () => {
        element.removeEventListener('touchstart', blockThreeFingerTouch, { capture: true } as EventListenerOptions);
        element.removeEventListener('touchmove', blockThreeFingerTouch, { capture: true } as EventListenerOptions);
        element.removeEventListener('touchend', blockThreeFingerTouch, { capture: true } as EventListenerOptions);
        element.removeEventListener('gesturestart', blockGesture as EventListener, { capture: true } as EventListenerOptions);
        element.removeEventListener('gesturechange', blockGesture as EventListener, { capture: true } as EventListenerOptions);
        element.removeEventListener('gestureend', blockGesture as EventListener, { capture: true } as EventListenerOptions);
      };
    };

    const isInsideAnyPiano = (target: EventTarget | null): boolean => {
      if (!(target instanceof Node)) return false;
      const inline = inlinePianoScrollRef.current;
      const fullscreen = fullscreenPianoScrollRef.current;
      return Boolean((inline && inline.contains(target)) || (fullscreen && fullscreen.contains(target)));
    };

    const handleGlobalTouchStartCapture = (event: TouchEvent) => {
      if (isInsideAnyPiano(event.target) && event.touches.length > 0) {
        pianoTouchCaptureActiveRef.current = true;
        enableGlobalTouchGestureLock();
      }
      if (pianoTouchCaptureActiveRef.current && event.touches.length >= 3 && event.cancelable) {
        event.preventDefault();
      }
    };

    const handleGlobalTouchMoveCapture = (event: TouchEvent) => {
      if (!pianoTouchCaptureActiveRef.current) return;
      if (event.touches.length >= 3 && event.cancelable) {
        event.preventDefault();
      }
    };

    const handleGlobalTouchEndCapture = (event: TouchEvent) => {
      if (!pianoTouchCaptureActiveRef.current) return;
      if (event.touches.length === 0) {
        pianoTouchCaptureActiveRef.current = false;
        disableGlobalTouchGestureLock();
      } else if (event.touches.length >= 3 && event.cancelable) {
        event.preventDefault();
      }
    };

    const handleGlobalGestureCapture = (event: Event) => {
      if (!pianoTouchCaptureActiveRef.current) return;
      if ((event as { cancelable?: boolean }).cancelable) {
        event.preventDefault();
      }
    };

    const cleanupInline = attachMultiTouchGuard(inlinePianoScrollRef.current);
    const cleanupFullscreen = attachMultiTouchGuard(fullscreenPianoScrollRef.current);
    window.addEventListener('touchstart', handleGlobalTouchStartCapture, { passive: false, capture: true });
    window.addEventListener('touchmove', handleGlobalTouchMoveCapture, { passive: false, capture: true });
    window.addEventListener('touchend', handleGlobalTouchEndCapture, { passive: false, capture: true });
    window.addEventListener('touchcancel', handleGlobalTouchEndCapture, { passive: false, capture: true });
    window.addEventListener('gesturestart', handleGlobalGestureCapture as EventListener, { passive: false, capture: true } as AddEventListenerOptions);
    window.addEventListener('gesturechange', handleGlobalGestureCapture as EventListener, { passive: false, capture: true } as AddEventListenerOptions);
    window.addEventListener('gestureend', handleGlobalGestureCapture as EventListener, { passive: false, capture: true } as AddEventListenerOptions);
    return () => {
      cleanupInline();
      cleanupFullscreen();
      pianoTouchCaptureActiveRef.current = false;
      disableGlobalTouchGestureLock();
      window.removeEventListener('touchstart', handleGlobalTouchStartCapture, { capture: true } as EventListenerOptions);
      window.removeEventListener('touchmove', handleGlobalTouchMoveCapture, { capture: true } as EventListenerOptions);
      window.removeEventListener('touchend', handleGlobalTouchEndCapture, { capture: true } as EventListenerOptions);
      window.removeEventListener('touchcancel', handleGlobalTouchEndCapture, { capture: true } as EventListenerOptions);
      window.removeEventListener('gesturestart', handleGlobalGestureCapture as EventListener, { capture: true } as EventListenerOptions);
      window.removeEventListener('gesturechange', handleGlobalGestureCapture as EventListener, { capture: true } as EventListenerOptions);
      window.removeEventListener('gestureend', handleGlobalGestureCapture as EventListener, { capture: true } as EventListenerOptions);
    };
  }, [isCollapsed, pianoFullscreen, pianoViewMode]);

  useEffect(() => {
    if (!midiSupported) {
      setStatusText('Web MIDI not supported in this browser');
      return;
    }

    let cancelled = false;
    const navigatorAny = navigator as unknown as { requestMIDIAccess?: () => Promise<any> };
    if (!navigatorAny.requestMIDIAccess) {
      setMidiSupported(false);
      setStatusText('Web MIDI not supported in this browser');
      return;
    }

    const refreshInputs = (access: any) => {
      const list = Array.from(access.inputs.values()).map((input: any) => ({
        id: String(input.id ?? ''),
        name: String(input.name ?? 'MIDI Input'),
      }));
      setMidiInputs(list);
      if (list.length > 0) {
        setStatusText(`${list.length} MIDI input${list.length > 1 ? 's' : ''} connected`);
      } else {
        setStatusText('No MIDI device detected - use virtual piano');
      }
    };

    const onMidiMessage = (event: any) => {
      const data: Uint8Array | undefined = event?.data;
      if (!data || data.length < 2) return;
      const status = data[0] & 0xf0;
      const note = data[1];
      const velocity = (data[2] ?? 0) / 127;

      if (status === 0x90 && data[2] > 0) {
        handleMidiNoteOn(note, velocity);
        return;
      }
      if (status === 0x80 || (status === 0x90 && data[2] === 0)) {
        handleMidiNoteOff(note);
      }
    };

    const bindInputs = (access: any) => {
      access.inputs.forEach((input: any) => {
        input.onmidimessage = onMidiMessage;
      });
    };

    navigatorAny
      .requestMIDIAccess()
      .then((access) => {
        if (cancelled) return;
        midiAccessRef.current = access;
        refreshInputs(access);
        bindInputs(access);
        access.onstatechange = () => {
          refreshInputs(access);
          bindInputs(access);
        };
      })
      .catch(() => {
        if (cancelled) return;
        setStatusText('MIDI permission denied - use virtual piano');
      });

    return () => {
      cancelled = true;
      const access = midiAccessRef.current;
      if (access) {
        access.inputs.forEach((input: any) => {
          input.onmidimessage = null;
        });
        access.onstatechange = null;
      }
      midiAccessRef.current = null;
    };
  }, [midiSupported, mode, isReadOnly, isRecording, composition, selectedDuration]);

  const startRealtimeRecording = () => {
    if (isReadOnly || !composition) return;
    recordArmingActionRef.current = 'start';
    recordedEventsRef.current = [];
    realtimeActiveNotesRef.current.clear();
    provisionalRealtimeNotesRef.current.clear();
    realtimeSilencePreviewRef.current = null;
    preRecordCompositionRef.current = cloneComposition(useScoreStore.getState().composition as Composition);
    const startCursor = ensureCursor();
    realtimeStartCursorRef.current = { ...startCursor };
    provisionalCursorRef.current = { ...startCursor };
    provisionalElapsedBeatsRef.current = 0;
    recordPauseStartedAtRef.current = null;
    setIsRecordPaused(false);
    setIsRecordArming(true);
    setRecordCountdownMs(REALTIME_PREROLL_MS);
    const armStartedAt = performance.now();
    recordCountdownTimerRef.current = window.setInterval(() => {
      const elapsed = performance.now() - armStartedAt;
      const remaining = Math.max(0, REALTIME_PREROLL_MS - elapsed);
      setRecordCountdownMs(remaining);
    }, 50);
    recordArmTimeoutRef.current = window.setTimeout(() => {
      if (recordCountdownTimerRef.current) {
        window.clearInterval(recordCountdownTimerRef.current);
        recordCountdownTimerRef.current = null;
      }
      recordArmTimeoutRef.current = null;
      setIsRecordArming(false);
      setRecordCountdownMs(0);
      recordStartMsRef.current = performance.now();
      recordPauseStartedAtRef.current = null;
      setRecordElapsedMs(0);
      setIsRecording(true);
      setIsRecordPaused(false);
      startRecordClickTrack();
    }, REALTIME_PREROLL_MS);
  };

  const pauseRealtimeRecording = () => {
    if (!isRecording || isRecordPaused || !composition) return;
    const startMs = recordStartMsRef.current;
    if (startMs === null) return;
    const now = performance.now();
    const secondsPerBeat = 60 / composition.tempo;
    realtimeActiveNotesRef.current.forEach((active, midi) => {
      const startBeats = (active.startedAtMs - startMs) / 1000 / secondsPerBeat;
      const durationBeats = Math.max(0.05, (now - active.startedAtMs) / 1000 / secondsPerBeat);
      recordedEventsRef.current.push({
        midi,
        startBeats,
        durationBeats,
        velocity: active.velocity,
      });
    });
    realtimeActiveNotesRef.current.clear();
    provisionalRealtimeNotesRef.current.clear();
    stopAllHeldPreviewNotes();
    if (recordClickTimerRef.current) {
      window.clearInterval(recordClickTimerRef.current);
      recordClickTimerRef.current = null;
    }
    recordPauseStartedAtRef.current = now;
    setIsRecordPaused(true);
    rebuildRealtimePreviewComposition(now);
  };

  const resumeRealtimeRecording = () => {
    if (!isRecording || !isRecordPaused || isReadOnly) return;
    syncPreRecordStructureFromCurrent();
    recordArmingActionRef.current = 'resume';
    setIsRecordArming(true);
    setRecordCountdownMs(REALTIME_PREROLL_MS);
    const armStartedAt = performance.now();
    recordCountdownTimerRef.current = window.setInterval(() => {
      const elapsed = performance.now() - armStartedAt;
      const remaining = Math.max(0, REALTIME_PREROLL_MS - elapsed);
      setRecordCountdownMs(remaining);
    }, 50);
    recordArmTimeoutRef.current = window.setTimeout(() => {
      if (recordCountdownTimerRef.current) {
        window.clearInterval(recordCountdownTimerRef.current);
        recordCountdownTimerRef.current = null;
      }
      recordArmTimeoutRef.current = null;
      setIsRecordArming(false);
      setRecordCountdownMs(0);
      const now = performance.now();
      if (recordStartMsRef.current !== null && recordPauseStartedAtRef.current !== null) {
        const pausedDuration = Math.max(0, now - recordPauseStartedAtRef.current);
        recordStartMsRef.current += pausedDuration;
      }
      recordPauseStartedAtRef.current = null;
      setIsRecordPaused(false);
      if (recordClickEnabled) {
        startRecordClickTrack();
      }
    }, REALTIME_PREROLL_MS);
  };

  const toggleRealtimeRecording = async () => {
    if (!composition || isReadOnly) return;
    if (isRecordArming) {
      if (recordArmTimeoutRef.current) {
        window.clearTimeout(recordArmTimeoutRef.current);
        recordArmTimeoutRef.current = null;
      }
      if (recordCountdownTimerRef.current) {
        window.clearInterval(recordCountdownTimerRef.current);
        recordCountdownTimerRef.current = null;
      }
      setIsRecordArming(false);
      setRecordCountdownMs(0);
      if (recordArmingActionRef.current === 'start') {
        stopRealtimeRecording();
      }
      return;
    }
    if (isRecording) {
      if (isRecordPaused) {
        resumeRealtimeRecording();
      } else {
        pauseRealtimeRecording();
      }
      return;
    }
    if (isPreparingRecord) return;
    await prepareRealtimeRecording();
    startRealtimeRecording();
  };

  useEffect(() => {
    if (!isRecording) {
      if (recordElapsedTimerRef.current) {
        window.clearInterval(recordElapsedTimerRef.current);
        recordElapsedTimerRef.current = null;
      }
      return;
    }
    recordElapsedTimerRef.current = window.setInterval(() => {
      if (recordStartMsRef.current === null) return;
      if (isRecordPaused || isRecordArming) return;
      setRecordElapsedMs(Math.max(0, performance.now() - recordStartMsRef.current));
    }, 80);
    return () => {
      if (recordElapsedTimerRef.current) {
        window.clearInterval(recordElapsedTimerRef.current);
        recordElapsedTimerRef.current = null;
      }
    };
  }, [isRecording, isRecordPaused, isRecordArming]);

  useEffect(() => {
    if (!isRecording || isRecordPaused || isRecordArming) {
      if (realtimeVisualTimerRef.current) {
        window.clearInterval(realtimeVisualTimerRef.current);
        realtimeVisualTimerRef.current = null;
      }
      return;
    }

    const tick = () => {
      const now = performance.now();
      rebuildRealtimePreviewComposition(now);
    };

    tick();
    realtimeVisualTimerRef.current = window.setInterval(tick, 60);
    return () => {
      if (realtimeVisualTimerRef.current) {
        window.clearInterval(realtimeVisualTimerRef.current);
        realtimeVisualTimerRef.current = null;
      }
    };
  }, [isRecording, isRecordPaused, isRecordArming, quantization]);

  useEffect(() => {
    if (!isRecording || isRecordPaused || isRecordArming) {
      if (recordClickTimerRef.current) {
        window.clearInterval(recordClickTimerRef.current);
        recordClickTimerRef.current = null;
      }
      return;
    }
    if (recordClickEnabled) {
      startRecordClickTrack();
      return;
    }
    if (recordClickTimerRef.current) {
      window.clearInterval(recordClickTimerRef.current);
      recordClickTimerRef.current = null;
    }
  }, [recordClickEnabled, isRecording, isRecordPaused, isRecordArming, selectedMeasureIndex]);

  const handleVirtualDown = (midi: number) => {
    setActiveVirtualNotes((prev) => {
      if (prev.has(midi)) return prev;
      const next = new Set(prev);
      next.add(midi);
      return next;
    });
    handleMidiNoteOn(midi, 1);
  };

  const handleVirtualUp = (midi: number) => {
    setActiveVirtualNotes((prev) => {
      if (!prev.has(midi)) return prev;
      const next = new Set(prev);
      next.delete(midi);
      return next;
    });
    handleMidiNoteOff(midi);
  };

  const markTouchInteraction = () => {
    lastTouchAtMsRef.current = performance.now();
  };

  const shouldIgnoreMouseAfterTouch = (): boolean =>
    performance.now() - lastTouchAtMsRef.current < 700;

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      return target.isContentEditable;
    };

    const releaseComputerKey = (code: string) => {
      const activeMidi = activeComputerKeyToMidiRef.current.get(code);
      if (activeMidi === undefined) return;
      activeComputerKeyToMidiRef.current.delete(code);
      pressedComputerKeysRef.current.delete(code);
      handleVirtualUp(activeMidi);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (rebindMidi !== null) {
        if (!isEditableKeyboardCode(event.code)) return;
        event.preventDefault();
        rebindKeyboardMidi(rebindMidi, event.code);
        setRebindMidi(null);
        return;
      }
      if (!keyboardInputEnabled) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (isTypingTarget(event.target)) return;
      const mappedMidi = keyboardMapping[event.code];
      if (mappedMidi === undefined) return;
      ensureSimpleViewShowsMidi(mappedMidi);
      event.preventDefault();
      if (event.repeat || pressedComputerKeysRef.current.has(event.code)) return;
      pressedComputerKeysRef.current.add(event.code);
      activeComputerKeyToMidiRef.current.set(event.code, mappedMidi);
      if (!isReadOnly && mode === 'step' && !adaptiveStepEnabled && chordOnsetWindowBeats <= EPSILON) {
        setActiveVirtualNotes((prev) => {
          if (prev.has(mappedMidi)) return prev;
          const next = new Set(prev);
          next.add(mappedMidi);
          return next;
        });
        triggerKeyRetrigger(mappedMidi);
        startHeldPreviewForMidi(mappedMidi);
        setLastCapturedPitch(midiToPitch(clampMidi(mappedMidi)));
        handleStepInputNoteOn(mappedMidi);
        return;
      }
      handleVirtualDown(mappedMidi);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (!pressedComputerKeysRef.current.has(event.code)) return;
      event.preventDefault();
      releaseComputerKey(event.code);
    };

    const releaseAllComputerKeys = () => {
      const activeCodes = Array.from(activeComputerKeyToMidiRef.current.keys());
      activeCodes.forEach((code) => releaseComputerKey(code));
      pressedComputerKeysRef.current.clear();
      activeComputerKeyToMidiRef.current.clear();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        releaseAllComputerKeys();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releaseAllComputerKeys);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseAllComputerKeys);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      releaseAllComputerKeys();
    };
  }, [
    keyboardInputEnabled,
    keyboardMapping,
    rebindMidi,
    mode,
    adaptiveStepEnabled,
    chordOnsetWindowBeats,
    isReadOnly,
    isRecording,
    isRecordPaused,
    isRecordArming,
  ]);

  useEffect(() => {
    if (!showKeyboardMapEditor) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setShowKeyboardMapEditor(false);
      setRebindMidi(null);
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [showKeyboardMapEditor]);

  useEffect(() => {
    const releaseAllVirtual = () => {
      const active = Array.from(activeVirtualNotes);
      active.forEach((midi) => handleVirtualUp(midi));
    };
    window.addEventListener('mouseup', releaseAllVirtual);
    return () => {
      window.removeEventListener('mouseup', releaseAllVirtual);
    };
  }, [activeVirtualNotes]);

  useEffect(() => {
    return () => {
      stopAllHeldPreviewNotes();
      if (recordArmTimeoutRef.current) window.clearTimeout(recordArmTimeoutRef.current);
      if (recordCountdownTimerRef.current) window.clearInterval(recordCountdownTimerRef.current);
      if (recordElapsedTimerRef.current) window.clearInterval(recordElapsedTimerRef.current);
      if (recordClickTimerRef.current) window.clearInterval(recordClickTimerRef.current);
      if (recordClickSynthRef.current) {
        try {
          recordClickSynthRef.current.dispose();
        } catch {
          // no-op cleanup
        }
      }
    };
  }, []);

  const formatMs = (ms: number): string => {
    const totalMs = Math.max(0, Math.floor(ms));
    const seconds = Math.floor(totalMs / 1000);
    const centiseconds = Math.floor((totalMs % 1000) / 10);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
  };

  const getPianoDimensions = (fullscreen: boolean) => {
    if (fullscreen) {
      if (pianoViewMode === 'ultra') {
        return { whiteWidth: 44, blackWidth: 28, whiteHeight: 210, blackHeight: 126 };
      }
      if (pianoViewMode === 'extended') {
        return { whiteWidth: 58, blackWidth: 36, whiteHeight: 250, blackHeight: 150 };
      }
      return { whiteWidth: 82, blackWidth: 50, whiteHeight: 280, blackHeight: 170 };
    }
    if (pianoViewMode === 'ultra') {
      return { whiteWidth: 26, blackWidth: 16, whiteHeight: 104, blackHeight: 64 };
    }
    if (pianoViewMode === 'extended') {
      return { whiteWidth: 34, blackWidth: 22, whiteHeight: 120, blackHeight: 74 };
    }
    return { whiteWidth: 44, blackWidth: 28, whiteHeight: 124, blackHeight: 76 };
  };

  const jumpToCMidi = (midi: number, fullscreen: boolean) => {
    if (pianoViewMode === 'simple') {
      setSimpleBaseCMidi(clampSimpleBase(midi));
      return;
    }
    const scrollRef = fullscreen ? fullscreenPianoScrollRef : inlinePianoScrollRef;
    const container = scrollRef.current;
    if (!container) return;
    const dims = getPianoDimensions(fullscreen);
    const targetWhite = virtualPianoLayout.whiteKeys.find((key) => key.midi === midi);
    if (!targetWhite) return;
    const targetLeft = targetWhite.whiteIndex * dims.whiteWidth;
    const nextScroll = Math.max(0, targetLeft - container.clientWidth * 0.5 + dims.whiteWidth * 0.5);
    container.scrollTo({ left: nextScroll, behavior: 'smooth' });
  };

  const renderPianoKeyboard = (
    fullscreen: boolean,
    scrollRef: { current: HTMLDivElement | null }
  ) => {
    const dims = getPianoDimensions(fullscreen);
    const totalWidth = virtualPianoLayout.totalWhite * dims.whiteWidth;
    return (
      <div
        ref={scrollRef}
        className={`${fullscreen ? 'w-full' : ''} overflow-x-auto pb-1`}
        onContextMenu={(e) => e.preventDefault()}
        style={{ WebkitTouchCallout: 'none', userSelect: 'none', touchAction: 'pan-x' }}
      >
        <div
          className="relative mx-auto"
          style={{
            width: `${totalWidth}px`,
            minWidth: `${totalWidth}px`,
            height: `${dims.whiteHeight}px`,
          }}
        >
          <div className="absolute inset-0 flex">
            {virtualPianoLayout.whiteKeys.map((key) => {
              const active = displayActiveVirtualNotes.has(key.midi);
              const retriggered = keyRetriggerTick >= 0 && (keyRetriggerUntilRef.current.get(key.midi) ?? 0) > performance.now();
              const showLabel = pianoViewMode === 'simple' || isCMidi(key.midi) || active || fullscreen;
              return (
                <button
                  key={key.midi}
                  onContextMenu={(e) => e.preventDefault()}
                  onMouseDown={() => {
                    if (shouldIgnoreMouseAfterTouch()) return;
                    handleVirtualDown(key.midi);
                  }}
                  onMouseUp={() => {
                    if (shouldIgnoreMouseAfterTouch()) return;
                    handleVirtualUp(key.midi);
                  }}
                  onMouseLeave={() => {
                    if (shouldIgnoreMouseAfterTouch()) return;
                    handleVirtualUp(key.midi);
                  }}
                  onTouchStart={() => {
                    markTouchInteraction();
                    handleVirtualDown(key.midi);
                  }}
                  onTouchEnd={() => {
                    markTouchInteraction();
                    handleVirtualUp(key.midi);
                  }}
                  onTouchCancel={() => {
                    markTouchInteraction();
                    handleVirtualUp(key.midi);
                  }}
                  className={`relative border border-slate-300 rounded-b-md transition-colors ${
                    active ? 'bg-sv-cyan text-sv-bg border-sv-cyan' : 'bg-white text-slate-800'
                  } ${retriggered ? 'ring-2 ring-sv-cyan/90 ring-offset-1 ring-offset-slate-200' : ''}`}
                  style={{
                    width: `${dims.whiteWidth}px`,
                    height: `${dims.whiteHeight}px`,
                    boxShadow: active ? '0 0 0 1px rgba(0,212,245,0.6) inset' : 'inset 0 -8px 12px rgba(0,0,0,0.08)',
                    touchAction: 'manipulation',
                  }}
                  title={`${key.label} (${mode === 'step' ? 'step input' : 'MIDI input'})`}
                >
                  {showLabel && (
                    <span
                      className={`absolute left-1/2 -translate-x-1/2 font-medium ${
                        fullscreen ? 'bottom-2 text-[11px]' : 'bottom-1 text-[10px]'
                      }`}
                    >
                      {key.label}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="absolute left-0 top-0 h-full pointer-events-none">
            {virtualPianoLayout.blackKeys.map((key) => {
              const active = displayActiveVirtualNotes.has(key.midi);
              const retriggered = keyRetriggerTick >= 0 && (keyRetriggerUntilRef.current.get(key.midi) ?? 0) > performance.now();
              const left = (key.whiteIndex + 1) * dims.whiteWidth - dims.blackWidth / 2;
              const showLabel = pianoViewMode === 'simple' || active || fullscreen;
              return (
                <button
                  key={key.midi}
                  onContextMenu={(e) => e.preventDefault()}
                  onMouseDown={() => {
                    if (shouldIgnoreMouseAfterTouch()) return;
                    handleVirtualDown(key.midi);
                  }}
                  onMouseUp={() => {
                    if (shouldIgnoreMouseAfterTouch()) return;
                    handleVirtualUp(key.midi);
                  }}
                  onMouseLeave={() => {
                    if (shouldIgnoreMouseAfterTouch()) return;
                    handleVirtualUp(key.midi);
                  }}
                  onTouchStart={() => {
                    markTouchInteraction();
                    handleVirtualDown(key.midi);
                  }}
                  onTouchEnd={() => {
                    markTouchInteraction();
                    handleVirtualUp(key.midi);
                  }}
                  onTouchCancel={() => {
                    markTouchInteraction();
                    handleVirtualUp(key.midi);
                  }}
                  className={`absolute pointer-events-auto rounded-b-md border transition-colors ${
                    active
                      ? 'bg-sv-cyan text-sv-bg border-sv-cyan'
                      : 'bg-slate-900 text-slate-300 border-slate-700'
                  } ${retriggered ? 'ring-2 ring-sv-cyan/90 ring-offset-1 ring-offset-slate-950' : ''}`}
                  style={{
                    left: `${left}px`,
                    top: '0px',
                    width: `${dims.blackWidth}px`,
                    height: `${dims.blackHeight}px`,
                    boxShadow: active ? '0 0 10px rgba(0,212,245,0.45)' : 'inset 0 -8px 10px rgba(255,255,255,0.04)',
                    zIndex: 10,
                    touchAction: 'manipulation',
                  }}
                  title={`${key.label} (${mode === 'step' ? 'step input' : 'MIDI input'})`}
                >
                  {showLabel && (
                    <span
                      className={`absolute left-1/2 -translate-x-1/2 font-medium ${
                        fullscreen ? 'bottom-2 text-[10px]' : 'bottom-1 text-[9px]'
                      }`}
                    >
                      {key.label}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderKeyboardModeControls = () => (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => setPianoViewMode('simple')}
        className={pianoViewMode === 'simple' ? 'sv-btn-active text-xs !px-2 !py-1' : 'sv-btn-ghost text-xs !px-2 !py-1'}
        title="Simple keyboard range"
      >
        Simple
      </button>
      <button
        type="button"
        onClick={() => setPianoViewMode('extended')}
        className={pianoViewMode === 'extended' ? 'sv-btn-active text-xs !px-2 !py-1' : 'sv-btn-ghost text-xs !px-2 !py-1'}
        title="Extended keyboard range"
      >
        Extended
      </button>
      <button
        type="button"
        onClick={() => setPianoViewMode('ultra')}
        className={pianoViewMode === 'ultra' ? 'sv-btn-active text-xs !px-2 !py-1' : 'sv-btn-ghost text-xs !px-2 !py-1'}
        title="Ultra 88-key range"
      >
        Ultra (88-key)
      </button>
    </div>
  );

  const renderKeyboardMapModal = () => {
    if (!showKeyboardMapEditor) return null;
    const dims = { whiteWidth: 32, blackWidth: 20, whiteHeight: 170, blackHeight: 104 };
    const totalWidth = keyboardMapLayout.totalWhite * dims.whiteWidth;
    return (
      <div className="fixed inset-0 z-[120] bg-black/85 backdrop-blur-sm p-3 sm:p-6" onContextMenu={(e) => e.preventDefault()}>
        <div className="w-full h-full rounded-xl border border-sv-border bg-sv-card flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-sv-border flex items-center justify-between gap-2">
            <div>
              <div className="sv-toolbar-label">Computer Key Map</div>
              <p className="text-xs text-sv-text-muted mt-1">
                Click any piano key (88-key range), then press a computer key to bind it. Saved locally.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {rebindMidi !== null && (
                <span className="px-2 py-0.5 rounded border border-amber-400/45 text-amber-300 text-xs">
                  Waiting key for {midiLabel(rebindMidi)}
                </span>
              )}
              <button className="sv-btn-ghost text-xs" onClick={resetKeyboardMapping}>
                Reset defaults
              </button>
              <button
                className="sv-btn-danger text-xs"
                onClick={() => {
                  setShowKeyboardMapEditor(false);
                  setRebindMidi(null);
                }}
              >
                Close
              </button>
            </div>
          </div>
          <div className="px-3 py-2 border-b border-sv-border text-[11px] text-sv-text-dim">
            Tip: repeated binding on the same computer key moves that key to the newly selected piano note.
          </div>
          <div
            ref={keyboardMapScrollRef}
            className="flex-1 overflow-x-auto overflow-y-hidden px-3 py-4"
            style={{ WebkitTouchCallout: 'none', userSelect: 'none', touchAction: 'pan-x' }}
          >
            <div
              className="relative mx-auto"
              style={{ width: `${totalWidth}px`, minWidth: `${totalWidth}px`, height: `${dims.whiteHeight}px` }}
            >
              <div className="absolute inset-0 flex">
                {keyboardMapLayout.whiteKeys.map((key) => {
                  const mapped = mappedCodesByMidi.get(key.midi) ?? [];
                  const selected = rebindMidi === key.midi;
                  return (
                    <button
                      key={`map-w-${key.midi}`}
                      type="button"
                      onClick={() => setRebindMidi(key.midi)}
                      className={`relative border rounded-b-md transition-colors ${
                        selected
                          ? 'border-amber-300 bg-amber-100 text-slate-900'
                          : 'border-slate-300 bg-white text-slate-900'
                      }`}
                      style={{
                        width: `${dims.whiteWidth}px`,
                        height: `${dims.whiteHeight}px`,
                        boxShadow: selected ? '0 0 0 1px rgba(251,191,36,0.75) inset' : 'inset 0 -8px 12px rgba(0,0,0,0.08)',
                        touchAction: 'manipulation',
                      }}
                      title={`Bind computer key for ${key.label}`}
                    >
                      {mapped.length > 0 && (
                        <span className="absolute top-1 left-1/2 -translate-x-1/2 text-[9px] font-semibold px-1 rounded bg-sv-cyan/15 text-slate-800 border border-sv-cyan/35">
                          {mapped.slice(0, 2).join(' ')}
                        </span>
                      )}
                      <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[9px] font-medium">
                        {key.label}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="absolute left-0 top-0 h-full pointer-events-none">
                {keyboardMapLayout.blackKeys.map((key) => {
                  const mapped = mappedCodesByMidi.get(key.midi) ?? [];
                  const selected = rebindMidi === key.midi;
                  const left = (key.whiteIndex + 1) * dims.whiteWidth - dims.blackWidth / 2;
                  return (
                    <button
                      key={`map-b-${key.midi}`}
                      type="button"
                      onClick={() => setRebindMidi(key.midi)}
                      className={`absolute pointer-events-auto rounded-b-md border transition-colors ${
                        selected
                          ? 'border-amber-300 bg-amber-200 text-slate-900'
                          : 'border-slate-700 bg-slate-900 text-slate-100'
                      }`}
                      style={{
                        left: `${left}px`,
                        width: `${dims.blackWidth}px`,
                        height: `${dims.blackHeight}px`,
                        top: '0px',
                        zIndex: 10,
                        touchAction: 'manipulation',
                      }}
                      title={`Bind computer key for ${key.label}`}
                    >
                      {mapped.length > 0 && (
                        <span className="absolute top-1 left-1/2 -translate-x-1/2 text-[8px] font-semibold px-0.5 rounded bg-sv-cyan/20 border border-sv-cyan/35">
                          {mapped[0]}
                        </span>
                      )}
                      <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[8px]">
                        {key.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full rounded-lg border border-sv-border bg-sv-elevated px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="sv-toolbar-label">MIDI Input</span>
          {isCompactViewport && (
            <span className="text-[11px] text-sv-text-dim">
              {isCollapsed ? 'Collapsed' : 'Expanded'}
            </span>
          )}
          {mode === 'realtime' && isRecording && !isRecordPaused && (
            <span className="px-2 py-0.5 rounded border border-rose-400/50 text-rose-300 text-[11px]">
              REC
            </span>
          )}
        </div>
        <button
          onClick={() => setIsCollapsed((prev) => !prev)}
          className="sv-btn-ghost text-xs"
          title={isCollapsed ? 'Expand MIDI input panel' : 'Collapse MIDI input panel'}
        >
          {isCollapsed ? 'Show' : 'Hide'}
        </button>
      </div>

      {isCollapsed ? (
        <p className="mt-2 text-[11px] text-sv-text-dim">
          MIDI controls hidden to preserve score space. Tap Show to expand.
        </p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setMode('step')}
          className={mode === 'step' ? 'sv-btn-active' : 'sv-btn-ghost'}
          disabled={isReadOnly}
          title="Insert notes one press at a time"
        >
          Step Input
        </button>
        <button
          onClick={() => setMode('realtime')}
          className={mode === 'realtime' ? 'sv-btn-active' : 'sv-btn-ghost'}
          disabled={isReadOnly}
          title="Record timing from live key performance"
        >
          Real-time
        </button>
        <label className="flex items-center gap-1 text-xs text-sv-text-muted">
          Quantize
          <select
            className="sv-select text-xs"
            value={quantization}
            onChange={(e) => setQuantization(e.target.value as QuantizationId)}
            disabled={isReadOnly}
            title="Applied when committing real-time recordings"
          >
            {QUANTIZATION_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        {mode === 'realtime' && (
          <>
            <label className="flex items-center gap-1 text-xs text-sv-text-muted">
              <input
                type="checkbox"
                checked={recordClickEnabled}
                onChange={(e) => setRecordClickEnabled(e.target.checked)}
                disabled={isReadOnly}
              />
              Record click
            </label>
            <label className="flex items-center gap-1 text-xs text-sv-text-muted">
              <input
                type="checkbox"
                checked={autoPickupEnabled}
                onChange={(e) => setAutoPickupEnabled(e.target.checked)}
                disabled={isReadOnly}
              />
              Auto pickup (from first onset)
            </label>
          </>
        )}
        {(mode === 'realtime' || mode === 'step') && (
          <label className="flex items-center gap-1 text-xs text-sv-text-muted">
            Chord grouping
            <select
              className="sv-select text-xs"
              value={chordWindow}
              onChange={(e) => handleChordWindowChange(e.target.value as MidiChordWindowId)}
              disabled={isReadOnly}
              title="Timing window used to group near-simultaneous MIDI onsets into chord-like entries"
            >
              {MIDI_CHORD_WINDOW_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <span className="text-[10px] text-sv-text-dim">~{chordWindowMsLabel}ms</span>
          </label>
        )}
        {mode === 'step' && (
          <label className="flex items-center gap-1 text-xs text-sv-text-muted">
            <input
              type="checkbox"
              checked={adaptiveStepEnabled}
              onChange={(e) => setAdaptiveStepEnabled(e.target.checked)}
              disabled={isReadOnly}
            />
            Adaptive hold-to-duration
          </label>
        )}
        <label className="flex items-center gap-1 text-xs text-sv-text-muted">
          Keyboard
          {renderKeyboardModeControls()}
        </label>
        <label className="flex items-center gap-1 text-xs text-sv-text-muted">
          <input
            type="checkbox"
            checked={keyboardInputEnabled}
            onChange={(e) => saveKeyboardInputEnabled(e.target.checked)}
          />
          Computer keyboard input
        </label>
        <button
          onClick={() => {
            setShowKeyboardMapEditor(true);
            setRebindMidi(null);
          }}
          className={showKeyboardMapEditor ? 'sv-btn-active' : 'sv-btn-ghost'}
          title="Open fullscreen computer keyboard mapping modal"
        >
          Edit key map
        </button>
        <label className="flex items-center gap-1 text-xs text-sv-text-muted">
          <input
            type="checkbox"
            checked={showPlaybackOnKeyboard}
            onChange={(e) => setShowPlaybackOnKeyboard(e.target.checked)}
          />
          Show playback on keyboard
        </label>
        <button
          onClick={() => setPianoFullscreen(true)}
          className="sv-btn-ghost"
          title="Open virtual piano in fullscreen overlay"
        >
          Full screen piano
        </button>
        {mode === 'realtime' && (
          <>
            <button
              onClick={toggleRealtimeRecording}
              className={
                isRecording
                  ? isRecordPaused
                    ? 'sv-btn-primary'
                    : 'sv-btn-ghost'
                  : isRecordArming
                  ? 'sv-btn-ghost'
                  : 'sv-btn-primary'
              }
              disabled={isReadOnly || isPreparingRecord}
              title={
                isPreparingRecord
                  ? 'Initializing audio and instruments'
                  : isRecordArming
                  ? 'Cancel arming countdown'
                  : isRecording
                  ? isRecordPaused
                    ? 'Resume recording with countdown'
                    : 'Pause recording'
                  : 'Start recording incoming notes (includes short pre-roll)'
              }
            >
              {isPreparingRecord
                ? 'Preparing...'
                : isRecordArming
                ? 'Cancel'
                : isRecording
                ? isRecordPaused
                  ? 'Resume Recording'
                  : 'Pause Recording'
                : 'Start Recording'}
            </button>
            {(isRecording || isRecordArming) && (
              <button
                onClick={stopRealtimeRecording}
                className="sv-btn-danger"
                disabled={isReadOnly}
                title="Stop and commit recording"
              >
                Stop Recording
              </button>
            )}
          </>
        )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-sv-text-muted">{statusText}</span>
        {isReadOnly && (
          <span className="px-2 py-0.5 rounded border border-sv-cyan/40 text-sv-cyan">
            Preview only - no score input
          </span>
        )}
        {midiInputs.length > 0 && (
          <span className="text-sv-text-dim">
            ({midiInputs.map((input) => input.name).join(', ')})
          </span>
        )}
        {!midiSupported && <span className="text-amber-300">Use virtual piano below.</span>}
        {lastCapturedPitch && (
          <span className="px-2 py-0.5 rounded border border-sv-cyan/40 text-sv-cyan">
            Last: {lastCapturedPitch}
          </span>
        )}
        {mode === 'step' && (
          <span className="text-sv-text-dim">
            Step: near-simultaneous presses are grouped as one chord onset.
          </span>
        )}
        {mode === 'realtime' && (
          <span className="text-sv-text-dim">
            Real-time: chord grouping uses the selected window.
          </span>
        )}
        {mode === 'realtime' && isPreparingRecord && (
          <span className="px-2 py-0.5 rounded border border-sv-cyan/45 text-sv-cyan">
            Initializing audio...
          </span>
        )}
        {mode === 'realtime' && isRecordArming && (
          <span className="px-2 py-0.5 rounded border border-amber-400/50 text-amber-300">
            {recordArmingActionRef.current === 'resume' ? 'Resuming...' : 'Arming...'} {Math.ceil(recordCountdownMs / 1000)}s
          </span>
        )}
        {mode === 'realtime' && isRecording && isRecordPaused && !isRecordArming && (
          <span className="px-2 py-0.5 rounded border border-amber-300/45 text-amber-200">
            Paused
          </span>
        )}
        {mode === 'realtime' && isRecording && (
          <span className="px-2 py-0.5 rounded border border-rose-400/50 text-rose-300">
            REC {formatMs(recordElapsedMs)}
          </span>
        )}
          </div>
          {mode === 'step' && adaptiveStepEnabled && adaptiveHoldLabels.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-sv-text-muted">Holding</span>
              {adaptiveHoldLabels.map((label) => (
                <span key={label} className="px-2 py-0.5 rounded border border-sv-cyan/35 text-sv-cyan">
                  {label}
                </span>
              ))}
            </div>
          )}
          {cJumpTargets.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-sv-text-muted">Octave jump</span>
              {cJumpTargets.map((target) => (
                <button
                  key={target.midi}
                  onClick={() => jumpToCMidi(target.midi, false)}
                  className="sv-btn-ghost text-[11px]"
                  title={`Center keyboard around ${target.label}`}
                >
                  {target.label}
                </button>
              ))}
            </div>
          )}

          {renderPianoKeyboard(false, inlinePianoScrollRef)}
          <p className="mt-2 text-[11px] text-sv-text-dim">
        Target: Staff {selectedStaffIndex + 1}, Measure {selectedMeasureIndex + 1}, Voice {selectedVoiceIndex + 1}
        {mode === 'step'
          ? adaptiveStepEnabled
            ? ` · Adaptive duration uses current measure timing and updates while holding (${QUANTIZATION_OPTIONS.find((q) => q.id === quantization)?.label ?? 'Off'} quantize) · Chord grouping ${MIDI_CHORD_WINDOW_OPTIONS.find((opt) => opt.id === chordWindow)?.label ?? 'Normal'}`
            : ` · Uses selected toolbar duration (${selectedDuration}) · Chord grouping ${MIDI_CHORD_WINDOW_OPTIONS.find((opt) => opt.id === chordWindow)?.label ?? 'Normal'}`
          : ` · Quantization ${QUANTIZATION_OPTIONS.find((q) => q.id === quantization)?.label ?? 'Off'} · Chord grouping ${MIDI_CHORD_WINDOW_OPTIONS.find((opt) => opt.id === chordWindow)?.label ?? 'Normal'}`}
          </p>
        </>
      )}
      {pianoFullscreen && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm p-3 sm:p-6"
          onContextMenu={(e) => e.preventDefault()}
          style={{ WebkitTouchCallout: 'none', userSelect: 'none' }}
        >
          <div className="w-full h-full rounded-xl border border-sv-border bg-sv-card flex flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-sv-border">
              <div className="flex items-center gap-2">
                <span className="sv-toolbar-label">Virtual Piano</span>
                <span className="text-xs text-sv-text-muted">
                  {pianoViewMode === 'ultra'
                    ? 'Ultra range (A0-C8)'
                    : pianoViewMode === 'extended'
                    ? 'Extended range'
                    : 'Simple range'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs text-sv-text-muted">
                  Keyboard
                  {renderKeyboardModeControls()}
                </label>
                <button
                  onClick={() => setPianoFullscreen(false)}
                  className="sv-btn-danger"
                  title="Close fullscreen piano"
                >
                  Close
                </button>
              </div>
            </div>
            {cJumpTargets.length > 0 && (
              <div className="px-3 py-2 border-b border-sv-border flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-sv-text-muted">Octave jump</span>
                {cJumpTargets.map((target) => (
                  <button
                    key={`fs-${target.midi}`}
                    onClick={() => jumpToCMidi(target.midi, true)}
                    className="sv-btn-ghost text-[11px]"
                    title={`Center keyboard around ${target.label}`}
                  >
                    {target.label}
                  </button>
                ))}
              </div>
            )}
            <div className="flex-1 flex items-center justify-center px-2 sm:px-4 py-4">
              {renderPianoKeyboard(true, fullscreenPianoScrollRef)}
            </div>
            <div className="px-3 py-2 border-t border-sv-border text-xs text-sv-text-dim">
              Press Esc or Close to exit fullscreen piano.
            </div>
          </div>
        </div>
      )}
      {renderKeyboardMapModal()}
    </div>
  );
};
