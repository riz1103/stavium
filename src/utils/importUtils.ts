import { Composition, NoteDuration, Staff, Measure, Note, Rest, ChordSymbol } from '../types/music';
import { midiToPitch } from './noteUtils';
import { omrService } from '../services/omrService';

export type ScanVoiceMode = 'conservative' | 'aggressive';

type ParsedMidiTrack = {
  name?: string;
  program?: number;
  notes: Array<{ midi: number; startTick: number; endTick: number }>;
};

const MAX_VOICE_LANES = 4;

const createEmptyVoices = () =>
  Array.from({ length: MAX_VOICE_LANES }, () => ({ notes: [] as Array<Note | Rest> }));

const DURATION_BY_BEATS: Array<{ beats: number; duration: NoteDuration }> = [
  { beats: 6, duration: 'dotted-whole' },
  { beats: 4, duration: 'whole' },
  { beats: 3, duration: 'dotted-half' },
  { beats: 2, duration: 'half' },
  { beats: 4 / 3, duration: 'triplet-half' },
  { beats: 4 / 5, duration: 'quintuplet-half' },
  { beats: 4 / 6, duration: 'sextuplet-half' },
  { beats: 4 / 7, duration: 'septuplet-half' },
  { beats: 1.5, duration: 'dotted-quarter' },
  { beats: 1, duration: 'quarter' },
  { beats: 2 / 3, duration: 'triplet-quarter' },
  { beats: 4 / 5, duration: 'quintuplet-quarter' },
  { beats: 2 / 3, duration: 'sextuplet-quarter' },
  { beats: 4 / 7, duration: 'septuplet-quarter' },
  { beats: 0.75, duration: 'dotted-eighth' },
  { beats: 0.5, duration: 'eighth' },
  { beats: 1 / 3, duration: 'triplet-eighth' },
  { beats: 2 / 5, duration: 'quintuplet-eighth' },
  { beats: 1 / 3, duration: 'sextuplet-eighth' },
  { beats: 2 / 7, duration: 'septuplet-eighth' },
  { beats: 0.375, duration: 'dotted-sixteenth' },
  { beats: 0.25, duration: 'sixteenth' },
  { beats: 1 / 6, duration: 'triplet-sixteenth' },
  { beats: 1 / 5, duration: 'quintuplet-sixteenth' },
  { beats: 1 / 6, duration: 'sextuplet-sixteenth' },
  { beats: 1 / 7, duration: 'septuplet-sixteenth' },
  { beats: 0.1875, duration: 'dotted-thirty-second' },
  { beats: 0.125, duration: 'thirty-second' },
  { beats: 1 / 12, duration: 'triplet-thirty-second' },
  { beats: 1 / 10, duration: 'quintuplet-thirty-second' },
  { beats: 1 / 12, duration: 'sextuplet-thirty-second' },
  { beats: 1 / 14, duration: 'septuplet-thirty-second' },
];

function nearestDuration(beats: number): NoteDuration {
  let best = DURATION_BY_BEATS[0];
  let minDiff = Math.abs(beats - best.beats);
  for (const candidate of DURATION_BY_BEATS) {
    const diff = Math.abs(beats - candidate.beats);
    if (diff < minDiff) {
      minDiff = diff;
      best = candidate;
    }
  }
  return best.duration;
}

function decomposeBeats(beats: number): NoteDuration[] {
  const out: NoteDuration[] = [];
  let remain = Math.max(0, beats);
  const MIN = 1 / 14;
  while (remain >= MIN * 0.5) {
    const pick = DURATION_BY_BEATS.find((d) => d.beats <= remain + 1e-6);
    if (!pick) break;
    out.push(pick.duration);
    remain -= pick.beats;
  }
  if (out.length === 0 && beats > 0) out.push(nearestDuration(beats));
  return out;
}

function keyFromFifths(fifths: number): string {
  const map: Record<number, string> = {
    '-6': 'Gb',
    '-5': 'Db',
    '-4': 'Ab',
    '-3': 'Eb',
    '-2': 'Bb',
    '-1': 'F',
    '0': 'C',
    '1': 'G',
    '2': 'D',
    '3': 'A',
    '4': 'E',
    '5': 'B',
    '6': 'F#',
  };
  return map[fifths] ?? 'C';
}

function clefFromMusicXml(sign?: string, line?: string): Staff['clef'] {
  const s = (sign ?? '').toUpperCase();
  if (s === 'F') return 'bass';
  if (s === 'C') {
    if (line === '3') return 'alto';
    if (line === '4') return 'tenor';
  }
  return 'treble';
}

function instrumentFromProgram(program?: number): string {
  if (program === undefined) return 'piano';
  if (program >= 16 && program <= 23) return 'organ';
  if (program >= 24 && program <= 31) return 'guitar';
  if (program >= 40 && program <= 43) return 'violin';
  if (program >= 48 && program <= 51) return 'strings';
  if (program === 52 || program === 53) return 'choir';
  if (program >= 56 && program <= 63) return 'brass';
  if (program >= 80 && program <= 87) return 'synth';
  if (program === 73 || program === 74) return 'flute';
  return 'piano';
}

