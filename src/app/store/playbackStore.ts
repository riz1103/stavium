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
  setStaffVolume: (staffIndex: number, volume: number) => void;
  setStaffMuted: (staffIndex: number, muted: boolean) => void;
  getStaffVolume: (staffIndex: number) => number; // returns 0-100, default 100
  isStaffMuted: (staffIndex: number) => boolean;
}

const serializeNoteRef = (ref: PlayingNoteRef): string =>
  `${ref.staffIndex}:${ref.measureIndex}:${ref.voiceIndex}:${ref.noteIndex}`;

export const usePlaybackStore = create<PlaybackStateStore>((set, get) => ({
  state: 'stopped',
  currentMeasure: 0,
  currentBeat: 0,
  isLooping: false,
  playingNotes: new Set(),
  staffVolumes: {},
  staffMuted: {},
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
  getStaffVolume: (staffIndex) => {
    const vol = get().staffVolumes[staffIndex];
    return vol !== undefined ? vol : 100; // default 100%
  },
  isStaffMuted: (staffIndex) => {
    return get().staffMuted[staffIndex] ?? false; // default not muted
  },
}));
