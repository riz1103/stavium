import * as Tone from 'tone';
import Soundfont from 'soundfont-player';
import { Chord } from 'tonal';
import { Composition, Measure, Note, NoteDuration, OttavaType } from '../../types/music';
import { durationToBeats, beatsToSeconds } from '../../utils/durationUtils';
import { pitchToMidi, applyKeySignature, applyKeySignatureAndMeasureAccidentals } from '../../utils/noteUtils';
import { usePlaybackStore, PlayingNoteRef } from '../../app/store/playbackStore';

// ── Sustain loop configuration ────────────────────────────────────────────────
// Piano and guitar have a natural decay envelope — looping them causes an
// audible re-attack artefact.  For sustaining instruments (organ, strings…)
// we loop only the SUSTAIN portion of the sample by setting loopStart past the
// initial attack transient.  The attack plays once at note-on; every subsequent
// loop cycle skips back to loopStart, avoiding the re-attack artefact.

/** Instruments whose samples decay naturally — do NOT loop them. */
const LOOP_DISABLED = new Set(['piano', 'guitar']);

/**
 * loopStart (in seconds) for each sustaining instrument.
 * After the attack phase the AudioBufferSourceNode jumps back to this offset
 * instead of the very beginning of the buffer, so only the sustain body loops.
 */
const LOOP_START: Record<string, number> = {
  organ:   0.04,  // organ attack is nearly instant
  violin:  0.15,
  strings: 0.20,
  choir:   0.30,
  brass:   0.10,
  flute:   0.10,
  synth:   0.02,
};
// ─────────────────────────────────────────────────────────────────────────────

// Maps our instrument names → Soundfont instrument names
const SOUNDFONT_MAP: Record<string, string> = {
  piano:   'acoustic_grand_piano',
  organ:   'church_organ',
  guitar:  'acoustic_guitar_nylon',
  violin:  'violin',
  strings: 'string_ensemble_1',
  choir:   'choir_aahs',
  brass:   'brass_section',
  synth:   'lead_1_square',
  flute:   'flute',
};

// Tone.js synth presets used as fallback when soundfont loading fails
const SYNTH_PRESETS: Record<string, any> = {
  piano:   { oscillator: { type: 'triangle' }, envelope: { attack: 0.01, decay: 0.3,  sustain: 0.2, release: 1.0 } },
  organ:   { oscillator: { type: 'square'   }, envelope: { attack: 0.01, decay: 0.01, sustain: 1.0, release: 0.1 } },
  guitar:  { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.01, decay: 0.5,  sustain: 0.1, release: 0.5 } },
  violin:  { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.1,  decay: 0.2,  sustain: 0.8, release: 0.5 } },
  strings: { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.2,  decay: 0.3,  sustain: 0.7, release: 0.8 } },
  choir:   { oscillator: { type: 'sine'     }, envelope: { attack: 0.2,  decay: 0.2,  sustain: 0.8, release: 0.5 } },
  brass:   { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.05, decay: 0.1,  sustain: 0.9, release: 0.2 } },
  synth:   { oscillator: { type: 'square'   }, envelope: { attack: 0.01, decay: 0.1,  sustain: 0.9, release: 0.3 } },
  flute:   { oscillator: { type: 'sine'     }, envelope: { attack: 0.1,  decay: 0.1,  sustain: 0.8, release: 0.4 } },
};

type SoundfontPlayer = Awaited<ReturnType<typeof Soundfont.instrument>>;

interface ScheduledNote {
  ref: PlayingNoteRef;
  startTime: number; // AudioContext time (seconds)
  endTime: number;   // AudioContext time (seconds)
}

/** A pending audio event that will be materialized into an AudioBufferSourceNode
 *  just-in-time (within a lookahead window) rather than all at once. */
interface PendingAudioEvent {
  /** 'sf' = soundfont player, 'fallback' = Tone.js PolySynth */
  type: 'sf' | 'fallback';
  midi: number;
  freq: number;       // only used for fallback
  startTime: number;  // AudioContext absolute time
  playDuration: number;
  gain: number;
  velocity: number;
  instrument: string;
  shouldLoop: boolean;
  loopStart: number;
  staffIndex: number;
  /** noteTime relative to Transport (only used for fallback) */
  transportTime: number;
}

interface PendingClickEvent {
  startTime: number;
  frequency: number;
  duration: number;
  velocity: number;
}

interface PlaybackOptions {
  playbackTempo?: number;
  startMeasure?: number | null;
  endMeasure?: number | null;
  playChords?: boolean;
  expressivePlayback?: boolean;
  metronomeEnabled?: boolean;
  countInEnabled?: boolean;
  countInBars?: number;
}

const DYNAMIC_GAIN: Record<string, number> = {
  ppp: 0.35,
  pp: 0.45,
  p: 0.58,
  mp: 0.72,
  mf: 0.86,
  f: 1.0,
  ff: 1.12,
  fff: 1.22,
};

const articulationDurationMultiplier = (articulation?: string): number => {
  if (!articulation) return 1;
  if (articulation === 'a.') return 0.58;
  if (articulation === 'av') return 0.45;
  if (articulation === '>') return 0.88;
  if (articulation === '-') return 1.12;
  if (articulation === '^') return 0.82;
  if (articulation === 'a>') return 0.55;
  return 1;
};

const articulationGainMultiplier = (articulation?: string): number => {
  if (!articulation) return 1;
  if (articulation === '>') return 1.18;
  if (articulation === '^') return 1.24;
  if (articulation === 'a>') return 1.2;
  if (articulation === 'a.' || articulation === 'av') return 0.95;
  return 1;
};

const dynamicScalar = (dynamic?: string): number => (dynamic ? (DYNAMIC_GAIN[dynamic] ?? 1) : DYNAMIC_GAIN.mf);

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const noteRefKey = (staffIndex: number, voiceIndex: number, measureIndex: number, noteIndex: number): string =>
  `${staffIndex}:${voiceIndex}:${measureIndex}:${noteIndex}`;

const parseEndingPasses = (ending?: string): number[] => {
  if (!ending) return [];
  const nums = ending.match(/\d+/g)?.map((n) => Number(n)).filter((n) => Number.isFinite(n)) ?? [];
  return Array.from(new Set(nums)).sort((a, b) => a - b);
};

const ottavaSemitoneShift = (ottava?: OttavaType): number => {
  if (!ottava) return 0;
  if (ottava === '8va') return 12;
  if (ottava === '8vb') return -12;
  if (ottava === '15ma') return 24;
  if (ottava === '15mb') return -24;
  return 0;
};