function ensureMeasure(staff: Staff, measureNumber: number): Measure {
  while (staff.measures.length < measureNumber) {
    staff.measures.push({
      number: staff.measures.length + 1,
      voices: createEmptyVoices(),
    });
  }
  return staff.measures[measureNumber - 1];
}

function appendElementBeats(target: Array<Note | Rest>, element: Note | Rest, beats: number): void {
  const durations = decomposeBeats(beats);
  durations.forEach((duration, i) => {
    if ('pitch' in element) {
      target.push({
        ...element,
        duration,
        tie: element.tie || (i < durations.length - 1 ? true : undefined),
      });
    } else {
      target.push({ ...(element as Rest), duration });
    }
  });
}

type ZipEntry = {
  fileName: string;
  compressionMethod: number;
  compressedSize: number;
  localHeaderOffset: number;
};

function normalizeZipPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

function firstByLocalName(root: Document | Element, localName: string): Element | null {
  const target = localName.toLowerCase();
  const all = root.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if ((el.localName || el.nodeName).toLowerCase() === target) return el;
  }
  return null;
}

function directChildrenByLocalName(root: Element, localName: string): Element[] {
  const target = localName.toLowerCase();
  return Array.from(root.children).filter(
    (el) => (el.localName || el.nodeName).toLowerCase() === target
  );
}

function firstDirectChildByLocalName(root: Element, localName: string): Element | null {
  return directChildrenByLocalName(root, localName)[0] ?? null;
}

function readZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdMinSize = 22;
  let eocdOffset = -1;

  for (let i = bytes.length - eocdMinSize; i >= 0; i--) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset < 0) throw new Error('Invalid MXL archive (missing central directory).');

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);
  let ptr = centralDirOffset;

  const entries: ZipEntry[] = [];
  for (let i = 0; i < totalEntries && ptr + 46 <= bytes.length; i++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) break;
    const compressionMethod = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const fileNameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localHeaderOffset = view.getUint32(ptr + 42, true);
    const fileNameStart = ptr + 46;
    const fileNameEnd = fileNameStart + fileNameLen;
    if (fileNameEnd > bytes.length) break;
    const fileName = new TextDecoder().decode(bytes.slice(fileNameStart, fileNameEnd));
    entries.push({ fileName, compressionMethod, compressedSize, localHeaderOffset });
    ptr = fileNameEnd + extraLen + commentLen;
  }

  if (entries.length === 0) throw new Error('Invalid MXL archive (no entries).');
  return entries;
}

async function inflateRaw(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Your browser does not support .mxl decompression.');
  }
  const source = new Blob([Uint8Array.from(compressed)]).stream();
  const inflated = await new Response(
    source.pipeThrough(new DecompressionStream('deflate-raw'))
  ).arrayBuffer();
  return new Uint8Array(inflated);
}

async function readZipEntryText(bytes: Uint8Array, entry: ZipEntry): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const localOffset = entry.localHeaderOffset;
  if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) {
    throw new Error(`Invalid MXL archive entry header: ${entry.fileName}`);
  }

  const nameLen = view.getUint16(localOffset + 26, true);
  const extraLen = view.getUint16(localOffset + 28, true);
  const dataStart = localOffset + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > bytes.length) throw new Error(`Invalid MXL archive entry data: ${entry.fileName}`);

  const compressed = bytes.slice(dataStart, dataEnd);
  if (entry.compressionMethod === 0) {
    return new TextDecoder().decode(compressed);
  }
  if (entry.compressionMethod === 8) {
    const inflated = await inflateRaw(compressed);
    return new TextDecoder().decode(inflated);
  }
  throw new Error(`Unsupported MXL compression method (${entry.compressionMethod}).`);
}

async function getMusicXmlTextFromMxl(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = readZipEntries(bytes);
  const entryByPath = new Map(entries.map((e) => [normalizeZipPath(e.fileName), e]));

  const containerEntry =
    entryByPath.get('meta-inf/container.xml') ||
    entries.find((e) => normalizeZipPath(e.fileName).endsWith('container.xml'));

  let scorePath: string | null = null;
  if (containerEntry) {
    const containerXml = await readZipEntryText(bytes, containerEntry);
    const containerDoc = new DOMParser().parseFromString(containerXml, 'application/xml');
    const parserErr = containerDoc.querySelector('parsererror');
    if (!parserErr) {
      scorePath =
        containerDoc.querySelector('rootfile')?.getAttribute('full-path')?.trim() ||
        containerDoc.querySelector('rootfiles > rootfile')?.getAttribute('full-path')?.trim() ||
        null;
    }
  }

  let musicXmlEntry: ZipEntry | undefined;
  if (scorePath) {
    musicXmlEntry = entryByPath.get(normalizeZipPath(scorePath));
  }
  if (!musicXmlEntry) {
    musicXmlEntry = entries.find((e) => {
      const p = normalizeZipPath(e.fileName);
      return p.endsWith('.musicxml') || (p.endsWith('.xml') && !p.includes('meta-inf/'));
    });
  }
  if (!musicXmlEntry) {
    throw new Error('Invalid MXL archive: no MusicXML score file found.');
  }

  return readZipEntryText(bytes, musicXmlEntry);
}

