import { Composition } from '../types/music';
import { pitchToMidi, applyKeySignature } from './noteUtils';
import { durationToBeats } from './durationUtils';
import { VexFlowRenderer } from '../music/renderer/vexflowRenderer';

// ── MIDI helpers ─────────────────────────────────────────────────────────────

/** Write a MIDI variable-length quantity (VLQ) into the events array. */
function writeVLQ(events: number[], value: number): void {
  // A do-while correctly handles value=0 (emits a single 0x00 byte)
  const bytes: number[] = [];
  let v = value;
  do {
    bytes.unshift(v & 0x7F);
    v >>>= 7;
  } while (v > 0);
  bytes.forEach((b, i) => events.push(i < bytes.length - 1 ? (b | 0x80) : b));
}

// ── Instrument → General MIDI program number ─────────────────────────────────
const INSTRUMENT_PROGRAM: Record<string, number> = {
  acoustic_grand_piano: 0, piano: 0,
  bright_acoustic_piano: 1,
  electric_grand_piano: 2,
  honky_tonk_piano: 3,
  electric_piano_1: 4, electric_piano: 4,
  electric_piano_2: 5,
  harpsichord: 6,
  clavi: 7,
  celesta: 8,
  glockenspiel: 9,
  vibraphone: 11,
  marimba: 12,
  xylophone: 13,
  tubular_bells: 14,
  drawbar_organ: 16, organ: 16,
  percussive_organ: 17,
  rock_organ: 18,
  church_organ: 19,
  accordion: 21,
  harmonica: 22,
  acoustic_guitar_nylon: 24, guitar: 24,
  acoustic_guitar_steel: 25,
  electric_guitar_jazz: 26,
  electric_guitar_clean: 27,
  overdriven_guitar: 29,
  distortion_guitar: 30,
  acoustic_bass: 32,
  electric_bass_finger: 33,
  electric_bass_pick: 34,
  fretless_bass: 35,
  violin: 40,
  viola: 41,
  cello: 42,
  contrabass: 43,
  pizzicato_strings: 45,
  orchestral_harp: 46, harp: 46,
  timpani: 47,
  string_ensemble_1: 48,
  choir_aahs: 52,
  trumpet: 56,
  trombone: 57,
  tuba: 58,
  muted_trumpet: 59,
  french_horn: 60,
  brass_section: 61,
  soprano_sax: 64,
  alto_sax: 65,
  tenor_sax: 66,
  baritone_sax: 67,
  oboe: 68,
  english_horn: 69,
  bassoon: 70,
  clarinet: 71,
  piccolo: 72,
  flute: 73,
  recorder: 74,
  pan_flute: 75,
  synth_lead: 80,
  synth_pad: 88,
};

/** Wrap a raw event byte array as an MTrk chunk (header + length + data). */
function buildTrackChunk(data: number[]): Uint8Array {
  const chunk = new Uint8Array(8 + data.length);
  chunk[0] = 0x4D; chunk[1] = 0x54; chunk[2] = 0x72; chunk[3] = 0x6B; // "MTrk"
  chunk[4] = (data.length >> 24) & 0xFF;
  chunk[5] = (data.length >> 16) & 0xFF;
  chunk[6] = (data.length >>  8) & 0xFF;
  chunk[7] =  data.length        & 0xFF;
  chunk.set(data, 8);
  return chunk;
}

/**
 * Export composition to MIDI Format 1 (multi-track).
 * Track 0 carries tempo/time-sig/key-sig; each subsequent track is one staff.
 * All staff tracks start at tick 0, so they play SIMULTANEOUSLY.
 */
