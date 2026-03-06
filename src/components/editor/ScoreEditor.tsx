import { useEffect, useMemo, useRef, useState } from 'react';
import { useScoreStore } from '../../app/store/scoreStore';
import { usePlaybackStore, PlayingNoteRef } from '../../app/store/playbackStore';
import { ToneScheduler } from '../../music/playback/toneScheduler';
import {
  VexFlowRenderer,
  MEASURE_WIDTH,
  LEFT_MARGIN,
  CLEF_WIDTH,
  ROW_SPACING,
  STAVE_Y_START,
  STAFF_LINE_OFFSET,
  STEP_SIZE,
  getMeasureLayout,
  RenderedNotePosition,
} from '../../music/renderer/vexflowRenderer';
import { Note, Rest, MusicElement } from '../../types/music';
import { midiToPitch, pitchToMidi, applyKeySignature, applyKeySignatureAndMeasureAccidentals } from '../../utils/noteUtils';
import { durationToBeats } from '../../utils/durationUtils';

// ── Diatonic step lookup tables ──────────────────────────────────────────────
// step 0 = top staff line, each step = STEP_SIZE px downward
// Treble clef: top line = F5 (MIDI 77)
const TREBLE_STEP_TO_MIDI: Record<number, number> = {
  '-4': 84, // C6
  '-3': 83, // B5
  '-2': 81, // A5
  '-1': 79, // G5
   '0': 77, // F5  ← top line
   '1': 76, // E5
   '2': 74, // D5
   '3': 72, // C5
   '4': 71, // B4  ← middle line
   '5': 69, // A4
   '6': 67, // G4
   '7': 65, // F4
   '8': 64, // E4  ← bottom line
   '9': 62, // D4
  '10': 60, // C4  (middle C, 1st ledger below)
  '11': 59, // B3
  '12': 57, // A3  (2nd ledger below)
  '13': 55, // G3
  '14': 53, // F3
  '15': 52, // E3
  '16': 50, // D3
  '17': 48, // C3
};

// Bass clef: top line = A3 (MIDI 57)
const BASS_STEP_TO_MIDI: Record<number, number> = {
  '-4': 64, // E4
  '-3': 62, // D4
  '-2': 60, // C4  (middle C)
  '-1': 59, // B3
   '0': 57, // A3  ← top line
   '1': 55, // G3
   '2': 53, // F3
   '3': 52, // E3
   '4': 50, // D3  ← middle line
   '5': 48, // C3
   '6': 47, // B2
   '7': 45, // A2
   '8': 43, // G2  ← bottom line
   '9': 41, // F2
  '10': 40, // E2  (1st ledger below)
  '11': 38, // D2
  '12': 36, // C2  (2nd ledger below)
};

// Reverse maps: MIDI → diatonic step (for pitchToSvgY)
const TREBLE_MIDI_TO_STEP: Record<number, number> = {};
Object.entries(TREBLE_STEP_TO_MIDI).forEach(([step, midi]) => {
  TREBLE_MIDI_TO_STEP[midi] = Number(step);
});
const BASS_MIDI_TO_STEP: Record<number, number> = {};
Object.entries(BASS_STEP_TO_MIDI).forEach(([step, midi]) => {
  BASS_MIDI_TO_STEP[midi] = Number(step);
});

function midiToDiatonicStep(midi: number, clef: 'treble' | 'bass'): number {
  const table = clef === 'treble' ? TREBLE_MIDI_TO_STEP : BASS_MIDI_TO_STEP;
  if (table[midi] !== undefined) return table[midi];
  if (table[midi - 1] !== undefined) return table[midi - 1];
  if (table[midi + 1] !== undefined) return table[midi + 1];
  const ref = clef === 'treble' ? 77 : 57;
  return Math.round((ref - midi) / 1.75);
}

// ── Types ────────────────────────────────────────────────────────────────────

interface NoteRef {
  staffIndex: number;
  measureIndex: number;
  voiceIndex: number;
  noteIndex: number;
  svgX: number; // estimated SVG x of the note head
  svgY: number; // estimated SVG y of the note head
}

interface DragState {
  noteRef: NoteRef;
  startClientX: number;
  startClientY: number;
  currentClientX: number;
  currentClientY: number;
  hasMoved: boolean;     // moved > DRAG_THRESHOLD px
  offStaff: boolean;     // currently outside the staff's vertical bounds
  // Live drag-to-move target (computed in handleMouseMove)
  targetPitch: string | null;
  targetStaffIndex: number;
  targetMeasureIndex: number;
  targetInsertIndex: number;
}

