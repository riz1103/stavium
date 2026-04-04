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
    a: 'Use the Export toolbar in the editor. You can export to PDF (for printing) or MIDI (for use in DAWs and other music software).',
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
                      Polyphonic/chord-like imported content is preserved and rendered via multiple voices, but advanced manual voice editing workflows are still evolving.
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
