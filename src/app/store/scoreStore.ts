import { create } from 'zustand';
import { Clef, Composition, Staff, Measure, Voice, Note, Pitch, NoteDuration, MusicElement, PrivacyLevel } from '../../types/music';

interface ScoreState {
  composition: Composition | null;
  setComposition: (composition: Composition) => void;
  resetComposition: () => void;
  addNote: (staffIndex: number, measureIndex: number, voiceIndex: number, element: MusicElement, insertIndex?: number) => void;
  moveNote: (
    fromStaff: number, fromMeasure: number, fromVoice: number, fromIndex: number,
    toStaff: number,   toMeasure: number,   toVoice: number,   toIndex: number,
    newPitch?: string
  ) => void;
  removeNote: (staffIndex: number, measureIndex: number, voiceIndex: number, noteIndex: number) => void;
  updateNote: (
    staffIndex: number,
    measureIndex: number,
    voiceIndex: number,
    noteIndex: number,
    note: Partial<Note>
  ) => void;
  addMeasure: (staffIndex: number) => void;
  removeMeasure: (staffIndex: number, measureIndex: number) => void;
  copyMeasure: (staffIndex: number, startMeasureIndex: number, endMeasureIndex?: number) => void;
  pasteMeasure: (targetStaffIndex: number, targetMeasureIndex: number, insertAfter?: boolean) => void;
  copiedMeasures: Measure[] | null;
  copiedStaffIndex: number | null;
  measureSelectionStart: number | null;
  setMeasureSelectionStart: (index: number | null) => void;
  addStaff: (staff: Staff) => void;
  removeStaff: (staffIndex: number) => void;
  updateStaffName: (staffIndex: number, name: string) => void;
  /**
   * Set per-measure property overrides.
   * - timeSignature / keySignature / tempo are "global" changes: they are written
   *   to ALL staves' measure at measureIndex so the timing grid stays consistent.
   * - clef is staff-specific: only the given staffIndex (or all staves when omitted)
   *   gets the clef override.
   * Pass `undefined` for any field to CLEAR that override (restore global value).
   */
  updateMeasureProperties: (
    measureIndex: number,
    props: { timeSignature?: string | null; keySignature?: string | null; tempo?: number | null; clef?: Clef | null },
    staffIndex?: number
  ) => void;
  updateTempo: (tempo: number) => void;
  updateTimeSignature: (timeSignature: string) => void;
  updateKeySignature: (keySignature: string) => void;
  updateAuthor: (author: string) => void;
  updateArrangedBy: (arrangedBy: string) => void;
  updatePrivacy: (privacy: 'private' | 'shared' | 'public') => void;
  updateSharedEmails: (emails: string[]) => void;
  updateSharePermission: (permission: 'view' | 'edit') => void;
  setAnacrusis: (enabled: boolean, pickupBeats?: number) => void;
  setShowMeasureNumbers: (show: boolean) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  selectedStaffIndex: number | null;
  setSelectedStaffIndex: (index: number | null) => void;
  selectedMeasureIndex: number | null;
  setSelectedMeasureIndex: (index: number | null) => void;
  selectedVoiceIndex: number;
  setSelectedVoiceIndex: (index: number) => void;
  selectedDuration: NoteDuration;
  setSelectedDuration: (duration: NoteDuration) => void;
  selectedRestDuration: NoteDuration | null;
  setSelectedRestDuration: (duration: NoteDuration | null) => void;
  selectedNote: { staffIndex: number; measureIndex: number; voiceIndex: number; noteIndex: number } | null;
  setSelectedNote: (note: { staffIndex: number; measureIndex: number; voiceIndex: number; noteIndex: number } | null) => void;
  deleteSelectedNote: () => void;
}

const defaultComposition: Composition = {
  title: 'Untitled Composition',
  tempo: 120,
  timeSignature: '4/4',
  keySignature: 'C',
  showMeasureNumbers: true,
  privacy: 'private',
  staves: [
    {
      clef: 'treble',
      instrument: 'piano',
      measures: [
        {
          number: 1,
          voices: [
            {
              notes: [],
            },
          ],
        },
      ],
    },
  ],
};

