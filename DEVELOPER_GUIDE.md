# Stavium Developer Guide

## Architecture Overview

Stavium follows a layered architecture:

```
UI Layer (React Components)
    ↓
State Management (Zustand Stores)
    ↓
Music Engine (VexFlow Renderer, Tone.js Playback)
    ↓
Services (Firebase)
```

## Key Components

### State Management

**Stores** (`src/app/store/`):
- `scoreStore.ts`: Manages composition data, note placement, measure management
- `playbackStore.ts`: Tracks playback state (playing, paused, stopped)
- `userStore.ts`: Handles user authentication state

### Music Rendering

**VexFlow Renderer** (`src/music/renderer/vexflowRenderer.ts`):
- Renders musical notation to SVG
- Handles staves, notes, clefs, time signatures, key signatures
- Converts our internal music data structure to VexFlow format

### Playback Engine

**Tone.js Scheduler** (`src/music/playback/toneScheduler.ts`):
- Converts composition data to audio events
- Schedules note playback with accurate timing
- Handles tempo and multi-voice playback

**Instrument Manager** (`src/music/playback/instrumentManager.ts`):
- Loads instruments using soundfont-player
- Falls back to Tone.js synthesizers if needed
- Manages instrument switching

### Music Theory

**Chord Detector** (`src/music/theory/chordDetector.ts`):
- Uses Tonal.js to detect chords from notes
- Analyzes harmony in compositions
- Provides chord progression analysis

## Data Structures

### Composition Structure

```typescript
{
  title: string;
  tempo: number;
  timeSignature: string; // "4/4", "3/4", etc.
  keySignature: string; // "C", "G", "F", etc.
  staves: Staff[];
}

Staff {
  clef: 'treble' | 'bass';
  instrument: string;
  measures: Measure[];
}

Measure {
  number: number;
  voices: Voice[];
}

Voice {
  notes: (Note | Rest)[];
}

Note {
  pitch: string; // "C4", "E#5", etc.
  duration: NoteDuration;
  accidental?: 'sharp' | 'flat' | 'natural';
}
```

## Adding New Features

### Adding a New Instrument

1. Add the instrument name to `Instrument` type in `src/types/music.ts`
2. Add the soundfont mapping in `src/music/playback/instrumentManager.ts`
3. Add it to the instrument selector in `src/components/toolbar/InstrumentSelector.tsx`

### Adding a New Note Duration

1. Add to `NoteDuration` type in `src/types/music.ts`
2. Add mapping in `src/utils/durationUtils.ts`
3. Add button in `src/components/toolbar/NoteToolbar.tsx`

### Adding a New Clef

1. Add to `Clef` type in `src/types/music.ts`
2. Update VexFlow renderer to handle the new clef
3. Add option in `src/components/toolbar/ClefSelector.tsx`

## Music Theory Utilities

### Pitch Conversion

- `pitchToMidi(pitch)`: Converts pitch string to MIDI note number
- `midiToPitch(midi)`: Converts MIDI note to pitch string
- `pitchToFrequency(pitch)`: Gets frequency in Hz
- `pitchToStaffPosition(pitch, clef)`: Gets staff line/space position

### Duration Conversion

- `durationToBeats(duration)`: Converts duration to beats
- `beatsToSeconds(beats, tempo)`: Converts beats to seconds
- `durationToVexFlow(duration)`: Gets VexFlow duration string
- `durationToTone(duration, tempo)`: Gets Tone.js duration string

## Firebase Integration

### Authentication

- `signInWithGoogle()`: Signs in with Google SSO
- `logout()`: Signs out the user
- `onAuthChange(callback)`: Listens for auth state changes

### Composition Storage

- `saveComposition(composition, userId)`: Saves/updates composition
- `getComposition(compositionId)`: Loads a composition
- `getUserCompositions(userId)`: Gets all user's compositions
- `deleteComposition(compositionId)`: Deletes a composition

## Performance Considerations

### Virtual Rendering

For large scores, consider:
- Only rendering visible measures
- Using `react-window` for measure virtualization
- Measure-level re-rendering instead of full score re-render

### Playback Optimization

- Pre-load instruments before playback
- Use Web Workers for heavy computations (AI features, scanning)
- Debounce tempo changes

## Testing

### Unit Tests

Create tests for:
- Music utilities (note conversion, duration calculations)
- Chord detection
- State management actions

### Integration Tests

Test:
- Firebase operations
- Playback scheduling
- Note placement

## Future Enhancements

### Sheet Music Scanning

1. Create `src/ai/sheetMusicScanner.ts`
2. Use OpenCV.js or TensorFlow.js for image processing
3. Integrate OMR library (Audiveris, OpenOMR)
4. Convert detected symbols to composition data

### AI Features

1. **Humming Detection**:
   - Use Web Audio API for microphone input
   - Implement pitch detection (pitchfinder, ml5.js)
   - Convert detected pitches to notes

2. **Automatic Harmonization**:
   - Use Tonal.js for chord progression generation
   - Implement voice leading rules
   - Generate bass lines and harmony voices

3. **Chord Detection**:
   - Already implemented in `chordDetector.ts`
   - Can be enhanced with real-time detection
   - Add chord suggestions UI

## Code Style

- Use TypeScript for type safety
- Follow React hooks best practices
- Use functional components
- Keep components small and focused
- Use Zustand for state management
- Tailwind CSS for styling

## Common Patterns

### Adding a New Page

1. Create component in `src/pages/`
2. Add route in `src/App.tsx`
3. Add navigation link if needed

### Adding a New Toolbar Component

1. Create component in `src/components/toolbar/`
2. Import in `src/pages/EditorPage.tsx`
3. Add to toolbar section

### Modifying Music Data

Always use Zustand store actions:
- Don't mutate state directly
- Use store actions (addNote, updateNote, etc.)
- Store automatically triggers re-renders
