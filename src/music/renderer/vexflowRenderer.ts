import { Renderer, Stave, StaveNote, Voice, Formatter, Accidental, Dot, Articulation, StaveTie, Beam, Stem, Tuplet, RendererBackends } from 'vexflow';
import { Clef, Composition, GregorianChantDivision, GregorianChantSymbol, Measure, Note, Rest, NoteDuration } from '../../types/music';
import { parsePitch, pitchToVexFlowKey, pitchToMidi, keySignatureToVexFlow, shouldShowAccidental, findMeasureAccidental, getKeySignatureAccidentals } from '../../utils/noteUtils';
import { durationToBeats, durationToVexFlow } from '../../utils/durationUtils';
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

function chantMeasureVisualUnits(measure: Measure | undefined): number {
  if (!measure?.voices?.length) return 0;
  const symbolWeight: Record<GregorianChantSymbol, number> = {
    punctum: 1,
    virga: 1.15,
    podatus: 1.45,
    clivis: 1.45,
    torculus: 1.8,
    porrectus: 1.9,
    quilisma: 1.6,
    liquescent: 1.1,
  };
  // Use the visually widest voice so imported/polyphonic chant doesn't crowd.
  const maxUnitsInVoice = Math.max(
    ...measure.voices.map((voice) =>
      (voice?.notes ?? []).reduce((sum, el) => {
        if (!('pitch' in el)) return sum + 0.8; // small spacing for rests in chant mode
        const note = el as Note;
        const sym = note.chantSymbol ?? 'punctum';
        const ornamentBonus = note.chantOrnament && note.chantOrnament !== 'none' ? 0.25 : 0;
        return sum + (symbolWeight[sym] ?? 1) + ornamentBonus;
      }, 0)
    ),
    0
  );
  const divisionUnits: Record<GregorianChantDivision, number> = {
    none: 0,
    minima: 0.5,
    minor: 0.75,
    major: 1,
    finalis: 1.2,
  };
  const div = (measure.chantDivision ?? 'none') as GregorianChantDivision;
  return maxUnitsInVoice + (divisionUnits[div] ?? 0);
}

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
  const isGregorianChant = composition.notationSystem === 'gregorian-chant';
  const chantSpacingScale =
    composition.chantSpacingDensity === 'tight'
      ? 0.82
      : composition.chantSpacingDensity === 'spacious'
      ? 1.2
      : 1;
  const maxMeasures = Math.max(...composition.staves.map((s) => s.measures.length), 1);
  const layout: Array<{ x: number; width: number }> = [];
  let cx = LEFT_MARGIN + CLEF_WIDTH;

  for (let i = 0; i < maxMeasures; i++) {
    const isPickup = composition.anacrusis && i === 0;
    const measure  = refMeasures[i];

    let w: number;
    if (isGregorianChant) {
      // Gregorian chant is usually free-rhythm and often a single long line.
      // Expand measure width with note count to avoid visual compression.
      const chantUnits = Math.max(
        ...composition.staves.map((staff) => chantMeasureVisualUnits(staff.measures[i])),
        0
      );
      w = Math.max(Math.round(220 * chantSpacingScale), Math.round((120 + chantUnits * 28) * chantSpacingScale));
    } else if (isPickup) {
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

  /**
   * Draw a slur arc as a custom SVG cubic-bezier curve.
   *
   * Unlike VexFlow's StaveTie (which uses a fixed curvature), this helper
   * scales the arc height proportionally to the horizontal span so the curve
   * never looks flat even for very long phrases.
   *
   * @param svgEl   The SVG element to append the path to.
   * @param startNote  The starting StaveNote (null = arriving from left margin).
   * @param endNote    The ending StaveNote   (null = departing to right margin).
   */
  /**
   * Draw a slur arc as a custom SVG cubic-bezier curve.
   *
   * @param svgEl      The SVG element to append the path to.
   * @param startNote  The starting StaveNote (null = arriving from left margin).
   * @param endNote    The ending StaveNote   (null = departing to right margin).
   * @param direction  'above' | 'below' | 'auto' (default). 'auto' uses stem direction.
   */
  private drawSlurArc(
    svgEl: SVGElement,
    startNote: any | null,
    endNote: any | null,
    direction: 'above' | 'below' | 'auto' = 'auto',
    leftAnchorX?: number,
    rightAnchorX?: number,
  ): void {
    try {
      let x1: number, y1: number, x2: number, y2: number;

      if (startNote && endNote) {
        x1 = startNote.getAbsoluteX();
        x2 = endNote.getAbsoluteX();
        y1 = (startNote.getYs?.() ?? [])[0] ?? 0;
        y2 = (endNote.getYs?.()   ?? [])[0] ?? 0;
      } else if (startNote) {
        // Departing half-arc — by default tail goes 70 px to the right.
        // For print cross-system continuation we can anchor to the system right edge.
        x1 = startNote.getAbsoluteX();
        x2 = rightAnchorX ?? (x1 + 70);
        y1 = y2 = (startNote.getYs?.() ?? [])[0] ?? 0;
      } else if (endNote) {
        // Arriving half-arc — by default tail comes 70 px from the left.
        // For print cross-system continuation we can anchor to the system left edge.
        x2 = endNote.getAbsoluteX();
        x1 = leftAnchorX ?? (x2 - 70);
        y1 = y2 = (endNote.getYs?.() ?? [])[0] ?? 0;
      } else {
        return;
      }

      const dist = x2 - x1;
      if (dist < 2) return;

      // Curve height scales with distance so wide slurs stay clearly arched.
      //   dist ~100 px  →  height ~15 px  (tight phrase)
      //   dist ~300 px  →  height ~30 px  (normal phrase)
      //   dist ~600 px  →  height ~50 px  (very long phrase)
      const curveHeight = Math.max(15, Math.min(55, dist * 0.1));

      // Resolve direction to a sign:
      //   'above'        → curve above the notes  (sign = −1)
      //   'below'        → curve below the notes  (sign = +1)
      //   'auto' (default) → opposite to stem:
      //       stem UP  → curve below  (+1)
      //       stem DOWN → curve above (−1)
      let sign: number;
      if (direction === 'above') {
        sign = -1;
      } else if (direction === 'below') {
        sign = 1;
      } else {
        // auto — use stem direction
        const stemDir: number =
          startNote?.getStemDirection?.() ?? endNote?.getStemDirection?.() ?? 1;
        sign = stemDir >= 0 ? 1 : -1;
      }

      const midY  = (y1 + y2) / 2;
      const cpY   = midY + sign * curveHeight;
      const cp1x  = x1 + dist * 0.25;
      const cp2x  = x1 + dist * 0.75;

      // Slightly inset endpoints so the arc starts/ends at the note-head edge
      const ex1 = x1 + 4;
      const ex2 = x2 - 4;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute(
        'd',
        `M ${ex1},${y1} C ${cp1x},${cpY} ${cp2x},${cpY} ${ex2},${y2}`,
      );
      path.setAttribute('stroke', '#000');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('stroke-linecap', 'round');
      svgEl.appendChild(path);
    } catch (err) {
      console.warn('Slur arc draw failed:', err);
    }
  }

  /**
   * Draw a tie arc as a custom SVG bezier curve with an explicit direction.
   * Call this instead of VexFlow's StaveTie when the note has slurDirection set.
   * Ties are always short (adjacent same-pitch notes) so the curve is compact.
   *
   * @param direction  'above' | 'below' (never 'auto' — caller guards this)
   */
  private drawTieArc(
    svgEl: SVGElement,
    startNote: any,
    endNote: any,
    direction: 'above' | 'below',
  ): void {
    try {
      const x1 = startNote.getAbsoluteX();
      const x2 = endNote.getAbsoluteX();
      const y1 = (startNote.getYs?.() ?? [])[0] ?? 0;
      const y2 = (endNote.getYs?.()   ?? [])[0] ?? 0;
      const dist = x2 - x1;
      if (dist < 2) return;

      // Ties are compact — small height, stays tight to noteheads
      const curveHeight = Math.max(8, Math.min(20, dist * 0.12));
      const sign  = direction === 'above' ? -1 : 1;
      const midY  = (y1 + y2) / 2;
      const cpY   = midY + sign * curveHeight;
      const cp1x  = x1 + dist * 0.3;
      const cp2x  = x1 + dist * 0.7;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${x1 + 3},${y1} C ${cp1x},${cpY} ${cp2x},${cpY} ${x2 - 3},${y2}`);
      path.setAttribute('stroke', '#000');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('stroke-linecap', 'round');
      svgEl.appendChild(path);
    } catch (err) {
      console.warn('Tie arc draw failed:', err);
    }
  }

  /**
   * Draw a tie continuation half-arc for cross-system print rendering.
   * - startNote only: departing half (to the right)
   * - endNote only:   arriving half (from the left)
   */
  private drawTieContinuationArc(
    svgEl: SVGElement,
    startNote: any | null,
    endNote: any | null,
    direction: 'above' | 'below' | 'auto' = 'auto',
  ): void {
    try {
      let x1: number, y1: number, x2: number, y2: number;
      if (startNote && endNote) {
        x1 = startNote.getAbsoluteX();
        x2 = endNote.getAbsoluteX();
        y1 = (startNote.getYs?.() ?? [])[0] ?? 0;
        y2 = (endNote.getYs?.()   ?? [])[0] ?? 0;
      } else if (startNote) {
        x1 = startNote.getAbsoluteX();
        x2 = x1 + 56;
        y1 = y2 = (startNote.getYs?.() ?? [])[0] ?? 0;
      } else if (endNote) {
        x2 = endNote.getAbsoluteX();
        x1 = x2 - 56;
        y1 = y2 = (endNote.getYs?.() ?? [])[0] ?? 0;
      } else {
        return;
      }

      const dist = x2 - x1;
      if (dist < 2) return;

      const curveHeight = Math.max(8, Math.min(18, dist * 0.14));
      let sign: number;
      if (direction === 'above') {
        sign = -1;
      } else if (direction === 'below') {
        sign = 1;
      } else {
        const stemDir: number =
          startNote?.getStemDirection?.() ?? endNote?.getStemDirection?.() ?? 1;
        sign = stemDir >= 0 ? 1 : -1;
      }

      const midY = (y1 + y2) / 2;
      const cpY  = midY + sign * curveHeight;
      const cp1x = x1 + dist * 0.3;
      const cp2x = x1 + dist * 0.7;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${x1 + 3},${y1} C ${cp1x},${cpY} ${cp2x},${cpY} ${x2 - 3},${y2}`);
      path.setAttribute('stroke', '#000');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('stroke-linecap', 'round');
      svgEl.appendChild(path);
    } catch (err) {
      console.warn('Tie continuation arc draw failed:', err);
    }
  }

  /** Resolve 'auto' slur direction once so multi-segment slurs stay consistent. */
  private resolveSlurDirection(
    direction: 'above' | 'below' | 'auto',
    startNote: any | null,
    endNote: any | null,
  ): 'above' | 'below' {
    if (direction === 'above' || direction === 'below') return direction;
    const stemDir: number =
      startNote?.getStemDirection?.() ?? endNote?.getStemDirection?.() ?? 1;
    return stemDir >= 0 ? 'below' : 'above';
  }

  private drawGregorianSymbol(svgEl: SVGElement, x: number, y: number, note: Note): void {
    const symbol: GregorianChantSymbol = note.chantSymbol ?? 'punctum';
    const ornament = note.chantOrnament ?? 'none';
    const size = 8;
    const half = size / 2;
    const createRect = (rx: number, ry: number, w = size, h = size, rotateDeg = 0) => {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String(rx));
      rect.setAttribute('y', String(ry));
      rect.setAttribute('width', String(w));
      rect.setAttribute('height', String(h));
      rect.setAttribute('fill', '#111');
      rect.setAttribute('stroke', '#000');
      rect.setAttribute('stroke-width', '0.8');
      if (rotateDeg !== 0) rect.setAttribute('transform', `rotate(${rotateDeg} ${rx + w / 2} ${ry + h / 2})`);
      svgEl.appendChild(rect);
    };
    const createLine = (x1: number, y1: number, x2: number, y2: number, w = 1.3) => {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(x1));
      line.setAttribute('y1', String(y1));
      line.setAttribute('x2', String(x2));
      line.setAttribute('y2', String(y2));
      line.setAttribute('stroke', '#000');
      line.setAttribute('stroke-width', String(w));
      line.setAttribute('stroke-linecap', 'round');
      svgEl.appendChild(line);
    };
    const createPath = (d: string, w = 1.2) => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('stroke', '#000');
      path.setAttribute('stroke-width', String(w));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-linecap', 'round');
      svgEl.appendChild(path);
    };

    switch (symbol) {
      case 'virga':
        createRect(x - half, y - half);
        createLine(x, y - half, x, y - 16);
        break;
      case 'podatus':
        createRect(x - 8, y - half);
        createRect(x, y - 10);
        break;
      case 'clivis':
        createRect(x - 8, y - 10);
        createRect(x, y - half);
        break;
      case 'torculus':
        createRect(x - 12, y - half);
        createRect(x - 4, y - 10);
        createRect(x + 4, y - half);
        break;
      case 'porrectus':
        createRect(x - 10, y - 10);
        createPath(`M ${x - 2} ${y - 6} L ${x + 8} ${y + 2}`);
        createRect(x + 8, y - 2);
        break;
      case 'quilisma':
        createPath(`M ${x - 8} ${y - 1} Q ${x - 6} ${y - 6} ${x - 4} ${y - 1} Q ${x - 2} ${y + 4} ${x} ${y - 1}`);
        createRect(x + 2, y - half);
        break;
      case 'liquescent':
        createRect(x - 3, y - 3, 6, 6, 45);
        break;
      case 'punctum':
      default:
        createRect(x - half, y - half);
        break;
    }

    if (ornament === 'episema') {
      createLine(x - 6, y - 12, x + 6, y - 12, 1.4);
    } else if (ornament === 'mora') {
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', String(x + 8));
      dot.setAttribute('cy', String(y));
      dot.setAttribute('r', '1.8');
      dot.setAttribute('fill', '#111');
      svgEl.appendChild(dot);
    }
  }

  private drawGregorianDivision(
    svgEl: SVGElement,
    x: number,
    topY: number,
    bottomY: number,
    division: GregorianChantDivision | undefined
  ): void {
    const kind = division ?? 'none';
    if (kind === 'none') return;
    const addBar = (dx: number, y1: number, y2: number, w = 1.2) => {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(x + dx));
      line.setAttribute('y1', String(y1));
      line.setAttribute('x2', String(x + dx));
      line.setAttribute('y2', String(y2));
      line.setAttribute('stroke', '#000');
      line.setAttribute('stroke-width', String(w));
      svgEl.appendChild(line);
    };
    const midY = (topY + bottomY) / 2;
    if (kind === 'minima') addBar(0, midY - 8, midY + 8);
    if (kind === 'minor') addBar(0, topY + 4, bottomY - 4);
    if (kind === 'major') {
      addBar(-2, topY + 2, bottomY - 2);
      addBar(2, topY + 2, bottomY - 2);
    }
    if (kind === 'finalis') {
      addBar(-2, topY, bottomY, 1.3);
      addBar(2, topY, bottomY, 2.2);
    }
  }

  private getGregorianClefSymbol(clef: Clef): string {
    // C-clef family (Do) and F-clef family (Fa)
    if (clef === 'bass') return '𝄢';
    return '𝄡';
  }

  private drawGregorianClef(
    svgEl: SVGElement,
    clef: Clef,
    x: number,
    topY: number,
    bottomY: number
  ): void {
    const symbol = this.getGregorianClefSymbol(clef);
    const yCenter = (topY + bottomY) / 2;
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(x));
    text.setAttribute('y', String(yCenter + (clef === 'bass' ? 8 : 7)));
    text.setAttribute('font-family', 'serif');
    text.setAttribute('font-size', clef === 'bass' ? '28' : '34');
    text.setAttribute('fill', '#000');
    text.setAttribute('text-anchor', 'middle');
    text.textContent = symbol;
    svgEl.appendChild(text);
  }

  /** Returns the exact note-head positions captured during the last render(). */
  getNotePositions(): RenderedNotePosition[] {
    return this.notePositions;
  }

  private drawHairpinWedge(
    svgEl: SVGElement,
    startX: number,
    endX: number,
    y: number,
    direction: 'crescendo' | 'decrescendo'
  ): void {
    const x1 = Math.min(startX, endX);
    const x2 = Math.max(startX, endX);
    if (x2 - x1 < 10) return;
    const centerY = y;
    const open = 7;
    const stroke = '#222';

    const pathA = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const pathB = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathA.setAttribute('fill', 'none');
    pathB.setAttribute('fill', 'none');
    pathA.setAttribute('stroke', stroke);
    pathB.setAttribute('stroke', stroke);
    pathA.setAttribute('stroke-width', '1.3');
    pathB.setAttribute('stroke-width', '1.3');

    if (direction === 'crescendo') {
      pathA.setAttribute('d', `M ${x1} ${centerY} L ${x2} ${centerY - open}`);
      pathB.setAttribute('d', `M ${x1} ${centerY} L ${x2} ${centerY + open}`);
    } else {
      pathA.setAttribute('d', `M ${x1} ${centerY - open} L ${x2} ${centerY}`);
      pathB.setAttribute('d', `M ${x1} ${centerY + open} L ${x2} ${centerY}`);
    }

    svgEl.appendChild(pathA);
    svgEl.appendChild(pathB);
  }

  private drawHairpins(composition: Composition): void {
    const svgEl = this.getSvgElement();
    if (!svgEl) return;
    const posMap = new Map<string, RenderedNotePosition>();
    this.notePositions.forEach((p) => {
      posMap.set(`${p.staffIndex}:${p.measureIndex}:${p.voiceIndex}:${p.noteDataIndex}`, p);
    });

    composition.staves.forEach((staff, staffIndex) => {
      const maxVoices = staff.measures.reduce((mx, measure) => Math.max(mx, measure.voices.length), 0);

      for (let voiceIndex = 0; voiceIndex < maxVoices; voiceIndex++) {
        let active:
          | { direction: 'crescendo' | 'decrescendo'; x: number; y: number }
          | null = null;
        let lastNotePos: RenderedNotePosition | null = null;

        for (let measureIndex = 0; measureIndex < staff.measures.length; measureIndex++) {
          const measure = staff.measures[measureIndex];
          const voice = measure.voices[voiceIndex];
          if (!voice) continue;

          for (let noteIndex = 0; noteIndex < voice.notes.length; noteIndex++) {
            const element = voice.notes[noteIndex];
            if (!('pitch' in element)) continue;
            const pos = posMap.get(`${staffIndex}:${measureIndex}:${voiceIndex}:${noteIndex}`);
            if (!pos) continue;
            lastNotePos = pos;
            const y = pos.y + 26;

            if (element.hairpinStart) {
              active = { direction: element.hairpinStart, x: pos.x, y };
            }
            if (active && element.hairpinEnd) {
              const renderY = Math.max(active.y, y);
              this.drawHairpinWedge(svgEl, active.x, pos.x, renderY, active.direction);
              active = null;
            }
          }
        }

        const trailingHairpin = active;
        if (trailingHairpin && lastNotePos) {
          this.drawHairpinWedge(
            svgEl,
            trailingHairpin.x,
            lastNotePos.x + 24,
            Math.max(trailingHairpin.y, lastNotePos.y + 26),
            trailingHairpin.direction
          );
        }
      }
    });
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

    const isGregorianChant = composition.notationSystem === 'gregorian-chant';
    const staffLineCount = isGregorianChant ? 4 : 5;
    const staffLineSpan = (staffLineCount - 1) * LINE_SPACING;
    const showMeasureNumbers = !isGregorianChant && composition.showMeasureNumbers !== false;
    const showTempoMarkings = !isGregorianChant;
    const showKeyAndTimeSignatures = !isGregorianChant;
    const baseKeySignature = isGregorianChant ? 'C' : composition.keySignature;
    const [beatsPerMeasure] = composition.timeSignature.split('/').map(Number);

    // Pickup-measure beats (0 means no anacrusis)
    const pickupBeats = composition.anacrusis ? (composition.pickupBeats ?? 1) : 0;

    // Use getMeasureLayout so pickup measure width is consistent with click handler
    const layout = getMeasureLayout(composition);
    const totalStavesWidth = layout.length > 0
      ? layout[layout.length - 1].x + layout[layout.length - 1].width - LEFT_MARGIN + 40
      : CLEF_WIDTH + 40;

    const neededWidth  = LEFT_MARGIN + totalStavesWidth;
    const visibleStaves = composition.staves
      .map((staff, index) => ({ staff, index }))
      .filter(({ staff }) => !staff.hidden);
    const visibleStaffCount = Math.max(visibleStaves.length, 1);
    const neededHeight = STAVE_Y_START + visibleStaffCount * ROW_SPACING + 60;

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
    // Position measure numbers above the top staff line
    const measureNumberY = STAVE_Y_START + STAFF_LINE_OFFSET - 10; // Above the top line

    visibleStaves.forEach(({ staff, index: staffIndex }, visibleRowIndex) => {
      const y = STAVE_Y_START + visibleRowIndex * ROW_SPACING;

      // ── Staff label (left side, editor view) ───────────────────────────────
      const staffLabel = staff.name?.trim() || `Staff ${staffIndex + 1}`;
      const svgElForLabel = this.getSvgElement();
      if (svgElForLabel) {
        const labelY = y + STAFF_LINE_OFFSET + 2 * LINE_SPACING;
        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        const labelX = LEFT_MARGIN - 12;
        txt.setAttribute('x', String(labelX));
        txt.setAttribute('y', String(labelY));
        txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('dominant-baseline', 'middle');
        txt.setAttribute('font-family', 'Arial, sans-serif');
        txt.setAttribute('font-size', '10');
        txt.setAttribute('font-style', 'italic');
        txt.setAttribute('fill', '#333');
        txt.setAttribute('transform', `rotate(-90 ${labelX} ${labelY})`);
        txt.textContent = staffLabel;
        svgElForLabel.appendChild(txt);
      }

      // ── 1. Header stave: clef + key signature + time signature ──────────────
      const headerStave = new Stave(LEFT_MARGIN, y, CLEF_WIDTH);
      (headerStave as any).setNumLines?.(staffLineCount);
      if (!isGregorianChant) {
        headerStave.addClef(staff.clef);
      }
      
      // Add key signature (VexFlow expects format like "C", "G", "F", "Bb", etc.)
      const vfKeySig = keySignatureToVexFlow(baseKeySignature);
      if (showKeyAndTimeSignatures && vfKeySig && vfKeySig !== 'C') {
        // Only add if not C major (no sharps/flats)
        try {
          headerStave.addKeySignature(vfKeySig);
        } catch (err) {
          console.warn(`Failed to add key signature "${vfKeySig}":`, err);
        }
      }
      
      if (showKeyAndTimeSignatures) {
        headerStave.addTimeSignature(composition.timeSignature);
      }
      headerStave.setContext(this.context).draw();
      if (isGregorianChant) {
        const svgEl = this.getSvgElement();
        if (svgEl) {
          const staffTop = y + STAFF_LINE_OFFSET;
          const staffBottom = staffTop + staffLineSpan;
          this.drawGregorianClef(svgEl, staff.clef, LEFT_MARGIN + 20, staffTop, staffBottom);
        }
      }

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
              const staffBottom = staffTop + staffLineSpan;
              
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
      // Track the previous measure's rendered tickables so we can draw a
      // tie arc that crosses the barline when the last note of measure N
      // has tie = true (standard in music — e.g. notes spanning a barline).
      let prevMeasureTickables: any[] | null = null;
      let prevMeasureDataIndices: number[] | null = null;
      let prevMeasureVoice: any | null = null;

      // Collect all measure data for two-pass slur drawing after the loop.
      // Slurs need one single arc spanning the ENTIRE phrase across all measures,
      // not separate per-measure arcs joined with connectors.
      const allMeasureData: Array<{ tickables: any[]; dataIndices: number[]; voice: any } | null> =
        new Array(staff.measures.length).fill(null);

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
        (measureStave as any).setNumLines?.(staffLineCount);

        // Add notation-change symbols at the start of this measure (skip measure 0 – already on header)
        if (measureIndex > 0) {
          const prevClef   = effectiveClef  (staff.measures, measureIndex - 1, staff.clef);
          const prevKeySig = effectiveKeySig(composition.staves[0]?.measures ?? [], measureIndex - 1, composition.keySignature);
          const prevTimeSig = effectiveTimeSig(composition.staves[0]?.measures ?? [], measureIndex - 1, composition.timeSignature);

          if (effClef !== prevClef) {
            if (!isGregorianChant) {
              try { measureStave.addClef(effClef); } catch (_) { /* skip */ }
            }
          }
          if (showKeyAndTimeSignatures && effKeySig !== prevKeySig) {
            const vfNew = keySignatureToVexFlow(effKeySig);
            try { measureStave.addKeySignature(vfNew || 'C'); } catch (_) { /* skip */ }
          }
          if (showKeyAndTimeSignatures && effTimeSig !== prevTimeSig) {
            try { measureStave.addTimeSignature(effTimeSig); } catch (_) { /* skip */ }
          }
        }

        measureStave.setContext(this.context).draw();
        if (isGregorianChant && measureIndex > 0) {
          const prevClef = effectiveClef(staff.measures, measureIndex - 1, staff.clef);
          if (effClef !== prevClef) {
            const svgEl = this.getSvgElement();
            if (svgEl) {
              const staffTop = y + STAFF_LINE_OFFSET;
              const staffBottom = staffTop + staffLineSpan;
              this.drawGregorianClef(svgEl, effClef, mx + 16, staffTop, staffBottom);
            }
          }
        }
        if (isGregorianChant) {
          const svgEl = this.getSvgElement();
          if (svgEl) {
            const staffTop = y + STAFF_LINE_OFFSET;
            const staffBottom = staffTop + staffLineSpan;
            this.drawGregorianDivision(svgEl, mx + mw - 6, staffTop, staffBottom, measure.chantDivision);
          }
        }

        // ── Draw chord symbols above the staff ────────────────────────────────────
        if (measure.chords && measure.chords.length > 0) {
          const svgEl = this.getSvgElement();
          if (svgEl) {
            // Calculate beat width in pixels
            const beatWidth = mw / effBPM;
            
            measure.chords.forEach((chord) => {
              // Calculate x position based on beat
              const chordX = mx + (chord.beat * beatWidth);
              
              // Position above the staff (above the top line)
              const chordY = y - 25; // Above the staff
              
              const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
              text.setAttribute('x', String(chordX));
              text.setAttribute('y', String(chordY));
              text.setAttribute('font-family', 'Arial, sans-serif');
              text.setAttribute('font-size', '14');
              text.setAttribute('font-weight', 'bold');
              text.setAttribute('fill', '#333');
              text.setAttribute('text-anchor', 'start');
              text.setAttribute('dominant-baseline', 'middle');
              text.textContent = chord.symbol;
              svgEl.appendChild(text);
            });
          }
        }

        // For anacrusis first measure, use pickupBeats as the Voice beat count
        const voiceBeats =
          composition.anacrusis && measureIndex === 0 ? pickupBeats : effBPM;

        // Build tickables (notes / rests), tracking data index for each tickable
        const tickables: any[] = [];
        const tickableDataIndices: number[] = []; // maps tickable index → voice.notes index
        const voice = measure.voices[0];
        const hasPolyphonicVoices =
          (measure.voices ?? []).filter((v) => v.notes.some((el) => 'pitch' in el)).length > 1;
        const primaryStemDir = hasPolyphonicVoices ? Stem.UP : undefined;
        const primaryXShift = hasPolyphonicVoices ? this.getVoiceXShift(0) : 0;

        if (voice) {
          voice.notes.forEach((element, dataIndex) => {
            if ('pitch' in element) {
              const staveNote = this.createStaveNote(
                element as Note,
                effClef,
                baseKeySignature,
                measure,
                dataIndex,
                composition.notationSystem ?? 'standard',
                primaryStemDir,
                primaryXShift
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
            if (voice && !isGregorianChant) {
              let beamGroup: any[] = [];
              let currentBeat = 0;
              let beamGroupStartBeat = 0;

              // Middle-line MIDI for stem-direction rule (staff line 3)
              const middleLineMidi = effClef === 'treble' ? 71  // B4
                                   : effClef === 'bass'   ? 50  // D3
                                   : effClef === 'alto'   ? 60  // C4
                                   : 57;                        // A3 (tenor)

              // Pre-scan: find the single farthest note (outlier) across ALL beamable
              // notes in this measure, then use ONE stem direction for every beam group.
              // This prevents adjacent beat-groups from flipping up/down, which looks
              // cluttered and is not standard engraving practice.
              let measureMaxDist = -1;
              let measureStemDir = primaryStemDir ?? Stem.DOWN; // equal-distance default
              for (const el of voice.notes) {
                if (!('pitch' in el)) continue;
                const rawDuration = (el as Note).duration;
                const base = rawDuration
                  .replace('dotted-', '')
                  .replace(/^(triplet|quintuplet|sextuplet|septuplet)-/, '');
                if (base !== 'eighth' && base !== 'sixteenth' && base !== 'thirty-second') continue;
                const dist = Math.abs(pitchToMidi((el as Note).pitch) - middleLineMidi);
                if (!primaryStemDir && dist > measureMaxDist) {
                  measureMaxDist = dist;
                  measureStemDir = pitchToMidi((el as Note).pitch) < middleLineMidi ? Stem.UP : Stem.DOWN;
                }
              }

              // Break beams at beat boundaries (standard engraving rule).
              // Compound time (6/8, 9/8, 12/8): group by dotted-quarter = 1.5 beats.
              // Simple time: one group per beat so musicians can see beat structure clearly.
              const isCompound = effBPM % 3 === 0 && effBPM > 3 && effBeatType === 8;
              const beatUnit = 4 / effBeatType; // one beat in quarter-note units
              const beamBeatSize = isCompound ? 1.5 : beatUnit;
              const beatGroupOf = (pos: number) => Math.floor(pos / beamBeatSize + 1e-9);

              const flushBeamGroup = () => {
                if (beamGroup.length >= 2) {
                  beamGroup.forEach((sn) => sn.setStemDirection(measureStemDir));
                  try { beams.push(new Beam(beamGroup)); } catch (_) { /* skip */ }
                }
                beamGroup = [];
              };

              for (let i = 0; i < voice.notes.length; i++) {
                const element = voice.notes[i];
                const elementBeats = durationToBeats(element.duration);
                const tickableIdx = tickableDataIndices.indexOf(i);
                if (tickableIdx < 0) { flushBeamGroup(); currentBeat += elementBeats; continue; }

                const staveNote = tickables[tickableIdx];

                if ('pitch' in element) {
                  const note = element as Note;
                  const base = note.duration
                    .replace('dotted-', '')
                    .replace(/^(triplet|quintuplet|sextuplet|septuplet)-/, '');
                  const isBeamable = base === 'eighth' || base === 'sixteenth' || base === 'thirty-second';

                  if (isBeamable) {
                    // Break beam at beat boundaries
                    if (beamGroup.length > 0 && beatGroupOf(currentBeat) !== beatGroupOf(beamGroupStartBeat)) {
                      flushBeamGroup();
                    }
                    if (beamGroup.length === 0) beamGroupStartBeat = currentBeat;
                    beamGroup.push(staveNote);
                  } else {
                    flushBeamGroup();
                  }
                } else {
                  // Rest breaks the beam group
                  flushBeamGroup();
                }
                currentBeat += elementBeats;
              }
              flushBeamGroup(); // flush any trailing group
            }

            const extraVoiceData = (measure.voices ?? [])
              .slice(1)
              .map((v, extraIdx) => {
                const extraTickables: any[] = [];
                const extraDataIndices: number[] = [];
                v.notes.forEach((element, dataIndex) => {
                  if ('pitch' in element) {
                    const sn = this.createStaveNote(
                      element as Note,
                      effClef,
                      baseKeySignature,
                      measure,
                      dataIndex,
                      composition.notationSystem ?? 'standard',
                      (extraIdx + 1) % 2 === 0 ? Stem.UP : Stem.DOWN,
                      hasPolyphonicVoices ? this.getVoiceXShift(extraIdx + 1) : 0
                    );
                    if (sn) { extraDataIndices.push(dataIndex); extraTickables.push(sn); }
                  } else {
                    const rn = this.createRestNote(element as Rest, effClef);
                    if (rn) { extraDataIndices.push(dataIndex); extraTickables.push(rn); }
                  }
                });
                return { voiceIndex: extraIdx + 1, voice: v, tickables: extraTickables, dataIndices: extraDataIndices };
              })
              .filter((v) => v.tickables.length > 0);

            const vfVoice = tickables.length > 0 ? new Voice({ num_beats: voiceBeats, beat_value: effBeatType }) : null;
            if (vfVoice) {
              vfVoice.setStrict(false);
              vfVoice.addTickables(tickables);
            }
            const extraVfVoices = extraVoiceData.map((ev) => {
              const vv = new Voice({ num_beats: voiceBeats, beat_value: effBeatType });
              vv.setStrict(false);
              vv.addTickables(ev.tickables);
              return vv;
            });
            const voicesToDraw = vfVoice ? [vfVoice, ...extraVfVoices] : [...extraVfVoices];
            if (voicesToDraw.length > 0) {
              const formatter = new Formatter();
              if (voicesToDraw.length > 1) formatter.joinVoices(voicesToDraw);
              formatter.format(voicesToDraw, mw - 30);
            }
            if (vfVoice) vfVoice.draw(this.context, measureStave);
            extraVfVoices.forEach((ev) => ev.draw(this.context, measureStave));

            // Draw beams after the voice so they render on top
            beams.forEach((b) => b.setContext(this.context).draw());

            // Draw tuplets (triplet durations) after note spacing is finalized.
            const tuplets = isGregorianChant ? [] : this.buildTuplets(voice, tickables, tickableDataIndices);
            tuplets.forEach((t) => t.setContext(this.context).draw());

            // ── Cross-measure tie / slur ──────────────────────────────────────────
            // If the last note of the PREVIOUS measure had tie or slur = true,
            // draw the arc now — both StaveNotes have positions after draw().
            if (prevMeasureTickables && prevMeasureDataIndices && prevMeasureVoice && voice) {
              // Walk backwards to find the last NOTE (not rest) in prev measure
              let xLastStaveNote: any = null;
              let xLastNoteEl: Note | null = null;
              for (let pi = prevMeasureDataIndices.length - 1; pi >= 0; pi--) {
                const el = prevMeasureVoice.notes[prevMeasureDataIndices[pi]];
                if (el && 'pitch' in el) {
                  xLastStaveNote = prevMeasureTickables[pi];
                  xLastNoteEl = el as Note;
                  break;
                }
              }
              // Walk forwards to find the first NOTE (not rest) in this measure
              let xFirstStaveNote: any = null;
              let xFirstNoteEl: Note | null = null;
              for (let ci = 0; ci < tickableDataIndices.length; ci++) {
                const el = voice.notes[tickableDataIndices[ci]];
                if (el && 'pitch' in el) {
                  xFirstStaveNote = tickables[ci];
                  xFirstNoteEl = el as Note;
                  break;
                }
              }
              // Ties require same pitch; cross-measure slurs are handled in the
              // two-pass post-loop below so they form one arc across all measures.
              const canDrawTie = xLastNoteEl?.tie && xFirstNoteEl && xLastNoteEl.pitch === xFirstNoteEl.pitch;
              if (canDrawTie && xLastStaveNote && xFirstStaveNote) {
                try {
                  const tieDir = xLastNoteEl?.tieDirection;
                  if (tieDir && tieDir !== 'auto') {
                    const svgEl = this.getSvgElement();
                    if (svgEl) this.drawTieArc(svgEl, xLastStaveNote, xFirstStaveNote, tieDir);
                  } else {
                    new StaveTie({
                      first_note: xLastStaveNote,
                      last_note: xFirstStaveNote,
                    }).setContext(this.context).draw();
                  }
                } catch (xErr) {
                  console.warn('Cross-measure tie draw failed:', xErr);
                }
              }
            }

            // ── Ties (drawn first so slur arcs render on top, encompassing them) ────
            // Music engraving rule (Gould §tie): when tied notes appear within a
            // slurred group, the slur arc must visually encompass the tie arc(s).
            // Drawing ties before slurs achieves the correct z-order in SVG.
            //
            // Tie rules: Each tie connects exactly TWO consecutive notes of the SAME pitch.
            // For 3+ notes of the same pitch (e.g., C4-C4-C4), you need separate ties:
            // - Tie from 1st to 2nd note (1st note has tie=true)
            // - Tie from 2nd to 3rd note (2nd note has tie=true)
            // This loop draws one tie per note-pair automatically.
            if (voice && voice.notes.length > 1) {
              for (let i = 0; i < voice.notes.length - 1; i++) {
                const element = voice.notes[i];
                if (!('pitch' in element)) continue;
                const note = element as Note;
                // note.tie = true means "tie this note to the next note"
                if (!note.tie) continue;
                const tickableIdx = tickableDataIndices.indexOf(i);
                if (tickableIdx < 0 || tickableIdx >= tickables.length) continue;
                const next = voice.notes[i + 1];
                if (!('pitch' in next)) continue;
                const nextNote = next as Note;
                // Ties only connect same-pitch notes (slurs can connect different pitches)
                if (nextNote.pitch !== note.pitch) continue;
                const nextTickableIdx = tickableDataIndices.indexOf(i + 1);
                if (nextTickableIdx < 0 || nextTickableIdx >= tickables.length) continue;
                    try {
                  const tieDir = note.tieDirection;
                  if (tieDir && tieDir !== 'auto') {
                    // User-specified direction — use custom SVG arc
                    const svgEl = this.getSvgElement();
                    if (svgEl) {
                      this.drawTieArc(svgEl, tickables[tickableIdx], tickables[nextTickableIdx], tieDir);
                  }
                } else {
                    new StaveTie({
                      first_note: tickables[tickableIdx],
                      last_note: tickables[nextTickableIdx],
                    }).setContext(this.context).draw();
                  }
                      } catch (err) {
                  console.warn('Failed to draw tie:', err);
                }
              }
            }

            // Slur chains are drawn in a single two-pass after all measures are
            // processed (see below). This guarantees ONE arc per phrase spanning
            // the full extent of the slur regardless of barlines.

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

            // ── Draw lyrics (below staff) ─────────────────────────────────────────
            if (voice) {
              const lyricBaselineY = y + STAFF_LINE_OFFSET + staffLineSpan + 28;
              voice.notes.forEach((element, dataIndex) => {
                if (!('pitch' in element) || !element.lyric) return;
                const tickableIdx = tickableDataIndices.indexOf(dataIndex);
                if (tickableIdx < 0 || tickableIdx >= tickables.length) return;
                const staveNote = tickables[tickableIdx];
                try {
                  const x = staveNote.getAbsoluteX();
                  if (!x) return;
                  const svgEl = this.getSvgElement();
                  if (!svgEl) return;
                  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                  text.setAttribute('x', String(x));
                  text.setAttribute('y', String(lyricBaselineY));
                  text.setAttribute('font-family', 'Arial, sans-serif');
                  text.setAttribute('font-size', '12');
                  text.setAttribute('fill', '#111');
                  text.setAttribute('text-anchor', 'middle');
                  text.textContent = element.lyric;
                  svgEl.appendChild(text);
                } catch (err) {
                  console.warn('Failed to draw lyric:', err);
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
                  if (isGregorianChant && 'pitch' in noteElement) {
                    const svgEl = this.getSvgElement();
                    if (svgEl) this.drawGregorianSymbol(svgEl, nx, ny, noteElement as Note);
                  }
                  
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

            // Capture positions for additional voices (rendered for imported chords/polyphony).
            extraVoiceData.forEach((ev) => {
              ev.tickables.forEach((sn, ti) => {
                try {
                  const nx = sn.getAbsoluteX();
                  const ys: number[] = sn.getYs?.() ?? [];
                  const ny = ys.length > 0 ? ys[0] : 0;
                  if (nx && ny) {
                    const noteDataIndex = ev.dataIndices[ti];
                    this.notePositions.push({
                      staffIndex,
                      measureIndex,
                      voiceIndex: ev.voiceIndex,
                      noteIndex: ti,
                      noteDataIndex,
                      x: nx,
                      y: ny,
                    });
                    const extraNoteElement = ev.voice.notes[noteDataIndex];
                    if (playingNotes && extraNoteElement && 'pitch' in extraNoteElement) {
                      const serialized = `${staffIndex}:${measureIndex}:${ev.voiceIndex}:${noteDataIndex}`;
                      if (playingNotes.has(serialized)) {
                        const svgEl = this.getSvgElement();
                        if (svgEl) {
                          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                          circle.setAttribute('cx', String(nx));
                          circle.setAttribute('cy', String(ny));
                          circle.setAttribute('r', '8');
                          circle.setAttribute('fill', '#fbbf24');
                          circle.setAttribute('opacity', '0.6');
                          circle.setAttribute('class', 'playing-note-highlight');
                          svgEl.insertBefore(circle, svgEl.firstChild);
                        }
                      }
                    }
                  }
                } catch (_) { /* skip */ }
              });
            });
          } catch (err) {
            console.warn(`Measure ${measureIndex + 1} render error:`, err);
          }

          // Store this measure's data so the next iteration can draw a
          // cross-measure tie if the last note of this measure needs one.
          prevMeasureTickables = tickables;
          prevMeasureDataIndices = [...tickableDataIndices];
          prevMeasureVoice = voice;
          // Also store for the two-pass slur drawing below.
          allMeasureData[measureIndex] = { tickables, dataIndices: [...tickableDataIndices], voice };
        }
      });

      // ── 3b. Two-pass slur drawing ────────────────────────────────────────────
      // Standard music notation: a slur is ONE smooth arc spanning the entire
      // phrase, regardless of how many barlines it crosses. We scan all notes
      // across all measures to detect chains of consecutive slur-flagged notes,
      // then draw a single StaveTie arc from the first to the endpoint of each chain.
      {
        let slurChainStart: { measureIdx: number; tickableIdx: number } | null = null;
        let slurChainDirection: 'above' | 'below' | 'auto' = 'auto';
        for (let mIdx = 0; mIdx < staff.measures.length; mIdx++) {
          const mData = allMeasureData[mIdx];
          if (!mData || !mData.voice) continue;
          for (let t = 0; t < mData.tickables.length; t++) {
            const dataIdx = mData.dataIndices[t];
            const el = mData.voice.notes[dataIdx];
            if (!el || !('pitch' in el)) continue; // rests don't break chains
            const note = el as Note;
            if (note.slur) {
              // Start of (or continuation of) a slur chain
              if (!slurChainStart) {
                slurChainStart = { measureIdx: mIdx, tickableIdx: t };
                // Capture direction from the first note of the chain
                slurChainDirection = (note.slurDirection ?? 'auto') as 'above' | 'below' | 'auto';
              }
            } else if (note.tie && slurChainStart) {
              // Tie WITHIN an active slur: the slur arc must encompass the tie arc.
              // Don't close the slur chain — let it keep extending.
              // If this tied note carries a direction override, prefer it.
              if (note.slurDirection && note.slurDirection !== 'auto') {
                slurChainDirection = note.slurDirection;
              }
            } else if (slurChainStart) {
              // Chain ended — draw ONE arc from start to this note
              const startMData = allMeasureData[slurChainStart.measureIdx];
              if (startMData) {
                const startTickable = startMData.tickables[slurChainStart.tickableIdx];
                const endTickable   = mData.tickables[t];
                const svgEl = this.getSvgElement();
                if (startTickable && endTickable && startTickable !== endTickable && svgEl) {
                  this.drawSlurArc(svgEl, startTickable, endTickable, slurChainDirection);
                }
              }
              slurChainStart = null;
              slurChainDirection = 'auto';
            }
          }
        }
        // If the chain reaches the end of the staff without a closing note, skip —
        // incomplete slurs are engraving errors and we don't draw a half-arc here.
      }

      // ── 4. Draw measure numbers and tempo markings (only on first staff) ───
      if (visibleRowIndex === 0) {
        const refMeasures = composition.staves[0]?.measures ?? [];
        staff.measures.forEach((measure, measureIndex) => {
          const { x: mx, width: mw } = layout[measureIndex] ?? {
            x: LEFT_MARGIN + CLEF_WIDTH + measureIndex * MEASURE_WIDTH,
            width: MEASURE_WIDTH,
          };
          
          // ── Measure numbers ───────────────────────────────────────────────────
          if (showMeasureNumbers) {
            // Calculate measure number (accounting for anacrusis)
            let measureNumber: number;
            if (composition.anacrusis && measureIndex === 0) {
              // Pickup measure is usually not numbered, or numbered as 0
              // We'll skip it or show it as a special marker
              // Skip numbering the pickup measure
            } else {
              // Regular measures: if anacrusis exists, subtract 1 from index
              measureNumber = composition.anacrusis ? measureIndex : measureIndex + 1;

              // Position number at the start (left edge) of the measure
              const numberX = mx + 5; // Small offset from the left edge
              
              // Draw measure number using SVG text element
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
            }
          }

          // ── Tempo markings ───────────────────────────────────────────────────
          // Show tempo marking at the first measure or when this measure introduces a tempo change
          const prevTempo = measureIndex > 0
            ? effectiveTempo(refMeasures, measureIndex - 1, composition.tempo)
            : composition.tempo;
          const currentTempo = effectiveTempo(refMeasures, measureIndex, composition.tempo);
          const isTempoChange = measureIndex === 0 || currentTempo !== prevTempo;

          if (showTempoMarkings && isTempoChange) {
            const svgElement = this.getSvgElement();
            if (svgElement) {
              // Position tempo marking above the staff, centered in the measure
              const tempoX = mx + mw / 2;
              const tempoY = measureNumberY - 8; // Slightly above measure numbers
              
              // Draw quarter note symbol + "= [tempo]"
              const tempoText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
              tempoText.setAttribute('x', String(tempoX));
              tempoText.setAttribute('y', String(tempoY));
              tempoText.setAttribute('font-family', 'Arial');
              tempoText.setAttribute('font-size', '12');
              tempoText.setAttribute('fill', '#333');
              tempoText.setAttribute('text-anchor', 'middle'); // Center alignment
              tempoText.setAttribute('dominant-baseline', 'text-bottom');
              // Use Unicode quarter note (♩) or fallback to "♩"
              tempoText.textContent = `♩ = ${currentTempo}`;
              svgElement.appendChild(tempoText);
            }
          }
        });
      }
    });

    // ── Draw hairpins (< and >) after note positions are captured ───────────
    this.drawHairpins(composition);

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
    
    // Middle line (staff line 3) MIDI values
    const middleLineMidi = clef === 'treble' ? 71  // B4
                         : clef === 'bass'   ? 50  // D3
                         : clef === 'alto'   ? 60  // C4
                         : 57;                     // A3 (tenor)
    
    // Notes on or above middle line: stem down, below: stem up
    // VexFlow uses Stem.DOWN (1) and Stem.UP (-1)
    return midi >= middleLineMidi ? Stem.DOWN : Stem.UP;
  }

  private getDurationInfo(duration: NoteDuration): {
    baseDuration: NoteDuration;
    isDotted: boolean;
    tupletKind: 'triplet' | 'quintuplet' | 'sextuplet' | 'septuplet' | null;
  } {
    const isDotted = duration.startsWith('dotted-');
    const tupletMatch = duration.match(/^(triplet|quintuplet|sextuplet|septuplet)-/);
    const tupletKind = (tupletMatch?.[1] as 'triplet' | 'quintuplet' | 'sextuplet' | 'septuplet' | undefined) ?? null;
    const baseDuration = duration
      .replace('dotted-', '')
      .replace('triplet-', '')
      .replace('quintuplet-', '')
      .replace('sextuplet-', '')
      .replace('septuplet-', '') as NoteDuration;
    return { baseDuration, isDotted, tupletKind };
  }

  private buildTuplets(voice: any, tickables: any[], tickableDataIndices: number[]): Tuplet[] {
    if (!voice || tickables.length === 0 || tickableDataIndices.length === 0) return [];

    const tuplets: Tuplet[] = [];
    const tickableByDataIndex = new Map<number, any>();
    tickableDataIndices.forEach((dataIndex, tickableIndex) => {
      tickableByDataIndex.set(dataIndex, tickables[tickableIndex]);
    });

    let i = 0;
    while (i < voice.notes.length) {
      const element = voice.notes[i];
      const duration = element?.duration as NoteDuration | undefined;
      if (!duration) {
        i++;
        continue;
      }

      const kindMatch = duration.match(/^(triplet|quintuplet|sextuplet|septuplet)-(.+)$/);
      if (!kindMatch) {
        i++;
        continue;
      }
      const [, kind, base] = kindMatch;
      const kindSpec: Record<string, { groupSize: number; notesOccupied: number }> = {
        triplet: { groupSize: 3, notesOccupied: 2 },
        quintuplet: { groupSize: 5, notesOccupied: 4 },
        sextuplet: { groupSize: 6, notesOccupied: 4 },
        septuplet: { groupSize: 7, notesOccupied: 4 },
      };
      const spec = kindSpec[kind];
      if (!spec) {
        i++;
        continue;
      }
      const groupStart = i;
      while (i < voice.notes.length) {
        const d = (voice.notes[i]?.duration as NoteDuration | undefined) ?? '';
        const m = d.match(/^(triplet|quintuplet|sextuplet|septuplet)-(.+)$/);
        if (!m || m[1] !== kind || m[2] !== base) break;
        i++;
      }

      const groupLen = i - groupStart;
      const fullGroups = Math.floor(groupLen / spec.groupSize);
      for (let g = 0; g < fullGroups; g++) {
        const start = groupStart + g * spec.groupSize;
        const groupTickables = Array.from({ length: spec.groupSize }, (_, offset) => start + offset)
          .map((dataIndex) => tickableByDataIndex.get(dataIndex))
          .filter(Boolean);
        if (groupTickables.length === spec.groupSize) {
          try {
            tuplets.push(
              new Tuplet(groupTickables, {
                num_notes: spec.groupSize,
                notes_occupied: spec.notesOccupied,
                ratioed: false,
              })
            );
          } catch {
            // Skip malformed tuplet groups.
          }
        }
      }
    }

    return tuplets;
  }

  // ────────────────────────────────────────────────────────────────────────────
  private createStaveNote(
    note: Note,
    clef: 'treble' | 'bass' | 'alto' | 'tenor',
    keySignature: string,
    measure?: Measure,
    noteIndex?: number,
    notationSystem: 'standard' | 'gregorian-chant' = 'standard',
    forcedStemDir?: number,
    forcedXShift?: number
  ): any {
    if (!note.pitch) return null;

    const { accidental } = parsePitch(note.pitch);
    const key = pitchToVexFlowKey(note.pitch);
    
    // Triplet and dotted modifiers are represented in our duration enum.
    const { baseDuration, isDotted } = this.getDurationInfo(note.duration);
    const duration = durationToVexFlow(baseDuration);

    try {
      const staveNote = new StaveNote({ clef, keys: [key], duration });

      // In multi-voice measures, force opposing stems so lanes read as separate voices.
      const stemDir = forcedStemDir ?? this.getStemDirection(note.pitch, clef);
      staveNote.setStemDirection(stemDir);
      // In 3-4 voice situations, notes can visually collapse into one notehead.
      // A tiny lane-specific x-shift keeps simultaneous voices distinguishable.
      if (typeof forcedXShift === 'number' && Number.isFinite(forcedXShift) && forcedXShift !== 0) {
        try {
          (staveNote as any).setXShift?.(forcedXShift);
        } catch {
          // no-op if current VexFlow build lacks setXShift
        }
      }
      if (notationSystem === 'gregorian-chant') {
        // Chant uses stemless puncta instead of modern oval heads with stems/flags.
        staveNote.setStemStyle({ strokeStyle: 'transparent', fillStyle: 'transparent' });
        staveNote.setFlagStyle({ strokeStyle: 'transparent', fillStyle: 'transparent' });
        staveNote.setKeyStyle(0, { strokeStyle: 'transparent', fillStyle: 'transparent' });
      }

      // Add augmentation dot if the duration is dotted
      if (isDotted && notationSystem !== 'gregorian-chant') {
        staveNote.addModifier(new Dot(), 0);
      }

      // Only show accidental if it's explicitly set on this note
      // Measure-level accidentals are applied for playback/placement but not shown visually
      // (they're implied by the first occurrence in the measure)
      const showAccidental = shouldShowAccidental(note.pitch, keySignature);
      const explicitAccidental = note.accidental;

      if (showAccidental || explicitAccidental) {
        if (accidental === '##' || accidental === 'x' || explicitAccidental === 'double-sharp') {
          staveNote.addModifier(new Accidental('##'), 0);
        } else if (accidental === '#' || explicitAccidental === 'sharp') {
          staveNote.addModifier(new Accidental('#'), 0);
        } else if (accidental === 'bb' || explicitAccidental === 'double-flat') {
          staveNote.addModifier(new Accidental('bb'), 0);
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

  private getVoiceXShift(voiceIndex: number): number {
    if (voiceIndex === 0) return 0;
    if (voiceIndex === 1) return -6;
    if (voiceIndex === 2) return 6;
    return -10;
  }

  private createRestNote(rest: Rest, clef: 'treble' | 'bass' | 'alto' | 'tenor'): any {
    const { baseDuration, isDotted } = this.getDurationInfo(rest.duration);
    const duration = durationToVexFlow(baseDuration);
    const key      = clef === 'bass' ? 'd/3' : 'b/4';
    try {
      const restNote = new StaveNote({ clef, keys: [key], duration: duration + 'r' });
      
      // Add augmentation dot if the duration is dotted
      if (isDotted) {
        restNote.addModifier(new Dot(), 0);
      }
      if (rest.hidden) {
        // Keep rhythmic spacing/alignment but hide scan-generated padding rests.
        restNote.setStyle({ fillStyle: 'transparent', strokeStyle: 'transparent' } as any);
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
    const isGregorianChant = composition.notationSystem === 'gregorian-chant';
    const chantSpacingScale =
      composition.chantSpacingDensity === 'tight'
        ? 0.82
        : composition.chantSpacingDensity === 'spacious'
        ? 1.2
        : 1;
    const staffLineCount = isGregorianChant ? 4 : 5;
    const staffLineSpan = (staffLineCount - 1) * LINE_SPACING;
    const showKeyAndTimeSignatures = !isGregorianChant;
    const showTempoMarkings = !isGregorianChant;
    const baseKeySignature = isGregorianChant ? 'C' : composition.keySignature;

    // ── Print-layout constants ─────────────────────────────────────────────
    const PRINT_CLEF_W   = 120;   // header stave width
    const PRINT_MEAS_W   = 200;   // each measure stave width (full measure)
    const STAVE_TOP      = 40;    // top-of-stave offset inside each system
    const SYSTEM_GAP     = 40;    // extra vertical gap between systems
    const TITLE_H        = 80;    // reserved at the very top for title text

    const [beatsPerMeasure, beatTypeValue] =
      composition.timeSignature.split('/').map(Number);
    const pickupBeats = composition.anacrusis ? (composition.pickupBeats ?? 1) : 0;
    const vfKeySig = keySignatureToVexFlow(baseKeySignature);

    // Helper to calculate pickup measure width for print (proportional to PRINT_MEAS_W)
    const getPickupMeasureWidthForPrint = (pickupBeats: number, beatsPerMeasure: number): number => {
      // Minimum 60px so even a single-beat pickup is readable
      return Math.max(60, Math.round((pickupBeats / beatsPerMeasure) * PRINT_MEAS_W));
    };

    const visibleStaves = composition.staves
      .map((staff, index) => ({ staff, index }))
      .filter(({ staff }) => !staff.hidden);
    const numStaves   = Math.max(visibleStaves.length, 1);
    const maxMeasures = Math.max(...composition.staves.map((s) => s.measures.length), 1);

    // Calculate actual measure widths (pickup measure is smaller)
    const measureWidths: number[] = [];
    for (let i = 0; i < maxMeasures; i++) {
      if (isGregorianChant) {
        const chantUnits = Math.max(
          ...composition.staves.map((staff) => chantMeasureVisualUnits(staff.measures[i])),
          0
        );
        measureWidths.push(
          Math.max(
            Math.round(220 * chantSpacingScale),
            Math.round((120 + chantUnits * 28) * chantSpacingScale)
          )
        );
      } else if (composition.anacrusis && i === 0) {
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

    // Horizontal note area bounds per system (used for cross-system slur anchors).
    const systemXBounds: Array<{ left: number; right: number }> = [];
    for (let s = 0; s < numSystems; s++) {
      const sStart = s * measPerSys;
      const sEnd = Math.min(sStart + measPerSys, maxMeasures);
      let widthSum = 0;
      for (let m = sStart; m < sEnd; m++) widthSum += (measureWidths[m] ?? PRINT_MEAS_W);
      const left = labelWidth + PRINT_CLEF_W;
      const right = left + widthSum;
      systemXBounds[s] = { left, right };
    }

    // ── Render each system ────────────────────────────────────────────────
    // Cross-measure/cross-system tie tracking.
    // Keyed by staffIdx; persists across sysIdx iterations.
    const prevPrintMeasure = new Map<number, {
      tickables: any[];
      dataIndices: number[];
      voice: any;
      measureIdx: number;
    }>();

    // Collect all print-note draw data (in rendered order) so slur chains can be
    // resolved in one global pass per staff after systems are laid out.
    const printSlurDataByStaff = new Map<number, Array<{
      sysIdx: number;
      tickable: any;
      noteEl: Note;
    }>>();

    for (let sysIdx = 0; sysIdx < numSystems; sysIdx++) {
      const sysStartM = sysIdx * measPerSys;
      const sysEndM   = Math.min(sysStartM + measPerSys, maxMeasures);
      const sysY      = TITLE_H + sysIdx * systemH;

      visibleStaves.forEach(({ staff, index: staffIdx }, visibleRowIdx) => {
        const staveY = sysY + STAVE_TOP + visibleRowIdx * ROW_SPACING;
        const staveX = labelWidth;

        // ── Header stave (clef + key sig; time sig only on system 0) ──────
        const headerStave = new Stave(staveX, staveY, PRINT_CLEF_W);
        (headerStave as any).setNumLines?.(staffLineCount);
        if (!isGregorianChant) {
          headerStave.addClef(staff.clef);
        }
        if (showKeyAndTimeSignatures && vfKeySig && vfKeySig !== 'C') {
          try { headerStave.addKeySignature(vfKeySig); } catch { /* ignore */ }
        }
        if (showKeyAndTimeSignatures && sysIdx === 0) {
          headerStave.addTimeSignature(composition.timeSignature);
        }
        headerStave.setContext(this.context).draw();
        if (isGregorianChant && svgEl) {
          const staffTop = staveY + STAFF_LINE_OFFSET;
          const staffBottom = staffTop + staffLineSpan;
          this.drawGregorianClef(svgEl, staff.clef, staveX + 18, staffTop, staffBottom);
        }

        // ── Staff label ────────────────────────────────────────────────────
        const staffLabel = staff.name?.trim() ||
          (numStaves > 1 ? `Staff ${staffIdx + 1}` : '');
        if (staffLabel && svgEl) {
          const labelY = staveY + STAFF_LINE_OFFSET + 2 * LINE_SPACING;
          const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          const labelX = staveX - 8;
          txt.setAttribute('x', String(labelX));
          txt.setAttribute('y', String(labelY));
          txt.setAttribute('text-anchor', 'middle');
          txt.setAttribute('dominant-baseline', 'middle');
          txt.setAttribute('font-family', 'Arial, sans-serif');
          txt.setAttribute('font-size', sysIdx === 0 ? '13' : '11');
          txt.setAttribute('font-style', 'italic');
          txt.setAttribute('fill', '#000');
          txt.setAttribute('transform', `rotate(-90 ${labelX} ${labelY})`);
          // Show full name on system 0; abbreviated (first word) on the rest
          txt.textContent = sysIdx === 0
            ? staffLabel
            : staffLabel.split(' ')[0];
          svgEl.appendChild(txt);
        }

        // ── Measure staves ────────────────────────────────────────────────
        // Collect all (note, tickable) pairs for this staff's system row so we
        // can draw ONE slur arc per phrase chain in a post-loop pass.
        const sysSlurData: Array<{ tickable: any; noteEl: Note }> = [];

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
          (measureStave as any).setNumLines?.(staffLineCount);
          measureStave.setContext(this.context).draw();
          if (isGregorianChant && svgEl) {
            const staffTop = staveY + STAFF_LINE_OFFSET;
            const staffBottom = staffTop + staffLineSpan;
            this.drawGregorianDivision(svgEl, measX + measWidth - 6, staffTop, staffBottom, measure.chantDivision);
          }

          const voiceBeats =
            composition.anacrusis && mIdx === 0 ? pickupBeats : beatsPerMeasure;
          const voice = measure.voices[0];
          const tickables: any[] = [];
          const tickableDataIndices: number[] = [];
          const hasPolyphonicVoices =
            (measure.voices ?? []).filter((v) => v.notes.some((el) => 'pitch' in el)).length > 1;
          const primaryStemDir = hasPolyphonicVoices ? Stem.UP : undefined;
          const primaryXShift = hasPolyphonicVoices ? this.getVoiceXShift(0) : 0;

          if (voice) {
            voice.notes.forEach((element, dataIndex) => {
              if ('pitch' in element) {
                const sn = this.createStaveNote(
                  element as Note, staff.clef, baseKeySignature, undefined, undefined, composition.notationSystem ?? 'standard', primaryStemDir, primaryXShift);
                if (sn) { tickableDataIndices.push(dataIndex); tickables.push(sn); }
              } else {
                const rn = this.createRestNote(element as Rest, staff.clef);
                if (rn) { tickableDataIndices.push(dataIndex); tickables.push(rn); }
              }
            });
          }

          if (tickables.length > 0) {
            try {
              // ── Build beam groups BEFORE formatting (same logic as render()) ──
              // Beam objects must exist before format() so VexFlow suppresses
              // individual flags on beamed notes. They are drawn after the voice.
              const beams: Beam[] = [];
              if (voice && !isGregorianChant) {
                let beamGroup: any[] = [];
                let currentBeat = 0;
                let beamGroupStartBeat = 0;

                // Middle-line MIDI for stem-direction rule (staff line 3)
                const printMiddleLineMidi = staff.clef === 'treble' ? 71  // B4
                                          : staff.clef === 'bass'   ? 50  // D3
                                          : staff.clef === 'alto'   ? 60  // C4
                                          : 57;                           // A3 (tenor)

                // Pre-scan: one stem direction for ALL beam groups in this measure
                // so adjacent beat-groups never flip up/down independently.
                let printMeasureMaxDist = -1;
                let printMeasureStemDir = primaryStemDir ?? Stem.DOWN;
                for (const el of voice.notes) {
                  if (!('pitch' in el)) continue;
                  const rawDuration = (el as Note).duration;
                  const base = rawDuration
                    .replace('dotted-', '')
                    .replace(/^(triplet|quintuplet|sextuplet|septuplet)-/, '');
                  if (base !== 'eighth' && base !== 'sixteenth' && base !== 'thirty-second') continue;
                  const dist = Math.abs(pitchToMidi((el as Note).pitch) - printMiddleLineMidi);
                  if (!primaryStemDir && dist > printMeasureMaxDist) {
                    printMeasureMaxDist = dist;
                    printMeasureStemDir = pitchToMidi((el as Note).pitch) < printMiddleLineMidi ? Stem.UP : Stem.DOWN;
                  }
                }

                const isCompound = beatsPerMeasure % 3 === 0 && beatsPerMeasure > 3 && beatTypeValue === 8;
                const beatUnit = 4 / beatTypeValue;
                const beamBeatSize = isCompound ? 1.5 : beatUnit;
                const beatGroupOf = (pos: number) => Math.floor(pos / beamBeatSize + 1e-9);

                const flushBeamGroup = () => {
                  if (beamGroup.length >= 2) {
                    beamGroup.forEach((sn) => sn.setStemDirection(printMeasureStemDir));
                    try { beams.push(new Beam(beamGroup)); } catch (_) { /* skip */ }
                  }
                  beamGroup = [];
                };

                for (let i = 0; i < voice.notes.length; i++) {
                  const element = voice.notes[i];
                  const elementBeats = durationToBeats(element.duration);
                  const tickableIdx = tickableDataIndices.indexOf(i);
                  if (tickableIdx < 0) { flushBeamGroup(); currentBeat += elementBeats; continue; }

                  const staveNote = tickables[tickableIdx];

                  if ('pitch' in element) {
                    const note = element as Note;
                    const base = note.duration
                      .replace('dotted-', '')
                      .replace(/^(triplet|quintuplet|sextuplet|septuplet)-/, '');
                    const isBeamable =
                      base === 'eighth' || base === 'sixteenth' || base === 'thirty-second';

                    if (isBeamable) {
                      if (beamGroup.length > 0 && beatGroupOf(currentBeat) !== beatGroupOf(beamGroupStartBeat)) {
                        flushBeamGroup();
                      }
                      if (beamGroup.length === 0) beamGroupStartBeat = currentBeat;
                      beamGroup.push(staveNote);
                    } else {
                      flushBeamGroup();
                    }
                  } else {
                    // Rest breaks the beam group
                    flushBeamGroup();
                  }
                  currentBeat += elementBeats;
                }
                flushBeamGroup(); // flush any trailing group
              }

              const extraVoiceData = (measure.voices ?? [])
                .slice(1)
                .map((v, extraIdx) => {
                  const extraTickables: any[] = [];
                  v.notes.forEach((element) => {
                    if ('pitch' in element) {
                      const sn = this.createStaveNote(
                        element as Note,
                        staff.clef,
                        baseKeySignature,
                        undefined,
                        undefined,
                        composition.notationSystem ?? 'standard',
                        (extraIdx + 1) % 2 === 0 ? Stem.UP : Stem.DOWN,
                        hasPolyphonicVoices ? this.getVoiceXShift(extraIdx + 1) : 0
                      );
                      if (sn) extraTickables.push(sn);
                    } else {
                      const rn = this.createRestNote(element as Rest, staff.clef);
                      if (rn) extraTickables.push(rn);
                    }
                  });
                  return extraTickables;
                })
                .filter((arr) => arr.length > 0);
              const extraVfVoices = extraVoiceData.map((extraTickables) => {
                const vv = new Voice({ num_beats: voiceBeats, beat_value: beatTypeValue });
                vv.setStrict(false);
                vv.addTickables(extraTickables);
                return vv;
              });
              const vfVoice = tickables.length > 0 ? new Voice({ num_beats: voiceBeats, beat_value: beatTypeValue }) : null;
              if (vfVoice) {
                vfVoice.setStrict(false);
                vfVoice.addTickables(tickables);
              }
              const voicesToDraw = vfVoice ? [vfVoice, ...extraVfVoices] : [...extraVfVoices];
              if (voicesToDraw.length > 0) {
                const formatter = new Formatter();
                if (voicesToDraw.length > 1) formatter.joinVoices(voicesToDraw);
                formatter.format(voicesToDraw, measWidth - 30);
              }
              if (vfVoice) vfVoice.draw(this.context, measureStave);
              extraVfVoices.forEach((ev) => ev.draw(this.context, measureStave));

              // Draw beams after the voice so they render on top
              beams.forEach((b) => b.setContext(this.context).draw());

              // Draw tuplets (triplet durations) after note spacing is finalized.
              const tuplets = isGregorianChant ? [] : this.buildTuplets(voice, tickables, tickableDataIndices);
              tuplets.forEach((t) => t.setContext(this.context).draw());

              // ── Ties (drawn first — slur arcs must encompass tie arcs) ──────────
              // Tie rules: Each tie connects exactly TWO consecutive notes of the SAME pitch.
              // For 3+ notes of the same pitch, you need separate ties for each pair.
              // note.tie = true means "tie this note to the next note".
              if (voice && voice.notes.length > 1) {
                for (let i = 0; i < voice.notes.length - 1; i++) {
                  const el = voice.notes[i];
                  if (!('pitch' in el)) continue;
                  const n = el as Note;
                  if (!n.tie) continue;
                  const tIdx = tickableDataIndices.indexOf(i);
                  if (tIdx < 0 || tIdx >= tickables.length) continue;
                  const nextEl = voice.notes[i + 1];
                  if (!('pitch' in nextEl)) continue;
                  const nextN = nextEl as Note;
                  // Ties only connect same-pitch notes (slurs can connect different pitches)
                  if (nextN.pitch !== n.pitch) continue;
                  const nextTIdx = tickableDataIndices.indexOf(i + 1);
                  if (nextTIdx < 0 || nextTIdx >= tickables.length) continue;
                  try {
                    const tieDir = n.tieDirection;
                    if (tieDir && tieDir !== 'auto' && svgEl) {
                      this.drawTieArc(svgEl, tickables[tIdx], tickables[nextTIdx], tieDir);
                    } else {
                      new StaveTie({ first_note: tickables[tIdx], last_note: tickables[nextTIdx] })
                        .setContext(this.context).draw();
                    }
                  } catch (tErr) {
                    console.warn('Within-measure tie (print) failed:', tErr);
                  }
                }
              }

              // ── Cross-measure tie (same system) ──────────────────────────────
              // Slurs are handled in the per-system two-pass below.
              const prevPrintData = prevPrintMeasure.get(staffIdx);
              if (prevPrintData && voice) {
                let xLastStaveNote: any = null;
                let xLastNoteEl: Note | null = null;
                for (let pi = prevPrintData.dataIndices.length - 1; pi >= 0; pi--) {
                  const el = prevPrintData.voice?.notes[prevPrintData.dataIndices[pi]];
                  if (el && 'pitch' in el) {
                    xLastStaveNote = prevPrintData.tickables[pi];
                    xLastNoteEl = el as Note;
                    break;
                  }
                }
                let xFirstStaveNote: any = null;
                let xFirstNoteEl: Note | null = null;
                for (let ci = 0; ci < tickableDataIndices.length; ci++) {
                  const el = voice.notes[tickableDataIndices[ci]];
                  if (el && 'pitch' in el) {
                    xFirstStaveNote = tickables[ci];
                    xFirstNoteEl = el as Note;
                    break;
                  }
                }
                const canDrawTie = xLastNoteEl?.tie && xFirstNoteEl &&
                  xLastNoteEl.pitch === xFirstNoteEl.pitch;
                if (canDrawTie && xLastStaveNote && xFirstStaveNote) {
                  try {
                    const tieDir = xLastNoteEl?.tieDirection;
                    const isCrossSystemTie = prevPrintData.measureIdx < sysStartM;
                    if (isCrossSystemTie && svgEl) {
                      // System break: draw two half-ties instead of a long diagonal tie
                      // spanning whitespace between systems.
                      this.drawTieContinuationArc(svgEl, xLastStaveNote, null, tieDir ?? 'auto');
                      this.drawTieContinuationArc(svgEl, null, xFirstStaveNote, tieDir ?? 'auto');
                    } else if (tieDir && tieDir !== 'auto' && svgEl) {
                      this.drawTieArc(svgEl, xLastStaveNote, xFirstStaveNote, tieDir);
                    } else {
                      new StaveTie({ first_note: xLastStaveNote, last_note: xFirstStaveNote })
                        .setContext(this.context).draw();
                    }
                  } catch (xErr) {
                    console.warn('Cross-measure tie (print) failed:', xErr);
                  }
                }
              }

              // ── Collect this measure's note-tickable pairs for slur drawing ──
              if (voice) {
                if (!printSlurDataByStaff.has(staffIdx)) {
                  printSlurDataByStaff.set(staffIdx, []);
                }
                const staffSlurData = printSlurDataByStaff.get(staffIdx)!;
                for (let t = 0; t < tickableDataIndices.length; t++) {
                  const dataIdx = tickableDataIndices[t];
                  const el = voice.notes[dataIdx];
                  if (el && 'pitch' in el) {
                    const noteEl = el as Note;
                    sysSlurData.push({ tickable: tickables[t], noteEl });
                    staffSlurData.push({ sysIdx, tickable: tickables[t], noteEl });
                  }
                }
              }

              // ── Draw lyrics in print view (below staff) ───────────────────────
              if (voice && svgEl) {
                if (isGregorianChant) {
                  for (let t = 0; t < tickableDataIndices.length; t++) {
                    const dataIdx = tickableDataIndices[t];
                    const el = voice.notes[dataIdx];
                    if (!el || !('pitch' in el)) continue;
                    try {
                      const x = tickables[t].getAbsoluteX();
                      const ys: number[] = tickables[t].getYs?.() ?? [];
                      const y = ys.length > 0 ? ys[0] : 0;
                      if (x && y) this.drawGregorianSymbol(svgEl, x, y, el as Note);
                    } catch {
                      // skip punctum if note coordinates unavailable
                    }
                  }
                }
                const lyricBaselineY = staveY + STAFF_LINE_OFFSET + staffLineSpan + 24;
                voice.notes.forEach((element, dataIndex) => {
                  if (!('pitch' in element) || !element.lyric) return;
                  const tickableIdx = tickableDataIndices.indexOf(dataIndex);
                  if (tickableIdx < 0 || tickableIdx >= tickables.length) return;
                  const staveNote = tickables[tickableIdx];
                  try {
                    const x = staveNote.getAbsoluteX();
                    if (!x) return;
                    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    text.setAttribute('x', String(x));
                    text.setAttribute('y', String(lyricBaselineY));
                    text.setAttribute('font-family', 'Arial, sans-serif');
                    text.setAttribute('font-size', '11');
                    text.setAttribute('fill', '#111');
                    text.setAttribute('text-anchor', 'middle');
                    text.textContent = element.lyric;
                    svgEl.appendChild(text);
                  } catch (err) {
                    console.warn('Failed to draw print lyric:', err);
                  }
                });
              }
            } catch (err) {
              console.warn(`Print system ${sysIdx} measure ${mIdx} error:`, err);
            }

            // Store this measure's tickable data for the next iteration
            prevPrintMeasure.set(staffIdx, {
              tickables,
              dataIndices: [...tickableDataIndices],
              voice,
              measureIdx: mIdx,
            });
          }

          // ── Measure numbers and tempo markings (first staff only) ─────────
          if (visibleRowIdx === 0 && svgEl) {
            const isPickup = composition.anacrusis && mIdx === 0;
            if (!isPickup) {
              // Measure number
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

            // Tempo marking at first measure or when this measure introduces a tempo change
            const refMeasures = composition.staves[0]?.measures ?? [];
            const prevTempo = mIdx > 0
              ? effectiveTempo(refMeasures, mIdx - 1, composition.tempo)
              : composition.tempo;
            const currentTempo = effectiveTempo(refMeasures, mIdx, composition.tempo);
            const isTempoChange = mIdx === 0 || currentTempo !== prevTempo;

            if (showTempoMarkings && isTempoChange) {
              // Position tempo marking centered in the measure, above the staff
              const tempoX = measX + measWidth / 2;
              const tempoY = staveY + STAFF_LINE_OFFSET - 14; // Above measure numbers
              
              const tempoTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
              tempoTxt.setAttribute('x', String(tempoX));
              tempoTxt.setAttribute('y', String(tempoY));
              tempoTxt.setAttribute('font-family', 'Arial');
              tempoTxt.setAttribute('font-size', '11');
              tempoTxt.setAttribute('fill', '#444');
              tempoTxt.setAttribute('text-anchor', 'middle');
              tempoTxt.textContent = `♩ = ${currentTempo}`;
              svgEl.appendChild(tempoTxt);
            }
          }

          // Advance position for next measure
          cumulativeX += measWidth;
        }

        // Slurs for print are drawn in one global pass after all systems are
        // rendered, so cross-system chains are resolved consistently.
      });

      // ── Left bracket connecting all staves in this system ─────────────────
      if (numStaves > 1 && svgEl) {
        const bx       = labelWidth - 4;
        const topLineY = sysY + STAVE_TOP + STAFF_LINE_OFFSET;
        const botLineY = sysY + STAVE_TOP
                       + (numStaves - 1) * ROW_SPACING
                       + STAFF_LINE_OFFSET + staffLineSpan;

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

    // ── Global slur pass for print/PDF ───────────────────────────────────────
    // Mirror editor chain logic, then split only when the chain crosses systems.
    if (svgEl) {
      printSlurDataByStaff.forEach((staffData) => {
        let chainStartIdx: number | null = null;
        let chainDir: 'above' | 'below' | 'auto' = 'auto';

        const drawChain = (endIdx: number) => {
          if (chainStartIdx === null) return;
          const start = staffData[chainStartIdx];
          const end = staffData[endIdx];
          if (!start || !end) return;
          if (start.tickable === end.tickable) return;
          const resolvedDir = this.resolveSlurDirection(chainDir, start.tickable, end.tickable);

          if (start.sysIdx === end.sysIdx) {
            this.drawSlurArc(svgEl, start.tickable, end.tickable, resolvedDir);
          } else {
            // Cross-system slur: split into standard continuation arcs.
            const startBounds = systemXBounds[start.sysIdx];
            const endBounds = systemXBounds[end.sysIdx];
            this.drawSlurArc(
              svgEl,
              start.tickable,
              null,
              resolvedDir,
              undefined,
              startBounds?.right
            ); // depart to right system edge
            this.drawSlurArc(
              svgEl,
              null,
              end.tickable,
              resolvedDir,
              endBounds?.left,
              undefined
            ); // arrive from left system edge
          }
        };

        for (let i = 0; i < staffData.length; i++) {
          const note = staffData[i].noteEl;
          if (note.slur) {
            if (chainStartIdx === null) {
              chainStartIdx = i;
              chainDir = (note.slurDirection ?? 'auto') as 'above' | 'below' | 'auto';
            }
          } else if (note.tie && chainStartIdx !== null) {
            if (note.slurDirection && note.slurDirection !== 'auto') {
              chainDir = note.slurDirection;
            }
          } else if (chainStartIdx !== null) {
            drawChain(i);
            chainStartIdx = null;
            chainDir = 'auto';
          }
        }
      });
    }

    return svgEl;
  }
}
