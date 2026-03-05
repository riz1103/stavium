import { Renderer, Stave, StaveNote, Voice, Formatter, Accidental, Dot, Articulation, StaveTie, Beam, Stem, RendererBackends } from 'vexflow';
import { Clef, Composition, Measure, Note, Rest, NoteDuration } from '../../types/music';
import { parsePitch, pitchToVexFlowKey, pitchToMidi, keySignatureToVexFlow, shouldShowAccidental, findMeasureAccidental, getKeySignatureAccidentals } from '../../utils/noteUtils';
import { durationToVexFlow } from '../../utils/durationUtils';
import { PlayingNoteRef } from '../../app/store/playbackStore';

export interface RenderOptions {
  width?: number;
  height?: number;
}

// Layout constants — keep in sync with ScoreEditor click-handler
export const CLEF_WIDTH    = 140;  // Width of the clef + key sig + time-sig header stave
export const MEASURE_WIDTH = 200;  // Width of every measure stave
export const LEFT_MARGIN   = 20;   // Page left margin
export const ROW_SPACING   = 130;  // Vertical distance between staff rows
export const STAVE_Y_START = 40;   // Y passed to new Stave(x, y, width)

// VexFlow draws the top staff LINE at:  STAVE_Y + space_above_staff_ln * line_spacing
// Default in VexFlow 4.x:  space_above_staff_ln = 4, line_spacing = 10  →  offset = 40px
// We measure it dynamically so we stay in sync with whatever version is installed.
const _probe = new Stave(0, 0, 100);
export const STAFF_LINE_OFFSET: number = (_probe as any).getYForLine(0);  // offset from Stave y to top line
export const LINE_SPACING = 10;   // px between adjacent staff lines  (VexFlow default)
export const STEP_SIZE    = LINE_SPACING / 2; // px per diatonic step (line-to-space = 5px)

/**
 * Width of a pickup (anacrusis) measure, scaled to its fraction of a full measure.
 * Minimum 60px so even a single-beat pickup is readable.
 */
export const getPickupMeasureWidth = (pickupBeats: number, beatsPerMeasure: number): number =>
  Math.max(60, Math.round((pickupBeats / beatsPerMeasure) * MEASURE_WIDTH));

/** Extra pixels added to a measure that starts with change symbols (clef/key/time). */
export const CHANGE_SYMBOL_WIDTH = 70;

// ── Per-measure effective-value helpers ──────────────────────────────────────
// Walk backwards through measures to find the most-recently-set override, or
// return the composition-level global default.

export function effectiveTimeSig(measures: readonly Measure[], upTo: number, globalDefault: string): string {
  for (let i = upTo; i >= 0; i--) if (measures[i]?.timeSignature) return measures[i].timeSignature!;
  return globalDefault;
}
export function effectiveKeySig(measures: readonly Measure[], upTo: number, globalDefault: string): string {
  for (let i = upTo; i >= 0; i--) if (measures[i]?.keySignature) return measures[i].keySignature!;
  return globalDefault;
}
export function effectiveTempo(measures: readonly Measure[], upTo: number, globalDefault: number): number {
  for (let i = upTo; i >= 0; i--) if (measures[i]?.tempo !== undefined) return measures[i].tempo!;
  return globalDefault;
}
export function effectiveClef(measures: readonly Measure[], upTo: number, globalDefault: Clef): Clef {
  for (let i = upTo; i >= 0; i--) if (measures[i]?.clef) return measures[i].clef!;
  return globalDefault;
}

/** True when this measure introduces any notation change (clef / key / time / tempo). */
function measureHasChanges(measure: Measure | undefined): boolean {
  return !!(measure?.clef || measure?.keySignature || measure?.timeSignature || measure?.tempo !== undefined);
}

/**
 * Returns the { x, width } layout of every measure for a composition.
 * - Accounts for anacrusis (pickup) first measure.
 * - Accounts for time-signature changes (width ∝ beats per measure).
 * - Adds CHANGE_SYMBOL_WIDTH for measures that introduce notation changes.
 */
export function getMeasureLayout(composition: Composition): Array<{ x: number; width: number }> {
  const refMeasures = composition.staves[0]?.measures ?? [];
  const maxMeasures = Math.max(...composition.staves.map((s) => s.measures.length), 1);
  const layout: Array<{ x: number; width: number }> = [];
  let cx = LEFT_MARGIN + CLEF_WIDTH;

  for (let i = 0; i < maxMeasures; i++) {
    const isPickup = composition.anacrusis && i === 0;
    const measure  = refMeasures[i];

    let w: number;
    if (isPickup) {
      const globalBPM = Number(composition.timeSignature.split('/')[0]);
      w = getPickupMeasureWidth(composition.pickupBeats ?? 1, globalBPM);
    } else {
      // Scale width proportionally to the effective time signature
      const effTs  = effectiveTimeSig(refMeasures, i, composition.timeSignature);
      const [n, d] = effTs.split('/').map(Number);
      // quarter-note equivalents per measure = n * (4/d)
      const factor = (n * 4) / (d * 4); // simplifies to n/d
      w = Math.max(100, Math.round(factor * MEASURE_WIDTH));
    }

    // Extra room for notation-change symbols at the start of this measure
    if (i > 0 && measureHasChanges(measure)) w += CHANGE_SYMBOL_WIDTH;

    layout.push({ x: cx, width: w });
    cx += w;
  }
  return layout;
}