export async function exportToMIDI(composition: Composition): Promise<Blob> {
  const TICKS_PER_QUARTER = 480;

  // ── Per-measure effective value helpers ───────────────────────────────────
  const refMeasures = composition.staves[0]?.measures ?? [];

  function midiEffTimeSig(upTo: number): string {
    for (let i = upTo; i >= 0; i--) if (refMeasures[i]?.timeSignature) return refMeasures[i].timeSignature!;
    return composition.timeSignature;
  }
  function midiEffKeySig(upTo: number): string {
    for (let i = upTo; i >= 0; i--) if (refMeasures[i]?.keySignature) return refMeasures[i].keySignature!;
    return composition.keySignature;
  }
  function midiEffTempo(upTo: number): number {
    for (let i = upTo; i >= 0; i--) if (refMeasures[i]?.tempo !== undefined) return refMeasures[i].tempo!;
    return composition.tempo;
  }

  function keySfValue(sig: string): number {
    const k = sig.replace(/♭/g, 'b').replace(/♯/g, '#');
    const KEY_MAP: Record<string, number> = {
      'Gb': -6, 'Db': -5, 'Ab': -4, 'Eb': -3, 'Bb': -2, 'F': -1,
      'C': 0, 'G': 1, 'D': 2, 'A': 3, 'E': 4, 'B': 5, 'F#': 6,
    };
    const v = KEY_MAP[k] ?? 0;
    return v >= 0 ? v : 256 + v;
  }

  // ── Pre-compute absolute start tick for each measure ──────────────────────
  const measureStartTick: number[] = [];
  {
    let t = 0;
    const numMeasures = refMeasures.length;
    for (let m = 0; m < numMeasures; m++) {
      measureStartTick.push(t);
      const effTs = midiEffTimeSig(m);
      const [effN] = effTs.split('/').map(Number);
      const mBeats =
        m === 0 && composition.anacrusis ? (composition.pickupBeats ?? 1) : effN;
      t += Math.round(mBeats * TICKS_PER_QUARTER);
    }
  }

  // ── Track 0 – tempo / time-sig / key-sig (including mid-composition changes)
  const t0: number[] = [];

  // Emit initial meta events at tick 0
  {
    const ts = composition.timeSignature;
    const [tsN, tsD] = ts.split('/').map(Number);
    const tUs = Math.round((60 / composition.tempo) * 1_000_000);

    writeVLQ(t0, 0);
    t0.push(0xFF, 0x51, 0x03,
      (tUs >> 16) & 0xFF, (tUs >> 8) & 0xFF, tUs & 0xFF);

    writeVLQ(t0, 0);
    t0.push(0xFF, 0x58, 0x04, tsN, Math.round(Math.log2(tsD)), 0x18, 0x08);

    writeVLQ(t0, 0);
    t0.push(0xFF, 0x59, 0x02, keySfValue(composition.keySignature), 0x00);
  }

  // Emit mid-composition change meta events for each measure that has overrides
  {
    let prevTick = 0;
    refMeasures.forEach((measure, mIdx) => {
      if (mIdx === 0) return; // already emitted above
      const tick = measureStartTick[mIdx] ?? 0;

      if (measure.tempo !== undefined) {
        const tUs = Math.round((60 / measure.tempo) * 1_000_000);
        writeVLQ(t0, tick - prevTick);
        t0.push(0xFF, 0x51, 0x03,
          (tUs >> 16) & 0xFF, (tUs >> 8) & 0xFF, tUs & 0xFF);
        prevTick = tick;
      }
      if (measure.timeSignature) {
        const [n, d] = measure.timeSignature.split('/').map(Number);
        writeVLQ(t0, tick - prevTick);
        t0.push(0xFF, 0x58, 0x04, n, Math.round(Math.log2(d)), 0x18, 0x08);
        prevTick = tick;
      }
      if (measure.keySignature) {
        writeVLQ(t0, tick - prevTick);
        t0.push(0xFF, 0x59, 0x02, keySfValue(measure.keySignature), 0x00);
        prevTick = tick;
      }
    });
  }

  writeVLQ(t0, 0);
  t0.push(0xFF, 0x2F, 0x00); // end of track

  // ── One track per staff ───────────────────────────────────────────────────
  interface EvtRaw { tick: number; type: 'on' | 'off'; note: number; vel: number; }

  const staffTrackChunks: Uint8Array[] = composition.staves.map((staff, staffIdx) => {
    // MIDI channel: 0-8, skipping channel 9 (reserved for drums)
    const ch = staffIdx < 9 ? staffIdx : staffIdx + 1;
    const prog = INSTRUMENT_PROGRAM[staff.instrument] ?? 0;

    const rawEvts: EvtRaw[] = [];

    staff.measures.forEach((measure, mIdx) => {
      const measStart = measureStartTick[mIdx] ?? 0;
      // Use effective key sig and tempo at this measure for correct pitch / timing
      const measKeySig = midiEffKeySig(mIdx);

      measure.voices.forEach((voice) => {
        let voiceTick = measStart;

        voice.notes.forEach((element) => {
          const beats = durationToBeats(element.duration);
          const ticks = Math.max(1, Math.round(beats * TICKS_PER_QUARTER));

          if ('pitch' in element) {
            const actual   = applyKeySignature(element.pitch, measKeySig);
            const midiNote = pitchToMidi(actual);
            rawEvts.push({ tick: voiceTick,         type: 'on',  note: midiNote, vel: 80 });
            rawEvts.push({ tick: voiceTick + ticks, type: 'off', note: midiNote, vel: 0  });
          }
          // Rests simply advance voiceTick without emitting events

          voiceTick += ticks;
        });
      });
    });

    // Sort by tick; Note Off before Note On at the same tick (avoids early cut-off)
    rawEvts.sort((a, b) =>
      a.tick !== b.tick ? a.tick - b.tick : (a.type === 'off' ? -1 : 1));

    // Build track bytes
    const trk: number[] = [];

    // Track name (optional but helpful in DAWs)
    const nameBytes = Array.from(
      new TextEncoder().encode(staff.name ?? `Staff ${staffIdx + 1}`));
    writeVLQ(trk, 0);
    trk.push(0xFF, 0x03, nameBytes.length, ...nameBytes);

    // Program Change (instrument selection)
    writeVLQ(trk, 0);
    trk.push(0xC0 | ch, prog);

    // Note On / Off events
    let prevTick = 0;
    rawEvts.forEach((evt) => {
      writeVLQ(trk, evt.tick - prevTick);
      trk.push(
        (evt.type === 'on' ? 0x90 : 0x80) | ch,
        evt.note,
        evt.vel,
      );
      prevTick = evt.tick;
    });

    writeVLQ(trk, 0);
    trk.push(0xFF, 0x2F, 0x00); // end of track

    return buildTrackChunk(trk);
  });

  // ── Assemble MIDI file ─────────────────────────────────────────────────────
  const numTracks = 1 + staffTrackChunks.length; // tempo track + one per staff

  const header = new Uint8Array([
    0x4D, 0x54, 0x68, 0x64,        // "MThd"
    0x00, 0x00, 0x00, 0x06,        // chunk length = 6
    0x00, 0x01,                    // format 1 (multi-track, synchronous)
    (numTracks >> 8) & 0xFF,
     numTracks       & 0xFF,
    (TICKS_PER_QUARTER >> 8) & 0xFF,
     TICKS_PER_QUARTER       & 0xFF,
  ]);

  const t0Chunk   = buildTrackChunk(t0);
  const allChunks = [t0Chunk, ...staffTrackChunks];
  const totalLen  = header.length + allChunks.reduce((s, c) => s + c.length, 0);

  const midiFile = new Uint8Array(totalLen);
  let offset = 0;
  midiFile.set(header, offset); offset += header.length;
  allChunks.forEach((c) => { midiFile.set(c, offset); offset += c.length; });

  return new Blob([midiFile], { type: 'audio/midi' });
}