const buildPlaybackMeasureOrder = (
  measures: Measure[],
  startIdx: number,
  endIdx: number
): number[] => {
  if (measures.length === 0 || startIdx > endIdx) return [];
  const segnoCandidates = measures
    .map((m, i) => (m.segno ? i : -1))
    .filter((i) => i >= startIdx && i <= endIdx);
  const codaCandidates = measures
    .map((m, i) => (m.coda ? i : -1))
    .filter((i) => i >= startIdx && i <= endIdx);
  const segnoIdx = segnoCandidates.length > 0 ? segnoCandidates[0] : null;
  const firstCodaIdx = codaCandidates.length > 0 ? codaCandidates[0] : null;

  const order: number[] = [];
  const repeatPassByStart = new Map<number, number>();
  const repeatStartStack: number[] = [];
  const daExecuted = new Set<number>();
  const fineArmedByJump = new Set<number>();
  let alCodaArmed = false;
  let codaJumpDone = false;
  let pointer = startIdx;
  let safety = 0;
  const maxSteps = Math.max((endIdx - startIdx + 1) * 10, 64);

  while (pointer >= startIdx && pointer <= endIdx && safety < maxSteps) {
    safety++;
    const measure = measures[pointer];
    if (!measure) {
      pointer++;
      continue;
    }

    // Track active repeat scope.
    if (measure.repeatStart) {
      if (repeatStartStack.length === 0 || repeatStartStack[repeatStartStack.length - 1] !== pointer) {
        repeatStartStack.push(pointer);
      }
      if (!repeatPassByStart.has(pointer)) repeatPassByStart.set(pointer, 1);
    }
    const activeRepeatStart = repeatStartStack.length > 0 ? repeatStartStack[repeatStartStack.length - 1] : null;
    const activePass = activeRepeatStart !== null ? (repeatPassByStart.get(activeRepeatStart) ?? 1) : 1;

    const endingPasses = parseEndingPasses(measure.ending);
    const shouldPlayMeasure = endingPasses.length === 0 || endingPasses.includes(activePass);
    if (shouldPlayMeasure) order.push(pointer);

    const nav = measure.navigation;
    if (nav === 'Fine' && fineArmedByJump.size > 0) break;

    if ((nav === 'D.C.' || nav === 'D.C. al Coda') && !daExecuted.has(pointer)) {
      daExecuted.add(pointer);
      fineArmedByJump.add(pointer);
      alCodaArmed = nav === 'D.C. al Coda';
      pointer = startIdx;
      continue;
    }
    if ((nav === 'D.S.' || nav === 'D.S. al Coda') && !daExecuted.has(pointer) && segnoIdx !== null) {
      daExecuted.add(pointer);
      fineArmedByJump.add(pointer);
      alCodaArmed = nav === 'D.S. al Coda';
      pointer = segnoIdx;
      continue;
    }
    if (nav === 'To Coda' && alCodaArmed && !codaJumpDone && firstCodaIdx !== null) {
      codaJumpDone = true;
      // Prefer the next coda sign after the jump point; fall back to first coda.
      const nextCoda = codaCandidates.find((idx) => idx > pointer) ?? firstCodaIdx;
      pointer = nextCoda;
      continue;
    }

    if (measure.repeatEnd && activeRepeatStart !== null) {
      const pass = repeatPassByStart.get(activeRepeatStart) ?? 1;
      // Determine expected pass count from ending labels inside this repeat span.
      // No endings means normal two-pass repeat.
      let maxEndingPass = 1;
      for (let i = activeRepeatStart; i <= pointer; i++) {
        const parsed = parseEndingPasses(measures[i]?.ending);
        if (parsed.length > 0) {
          maxEndingPass = Math.max(maxEndingPass, parsed[parsed.length - 1]);
        }
      }
      const expectedPasses = Math.max(2, maxEndingPass);
      if (pass < expectedPasses) {
        repeatPassByStart.set(activeRepeatStart, pass + 1);
        pointer = activeRepeatStart;
        continue;
      }
      repeatStartStack.pop();
      repeatPassByStart.delete(activeRepeatStart);
    }

    pointer++;
  }

  return order.length > 0 ? order : Array.from({ length: endIdx - startIdx + 1 }, (_, i) => startIdx + i);
};

const buildHairpinGainMap = (
  composition: Composition
): Map<string, number> => {
  const map = new Map<string, number>();

  composition.staves.forEach((staff, staffIndex) => {
    const numVoices = staff.measures.reduce((mx, measure) => Math.max(mx, measure.voices.length), 0);

    for (let voiceIndex = 0; voiceIndex < numVoices; voiceIndex++) {
      const sequence: Array<{ key: string; note: Note }> = [];
      staff.measures.forEach((measure, measureIndex) => {
        const voice = measure.voices[voiceIndex];
        if (!voice) return;
        voice.notes.forEach((element, noteIndex) => {
          if (!('pitch' in element)) return;
          sequence.push({
            key: noteRefKey(staffIndex, voiceIndex, measureIndex, noteIndex),
            note: element as Note,
          });
        });
      });

      let active:
        | { startSeqIndex: number; startGain: number; targetGain: number }
        | null = null;
      let currentDynamicGain = DYNAMIC_GAIN.mf;

      for (let seqIndex = 0; seqIndex < sequence.length; seqIndex++) {
        const entry = sequence[seqIndex];
        const note = entry.note;
        if (note.dynamic) currentDynamicGain = dynamicScalar(note.dynamic);

        if (note.hairpinStart) {
          const startGain = currentDynamicGain;
          const targetGain =
            note.hairpinStart === 'crescendo'
              ? Math.min(1.35, startGain + 0.32)
              : Math.max(0.35, startGain - 0.32);
          active = { startSeqIndex: seqIndex, startGain, targetGain };
        }

        if (active && note.hairpinEnd) {
          const span = Math.max(1, seqIndex - active.startSeqIndex);
          for (let i = active.startSeqIndex; i <= seqIndex; i++) {
            const t = (i - active.startSeqIndex) / span;
            const gain = lerp(active.startGain, active.targetGain, t);
            map.set(sequence[i].key, gain);
          }
          currentDynamicGain = active.targetGain;
          active = null;
        }
      }

      const trailingHairpin = active;
      if (trailingHairpin && sequence.length > 0) {
        const lastIdx = sequence.length - 1;
        const span = Math.max(1, lastIdx - trailingHairpin.startSeqIndex);
        for (let i = trailingHairpin.startSeqIndex; i <= lastIdx; i++) {
          const t = (i - trailingHairpin.startSeqIndex) / span;
          const gain = lerp(trailingHairpin.startGain, trailingHairpin.targetGain, t);
          map.set(sequence[i].key, gain);
        }
      }
    }
  });

  return map;
};

export class ToneScheduler {
  /** Cache of loaded soundfont players, keyed by instrument name */
  private sfPlayers: Map<string, SoundfontPlayer> = new Map();
  /** Fallback Tone.js synths, keyed by instrument name (for preview) */
  private fallbackSynths: Map<string, Tone.PolySynth> = new Map();
  /** Per-staff fallback synths (for playback with individual volume control) */
  private staffFallbackSynths: Map<number, Tone.PolySynth> = new Map();
  private isPlaying = false;
  /** All scheduled notes with their timing info (for highlights) */
  private scheduledNotes: ScheduledNote[] = [];
  /** AudioBufferSourceNodes created by manual crossfade sustain (for stop/cleanup). */
  private crossfadeNodes: AudioBufferSourceNode[] = [];
  /** In-flight promise guard so repeated preload triggers don't duplicate work. */
  private preloadAllPromise: Promise<void> | null = null;
  /** Animation frame ID for highlighting updates */
  private highlightAnimationFrame: number | null = null;
  /** AudioContext start time (when playback began) */
  private playbackStartTime: number = 0;
  /** The AudioContext time when all notes will have finished */
  private playbackEndTime: number = 0;

  // ── JIT audio scheduling ─────────────────────────────────────────────────
  /** Queue of audio events not yet sent to the audio graph. Sorted by startTime. */
  private pendingAudio: PendingAudioEvent[] = [];
  /** Index into pendingAudio – everything before this has already been dispatched. */
  private pendingAudioCursor: number = 0;
  /** Queue of metronome/click events, also dispatched in lookahead windows. */
  private pendingClicks: PendingClickEvent[] = [];
  private pendingClickCursor: number = 0;
  /** How far ahead (seconds) of AudioContext.currentTime we materialize nodes. */
  private static readonly LOOKAHEAD_SEC = 3.0;
  /** Lightweight synth used for count-in + metronome clicks. */
  private metronomeSynth: Tone.Synth | null = null;
  /** Optional completion callback used by UI for looping. */
  private onPlaybackComplete: (() => void) | null = null;

  // ── AudioContext ──────────────────────────────────────────────────────────
  /** Share Tone.js's underlying AudioContext so timing is in sync */
  private getAC(): AudioContext {
    return Tone.getContext().rawContext as AudioContext;
  }

  /**
   * Best-effort access to the decoded sample buffer used by soundfont-player.
   * Internal shapes differ by library version; this intentionally probes a few
   * common layouts and returns null if unavailable.
   */
  private getSoundfontBuffer(sfPlayer: SoundfontPlayer, midi: number): AudioBuffer | null {
    try {
      const p: any = sfPlayer as any;
      const buffers = p?.buffers;
      if (!buffers) return null;

      const tryPick = (store: any): AudioBuffer | null => {
        if (!store) return null;
        if (store instanceof AudioBuffer) return store;
        if (typeof store.get === 'function') {
          const exact = store.get(midi) ?? store.get(String(midi));
          if (exact instanceof AudioBuffer) return exact;
          // Nearest key fallback
          const keys = Array.from(store.keys?.() ?? [])
            .map((k: any) => Number(k))
            .filter((k: number) => Number.isFinite(k))
            .sort((a: number, b: number) => Math.abs(a - midi) - Math.abs(b - midi));
          if (keys.length > 0) {
            const nearest = store.get(keys[0]) ?? store.get(String(keys[0]));
            if (nearest instanceof AudioBuffer) return nearest;
          }
          return null;
        }
        if (Array.isArray(store)) {
          const maybe = store.find((x: any) => x instanceof AudioBuffer);
          return maybe ?? null;
        }
        if (typeof store === 'object') {
          const exact = store[midi] ?? store[String(midi)];
          if (exact instanceof AudioBuffer) return exact;
          const keys = Object.keys(store)
            .map((k) => Number(k))
            .filter((k) => Number.isFinite(k))
            .sort((a, b) => Math.abs(a - midi) - Math.abs(b - midi));
          if (keys.length > 0) {
            const nearest = store[keys[0]] ?? store[String(keys[0])];
            if (nearest instanceof AudioBuffer) return nearest;
          }
        }
        return null;
      };

      // Common layouts observed across versions:
      // 1) player.buffers (Map-like / object)
      // 2) player.buffers.buffers (nested map/object)
      // 3) player.buffers._buffers (private field)
      return (
        tryPick(buffers) ??
        tryPick((buffers as any).buffers) ??
        tryPick((buffers as any)._buffers)
      );
    } catch {
      return null;
    }
  }