// History management for undo/redo
const MAX_HISTORY = 50;
let history: Composition[] = [];
let historyIndex = -1;

// Helper to save current state to history before mutation
const saveToHistory = (current: Composition | null) => {
  if (!current) return;
  // Remove any future history if we're not at the end
  if (historyIndex < history.length - 1) {
    history = history.slice(0, historyIndex + 1);
  }
  // Add current state to history
  history.push(JSON.parse(JSON.stringify(current)));
  if (history.length > MAX_HISTORY) {
    history.shift();
  } else {
    historyIndex++;
  }
};

// Helper to clear history (for new compositions)
const clearHistory = () => {
  history = [];
  historyIndex = -1;
};

// Helper to update composition with automatic date management
const updateCompositionWithDates = (composition: Composition | null, updates: Partial<Composition>): Composition | null => {
  if (!composition) return null;
  
  const now = new Date();
  const updatedComposition = {
    ...composition,
    ...updates,
    // Set createdAt if it doesn't exist (new composition)
    createdAt: composition.createdAt || now,
    // Always update updatedAt when composition changes
    updatedAt: now,
  };
  
  return updatedComposition;
};

export const useScoreStore = create<ScoreState>((set, get) => ({
  composition: defaultComposition,
  selectedStaffIndex: 0,
  selectedMeasureIndex: 0,
  selectedVoiceIndex: 0,
  selectedDuration: 'quarter',
  selectedRestDuration: null,
  copiedMeasures: null,
  copiedStaffIndex: null,
  measureSelectionStart: null,
  canUndo: false,
  canRedo: false,

  setComposition: (composition) => {
    // When loading a composition, ensure createdAt is set if missing, but don't update updatedAt
    if (composition) {
      const now = new Date();
      composition = {
        ...composition,
        createdAt: composition.createdAt || now,
        // Don't update updatedAt when just loading - it will be updated when composition changes
      };
    }
    set({ 
      composition,
      canUndo: historyIndex >= 0,
      canRedo: historyIndex < history.length - 1,
    });
  },

  resetComposition: () => {
    clearHistory();
    const newComposition = updateCompositionWithDates(defaultComposition, {});
    set({
      composition: newComposition,
      selectedStaffIndex: 0,
      selectedMeasureIndex: 0,
      selectedVoiceIndex: 0,
      selectedDuration: 'quarter',
      canUndo: false,
      canRedo: false,
      selectedNote: null,
    });
  },

  undo: () => {
    if (historyIndex >= 0) {
      const current = get().composition;
      // Save current state for redo
      if (current && historyIndex < history.length - 1) {
        history[historyIndex + 1] = JSON.parse(JSON.stringify(current));
      }
      historyIndex--;
      const prevState = history[historyIndex];
      set({
        composition: prevState ? JSON.parse(JSON.stringify(prevState)) : defaultComposition,
        canUndo: historyIndex >= 0,
        canRedo: historyIndex < history.length - 1,
      });
    }
  },

  redo: () => {
    if (historyIndex < history.length - 1) {
      historyIndex++;
      const nextState = history[historyIndex];
      set({
        composition: nextState ? JSON.parse(JSON.stringify(nextState)) : defaultComposition,
        canUndo: true,
        canRedo: historyIndex < history.length - 1,
      });
    }
  },

  addNote: (staffIndex, measureIndex, voiceIndex, element, insertIndex) => {
    const { composition } = get();
    if (!composition) return;
    saveToHistory(composition);

    const newStaves = [...composition.staves];
    const staff = { ...newStaves[staffIndex] };
    const measures = [...staff.measures];
    const measure = { ...measures[measureIndex] };
    const voices = [...measure.voices];
    const voice = { ...voices[voiceIndex] };
    
    // Insert at specific index, or append to end
    if (insertIndex !== undefined && insertIndex >= 0 && insertIndex <= voice.notes.length) {
      voice.notes = [...voice.notes];
      voice.notes.splice(insertIndex, 0, element);
    } else {
      voice.notes = [...voice.notes, element];
    }
    
    voices[voiceIndex] = voice;
    measure.voices = voices;
    measures[measureIndex] = measure;
    staff.measures = measures;
    newStaves[staffIndex] = staff;

    set({
      composition: updateCompositionWithDates(composition, {
        staves: newStaves,
      }),
      canUndo: historyIndex >= 0,
      canRedo: false,
    });
  },

  moveNote: (fromStaff, fromMeasure, fromVoice, fromIndex, toStaff, toMeasure, toVoice, toIndex, newPitch) => {
    const { composition } = get();
    if (!composition) return;
    saveToHistory(composition);

    // Deep-clone staves for immutable update
    const newStaves = JSON.parse(JSON.stringify(composition.staves));

    // Pull the note out of its source position
    const srcVoice = newStaves[fromStaff].measures[fromMeasure].voices[fromVoice];
    const [movedNote] = srcVoice.notes.splice(fromIndex, 1);
    if (!movedNote) return;

    // Optionally update pitch (vertical drag)
    if (newPitch && 'pitch' in movedNote) {
      (movedNote as Note).pitch = newPitch as any;
    }

    // Insert at destination
    const dstVoice = newStaves[toStaff].measures[toMeasure].voices[toVoice];
    // Adjust toIndex if src and dst are the same voice (element already removed)
    const adjustedIndex =
      fromStaff === toStaff && fromMeasure === toMeasure && fromVoice === toVoice && toIndex > fromIndex
        ? toIndex - 1
        : toIndex;
    const clampedIndex = Math.max(0, Math.min(adjustedIndex, dstVoice.notes.length));
    dstVoice.notes.splice(clampedIndex, 0, movedNote);

    set({
      composition: { ...composition, staves: newStaves },
      canUndo: historyIndex >= 0,
      canRedo: false,
    });
  },

  removeNote: (staffIndex, measureIndex, voiceIndex, noteIndex) => {
    const { composition } = get();
    if (!composition) return;
    saveToHistory(composition);

    const newStaves = [...composition.staves];
    const staff = { ...newStaves[staffIndex] };
    const measures = [...staff.measures];
    const measure = { ...measures[measureIndex] };
    const voices = [...measure.voices];
    const voice = { ...voices[voiceIndex] };
    voice.notes = voice.notes.filter((_, i) => i !== noteIndex);
    voices[voiceIndex] = voice;
    measure.voices = voices;
    measures[measureIndex] = measure;
    staff.measures = measures;
    newStaves[staffIndex] = staff;

    set({
      composition: {
        ...composition,
        staves: newStaves,
      },
      canUndo: historyIndex >= 0,
      canRedo: false,
    });
  },

  updateNote: (staffIndex, measureIndex, voiceIndex, noteIndex, updates) => {
    const { composition } = get();
    if (!composition) return;
    saveToHistory(composition);

    const newStaves = [...composition.staves];
    const staff = { ...newStaves[staffIndex] };
    const measures = [...staff.measures];
    const measure = { ...measures[measureIndex] };
    const voices = [...measure.voices];
    const voice = { ...voices[voiceIndex] };
    voice.notes = voice.notes.map((note, i) =>
      i === noteIndex ? { ...note, ...updates } : note
    );
    voices[voiceIndex] = voice;
    measure.voices = voices;
    measures[measureIndex] = measure;
    staff.measures = measures;
    newStaves[staffIndex] = staff;

    set({
      composition: {
        ...composition,
        staves: newStaves,
      },
    });
  },

  addMeasure: (staffIndex) => {
    const { composition } = get();
    if (!composition) return;
    saveToHistory(composition);

    const newStaves = [...composition.staves];
    const staff = { ...newStaves[staffIndex] };
    // Renumber all measures to ensure continuity
    const newMeasure: Measure = {
      number: staff.measures.length + 1,
      voices: [{ notes: [] }],
    };
    
    // Update measure numbers for all measures
    staff.measures.forEach((m, idx) => {
      m.number = idx + 1;
    });
    staff.measures = [...staff.measures, newMeasure];
    newStaves[staffIndex] = staff;

    set({
      composition: {
        ...composition,
        staves: newStaves,
      },
      canUndo: historyIndex >= 0,
      canRedo: false,
    });
  },

  removeMeasure: (staffIndex, measureIndex) => {
    const { composition } = get();
    if (!composition) return;
    saveToHistory(composition);

    const newStaves = [...composition.staves];
    const staff = { ...newStaves[staffIndex] };
    staff.measures = staff.measures.filter((_, i) => i !== measureIndex);
    newStaves[staffIndex] = staff;

    set({
      composition: {
        ...composition,
        staves: newStaves,
      },
      canUndo: historyIndex >= 0,
      canRedo: false,
    });
  },

  copyMeasure: (staffIndex, startMeasureIndex, endMeasureIndex) => {
    const { composition } = get();
    if (!composition) return;
    
    const staff = composition.staves[staffIndex];
    if (!staff) return;

    // Determine the range (if endMeasureIndex not provided, copy just one measure)
    const start = startMeasureIndex;
    const end = endMeasureIndex !== undefined ? endMeasureIndex : startMeasureIndex;
    const actualStart = Math.min(start, end);
    const actualEnd = Math.max(start, end);

    // Validate range
    if (actualStart < 0 || actualEnd >= staff.measures.length) return;

    // Deep copy all measures in the range
    const copiedMeasures: Measure[] = [];
    for (let i = actualStart; i <= actualEnd; i++) {
      const measure = staff.measures[i];
      if (!measure) continue;

      const copiedMeasure: Measure = {
        number: measure.number,
        voices: measure.voices.map(voice => ({
          notes: voice.notes.map(note => {
            // Deep copy each note/rest
            if ('pitch' in note) {
              return { ...note };
            } else {
              return { ...note };
            }
          }),
        })),
        // Copy all optional properties
        timeSignature: measure.timeSignature,
        keySignature: measure.keySignature,
        tempo: measure.tempo,
        clef: measure.clef,
      };
      copiedMeasures.push(copiedMeasure);
    }

    set({ 
      copiedMeasures: copiedMeasures.length > 0 ? copiedMeasures : null,
      copiedStaffIndex: staffIndex,
    });
  },

  pasteMeasure: (targetStaffIndex, targetMeasureIndex, insertAfter: boolean = true) => {
    const { composition, copiedMeasures } = get();
    if (!composition || !copiedMeasures || copiedMeasures.length === 0) return;
    
    saveToHistory(composition);

    const newStaves = [...composition.staves];
    const targetStaff = { ...newStaves[targetStaffIndex] };
    
    // Deep copy all measures to paste
    const pastedMeasures: Measure[] = copiedMeasures.map((copiedMeasure, idx) => ({
      number: targetMeasureIndex + idx + 1, // Will be renumbered
      voices: copiedMeasure.voices.map(voice => ({
        notes: voice.notes.map(note => {
          if ('pitch' in note) {
            return { ...note };
          } else {
            return { ...note };
          }
        }),
      })),
      timeSignature: copiedMeasure.timeSignature,
      keySignature: copiedMeasure.keySignature,
      tempo: copiedMeasure.tempo,
      clef: copiedMeasure.clef,
    }));

    // Insert all measures at the target position
    const newMeasures = [...targetStaff.measures];
    const insertIndex = insertAfter ? targetMeasureIndex + 1 : targetMeasureIndex;
    newMeasures.splice(insertIndex, 0, ...pastedMeasures);
    
    // Renumber all measures
    newMeasures.forEach((m, idx) => {
      m.number = idx + 1;
    });
    
    targetStaff.measures = newMeasures;
    newStaves[targetStaffIndex] = targetStaff;

    // Apply global properties (time/key/tempo) to all staves for each pasted measure
    pastedMeasures.forEach((pastedMeasure, offset) => {
      const finalMeasureIndex = insertIndex + offset;
      if (pastedMeasure.timeSignature || pastedMeasure.keySignature || pastedMeasure.tempo) {
        newStaves.forEach((staff, si) => {
          if (si === targetStaffIndex) return; // Already updated
          const measure = staff.measures[finalMeasureIndex];
          if (measure) {
            if (pastedMeasure.timeSignature) measure.timeSignature = pastedMeasure.timeSignature;
            if (pastedMeasure.keySignature) measure.keySignature = pastedMeasure.keySignature;
            if (pastedMeasure.tempo) measure.tempo = pastedMeasure.tempo;
          } else {
            // If the target staff doesn't have a measure at this index, we need to add one
            const newMeasure: Measure = {
              number: finalMeasureIndex + 1,
              voices: [{ notes: [] }],
            };
            if (pastedMeasure.timeSignature) newMeasure.timeSignature = pastedMeasure.timeSignature;
            if (pastedMeasure.keySignature) newMeasure.keySignature = pastedMeasure.keySignature;
            if (pastedMeasure.tempo) newMeasure.tempo = pastedMeasure.tempo;
            
            // Ensure the staff has enough measures
            while (staff.measures.length <= finalMeasureIndex) {
              staff.measures.push({
                number: staff.measures.length + 1,
                voices: [{ notes: [] }],
              });
            }
            staff.measures[finalMeasureIndex] = newMeasure;
          }
        });
      }
    });

    set({
      composition: updateCompositionWithDates(composition, {
        staves: newStaves,
      }),
      canUndo: historyIndex >= 0,
      canRedo: false,
    });
  },

  addStaff: (staff) => {
    const { composition } = get();
    if (!composition) return;
    saveToHistory(composition);

    set({
      composition: {
        ...composition,
        staves: [...composition.staves, staff],
      },
      canUndo: historyIndex >= 0,
      canRedo: false,
    });
  },

  removeStaff: (staffIndex) => {
    const { composition } = get();
    if (!composition) return;
    saveToHistory(composition);

    set({
      composition: {
        ...composition,
        staves: composition.staves.filter((_, i) => i !== staffIndex),
      },
      canUndo: historyIndex >= 0,
      canRedo: false,
    });
  },

  updateStaffName: (staffIndex, name) => {
    const { composition } = get();
    if (!composition) return;
    saveToHistory(composition);

    const newStaves = [...composition.staves];
    newStaves[staffIndex] = {
      ...newStaves[staffIndex],
      name: name.trim() || undefined, // Remove name if empty
    };

    set({
      composition: {
        ...composition,
        staves: newStaves,
      },
      canUndo: historyIndex >= 0,
      canRedo: false,
    });
  },

  updateMeasureProperties: (measureIndex, props, staffIndex) => {
    const { composition } = get();
    if (!composition) return;
    saveToHistory(composition);

    const newStaves = composition.staves.map((staff, si) => ({
      ...staff,
      measures: staff.measures.map((m, mi) => {
        if (mi !== measureIndex) return m;
        const updated: Measure = { ...m };
        // Global changes (apply to all staves for timing consistency)
        if ('timeSignature' in props) updated.timeSignature = props.timeSignature ?? undefined;
        if ('keySignature'  in props) updated.keySignature  = props.keySignature  ?? undefined;
        if ('tempo'         in props) updated.tempo          = props.tempo         ?? undefined;
        // Clef is staff-specific
        if ('clef' in props && (staffIndex === undefined || si === staffIndex)) {
          updated.clef = props.clef ?? undefined;
        }
        return updated;
      }),
    }));

    set({
      composition: { ...composition, staves: newStaves },
      canUndo: historyIndex >= 0,
      canRedo: false,
    });
  },

  updateTempo: (tempo) => {
    const { composition } = get();
    if (!composition) return;
    saveToHistory(composition);

    set({
      composition: updateCompositionWithDates(composition, { tempo }),
      canUndo: historyIndex >= 0,
      canRedo: false,
    });
  },

  updateTimeSignature: (timeSignature) => {
    const { composition } = get();
    if (!composition) return;
    saveToHistory(composition);

    set({
      composition: updateCompositionWithDates(composition, { timeSignature }),
      canUndo: historyIndex >= 0,
      canRedo: false,
    });
  },

  updateKeySignature: (keySignature) => {
    const { composition } = get();
    if (!composition) return;
    saveToHistory(composition);

    set({
      composition: updateCompositionWithDates(composition, { keySignature }),
      canUndo: historyIndex >= 0,
      canRedo: false,
    });
  },

  updateAuthor: (author) => {
    const { composition } = get();
    if (!composition) return;
    saveToHistory(composition);

    set({
      composition: updateCompositionWithDates(composition, { author: author.trim() || undefined }),
      canUndo: historyIndex >= 0,
      canRedo: false,
    });
  },

  updateArrangedBy: (arrangedBy) => {
    const { composition } = get();
    if (!composition) return;
    saveToHistory(composition);

    set({
      composition: updateCompositionWithDates(composition, { arrangedBy: arrangedBy.trim() || undefined }),
      canUndo: historyIndex >= 0,
      canRedo: false,
    });
  },

  updatePrivacy: (privacy) => {
    const { composition } = get();
    if (!composition) return;
    saveToHistory(composition);

    set({
      composition: updateCompositionWithDates(composition, { 
        privacy,
        // Clear shared emails if not in shared mode
        sharedEmails: privacy === 'shared' ? (composition.sharedEmails || []) : undefined,
      }),
      canUndo: historyIndex >= 0,
      canRedo: false,
    });
  },

  updateSharedEmails: (emails) => {
    const { composition } = get();
    if (!composition) return;
    saveToHistory(composition);

    // Filter out empty emails and trim
    const validEmails = emails
      .map((email) => email.trim())
      .filter((email) => email.length > 0 && email.includes('@'));

    set({
      composition: updateCompositionWithDates(composition, {
        // Store an empty array instead of undefined so Firestore doesn't reject
        sharedEmails: validEmails,
      }),
      canUndo: historyIndex >= 0,
      canRedo: false,
    });
  },

  updateSharePermission: (permission) => {
    const { composition } = get();
    if (!composition) return;
    saveToHistory(composition);
    set({
      composition: updateCompositionWithDates(composition, { sharePermission: permission }),
      canUndo: historyIndex >= 0,
      canRedo: false,
    });
  },

  setAnacrusis: (enabled, pickupBeats) => {
    const { composition } = get();
    if (!composition) return;
    saveToHistory(composition);
    set({
      composition: updateCompositionWithDates(composition, {
        anacrusis: enabled,
        pickupBeats: enabled ? (pickupBeats ?? composition.pickupBeats ?? 1) : undefined,
      }),
      canUndo: historyIndex >= 0,
      canRedo: false,
    });
  },

  setShowMeasureNumbers: (show) => {
    const { composition } = get();
    if (!composition) return;
    // Don't save to history for display preferences
    set({
      composition: {
        ...composition,
        showMeasureNumbers: show,
      },
    });
  },

  setSelectedStaffIndex: (index) => set({ selectedStaffIndex: index }),
  setSelectedMeasureIndex: (index) => set({ selectedMeasureIndex: index }),
  setMeasureSelectionStart: (index) => set({ measureSelectionStart: index }),
  setSelectedVoiceIndex: (index) => set({ selectedVoiceIndex: index }),
  setSelectedDuration: (duration) => set({ selectedDuration: duration }),
  selectedRestDuration: null,
  setSelectedRestDuration: (duration) => set({ selectedRestDuration: duration }),
  selectedNote: null,
  setSelectedNote: (note) => set({ selectedNote: note }),
  deleteSelectedNote: () => {
    const { selectedNote, removeNote } = get();
    if (selectedNote) {
      removeNote(
        selectedNote.staffIndex,
        selectedNote.measureIndex,
        selectedNote.voiceIndex,
        selectedNote.noteIndex
      );
      set({ selectedNote: null });
    }
  },
}));
