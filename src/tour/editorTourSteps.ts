/**
 * Guided editor tour — step copy, spotlight targets, and hands-on tasks.
 *
 * - `waitFor`: omit or `'manual'` = user uses Next. Other values require that action before Continue.
 * - `taskHint`: short line shown under the body during hands-on steps.
 * - Match `targetId` to `data-tour-id` on the editor (see EditorPage and toolbars).
 */
export const EDITOR_TOUR_ROUTE = '/editor/tour' as const;

export type EditorTourMobileTab = 'notes' | 'expression' | 'structure' | 'settings';

/** How the user unlocks Continue on hands-on steps */
export type TourWaitFor =
  | 'manual'
  | 'select-quarter-duration'
  | 'place-note-measure-2'
  | 'change-selected-note-pitch'
  | 'playback-started';

/** Tour card position for steps where the default placement would cover the score */
export type TourTooltipDock = 'auto' | 'top';

export type EditorTourStep = {
  id: string;
  title: string;
  body: string;
  /** Extra line while waiting on a hands-on task */
  taskHint?: string;
  /** Matches `[data-tour-id="…"]` — omit for centered-only steps */
  targetId?: string;
  expandSections?: string[];
  /** Section ids (`notes` | `structure` | `score` | `expression`) to collapse (maximize score area) */
  collapseSections?: string[];
  /** On mobile, hide the bottom tool drawer so the staff stays visible */
  collapseMobileToolbar?: boolean;
  expandMobileTab?: EditorTourMobileTab;
  /** `top` = dock card under tour banner so it does not block score click/drag */
  tooltipDock?: TourTooltipDock;
  /** Defaults to read-only (Next anytime). Set for try-it-yourself steps. */
  waitFor?: TourWaitFor;
};

export const EDITOR_TOUR_STEPS: EditorTourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to the hands-on tour',
    body:
      'You will try real clicks and drags on a sample score in your browser only. Nothing is saved to your account. ' +
      'When a step says Try it, complete the action to unlock Continue. On small screens, use the bottom tabs for the same tool rows.',
    waitFor: 'manual',
  },
  {
    id: 'banner',
    title: 'Tour mode',
    body: 'Save and cloud sync stay off so your real library is never touched.',
    targetId: 'tour-banner',
    waitFor: 'manual',
  },
  {
    id: 'notes-read',
    title: 'Notes & Rests',
    body:
      'Here you pick note lengths, voice lanes (V1–V4), rests, tuplets, and Undo/Redo. Next you will select a quarter note yourself.',
    targetId: 'tour-toolbar-notes',
    expandSections: ['notes'],
    expandMobileTab: 'notes',
    waitFor: 'manual',
  },
  {
    id: 'hands-on-quarter',
    title: 'Try it: quarter note',
    body:
      'Musical typing starts by choosing how long each note lasts. Click the quarter (♩) note icon so straight quarter notes are active.',
    taskHint: 'Tip: the quarter button highlights when it is selected. Then Continue unlocks.',
    targetId: 'tour-note-quarter',
    expandSections: ['notes'],
    expandMobileTab: 'notes',
    waitFor: 'select-quarter-duration',
  },
  {
    id: 'hands-on-place-m2',
    title: 'Try it: add a note',
    body:
      'With quarter selected, click an empty spot in the second measure on the top staff (Soprano) to add one new note.',
    taskHint: 'Click inside measure 2 on the upper staff. Your new note appears and Continue unlocks.',
    targetId: 'tour-score-canvas',
    collapseSections: ['notes', 'structure', 'score', 'expression'],
    collapseMobileToolbar: true,
    tooltipDock: 'top',
    waitFor: 'place-note-measure-2',
  },
  {
    id: 'hands-on-drag-pitch',
    title: 'Try it: drag pitch',
    body:
      'Notes are edited directly on the staff. Drag the note you just placed straight up or down to change its pitch.',
    taskHint: 'Drag until the pitch changes (letter name moves). Continue unlocks after the pitch updates.',
    targetId: 'tour-score-canvas',
    collapseSections: ['notes', 'structure', 'score', 'expression'],
    collapseMobileToolbar: true,
    tooltipDock: 'top',
    waitFor: 'change-selected-note-pitch',
  },
  {
    id: 'help',
    title: 'Help',
    body: 'Documentation, FAQs, and the AI assistant live here when you need them later.',
    targetId: 'tour-header-help',
    expandSections: ['notes', 'structure', 'score', 'expression'],
    waitFor: 'manual',
  },
  {
    id: 'score-info',
    title: 'Score Info',
    body: 'Composer, arranger, and sharing. Saving sharing to the cloud needs a real saved score.',
    targetId: 'tour-header-score-info',
    waitFor: 'manual',
  },
  {
    id: 'title',
    title: 'Title',
    body: 'Rename your piece in a real session. Here the title stays in this tab only.',
    targetId: 'tour-header-title',
    waitFor: 'manual',
  },
  {
    id: 'save',
    title: 'Save',
    body: 'In real editing, Save writes to your library. In tour mode it stays off.',
    targetId: 'tour-header-save',
    waitFor: 'manual',
  },
  {
    id: 'structure',
    title: 'Structure',
    body: 'Staves, measures, clefs, instruments, measure properties, AI tools, parts, export, and version history.',
    targetId: 'tour-toolbar-structure',
    expandSections: ['structure'],
    expandMobileTab: 'structure',
    waitFor: 'manual',
  },
  {
    id: 'score-settings',
    title: 'Score Settings',
    body: 'Tempo, time and key context, per-staff volume, and toolbar density.',
    targetId: 'tour-toolbar-score',
    expandSections: ['score'],
    expandMobileTab: 'settings',
    waitFor: 'manual',
  },
  {
    id: 'expression-read',
    title: 'Note Expression',
    body:
      'With a note selected, add accidentals, ties, dynamics, lyrics, chords, and more. You already changed pitch; these tools refine the sound and look.',
    targetId: 'tour-toolbar-expression',
    expandSections: ['expression'],
    expandMobileTab: 'expression',
    waitFor: 'manual',
  },
  {
    id: 'canvas-read',
    title: 'Score canvas',
    body: 'Pan and zoom as usual; placement and edits stay on the page for this demo.',
    targetId: 'tour-score-canvas',
    waitFor: 'manual',
  },
  {
    id: 'playback-read',
    title: 'Playback',
    body: 'Hear your work with the transport controls, range, loop, tempo, and MIDI input below.',
    targetId: 'tour-playback',
    waitFor: 'manual',
  },
  {
    id: 'hands-on-play',
    title: 'Try it: play',
    body: 'Press Play once to hear the sample score. Browsers may need a click before audio starts.',
    taskHint: 'When playback is running, Continue unlocks.',
    targetId: 'tour-play-button',
    waitFor: 'playback-started',
  },
  {
    id: 'done',
    title: 'You are set',
    body:
      'Start a real score from the Dashboard with New Composition. To extend this tour when the app changes, edit src/tour/editorTourSteps.ts and data-tour-id anchors.',
    waitFor: 'manual',
  },
];