export async function importCompositionFromFile(file: File, currentTitle?: string): Promise<Composition> {
  return importCompositionFromFileWithOptions(file, currentTitle);
}

export async function importCompositionFromFileWithOptions(
  file: File,
  currentTitle?: string,
  options?: { scanVoiceMode?: ScanVoiceMode }
): Promise<Composition> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.mid') || lower.endsWith('.midi')) {
    return importFromMidi(file, currentTitle);
  }
  if (lower.endsWith('.musicxml') || lower.endsWith('.xml') || lower.endsWith('.mxl')) {
    return importFromMusicXml(file, currentTitle, options);
  }
  if (lower.endsWith('.pdf')) {
    return importFromPDF(file, currentTitle, options);
  }
  // Check for image formats
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.tiff', '.tif'];
  if (imageExtensions.some(ext => lower.endsWith(ext))) {
    return importFromImages([file], [1], currentTitle, options);
  }
  throw new Error('Unsupported file type. Please upload PDF (.pdf), MIDI (.mid/.midi), MusicXML (.musicxml/.xml/.mxl), or images (.jpg/.jpeg/.png/.tiff/.tif).');
}

/**
 * Import composition from multiple image files
 * @param files Array of image files
 * @param pageNumbers Array of page numbers (defaults to sequential if not provided)
 * @param currentTitle Optional title for the composition
 */
export async function importCompositionFromImages(
  files: File[],
  pageNumbers?: number[],
  currentTitle?: string,
  options?: { scanVoiceMode?: ScanVoiceMode }
): Promise<Composition> {
  // Auto-generate page numbers if not provided
  const pages = pageNumbers || files.map((_, index) => index + 1);
  return importFromImages(files, pages, currentTitle, options);
}

