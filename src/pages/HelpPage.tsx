import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserStore } from '../app/store/userStore';
import { sendChatMessage, type ChatMessage } from '../services/helpChatService';

type Tab = 'overview' | 'getting-started' | 'features' | 'faq' | 'chat';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: '📖' },
  { id: 'getting-started', label: 'Getting Started', icon: '🚀' },
  { id: 'features', label: 'Features', icon: '🎼' },
  { id: 'faq', label: 'FAQ', icon: '❓' },
  { id: 'chat', label: 'AI Assistant', icon: '💬' },
];
const HELP_LAST_UPDATED = 'Apr 2026';

const WHATS_NEW_ITEMS = [
  {
    title: 'Engraving Controls (v1)',
    date: 'Apr 2026',
    details:
      'Score Settings now includes engraving controls for Measure Spacing presets (Compact/Balanced/Spacious), manual System/Page break toggles on the selected measure, and Collision cleanup profiles (Off/Standard/Aggressive) to improve dense passage readability in PDF exports.',
  },
  {
    title: 'Linked Part Extraction (v1)',
    date: 'Apr 2026',
    details:
      'From Structure, use Part Extraction to generate one linked score per staff (vocal/instrument parts) from a full score. Saving the full score now auto-syncs existing linked parts, and opening a linked part gives a "Refresh from source" action when you want the latest source edits.',
  },
  {
    title: 'Multi-Voice Editing Lanes (V1-V4)',
    date: 'Apr 2026',
    details:
      'The Notes toolbar now includes explicit voice lanes V1-V4 with per-lane visibility toggles plus voice-level Mute/Solo for playback focus. Each lane remembers its own note/rest rhythm selection, and MIDI/MusicXML imports map into editable lane data so polyphonic passages can be refined directly.',
  },
  {
    title: 'Cleaner Scan Import Voices',
    date: 'Apr 2026',
    details:
      'PDF/image scan imports now hide secondary-lane timing filler rests that were used only for alignment, reducing visual clutter while keeping multi-voice timing intact.',
  },
  {
    title: 'Real-time Co-editing (v1)',
    date: 'Apr 2026',
    details:
      'Shared scores now show live "In score" presence badges, cursor/selection highlights for active collaborators, and conflict-safe per-measure merge behavior so simultaneous edits are less likely to clobber each other.',
  },
  {
    title: 'First Score Checklist + Toolbar Tips',
    date: 'Apr 2026',
    details:
      'New users now see a guided checklist in the editor (place first note, play once, save), contextual tip bubbles in toolbars, account-synced onboarding progress, and a brief completion confirmation once all onboarding steps are done.',
  },
  {
    title: 'Ownership Transfer Requests',
    date: 'Apr 2026',
    details:
      'Score Info now shows composition owner details and supports ownership handoff via request/accept flow with expiration to avoid stale pending requests.',
  },
  {
    title: 'Asynchronous Review Comments',
    date: 'Apr 2026',
    details:
      'Added Review comments in the editor for measure/staff-targeted feedback, threaded replies, and resolve/unresolve status tracking.',
  },
  {
    title: 'Practice Playback Mode',
    date: 'Apr 2026',
    details:
      'Added loop selection, per-staff solo/mute workflow, metronome toggle, and count-in with 1 or 2 bars.',
  },
  {
    title: 'Version Timeline Upgrade',
    date: 'Apr 2026',
    details:
      'Timeline now opens in a robust popover/sheet UI, includes Current state, filter chips (All/Save/MIDI/PDF), and easier restore flow.',
  },
  {
    title: 'Toolbar Density + Responsive Rows',
    date: 'Apr 2026',
    details:
      'Desktop toolbars now wrap better at narrower widths, with a Compact/Comfortable density toggle in Score Settings.',
  },
];

