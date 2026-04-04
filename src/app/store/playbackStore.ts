import { create } from 'zustand';

type PlaybackState = 'stopped' | 'playing' | 'paused';

/** Reference to a specific note in the composition */
export interface PlayingNoteRef {
  staffIndex: number;
  measureIndex: number;
  voiceIndex: number;
  noteIndex: number;
}

interface PlaybackStateStore {
  state: PlaybackState;
  currentMeasure: number;
  currentBeat: number;
  setState: (state: PlaybackState) => void;
  setCurrentMeasure: (measure: number) => void;
  setCurrentBeat: (beat: number) => void;
  isLooping: boolean;
  setLooping: (looping: boolean) => void;
  /** Set of notes currently playing (for visual highlighting) */
  playingNotes: Set<string>; // serialized as "staffIndex:measureIndex:voiceIndex:noteIndex"
  setPlayingNotes: (notes: PlayingNoteRef[]) => void;
  clearPlayingNotes: () => void;
  isNotePlaying: (ref: PlayingNoteRef) => boolean;
  /** Per-staff volume (0-100) and mute state */
  staffVolumes: Record<number, number>; // staffIndex → volume (0-100)
  staffMuted: Record<number, boolean>;   // staffIndex → muted
  /** Per-staff solo state; when any are soloed, only those staffs are audible. */
  staffSoloed: Record<number, boolean>; // staffIndex → soloed
  /** Per-voice mute/solo state scoped by staff and voice lane. */
  voiceMuted: Record<string, boolean>; // `${staffIndex}:${voiceIndex}` → muted
  voiceSoloed: Record<string, boolean>; // `${staffIndex}:${voiceIndex}` → soloed
  setStaffVolume: (staffIndex: number, volume: number) => void;
  setStaffMuted: (staffIndex: number, muted: boolean) => void;
  setStaffSoloed: (staffIndex: number, soloed: boolean) => void;
  clearStaffSoloed: () => void;
  getStaffVolume: (staffIndex: number) => number; // returns 0-100, default 100
  isStaffMuted: (staffIndex: number) => boolean;
  isStaffSoloed: (staffIndex: number) => boolean;
  hasAnySoloedStaff: () => boolean;
  isStaffEffectivelyMuted: (staffIndex: number) => boolean;
  setVoiceMuted: (staffIndex: number, voiceIndex: number, muted: boolean) => void;
  setVoiceSoloed: (staffIndex: number, voiceIndex: number, soloed: boolean) => void;
  clearVoiceSoloed: (staffIndex?: number) => void;
  isVoiceMuted: (staffIndex: number, voiceIndex: number) => boolean;
  isVoiceSoloed: (staffIndex: number, voiceIndex: number) => boolean;
  hasAnySoloedVoice: (staffIndex: number) => boolean;
  isVoiceEffectivelyMuted: (staffIndex: number, voiceIndex: number) => boolean;
  /** Playback tempo (can be changed even for view-only users, for playback/study purposes) */
  playbackTempo: number | null; // null means use composition tempo
  setPlaybackTempo: (tempo: number | null) => void;
  getEffectiveTempo: (compositionTempo: number) => number; // returns playback tempo if set, otherwise composition tempo
  /** Playback instruments per staff (can be changed even for view-only users, for playback/study purposes) */
  playbackInstruments: Record<number, string>; // staffIndex → instrument name
  setPlaybackInstrument: (staffIndex: number, instrument: string | null) => void; // null means use composition instrument
  getEffectiveInstrument: (staffIndex: number, compositionInstrument: string) => string; // returns playback instrument if set, otherwise composition instrument
  /** Playback range (start and end measures) */
  playbackStartMeasure: number | null; // null means start from beginning
  playbackEndMeasure: number | null; // null means play to end
  setPlaybackRange: (startMeasure: number | null, endMeasure: number | null) => void;
  /** Whether to play chord symbols during playback */
  playChords: boolean;
  setPlayChords: (play: boolean) => void;
  /** When true, note dynamics and articulations shape playback expression. */
  expressivePlayback: boolean;
  setExpressivePlayback: (enabled: boolean) => void;
  /** Practice playback helpers */
  metronomeEnabled: boolean;
  setMetronomeEnabled: (enabled: boolean) => void;
  countInEnabled: boolean;
  setCountInEnabled: (enabled: boolean) => void;
  countInBars: 1 | 2;
  setCountInBars: (bars: 1 | 2) => void;
}