async function importFromMidi(file: File, currentTitle?: string): Promise<Composition> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let ptr = 0;

  const readStr = (len: number): string => {
    const chars = [];
    for (let i = 0; i < len; i++) chars.push(String.fromCharCode(bytes[ptr + i]));
    ptr += len;
    return chars.join('');
  };
  const readU16 = (): number => {
    const v = view.getUint16(ptr);
    ptr += 2;
    return v;
  };
  const readU32 = (): number => {
    const v = view.getUint32(ptr);
    ptr += 4;
    return v;
  };
  const readVLQ = (): number => {
    let value = 0;
    while (ptr < bytes.length) {
      const b = bytes[ptr++];
      value = (value << 7) | (b & 0x7f);
      if ((b & 0x80) === 0) break;
    }
    return value;
  };

  if (readStr(4) !== 'MThd') throw new Error('Invalid MIDI header.');
  const headerLen = readU32();
  readU16(); // format (not used)
  const trackCount = readU16();
  const division = readU16();
  if (division & 0x8000) throw new Error('SMPTE time division MIDI files are not supported.');
  const ticksPerQuarter = division;
  ptr += Math.max(0, headerLen - 6);

  let tempo = 120;
  let timeSig = '4/4';
  const tracks: ParsedMidiTrack[] = [];

  for (let ti = 0; ti < trackCount && ptr < bytes.length; ti++) {
    if (readStr(4) !== 'MTrk') break;
    const len = readU32();
    const trackEnd = ptr + len;
    let tick = 0;
    let runningStatus = 0;
    let trackName: string | undefined;
    let program: number | undefined;

    const activeNotes = new Map<number, number[]>();
    const outNotes: ParsedMidiTrack['notes'] = [];

    while (ptr < trackEnd) {
      tick += readVLQ();
      if (ptr >= trackEnd) break;
      let status = bytes[ptr++];
      if (status < 0x80) {
        ptr--;
        status = runningStatus;
      } else {
        runningStatus = status;
      }

      if (status === 0xff) {
        const type = bytes[ptr++] ?? 0;
        const dataLen = readVLQ();
        if (type === 0x51 && dataLen === 3) {
          const usPerQuarter = (bytes[ptr] << 16) | (bytes[ptr + 1] << 8) | bytes[ptr + 2];
          if (usPerQuarter > 0 && tempo === 120) {
            tempo = Math.round(60_000_000 / usPerQuarter);
          }
        } else if (type === 0x58 && dataLen >= 2 && timeSig === '4/4') {
          const nn = bytes[ptr];
          const ddPow = bytes[ptr + 1];
          const dd = Math.pow(2, ddPow);
          timeSig = `${nn}/${dd}`;
        } else if (type === 0x03 && dataLen > 0) {
          trackName = new TextDecoder().decode(bytes.slice(ptr, ptr + dataLen)).trim() || trackName;
        }
        ptr += dataLen;
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        const dataLen = readVLQ();
        ptr += dataLen;
        continue;
      }

      const eventType = status & 0xf0;
      const channel = status & 0x0f;
      const d1 = bytes[ptr++] ?? 0;
      const d2 = eventType === 0xc0 || eventType === 0xd0 ? 0 : (bytes[ptr++] ?? 0);

      if (eventType === 0xc0) {
        if (program === undefined) program = d1;
        continue;
      }

      if (channel === 9) continue; // Skip drums for notation import

      if (eventType === 0x90 && d2 > 0) {
        const stack = activeNotes.get(d1) ?? [];
        stack.push(tick);
        activeNotes.set(d1, stack);
      } else if (eventType === 0x80 || (eventType === 0x90 && d2 === 0)) {
        const stack = activeNotes.get(d1);
        if (stack && stack.length > 0) {
          const startTick = stack.shift()!;
          if (tick > startTick) {
            outNotes.push({ midi: d1, startTick, endTick: tick });
          }
        }
      }
    }

    tracks.push({ name: trackName, program, notes: outNotes.sort((a, b) => a.startTick - b.startTick) });
    ptr = trackEnd;
  }

  const noteTracks = tracks.filter((t) => t.notes.length > 0);
  const [num, den] = timeSig.split('/').map(Number);
  const beatsPerMeasure = Math.max(1, (num * 4) / (den || 4));
  const ticksPerBeat = ticksPerQuarter;
  const ticksPerMeasure = Math.max(1, Math.round(beatsPerMeasure * ticksPerBeat));

  const staves: Staff[] = noteTracks.length > 0
    ? noteTracks.map((track, idx) => {
        const staff: Staff = {
          clef: idx === 0 ? 'treble' : 'bass',
          instrument: instrumentFromProgram(track.program),
          name: track.name || `Track ${idx + 1}`,
          measures: [{ number: 1, voices: createEmptyVoices() }],
        };

        const laneCursorTicks = Array.from({ length: MAX_VOICE_LANES }, () => 0);

        const appendGapAsRests = (laneIndex: number, fromTick: number, toTick: number) => {
          let cursorTick = fromTick;
          let remain = Math.max(0, toTick - fromTick);
          while (remain > 0) {
            const measureNumber = Math.floor(cursorTick / ticksPerMeasure) + 1;
            const measureStart = (measureNumber - 1) * ticksPerMeasure;
            const inMeasure = cursorTick - measureStart;
            const room = ticksPerMeasure - inMeasure;
            const chunk = Math.min(room, remain);
            const beats = chunk / ticksPerBeat;
            const measure = ensureMeasure(staff, measureNumber);
            appendElementBeats(measure.voices[laneIndex].notes, { duration: 'quarter' } as Rest, beats);
            cursorTick += chunk;
            remain -= chunk;
          }
        };

        const appendNoteWithTies = (
          laneIndex: number,
          startTick: number,
          endTick: number,
          midi: number
        ) => {
          let cursorTick = startTick;
          let remain = Math.max(1, endTick - startTick);
          while (remain > 0) {
            const measureNumber = Math.floor(cursorTick / ticksPerMeasure) + 1;
            const measureStart = (measureNumber - 1) * ticksPerMeasure;
            const inMeasure = cursorTick - measureStart;
            const room = ticksPerMeasure - inMeasure;
            const chunk = Math.min(room, remain);
            const beats = chunk / ticksPerBeat;
            const measure = ensureMeasure(staff, measureNumber);
            const note: Note = {
              pitch: midiToPitch(midi),
              duration: nearestDuration(beats),
              tie: remain > chunk ? true : undefined,
            };
            appendElementBeats(measure.voices[laneIndex].notes, note, beats);
            cursorTick += chunk;
            remain -= chunk;
          }
        };

        for (const event of track.notes) {
          const desiredStartTick = event.startTick;
          const endTick = Math.max(desiredStartTick + 1, event.endTick);

          let laneIndex = laneCursorTicks.findIndex((cursorTick) => cursorTick <= desiredStartTick);
          if (laneIndex < 0) {
            laneIndex = laneCursorTicks.reduce(
              (best, value, i, arr) => (value < arr[best] ? i : best),
              0
            );
          }

          const laneStartTick = Math.max(laneCursorTicks[laneIndex], desiredStartTick);
          if (laneStartTick > laneCursorTicks[laneIndex]) {
            appendGapAsRests(laneIndex, laneCursorTicks[laneIndex], laneStartTick);
          }
          appendNoteWithTies(laneIndex, laneStartTick, endTick, event.midi);
          laneCursorTicks[laneIndex] = endTick;
        }

        return staff;
      })
    : [{
        clef: 'treble',
        instrument: 'piano',
        measures: [{ number: 1, voices: createEmptyVoices() }],
      }];

  return {
    title: currentTitle || file.name.replace(/\.(mid|midi)$/i, ''),
    tempo,
    timeSignature: timeSig,
    keySignature: 'C',
    staves,
    showMeasureNumbers: true,
    privacy: 'private',
  };
}