// Print page constants (px at 96 dpi ≈ A4 landscape content area)
const PRINT_PAGE_WIDTH  = 1050;
const PRINT_LABEL_WIDTH = 80;   // px reserved for staff labels
const PRINT_TITLE_H     = 80;   // top space renderForPrint already reserves

/**
 * Build an SVG string for the score using multi-system (line-wrapping) rendering.
 * Staff labels, left bracket, and title are all embedded in the SVG.
 */
function buildScoreSvgString(composition: Composition): string {
  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;left:-99999px;top:-99999px;overflow:hidden;';
  document.body.appendChild(container);

  try {
    const vfRenderer = new VexFlowRenderer(container, {
      width:  PRINT_PAGE_WIDTH,
      height: 800,
    });

    // renderForPrint handles system wrapping, staff labels, bracket & numbers
    const svgEl = vfRenderer.renderForPrint(composition, {
      pageWidth:  PRINT_PAGE_WIDTH,
      labelWidth: PRINT_LABEL_WIDTH,
    });

    if (!svgEl) return '';

    const ns = 'http://www.w3.org/2000/svg';
    const totalW = parseFloat(svgEl.getAttribute('width') || String(PRINT_PAGE_WIDTH));

    // ── Title (centred, inside the TITLE_H space at the top) ─────────────
    // Append AFTER all content so it renders on top of the white background rect
    const titleEl = document.createElementNS(ns, 'text');
    titleEl.setAttribute('x', String(totalW / 2));
    titleEl.setAttribute('y', '32');
    titleEl.setAttribute('text-anchor', 'middle');
    titleEl.setAttribute('font-family', 'Georgia, "Times New Roman", serif');
    titleEl.setAttribute('font-size', '26');
    titleEl.setAttribute('font-weight', 'bold');
    titleEl.setAttribute('fill', '#000');
    titleEl.textContent = composition.title;
    svgEl.appendChild(titleEl);   // append last → drawn on top of background

    // Sub-info line (tempo, time sig, key sig)
    const infoEl = document.createElementNS(ns, 'text');
    infoEl.setAttribute('x', String(totalW / 2));
    infoEl.setAttribute('y', '54');
    infoEl.setAttribute('text-anchor', 'middle');
    infoEl.setAttribute('font-family', 'Arial, sans-serif');
    infoEl.setAttribute('font-size', '11');
    infoEl.setAttribute('fill', '#555');
    infoEl.textContent =
      `${composition.tempo} BPM  •  ${composition.timeSignature}  •  ${composition.keySignature}`;
    svgEl.appendChild(infoEl);

    // Author and Arranger line
    let yOffset = 54;
    const authorArrangerParts: string[] = [];
    if (composition.author) {
      authorArrangerParts.push(`Composed by ${composition.author}`);
    }
    if (composition.arrangedBy) {
      authorArrangerParts.push(`Arranged by ${composition.arrangedBy}`);
    }
    if (authorArrangerParts.length > 0) {
      yOffset += 16;
      const authorArrangerEl = document.createElementNS(ns, 'text');
      authorArrangerEl.setAttribute('x', String(totalW / 2));
      authorArrangerEl.setAttribute('y', String(yOffset));
      authorArrangerEl.setAttribute('text-anchor', 'middle');
      authorArrangerEl.setAttribute('font-family', 'Arial, sans-serif');
      authorArrangerEl.setAttribute('font-size', '10');
      authorArrangerEl.setAttribute('fill', '#666');
      authorArrangerEl.setAttribute('font-style', 'italic');
      authorArrangerEl.textContent = authorArrangerParts.join('  •  ');
      svgEl.appendChild(authorArrangerEl);
    }

    // Date information line
    const dateParts: string[] = [];
    if (composition.createdAt) {
      const createdDate = new Date(composition.createdAt);
      dateParts.push(`Created: ${createdDate.toLocaleDateString()}`);
    }
    if (composition.updatedAt) {
      const updatedDate = new Date(composition.updatedAt);
      if (composition.createdAt && 
          new Date(composition.createdAt).toDateString() === updatedDate.toDateString()) {
        // Same day, only show "Modified:"
        dateParts.push(`Modified: ${updatedDate.toLocaleDateString()}`);
      } else {
        dateParts.push(`Modified: ${updatedDate.toLocaleDateString()}`);
      }
    }
    if (dateParts.length > 0) {
      yOffset += 14;
      const dateEl = document.createElementNS(ns, 'text');
      dateEl.setAttribute('x', String(totalW / 2));
      dateEl.setAttribute('y', String(yOffset));
      dateEl.setAttribute('text-anchor', 'middle');
      dateEl.setAttribute('font-family', 'Arial, sans-serif');
      dateEl.setAttribute('font-size', '9');
      dateEl.setAttribute('fill', '#777');
      dateEl.textContent = dateParts.join('  •  ');
      svgEl.appendChild(dateEl);
    }

    // Serialize
    const serializer = new XMLSerializer();
    return serializer.serializeToString(svgEl);

  } finally {
    document.body.removeChild(container);
  }
}