const FAQ_ITEMS = [
  {
    q: 'How do I control measure spacing, system breaks, and page breaks for export?',
    a: 'In the editor, open Score Settings. Use Spacing to choose Compact, Balanced, or Spacious. Select a measure, then in Breaks click System or Page to toggle a manual break at that measure. If the pickup bar is selected, break toggles target the next full measure automatically. Use Clear to remove all manual breaks. Manual break points also appear on the score as small SYS/PAGE badges at the target barline, and clicking a badge removes that specific break quickly.',
  },
  {
    q: 'What does Collision cleanup do?',
    a: 'Collision cleanup adjusts how aggressively Stavium separates dense polyphonic notation. In Score Settings, choose Off, Standard, or Aggressive. Standard is the default; Aggressive increases separation to reduce crowded noteheads and lyrics in complex passages.',
  },
  {
    q: 'How do I create individual vocal/instrument parts from a full score?',
    a: 'Open the full score in Edit mode, go to Structure, then use Part Extraction > Generate linked parts. Stavium creates one linked composition per staff and keeps each part tied to its source staff for rehearsal and printing workflows.',
  },
  {
    q: 'How do linked parts stay updated after I edit the full score?',
    a: 'When you save the full score, Stavium automatically syncs existing linked parts derived from that score. If you open a linked part directly, use "Refresh from source" in Part Extraction to pull the latest source changes on demand.',
  },
  {
    q: 'Can I extract only one voice lane (V1-V4) into linked parts?',
    a: 'Yes. In Part Extraction, select one or more staves, then choose All voices or specific lanes (V1-V4) per staff. You can mix targets, such as Alto V1+V2 and Tenor V1 only, in one sync run.',
  },
  {
    q: 'Can I access linked parts in View mode?',
    a: 'Yes. In View mode you can open existing linked parts (and open source from a linked part). Creating/syncing or refreshing linked parts requires Edit mode.',
  },
  {
    q: 'How do I edit multiple voices on one staff?',
    a: 'In Notes, use the Voices control to pick V1, V2, V3, or V4. Add notes/rests in the selected lane, toggle each lane visibility with the eye button, and use lane-level M (mute) or S (solo) for playback focus.',
  },
  {
    q: 'Does each voice lane keep its own rhythm selection?',
    a: 'Yes. Each voice lane stores its own active rhythm context (note duration and rest mode), so switching between V1-V4 restores that lane\'s current rhythm settings.',
  },
  {
    q: 'How are imported MIDI and MusicXML voices mapped now?',
    a: 'Imports now map voice content directly into editable V1-V4 lanes per staff. This means imported polyphonic passages are no longer trapped in a render-only state and can be edited lane-by-lane.',
  },
  {
    q: 'Why do scanned imports show fewer extra rests now?',
    a: 'In OCR Imports, use Scan voice split mode. Conservative (recommended) keeps scans cleaner and avoids noisy splitting, while Aggressive multi-voice split preserves more detected parallel voices. Secondary timing filler rests are hidden for cleaner notation, while explicit rests recognized from the source remain visible.',
  },
  {
    q: 'How does real-time co-editing work in the editor?',
    a: 'On shared/public scores, Stavium now shows who is currently in the score, along with live cursor/selection highlights on the page. Edits sync per measure so simultaneous work in different measures merges safely, and same-measure conflicts fall back to latest measure patch.',
  },
  {
    q: 'How do I discard unsaved live collaboration changes?',
    a: 'Use the "Discard Unsaved Changes" button in the editor header while in Edit mode. It removes unsaved live co-edit patches for the current score and reloads the last saved version of the composition. Collaborators in the same score also see a toast that the score was restored.',
  },
  {
    q: 'What is the "First score checklist" in the editor?',
    a: 'When you open a new score in edit mode, Stavium can show a quick onboarding checklist in the toolbar area: place your first note, play once, and save your score. After all three are complete, a short success confirmation appears with a subtle fade/slide animation.',
  },
  {
    q: 'Is onboarding progress tied to my account or this device?',
    a: 'Onboarding progress is now tied to your signed-in account. Your checklist and tip visibility preferences sync across devices where you use the same account.',
  },
  {
    q: 'What are the contextual toolbar tips?',
    a: 'Small tip callouts can appear inside Notes, Structure, Score Settings, and Note Expression toolbars. They adapt to your context (for example, before/after placing a note). You can hide or show tips from the checklist controls.',
  },
  {
    q: 'How do I add notes to my score?',
    a: 'Click a duration in the Notes toolbar (whole, half, quarter, etc.), then click on the staff where you want the note. Use Dot to create dotted values, and Triplet to switch the selected duration to a triplet value. You can also use the Rest toolbar to add rests.',
  },
  {
    q: 'How do I change a note\'s pitch after placing it?',
    a: 'Click the note to select it, then drag it up or down on the staff. You can also use the Accidental toolbar (sharp, flat, natural) when a note is selected.',
  },
  {
    q: 'How do I write triplets?',
    a: 'In Notes & Rests, pick a base value (for example quarter or eighth), then set Tuplet to 3:2, 5:4, 6:4, or 7:4. Notes/rests you place will render with the matching tuplet number.',
  },
  {
    q: 'Can I use double-sharps and double-flats?',
    a: 'Yes. Select a note, then use the Accidental toolbar to apply double-sharp (𝄪) or double-flat (𝄫).',
  },
  {
    q: 'Can I add lyrics to my composition?',
    a: 'Yes! Select a note, then use the Lyrics toolbar to add text. Lyrics are attached to individual notes and will display below the staff.',
  },
  {
    q: 'How do I share my composition with others?',
    a: 'Open Score Info (ℹ️ button in the editor header), then use the Sharing section. You can keep it Private, share with specific people by email (view or edit access), or make it Public for everyone.',
  },
  {
    q: 'Can I transfer composition ownership to another account?',
    a: 'Yes. In Score Info > Ownership, the current owner can send a transfer request to a destination email. The destination account must open the score and accept the request. Requests expire automatically after 7 days to prevent neglected handoffs.',
  },
  {
    q: 'How do Review comments work on shared scores?',
    a: 'Open a saved score in the editor, click Review in the header, then start a thread for a specific staff and measure. The thread list shows the original thread title plus the latest reply preview. Reviewers can reply asynchronously and mark threads as Resolved or Unresolved as feedback is addressed.',
  },
  {
    q: 'What file formats can I import?',
    a: 'Stavium supports MIDI (.mid, .midi), MusicXML (.xml, .musicxml, .mxl), and PDF/image scans. For MIDI and MusicXML, use the Import button on the Dashboard. For PDFs and scanned images, go to the OCR Imports page.',
  },
  {
    q: 'How do I export my composition?',
    a: 'Use the Export toolbar in the editor. You can export to PDF (for printing) or MIDI (for use in DAWs and other music software). For competition-ready PDF layout, configure Score Settings > Spacing, Collisions, and Breaks before exporting.',
  },
  {
    q: 'If I delete a composition, are reviews and timeline history also deleted?',
    a: 'Yes. Deleting a composition now cascades and removes its related review threads/comments and revision timeline snapshots from cloud storage.',
  },
  {
    q: 'What keyboard shortcuts are available?',
    a: 'Ctrl+Z (or Cmd+Z) undo, Ctrl+Y (or Cmd+Y) redo, and Ctrl+S (or Cmd+S) save. More shortcuts may be added in future updates.',
  },
  {
    q: 'Why is playback silent or delayed?',
    a: 'Browsers require a user gesture before playing audio. Click the Play button once to start. Some instruments may need time to load (soundfonts). On first use, the app preloads instruments in the background.',
  },
  {
    q: 'How do I use Practice Playback mode?',
    a: 'Use the bottom playback bar: set From/To for measure range, enable Loop, or click Loop Selection to loop the currently selected measure range. Turn on Metronome and Count in, then choose 1b or 2b for count-in length. You can also solo/mute staves in Score Settings > Volume.',
  },
  {
    q: 'What is Compact Toolbar?',
    a: 'In Score Settings, use Density > Compact Toolbar. Checked keeps controls tighter for smaller screens; unchecked switches to a more comfortable spacing layout.',
  },
  {
    q: 'How do I use Version History timeline?',
    a: 'Open the Timeline button in Structure. The panel shows a Current state card, filter chips (All/Save/MIDI/PDF), and revision entries. Click Restore on any snapshot (edit mode only) to roll back.',
  },
  {
    q: 'How do I add more staves (e.g., for SATB choir)?',
    a: 'Use the Structure section in the toolbar. Click "Add Staff" to add a new staff. You can rename staves (Soprano, Alto, Tenor, Bass) and set each staff\'s clef and instrument.',
  },
  {
    q: 'Can I add chord symbols?',
    a: 'Yes! Select a note, then use the Chord Editor or Chord Detection panel. Chord symbols are displayed above the staff.',
  },
];