// A single note/rest event positioned in division-time within a measure.
interface RawEvent {
  timeDivs: number;
  durationDivs: number;
  isRest: boolean;
  pitch?: string;
  lyric?: string;
  tieStart?: boolean;
  slurStart?: boolean;
}

async function importFromMusicXml(
  file: File,
  currentTitle?: string,
  options?: { fromScan?: boolean; scanVoiceMode?: ScanVoiceMode }
): Promise<Composition> {
  const xml = file.name.toLowerCase().endsWith('.mxl')
    ? await getMusicXmlTextFromMxl(file)
    : await file.text();
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const parserErr = doc.querySelector('parsererror');
  if (parserErr) throw new Error('Invalid MusicXML file.');

  const partwise = doc.querySelector('score-partwise') ?? firstByLocalName(doc, 'score-partwise');
  if (!partwise) throw new Error('Only score-partwise MusicXML is currently supported.');

  const title =
    partwise.querySelector('work > work-title')?.textContent?.trim() ||
    partwise.querySelector('movement-title')?.textContent?.trim() ||
    currentTitle ||
    file.name.replace(/\.(musicxml|xml|mxl)$/i, '');

  const partNames = new Map<string, string>();
  const partList = partwise.querySelector('part-list') ?? firstByLocalName(partwise, 'part-list');
  if (partList) {
    const scoreParts = Array.from(partList.getElementsByTagName('*'))
      .filter((el) => (el.localName || el.nodeName).toLowerCase() === 'score-part');
    scoreParts.forEach((sp) => {
      const id = sp.getAttribute('id') ?? '';
      const partNameEl = sp.querySelector('part-name') ?? firstByLocalName(sp, 'part-name');
      const name = partNameEl?.textContent?.trim();
      if (id) partNames.set(id, name || id);
    });
  }

  let globalTempo = 120;
  let globalTimeSig = '4/4';
  let globalKey = 'C';

  const staves: Staff[] = [];
  const parts = directChildrenByLocalName(partwise, 'part');

  parts.forEach((part, partIndex) => {
    const partId = part.getAttribute('id') ?? '';
    const measures = directChildrenByLocalName(part, 'measure');
    let divisions = 1;
    let activeTimeSig = globalTimeSig;
    let activeKey = globalKey;
    let activeClef: Staff['clef'] = partIndex === 0 ? 'treble' : 'bass';

    // ── Pre-scan: discover all voice IDs used in this part ───────────────────
    const voiceIdSet = new Set<string>();
    for (const m of measures) {
      for (const n of directChildrenByLocalName(m, 'note')) {
        const v = n.querySelector('voice')?.textContent?.trim();
        if (v) voiceIdSet.add(v);
      }
    }
    // Sort numerically: voice "1" (soprano/melody) always comes first.
    const voiceIds = voiceIdSet.size > 0
      ? [...voiceIdSet].sort((a, b) => Number(a) - Number(b))
      : ['1'];

    // ── Create one Staff per part and map XML voices into V1-V4 lanes ────────
    const partBaseName = partNames.get(partId) || `Part ${partIndex + 1}`;
    const staff: Staff = {
      clef: activeClef,
      instrument: 'piano',
      name: partBaseName,
      measures: [],
    };
    const voiceIdToLane = new Map<string, number>();
    voiceIds.forEach((vid, idx) => {
      voiceIdToLane.set(vid, Math.min(idx, MAX_VOICE_LANES - 1));
    });

    // ── Process each measure ─────────────────────────────────────────────────
    measures.forEach((measure, mi) => {

      // ── Attributes ──────────────────────────────────────────────────────────
      const attrs = firstDirectChildByLocalName(measure, 'attributes');
      if (attrs) {
        const divEl = attrs.querySelector('divisions') ?? firstByLocalName(attrs, 'divisions');
        const div = Number(divEl?.textContent ?? divisions);
        if (Number.isFinite(div) && div > 0) divisions = div;

        const tsBeats = attrs.querySelector('time > beats')?.textContent;
        const tsBeatType = attrs.querySelector('time > beat-type')?.textContent;
        if (tsBeats && tsBeatType) {
          activeTimeSig = `${tsBeats}/${tsBeatType}`;
          if (mi === 0) globalTimeSig = activeTimeSig;
        }

        const fifths = attrs.querySelector('key > fifths')?.textContent;
        if (fifths !== null && fifths !== undefined) {
          const parsed = Number(fifths);
          if (Number.isFinite(parsed)) {
            activeKey = keyFromFifths(parsed);
            if (mi === 0) globalKey = activeKey;
          }
        }

        const clefSign = attrs.querySelector('clef > sign')?.textContent ?? undefined;
        const clefLine = attrs.querySelector('clef > line')?.textContent ?? undefined;
        activeClef = clefFromMusicXml(clefSign, clefLine);
        if (mi === 0) staff.clef = activeClef;
      }

      // ── Tempo ────────────────────────────────────────────────────────────────
      // MusicXML tempo can be specified in two ways:
      // 1. <direction><sound tempo="120"/>
      // 2. <direction><direction-type><metronome><per-minute>120</per-minute>
      let measureTempo: number | undefined = undefined;
      const directionEls = directChildrenByLocalName(measure, 'direction');
      for (const dir of directionEls) {
        // Check <sound tempo="...">
        const soundEl = dir.querySelector('sound') ?? firstByLocalName(dir, 'sound');
        const soundTempo = Number(soundEl?.getAttribute('tempo') ?? '');
        if (Number.isFinite(soundTempo) && soundTempo > 0) {
          measureTempo = Math.round(soundTempo);
          break;
        }
        // Check <metronome><per-minute>...</per-minute>
        const metronomeEl = dir.querySelector('direction-type > metronome') ?? firstByLocalName(dir, 'metronome');
        if (metronomeEl) {
          const perMinute = metronomeEl.querySelector('per-minute')?.textContent?.trim();
          const parsed = Number(perMinute);
          if (Number.isFinite(parsed) && parsed > 0) {
            measureTempo = Math.round(parsed);
            break;
          }
        }
      }
      // Update global tempo (for Composition.tempo) and store per-measure if changed.
      if (measureTempo !== undefined) {
        if (mi === 0) globalTempo = measureTempo;
        // measureTempo will be applied to all voice staves below
      }

      // ── Parse notes with proper MusicXML time tracking ───────────────────────
      // MusicXML time model (in divisions):
      //   <note> without <chord/> → starts at globalCursor, advances it by duration
      //   <note> with <chord/>    → starts at chordGroupStart (same beat as previous)
      //   <backup>                → rewinds globalCursor (starts another voice's notes)
      //   <forward>               → skips globalCursor forward (inserts silence)
      const voiceEvents = new Map<string, RawEvent[]>();
      voiceIds.forEach((vid) => voiceEvents.set(vid, []));

      let globalCursor = 0;    // running time position in divisions
      let chordGroupStart = 0; // start of the current chord group
      
      // ── Extract harmony (chord symbols) and notes with proper MusicXML time tracking ─────
      const harmonyElements: Array<{ timeDivs: number; symbol: string }> = [];
      
      for (const child of Array.from(measure.children)) {
        const ln = (child.localName || child.nodeName).toLowerCase();

        if (ln === 'harmony') {
          const harmony = child;
          const rootStep = harmony.querySelector('root > root-step')?.textContent?.trim();
          const rootAlter = harmony.querySelector('root > root-alter')?.textContent?.trim();
          const kindText = harmony.getAttribute('text') || harmony.querySelector('kind')?.getAttribute('text') || '';
          const kind = harmony.querySelector('kind');
          const kindValue = kind?.textContent?.trim() || '';
          const bassStep = harmony.querySelector('bass > bass-step')?.textContent?.trim();
          const bassAlter = harmony.querySelector('bass > bass-alter')?.textContent?.trim();
          
          if (rootStep) {
            let chordSymbol = rootStep;
            // Add accidental to root if present
            if (rootAlter) {
              const alterNum = Number(rootAlter);
              if (alterNum === 1) chordSymbol += '#';
              else if (alterNum === -1) chordSymbol += 'b';
            }
            
            // Add chord quality
            if (kindText) {
              chordSymbol += kindText;
            } else if (kindValue) {
              // Map MusicXML kind values to chord symbols
              const kindMap: Record<string, string> = {
                'major': '',
                'minor': 'm',
                'minor-seventh': 'm7',
                'dominant': '7',
                'major-seventh': 'maj7',
                'diminished': 'dim',
                'augmented': 'aug',
              };
              chordSymbol += kindMap[kindValue] || '';
            }
            
            // Add bass note if present
            if (bassStep && bassStep !== rootStep) {
              let bassNote = bassStep;
              if (bassAlter) {
                const alterNum = Number(bassAlter);
                if (alterNum === 1) bassNote += '#';
                else if (alterNum === -1) bassNote += 'b';
              }
              chordSymbol += `/${bassNote}`;
            }
            
            // Harmony elements appear before the notes they apply to
            // Position them at the current globalCursor
            harmonyElements.push({
              timeDivs: globalCursor,
              symbol: chordSymbol,
            });
          }
          continue;
        }
        
        if (ln === 'backup') {
          const dur = Number(child.querySelector('duration')?.textContent ?? '0');
          if (dur > 0) { globalCursor = Math.max(0, globalCursor - dur); chordGroupStart = globalCursor; }
          continue;
        }
        if (ln === 'forward') {
          const dur = Number(child.querySelector('duration')?.textContent ?? '0');
          if (dur > 0) { globalCursor += dur; chordGroupStart = globalCursor; }
          continue;
        }
        if (ln !== 'note') continue;

        const n = child;
        const isChord = !!n.querySelector('chord');
        const durationDivs = Number(n.querySelector('duration')?.textContent ?? '0');
        if (!Number.isFinite(durationDivs) || durationDivs <= 0) continue; // grace notes etc.

        // Determine this note's start time and advance the global cursor.
        const timeDivs = isChord ? chordGroupStart : globalCursor;
        if (!isChord) { chordGroupStart = globalCursor; globalCursor += durationDivs; }

        const voiceId = n.querySelector('voice')?.textContent?.trim() ?? voiceIds[0];
        const vEvents = voiceEvents.get(voiceId);
        if (!vEvents) continue; // voice not seen during pre-scan

        if (n.querySelector('rest')) {
          vEvents.push({ timeDivs, durationDivs, isRest: true });
          continue;
        }

        const step = n.querySelector('pitch > step')?.textContent?.trim();
        const octave = n.querySelector('pitch > octave')?.textContent?.trim();
        if (!step || !octave) continue;

        const alter = Number(n.querySelector('pitch > alter')?.textContent ?? '0');
        const acc = alter === 1 ? '#' : alter === -1 ? 'b' : '';
        const pitch = `${step}${acc}${octave}`;
        const lyric = n.querySelector('lyric > text')?.textContent?.trim() || undefined;
        const tieStart = Array.from(n.querySelectorAll('tie')).some((t) => t.getAttribute('type') === 'start');
        const slurStart = Array.from(n.querySelectorAll('notations > slur')).some((s) => s.getAttribute('type') === 'start');

        vEvents.push({ timeDivs, durationDivs, isRest: false, pitch, lyric, tieStart, slurStart });
      }

      // ── Total divisions in this measure (for rest-padding) ───────────────────
      const [tsNum, tsDen] = activeTimeSig.split('/').map(Number);
      const measureTotalDivs = Math.round(tsNum * divisions * 4 / tsDen);

      // ── Build one measure with explicit V1-V4 lanes ─────────────────────────
      const outMeasure: Measure = { number: mi + 1, voices: createEmptyVoices() };

      if (mi > 0) {
        const prev = staff.measures[mi - 1];
        const prevTs = prev?.timeSignature ?? activeTimeSig;
        const prevKey = prev?.keySignature ?? activeKey;
        if (activeTimeSig !== prevTs) outMeasure.timeSignature = activeTimeSig;
        if (activeKey !== prevKey) outMeasure.keySignature = activeKey;
      }
      if (measureTempo !== undefined) {
        outMeasure.tempo = measureTempo;
      }
      if (harmonyElements.length > 0) {
        const chords: ChordSymbol[] = harmonyElements.map((h) => ({
          symbol: h.symbol,
          beat: h.timeDivs / divisions,
        }));
        outMeasure.chords = chords;
      }

      const scanMode = !!options?.fromScan;
      const scanVoiceMode: ScanVoiceMode = options?.scanVoiceMode ?? 'conservative';
      const combinedEvents: Array<{ preferredLane: number; event: RawEvent }> = [];

      voiceIds.forEach((vid) => {
        const preferredLane = voiceIdToLane.get(vid) ?? 0;
        (voiceEvents.get(vid) ?? []).forEach((event) => {
          combinedEvents.push({ preferredLane, event });
        });
      });

      const noteEvents = combinedEvents.filter(({ event }) => !event.isRest);
      const simultaneousBuckets = new Map<number, number>();
      noteEvents.forEach(({ event }) => {
        simultaneousBuckets.set(event.timeDivs, (simultaneousBuckets.get(event.timeDivs) ?? 0) + 1);
      });
      const overlapPoints = Array.from(simultaneousBuckets.values()).filter((count) => count >= 2).length;
      const scanHasStrongPolyphony = overlapPoints >= 2 || (noteEvents.length >= 10 && overlapPoints >= 1);
      const activeLaneCount = scanMode
        ? (scanVoiceMode === 'aggressive' ? MAX_VOICE_LANES : (scanHasStrongPolyphony ? 2 : 1))
        : MAX_VOICE_LANES;
      const laneEvents: RawEvent[][] = Array.from({ length: activeLaneCount }, () => []);
      const laneCursorDivs: number[] = Array.from({ length: activeLaneCount }, () => 0);

      combinedEvents
        .sort((a, b) => {
          if (a.event.timeDivs !== b.event.timeDivs) return a.event.timeDivs - b.event.timeDivs;
          return a.preferredLane - b.preferredLane;
        })
        .forEach(({ preferredLane, event }) => {
          if (scanMode && scanVoiceMode === 'conservative' && event.isRest && activeLaneCount === 1) {
            // OCR often over-detects rests in pseudo-voices; in single-lane scan mode
            // we keep timing from note durations and drop these noisy rest artifacts.
            return;
          }
          const laneOrder = [
            ...Array.from({ length: Math.max(0, activeLaneCount - preferredLane) }, (_, i) => preferredLane + i),
            ...Array.from({ length: Math.min(preferredLane, activeLaneCount) }, (_, i) => i),
          ];
          let laneIdx =
            laneOrder.find((idx) => event.timeDivs >= laneCursorDivs[idx]) ??
            preferredLane;
          laneIdx = Math.max(0, Math.min(activeLaneCount - 1, laneIdx));
          laneEvents[laneIdx].push(event);
          laneCursorDivs[laneIdx] = Math.max(laneCursorDivs[laneIdx], event.timeDivs + event.durationDivs);
        });

      outMeasure.voices = Array.from({ length: MAX_VOICE_LANES }, (_, laneIndex) => {
        const events = laneEvents[laneIndex] ?? [];
        const outVoice = { notes: [] as Array<Note | Rest> };
        let cursorDivs = 0;
        const hidePaddingRests = scanMode && laneIndex > 0;
        for (const evt of events.sort((a, b) => a.timeDivs - b.timeDivs)) {
          if (evt.timeDivs > cursorDivs) {
            const restBeats = (evt.timeDivs - cursorDivs) / divisions;
            appendElementBeats(
              outVoice.notes,
              { duration: 'quarter', hidden: hidePaddingRests } as Rest,
              restBeats
            );
          }
          const beats = evt.durationDivs / divisions;
          if (evt.isRest) {
            appendElementBeats(outVoice.notes, { duration: 'quarter' } as Rest, beats);
          } else {
            const note: Note = {
              pitch: evt.pitch!,
              duration: nearestDuration(beats),
              lyric: evt.lyric,
              tie: evt.tieStart || undefined,
              slur: evt.slurStart || undefined,
            };
            appendElementBeats(outVoice.notes, note, beats);
          }
          cursorDivs = Math.max(cursorDivs, evt.timeDivs + evt.durationDivs);
        }
        if (cursorDivs < measureTotalDivs) {
          const restBeats = (measureTotalDivs - cursorDivs) / divisions;
          appendElementBeats(
            outVoice.notes,
            { duration: 'quarter', hidden: hidePaddingRests } as Rest,
            restBeats
          );
        }
        return outVoice;
      });

      staff.measures.push(outMeasure);
    }); // end measures.forEach

    if (staff.measures.length === 0) {
      staff.measures.push({ number: 1, voices: createEmptyVoices() });
    }
    staves.push(staff);
  }); // end parts.forEach

  return {
    title,
    tempo: globalTempo,
    timeSignature: globalTimeSig,
    keySignature: globalKey,
    staves: staves.length > 0 ? staves : [{
      clef: 'treble',
      instrument: 'piano',
      measures: [{ number: 1, voices: createEmptyVoices() }],
    }],
    showMeasureNumbers: true,
    privacy: 'private',
  };
}