/**
 * Export composition to PDF via a dedicated print window.
 * Renders a clean music-score layout with title, staff labels, and bracket.
 */
export function exportToPDF(composition: Composition): void {
  const svgString = buildScoreSvgString(composition);
  if (!svgString) {
    alert('Failed to render score for PDF export.');
    return;
  }

  const printWindow = window.open('', '_blank', 'width=1100,height=800');
  if (!printWindow) {
    alert('Please allow pop-ups so the PDF window can open.');
    return;
  }

  const escapedTitle = composition.title.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  printWindow.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapedTitle}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: #e5e5e5;
      font-family: Arial, sans-serif;
    }

    /* ── Toolbar (hidden on print) ──────────────────────────── */
    .toolbar {
      position: fixed;
      top: 0; left: 0; right: 0;
      height: 48px;
      background: #1e293b;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 16px;
      z-index: 100;
    }
    .toolbar span {
      color: #94a3b8;
      font-size: 13px;
    }
    .btn {
      padding: 6px 14px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
    }
    .btn-primary { background: #3b82f6; color: #fff; }
    .btn-primary:hover { background: #2563eb; }
    .btn-close   { background: #64748b; color: #fff; }
    .btn-close:hover   { background: #475569; }

    /* ── Page (simulate A4 landscape) ──────────────────────── */
    .page-wrap {
      padding: 60px 24px 24px; /* top-pad for toolbar */
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
    }

    .score-page {
      background: white;
      box-shadow: 0 2px 12px rgba(0,0,0,.25);
      padding: 30px 20px;
      width: 100%;
      max-width: 1050px;
      overflow-x: auto;
    }

    .score-page svg {
      display: block;
      width: 100%;
      height: auto;
    }

    /* ── Print rules ────────────────────────────────────────── */
    @media print {
      body { background: white; }
      .toolbar { display: none !important; }
      .page-wrap { padding: 0; }
      .score-page {
        box-shadow: none;
        padding: 0;
        max-width: 100%;
      }
      @page {
        size: A4 landscape;
        margin: 15mm 12mm;
      }
    }
  </style>
</head>
<body>

  <div class="toolbar">
    <span>Score Preview — ${escapedTitle}</span>
    <button class="btn btn-primary" onclick="window.print()">🖨️ Print / Save as PDF</button>
    <button class="btn btn-close"   onclick="window.close()">✕ Close</button>
  </div>

  <div class="page-wrap">
    <div class="score-page">
      ${svgString}
    </div>
  </div>

</body>
</html>`);

  printWindow.document.close();
}