  /**
   * Manual overlap/crossfade sustain to avoid audible loop seams on long holds.
   * Returns true when scheduled, false when buffer internals are unavailable.
   *
   * Safety contract:
   * - Never throws outward
   * - Never leaves playback silent on failure (caller falls back to sfPlayer.start)
   */
  private scheduleCrossfadeSustain(
    sfPlayer: SoundfontPlayer,
    midi: number,
    startTime: number,
    totalDuration: number,
    gainValue: number,
    loopStartHint: number,
  ): boolean {
    try {
      const ac = this.getAC();
      const buffer = this.getSoundfontBuffer(sfPlayer, midi);
      if (!buffer) return false;

      const p: any = sfPlayer as any;
      const cents: number = typeof p?.buffers?.tuning === 'function' ? p.buffers.tuning(midi) : 0;
      const playbackRate = Math.pow(2, cents / 1200);

      const bufferLen = buffer.duration;
      if (!Number.isFinite(bufferLen) || bufferLen < 0.2) return false;

      // Clamp loop start to a safe range.
      const loopStart = Math.max(0, Math.min(loopStartHint, bufferLen - 0.06));
      const loopBody = bufferLen - loopStart;
      if (loopBody < 0.08) return false;

      // Adaptive crossfade to avoid overfading short loop bodies.
      const xfade = Math.max(0.02, Math.min(0.08, loopBody * 0.25));
      const netAdvance = loopBody - xfade;
      if (netAdvance <= 0.01) return false;

      const release = 0.05;

      // Segment #1: initial attack (from offset 0) plays once.
      let covered = Math.min(totalDuration, bufferLen);
      let segStart = startTime;
      const firstSrc = ac.createBufferSource();
      firstSrc.buffer = buffer;
      if (playbackRate !== 1) firstSrc.playbackRate.value = playbackRate;
      const firstGain = ac.createGain();
      firstGain.gain.setValueAtTime(gainValue, segStart);
      firstSrc.connect(firstGain);
      firstGain.connect(ac.destination);
      firstSrc.start(segStart, 0, Math.min(bufferLen, totalDuration + release));
      this.crossfadeNodes.push(firstSrc);

      if (covered >= totalDuration - 0.001) {
        return true; // short enough; no sustain stitching needed
      }

      // Start first sustain segment slightly before attack segment ends.
      segStart = startTime + bufferLen - xfade;

      while (covered < totalDuration - 0.001) {
        const remaining = totalDuration - covered;
        const isLast = remaining <= loopBody;

        const src = ac.createBufferSource();
        src.buffer = buffer;
        if (playbackRate !== 1) src.playbackRate.value = playbackRate;
        const gn = ac.createGain();
        src.connect(gn);
        gn.connect(ac.destination);

        // Crossfade in
        gn.gain.setValueAtTime(0, segStart);
        gn.gain.linearRampToValueAtTime(gainValue, segStart + xfade);

        if (isLast) {
          // Hold to end, then release.
          const tailEnd = segStart + Math.max(remaining, xfade);
          gn.gain.setValueAtTime(gainValue, Math.max(segStart + xfade, tailEnd - 0.002));
          gn.gain.linearRampToValueAtTime(0, tailEnd + release);
          src.start(segStart, loopStart, Math.min(loopBody, remaining + release + xfade));
          this.crossfadeNodes.push(src);
          break;
        } else {
          // Crossfade out near segment end so next segment can overlap cleanly.
          const segEnd = segStart + loopBody;
          gn.gain.setValueAtTime(gainValue, segEnd - xfade - 0.002);
          gn.gain.linearRampToValueAtTime(0, segEnd);
          src.start(segStart, loopStart, loopBody);
          this.crossfadeNodes.push(src);
          covered += netAdvance;
          segStart += netAdvance;
        }
      }

      return true;
    } catch (err) {
      console.warn('[ToneScheduler] crossfade sustain scheduling failed, using fallback:', err);
      return false;
    }
  }

  // ── Instrument loading ────────────────────────────────────────────────────
  /** Try to load a soundfont player for the instrument; returns null on failure */
  private async loadSoundfont(name: string): Promise<SoundfontPlayer | null> {
    if (this.sfPlayers.has(name)) return this.sfPlayers.get(name)!;

    const sfName = SOUNDFONT_MAP[name] ?? 'acoustic_grand_piano';
    const ac = this.getAC();

    try {
      const player = await Soundfont.instrument(ac, sfName as Parameters<typeof Soundfont.instrument>[1], {
        soundfont: 'MusyngKite',
        format: 'mp3',
      });
      this.sfPlayers.set(name, player);
      return player;
    } catch (err) {
      console.warn(`[Soundfont] Failed to load "${name}", using synth fallback:`, err);
      return null;
    }
  }

  /** Get or create a Tone.js PolySynth for an instrument (fallback) */
  private getFallbackSynth(name: string): Tone.PolySynth {
    if (this.fallbackSynths.has(name)) return this.fallbackSynths.get(name)!;

    const preset = SYNTH_PRESETS[name] ?? SYNTH_PRESETS['piano'];
    const synth = new Tone.PolySynth(Tone.Synth, preset).toDestination();
    this.fallbackSynths.set(name, synth);
    return synth;
  }