/** Exact SVG position of a rendered note head, captured after VexFlow formats. */
export interface RenderedNotePosition {
  staffIndex: number;
  measureIndex: number;
  voiceIndex: number;
  noteIndex: number;  // index within voice.notes (skips rests)
  noteDataIndex: number; // index within voice.notes including rests
  x: number;  // absolute SVG x of note head centre
  y: number;  // absolute SVG y of note head centre
}

export class VexFlowRenderer {
  private context: any;
  private renderer: any; // Store renderer to access SVG element
  // Keep a reference to width/height for dynamic resizing
  private canvasWidth: number;
  private canvasHeight: number;
  /** Populated on every render() call — exact note head positions. */
  private notePositions: RenderedNotePosition[] = [];

  constructor(container: HTMLElement, options: RenderOptions = {}) {
    this.canvasWidth  = options.width  || 1200;
    this.canvasHeight = options.height || 400;

    this.renderer = new Renderer(container as HTMLDivElement, RendererBackends.SVG);
    this.renderer.resize(this.canvasWidth, this.canvasHeight);
    this.context = this.renderer.getContext();
    // Store renderer reference on the instance so resize works
    (this as any)._renderer = this.renderer;
    this.context.setFont('Arial', 10);
  }

  /** Get the SVG element for direct manipulation */
  private getSvgElement(): SVGSVGElement | null {
    // Try multiple ways to access the SVG element
    const renderer = (this as any)._renderer || this.renderer;
    if (!renderer) return null;
    
    // VexFlow renderer might expose it as .svg or .element
    return (renderer.svg || renderer.element || renderer.getContext()?.svg) as SVGSVGElement | null;
  }

  /** Returns the exact note-head positions captured during the last render(). */
  getNotePositions(): RenderedNotePosition[] {
    return this.notePositions;
  }

