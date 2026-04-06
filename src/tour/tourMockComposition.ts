import type { Composition, MusicElement } from '../types/music';

const emptyVoiceRow = () => ({ notes: [] as MusicElement[] });

/**
 * Demo score for /editor/tour only. No `id` — nothing is persisted to Firestore.
 * Keep this structurally valid for the editor renderer and playback.
 */
export function getTourMockComposition(): Composition {
  return {
    title: 'Guided tour (demo score)',
    tempo: 96,
    timeSignature: '4/4',
    keySignature: 'C',
    notationSystem: 'standard',
    chantSpacingDensity: 'normal',
    chantInterpretation: 'medium',
    engravingMeasureSpacing: 'balanced',
    engravingCollisionCleanup: 'standard',
    engravingSystemBreaks: [],
    engravingPageBreaks: [],
    showMeasureNumbers: true,
    privacy: 'private',
    autoSyncLinkedPartsOnSave: true,
    author: 'Demo',
    arrangedBy: 'Stavium tour',
    staves: [
      {
        name: 'Soprano',
        clef: 'treble',
        instrument: 'choir',
        measures: [
          {
            number: 1,
            voices: [
              {
                notes: [
                  { pitch: 'C4', duration: 'quarter' },
                  { pitch: 'E4', duration: 'quarter' },
                  { pitch: 'G4', duration: 'quarter' },
                  { pitch: 'C5', duration: 'quarter' },
                ],
              },
              emptyVoiceRow(),
              emptyVoiceRow(),
              emptyVoiceRow(),
            ],
          },
          {
            number: 2,
            voices: [emptyVoiceRow(), emptyVoiceRow(), emptyVoiceRow(), emptyVoiceRow()],
          },
        ],
      },
      {
        name: 'Bass',
        clef: 'bass',
        instrument: 'choir',
        measures: [
          {
            number: 1,
            voices: [
              {
                notes: [
                  { pitch: 'C3', duration: 'half' },
                  { pitch: 'G2', duration: 'half' },
                ],
              },
              emptyVoiceRow(),
              emptyVoiceRow(),
              emptyVoiceRow(),
            ],
          },
          {
            number: 2,
            voices: [emptyVoiceRow(), emptyVoiceRow(), emptyVoiceRow(), emptyVoiceRow()],
          },
        ],
      },
    ],
  };
}