  private getMetronomeSynth(): Tone.Synth {
    if (this.metronomeSynth) return this.metronomeSynth;
    this.metronomeSynth = new Tone.Synth({
      oscillator: { type: 'square' },
      envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 },
    }).toDestination();
    return this.metronomeSynth;
  }

  setPlaybackCompleteCallback(callback: (() => void) | null): void {
    this.onPlaybackComplete = callback;
  }

  // ── Instrument Preloading ────────────────────────────────────────────────────
  /**
   * Preload instruments used in a composition (and optionally common instruments).
   * This is called in the background when a composition is loaded to reduce
   * playback delay. Returns a promise that resolves when all instruments are loaded.
   */
  async preloadInstruments(composition: Composition, includeCommon: boolean = true): Promise<void> {
    const instrumentsToLoad = new Set<string>();

    // Collect all instruments from the composition
    composition.staves.forEach((staff) => {
      if (staff.instrument) {
        instrumentsToLoad.add(staff.instrument);
      }
    });

    // Optionally preload common instruments (piano is most common)
    if (includeCommon && !instrumentsToLoad.has('piano')) {
      instrumentsToLoad.add('piano');
    }

    // Load all instruments in parallel (non-blocking)
    const loadPromises = Array.from(instrumentsToLoad).map(async (name) => {
      // Skip if already loaded
      if (this.sfPlayers.has(name)) return;
      
      try {
        await this.loadSoundfont(name);
      } catch (err) {
        // Silently fail - preloading is best-effort
        console.debug(`Failed to preload instrument "${name}":`, err);
      }
    });

    await Promise.all(loadPromises);
  }

  // ── Note Preview ─────────────────────────────────────────────────────────────
  /**
   * Play a single note as a preview (for when user adds a note).
   * Uses the instrument from the staff and applies key signature.
   */
  async previewNote(
    pitch: string,
    instrument: string,
    keySignature: string,
    duration: string = '0.2' // Short preview duration (200ms)
  ): Promise<void> {
    try {
      // Ensure AudioContext is started
      await Tone.start();
      const ac = this.getAC();
      if (ac.state === 'suspended') await ac.resume();

      // Apply key signature to pitch
      const actualPitch = applyKeySignature(pitch, keySignature);
      const midi = pitchToMidi(actualPitch);

      // Try to get or load soundfont
      let sfPlayer: SoundfontPlayer | null | undefined = this.sfPlayers.get(instrument);
      if (!sfPlayer) {
        sfPlayer = await this.loadSoundfont(instrument);
      }

      const now = ac.currentTime + 0.01; // Small lookahead

      if (sfPlayer) {
        // Use soundfont
        sfPlayer.start(
          String(midi) as unknown as Parameters<SoundfontPlayer['start']>[0],
          now,
          { duration: parseFloat(duration) }
        );
      } else {
        // Fallback to Tone.js synth
        const fallback = this.getFallbackSynth(instrument);
        const freq = 440 * Math.pow(2, (midi - 69) / 12);
        fallback.triggerAttackRelease(freq, parseFloat(duration), now);
      }
    } catch (err) {
      console.warn('Failed to preview note:', err);
    }
  }

  // ── Playback ──────────────────────────────────────────────────────────────
  async playComposition(
    composition: Composition,
    options: PlaybackOptions = {}
  ): Promise<void> {
    // Unlock AudioContext — must be called from a user gesture
    await Tone.start();

    this.stop();

    const ac = this.getAC();
    if (ac.state === 'suspended') await ac.resume();

    // Clear previous scheduled notes, pending audio queue, and lingering crossfade sources
    this.scheduledNotes = [];
    this.pendingAudio = [];
    this.pendingAudioCursor = 0;
    this.pendingClicks = [];
    this.pendingClickCursor = 0;
    this.crossfadeNodes = [];
    this.playbackStartTime = ac.currentTime;

    // Get playback store to check for playback instruments
    const playbackStore = usePlaybackStore.getState();
    
    const {
      playbackTempo,
      startMeasure,
      endMeasure,
      playChords,
      expressivePlayback = true,
      metronomeEnabled = false,
      countInEnabled = false,
      countInBars = 1,
    } = options;

    // Use playback tempo if provided, otherwise use composition tempo
    const effectiveTempo = playbackTempo ?? composition.tempo;
    const isGregorianChant = composition.notationSystem === 'gregorian-chant';
    const toChantBaseDuration = (duration: NoteDuration): NoteDuration =>
      duration
        .replace('dotted-', '')
        .replace(/^(triplet|quintuplet|sextuplet|septuplet)-/, '') as NoteDuration;
    const chantProfile = composition.chantInterpretation ?? 'medium';
    const chantOrnamentScaling: Record<
      'subtle' | 'medium' | 'expressive',
      { mora: number; episema: number }
    > = {
      subtle: { mora: 1.45, episema: 1.2 },
      medium: { mora: 1.8, episema: 1.35 },
      expressive: { mora: 2.15, episema: 1.55 },
    };
    const getChantOrnamentMultiplier = (element: { duration: NoteDuration } | Note): number => {
      if (!isGregorianChant || !('pitch' in element)) return 1;
      const ornament = (element as Note).chantOrnament ?? 'none';
      const profile = chantOrnamentScaling[chantProfile];
      if (ornament === 'mora') return profile.mora;
      if (ornament === 'episema') return profile.episema;
      return 1;
    };
    const getElementBeats = (duration: NoteDuration): number =>
      isGregorianChant ? durationToBeats(toChantBaseDuration(duration)) : durationToBeats(duration);
    const getElementPlaybackBeats = (element: { duration: NoteDuration } | Note): number =>
      getElementBeats(element.duration) * getChantOrnamentMultiplier(element);
    const getElementDurationSec = (element: { duration: NoteDuration } | Note, tempo: number): number =>
      beatsToSeconds(getElementPlaybackBeats(element), tempo);

    // Normalize requested playback range so stale/out-of-bounds values
    // never result in a silent "played nothing" run.
    const maxMeasures = composition.staves.reduce(
      (mx, staff) => Math.max(mx, staff.measures.length),
      0
    );
    const clampMeasure = (value: number | null | undefined): number | null => {
      if (value === null || value === undefined || !Number.isFinite(value)) return null;
      if (maxMeasures <= 0) return null;
      const n = Math.floor(value);
      if (n < 0) return 0;
      if (n >= maxMeasures) return maxMeasures - 1;
      return n;
    };
    let normalizedStart = clampMeasure(startMeasure ?? null);
    let normalizedEnd = clampMeasure(endMeasure ?? null);
    if (
      normalizedStart !== null &&
      normalizedEnd !== null &&
      normalizedEnd < normalizedStart
    ) {
      const temp = normalizedStart;
      normalizedStart = normalizedEnd;
      normalizedEnd = temp;
    }

    // Collect all instruments (composition + playback overrides) that need to be loaded
    const instrumentsToLoad = new Set<string>();
    composition.staves.forEach((staff, staffIndex) => {
      const effectiveInstrument = playbackStore.getEffectiveInstrument(staffIndex, staff.instrument);
      instrumentsToLoad.add(effectiveInstrument);
    });
    
    // Load soundfonts for every unique instrument in parallel
    const sfResults = await Promise.all(
      Array.from(instrumentsToLoad).map(async (name) => ({ name, player: await this.loadSoundfont(name) }))
    );
    const sfMap = new Map(sfResults.map(({ name, player }) => [name, player]));

    // Reset the Tone.js Transport for fallback scheduling
    Tone.getTransport().cancel();
    Tone.getTransport().stop();
    Tone.getTransport().bpm.value = effectiveTempo;

    let hasFallbackNotes = false;

    // Reference measures for global overrides (time sig, key, tempo)
    const refMeasures = composition.staves[0]?.measures ?? [];

    /** Walk back through measures to find the latest override, else return default. */
    function effTimeSig(upTo: number): string {
      for (let i = upTo; i >= 0; i--) if (refMeasures[i]?.timeSignature) return refMeasures[i].timeSignature!;
      return composition.timeSignature;
    }
    function effKeySig(upTo: number): string {
      for (let i = upTo; i >= 0; i--) if (refMeasures[i]?.keySignature) return refMeasures[i].keySignature!;
      return composition.keySignature;
    }
    function effTempo(upTo: number): number {
      for (let i = upTo; i >= 0; i--) if (refMeasures[i]?.tempo !== undefined) return refMeasures[i].tempo!;
      return effectiveTempo; // Use effective tempo (playback or composition)
    }

    // Anacrusis: the first measure has fewer beats than a full measure (standard notation only)
    const pickupBeats = composition.anacrusis ? (composition.pickupBeats ?? 1)
      : Number(composition.timeSignature.split('/')[0]);

    const startIdxGlobal = normalizedStart ?? 0;
    const endIdxGlobal = normalizedEnd ?? Math.max(0, maxMeasures - 1);
    const playbackMeasureOrder = buildPlaybackMeasureOrder(refMeasures, startIdxGlobal, endIdxGlobal);
    const occurrenceCount = playbackMeasureOrder.length;
    const isCountInActive = !isGregorianChant && countInEnabled;
    const metronomeActive = !isGregorianChant && metronomeEnabled;
    const firstMeasureIdx = playbackMeasureOrder[0] ?? startIdxGlobal;
    const firstTempo = effTempo(firstMeasureIdx);
    const firstTimeSig = effTimeSig(firstMeasureIdx);
    const [firstBeatsPerMeasure] = firstTimeSig.split('/').map(Number);
    const bars = Math.max(1, Math.min(2, Math.floor(countInBars)));
    const countInBeats = isCountInActive ? Math.max(1, firstBeatsPerMeasure || 4) * bars : 0;
    const countInDurationSec = countInBeats > 0 ? beatsToSeconds(countInBeats, firstTempo) : 0;
    const now = ac.currentTime + 0.1 + countInDurationSec; // small lookahead + optional count-in lead

    if (isCountInActive) {
      const countInStart = now - countInDurationSec;
      for (let beat = 0; beat < countInBeats; beat++) {
        this.pendingClicks.push({
          startTime: countInStart + beatsToSeconds(beat, firstTempo),
          frequency: beat === 0 ? 1320 : 980,
          duration: 0.045,
          velocity: beat === 0 ? 0.85 : 0.65,
        });
      }
    }

    if (metronomeActive) {
      let metronomeMeasureStartSec = 0;
      for (let occIdx = 0; occIdx < occurrenceCount; occIdx++) {
        const measureIndex = playbackMeasureOrder[occIdx];
        const timeSig = effTimeSig(measureIndex);
        const tempoAtMeasure = effTempo(measureIndex);
        const [beatsPerMeasure] = timeSig.split('/').map(Number);
        const thisMeasureBeats =
          composition.anacrusis && measureIndex === 0
            ? pickupBeats
            : beatsPerMeasure;
        for (let beat = 0; beat < thisMeasureBeats; beat++) {
          this.pendingClicks.push({
            startTime: now + metronomeMeasureStartSec + beatsToSeconds(beat, tempoAtMeasure),
            frequency: beat === 0 ? 1240 : 920,
            duration: 0.035,
            velocity: beat === 0 ? 0.72 : 0.52,
          });
        }
        metronomeMeasureStartSec += beatsToSeconds(thisMeasureBeats, tempoAtMeasure);
      }
    }

    // ── Pre-compute cross-measure ties following playback order ───────────────
    // Key format includes occurrence index so repeats/navigation are respected:
    // `${staffIdx}:${voiceIdx}:${occIdx}:${noteIdx}`
    const crossTieExtra = new Map<string, number>(); // origin note occurrence → extra seconds
    const crossTieSkip = new Set<string>();          // continuation note occurrences → silent
    const findLastNoteIndex = (voice: { notes: any[] } | undefined): number => {
      if (!voice?.notes?.length) return -1;
      for (let i = voice.notes.length - 1; i >= 0; i--) if ('pitch' in voice.notes[i]) return i;
      return -1;
    };
    const findFirstNoteIndex = (voice: { notes: any[] } | undefined): number => {
      if (!voice?.notes?.length) return -1;
      for (let i = 0; i < voice.notes.length; i++) if ('pitch' in voice.notes[i]) return i;
      return -1;
    };

    composition.staves.forEach((staff, sIdx) => {
      const numVoices = staff.measures.reduce((mx, m) => Math.max(mx, m.voices.length), 0);
      for (let vIdx = 0; vIdx < numVoices; vIdx++) {
        for (let occIdx = 0; occIdx < occurrenceCount - 1; occIdx++) {
          const measureIndex = playbackMeasureOrder[occIdx];
          const voice = staff.measures[measureIndex]?.voices[vIdx];
          const lastNIdx = findLastNoteIndex(voice);
          if (lastNIdx < 0) continue;
          const lastEl = voice?.notes[lastNIdx];
          if (!lastEl || !('pitch' in lastEl) || !(lastEl as Note).tie) continue;
          const lastNote = lastEl as Note;

          const originKey = `${sIdx}:${vIdx}:${occIdx}:${lastNIdx}`;
          let nextOcc = occIdx + 1;

          while (nextOcc < occurrenceCount) {
            const nextMeasureIndex = playbackMeasureOrder[nextOcc];
            const nextVoice = staff.measures[nextMeasureIndex]?.voices[vIdx];
            const firstNIdx = findFirstNoteIndex(nextVoice);
            if (firstNIdx < 0) break;
            const firstEl = nextVoice?.notes[firstNIdx];
            if (!firstEl || !('pitch' in firstEl) || (firstEl as Note).pitch !== lastNote.pitch) break;

            const extraSec = getElementDurationSec(firstEl as Note, effTempo(nextMeasureIndex));
            crossTieExtra.set(originKey, (crossTieExtra.get(originKey) ?? 0) + extraSec);
            crossTieSkip.add(`${sIdx}:${vIdx}:${nextOcc}:${firstNIdx}`);

            const hasMoreNotesAfter = nextVoice!.notes.slice(firstNIdx + 1).some((el) => 'pitch' in el);
            if ((firstEl as Note).tie && !hasMoreNotesAfter) {
              nextOcc++;
            } else {
              break;
            }
          }
        }
      }
    });

    const hairpinGainMap = expressivePlayback ? buildHairpinGainMap(composition) : new Map<string, number>();

    composition.staves.forEach((staff, staffIndex) => {
      // Use playback instrument if set, otherwise use composition instrument
      const effectiveInstrument = playbackStore.getEffectiveInstrument(staffIndex, staff.instrument);
      const sfPlayer = sfMap.get(effectiveInstrument) ?? null;
      
      // For playback, create a per-staff fallback synth (not per-instrument) so each staff
      // can have independent volume control even if they share the same instrument
      let fallback: Tone.PolySynth | null = null;
      if (!sfPlayer) {
        if (!this.staffFallbackSynths.has(staffIndex)) {
          const preset = SYNTH_PRESETS[effectiveInstrument] ?? SYNTH_PRESETS['piano'];
          const synth = new Tone.PolySynth(Tone.Synth, preset).toDestination();
          this.staffFallbackSynths.set(staffIndex, synth);
        }
        fallback = this.staffFallbackSynths.get(staffIndex)!;
      }

      // Check if this staff is effectively muted (explicit mute + solo logic)
      const isMuted = playbackStore.isStaffEffectivelyMuted(staffIndex);
      const volumePercent = playbackStore.getStaffVolume(staffIndex);
      const gain = isMuted ? 0 : volumePercent / 100; // 0-1 for soundfont
      // For Tone.js: volume in dB (100% = 0dB, 50% = -6dB, 0% = -Infinity)
      const volumeDb = isMuted ? -Infinity : (volumePercent === 100 ? 0 : 20 * Math.log10(volumePercent / 100));

      // Set volume on fallback synth if it exists
      if (fallback) {
        fallback.volume.value = volumeDb;
      }

      // Range playback should start immediately from the selected measure,
      // not from the full-piece absolute timeline.
      let currentMeasureStart = 0; // in seconds, relative to playback start
      const activeOttavaByVoice = new Map<number, number>();
      const activePedalByVoice = new Map<number, boolean>();
      const findPedalReleaseOffsetSec = (
        voiceIndex: number,
        fromOccurrence: number,
        fromNoteIndex: number
      ): number | null => {
        let offsetSec = 0;
        for (let occ = fromOccurrence; occ < occurrenceCount; occ++) {
          const scanMeasureIdx = playbackMeasureOrder[occ];
          const scanMeasure = staff.measures[scanMeasureIdx];
          const scanVoice = scanMeasure?.voices[voiceIndex];
          if (!scanVoice) continue;
          const scanTempo = effTempo(scanMeasureIdx);
          const startAt = occ === fromOccurrence ? fromNoteIndex : 0;
          for (let ni = startAt; ni < scanVoice.notes.length; ni++) {
            const scanEl = scanVoice.notes[ni];
            const elDur = getElementDurationSec(scanEl as any, scanTempo);
            if ('pitch' in scanEl && (scanEl as Note).pedalEnd) {
              return offsetSec + elDur;
            }
            offsetSec += elDur;
          }
        }
        return null;
      };

      for (let occIdx = 0; occIdx < occurrenceCount; occIdx++) {
        const measureIndex = playbackMeasureOrder[occIdx];
        const measure = staff.measures[measureIndex];
        if (!measure) {
          const fallbackTempo = effTempo(measureIndex);
          const fallbackTimeSig = effTimeSig(measureIndex);
          const [fallbackBpm] = fallbackTimeSig.split('/').map(Number);
          const fallbackBeats = composition.anacrusis && measureIndex === 0 ? pickupBeats : fallbackBpm;
          currentMeasureStart += beatsToSeconds(fallbackBeats, fallbackTempo);
          continue;
        }
        // Effective values at this measure
        const currentTimeSig = effTimeSig(measureIndex);
        const currentKeySig  = effKeySig(measureIndex);
        const currentTempo   = effTempo(measureIndex);

        const [effBPM] = currentTimeSig.split('/').map(Number);

        // Standard notation is measure/time-signature based.
        // Gregorian chant is free rhythm: measure length follows actual note content.
        const thisMeasureBeats = isGregorianChant
          ? Number.POSITIVE_INFINITY
          : (composition.anacrusis && measureIndex === 0 ? pickupBeats : effBPM);
        const chantMeasureDurationSec = isGregorianChant
          ? Math.max(
              ...measure.voices.map((voice) =>
                beatsToSeconds(
                  voice.notes.reduce((sum, el) => sum + getElementPlaybackBeats(el as any), 0),
                  currentTempo
                )
              ),
              0
            )
          : 0;
        const measureDurationSec = isGregorianChant
          ? chantMeasureDurationSec
          : beatsToSeconds(thisMeasureBeats, currentTempo);

        // Each measure starts at its calculated time
        const measureStartTime = currentMeasureStart;

        const hasAnyLaneSoloInMeasure = measure.voices.some((_, laneIdx) =>
          playbackStore.isVoiceSoloed(staffIndex, laneIdx)
        );

        measure.voices.forEach((voice, voiceIndex) => {
          // Voice lanes are parallel timelines: each lane starts at beat 0.
          let measureTime = 0; // Time within this voice lane (in beats)
          let tiedNotesToSkip = 0; // Count of tied notes to skip (within-measure chains)
          let activeOttavaShift = activeOttavaByVoice.get(voiceIndex) ?? 0;
          let pedalDown = activePedalByVoice.get(voiceIndex) ?? false;
          const laneSoloed = playbackStore.isVoiceSoloed(staffIndex, voiceIndex);
          const laneExplicitMuted = playbackStore.isVoiceMuted(staffIndex, voiceIndex);
          const laneMuted =
            isMuted ||
            laneExplicitMuted ||
            (hasAnyLaneSoloInMeasure && !laneSoloed);
          
          voice.notes.forEach((element, noteIndex) => {
            // Skip AUDIO for within-measure tie continuations, but still register them
            // in scheduledNotes so the highlight indicator advances through each note.
            if (tiedNotesToSkip > 0) {
              tiedNotesToSkip--;
              const beats = getElementPlaybackBeats(element as any);
              if ('pitch' in element) {
                const skipNoteTime = measureStartTime + beatsToSeconds(measureTime, currentTempo);
                this.scheduledNotes.push({
                  ref: { staffIndex, measureIndex, voiceIndex, noteIndex },
                  startTime: now + skipNoteTime,
                  endTime:   now + skipNoteTime + beatsToSeconds(beats, currentTempo),
                });
              }
              measureTime += beats;
              return;
            }

            // Skip AUDIO for cross-measure tie continuations, but still highlight them.
            const tieOccKey = `${staffIndex}:${voiceIndex}:${occIdx}:${noteIndex}`;
            const refKey = `${staffIndex}:${voiceIndex}:${measureIndex}:${noteIndex}`;
            if (crossTieSkip.has(tieOccKey)) {
              const beats = getElementPlaybackBeats(element as any);
              if ('pitch' in element) {
                const skipNoteTime = measureStartTime + beatsToSeconds(measureTime, currentTempo);
                this.scheduledNotes.push({
                  ref: { staffIndex, measureIndex, voiceIndex, noteIndex },
                  startTime: now + skipNoteTime,
                  endTime:   now + skipNoteTime + beatsToSeconds(beats, currentTempo),
                });
              }
              measureTime += beats;
              return;
            }
            
            const beats = getElementPlaybackBeats(element as any);
            const durationSec = beatsToSeconds(beats, currentTempo);

            // Check if this note fits in the current measure
            if (!isGregorianChant && measureTime + beats > thisMeasureBeats) {
              console.warn(
                `Note overflows measure ${measureIndex + 1} (${measureTime + beats} beats > ${thisMeasureBeats} beats)`
              );
              const remainingBeats = thisMeasureBeats - measureTime;
              if (remainingBeats <= 0) return;
            }

            const noteTime = measureStartTime + beatsToSeconds(measureTime, currentTempo);

            if ('pitch' in element) {
              const note = element as Note;
              if (note.ottavaStart) {
                activeOttavaShift = ottavaSemitoneShift(note.ottavaStart);
              }
              if (note.pedalStart) {
                pedalDown = true;
              }
              
              // Check if this note is tied to the next note (explicitly set)
              const nextNote = noteIndex < voice.notes.length - 1 ? voice.notes[noteIndex + 1] : null;
              const isTied = note.tie && nextNote && 
                'pitch' in nextNote &&
                (nextNote as Note).pitch === note.pitch;
              
              // Check if this note is slurred to the previous note (explicitly set)
              const isSlurred = note.slur && noteIndex > 0 &&
                'pitch' in voice.notes[noteIndex - 1] &&
                (voice.notes[noteIndex - 1] as Note).pitch !== note.pitch;
              
              // If tied, calculate total duration of all tied notes
              // A tie chain continues only if each note in the chain has tie=true.
              // Example: A(tie) → B(tie) → C(no tie) → D(same pitch): chain is A+B only.
              let totalDurationSec = durationSec;

              // Add any cross-measure tie extension pre-computed above
              const crossExtra = crossTieExtra.get(tieOccKey) ?? 0;
              totalDurationSec += crossExtra;

              if (isTied) {
                let tiedIndex = noteIndex + 1;
                let prevTiedIndex = noteIndex; // Track the previous note in the chain
                while (tiedIndex < voice.notes.length) {
                  const tiedEl = voice.notes[tiedIndex];
                  const prevTiedEl = voice.notes[prevTiedIndex];
                  // Chain continues only if: (1) same pitch, AND (2) previous note has tie=true
                  if ('pitch' in tiedEl && 'pitch' in prevTiedEl &&
                      (tiedEl as Note).pitch === note.pitch &&
                      (prevTiedEl as Note).tie) {
                    totalDurationSec += getElementDurationSec(tiedEl as any, currentTempo);
                    prevTiedIndex = tiedIndex;
                    tiedIndex++;
                  } else {
                    break;
                  }
                }
                tiedNotesToSkip = tiedIndex - noteIndex - 1; // Skip all tied notes
              }
              
              // Apply effective key signature and measure-level accidentals to the pitch
              const actualPitch = applyKeySignatureAndMeasureAccidentals(
                note.pitch,
                currentKeySig,
                measure as any,
                noteIndex,
                note.accidental // Pass the note's explicit accidental field
              );
              const midi = pitchToMidi(actualPitch) + activeOttavaShift;
              
              const startTime = now + noteTime;
              
              // Highlight only covers this note's OWN duration.
              // Continuation notes (within-measure or cross-measure) are added to
              // scheduledNotes separately above, so the indicator advances through
              // each tied note in sequence even though audio plays as one long sound.
              const noteRef: PlayingNoteRef = {
                staffIndex,
                measureIndex,
                voiceIndex,
                noteIndex,
              };
              this.scheduledNotes.push({ ref: noteRef, startTime, endTime: startTime + durationSec });
              
              // Expression: make dynamics and articulations audible in playback.
              const hairpinGain = expressivePlayback ? hairpinGainMap.get(refKey) : undefined;
              const dynamicGain = expressivePlayback
                ? (hairpinGain ?? dynamicScalar(note.dynamic))
                : 1;
              const dynamicMultiplier = expressivePlayback ? dynamicGain / DYNAMIC_GAIN.mf : 1;
              const articulationDur = expressivePlayback ? articulationDurationMultiplier(note.articulation) : 1;
              const articulationGain = expressivePlayback ? articulationGainMultiplier(note.articulation) : 1;
              const slurDur = isSlurred ? 1.05 : 1;
              const durationMultiplier = articulationDur * slurDur;
              const pedalMultiplier = pedalDown ? 1.6 : 1;
              let playDuration = Math.max(0.05, totalDurationSec * durationMultiplier * pedalMultiplier);
              let renderedStartTime = startTime;

              // Grace notes steal time from the main note onset.
              if (note.grace) {
                const graceFraction = note.grace === 'appoggiatura' ? 0.4 : 0.18;
                const graceDuration = Math.max(0.035, Math.min(playDuration * graceFraction, 0.18));
                renderedStartTime += graceDuration;
                playDuration = Math.max(0.05, playDuration - graceDuration);
              }
              // Sustain notes to the pedal release point when pedal is down.
              if (pedalDown) {
                const pedalReleaseOffset = findPedalReleaseOffsetSec(voiceIndex, occIdx, noteIndex);
                if (pedalReleaseOffset !== null) {
                  playDuration = Math.max(playDuration, pedalReleaseOffset);
                } else {
                  playDuration = Math.max(playDuration, totalDurationSec * 1.9);
                }
              }
              const laneGain = laneMuted ? 0 : gain;
              const noteGain = Math.max(0, Math.min(1.5, laneGain * dynamicMultiplier * articulationGain));
              const velocity = Math.max(0.08, Math.min(1, noteGain));
              
              // Queue audio event for JIT scheduling (unless muted)
              if (!laneMuted) {
                const shouldLoop = !LOOP_DISABLED.has(effectiveInstrument);
                const loopStartVal = LOOP_START[effectiveInstrument] ?? 0.08;
                const freq = 440 * Math.pow(2, (midi - 69) / 12);

                if (note.grace) {
                  const graceFraction = note.grace === 'appoggiatura' ? 0.4 : 0.18;
                  const graceDuration = Math.max(0.035, Math.min(playDuration * graceFraction, 0.14));
                  this.pendingAudio.push({
                    type: sfPlayer ? 'sf' : 'fallback',
                    midi,
                    freq,
                    startTime,
                    playDuration: graceDuration,
                    gain: Math.max(0.04, noteGain * 0.92),
                    velocity: Math.max(0.05, velocity * 0.88),
                    instrument: effectiveInstrument,
                    shouldLoop: false,
                    loopStart: loopStartVal,
                    staffIndex,
                    transportTime: noteTime,
                  });
                }

                // Single-note tremolo retriggers (approximation).
                const tremoloSlashes = note.tremolo ?? 0;
                // Single-note tremolo subdivision mapping:
                // 1 slash = 8ths, 2 = 16ths, 3 = 32nds, 4 = 64ths.
                const tremoloStepBeats = tremoloSlashes > 0 ? 1 / Math.pow(2, tremoloSlashes) : 0;
                const tremoloStepSec = tremoloStepBeats > 0 ? beatsToSeconds(tremoloStepBeats, currentTempo) : 0;
                const canTremoloRetrigger = tremoloSlashes > 0 && tremoloStepSec > 0.025 && playDuration >= tremoloStepSec * 1.25;

                if (canTremoloRetrigger) {
                  const hitDur = Math.max(0.03, Math.min(tremoloStepSec * 0.75, 0.12));
                  let t = 0;
                  let hits = 0;
                  while (t < playDuration - 0.005 && hits < 64) {
                    this.pendingAudio.push({
                      type: sfPlayer ? 'sf' : 'fallback',
                      midi,
                      freq,
                      startTime: renderedStartTime + t,
                      playDuration: Math.min(hitDur, playDuration - t),
                      gain: Math.max(0.04, noteGain * 0.9),
                      velocity: Math.max(0.05, velocity * 0.9),
                      instrument: effectiveInstrument,
                      shouldLoop: false,
                      loopStart: loopStartVal,
                      staffIndex,
                      transportTime: noteTime + t,
                    });
                    t += tremoloStepSec;
                    hits++;
                  }
                } else {
                  this.pendingAudio.push({
                    type: sfPlayer ? 'sf' : 'fallback',
                    midi,
                    freq,
                    startTime: renderedStartTime,
                    playDuration,
                    gain: noteGain,
                    velocity,
                    instrument: effectiveInstrument,
                    shouldLoop,
                    loopStart: loopStartVal,
                    staffIndex,
                    transportTime: noteTime,
                  });
                }

                if (!sfPlayer) hasFallbackNotes = true;
              }

              if (note.ottavaEnd) {
                activeOttavaShift = 0;
              }
              if (note.pedalEnd) {
                pedalDown = false;
              }
            }

            measureTime += beats;
          });

          activeOttavaByVoice.set(voiceIndex, activeOttavaShift);
          activePedalByVoice.set(voiceIndex, pedalDown);
        });

        // ── Play chord symbols if enabled ──────────────────────────────────────
        if (!isGregorianChant && playChords && measure.chords && measure.chords.length > 0) {
          measure.chords.forEach((chordSymbol) => {
            try {
              // Parse chord symbol using Tonal.js
              const chord = Chord.get(chordSymbol.symbol);
              if (chord && chord.notes && chord.notes.length > 0) {
                // Calculate start time for this chord (within the measure)
                const chordBeatTime = beatsToSeconds(chordSymbol.beat, effectiveTempo);
                const chordStartTime = currentMeasureStart + chordBeatTime;
                
                // Play chord notes in a middle octave (octave 4)
                const chordNotes = chord.notes.map((noteName: string) => {
                  // Convert note name (e.g., "C", "Eb") to pitch (e.g., "C4", "Eb4")
                  const pitch = `${noteName}4`;
                  return pitchToMidi(pitch);
                }).filter((midi: number) => midi > 0);

                if (chordNotes.length > 0) {
                  // Play chord for 1 beat duration
                  const chordDuration = beatsToSeconds(1, effectiveTempo);
                  
                  chordNotes.forEach((midi: number) => {
                    const freq = 440 * Math.pow(2, (midi - 69) / 12);
                    const shouldLoop = !LOOP_DISABLED.has(effectiveInstrument);
                    const loopStartVal = LOOP_START[effectiveInstrument] ?? 0.08;
                    
                    this.pendingAudio.push({
                      type: sfPlayer ? 'sf' : 'fallback',
                      midi,
                      freq,
                      startTime: chordStartTime,
                      playDuration: chordDuration,
                      gain: gain * 0.7, // Slightly quieter for chords
                      velocity: Math.max(0.08, Math.min(1, gain * 0.7)),
                      instrument: effectiveInstrument,
                      shouldLoop,
                      loopStart: loopStartVal,
                      staffIndex,
                      transportTime: chordSymbol.beat,
                    });

                    if (!sfPlayer) hasFallbackNotes = true;
                  });
                }
              }
            } catch (err) {
              // Ignore invalid chord symbols
              console.debug(`[ToneScheduler] Failed to parse chord: ${chordSymbol.symbol}`, err);
            }
          });
        }

        // Advance to next measure start time (pickup measure may be shorter)
        currentMeasureStart += measureDurationSec;
      }
    });

    // Sort pending audio by start time for efficient JIT draining
    this.pendingAudio.sort((a, b) => a.startTime - b.startTime);
    this.pendingAudioCursor = 0;
    this.pendingClicks.sort((a, b) => a.startTime - b.startTime);
    this.pendingClickCursor = 0;

    // Start Tone Transport only if fallback synths are used
    if (hasFallbackNotes) {
      Tone.getTransport().start();
    }

    // If a constrained range ended up scheduling no notes, retry full range once.
    if (this.scheduledNotes.length === 0 && (normalizedStart !== null || normalizedEnd !== null)) {
      console.warn('[Playback] Selected range produced no playable notes. Retrying full range.');
      await this.playComposition(composition, {
        playbackTempo,
        startMeasure: null,
        endMeasure: null,
        playChords,
        expressivePlayback,
        metronomeEnabled,
        countInEnabled,
        countInBars,
      });
      return;
    }

    // Calculate the time when all notes will have finished
    this.playbackEndTime = this.scheduledNotes.length > 0
      ? Math.max(...this.scheduledNotes.map((n) => n.endTime))
      : now;

    // Materialize the first batch of audio nodes before starting highlights
    this.drainPendingAudio();

    this.isPlaying = true;
    this.startHighlightUpdates();
  }

  // ── JIT audio node creation ───────────────────────────────────────────────
  /**
   * Materialize pending audio events whose startTime falls within
   * the lookahead window (currentTime + LOOKAHEAD_SEC).
   * Called once immediately when playback starts and then every animation frame.
   */
  private drainPendingAudio(): void {
    const ac = this.getAC();
    const horizon = ac.currentTime + ToneScheduler.LOOKAHEAD_SEC;

    while (this.pendingAudioCursor < this.pendingAudio.length) {
      const ev = this.pendingAudio[this.pendingAudioCursor];
      if (ev.startTime > horizon) break; // remaining events are later → stop

      this.pendingAudioCursor++;

      if (ev.type === 'sf') {
        const sfPlayer = this.sfPlayers.get(ev.instrument) ?? null;
        if (!sfPlayer) continue;

        // Long sustains on loop-enabled instruments: prefer manual crossfade
        let scheduled = false;
        if (ev.shouldLoop && ev.playDuration >= 1.6) {
          scheduled = this.scheduleCrossfadeSustain(
            sfPlayer, ev.midi, ev.startTime, ev.playDuration, ev.gain, ev.loopStart
          );
        }

        if (!scheduled) {
          const loopOpts = ev.shouldLoop ? { loop: true, loopStart: ev.loopStart } : {};
          sfPlayer.start(
            String(ev.midi) as unknown as Parameters<SoundfontPlayer['start']>[0],
            ev.startTime,
            { duration: ev.playDuration, gain: ev.gain, ...loopOpts } as any
          );
        }
      } else {
        // Fallback Tone.js synth
        const fallback = this.staffFallbackSynths.get(ev.staffIndex);
        if (fallback) {
          Tone.getTransport().schedule((audioTime) => {
            fallback.triggerAttackRelease(ev.freq, ev.playDuration, audioTime, ev.velocity);
          }, ev.transportTime);
        }
      }
    }

    while (this.pendingClickCursor < this.pendingClicks.length) {
      const click = this.pendingClicks[this.pendingClickCursor];
      if (click.startTime > horizon) break;
      this.pendingClickCursor++;
      this.getMetronomeSynth().triggerAttackRelease(
        click.frequency,
        click.duration,
        click.startTime,
        click.velocity
      );
    }
  }

  // ── Highlight updates ──────────────────────────────────────────────────────
  private startHighlightUpdates(): void {
    const ac = this.getAC();
    
    const updateHighlights = () => {
      if (!this.isPlaying) {
        this.highlightAnimationFrame = null;
        usePlaybackStore.getState().clearPlayingNotes();
        return;
      }

      // Materialize upcoming audio nodes (JIT scheduling)
      this.drainPendingAudio();

      const currentTime = ac.currentTime;

      // Auto-stop when all notes have finished playing (add 0.2s buffer for last note release)
      if (this.scheduledNotes.length > 0 && currentTime > this.playbackEndTime + 0.2) {
        this.stop();
        if (this.onPlaybackComplete) {
          this.onPlaybackComplete();
        } else {
          usePlaybackStore.getState().setState('stopped');
        }
        return;
      }

      const playing: PlayingNoteRef[] = [];

      for (const scheduled of this.scheduledNotes) {
        // Note is playing if current time is between start and end
        if (currentTime >= scheduled.startTime && currentTime < scheduled.endTime) {
          playing.push(scheduled.ref);
        }
      }

      usePlaybackStore.getState().setPlayingNotes(playing);
      this.highlightAnimationFrame = requestAnimationFrame(updateHighlights);
    };

    this.highlightAnimationFrame = requestAnimationFrame(updateHighlights);
  }

  private stopHighlightUpdates(): void {
    if (this.highlightAnimationFrame !== null) {
      cancelAnimationFrame(this.highlightAnimationFrame);
      this.highlightAnimationFrame = null;
    }
    usePlaybackStore.getState().clearPlayingNotes();
  }

  pause(): void {
    // Suspend the AudioContext — this freezes the entire audio timeline,
    // including all pre-scheduled soundfont notes, so resume can continue exactly where it left off.
    const ac = this.getAC();
    ac.suspend().catch(() => {});
    // Also pause Tone Transport for any fallback synth notes
    Tone.getTransport().pause();
    this.isPlaying = false;
    // Stop the highlight animation loop (highlights stay visible while paused)
    if (this.highlightAnimationFrame !== null) {
      cancelAnimationFrame(this.highlightAnimationFrame);
      this.highlightAnimationFrame = null;
    }
  }

  resume(): void {
    // Resume the AudioContext — all pre-scheduled notes continue from where they stopped
    const ac = this.getAC();
    ac.resume().catch(() => {});
    Tone.getTransport().start();
    this.isPlaying = true;
    // Restart the highlight animation loop
    this.startHighlightUpdates();
  }

  stop(): void {
    this.isPlaying = false;
    this.stopHighlightUpdates();
    // Clear JIT pending queue so no more audio nodes will be created
    this.pendingAudio = [];
    this.pendingAudioCursor = 0;
    this.pendingClicks = [];
    this.pendingClickCursor = 0;
    // If the AudioContext was suspended (paused), resume it first so stop commands go through
    const ac = this.getAC();
    if (ac.state === 'suspended') {
      ac.resume().catch(() => {});
    }
    this.sfPlayers.forEach((p) => { try { p.stop(); } catch {} });
    this.fallbackSynths.forEach((s) => { try { s.releaseAll(); } catch {} });
    // Stop any manually-scheduled crossfade sources
    this.crossfadeNodes.forEach((n) => { try { n.stop(); } catch {} });
    this.crossfadeNodes = [];
    // Clean up per-staff synths (they'll be recreated on next play)
    this.staffFallbackSynths.forEach((s) => { try { s.dispose(); } catch {} });
    this.staffFallbackSynths.clear();
    Tone.getTransport().stop();
    Tone.getTransport().cancel();
    this.scheduledNotes = [];
    this.playbackEndTime = 0;
  }

  dispose(): void {
    this.stop();
    this.sfPlayers.clear();
    this.fallbackSynths.forEach((s) => { try { s.dispose(); } catch {} });
    this.fallbackSynths.clear();
    if (this.metronomeSynth) {
      try { this.metronomeSynth.dispose(); } catch {}
      this.metronomeSynth = null;
    }
  }

  /**
   * Preload only the piano soundfont.
   * Safe to call right after login/dashboard mount.
   * Important: preloading should NOT depend on a user gesture. We still attempt
   * to unlock/resume audio context, but proceed with network/decode prefetch even
   * when unlock fails so assets are cached before editing/playback starts.
   */
  async preloadPiano(): Promise<void> {
    try {
      await this.loadSoundfont('piano');
    } catch (err) {
      console.debug('[Soundfont] Piano preload failed:', err);
    }
  }

  /**
   * Preload ALL instruments in SOUNDFONT_MAP.
   * Piano is loaded first (highest priority), then every other instrument in
   * parallel so loading one slow instrument doesn't block the rest.
   *
   * After a successful full preload the current timestamp is written to
   * localStorage so future app starts know the browser HTTP cache is warm
   * and can kick off an eager background preload immediately.
   */
  async preloadAllSoundfonts(): Promise<void> {
    if (this.preloadAllPromise) return this.preloadAllPromise;

    this.preloadAllPromise = (async () => {
      // ── 1. Piano first ─────────────────────────────────────────────────────
      if (!this.sfPlayers.has('piano')) {
        try { await this.loadSoundfont('piano'); } catch {}
      }

      // ── 2. Every other instrument in parallel ──────────────────────────────
      const remaining = Object.keys(SOUNDFONT_MAP).filter((n) => n !== 'piano');
      await Promise.allSettled(
        remaining.map(async (name) => {
          if (this.sfPlayers.has(name)) return;
          try { await this.loadSoundfont(name); } catch {}
        })
      );

      // ── 3. Mark browser cache as warm for subsequent sessions ─────────────
      markSoundfontCacheWarm();
    })().finally(() => {
      this.preloadAllPromise = null;
    });

    return this.preloadAllPromise;
  }
}