export const HelpPage = () => {
  const navigate = useNavigate();
  const user = useUserStore((state) => state.user);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleSendChat = async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;

    setChatInput('');
    setChatMessages((prev) => [...prev, { role: 'user', text: msg }]);
    setChatLoading(true);
    setChatError(null);

    const { text, error } = await sendChatMessage(chatMessages, msg);

    setChatLoading(false);
    if (error) {
      setChatError(error);
    } else if (text) {
      setChatMessages((prev) => [...prev, { role: 'model', text }]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendChat();
    }
  };

  return (
    <div className="min-h-screen bg-sv-bg flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-sv-border bg-sv-card">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(user ? '/dashboard' : '/')}
              className="flex items-center gap-2 text-sv-text-muted hover:text-sv-text transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="hidden sm:inline">Back</span>
            </button>
            <div className="flex items-center gap-3">
              <img src="/stavium_logo.png" alt="Stavium" className="w-9 h-9 rounded-lg object-cover" />
              <div>
                <span className="text-lg font-bold tracking-widest text-sv-text uppercase">Help</span>
                <div className="hidden sm:flex items-center gap-2 -mt-0.5">
                  <span className="text-xs text-sv-text-dim tracking-[0.2em] uppercase">Documentation · FAQ · AI Assistant</span>
                  <span className="text-[10px] px-2 py-0.5 rounded border border-sv-border text-sv-text-dim">
                    Last updated: {HELP_LAST_UPDATED}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex-shrink-0 border-b border-sv-border bg-sv-card">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <nav className="flex gap-1 overflow-x-auto py-2">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? 'bg-sv-cyan/15 text-sv-cyan border border-sv-cyan/40'
                    : 'text-sv-text-muted hover:text-sv-text hover:bg-sv-elevated'
                }`}
              >
                <span>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
          {activeTab === 'overview' && (
            <section className="space-y-8">
              <div>
                <h2 className="text-2xl font-bold text-sv-text mb-4">What&apos;s New</h2>
                <div className="space-y-3">
                  {WHATS_NEW_ITEMS.map((item) => (
                    <div key={item.title} className="p-4 rounded-xl bg-sv-card border border-sv-border">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <h3 className="text-base font-semibold text-sv-cyan">{item.title}</h3>
                        <span className="text-[11px] px-2 py-0.5 rounded border border-sv-border text-sv-text-dim">
                          {item.date}
                        </span>
                      </div>
                      <p className="text-sv-text-muted text-sm leading-relaxed">{item.details}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-sv-text mb-4">What is Stavium?</h2>
                <p className="text-sv-text-muted leading-relaxed">
                  Stavium is a web-based music composition and notation platform. Compose multi-staff scores for choirs and ensembles,
                  hear instant playback with high-quality soundfonts, and export to MIDI or PDF — all in your browser.
                </p>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-sv-text mb-2">Key capabilities</h3>
                <ul className="space-y-2 text-sv-text-muted">
                  <li className="flex items-start gap-2">
                    <span className="text-sv-cyan mt-0.5">•</span>
                    Multi-staff scores (SATB, instrumental ensembles, etc.)
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-sv-cyan mt-0.5">•</span>
                    Practice playback mode: loop ranges, count-in, metronome, solo/mute, per-staff volume
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-sv-cyan mt-0.5">•</span>
                    Export to MIDI and PDF
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-sv-cyan mt-0.5">•</span>
                    Share and collaborate (private, shared, or public)
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-sv-cyan mt-0.5">•</span>
                    Asynchronous review comments tied to staff + measure with resolve/unresolve threads
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-sv-cyan mt-0.5">•</span>
                    Import from MIDI, MusicXML, PDF, and scanned images
                  </li>
                </ul>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-sv-text mb-3">Notation Support Matrix</h3>
                <div className="space-y-3">
                  <div className="p-4 rounded-xl bg-sv-card border border-sv-border">
                    <h4 className="font-semibold text-emerald-400 mb-2">Fully Supported</h4>
                    <p className="text-sv-text-muted text-sm">
                      Notes/rests (whole to 32nd), dotted values, tuplets (3:2, 5:4, 6:4, 7:4), key/time signatures, anacrusis, clef changes,
                      accidentals (including double-sharp and double-flat), ties, slurs, articulations, dynamics, lyrics, chord symbols, multi-staff scores.
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-sv-card border border-sv-border">
                    <h4 className="font-semibold text-amber-400 mb-2">Partially Supported / Workflow Dependent</h4>
                    <p className="text-sv-text-muted text-sm">
                      Advanced engraving now includes v1 spacing presets, manual page/system breaks, and collision cleanup controls. Additional refinement passes for edge-case notation are still evolving.
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-sv-card border border-sv-border">
                    <h4 className="font-semibold text-sv-cyan mb-2">Planned Improvements</h4>
                    <p className="text-sv-text-muted text-sm">
                      Additional engraving refinements and expanded advanced notation workflows will continue to be improved in upcoming updates.
                    </p>
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'getting-started' && (
            <section className="space-y-8">
              <div>
                <h2 className="text-2xl font-bold text-sv-text mb-4">Getting Started</h2>
                <ol className="space-y-6 list-decimal list-inside text-sv-text-muted">
                  <li>
                    <span className="font-medium text-sv-text">Sign in</span> — Use your Google account to sign in. No setup required.
                  </li>
                  <li>
                    <span className="font-medium text-sv-text">Create or open</span> — From the Dashboard, click "New Composition" or open an existing one.
                  </li>
                  <li>
                    <span className="font-medium text-sv-text">Follow the first score checklist</span> — In edit mode, use the guided checklist to place your first note, play once, and save.
                  </li>
                  <li>
                    <span className="font-medium text-sv-text">Use toolbar tips</span> — Contextual tips appear in Notes, Structure, Score Settings, and Expression to guide the next best action.
                  </li>
                  <li>
                    <span className="font-medium text-sv-text">Save & export</span> — Save your work from the header, then export to PDF or MIDI when ready.
                  </li>
                </ol>
              </div>
            </section>
          )}

          {activeTab === 'features' && (
            <section className="space-y-8">
              <div>
                <h2 className="text-2xl font-bold text-sv-text mb-4">Editor Features</h2>
                <div className="space-y-6">
                  <div className="p-4 rounded-xl bg-sv-card border border-sv-border">
                    <h3 className="font-semibold text-sv-cyan mb-2">Engraving Controls (v1)</h3>
                    <p className="text-sv-text-muted text-sm">
                      In Score Settings, use Spacing presets (Compact/Balanced/Spacious), Collision cleanup (Off/Standard/Aggressive), and Breaks controls (System/Page/Clear) to improve print layout quality before PDF export. Manual break points are shown in-canvas as SYS/PAGE barline badges, and each badge is clickable to clear that break.
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-sv-card border border-sv-border">
                    <h3 className="font-semibold text-sv-cyan mb-2">Linked Part Extraction</h3>
                    <p className="text-sv-text-muted text-sm">
                      Generate individual linked parts from a full score directly in Structure. Select single or multiple staves, then choose All voices or specific V1-V4 lanes per staff before syncing. Open linked parts from either Edit or View mode, and refresh from source when needed.
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-sv-card border border-sv-border">
                    <h3 className="font-semibold text-sv-cyan mb-2">Multi-Voice Lanes</h3>
                    <p className="text-sv-text-muted text-sm">
                      Edit polyphony with explicit V1-V4 lanes. Each lane can be shown/hidden independently, has lane-level mute/solo for playback, and keeps its own rhythm selection, making counterpoint and layered textures easier to manage.
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-sv-card border border-sv-border">
                    <h3 className="font-semibold text-sv-cyan mb-2">Real-time Co-editing (v1)</h3>
                    <p className="text-sv-text-muted text-sm">
                      Collaborators now appear in the editor header under "In score", with live cursor/selection highlights rendered directly on the score. Real-time edits sync per measure with conflict-safe merge behavior to reduce overwrite risk during concurrent composition.
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-sv-card border border-sv-border">
                    <h3 className="font-semibold text-sv-cyan mb-2">Notes & Rests</h3>
                    <p className="text-sv-text-muted text-sm">
                      Add whole through 32nd notes and rests, including dotted values and tuplets (3:2, 5:4, 6:4, 7:4). Click a duration, then click the staff. Select notes to adjust pitch, accidentals, ties, slurs, articulations, and dynamics.
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-sv-card border border-sv-border">
                    <h3 className="font-semibold text-sv-cyan mb-2">Structure</h3>
                    <p className="text-sv-text-muted text-sm">
                      Add or remove staves, change clefs (treble/bass), set instruments per staff, and adjust time signatures and measures. Use Measure Properties for key signature and tempo.
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-sv-card border border-sv-border">
                    <h3 className="font-semibold text-sv-cyan mb-2">Score Settings</h3>
                    <p className="text-sv-text-muted text-sm">
                      Set tempo (BPM), per-staff volume, quick solo/mute, instrument sounds, and toolbar density (Compact/Comfortable). Playback uses high-quality soundfonts that load in the background.
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-sv-card border border-sv-border">
                    <h3 className="font-semibold text-sv-cyan mb-2">Practice Playback</h3>
                    <p className="text-sv-text-muted text-sm">
                      Use measure range playback (From/To), Loop, and Loop Selection for rehearsal workflows. Enable Metronome and Count in (1 or 2 bars) for tighter entrances and repeated practice passes.
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-sv-card border border-sv-border">
                    <h3 className="font-semibold text-sv-cyan mb-2">Expression (when note selected)</h3>
                    <p className="text-sv-text-muted text-sm">
                      Add accidentals, ties, slurs, articulations (staccato, accent), dynamics (p, pp, f, ff), lyrics, and chord symbols.
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-sv-card border border-sv-border">
                    <h3 className="font-semibold text-sv-cyan mb-2">Version Timeline</h3>
                    <p className="text-sv-text-muted text-sm">
                      Track snapshot history from saves/exports. The timeline panel supports quick filtering by trigger type and restoring older revisions when needed.
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-sv-card border border-sv-border">
                    <h3 className="font-semibold text-sv-cyan mb-2">Review Comments</h3>
                    <p className="text-sv-text-muted text-sm">
                      Open Review from the editor header to add asynchronous comment threads tied to a staff and measure. Threads support replies and can be marked resolved or unresolved during collaboration.
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-sv-card border border-sv-border">
                    <h3 className="font-semibold text-sv-cyan mb-2">Export</h3>
                    <p className="text-sv-text-muted text-sm">
                      Export to PDF for printing or sharing, or MIDI for use in DAWs, notation software, or other music tools.
                    </p>
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'faq' && (
            <section className="space-y-6">
              <h2 className="text-2xl font-bold text-sv-text mb-4">Frequently Asked Questions</h2>
              {FAQ_ITEMS.map((item, i) => (
                <div
                  key={i}
                  className="p-4 rounded-xl bg-sv-card border border-sv-border hover:border-sv-cyan/30 transition-colors"
                >
                  <h3 className="font-semibold text-sv-text mb-2">{item.q}</h3>
                  <p className="text-sv-text-muted text-sm leading-relaxed">{item.a}</p>
                </div>
              ))}
            </section>
          )}

          {activeTab === 'chat' && (
            <section className="flex flex-col h-[calc(100vh-280px)] min-h-[400px]">
              <div className="mb-4">
                <h2 className="text-2xl font-bold text-sv-text mb-1">AI Assistant</h2>
                <p className="text-sv-text-muted text-sm">
                  Ask questions about Stavium, music composition, or notation. Get instant help with the editor, features, and workflows.
                </p>
              </div>
              <div
                ref={chatContainerRef}
                className="flex-1 flex flex-col rounded-xl border border-sv-border bg-sv-card overflow-hidden"
              >
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {chatMessages.length === 0 && !chatLoading && (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <div className="text-4xl mb-4 opacity-60">💬</div>
                      <p className="text-sv-text-muted text-sm mb-2">Ask anything about Stavium</p>
                      <p className="text-sv-text-dim text-xs">e.g. "How do I add a tie between two notes?"</p>
                    </div>
                  )}
                  {chatMessages.map((m, i) => (
                    <div
                      key={i}
                      className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-lg px-4 py-2.5 text-sm ${
                          m.role === 'user'
                            ? 'bg-sv-cyan/20 text-sv-text border border-sv-cyan/30'
                            : 'bg-sv-elevated text-sv-text-muted border border-sv-border'
                        }`}
                      >
                        {m.text}
                      </div>
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="flex justify-start">
                      <div className="rounded-lg px-4 py-2.5 bg-sv-elevated border border-sv-border">
                        <span className="inline-flex gap-1">
                          <span className="w-2 h-2 rounded-full bg-sv-cyan animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="w-2 h-2 rounded-full bg-sv-cyan animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="w-2 h-2 rounded-full bg-sv-cyan animate-bounce" style={{ animationDelay: '300ms' }} />
                        </span>
                      </div>
                    </div>
                  )}
                  {chatError && (
                    <div className="rounded-lg px-4 py-2.5 bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm">
                      {chatError}
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
                <div className="p-2 border-t border-sv-border">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Ask a question..."
                      className="flex-1 px-4 py-2.5 rounded-lg bg-sv-elevated border border-sv-border text-sv-text placeholder-sv-text-dim
                                 focus:outline-none focus:ring-2 focus:ring-sv-cyan/40 focus:border-sv-cyan/60"
                      disabled={chatLoading}
                    />
                    <button
                      onClick={handleSendChat}
                      disabled={!chatInput.trim() || chatLoading}
                      className="px-4 py-2.5 rounded-lg bg-sv-cyan text-sv-bg font-medium disabled:opacity-50 disabled:cursor-not-allowed
                                 hover:bg-sv-cyan-dim transition-colors"
                    >
                      Send
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
};