async function importFromPDF(
  file: File,
  currentTitle?: string,
  options?: { scanVoiceMode?: ScanVoiceMode }
): Promise<Composition> {
  try {
    // Convert PDF to MusicXML using OMR service
    const response = await omrService.convertToMusicXML(file);
    
    // Create a Blob from the MusicXML string and convert it to a File-like object
    const musicXmlBlob = new Blob([response.file_content], { type: 'application/xml' });
    const musicXmlFile = new File([musicXmlBlob], file.name.replace(/\.pdf$/i, '.musicxml'), {
      type: 'application/xml',
    });
    
    // Use the existing MusicXML import function
    // Pass the title if provided, otherwise let it extract from MusicXML
    return await importFromMusicXml(musicXmlFile, currentTitle, {
      fromScan: true,
      scanVoiceMode: options?.scanVoiceMode ?? 'conservative',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to convert PDF';
    throw new Error(`PDF conversion failed: ${errorMessage}`);
  }
}

async function importFromImages(
  files: File[],
  pageNumbers: number[],
  currentTitle?: string,
  options?: { scanVoiceMode?: ScanVoiceMode }
): Promise<Composition> {
  try {
    // Convert images to MusicXML using OMR service
    const response = await omrService.convertImagesToMusicXML(files, pageNumbers);
    
    // Create a Blob from the MusicXML string and convert it to a File-like object
    const musicXmlBlob = new Blob([response.file_content], { type: 'application/xml' });
    const fileName = files.length === 1 
      ? files[0].name.replace(/\.(jpg|jpeg|png|tiff|tif)$/i, '.musicxml')
      : 'imported.musicxml';
    const musicXmlFile = new File([musicXmlBlob], fileName, {
      type: 'application/xml',
    });
    
    // Use the existing MusicXML import function
    // Pass the title if provided, otherwise let it extract from MusicXML
    return await importFromMusicXml(musicXmlFile, currentTitle, {
      fromScan: true,
      scanVoiceMode: options?.scanVoiceMode ?? 'conservative',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to convert images';
    throw new Error(`Image conversion failed: ${errorMessage}`);
  }
}