  render(
    composition: Composition, 
    playingNotes?: Set<string>,
    selectedMeasureIndex?: number | null,
    measureSelectionStart?: number | null,
    selectedNote?: { staffIndex: number; measureIndex: number; voiceIndex: number; noteIndex: number } | null,
    selectedStaffIndex?: number | null
  ): void {
    this.context.clear();
    this.notePositions = []; // reset on every render

    const [beatsPerMeasure] = composition.timeSignature.split('/').map(Number);

    // Pickup-measure beats (0 means no anacrusis)
    const pickupBeats = composition.anacrusis ? (composition.pickupBeats ?? 1) : 0;

    // Use getMeasureLayout so pickup measure width is consistent with click handler
    const layout = getMeasureLayout(composition);
    const totalStavesWidth = layout.length > 0
      ? layout[layout.length - 1].x + layout[layout.length - 1].width - LEFT_MARGIN + 40
      : CLEF_WIDTH + 40;

    const neededWidth  = LEFT_MARGIN + totalStavesWidth;
    const neededHeight = STAVE_Y_START + composition.staves.length * ROW_SPACING + 60;

    if (neededWidth > this.canvasWidth || neededHeight > this.canvasHeight) {
      this.canvasWidth  = Math.max(neededWidth,  this.canvasWidth);
      this.canvasHeight = Math.max(neededHeight, this.canvasHeight);
      (this as any)._renderer.resize(this.canvasWidth, this.canvasHeight);
    }

    // ── Calculate selected measure range ──────────────────────────────────
    const selectedRange = selectedMeasureIndex !== null && selectedMeasureIndex !== undefined && measureSelectionStart !== null && measureSelectionStart !== undefined
      ? {
          start: Math.min(measureSelectionStart, selectedMeasureIndex),
          end: Math.max(measureSelectionStart, selectedMeasureIndex),
        }
      : selectedMeasureIndex !== null && selectedMeasureIndex !== undefined
      ? {
          start: selectedMeasureIndex,
          end: selectedMeasureIndex,
        }
      : null;

    // ── Measure numbers (only on first staff, above the staff) ─────────────
    const showMeasureNumbers = composition.showMeasureNumbers !== false; // default true
    // Position measure numbers above the top staff line
    const measureNumberY = STAVE_Y_START + STAFF_LINE_OFFSET - 10; // Above the top line

    composition.staves.forEach((staff, staffIndex) => {
      const y = STAVE_Y_START + staffIndex * ROW_SPACING;

      // ── 1. Header stave: clef + key signature + time signature ──────────────
      const headerStave = new Stave(LEFT_MARGIN, y, CLEF_WIDTH);
      headerStave.addClef(staff.clef);
      
      // Add key signature (VexFlow expects format like "C", "G", "F", "Bb", etc.)
      const vfKeySig = keySignatureToVexFlow(composition.keySignature);
      if (vfKeySig && vfKeySig !== 'C') {
        // Only add if not C major (no sharps/flats)
        try {
          headerStave.addKeySignature(vfKeySig);
        } catch (err) {
          console.warn(`Failed to add key signature "${vfKeySig}":`, err);
        }
      }
      
      headerStave.addTimeSignature(composition.timeSignature);
      headerStave.setContext(this.context).draw();

      // ── 2. Draw measure highlights (before drawing measures) ────────────────
      // Only highlight the measure on the currently selected staff
      if (selectedRange && (selectedStaffIndex === null || selectedStaffIndex === undefined || staffIndex === selectedStaffIndex)) {
        const svgElement = this.getSvgElement();
        if (svgElement) {
          // Draw highlight for each selected measure
          for (let mIdx = selectedRange.start; mIdx <= selectedRange.end; mIdx++) {
            if (mIdx < staff.measures.length) {
              const { x: mx, width: mw } = layout[mIdx] ?? {
                x: LEFT_MARGIN + CLEF_WIDTH + mIdx * MEASURE_WIDTH,
                width: MEASURE_WIDTH,
              };
              
              // Calculate staff bounds (top and bottom of all staff lines)
              const staffTop = y + STAFF_LINE_OFFSET;
              const staffBottom = staffTop + 4 * LINE_SPACING; // 5 lines = 4 gaps
              
              // Draw highlight rectangle
              const highlight = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
              highlight.setAttribute('x', String(mx));
              highlight.setAttribute('y', String(staffTop - 5)); // Extend slightly above
              highlight.setAttribute('width', String(mw));
              highlight.setAttribute('height', String(staffBottom - staffTop + 10)); // Extend slightly below
              highlight.setAttribute('fill', 'rgba(59, 130, 246, 0.15)'); // Blue with transparency
              highlight.setAttribute('stroke', 'rgba(59, 130, 246, 0.4)');
              highlight.setAttribute('stroke-width', '2');
              highlight.setAttribute('rx', '2'); // Rounded corners
              // Insert after background (if exists) but before staff content
              // Find first non-background element or append to end
              const firstNonBg = svgElement.querySelector('g, path, line, text');
              if (firstNonBg) {
                svgElement.insertBefore(highlight, firstNonBg);
              } else {
                svgElement.appendChild(highlight);
              }
            }
          }
        }
      }

      // ── 3. One stave per measure ─────────────────────────────────────────
      staff.measures.forEach((measure, measureIndex) => {
        const { x: mx, width: mw } = layout[measureIndex] ?? {
          x: LEFT_MARGIN + CLEF_WIDTH + measureIndex * MEASURE_WIDTH,
          width: MEASURE_WIDTH,
        };

        // ── Effective values for this measure (walk back to find latest override) ──
        const effClef   = effectiveClef  (staff.measures, measureIndex, staff.clef);
        const effKeySig = effectiveKeySig(composition.staves[0]?.measures ?? [], measureIndex, composition.keySignature);
        const effTimeSig = effectiveTimeSig(composition.staves[0]?.measures ?? [], measureIndex, composition.timeSignature);
        const [effBPM, effBeatType] = effTimeSig.split('/').map(Number);

        const measureStave = new Stave(mx, y, mw);

        // Add notation-change symbols at the start of this measure (skip measure 0 – already on header)
        if (measureIndex > 0) {
          const prevClef   = effectiveClef  (staff.measures, measureIndex - 1, staff.clef);
          const prevKeySig = effectiveKeySig(composition.staves[0]?.measures ?? [], measureIndex - 1, composition.keySignature);
          const prevTimeSig = effectiveTimeSig(composition.staves[0]?.measures ?? [], measureIndex - 1, composition.timeSignature);

          if (effClef !== prevClef) {
            try { measureStave.addClef(effClef); } catch (_) { /* skip */ }
          }
          if (effKeySig !== prevKeySig) {
            const vfNew = keySignatureToVexFlow(effKeySig);
            try { measureStave.addKeySignature(vfNew || 'C'); } catch (_) { /* skip */ }
          }
          if (effTimeSig !== prevTimeSig) {
            try { measureStave.addTimeSignature(effTimeSig); } catch (_) { /* skip */ }
          }
        }

        measureStave.setContext(this.context).draw();

        // For anacrusis first measure, use pickupBeats as the Voice beat count
        const voiceBeats =
          composition.anacrusis && measureIndex === 0 ? pickupBeats : effBPM;

        // Build tickables (notes / rests), tracking data index for each tickable
        const tickables: any[] = [];
        const tickableDataIndices: number[] = []; // maps tickable index → voice.notes index
        const voice = measure.voices[0];

        if (voice) {
          voice.notes.forEach((element, dataIndex) => {
            if ('pitch' in element) {
              const staveNote = this.createStaveNote(
                element as Note,
                effClef,
                effKeySig,
                measure,
                dataIndex
              );
              if (staveNote) {
                tickableDataIndices.push(dataIndex);
                tickables.push(staveNote);
              }
            } else {
              const restNote = this.createRestNote(element as Rest, effClef);
              if (restNote) {
                tickableDataIndices.push(dataIndex);
                tickables.push(restNote);
              }
            }
          });
        }

        if (tickables.length > 0) {
          try {
            // ── Build beam groups BEFORE formatting ─────────────────────────────
            // In VexFlow, Beam objects must be created before format() so the
            // formatter knows to suppress flags on beamed notes. They are drawn
            // after the voice is drawn.
            const beams: Beam[] = [];
            if (voice) {
              let beamGroup: any[] = [];

              const flushBeamGroup = () => {
                if (beamGroup.length >= 2) {
                  try { beams.push(new Beam(beamGroup)); } catch (_) { /* skip */ }
                }
                beamGroup = [];
              };

              for (let i = 0; i < voice.notes.length; i++) {
                const element = voice.notes[i];
                const tickableIdx = tickableDataIndices.indexOf(i);
                if (tickableIdx < 0) { flushBeamGroup(); continue; }

                const staveNote = tickables[tickableIdx];

                if ('pitch' in element) {
                  const note = element as Note;
                  const base = note.duration.startsWith('dotted-')
                    ? note.duration.replace('dotted-', '')
                    : note.duration;
                  const isBeamable = base === 'eighth' || base === 'sixteenth' || base === 'thirty-second';

                  if (isBeamable) {
                    beamGroup.push(staveNote);
                  } else {
                    flushBeamGroup();
                  }
                } else {
                  // Rest breaks the beam group
                  flushBeamGroup();
                }
              }
              flushBeamGroup(); // flush any trailing group
            }

            const vfVoice = new Voice({ num_beats: voiceBeats, beat_value: effBeatType });
            vfVoice.setStrict(false);
            vfVoice.addTickables(tickables);
            new Formatter()
              .joinVoices([vfVoice])
              .format([vfVoice], mw - 30);
            vfVoice.draw(this.context, measureStave);

            // Draw beams after the voice so they render on top
            beams.forEach((b) => b.setContext(this.context).draw());

            // ── Draw ties and slurs (supports multi-note chains) ────────────────────
            if (voice && voice.notes.length > 1) {
              // Process ties: connect all notes in a tie chain
              let tieStartIdx: number | null = null;
              let tieStartNote: any = null;
              
              for (let i = 0; i < voice.notes.length; i++) {
                const element = voice.notes[i];
                if (!('pitch' in element)) {
                  tieStartIdx = null;
                  tieStartNote = null;
                  continue;
                }
                
                const note = element as Note;
                const tickableIdx = tickableDataIndices.indexOf(i);
                if (tickableIdx < 0 || tickableIdx >= tickables.length) continue;
                
                const staveNote = tickables[tickableIdx];
                
                // Check if this note starts or continues a tie
                if (note.tie) {
                  if (tieStartIdx === null) {
                    // Start of a new tie chain
                    tieStartIdx = i;
                    tieStartNote = staveNote;
                  } else {
                    // Continue tie chain - draw tie from start to current
                    try {
                      const tie = new StaveTie({
                        first_note: tieStartNote,
                        last_note: staveNote,
                      });
                      tie.setContext(this.context).draw();
                      // Update start for next note in chain
                      tieStartNote = staveNote;
                    } catch (err) {
                      console.warn('Failed to draw tie:', err);
                    }
                  }
                } else {
                  // End of tie chain
                  tieStartIdx = null;
                  tieStartNote = null;
                }
                
                // Handle slurs (similar to ties but can span different pitches)
                if (note.slur && i < voice.notes.length - 1) {
                  const next = voice.notes[i + 1];
                  if ('pitch' in next) {
                    const nextIdx = tickableDataIndices.indexOf(i + 1);
                    if (nextIdx >= 0 && nextIdx < tickables.length) {
                      try {
                        const slur = new StaveTie({
                          first_note: staveNote,
                          last_note: tickables[nextIdx],
                        });
                        slur.setContext(this.context).draw();
                      } catch (err) {
                        console.warn('Failed to draw slur:', err);
                      }
                    }
                  }
                }
              }
            }

            // ── Draw dynamics ─────────────────────────────────────────────────────
            if (voice) {
              voice.notes.forEach((element, dataIndex) => {
                if ('pitch' in element && element.dynamic) {
                  const tickableIdx = tickableDataIndices.indexOf(dataIndex);
                  if (tickableIdx >= 0 && tickableIdx < tickables.length) {
                    const staveNote = tickables[tickableIdx];
                    try {
                      const x = staveNote.getAbsoluteX();
                      const ys = staveNote.getYs?.() ?? [];
                      const y = ys.length > 0 ? ys[0] : 0;
                      
                      if (x && y) {
                        const svgEl = this.getSvgElement();
                        if (svgEl) {
                          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                          text.setAttribute('x', String(x));
                          text.setAttribute('y', String(y - 15)); // Above the note
                          text.setAttribute('font-family', 'Arial, sans-serif');
                          text.setAttribute('font-size', '14');
                          text.setAttribute('font-weight', 'bold');
                          text.setAttribute('fill', '#000');
                          text.setAttribute('text-anchor', 'middle');
                          text.textContent = element.dynamic;
                          svgEl.appendChild(text);
                        }
                      }
                    } catch (err) {
                      console.warn('Failed to draw dynamic:', err);
                    }
                  }
                }
              });
            }

            // ── Capture actual note-head positions after formatting ──────────
            tickables.forEach((sn, ti) => {
              try {
                const nx = sn.getAbsoluteX();
                const ys: number[] = sn.getYs?.() ?? [];
                const ny = ys.length > 0 ? ys[0] : 0;
                if (nx && ny) {
                  const noteDataIndex = tickableDataIndices[ti];
                  const noteElement = voice.notes[noteDataIndex];
                  
                  this.notePositions.push({
                    staffIndex,
                    measureIndex,
                    voiceIndex: 0,
                    noteIndex: ti,
                    noteDataIndex,
                    x: nx,
                    y: ny,
                  });

                  // ── Draw articulation symbols manually (if VexFlow didn't render them) ──
                  if ('pitch' in noteElement && noteElement.articulation) {
                    const svgEl = this.getSvgElement();
                    if (svgEl) {
                      // Position above the note head
                      const artY = ny - 20;
                      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                      text.setAttribute('x', String(nx));
                      text.setAttribute('y', String(artY));
                      text.setAttribute('font-family', 'Arial, sans-serif');
                      text.setAttribute('font-size', '16');
                      text.setAttribute('font-weight', 'bold');
                      text.setAttribute('fill', '#000');
                      text.setAttribute('text-anchor', 'middle');
                      text.setAttribute('dominant-baseline', 'middle');
                      
                      // Map articulation codes to symbols
                      const artSymbols: Record<string, string> = {
                        'a.': '•',
                        'av': '▼',
                        '>': '>',
                        '-': '—',
                        '^': '^',
                        'a>': '^•',
                      };
                      
                      text.textContent = artSymbols[noteElement.articulation] || noteElement.articulation;
                      svgEl.appendChild(text);
                    }
                  }

                  // ── Highlight playing notes ──────────────────────────────────
                  if (playingNotes && 'pitch' in noteElement) {
                    const serialized = `${staffIndex}:${measureIndex}:0:${noteDataIndex}`;
                    if (playingNotes.has(serialized)) {
                      // Draw a yellow/orange glow circle behind the note head
                      const svgEl = this.getSvgElement();
                      if (svgEl) {
                        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                        circle.setAttribute('cx', String(nx));
                        circle.setAttribute('cy', String(ny));
                        circle.setAttribute('r', '8'); // Slightly larger than note head
                        circle.setAttribute('fill', '#fbbf24'); // Amber/yellow
                        circle.setAttribute('opacity', '0.6');
                        circle.setAttribute('class', 'playing-note-highlight');
                        // Insert before other elements so it appears behind
                        svgEl.insertBefore(circle, svgEl.firstChild);
                      }
                    }
                  }
                }
              } catch (_) { /* skip if note not fully positioned */ }
            });
          } catch (err) {
            console.warn(`Measure ${measureIndex + 1} render error:`, err);
          }
        }
      });

      // ── 4. Draw measure numbers (only on first staff) ─────────────────────
      if (showMeasureNumbers && staffIndex === 0) {
        staff.measures.forEach((measure, measureIndex) => {
          const { x: mx, width: mw } = layout[measureIndex] ?? {
            x: LEFT_MARGIN + CLEF_WIDTH + measureIndex * MEASURE_WIDTH,
            width: MEASURE_WIDTH,
          };
          
          // Calculate measure number (accounting for anacrusis)
          let measureNumber: number;
          if (composition.anacrusis && measureIndex === 0) {
            // Pickup measure is usually not numbered, or numbered as 0
            // We'll skip it or show it as a special marker
            return; // Skip numbering the pickup measure
          } else {
            // Regular measures: if anacrusis exists, subtract 1 from index
            measureNumber = composition.anacrusis ? measureIndex : measureIndex + 1;
          }

          // Position number at the start (left edge) of the measure
          const numberX = mx + 5; // Small offset from the left edge
          
          // Draw measure number using SVG text element
          // VexFlow SVG context doesn't have setTextAlign/setTextBaseline
          const svgElement = this.getSvgElement();
          if (svgElement) {
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', String(numberX));
            text.setAttribute('y', String(measureNumberY));
            text.setAttribute('font-family', 'Arial');
            text.setAttribute('font-size', '11');
            text.setAttribute('fill', '#333');
            text.setAttribute('text-anchor', 'start'); // Left alignment (start of measure)
            text.setAttribute('dominant-baseline', 'text-bottom'); // Bottom baseline
            text.textContent = String(measureNumber);
            svgElement.appendChild(text);
          }
        });
      }
    });

    // ── Draw selected note highlight (after all notes are rendered) ──────────
    if (selectedNote) {
      const notePos = this.notePositions.find(
        (p) =>
          p.staffIndex === selectedNote.staffIndex &&
          p.measureIndex === selectedNote.measureIndex &&
          p.voiceIndex === selectedNote.voiceIndex &&
          p.noteDataIndex === selectedNote.noteIndex
      );

      if (notePos) {
        const svgElement = this.getSvgElement();
        if (svgElement) {
          // Draw a highlight circle around the selected note
          const highlight = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          highlight.setAttribute('cx', String(notePos.x));
          highlight.setAttribute('cy', String(notePos.y));
          highlight.setAttribute('r', '10'); // Radius slightly larger than note head
          highlight.setAttribute('fill', 'rgba(59, 130, 246, 0.2)'); // Blue with transparency
          highlight.setAttribute('stroke', 'rgba(59, 130, 246, 0.8)');
          highlight.setAttribute('stroke-width', '2.5');
          highlight.setAttribute('class', 'selected-note-highlight');
          // Insert after background but before other content
          const firstNonBg = svgElement.querySelector('g, path, line, text');
          if (firstNonBg) {
            svgElement.insertBefore(highlight, firstNonBg);
          } else {
            svgElement.appendChild(highlight);
          }
        }
      }
    }
  }

