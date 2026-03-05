import * as Tone from 'tone';
import Soundfont from 'soundfont-player';
import { Composition, Note } from '../../types/music';
import { durationToBeats, beatsToSeconds } from '../../utils/durationUtils';
import { pitchToMidi, applyKeySignature, applyKeySignatureAndMeasureAccidentals } from '../../utils/noteUtils';
import { usePlaybackStore, PlayingNoteRef } from '../../app/store/playbackStore';

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

export class ToneScheduler {
  /** Cache of loaded soundfont players, keyed by instrument name */
  private sfPlayers: Map<string, SoundfontPlayer> = new Map();
  /** Fallback Tone.js synths, keyed by instrument name (for preview) */
  private fallbackSynths: Map<string, Tone.PolySynth> = new Map();
  /** Per-staff fallback synths (for playback with individual volume control) */
  private staffFallbackSynths: Map<number, Tone.PolySynth> = new Map();
  private isPlaying = false;
  /** All scheduled notes with their timing info */
  private scheduledNotes: ScheduledNote[] = [];
  /** Animation frame ID for highlighting updates */
  private highlightAnimationFrame: number | null = null;
  /** AudioContext start time (when playback began) */
  private playbackStartTime: number = 0;
  /** The AudioContext time when all notes will have finished */
  private playbackEndTime: number = 0;