const LONG_PRESS_MS   = 600; // ms to hold before delete triggers
const DRAG_THRESHOLD  = 8;   // px of movement to enter drag mode

// ────────────────────────────────────────────────────────────────────────────

interface ScoreEditorProps {
  isReadOnly?: boolean;
}

export const ScoreEditor = ({ isReadOnly = false }: ScoreEditorProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef  = useRef<VexFlowRenderer | null>(null);

  const composition        = useScoreStore((s) => s.composition);
  const selectedVoiceIndex = useScoreStore((s) => s.selectedVoiceIndex);
  const selectedDuration   = useScoreStore((s) => s.selectedDuration);
  const selectedRestDuration = useScoreStore((s) => s.selectedRestDuration);
  const selectedNote       = useScoreStore((s) => s.selectedNote);
  const selectedMeasureIndex = useScoreStore((s) => s.selectedMeasureIndex);
  const measureSelectionStart = useScoreStore((s) => s.measureSelectionStart);
  const selectedStaffIndex   = useScoreStore((s) => s.selectedStaffIndex);
  const addNote            = useScoreStore((s) => s.addNote);
  const moveNote           = useScoreStore((s) => s.moveNote);
  const setSelectedNote    = useScoreStore((s) => s.setSelectedNote);
  const setSelectedRestDuration = useScoreStore((s) => s.setSelectedRestDuration);
  const deleteSelectedNote = useScoreStore((s) => s.deleteSelectedNote);
  const playingNotes       = usePlaybackStore((s) => s.playingNotes);
  const playbackState     = usePlaybackStore((s) => s.state);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const visibleStaffIndices = useMemo(
    () => (composition ? composition.staves.map((staff, index) => ({ staff, index })).filter(({ staff }) => !staff.hidden).map(({ index }) => index) : []),
    [composition]
  );
  const hasVisibleStaves = visibleStaffIndices.length > 0;
  const getTopLineYForStaff = (staffIndex: number): number | null => {
    const rowIndex = visibleStaffIndices.indexOf(staffIndex);
    if (rowIndex < 0) return null;
    return STAVE_Y_START + rowIndex * ROW_SPACING + STAFF_LINE_OFFSET;
  };

  // Long-press state
  const longPressTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressNoteRef  = useRef<NoteRef | null>(null);
  const [longPressRing, setLongPressRing] = useState<{ x: number; y: number } | null>(null);

  // Drag state
  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragStateRef = useRef<DragState | null>(null); // sync ref for mousemove handler

  // Track whether the upcoming mouseup should skip "add note" (already handled)
  const suppressAddNote = useRef(false);
  
  // Track touch interaction state for mobile scrolling
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const isInteracting = useRef(false); // true when actually interacting with notes, false when just scrolling

  // Auto-scroll: track the last measure we scrolled to so we only scroll once per measure
  const lastAutoScrollMeasureRef = useRef<number>(-1);

  // Preview scheduler for note previews (uses actual instrument sounds)
  const previewSchedulerRef = useRef<ToneScheduler | null>(null);

  // Initialize preview scheduler
  useEffect(() => {
    previewSchedulerRef.current = new ToneScheduler();
    return () => {
      previewSchedulerRef.current?.dispose();
      previewSchedulerRef.current = null;
    };
  }, []);

  // ── Preview note sound ───────────────────────────────────────────────────────
  const previewNote = async (pitch: string, staffIndex: number) => {
    if (!composition || !previewSchedulerRef.current) return;
    
    try {
      const staff = composition.staves[staffIndex];
      const instrument = staff?.instrument ?? 'piano';
      
      // Use the scheduler's preview method which uses the actual instrument
      await previewSchedulerRef.current.previewNote(
        pitch,
        instrument,
        composition.keySignature,
        '0.2' // 200ms preview
      );
    } catch (err) {
      // Silently fail - preview is non-critical
      console.debug('Preview note failed:', err);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !composition) return;
    if (!rendererRef.current) {
      rendererRef.current = new VexFlowRenderer(containerRef.current, {
        width: 1200,
        height: 600,
      });
    }
    rendererRef.current.render(composition, playingNotes, selectedMeasureIndex, measureSelectionStart, selectedNote, selectedStaffIndex);
  }, [composition, playingNotes, selectedMeasureIndex, measureSelectionStart, selectedNote, selectedStaffIndex]);

  useEffect(() => {
    const handleResize = () => {
      if (rendererRef.current && containerRef.current && composition) {
        rendererRef.current.resize(
          containerRef.current.clientWidth,
          containerRef.current.clientHeight
        );
        rendererRef.current.render(composition);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [composition]);

  // ── Helper: extract coordinates from mouse or touch event ───────────────
  const getEventCoordinates = (e: React.MouseEvent | React.TouchEvent): { clientX: number; clientY: number } | null => {
    if ('touches' in e && e.touches.length > 0) {
      // Touch event
      return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
    } else if ('clientX' in e) {
      // Mouse event
      return { clientX: e.clientX, clientY: e.clientY };
    }
    return null;
  };

  // ── Helper: screen → SVG coords ─────────────────────────────────────────
  const clientToSvg = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const svgEl = containerRef.current?.querySelector('svg') as SVGSVGElement | null;
    if (!svgEl) return null;
    const pt = svgEl.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return null;
    return pt.matrixTransform(ctm.inverse());
  };

  // ── Helper: find note near SVG coords using ACTUAL rendered positions ────
  const findNoteNear = (
    x: number, y: number,
    staffIndex: number, measureIndex: number, voiceIndex: number
  ): NoteRef | null => {
    if (!composition || !rendererRef.current) return null;

    const positions = rendererRef.current.getNotePositions().filter(
      (p) => p.staffIndex === staffIndex && p.measureIndex === measureIndex && p.voiceIndex === voiceIndex
    );
    if (positions.length === 0) return null;

    // Hit tolerance — generous enough to be usable, tight enough to be precise
    const X_TOL = 16;
    const Y_TOL = 12;

    let best: { pos: RenderedNotePosition; dist: number } | null = null;

    for (const pos of positions) {
      const dx = Math.abs(x - pos.x);
      const dy = Math.abs(y - pos.y);
      if (dx <= X_TOL && dy <= Y_TOL) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (!best || dist < best.dist) best = { pos, dist };
      }
    }

    if (!best) return null;
    return {
      staffIndex,
      measureIndex,
      voiceIndex,
      noteIndex: best.pos.noteDataIndex,
      svgX: best.pos.x,
      svgY: best.pos.y,
    };
  };

  // ── Helper: calculate insertion index from X position ─────────────────
  // Calculates based on beat positions to handle VexFlow's automatic spacing.
  const calculateInsertionIndex = (
    x: number,
    staffIndex: number,
    measureIndex: number,
    voiceIndex: number
  ): number => {
    if (!composition) return 0;
    const voice = composition.staves[staffIndex]?.measures[measureIndex]?.voices[voiceIndex];
    if (!voice) return 0;

    // Empty measure → insert at start
    if (voice.notes.length === 0) return 0;

    // Get measure layout
    const layout = getMeasureLayout(composition);
    const { x: measureStartX, width: measureWidth } = layout[measureIndex] ?? {
      x: LEFT_MARGIN + CLEF_WIDTH + measureIndex * MEASURE_WIDTH,
      width: MEASURE_WIDTH,
    };

    // Calculate relative X within the measure (accounting for padding)
    const relativeX = x - measureStartX - 15; // 15px left padding
    const usableWidth = measureWidth - 30; // Total usable width

    if (relativeX < 0) return 0;
    if (relativeX > usableWidth) return voice.notes.length; // Append to end

    // Get beats per measure from time signature
    const [beatsPerMeasure] = composition.timeSignature.split('/').map(Number);
    const measureBeats = composition.anacrusis && measureIndex === 0
      ? (composition.pickupBeats ?? 1)
      : beatsPerMeasure;

    // Calculate total beats currently used in the measure
    let totalBeats = 0;
    voice.notes.forEach((el) => {
      totalBeats += durationToBeats(el.duration);
    });

    // Map X position to beat position within the measure's full capacity
    // This ensures clicks map correctly even when the measure isn't full
    const targetBeatFraction = relativeX / usableWidth;
    const targetBeats = targetBeatFraction * measureBeats;
    
    // Clamp to the measure's capacity (can't insert beyond measure end)
    const clampedTargetBeats = Math.min(targetBeats, measureBeats);

    // Find insertion point by accumulating beats
    let cumBeats = 0;
    for (let i = 0; i < voice.notes.length; i++) {
      const beats = durationToBeats(voice.notes[i].duration);
      // Insert before this note if target is before its midpoint
      if (clampedTargetBeats < cumBeats + beats / 2) {
        return i;
      }
      cumBeats += beats;
    }

    // Insert at end
    return voice.notes.length;
  };

  // ── Helper: resolve staff + measure from SVG coords ─────────────────────
  const resolveStaffMeasure = (
    x: number, y: number
  ): { staffIndex: number; measureIndex: number } | null => {
    if (!composition) return null;
    let staffIndex = -1;
    visibleStaffIndices.forEach((si) => {
      const topLineY = getTopLineYForStaff(si);
      if (topLineY === null) return;
      const topLine    = topLineY;
      const bottomLine = topLine + 4 * 10;
      if (y >= topLine - 25 && y <= bottomLine + 25) staffIndex = si;
    });
    if (staffIndex === -1) return null;

    // Use layout so anacrusis (variable-width) first measure is handled correctly
    const layout = getMeasureLayout(composition);
    let measureIndex = layout.length - 1; // default to last
    for (let i = 0; i < layout.length; i++) {
      const { x: mx, width: mw } = layout[i];
      if (x >= mx && x < mx + mw) { measureIndex = i; break; }
    }

    const maxMeasure = composition.staves[staffIndex].measures.length - 1;
    return { staffIndex, measureIndex: Math.min(measureIndex, maxMeasure) };
  };

  // ── Helper: SVG Y + staff → diatonic pitch string ───────────────────────
  const svgYToPitch = (svgY: number, staffIndex: number, clef: 'treble' | 'bass'): string => {
    const topLineY = getTopLineYForStaff(staffIndex);
    if (topLineY === null) return midiToPitch(clef === 'treble' ? 60 : 48);
    const relativeY = svgY - topLineY;
    const step      = Math.round(relativeY / STEP_SIZE);
    const stepMap: Record<string, number> = clef === 'treble' ? TREBLE_STEP_TO_MIDI : BASS_STEP_TO_MIDI;
    const steps     = Object.keys(stepMap).map(Number).sort((a, b) => a - b);
    const clamped   = Math.max(steps[0], Math.min(steps[steps.length - 1], step));
    let midi = stepMap[String(step)] ?? stepMap[String(clamped)] ?? (clef === 'treble' ? 77 : 57);
    midi = Math.max(21, Math.min(108, midi));
    return midiToPitch(midi);
  };

  // ── Long-press helpers ───────────────────────────────────────────────────
  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    longPressNoteRef.current = null;
    setLongPressRing(null);
  };

  // ── Unified pointer down handler (mouse or touch) ────────────────────────
  const handlePointerDown = (clientX: number, clientY: number, event?: React.MouseEvent | React.TouchEvent) => {
    // In read-only mode, block all editing interactions
    if (isReadOnly) return;

    suppressAddNote.current = false;

    const svg = clientToSvg(clientX, clientY);
    if (!svg || !composition) return;

    const loc = resolveStaffMeasure(svg.x, svg.y);
    if (!loc) { setSelectedNote(null); return; }

    const note = findNoteNear(svg.x, svg.y, loc.staffIndex, loc.measureIndex, selectedVoiceIndex);
    if (!note) return; // not on a note — pointerUp will handle addNote

    suppressAddNote.current = true; // we're interacting with an existing note

    // --- Start long-press timer ---
    longPressNoteRef.current = note;
    setLongPressRing({ x: clientX, y: clientY });

    longPressTimer.current = setTimeout(() => {
      // Long press fires: delete
      const ref = longPressNoteRef.current;
      if (ref) {
        setSelectedNote(ref);
        // Give setState a tick to propagate, then delete
        setTimeout(() => {
          useScoreStore.getState().deleteSelectedNote();
        }, 0);
      }
      cancelLongPress();
      dragStateRef.current = null;
      setDragState(null);
    }, LONG_PRESS_MS);

    // --- Start drag tracking ---
    const ds: DragState = {
      noteRef: note,
      startClientX: clientX,
      startClientY: clientY,
      currentClientX: clientX,
      currentClientY: clientY,
      hasMoved: false,
      offStaff: false,
      targetPitch: null,
      targetStaffIndex: note.staffIndex,
      targetMeasureIndex: note.measureIndex,
      targetInsertIndex: note.noteIndex,
    };
    dragStateRef.current = ds;
    setDragState(ds);
  };

  // ── Mouse down ──────────────────────────────────────────────────────────
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // left button only
    handlePointerDown(e.clientX, e.clientY, e);
  };

  // ── Unified pointer move handler (mouse or touch) ────────────────────────
  const handlePointerMove = (clientX: number, clientY: number) => {
    const ds = dragStateRef.current;
    if (!ds) return;

    const dx = clientX - ds.startClientX;
    const dy = clientY - ds.startClientY;
    const moved = Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD;

    // Once the user starts moving, cancel the long-press timer
    if (moved && longPressTimer.current) {
      cancelLongPress();
    }

    let offStaff = false;
    let targetPitch: string | null = ds.targetPitch;
    let targetStaffIndex = ds.targetStaffIndex;
    let targetMeasureIndex = ds.targetMeasureIndex;
    let targetInsertIndex = ds.targetInsertIndex;

    if (moved && composition) {
      const svg = clientToSvg(clientX, clientY);
      if (svg) {
        // Resolve which staff/measure the cursor is over
        const loc = resolveStaffMeasure(svg.x, svg.y);
        if (loc) {
          const staff = composition.staves[loc.staffIndex];
          const clef = (staff.clef === 'treble' || staff.clef === 'alto' || staff.clef === 'tenor')
            ? 'treble' : 'bass';

          targetStaffIndex   = loc.staffIndex;
          targetMeasureIndex = loc.measureIndex;
          targetPitch        = svgYToPitch(svg.y, loc.staffIndex, clef);
          targetInsertIndex  = calculateInsertionIndex(svg.x, loc.staffIndex, loc.measureIndex, ds.noteRef.voiceIndex);
          offStaff           = false;
        } else {
          // Cursor left all staves
          const si = ds.noteRef.staffIndex;
          const topLine = getTopLineYForStaff(si);
          if (topLine === null) {
            offStaff = true;
            const updated: DragState = {
              ...ds,
              currentClientX: clientX,
              currentClientY: clientY,
              hasMoved: moved,
              offStaff,
              targetPitch,
              targetStaffIndex,
              targetMeasureIndex,
              targetInsertIndex,
            };
            dragStateRef.current = updated;
            setDragState({ ...updated });
            return;
          }
          const bottomLine = topLine + 4 * 10;
          offStaff = svg.y < topLine - 40 || svg.y > bottomLine + 40;
        }
      }
    }

    const updated: DragState = {
      ...ds,
      currentClientX: clientX,
      currentClientY: clientY,
      hasMoved: moved,
      offStaff,
      targetPitch,
      targetStaffIndex,
      targetMeasureIndex,
      targetInsertIndex,
    };
    dragStateRef.current = updated;
    setDragState({ ...updated });
  };

  // ── Mouse move ──────────────────────────────────────────────────────────
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    handlePointerMove(e.clientX, e.clientY);
  };

  // ── Unified pointer up handler (mouse or touch) ─────────────────────────
  const handlePointerUp = (clientX: number, clientY: number) => {
    // In read-only mode, block all editing interactions
    if (isReadOnly) return;
    
    cancelLongPress();

    const ds = dragStateRef.current;
    dragStateRef.current = null;
    setDragState(null);

    if (ds) {
      if (ds.hasMoved && ds.offStaff) {
        // ── Drag off-staff → delete ──────────────────────────────────────
        setSelectedNote(ds.noteRef);
        setTimeout(() => { useScoreStore.getState().deleteSelectedNote(); }, 0);
        return;
      }

      if (ds.hasMoved && !ds.offStaff) {
        // ── Drag on-staff → MOVE note ────────────────────────────────────
        const { noteRef } = ds;
        const newPitch = ds.targetPitch ?? undefined;
        moveNote(
          noteRef.staffIndex, noteRef.measureIndex, noteRef.voiceIndex, noteRef.noteIndex,
          ds.targetStaffIndex, ds.targetMeasureIndex, noteRef.voiceIndex, ds.targetInsertIndex,
          newPitch
        );
        
        // Preview the new pitch if it changed
        if (newPitch) {
          previewNote(newPitch, ds.targetStaffIndex);
        }
        return;
      }

      if (!ds.hasMoved) {
        // ── Short click on note → select ─────────────────────────────────
        setSelectedNote(ds.noteRef);
        useScoreStore.getState().setSelectedMeasureIndex(ds.noteRef.measureIndex);
        useScoreStore.getState().setSelectedStaffIndex(ds.noteRef.staffIndex);
        return;
      }

      return;
    }

    // No drag state → click on empty staff → add note
    if (suppressAddNote.current) return;

    const svg = clientToSvg(clientX, clientY);
    if (!svg || !composition) return;

    const loc = resolveStaffMeasure(svg.x, svg.y);
    if (!loc) { setSelectedNote(null); return; }

    const { staffIndex, measureIndex } = loc;
    const staff = composition.staves[staffIndex];
    const clef  = (staff.clef === 'treble' || staff.clef === 'alto' || staff.clef === 'tenor') ? 'treble' : 'bass';

    setSelectedNote(null);
    useScoreStore.getState().setSelectedMeasureIndex(measureIndex);
    useScoreStore.getState().setSelectedStaffIndex(staffIndex);

    const insertIndex = calculateInsertionIndex(svg.x, staffIndex, measureIndex, selectedVoiceIndex);

    // Check if rest mode is active
    if (selectedRestDuration) {
      const rest: Rest = { duration: selectedRestDuration };
      addNote(staffIndex, measureIndex, selectedVoiceIndex, rest, insertIndex);
      // Clear rest selection after adding (user can click again to add more)
      setSelectedRestDuration(null);
    } else {
      // Add note as before
      let pitch = svgYToPitch(svg.y, staffIndex, clef);
      
      // Apply measure-level accidentals if they exist (for playback/placement)
      // This ensures new notes automatically get the correct accidental from previous notes
      const measure = staff.measures[measureIndex];
      const keySignature = composition.keySignature;
      const actualPitch = applyKeySignatureAndMeasureAccidentals(
        pitch,
        keySignature,
        measure as any,
        insertIndex
      );
      
      // Use the actual pitch (with measure-level accidental applied) for the note
      // But store the base pitch without accidental in the note object
      // The accidental will be applied during playback/rendering
      const note: Note = { pitch: actualPitch, duration: selectedDuration };
      addNote(staffIndex, measureIndex, selectedVoiceIndex, note, insertIndex);
      
      // Preview the note sound using the actual pitch (with accidentals applied)
      previewNote(actualPitch, staffIndex);
    }
  };

  // ── Mouse up ─────────────────────────────────────────────────────────────
  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    handlePointerUp(e.clientX, e.clientY);
  };

  // ── Touch start ────────────────────────────────────────────────────────
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    // Only handle single touch (ignore multi-touch gestures)
    if (e.touches.length > 1) {
      cancelLongPress();
      dragStateRef.current = null;
      setDragState(null);
      isInteracting.current = false;
      touchStartPos.current = null;
      return;
    }
    const coords = getEventCoordinates(e);
    if (coords) {
      touchStartPos.current = { x: coords.clientX, y: coords.clientY };
      isInteracting.current = false;
      
      // Check if we're starting on a note
      const svg = clientToSvg(coords.clientX, coords.clientY);
      if (svg && composition) {
        const loc = resolveStaffMeasure(svg.x, svg.y);
        if (loc) {
          const note = findNoteNear(svg.x, svg.y, loc.staffIndex, loc.measureIndex, selectedVoiceIndex);
          if (note) {
            // We're starting on a note - this is an interaction, prevent scrolling
            isInteracting.current = true;
            e.preventDefault();
            handlePointerDown(coords.clientX, coords.clientY, e);
            return;
          }
        }
      }
      // If not on a note, allow scrolling (don't prevent default, don't call handlePointerDown)
    }
  };

  // ── Touch move ───────────────────────────────────────────────────────────
  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    // Only handle single touch (ignore multi-touch gestures)
    if (e.touches.length > 1) {
      isInteracting.current = false;
      touchStartPos.current = null;
      return;
    }
    
    const coords = getEventCoordinates(e);
    if (!coords || !touchStartPos.current) return;
    
    // If we're already interacting (started on a note or dragging), handle it
    if (isInteracting.current || dragStateRef.current) {
      e.preventDefault();
      handlePointerMove(coords.clientX, coords.clientY);
      return;
    }
    
    // Calculate movement distance
    const dx = Math.abs(coords.clientX - touchStartPos.current.x);
    const dy = Math.abs(coords.clientY - touchStartPos.current.y);
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // If movement is significant, check if we should start an interaction
    if (distance > DRAG_THRESHOLD) {
      // Check if we're moving over a note
      const svg = clientToSvg(coords.clientX, coords.clientY);
      if (svg && composition) {
        const loc = resolveStaffMeasure(svg.x, svg.y);
        if (loc) {
          const note = findNoteNear(svg.x, svg.y, loc.staffIndex, loc.measureIndex, selectedVoiceIndex);
          if (note) {
            // We're moving over a note - start interaction
            isInteracting.current = true;
            e.preventDefault();
            // Initialize pointer down first, then move
            handlePointerDown(touchStartPos.current.x, touchStartPos.current.y, e);
            handlePointerMove(coords.clientX, coords.clientY);
            return;
          }
        }
      }
      // If primarily vertical movement and not on a note, allow scrolling
      if (dy > dx) {
        // Vertical scrolling - don't prevent default
        return;
      }
    }
    
    // For small movements, allow scrolling (don't prevent default)
  };

  // ── Touch end ───────────────────────────────────────────────────────────
  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    // Only prevent default if we were actually interacting
    if (isInteracting.current) {
      e.preventDefault();
    }
    
    // Use changedTouches for touch end (more reliable than touches)
    if (e.changedTouches.length > 0) {
      const touch = e.changedTouches[0];
      if (isInteracting.current) {
        handlePointerUp(touch.clientX, touch.clientY);
      }
    } else {
      // Fallback to getEventCoordinates if changedTouches is empty
      const coords = getEventCoordinates(e);
      if (coords && isInteracting.current) {
        handlePointerUp(coords.clientX, coords.clientY);
      }
    }
    
    // Reset interaction state
    isInteracting.current = false;
    touchStartPos.current = null;
  };

  // ── Touch cancel ────────────────────────────────────────────────────────
  const handleTouchCancel = () => {
    cancelLongPress();
    // If dragging, cancel (don't delete unless released outside)
    dragStateRef.current = null;
    setDragState(null);
    isInteracting.current = false;
    touchStartPos.current = null;
  };

  // ── Mouse leave — cancel interactions if pointer leaves the editor ───────
  const handleMouseLeave = () => {
    cancelLongPress();
    // If dragging, cancel (don't delete unless released outside)
    dragStateRef.current = null;
    setDragState(null);
  };

  // ── Keyboard delete (still supported as bonus) ───────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNote && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        deleteSelectedNote();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNote, deleteSelectedNote]);

  // ── Derived drag visuals ─────────────────────────────────────────────────
  const isDragging   = dragState?.hasMoved ?? false;
  const dragOffStaff = dragState?.offStaff ?? false;
  const dragPitch    = dragState?.targetPitch ?? null;

  // Auto-scroll to keep the currently playing note centred horizontally.
  // We throttle by measure: only scroll once each time the playback moves to a
  // new measure, so we don't fight 60-fps note updates cancelling the scroll.
  useEffect(() => {
    if (playbackState !== 'playing' || !scrollContainerRef.current || !rendererRef.current) return;
    if (playingNotes.size === 0) return;

    // ── 1. Determine which measure is currently playing ──────────────────────
    // Pull the measureIndex from the first entry in the set
    const firstEntry = playingNotes.values().next().value as string | undefined;
    if (!firstEntry) return;
    const parts = firstEntry.split(':').map(Number);
    const currentMeasure = parts[1]; // measureIndex

    // Only re-scroll when the playhead moves to a new measure
    if (currentMeasure === lastAutoScrollMeasureRef.current) return;
    lastAutoScrollMeasureRef.current = currentMeasure;

    // ── 2. Find the SVG X position of the first playing note ────────────────
    const allPositions = rendererRef.current.getNotePositions();
    let totalX = 0;
    let found = 0;

    playingNotes.forEach((serialized) => {
      const [si, mi, vi, ni] = serialized.split(':').map(Number);
      const pos = allPositions.find(
        (p) => p.staffIndex === si &&
               p.measureIndex === mi &&
               p.voiceIndex === vi &&
               p.noteDataIndex === ni   // scheduler uses the data-index (voice.notes[i])
      );
      if (pos) {
        totalX += pos.x;
        found++;
      }
    });

    if (found === 0) return;
    const targetSvgX = totalX / found;

    // ── 3. Convert SVG-space X → scroll-container scroll position ────────────
    const container = scrollContainerRef.current;
    const svgEl = containerRef.current?.querySelector('svg') as SVGSVGElement | null;
    if (!svgEl) return;

    const ctm = svgEl.getScreenCTM();
    if (!ctm) return;

    // Transform the SVG point to screen coordinates
    const pt = svgEl.createSVGPoint();
    pt.x = targetSvgX;
    pt.y = 0;
    const screenX = pt.matrixTransform(ctm).x;

    // Convert screen X → position within the scrollable content
    const containerRect = container.getBoundingClientRect();
    const noteXInContent = screenX - containerRect.left + container.scrollLeft;

    // Scroll so the note is centred horizontally in the viewport
    const desiredScrollLeft = noteXInContent - container.clientWidth / 2;

    container.scrollTo({
      left: Math.max(0, desiredScrollLeft),
      behavior: 'smooth',
    });
  }, [playingNotes, playbackState]);  // no 'composition' dep — we only need note positions

  // Reset the auto-scroll measure tracker when playback stops
  useEffect(() => {
    if (playbackState !== 'playing') {
      lastAutoScrollMeasureRef.current = -1;
    }
  }, [playbackState]);

  return (
    <div 
      ref={scrollContainerRef}
      className="w-full h-full overflow-auto bg-sv-bg relative select-none"
      style={{ padding: '16px' }}>
      {/* Score canvas — white sheet paper on dark background */}
      {/* display:inline-block + minWidth:100% → the card expands to the SVG's intrinsic
          width so the outer overflow-auto container sees the real content width and
          creates a horizontal scrollbar when the score is wider than the viewport.    */}
      <div
        style={{
          background: '#fff',
          borderRadius: '8px',
          boxShadow: '0 4px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)',
          minHeight: '600px',
          display: 'inline-block',
          minWidth: '100%',
          verticalAlign: 'top',
        }}
      >
        <div
          ref={containerRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchCancel}
          className="min-h-[600px] relative"
          style={{
            cursor: isReadOnly
              ? 'default'
              : isDragging
              ? dragOffStaff ? 'no-drop' : 'grabbing'
              : 'crosshair',
            touchAction: 'pan-x pan-y', // Allow both horizontal and vertical scrolling
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none',
          }}
          title={isReadOnly ? 'View only — click Edit to make changes' : 'Click to add · Drag to move · Hold to delete · Drag off staff to remove'}
        />
        {!hasVisibleStaves && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="px-3 py-2 rounded-lg bg-sv-card/90 border border-sv-border text-sv-text-muted text-sm">
              All staves are hidden. Use Staff controls to show at least one staff.
            </div>
          </div>
        )}
      </div>

      {/* ── Long-press ring animation ───────────────────────────────────── */}
      {longPressRing && (
        <div
          className="pointer-events-none fixed z-50"
          style={{ left: longPressRing.x - 16, top: longPressRing.y - 16 }}
        >
          <svg width="32" height="32" viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="13" fill="none" stroke="#e2e8f0" strokeWidth="3" />
            <circle
              cx="16" cy="16" r="13"
              fill="none" stroke="#ef4444" strokeWidth="3"
              strokeDasharray="81.68" strokeDashoffset="81.68"
              strokeLinecap="round" transform="rotate(-90 16 16)"
              style={{ animation: `longPressRing ${LONG_PRESS_MS}ms linear forwards` }}
            />
          </svg>
        </div>
      )}

      {/* ── Ghost note badge while dragging ────────────────────────────── */}
      {isDragging && dragState && (
        <div
          className="pointer-events-none fixed z-50 flex flex-col items-center gap-1"
          style={{
            left: dragState.currentClientX + 14,
            top:  dragState.currentClientY - 24,
          }}
        >
          {/* Pitch badge (shown when on-staff) */}
          {!dragOffStaff && dragPitch && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-md shadow-lg"
                  style={{ background: 'var(--sv-cyan)', color: 'var(--sv-bg)' }}>
              {dragPitch}
            </span>
          )}

          {/* Drag indicator dot */}
          <div className="w-4 h-4 rounded-full border-2 shadow-md"
               style={{
                 background: dragOffStaff ? '#f43f5e' : 'var(--sv-cyan)',
                 borderColor: dragOffStaff ? '#9f1239' : 'var(--sv-cyan-dim)',
               }} />

          {/* Delete hint when off staff */}
          {dragOffStaff && (
            <span className="text-xs font-semibold whitespace-nowrap px-2 py-0.5 rounded-md shadow-lg"
                  style={{ background: 'var(--sv-panel)', color: '#f87171', border: '1px solid #f43f5e40' }}>
              Release to delete
            </span>
          )}
        </div>
      )}

      {/* ── Status bar ─────────────────────────────────────────────────── */}
      {selectedNote && !isDragging && (
        <div className="hidden sm:flex fixed bottom-20 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full shadow-lg text-sm pointer-events-none items-center gap-2"
             style={{ background: 'var(--sv-panel)', border: '1px solid var(--sv-cyan)', color: 'var(--sv-cyan)', boxShadow: '0 0 16px rgba(0,212,245,0.2)' }}>
          <span className="w-1.5 h-1.5 rounded-full bg-sv-cyan" style={{ background: 'var(--sv-cyan)', boxShadow: '0 0 4px var(--sv-cyan)' }} />
          <span>Note selected</span>
          <span className="opacity-40">·</span>
          <span className="text-xs opacity-60">Drag to move · Hold or drag off staff to delete</span>
        </div>
      )}

      {/* ── Keyframes ────────────────────────────────────────────────── */}
      <style>{`
        @keyframes longPressRing {
          from { stroke-dashoffset: 81.68; }
          to   { stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  );
};