  // ── Helper: Determine stem direction based on note position ─────────────────
  /**
   * Music theory rule: Notes on or above the middle line (B4 in treble, D3 in bass)
   * should have stems down. Notes below should have stems up.
   * For notes on the middle line, use the majority direction in the measure.
   */
  private getStemDirection(pitch: string, clef: 'treble' | 'bass' | 'alto' | 'tenor'): number {
    const midi = pitchToMidi(pitch);
    
    // Middle line MIDI values
    const middleLineMidi = clef === 'treble' ? 71 : // B4 for treble
                          clef === 'bass' ? 50 :    // D3 for bass
                          clef === 'alto' ? 67 :     // G4 for alto (approximate)
                          69;                        // A4 for tenor (approximate)
    
    // Notes on or above middle line: stem down, below: stem up
    // VexFlow uses Stem.DOWN (1) and Stem.UP (-1)
    return midi >= middleLineMidi ? Stem.DOWN : Stem.UP;
  }

  // ────────────────────────────────────────────────────────────────────────────
  private createStaveNote(
    note: Note,
    clef: 'treble' | 'bass' | 'alto' | 'tenor',
    keySignature: string,
    measure?: Measure,
    noteIndex?: number
  ): any {
    if (!note.pitch) return null;

    const { accidental } = parsePitch(note.pitch);
    const key = pitchToVexFlowKey(note.pitch);
    
    // Check if duration is dotted and extract base duration
    const isDotted = note.duration.startsWith('dotted-');
    const baseDuration = isDotted
      ? note.duration.replace('dotted-', '') as NoteDuration
      : note.duration;
    const duration = durationToVexFlow(baseDuration);

    try {
      const staveNote = new StaveNote({ clef, keys: [key], duration });

      // Set stem direction based on music theory rules (notes on/above middle line = down, below = up)
      // Note: VexFlow may override this based on voice formatting, but we set it as a hint
      const stemDir = this.getStemDirection(note.pitch, clef);
      staveNote.setStemDirection(stemDir);

      // Add augmentation dot if the duration is dotted
      if (isDotted) {
        staveNote.addModifier(new Dot(), 0);
      }

      // Only show accidental if it's explicitly set on this note
      // Measure-level accidentals are applied for playback/placement but not shown visually
      // (they're implied by the first occurrence in the measure)
      const showAccidental = shouldShowAccidental(note.pitch, keySignature);
      const explicitAccidental = note.accidental;

      if (showAccidental || explicitAccidental) {
        if (accidental === '#' || explicitAccidental === 'sharp') {
          staveNote.addModifier(new Accidental('#'), 0);
        } else if (accidental === 'b' || explicitAccidental === 'flat') {
          staveNote.addModifier(new Accidental('b'), 0);
        } else if (accidental === 'n' || explicitAccidental === 'natural') {
          staveNote.addModifier(new Accidental('n'), 0);
        }
      }

      // Add articulations
      if (note.articulation) {
        try {
          const vfCode = note.articulation;
          const art = new Articulation(vfCode);
          staveNote.addModifier(art, 0);
        } catch (err) {
          console.warn('Failed to add articulation:', note.articulation, err);
        }
      }

      return staveNote;
    } catch (err) {
      console.warn('createStaveNote error:', err, { pitch: note.pitch, key, duration });
      return null;
    }
  }