  // ── AudioContext ──────────────────────────────────────────────────────────
  /** Share Tone.js's underlying AudioContext so timing is in sync */
  private getAC(): AudioContext {
    return Tone.getContext().rawContext as AudioContext;
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
      console.log(`[Soundfont] Loaded: ${name} (${sfName})`);
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
    playbackTempo?: number,
    startMeasure?: number | null,
    endMeasure?: number | null
  ): Promise<void> {
    // Unlock AudioContext — must be called from a user gesture
    await Tone.start();

    this.stop();

    const ac = this.getAC();
    if (ac.state === 'suspended') await ac.resume();

    // Clear previous scheduled notes
    this.scheduledNotes = [];
    this.playbackStartTime = ac.currentTime;

    // Get playback store to check for playback instruments
    const playbackStore = usePlaybackStore.getState();
    
    // Use playback tempo if provided, otherwise use composition tempo
    const effectiveTempo = playbackTempo ?? composition.tempo;

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

    const now = ac.currentTime + 0.1; // small lookahead so first note isn't clipped
    let hasFallbackNotes = false;

    // Anacrusis: the first measure has fewer beats than a full measure
    const pickupBeats = composition.anacrusis ? (composition.pickupBeats ?? 1)
      : Number(composition.timeSignature.split('/')[0]);

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

      // Check if this staff is muted or has volume control
      const isMuted = playbackStore.isStaffMuted(staffIndex);
      const volumePercent = playbackStore.getStaffVolume(staffIndex);
      const gain = isMuted ? 0 : volumePercent / 100; // 0-1 for soundfont
      // For Tone.js: volume in dB (100% = 0dB, 50% = -6dB, 0% = -Infinity)
      const volumeDb = isMuted ? -Infinity : (volumePercent === 100 ? 0 : 20 * Math.log10(volumePercent / 100));

      // Set volume on fallback synth if it exists
      if (fallback) {
        fallback.volume.value = volumeDb;
      }

      // Calculate timing offset for measures before startMeasure
      let timingOffset = 0; // in seconds
      if (startMeasure !== null && startMeasure !== undefined && startMeasure > 0) {
        // Calculate total duration of measures before the start measure
        for (let i = 0; i < startMeasure; i++) {
          const measure = staff.measures[i];
          if (!measure) continue;
          const timeSig = effTimeSig(i);
          const tempo = effTempo(i);
          const [beats] = timeSig.split('/').map(Number);
          const anacrusisBeats = (i === 0 && composition.anacrusis) ? (composition.pickupBeats ?? 1) : beats;
          timingOffset += beatsToSeconds(anacrusisBeats, tempo);
        }
      }
      
      let currentMeasureStart = timingOffset; // in seconds
      
      // Determine measure range to play
      const startIdx = startMeasure !== null && startMeasure !== undefined ? startMeasure : 0;
      const endIdx = endMeasure !== null && endMeasure !== undefined ? endMeasure : staff.measures.length - 1;

      staff.measures.forEach((measure, measureIndex) => {
        // Skip measures outside the playback range
        if (measureIndex < startIdx || measureIndex > endIdx) return;
        // Effective values at this measure
        const currentTimeSig = effTimeSig(measureIndex);
        const currentKeySig  = effKeySig(measureIndex);
        const currentTempo   = effTempo(measureIndex);

        const [effBPM] = currentTimeSig.split('/').map(Number);

        // Pickup measure has fewer beats; all others use the effective time signature
        // Only apply anacrusis if we're starting from measure 0
        const thisMeasureBeats =
          (startIdx === 0 && composition.anacrusis && measureIndex === 0) ? pickupBeats : effBPM;
        const measureDurationSec = beatsToSeconds(thisMeasureBeats, currentTempo);

        // Each measure starts at its calculated time
        const measureStartTime = currentMeasureStart;
        let measureTime = 0; // Time within this measure (in beats)

        measure.voices.forEach((voice, voiceIndex) => {
          let tiedNotesToSkip = 0; // Count of tied notes to skip
          
          voice.notes.forEach((element, noteIndex) => {
            // Skip this note if it's part of a tie chain (already handled)
            if (tiedNotesToSkip > 0) {
              tiedNotesToSkip--;
              const beats = durationToBeats(element.duration);
              measureTime += beats;
              return;
            }
            
            const beats = durationToBeats(element.duration);
            const durationSec = beatsToSeconds(beats, currentTempo);

            // Check if this note fits in the current measure
            if (measureTime + beats > thisMeasureBeats) {
              console.warn(
                `Note overflows measure ${measureIndex + 1} (${measureTime + beats} beats > ${thisMeasureBeats} beats)`
              );
              const remainingBeats = thisMeasureBeats - measureTime;
              if (remainingBeats <= 0) return;
            }

            const noteTime = measureStartTime + beatsToSeconds(measureTime, currentTempo);

            if ('pitch' in element) {
              const note = element as Note;
              
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
              let totalDurationSec = durationSec;
              if (isTied) {
                let tiedIndex = noteIndex + 1;
                while (tiedIndex < voice.notes.length) {
                  const tiedEl = voice.notes[tiedIndex];
                  if ('pitch' in tiedEl && (tiedEl as Note).pitch === note.pitch) {
                    const tiedBeats = durationToBeats(tiedEl.duration);
                    totalDurationSec += beatsToSeconds(tiedBeats, currentTempo);
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
              const midi = pitchToMidi(actualPitch);
              
              const startTime = now + noteTime;
              const endTime = startTime + totalDurationSec;
              
              // Track this note for highlighting
              const noteRef: PlayingNoteRef = {
                staffIndex,
                measureIndex,
                voiceIndex,
                noteIndex,
              };
              this.scheduledNotes.push({ ref: noteRef, startTime, endTime });
              
              // For slurs: play with slight overlap (legato) - extend duration slightly
              const playDuration = isSlurred
                ? totalDurationSec * 1.05 // 5% extension for legato
                : totalDurationSec;
              
              // Skip playback if muted
              if (!isMuted) {
                if (sfPlayer) {
                  sfPlayer.start(
                    String(midi) as unknown as Parameters<SoundfontPlayer['start']>[0],
                    startTime,
                    { duration: playDuration, gain } // Apply gain (0-1) for volume control
                  );
                } else if (fallback) {
                  const freq = 440 * Math.pow(2, (midi - 69) / 12);
                  Tone.getTransport().schedule((audioTime) => {
                    fallback.triggerAttackRelease(freq, playDuration, audioTime);
                  }, beatsToSeconds(measureTime, currentTempo));
                  hasFallbackNotes = true;
                }
              }
            }

            measureTime += beats;
          });
        });

        // Advance to next measure start time (pickup measure may be shorter)
        currentMeasureStart += measureDurationSec;
      });
    });

    // Start Tone Transport only if fallback synths are used
    if (hasFallbackNotes) {
      Tone.getTransport().start();
    }

    // Calculate the time when all notes will have finished
    this.playbackEndTime = this.scheduledNotes.length > 0
      ? Math.max(...this.scheduledNotes.map((n) => n.endTime))
      : now;

    this.isPlaying = true;
    this.startHighlightUpdates();
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

      const currentTime = ac.currentTime;

      // Auto-stop when all notes have finished playing (add 0.2s buffer for last note release)
      if (this.scheduledNotes.length > 0 && currentTime > this.playbackEndTime + 0.2) {
        this.stop();
        usePlaybackStore.getState().setState('stopped');
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
    // If the AudioContext was suspended (paused), resume it first so stop commands go through
    const ac = this.getAC();
    if (ac.state === 'suspended') {
      ac.resume().catch(() => {});
    }
    this.sfPlayers.forEach((p) => { try { p.stop(); } catch {} });
    this.fallbackSynths.forEach((s) => { try { s.releaseAll(); } catch {} });
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
  }
}