const serializeNoteRef = (ref: PlayingNoteRef): string =>
  `${ref.staffIndex}:${ref.measureIndex}:${ref.voiceIndex}:${ref.noteIndex}`;

const voiceKey = (staffIndex: number, voiceIndex: number): string => `${staffIndex}:${voiceIndex}`;

export const usePlaybackStore = create<PlaybackStateStore>((set, get) => ({
  state: 'stopped',
  currentMeasure: 0,
  currentBeat: 0,
  isLooping: false,
  playingNotes: new Set(),
  staffVolumes: {},
  staffMuted: {},
  staffSoloed: {},
  voiceMuted: {},
  voiceSoloed: {},
  playbackTempo: null,
  playbackInstruments: {},
  playbackStartMeasure: null,
  playbackEndMeasure: null,
  playChords: false,
  expressivePlayback: true,
  metronomeEnabled: false,
  countInEnabled: false,
  countInBars: 1,
  setPlayChords: (play) => set({ playChords: play }),
  setExpressivePlayback: (enabled) => set({ expressivePlayback: enabled }),
  setState: (state) => set({ state }),
  setCurrentMeasure: (measure) => set({ currentMeasure: measure }),
  setCurrentBeat: (beat) => set({ currentBeat: beat }),
  setLooping: (looping) => set({ isLooping: looping }),
  setPlayingNotes: (notes) => {
    const serialized = new Set(notes.map(serializeNoteRef));
    set({ playingNotes: serialized });
  },
  clearPlayingNotes: () => set({ playingNotes: new Set() }),
  isNotePlaying: (ref) => {
    const serialized = serializeNoteRef(ref);
    return get().playingNotes.has(serialized);
  },
  setStaffVolume: (staffIndex, volume) => {
    const clamped = Math.max(0, Math.min(100, volume));
    set((state) => ({
      staffVolumes: { ...state.staffVolumes, [staffIndex]: clamped },
    }));
  },
  setStaffMuted: (staffIndex, muted) => {
    set((state) => ({
      staffMuted: { ...state.staffMuted, [staffIndex]: muted },
    }));
  },
  setStaffSoloed: (staffIndex, soloed) => {
    set((state) => ({
      staffSoloed: { ...state.staffSoloed, [staffIndex]: soloed },
    }));
  },
  clearStaffSoloed: () => set({ staffSoloed: {} }),
  getStaffVolume: (staffIndex) => {
    const vol = get().staffVolumes[staffIndex];
    return vol !== undefined ? vol : 100; // default 100%
  },
  isStaffMuted: (staffIndex) => {
    return get().staffMuted[staffIndex] ?? false; // default not muted
  },
  isStaffSoloed: (staffIndex) => {
    return get().staffSoloed[staffIndex] ?? false; // default not soloed
  },
  hasAnySoloedStaff: () => {
    const soloed = get().staffSoloed;
    return Object.values(soloed).some(Boolean);
  },
  isStaffEffectivelyMuted: (staffIndex) => {
    const state = get();
    const explicitlyMuted = state.staffMuted[staffIndex] ?? false;
    if (explicitlyMuted) return true;
    const anySolo = Object.values(state.staffSoloed).some(Boolean);
    if (!anySolo) return false;
    return !(state.staffSoloed[staffIndex] ?? false);
  },
  setVoiceMuted: (staffIndex, voiceIndex, muted) => {
    const key = voiceKey(staffIndex, voiceIndex);
    set((state) => {
      const nextMuted = { ...state.voiceMuted, [key]: muted };
      const nextSoloed = { ...state.voiceSoloed };
      // If a soloed lane is muted, clear solo on that lane immediately.
      if (muted && nextSoloed[key]) {
        nextSoloed[key] = false;
      }
      return {
        voiceMuted: nextMuted,
        voiceSoloed: nextSoloed,
      };
    });
  },
  setVoiceSoloed: (staffIndex, voiceIndex, soloed) => {
    const key = voiceKey(staffIndex, voiceIndex);
    set((state) => {
      const nextSolo = { ...state.voiceSoloed };
      if (soloed) {
        // Single-solo behavior per staff: soloing one lane clears other solos.
        Object.keys(nextSolo).forEach((k) => {
          if (k.startsWith(`${staffIndex}:`)) nextSolo[k] = false;
        });
        nextSolo[key] = true;
      } else {
        nextSolo[key] = false;
      }
      // Soloing a lane should immediately unmute that same lane.
      const nextMute = { ...state.voiceMuted };
      if (soloed) nextMute[key] = false;
      return { voiceSoloed: nextSolo, voiceMuted: nextMute };
    });
  },
  clearVoiceSoloed: (staffIndex) => {
    if (staffIndex === undefined) {
      set({ voiceSoloed: {} });
      return;
    }
    set((state) => {
      const next = { ...state.voiceSoloed };
      Object.keys(next).forEach((key) => {
        if (key.startsWith(`${staffIndex}:`)) delete next[key];
      });
      return { voiceSoloed: next };
    });
  },
  isVoiceMuted: (staffIndex, voiceIndex) => {
    return get().voiceMuted[voiceKey(staffIndex, voiceIndex)] ?? false;
  },
  isVoiceSoloed: (staffIndex, voiceIndex) => {
    return get().voiceSoloed[voiceKey(staffIndex, voiceIndex)] ?? false;
  },
  hasAnySoloedVoice: (staffIndex) => {
    const entries = get().voiceSoloed;
    return Object.entries(entries).some(([key, enabled]) => enabled && key.startsWith(`${staffIndex}:`));
  },
  isVoiceEffectivelyMuted: (staffIndex, voiceIndex) => {
    const state = get();
    const key = voiceKey(staffIndex, voiceIndex);
    const explicitlyMuted = state.voiceMuted[key] ?? false;
    if (explicitlyMuted) return true;
    const anySoloOnStaff = Object.entries(state.voiceSoloed).some(
      ([k, enabled]) => enabled && k.startsWith(`${staffIndex}:`)
    );
    if (!anySoloOnStaff) return false;
    return !(state.voiceSoloed[key] ?? false);
  },
  setPlaybackTempo: (tempo) => set({ playbackTempo: tempo }),
  getEffectiveTempo: (compositionTempo) => {
    const playbackTempo = get().playbackTempo;
    return playbackTempo !== null ? playbackTempo : compositionTempo;
  },
  setPlaybackInstrument: (staffIndex, instrument) => {
    set((state) => {
      const newInstruments = { ...state.playbackInstruments };
      if (instrument === null) {
        delete newInstruments[staffIndex];
      } else {
        newInstruments[staffIndex] = instrument;
      }
      return { playbackInstruments: newInstruments };
    });
  },
  getEffectiveInstrument: (staffIndex, compositionInstrument) => {
    const playbackInstruments = get().playbackInstruments;
    return playbackInstruments[staffIndex] ?? compositionInstrument;
  },
  setPlaybackRange: (startMeasure, endMeasure) => set({ 
    playbackStartMeasure: startMeasure, 
    playbackEndMeasure: endMeasure 
  }),
  setMetronomeEnabled: (enabled) => set({ metronomeEnabled: enabled }),
  setCountInEnabled: (enabled) => set({ countInEnabled: enabled }),
  setCountInBars: (bars) => set({ countInBars: bars }),
}));