  private createRestNote(rest: Rest, clef: 'treble' | 'bass' | 'alto' | 'tenor'): any {
    // Check if duration is dotted and extract base duration
    const isDotted = rest.duration.startsWith('dotted-');
    const baseDuration = isDotted
      ? rest.duration.replace('dotted-', '') as NoteDuration
      : rest.duration;
    const duration = durationToVexFlow(baseDuration);
    const key      = clef === 'bass' ? 'd/3' : 'b/4';
    try {
      const restNote = new StaveNote({ clef, keys: [key], duration: duration + 'r' });
      
      // Add augmentation dot if the duration is dotted
      if (isDotted) {
        restNote.addModifier(new Dot(), 0);
      }
      
      return restNote;
    } catch {
      return null;
    }
  }

  resize(width: number, height: number): void {
    this.canvasWidth  = width;
    this.canvasHeight = height;
    (this as any)._renderer.resize(width, height);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRINT / PDF  –  multi-system rendering
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Renders the composition into multiple horizontal systems (rows) that wrap
   * at `measuresPerSystem`.  Adds staff labels and a left bracket for multi-
   * staff scores.  The resulting SVG is decorated with a title and can be
   * serialised directly for PDF / print output.
   */
  renderForPrint(
    composition: Composition,
    opts: {
      pageWidth: number;   // total SVG / page width in px
      labelWidth: number;  // px reserved on the left for staff labels
    }
  ): SVGSVGElement | null {
    const { pageWidth, labelWidth } = opts;

    // ── Print-layout constants ─────────────────────────────────────────────
    const PRINT_CLEF_W   = 120;   // header stave width
    const PRINT_MEAS_W   = 200;   // each measure stave width (full measure)
    const STAVE_TOP      = 40;    // top-of-stave offset inside each system
    const SYSTEM_GAP     = 40;    // extra vertical gap between systems
    const TITLE_H        = 80;    // reserved at the very top for title text

    const [beatsPerMeasure, beatTypeValue] =
      composition.timeSignature.split('/').map(Number);
    const pickupBeats = composition.anacrusis ? (composition.pickupBeats ?? 1) : 0;
    const vfKeySig = keySignatureToVexFlow(composition.keySignature);

    // Helper to calculate pickup measure width for print (proportional to PRINT_MEAS_W)
    const getPickupMeasureWidthForPrint = (pickupBeats: number, beatsPerMeasure: number): number => {
      // Minimum 60px so even a single-beat pickup is readable
      return Math.max(60, Math.round((pickupBeats / beatsPerMeasure) * PRINT_MEAS_W));
    };

    const numStaves   = composition.staves.length;
    const maxMeasures = Math.max(...composition.staves.map((s) => s.measures.length), 1);

    // Calculate actual measure widths (pickup measure is smaller)
    const measureWidths: number[] = [];
    for (let i = 0; i < maxMeasures; i++) {
      if (composition.anacrusis && i === 0) {
        measureWidths.push(getPickupMeasureWidthForPrint(pickupBeats, beatsPerMeasure));
      } else {
        measureWidths.push(PRINT_MEAS_W);
      }
    }

    // How many measures fit after the label column and clef header
    // Use average width for layout calculation (slightly conservative)
    const availForMeasures = pageWidth - labelWidth - PRINT_CLEF_W;
    const measPerSys = Math.max(1, Math.floor(availForMeasures / PRINT_MEAS_W));
    const numSystems = Math.ceil(maxMeasures / measPerSys);

    const systemH  = numStaves * ROW_SPACING + SYSTEM_GAP;
    const totalW   = pageWidth;
    const totalH   = TITLE_H + numSystems * systemH + 40;

    // Resize renderer to the full print canvas
    this.canvasWidth  = totalW;
    this.canvasHeight = totalH;
    (this as any)._renderer.resize(totalW, totalH);
    this.context.clear();
    this.notePositions = [];

    const svgEl = this.getSvgElement();

    // ── White background ───────────────────────────────────────────────────
    if (svgEl) {
      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bg.setAttribute('x', '0');
      bg.setAttribute('y', '0');
      bg.setAttribute('width',  String(totalW));
      bg.setAttribute('height', String(totalH));
      bg.setAttribute('fill', 'white');
      svgEl.insertBefore(bg, svgEl.firstChild);
    }

    // ── Render each system ────────────────────────────────────────────────
    for (let sysIdx = 0; sysIdx < numSystems; sysIdx++) {
      const sysStartM = sysIdx * measPerSys;
      const sysEndM   = Math.min(sysStartM + measPerSys, maxMeasures);
      const sysY      = TITLE_H + sysIdx * systemH;

      composition.staves.forEach((staff, staffIdx) => {
        const staveY = sysY + STAVE_TOP + staffIdx * ROW_SPACING;
        const staveX = labelWidth;

        // ── Header stave (clef + key sig; time sig only on system 0) ──────
        const headerStave = new Stave(staveX, staveY, PRINT_CLEF_W);
        headerStave.addClef(staff.clef);
        if (vfKeySig && vfKeySig !== 'C') {
          try { headerStave.addKeySignature(vfKeySig); } catch { /* ignore */ }
        }
        if (sysIdx === 0) {
          headerStave.addTimeSignature(composition.timeSignature);
        }
        headerStave.setContext(this.context).draw();

        // ── Staff label ────────────────────────────────────────────────────
        const staffLabel = staff.name?.trim() ||
          (numStaves > 1 ? `Staff ${staffIdx + 1}` : '');
        if (staffLabel && svgEl) {
          const labelY = staveY + STAFF_LINE_OFFSET + 2 * LINE_SPACING;
          const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          txt.setAttribute('x', String(staveX - 6));
          txt.setAttribute('y', String(labelY));
          txt.setAttribute('text-anchor', 'end');
          txt.setAttribute('dominant-baseline', 'middle');
          txt.setAttribute('font-family', 'Arial, sans-serif');
          txt.setAttribute('font-size', sysIdx === 0 ? '13' : '11');
          txt.setAttribute('font-style', 'italic');
          txt.setAttribute('fill', '#000');
          // Show full name on system 0; abbreviated (first word) on the rest
          txt.textContent = sysIdx === 0
            ? staffLabel
            : staffLabel.split(' ')[0];
          svgEl.appendChild(txt);
        }

        // ── Measure staves ────────────────────────────────────────────────
        // Calculate cumulative x-position based on actual measure widths
        let cumulativeX = 0;
        for (let mIdx = sysStartM; mIdx < sysEndM; mIdx++) {
          const measure = staff.measures[mIdx];
          if (!measure) {
            // Still advance position even if measure is missing
            cumulativeX += measureWidths[mIdx] ?? PRINT_MEAS_W;
            continue;
          }

          const measWidth = measureWidths[mIdx] ?? PRINT_MEAS_W;
          const measX = staveX + PRINT_CLEF_W + cumulativeX;

          const measureStave = new Stave(measX, staveY, measWidth);
          measureStave.setContext(this.context).draw();

          const voiceBeats =
            composition.anacrusis && mIdx === 0 ? pickupBeats : beatsPerMeasure;
          const voice = measure.voices[0];
          const tickables: any[] = [];
          const tickableDataIndices: number[] = [];

          if (voice) {
            voice.notes.forEach((element, dataIndex) => {
              if ('pitch' in element) {
                const sn = this.createStaveNote(
                  element as Note, staff.clef, composition.keySignature);
                if (sn) { tickableDataIndices.push(dataIndex); tickables.push(sn); }
              } else {
                const rn = this.createRestNote(element as Rest, staff.clef);
                if (rn) { tickableDataIndices.push(dataIndex); tickables.push(rn); }
              }
            });
          }

          if (tickables.length > 0) {
            try {
              const vfVoice = new Voice({ num_beats: voiceBeats, beat_value: beatTypeValue });
              vfVoice.setStrict(false);
              vfVoice.addTickables(tickables);
              new Formatter()
                .joinVoices([vfVoice])
                .format([vfVoice], measWidth - 30);
              vfVoice.draw(this.context, measureStave);
            } catch (err) {
              console.warn(`Print system ${sysIdx} measure ${mIdx} error:`, err);
            }
          }

          // ── Measure numbers (first staff only, every measure) ─────────────
          if (staffIdx === 0 && svgEl) {
            const isPickup = composition.anacrusis && mIdx === 0;
            if (!isPickup) {
              const measNum = composition.anacrusis ? mIdx : mIdx + 1;
              const numTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
              numTxt.setAttribute('x', String(measX + 3));
              numTxt.setAttribute('y', String(staveY + STAFF_LINE_OFFSET - 6));
              numTxt.setAttribute('font-family', 'Arial');
              numTxt.setAttribute('font-size', '10');
              numTxt.setAttribute('fill', '#444');
              numTxt.setAttribute('text-anchor', 'start');
              numTxt.textContent = String(measNum);
              svgEl.appendChild(numTxt);
            }
          }

          // Advance position for next measure
          cumulativeX += measWidth;
        }
      });

      // ── Left bracket connecting all staves in this system ─────────────────
      if (numStaves > 1 && svgEl) {
        const bx       = labelWidth - 4;
        const topLineY = sysY + STAVE_TOP + STAFF_LINE_OFFSET;
        const botLineY = sysY + STAVE_TOP
                       + (numStaves - 1) * ROW_SPACING
                       + STAFF_LINE_OFFSET + 4 * LINE_SPACING;

        const bar = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        bar.setAttribute('x1', String(bx)); bar.setAttribute('y1', String(topLineY));
        bar.setAttribute('x2', String(bx)); bar.setAttribute('y2', String(botLineY));
        bar.setAttribute('stroke', '#000'); bar.setAttribute('stroke-width', '2.5');
        svgEl.appendChild(bar);

        for (const sy of [topLineY, botLineY]) {
          const serif = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          serif.setAttribute('x1', String(bx - 5)); serif.setAttribute('y1', String(sy));
          serif.setAttribute('x2', String(bx + 3)); serif.setAttribute('y2', String(sy));
          serif.setAttribute('stroke', '#000'); serif.setAttribute('stroke-width', '2');
          svgEl.appendChild(serif);
        }
      }
    }

    return svgEl;
  }
}
