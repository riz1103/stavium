export type Clef = 'treble' | 'bass' | 'alto' | 'tenor';

export type NoteDuration = 
  | 'whole' 
  | 'half' 
  | 'quarter' 
  | 'eighth' 
  | 'sixteenth' 
  | 'thirty-second'
  | 'dotted-whole'
  | 'dotted-half'
  | 'dotted-quarter'
  | 'dotted-eighth'
  | 'dotted-sixteenth';

export type Accidental = 'sharp' | 'flat' | 'natural' | null;

export type Pitch = string; // e.g., "C4", "E#5", "Bb3"

export interface Note {
  pitch: Pitch;
  duration: NoteDuration;
  accidental?: Accidental;
  tie?: boolean;
  slur?: boolean;
  articulation?: string;
  dynamic?: string;
}

export interface Rest {
  duration: NoteDuration;
}

export type MusicElement = Note | Rest;

export interface Voice {
  notes: MusicElement[];
}

export interface Measure {
  number: number;
  voices: Voice[];
  /**
   * Mid-composition changes applied AT THE START of this measure.
   * Each field is optional; if absent the previous (or global) value stays in effect.
   */
  timeSignature?: string; // e.g. "3/4" – changes time sig from this measure onward
  keySignature?: string;  // e.g. "G" – changes key sig from this measure onward
  tempo?: number;         // BPM – changes tempo from this measure onward
  clef?: Clef;            // clef change for this staff from this measure onward
}

export interface Staff {
  clef: Clef;
  instrument: string;
  measures: Measure[];
  name?: string; // Optional custom name for the staff
}

export type PrivacyLevel = 'private' | 'shared' | 'public';

export interface Composition {
  id?: string;
  title: string;
  tempo: number;
  timeSignature: string; // e.g., "4/4", "3/4"
  keySignature: string; // e.g., "C", "G", "F"
  staves: Staff[];
  /** When true, the first measure is an anacrusis (pickup / upbeat measure). */
  anacrusis?: boolean;
  /** How many beats the anacrusis measure contains (1 … beatsPerMeasure−1). Default 1. */
  pickupBeats?: number;
  /** When true, measure numbers are displayed above the first staff. Default true. */
  showMeasureNumbers?: boolean;
  /** Optional author/composer name */
  author?: string;
  /** Optional arranger name */
  arrangedBy?: string;
  /** Privacy/sharing level: 'private' (default), 'shared' (with specific emails), or 'public' */
  privacy?: PrivacyLevel;
  /** List of email addresses to share with (only used when privacy is 'shared') */
  sharedEmails?: string[];
  /**
   * What shared/public viewers are allowed to do.
   * 'view'  → read-only access (default)
   * 'edit'  → full editing access
   * Only applies when privacy is 'shared' or 'public'.
   */
  sharePermission?: 'view' | 'edit';
  /** Automatically set when composition is created */
  createdAt?: Date;
  /** Automatically updated when composition is modified */
  updatedAt?: Date;
  userId?: string;
  /** UID of the last user who saved the composition (may differ from userId for public/shared edits) */
  modifiedBy?: string;
}

export type Instrument = 
  | 'piano'
  | 'organ'
  | 'guitar'
  | 'violin'
  | 'strings'
  | 'choir'
  | 'brass'
  | 'synth'
  | 'flute';