// ── Soundfont HTTP-cache warmth tracking ──────────────────────────────────────
// soundfont-player fetches MP3 files from a CDN. Those responses are stored in
// the browser HTTP cache (the CDN uses max-age=1 year). Writing a timestamp to
// localStorage lets us know on subsequent app opens that the HTTP cache is very
// likely still hot, so we can start eager background preloading immediately
// rather than waiting for the user to navigate to a composition.

const SOUNDFONT_CACHE_LS_KEY  = 'stavium_soundfonts_cached_v1';
const SOUNDFONT_CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days in ms

/** Returns true if all soundfonts were preloaded in the last 30 days. */
export function isSoundfontCacheWarm(): boolean {
  try {
    const stored = localStorage.getItem(SOUNDFONT_CACHE_LS_KEY);
    if (!stored) return false;
    return Date.now() - new Date(stored).getTime() < SOUNDFONT_CACHE_MAX_AGE;
  } catch {
    return false;
  }
}

function markSoundfontCacheWarm(): void {
  try {
    localStorage.setItem(SOUNDFONT_CACHE_LS_KEY, new Date().toISOString());
  } catch { /* localStorage unavailable (private browsing etc.) — just skip */ }
}

// ── Shared singleton ──────────────────────────────────────────────────────────
// A single long-lived ToneScheduler instance shared across the app.
// Using a singleton means soundfonts loaded on the Dashboard are still
// cached in sfPlayers when PlaybackControls needs them in the editor.
export const sharedScheduler = new ToneScheduler();
