import * as Tone from 'tone';
import { Instrument } from '../../types/music';
import Soundfont from 'soundfont-player';

export class InstrumentManager {
  private instruments: Map<Instrument, AudioBuffer | null> = new Map();
  private audioContext: AudioContext | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }

  async loadInstrument(instrumentName: Instrument): Promise<void> {
    if (this.instruments.has(instrumentName)) {
      return;
    }

    try {
      // Map instrument names to Soundfont instrument names
      const soundfontMap: Record<Instrument, string> = {
        piano: 'acoustic_grand_piano',
        organ: 'church_organ',
        guitar: 'acoustic_guitar_nylon',
        violin: 'violin',
        strings: 'string_ensemble_1',
        choir: 'choir_aahs',
        brass: 'brass_section',
        synth: 'lead_1_square',
        flute: 'flute',
      };

      const soundfontName = soundfontMap[instrumentName] || 'acoustic_grand_piano';

      // Load instrument using soundfont-player
      await Soundfont.instrument(this.audioContext!, soundfontName as any);
      
      // Store a reference (Soundfont-player handles the actual playback)
      this.instruments.set(instrumentName, null);
    } catch (error) {
      console.error(`Error loading instrument ${instrumentName}:`, error);
      // Fallback to Tone.js synth
      this.instruments.set(instrumentName, null);
    }
  }

  async playNote(
    instrumentName: Instrument,
    frequency: number,
    duration: number,
    startTime?: number
  ): Promise<void> {
    try {
      const soundfontMap: Record<Instrument, string> = {
        piano: 'acoustic_grand_piano',
        organ: 'church_organ',
        guitar: 'acoustic_guitar_nylon',
        violin: 'violin',
        strings: 'string_ensemble_1',
        choir: 'choir_aahs',
        brass: 'brass_section',
        synth: 'lead_1_square',
        flute: 'flute',
      };

      const soundfontName = soundfontMap[instrumentName] || 'acoustic_grand_piano';
      const instrument = await Soundfont.instrument(this.audioContext!, soundfontName as any);
      
      // Convert frequency to MIDI note
      const midiNote = Math.round(12 * Math.log2(frequency / 440) + 69);
      
      instrument.start(String(midiNote), startTime || this.audioContext!.currentTime, { duration });
    } catch (error) {
      console.error(`Error playing note on ${instrumentName}:`, error);
      // Fallback to Tone.js
      const synth = new Tone.Synth().toDestination();
      synth.triggerAttackRelease(frequency, duration, startTime);
    }
  }

  getAvailableInstruments(): Instrument[] {
    return [
      'piano',
      'organ',
      'guitar',
      'violin',
      'strings',
      'choir',
      'brass',
      'synth',
      'flute',
    ];
  }
}
