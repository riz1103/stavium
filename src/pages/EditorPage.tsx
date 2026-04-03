import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useUserStore } from '../app/store/userStore';
import { RevisionTrigger, useScoreStore } from '../app/store/scoreStore';
import { usePlaybackStore } from '../app/store/playbackStore';
import { getComposition, getCompositionRevisionTimeline, saveComposition, saveCompositionRevisionSnapshot } from '../services/compositionService';
import { ScoreEditor } from '../components/editor/ScoreEditor';
import { ScoreInfoPanel } from '../components/toolbar/ScoreInfoPanel';
import { PlaybackControls } from '../components/playback/PlaybackControls';
import { NoteToolbar } from '../components/toolbar/NoteToolbar';
import { RestToolbar } from '../components/toolbar/RestToolbar';
import { ClefSelector } from '../components/toolbar/ClefSelector';
import { InstrumentSelector } from '../components/toolbar/InstrumentSelector';
import { MeasureControls } from '../components/toolbar/MeasureControls';
import { CompositionControls } from '../components/toolbar/CompositionControls';
import { StaffControls } from '../components/toolbar/StaffControls';
import { AccidentalToolbar } from '../components/toolbar/AccidentalToolbar';
import { TieSlurToolbar } from '../components/toolbar/TieSlurToolbar';
import { ArticulationToolbar } from '../components/toolbar/ArticulationToolbar';
import { DynamicToolbar } from '../components/toolbar/DynamicToolbar';
import { HairpinToolbar } from '../components/toolbar/HairpinToolbar';
import { LyricsToolbar } from '../components/toolbar/LyricsToolbar';
import { GregorianChantToolbar } from '../components/toolbar/GregorianChantToolbar';
import { UndoRedoToolbar } from '../components/toolbar/UndoRedoToolbar';
import { ExportToolbar } from '../components/toolbar/ExportToolbar';
import { VersionHistoryPanel } from '../components/toolbar/VersionHistoryPanel';
import { ChordDetectionPanel } from '../components/toolbar/ChordDetectionPanel';
import { ChordEditor } from '../components/toolbar/ChordEditor';
import { MeasurePropertiesPanel } from '../components/toolbar/MeasurePropertiesPanel';
import { StaffVolumeControls } from '../components/toolbar/StaffVolumeControls';
import { AIArrangementPanel } from '../components/toolbar/AIArrangementPanel';

type MobileTab = 'notes' | 'expression' | 'structure' | 'settings';

const TAB_CONFIG: { id: MobileTab; label: string; icon: string }[] = [
  { id: 'notes',      label: 'Notes',      icon: '♩' },
  { id: 'expression', label: 'Expression', icon: '♯' },
  { id: 'structure',  label: 'Structure',  icon: '𝄞' },
  { id: 'settings',   label: 'Score',      icon: '⚙' },
];

export const EditorPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useUserStore((state) => state.user);
  const composition = useScoreStore((state) => state.composition);
  const setComposition = useScoreStore((state) => state.setComposition);
  const resetComposition = useScoreStore((state) => state.resetComposition);
  const addRevisionSnapshot = useScoreStore((state) => state.addRevisionSnapshot);
  const clearRevisionHistory = useScoreStore((state) => state.clearRevisionHistory);
  const setRevisionHistory = useScoreStore((state) => state.setRevisionHistory);
  const selectedNote = useScoreStore((state) => state.selectedNote);
  const [title, setTitle] = useState('Untitled Composition');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('notes');
  const [toolbarOpen, setToolbarOpen] = useState(true);
  const [compactToolbar, setCompactToolbar] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('stavium_toolbar_density');
      return stored ? stored === 'compact' : true;
    } catch {
      return true;
    }
  });
  const cloudRevisionWarningShownRef = useRef(false);
  // When first save creates a new doc, we navigate to /editor/:id.
  // Skip the immediate reload so we stay in current editing state.
  const skipNextIdLoadRef = useRef(false);
  // Loaded compositions start in read-only mode; new compositions start in edit mode
  const [isReadOnly, setIsReadOnly] = useState(!!id);

  // Collapsible toolbar sections — persisted in localStorage
  const [collapsedRows, setCollapsedRows] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('stavium_toolbar_sections');
      return new Set(stored ? JSON.parse(stored) : []);
    } catch { return new Set(); }
  });
  const toggleRow = (id: string) => {
    setCollapsedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem('stavium_toolbar_sections', JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  useEffect(() => {
    try {
      localStorage.setItem('stavium_toolbar_density', compactToolbar ? 'compact' : 'comfortable');
    } catch {}
  }, [compactToolbar]);

  // Derived permission flags (recomputed whenever composition or user changes)
  const isOwner = !composition?.userId || composition.userId === user?.uid;
  // Non-owners with view-only permission can never switch to edit mode
  const canEdit = isOwner || composition?.sharePermission === 'edit';
  const [scoreInfoOpen, setScoreInfoOpen] = useState(false);
  const scoreInfoBtnRef = useRef<HTMLButtonElement>(null);
  const undo = useScoreStore((state) => state.undo);
  const redo = useScoreStore((state) => state.redo);
  const canUndo = useScoreStore((state) => state.canUndo);
  const canRedo = useScoreStore((state) => state.canRedo);
  const isGregorianChant = composition?.notationSystem === 'gregorian-chant';

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (canUndo) undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        if (canRedo) redo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, canUndo, canRedo]);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    if (id) {
      if (skipNextIdLoadRef.current) {
        skipNextIdLoadRef.current = false;
        setLoading(false);
        return;
      }
      loadComposition(id);
    } else {
      // If navigated here from Dashboard import, the composition is already
      // in the store — don't reset it.
      clearRevisionHistory();
      const state = location.state as { imported?: boolean } | null;
      if (state?.imported && composition) {
        setTitle(composition.title || 'Imported Composition');
        setIsReadOnly(false);
        setLoading(false);
        // Clear the location state so a subsequent re-render or refresh doesn't
        // skip the reset again.
        navigate('/editor', { replace: true, state: {} });
      } else {
        resetComposition();
        setTitle('Untitled Composition');
        setLoading(false);
      }
    }
  }, [id, user, navigate, resetComposition, clearRevisionHistory]);

  const resetPlaybackTempo = usePlaybackStore((s) => s.setPlaybackTempo);
  const setPlaybackInstrument = usePlaybackStore((s) => s.setPlaybackInstrument);
  
  const loadComposition = async (compositionId: string) => {
    try {
      setLoading(true);
      clearRevisionHistory();
      const comp = await getComposition(compositionId);
      if (comp) {
        setComposition(comp);
        const revisionTimeline = await getCompositionRevisionTimeline(comp.id || compositionId);
        setRevisionHistory(
          revisionTimeline.map((revision) => ({
            id: revision.id,
            createdAt: revision.createdAt,
            trigger: revision.trigger,
            label: revision.label,
            composition: revision.composition,
          }))
        );
        setTitle(comp.title);
        setIsReadOnly(true); // Always start read-only when opening a saved composition
        resetPlaybackTempo(null); // Reset playback tempo when loading new composition
        // Reset playback instruments when loading new composition
        comp.staves.forEach((_, index) => setPlaybackInstrument(index, null));
      }
    } catch (error) {
      console.error('Error loading composition:', error);
    } finally {
      setLoading(false);
    }
  };

  const persistRevisionSnapshot = async (trigger: RevisionTrigger, sourceComposition?: typeof composition) => {
    const target = sourceComposition ?? composition;
    if (!target) return;

    // Unsaved documents don't have a stable id yet, so keep a temporary local timeline.
    if (!target.id || !user) {
      addRevisionSnapshot(trigger);
      return;
    }

    const defaultLabelMap: Record<RevisionTrigger, string> = {
      'manual-save': 'Manual Save',
      'export-midi': 'Export MIDI',
      'export-pdf': 'Export PDF',
    };

    try {
      const ownerId = target.userId || user.uid;
      const updatedTimeline = await saveCompositionRevisionSnapshot({
        compositionId: target.id,
        ownerId,
        createdBy: user.uid,
        trigger,
        label: defaultLabelMap[trigger],
        composition: target,
      });

      setRevisionHistory(
        updatedTimeline.map((revision) => ({
          id: revision.id,
          createdAt: revision.createdAt,
          trigger: revision.trigger,
          label: revision.label,
          composition: revision.composition,
        }))
      );
    } catch (error) {
      console.error('Error persisting revision snapshot:', error);
      if (!cloudRevisionWarningShownRef.current) {
        cloudRevisionWarningShownRef.current = true;
        alert('Version history could not be synced to cloud. Check Firestore rules for compositionRevisions.');
      }
    }
  };

  const handleSave = async () => {
    if (!user || !composition) return;
    try {
      setSaving(true);
      // Preserve the original owner's userId so the document's userId field never changes.
      // Pass the current user's uid separately as modifiedBy so we always know who last saved.
      const ownerId = composition.userId || user.uid;
      const savedId = await saveComposition(
        { ...composition, id: id || undefined, title, userId: ownerId },
        ownerId,
        user.uid   // modifiedBy — the actual person hitting Save
      );
      const effectiveId = savedId || id || composition.id;
      const syncedComposition = {
        ...composition,
        id: effectiveId,
        title,
        userId: ownerId,
        modifiedBy: user.uid,
      };
      setComposition(syncedComposition);

      // First save from /editor (new composition): move to /editor/:id so
      // subsequent saves update this same composition instead of creating new ones.
      if (!id && savedId) {
        skipNextIdLoadRef.current = true;
        navigate(`/editor/${savedId}`, { replace: true });
      }

      await persistRevisionSnapshot('manual-save', syncedComposition);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (error) {
      console.error('Error saving composition:', error);
      alert('Failed to save composition');
    } finally {
      setSaving(false);
    }
  };

  const handleBack = () => navigate('/dashboard');

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-sv-bg gap-4">
        <div className="w-10 h-10 border-2 border-sv-border border-t-sv-cyan rounded-full animate-spin" />
        <p className="text-sv-text-dim text-sm">Loading composition…</p>
      </div>
    );
  }

  /* ── Helpers ──────────────────────────────────────────────────────────── */
  const SectionHeader = ({
    id, icon, label, pulse,
  }: { id: string; icon: string; label: string; pulse?: boolean }) => (
    <button
      className="sv-section-header"
      onClick={() => toggleRow(id)}
      title={collapsedRows.has(id) ? `Expand ${label}` : `Collapse ${label}`}
    >
      <span className="text-sm leading-none">{icon}</span>
      <span>{label}</span>
      {pulse && (
        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80 animate-pulse ml-0.5"
              title="Active — note selected" />
      )}
      <svg
        className={`w-3 h-3 ml-auto flex-shrink-0 transition-transform duration-150 ${collapsedRows.has(id) ? '-rotate-90' : ''}`}
        fill="none" stroke="currentColor" viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );

  const Sep = () => <div className="w-px self-stretch bg-sv-border mx-0.5 flex-shrink-0" />;

  /* ── Desktop toolbar rows ─────────────────────────────────────────────── */
  const desktopToolbar = (
    <div className="hidden md:flex flex-col bg-sv-card border-b border-sv-border">
      {isReadOnly ? (
        /* Read-only mode: compact info bar with Tempo (for playback) + Volume + Export */
        <div className="flex items-center gap-3 px-3 py-2 overflow-x-auto toolbar-scroll">
          {/* View-mode badge */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-medium flex-shrink-0">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
            </svg>
            View Only
          </div>
          <Sep />
          <CompositionControls isReadOnly={true} />
          <Sep />
          <InstrumentSelector isReadOnly={true} />
          <Sep />
          <StaffVolumeControls />
          <Sep />
          <ExportToolbar isReadOnly={true} onSnapshotEvent={persistRevisionSnapshot} />
          <Sep />
          <VersionHistoryPanel isReadOnly={true} />
        </div>
      ) : (
        <>
          {/* ── Section 1: Notes & Rests ──────────────────────────────────── */}
          <div className="sv-section-notes border-b border-sv-border">
            <SectionHeader id="notes" icon="♩" label={isGregorianChant ? 'Neumes' : 'Notes & Rests'} />
            {!collapsedRows.has('notes') && (
              <div className="flex flex-wrap 2xl:flex-nowrap items-start gap-2 px-3 py-2">
            <NoteToolbar />
                {!isGregorianChant && <div className="hidden 2xl:block"><Sep /></div>}
            {!isGregorianChant && <RestToolbar />}
                <div className="hidden 2xl:block"><Sep /></div>
            <UndoRedoToolbar />
              </div>
            )}
          </div>

          {/* ── Section 2: Structure ─────────────────────────────────────── */}
          <div className="sv-section-structure border-b border-sv-border">
            <SectionHeader id="structure" icon="⊞" label="Structure" />
            {!collapsedRows.has('structure') && (
              <div className="flex flex-wrap 2xl:flex-nowrap items-start gap-2 px-3 py-2">
            <StaffControls />
                {!isGregorianChant && <div className="hidden 2xl:block"><Sep /></div>}
            {!isGregorianChant && <MeasureControls />}
                <div className="hidden 2xl:block"><Sep /></div>
            <ClefSelector />
                <div className="hidden 2xl:block"><Sep /></div>
            <InstrumentSelector isReadOnly={false} />
                <div className="hidden 2xl:block"><Sep /></div>
            <MeasurePropertiesPanel />
                {!isGregorianChant && <div className="hidden 2xl:block"><Sep /></div>}
            {!isGregorianChant && <AIArrangementPanel isReadOnly={isReadOnly} />}
                <div className="hidden 2xl:block"><Sep /></div>
            <ExportToolbar isReadOnly={false} onSnapshotEvent={persistRevisionSnapshot} />
                <div className="hidden 2xl:block"><Sep /></div>
            <VersionHistoryPanel isReadOnly={false} />
              </div>
            )}
          </div>

          {/* ── Section 3: Score Settings ─────────────────────────────────── */}
          <div className={`sv-section-score ${selectedNote && !collapsedRows.has('expression') ? 'border-b border-sv-border' : ''}`}>
            <SectionHeader id="score" icon="♫" label="Score Settings" />
            {!collapsedRows.has('score') && (
              <div className="flex flex-wrap 2xl:flex-nowrap items-start gap-2 px-3 py-2">
            <CompositionControls isReadOnly={false} />
                <div className="hidden 2xl:block"><Sep /></div>
            <StaffVolumeControls />
                <div className="hidden 2xl:block"><Sep /></div>
                <div className="sv-toolbar">
                  <span className="sv-toolbar-label">Density</span>
                  <label className="flex items-center gap-1.5 text-xs text-sv-text-muted cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={compactToolbar}
                      onChange={(e) => setCompactToolbar(e.target.checked)}
                      className="w-3.5 h-3.5"
                    />
                    <span>{compactToolbar ? 'Compact Toolbar' : 'Comfortable Toolbar'}</span>
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* ── Section 4: Expression (context — only when note selected) ─── */}
          {selectedNote && (
            <div className="sv-section-expression">
              <SectionHeader id="expression" icon="✦" label="Note Expression" pulse />
              {!collapsedRows.has('expression') && (
            <div className="flex flex-wrap 2xl:flex-nowrap items-start gap-2 px-3 py-2">
              {isGregorianChant ? (
                <>
                  <GregorianChantToolbar />
                  <div className="hidden 2xl:block"><Sep /></div>
                  <TieSlurToolbar />
                  <div className="hidden 2xl:block"><Sep /></div>
                </>
              ) : (
                <>
                  <AccidentalToolbar />
                  <div className="hidden 2xl:block"><Sep /></div>
                  <TieSlurToolbar />
                  <div className="hidden 2xl:block"><Sep /></div>
                  <ArticulationToolbar />
                  <div className="hidden 2xl:block"><Sep /></div>
                  <DynamicToolbar />
                  <div className="hidden 2xl:block"><Sep /></div>
                  <HairpinToolbar />
                  <div className="hidden 2xl:block"><Sep /></div>
                </>
              )}
              <LyricsToolbar />
              {!isGregorianChant && (
                <>
                  <div className="hidden 2xl:block"><Sep /></div>
                  <ChordDetectionPanel />
                  <div className="hidden 2xl:block"><Sep /></div>
                  <ChordEditor />
                </>
              )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );

  /* ── Mobile tab panel content ─────────────────────────────────────────── */
  const readOnlyNotice = (
    <div className="flex flex-col items-center justify-center py-4 gap-2">
      <div className="flex items-center gap-1.5 text-amber-400 text-xs font-medium">
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
        </svg>
        View Only
      </div>
      {canEdit ? (
        <button
          onClick={() => setIsReadOnly(false)}
          className="px-3 py-1.5 rounded-lg bg-sv-cyan text-sv-bg text-xs font-medium hover:bg-sv-cyan-dim transition-colors"
        >
          ✏ Enable Editing
        </button>
      ) : (
        <span className="text-xs text-sv-text-muted italic">
          You only have view permission for this composition.
        </span>
      )}
    </div>
  );

  const mobileTabContent: Record<MobileTab, JSX.Element> = {
    notes: isReadOnly ? readOnlyNotice : (
      <div className="flex flex-col gap-2 p-3 overflow-y-auto max-h-48">
        <NoteToolbar />
        {!isGregorianChant && <RestToolbar />}
      </div>
    ),
    expression: isReadOnly ? readOnlyNotice : (
      <div className="flex flex-col gap-2 p-3 overflow-y-auto max-h-48">
        {selectedNote ? (
          <>
            {isGregorianChant ? (
              <>
                <GregorianChantToolbar />
                <TieSlurToolbar />
              </>
            ) : (
              <>
                <AccidentalToolbar />
                <TieSlurToolbar />
                <ArticulationToolbar />
                <DynamicToolbar />
                <HairpinToolbar />
              </>
            )}
            <LyricsToolbar />
          </>
        ) : (
          <div className="flex items-center justify-center py-4 text-sv-text-dim text-sm">
            Select a note to edit expression
          </div>
        )}
      </div>
    ),
    structure: isReadOnly ? readOnlyNotice : (
      <div className="flex flex-col gap-2 p-3 overflow-y-auto max-h-48">
        <StaffControls />
        {!isGregorianChant && <MeasureControls />}
        <div className="flex flex-wrap gap-2">
          <ClefSelector />
          <InstrumentSelector isReadOnly={isReadOnly} />
          <MeasurePropertiesPanel />
        </div>
        {!isGregorianChant && <AIArrangementPanel isReadOnly={isReadOnly} />}
        <StaffVolumeControls />
      </div>
    ),
    settings: (
      <div className="flex flex-col gap-2 p-3 overflow-y-auto max-h-48">
        <CompositionControls isReadOnly={isReadOnly} />
        <div className="sv-toolbar">
          <span className="sv-toolbar-label">Density</span>
          <label className="flex items-center gap-1.5 text-xs text-sv-text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={compactToolbar}
              onChange={(e) => setCompactToolbar(e.target.checked)}
              className="w-3.5 h-3.5"
            />
            <span>{compactToolbar ? 'Compact Toolbar' : 'Comfortable Toolbar'}</span>
          </label>
        </div>
        <div className="flex gap-2 flex-wrap">
          {!isReadOnly && <UndoRedoToolbar />}
          <ExportToolbar isReadOnly={isReadOnly} onSnapshotEvent={persistRevisionSnapshot} />
          <VersionHistoryPanel isReadOnly={isReadOnly} />
        </div>
        {!isReadOnly && !isGregorianChant && <ChordDetectionPanel />}
        <StaffVolumeControls />
      </div>
    ),
  };

  return (
    <div className={`h-screen flex flex-col bg-sv-bg overflow-hidden ${compactToolbar ? '' : 'toolbar-density-comfortable'}`}>

      {/* ── Top Header ─────────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 bg-sv-card border-b border-sv-border px-3 py-2 flex items-center gap-2">
        {/* Back */}
        <button
          onClick={handleBack}
          className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg
                     text-sv-text-muted hover:text-sv-text hover:bg-sv-elevated transition-colors"
          title="Back to Dashboard"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Logo (desktop) */}
        <img src="/stavium_logo.png" alt="Stavium" className="hidden md:block w-7 h-7 rounded-md object-cover flex-shrink-0" />

        {/* Score Info button */}
        <button
          onClick={() => navigate('/help')}
          className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-sv-border
                     bg-sv-elevated text-sv-text-muted hover:text-sv-text hover:border-sv-border-lt transition-colors text-xs font-medium"
          title="Help & documentation"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <span className="hidden sm:inline">Help</span>
        </button>
        <button
          ref={scoreInfoBtnRef}
          onClick={() => setScoreInfoOpen((v) => !v)}
          className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium
                      transition-all duration-150 ${
            scoreInfoOpen
              ? 'bg-sv-cyan/15 border-sv-cyan/50 text-sv-cyan'
              : 'bg-sv-elevated border-sv-border text-sv-text-muted hover:text-sv-text hover:border-sv-border-lt'
          }`}
          title="Score info — composer, arranger, sharing"
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
          </svg>
          <span className="hidden sm:inline">Score Info</span>
        </button>
        {/* Score Info panel rendered via portal (avoids z-index/overflow issues) */}
        <ScoreInfoPanel
          open={scoreInfoOpen}
          onClose={() => setScoreInfoOpen(false)}
          anchorRef={scoreInfoBtnRef as React.RefObject<HTMLElement>}
          isOwner={isOwner}
        />

        {/* Read-only badge (shown when not editing) */}
        {isReadOnly && (
          <div className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-md
                          bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-medium">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
              <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
            </svg>
            <span className="hidden sm:inline">View Only</span>
          </div>
        )}

        {/* Title input */}
        <input
          type="text"
          value={title}
          onChange={(e) => { if (!isReadOnly) setTitle(e.target.value); }}
          readOnly={isReadOnly}
          className={`flex-1 min-w-0 px-3 py-1.5 bg-sv-elevated border border-sv-border rounded-lg
                     text-sv-text text-sm font-medium placeholder-sv-text-dim
                     focus:outline-none focus:border-sv-cyan/60 focus:ring-1 focus:ring-sv-cyan/20
                     transition-colors ${isReadOnly ? 'cursor-default select-none' : ''}`}
          placeholder="Composition Title"
        />

        {/* Edit toggle on mobile */}
        <button
          onClick={() => canEdit && setIsReadOnly((v) => !v)}
          disabled={!canEdit}
          className={`md:hidden flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
            !canEdit
              ? 'text-sv-text-dim cursor-not-allowed opacity-40'
              : isReadOnly
              ? 'text-sv-text-muted hover:text-sv-text hover:bg-sv-elevated'
              : 'text-sv-cyan bg-sv-cyan/10'
          }`}
          title={!canEdit ? 'View only — you do not have edit permission' : isReadOnly ? 'Enable editing' : 'Switch to view mode'}
        >
          {isReadOnly ? (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
            </svg>
          )}
        </button>

        {/* Toolbar toggle on mobile */}
        <button
          onClick={() => setToolbarOpen((v) => !v)}
          className="md:hidden flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg
                     text-sv-text-muted hover:text-sv-text hover:bg-sv-elevated transition-colors"
          title={toolbarOpen ? 'Hide toolbar' : 'Show toolbar'}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {/* Edit / View toggle (desktop) */}
        <button
          onClick={() => canEdit && setIsReadOnly((v) => !v)}
          disabled={!canEdit}
          className={`hidden md:flex flex-shrink-0 items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm
                      font-medium transition-all duration-200 border ${
            !canEdit
              ? 'bg-sv-elevated border-sv-border text-sv-text-dim cursor-not-allowed opacity-40'
              : isReadOnly
              ? 'bg-sv-elevated border-sv-border text-sv-text-muted hover:text-sv-text hover:border-sv-cyan/40'
              : 'bg-sv-cyan/10 border-sv-cyan/40 text-sv-cyan hover:bg-sv-cyan/20'
          }`}
          title={!canEdit ? 'View only — you do not have edit permission' : isReadOnly ? 'Switch to edit mode' : 'Switch to view mode'}
        >
          {isReadOnly ? (
            <>
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
              </svg>
              Edit
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
              </svg>
              Viewing
            </>
          )}
        </button>

        {/* Undo/Redo (desktop shortcuts, hidden in read-only) */}
        <div className={`hidden md:flex items-center gap-1 ${isReadOnly ? 'opacity-0 pointer-events-none' : ''}`}>
          <button
            onClick={undo}
            disabled={!canUndo}
            className={`w-8 h-8 flex items-center justify-center rounded-lg text-sm transition-colors ${
              canUndo ? 'text-sv-text-muted hover:text-sv-text hover:bg-sv-elevated' : 'text-sv-text-dim cursor-not-allowed'
            }`}
            title="Undo (Ctrl+Z)"
          >↶</button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className={`w-8 h-8 flex items-center justify-center rounded-lg text-sm transition-colors ${
              canRedo ? 'text-sv-text-muted hover:text-sv-text hover:bg-sv-elevated' : 'text-sv-text-dim cursor-not-allowed'
            }`}
            title="Redo (Ctrl+Y)"
          >↷</button>
        </div>

        {/* Save (hidden in read-only mode) */}
        <button
          onClick={handleSave}
          disabled={saving || isReadOnly}
          style={{ display: isReadOnly ? 'none' : undefined }}
          className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
                      transition-all duration-200 ${
            saveSuccess
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
              : 'bg-sv-cyan text-sv-bg border border-sv-cyan hover:bg-sv-cyan-dim shadow-glow-sm'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
          title="Save (Ctrl+S)"
        >
          {saving ? (
            <>
              <span className="w-3 h-3 border-2 border-sv-bg border-t-transparent rounded-full animate-spin" />
              <span>Saving…</span>
            </>
          ) : saveSuccess ? (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              <span>Saved!</span>
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </svg>
              <span>Save</span>
            </>
          )}
        </button>
      </header>

      {/* ── Desktop Toolbars ───────────────────────────────────────────────── */}
      {desktopToolbar}

      {/* ── Score Canvas ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden bg-sv-bg">
        <ScoreEditor isReadOnly={isReadOnly} />
      </div>

      {/* ── Playback bar (always visible) ─────────────────────────────────── */}
      <div className="flex-shrink-0 border-t border-sv-border bg-sv-card">
        <PlaybackControls />
      </div>

      {/* ── Mobile: Tab bar + sliding tool panel ──────────────────────────── */}
      <div className="md:hidden flex-shrink-0 border-t border-sv-border bg-sv-card">
        {/* Tool panel (visible when toolbarOpen) */}
        {toolbarOpen && (
          <div className="border-b border-sv-border bg-sv-card tool-panel-enter">
            {mobileTabContent[mobileTab]}
          </div>
        )}

        {/* Tab bar */}
        <div className="flex">
          {TAB_CONFIG.map((tab) => {
            const isActive = mobileTab === tab.id;
            const hasNote = tab.id === 'expression' && !!selectedNote;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  if (mobileTab === tab.id) {
                    setToolbarOpen((v) => !v);
                  } else {
                    setMobileTab(tab.id);
                    setToolbarOpen(true);
                  }
                }}
                className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5
                            transition-colors relative ${
                  isActive && toolbarOpen
                    ? 'text-sv-cyan bg-sv-cyan-muted'
                    : 'text-sv-text-muted hover:text-sv-text hover:bg-sv-elevated'
                }`}
              >
                {isActive && toolbarOpen && (
                  <span className="absolute top-0 left-1/4 right-1/4 h-0.5 bg-sv-cyan rounded-b" />
                )}
                <span className="text-base leading-none">{tab.icon}</span>
                <span className="text-[10px] font-medium leading-none">{tab.label}</span>
                {hasNote && (
                  <span className="absolute top-1.5 right-1/4 w-1.5 h-1.5 rounded-full bg-sv-cyan"
                        style={{ boxShadow: '0 0 4px rgba(0,212,245,0.8)' }} />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
