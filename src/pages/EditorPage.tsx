import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useParams, useNavigate, useLocation, useMatch } from 'react-router-dom';
import { useUserStore } from '../app/store/userStore';
import { RevisionTrigger, useScoreStore } from '../app/store/scoreStore';
import { usePlaybackStore } from '../app/store/playbackStore';
import { ensureCompositionOwnerMetadata, getComposition, getCompositionRevisionTimeline, saveComposition, saveCompositionRevisionSnapshot, syncLinkedPartsFromSource } from '../services/compositionService';
import { ScoreEditor } from '../components/editor/ScoreEditor';
import { ScoreInfoPanel } from '../components/toolbar/ScoreInfoPanel';
import { PlaybackControls } from '../components/playback/PlaybackControls';
import { NoteToolbar } from '../components/toolbar/NoteToolbar';
import { RestToolbar } from '../components/toolbar/RestToolbar';
import { VoiceLaneToolbar } from '../components/toolbar/VoiceLaneToolbar';
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
import { AdvancedNotationToolbar } from '../components/toolbar/AdvancedNotationToolbar';
import { GregorianChantToolbar } from '../components/toolbar/GregorianChantToolbar';
import { UndoRedoToolbar } from '../components/toolbar/UndoRedoToolbar';
import { ExportToolbar } from '../components/toolbar/ExportToolbar';
import { VersionHistoryPanel } from '../components/toolbar/VersionHistoryPanel';
import { ChordDetectionPanel } from '../components/toolbar/ChordDetectionPanel';
import { ChordEditor } from '../components/toolbar/ChordEditor';
import { MeasurePropertiesPanel } from '../components/toolbar/MeasurePropertiesPanel';
import { StaffVolumeControls } from '../components/toolbar/StaffVolumeControls';
import { AIArrangementPanel } from '../components/toolbar/AIArrangementPanel';
import { AICompositionPanel } from '../components/toolbar/AICompositionPanel';
import { PartExtractionPanel } from '../components/toolbar/PartExtractionPanel';
import { ScoreReviewPanel } from '../components/review/ScoreReviewPanel';
import { Measure } from '../types/music';
import {
  CollaborationPresence,
  CompositionMeasurePatch,
  PublishMeasurePatchParams,
  clearCompositionMeasurePatches,
  clearCompositionPresence,
  getCompositionEditingSnapshot,
  publishCompositionPresence,
  publishMeasurePatchBatch,
  subscribeToCompositionPresence,
  subscribeToMeasurePatches,
} from '../services/collaborationService';
import {
  FirstScoreOnboardingState,
  getFirstScoreOnboardingState,
  saveFirstScoreOnboardingState,
} from '../services/onboardingService';
import { sharedScheduler } from '../music/playback/toneScheduler';
import { EditorTourOverlay, type EditorTourStepMeta } from '../components/tour/EditorTourOverlay';
import { EDITOR_TOUR_ROUTE, EDITOR_TOUR_STEPS } from '../tour/editorTourSteps';
import { getTourMockComposition } from '../tour/tourMockComposition';
import { useTourAdvanceSatisfied } from '../tour/useTourAdvanceSatisfied';

/** Shared by back navigation and editor unmount — stops transport, soundfonts, and playback UI state. */
const stopEditorPlayback = () => {
  sharedScheduler.setPlaybackCompleteCallback(null);
  sharedScheduler.stop();
  usePlaybackStore.getState().setState('stopped');
};

type MobileTab = 'notes' | 'expression' | 'structure' | 'settings';

const TAB_CONFIG: { id: MobileTab; label: string; icon: string }[] = [
  { id: 'notes',      label: 'Notes',      icon: '♩' },
  { id: 'expression', label: 'Expression', icon: '♯' },
  { id: 'structure',  label: 'Structure',  icon: '𝄞' },
  { id: 'settings',   label: 'Score',      icon: '⚙' },
];

type FirstScoreProgress = {
  placedNote: boolean;
  playedBack: boolean;
  savedScore: boolean;
};

const defaultFirstScoreProgress: FirstScoreProgress = {
  placedNote: false,
  playedBack: false,
  savedScore: false,
};

/** Section ids for collapsible desktop toolbars — expanding one collapses the others so the score stays visible. */
const DESKTOP_TOOLBAR_SECTION_IDS = ['notes', 'structure', 'score', 'expression'] as const;

const measureKey = (staffIndex: number, measureIndex: number) => `${staffIndex}:${measureIndex}`;
const hashMeasure = (measure: Measure | undefined): string => JSON.stringify(measure ?? null);

export const EditorPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const tourMatch = useMatch({ path: EDITOR_TOUR_ROUTE, end: true });
  const isTourMode = tourMatch !== null;
  const user = useUserStore((state) => state.user);
  const composition = useScoreStore((state) => state.composition);
  const setComposition = useScoreStore((state) => state.setComposition);
  const resetComposition = useScoreStore((state) => state.resetComposition);
  const addRevisionSnapshot = useScoreStore((state) => state.addRevisionSnapshot);
  const clearRevisionHistory = useScoreStore((state) => state.clearRevisionHistory);
  const setRevisionHistory = useScoreStore((state) => state.setRevisionHistory);
  const selectedNote = useScoreStore((state) => state.selectedNote);
  const setSelectedNote = useScoreStore((state) => state.setSelectedNote);
  const setSelectedDuration = useScoreStore((state) => state.setSelectedDuration);
  const setSelectedRestDuration = useScoreStore((state) => state.setSelectedRestDuration);
  const selectedStaffIndex = useScoreStore((state) => state.selectedStaffIndex);
  const selectedMeasureIndex = useScoreStore((state) => state.selectedMeasureIndex);
  const selectedVoiceIndex = useScoreStore((state) => state.selectedVoiceIndex);
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
  const [viewModeLiveUpdates, setViewModeLiveUpdates] = useState(false);

  // Collapsible toolbar sections — persisted in localStorage
  const [collapsedRows, setCollapsedRows] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('stavium_toolbar_sections');
      return new Set(stored ? JSON.parse(stored) : []);
    } catch { return new Set(); }
  });
  const toggleRow = (id: string) => {
    setCollapsedRows((prev) => {
      const next = new Set(prev);
      const isCollapsed = next.has(id);
      if (isCollapsed) {
        next.delete(id);
        for (const sid of DESKTOP_TOOLBAR_SECTION_IDS) {
          if (sid !== id) next.add(sid);
        }
      } else {
        next.add(id);
      }
      try {
        localStorage.setItem('stavium_toolbar_sections', JSON.stringify([...next]));
      } catch { /* ignore localStorage failures */ }
      return next;
    });
  };

  useEffect(() => {
    try {
      localStorage.setItem('stavium_toolbar_density', compactToolbar ? 'compact' : 'comfortable');
    } catch { /* ignore localStorage failures */ }
  }, [compactToolbar]);

  // Derived permission flags (recomputed whenever composition or user changes)
  const isOwner = !composition?.userId || composition.userId === user?.uid;
  // Non-owners with view-only permission can never switch to edit mode
  const canEdit = isOwner || composition?.sharePermission === 'edit';
  const [scoreInfoOpen, setScoreInfoOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
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
    if (isTourMode) {
      clearRevisionHistory();
      setComposition(getTourMockComposition());
      setTitle('Guided tour (demo score)');
      setIsReadOnly(false);
      setSelectedDuration('half');
      setSelectedRestDuration(null);
      setLoading(false);
      return;
    }
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
  }, [id, user, navigate, resetComposition, clearRevisionHistory, isTourMode, setComposition, setSelectedDuration, setSelectedRestDuration]);

  const [tourStepIndex, setTourStepIndex] = useState(0);
  const [tourPitchBaseline, setTourPitchBaseline] = useState<string | null>(null);

  useEffect(() => {
    if (isTourMode) setTourStepIndex(0);
  }, [isTourMode]);

  const tourStep = EDITOR_TOUR_STEPS[tourStepIndex];
  const tourAdvanceSatisfied = useTourAdvanceSatisfied(tourStep, isTourMode, tourPitchBaseline);

  /** Hands-on drag step: focus the note in measure 2 and capture pitch baseline once per step */
  useLayoutEffect(() => {
    if (!isTourMode) {
      setTourPitchBaseline(null);
      return;
    }
    const step = EDITOR_TOUR_STEPS[tourStepIndex];
    if (step?.waitFor !== 'change-selected-note-pitch') {
      setTourPitchBaseline(null);
      return;
    }
    const comp = useScoreStore.getState().composition;
    if (!comp) {
      setTourPitchBaseline(null);
      return;
    }
    const notes = comp.staves[0]?.measures[1]?.voices[0]?.notes ?? [];
    const idx = notes.findIndex((e) => 'pitch' in e);
    if (idx < 0) {
      setTourPitchBaseline(null);
      return;
    }
    setSelectedNote({ staffIndex: 0, measureIndex: 1, voiceIndex: 0, noteIndex: idx });
    const n = notes[idx];
    setTourPitchBaseline('pitch' in n ? n.pitch : null);
  }, [isTourMode, tourStepIndex, setSelectedNote]);

  /** Expression overview: select a note so the toolbar row is visible */
  useLayoutEffect(() => {
    if (!isTourMode) return;
    const step = EDITOR_TOUR_STEPS[tourStepIndex];
    if (step?.id !== 'expression-read') return;
    setSelectedNote({ staffIndex: 0, measureIndex: 0, voiceIndex: 0, noteIndex: 0 });
  }, [isTourMode, tourStepIndex, setSelectedNote]);

  /** Leaving tour route — discard mock score so it never leaks into a real editing session */
  useEffect(() => {
    if (!isTourMode) return;
    return () => {
      resetComposition();
    };
  }, [isTourMode, resetComposition]);

  const resetPlaybackTempo = usePlaybackStore((s) => s.setPlaybackTempo);
  const setPlaybackInstrument = usePlaybackStore((s) => s.setPlaybackInstrument);
  const playbackState = usePlaybackStore((s) => s.state);
  const [onboardingHydrated, setOnboardingHydrated] = useState(false);
  const [firstScoreDone, setFirstScoreDone] = useState(false);
  const [checklistDismissed, setChecklistDismissed] = useState(false);
  const [toolbarTipsHidden, setToolbarTipsHidden] = useState(false);
  const [showFirstScoreCelebration, setShowFirstScoreCelebration] = useState(false);
  const [firstScoreProgress, setFirstScoreProgress] = useState<FirstScoreProgress>(defaultFirstScoreProgress);
  const [discardingLiveChanges, setDiscardingLiveChanges] = useState(false);
  const [discardNotice, setDiscardNotice] = useState<string | null>(null);
  const allowLiveScoreSync = !isReadOnly || viewModeLiveUpdates;
  const [collaborators, setCollaborators] = useState<CollaborationPresence[]>([]);
  const [editorsOnOpen, setEditorsOnOpen] = useState<CollaborationPresence[]>([]);
  const [editorsOnOpenCheckedAt, setEditorsOnOpenCheckedAt] = useState<string | null>(null);
  const lastMeasureHashesRef = useRef<Map<string, string>>(new Map());
  const measureUpdateTimesRef = useRef<Map<string, number>>(new Map());
  // Accumulates pending measure patches; flushed as a single writeBatch on the timer.
  const pendingPatchBatchRef = useRef<Map<string, PublishMeasurePatchParams>>(new Map());
  const batchFlushTimerRef = useRef<number | null>(null);
  const seenPatchIdsRef = useRef<Set<string>>(new Set());
  const lastPatchCountRef = useRef(0);
  const suppressPublishMeasureKeysRef = useRef<Set<string>>(new Set());
  const lastAppliedPatchAtRef = useRef<Map<string, number>>(new Map());
  const lastPresencePayloadRef = useRef<string | null>(null);
  const lastPresenceSentAtRef = useRef(0);
  const lastSyncedOnboardingRef = useRef<string | null>(null);
  const cursorActivityRef = useRef<{
    staffIndex: number | null;
    measureIndex: number | null;
    voiceIndex: number | null;
    noteIndex: number | null;
    svgX?: number;
    svgY?: number;
  }>({
    staffIndex: null,
    measureIndex: null,
    voiceIndex: null,
    noteIndex: null,
  });
  const cursorPublishTimerRef = useRef<number | null>(null);
  const skipNextPatchPublishRef = useRef(false);
  const suppressNextDiscardToastRef = useRef(false);
  const remoteCollaborators = useMemo(
    () => collaborators.filter((c) => c.uid !== user?.uid),
    [collaborators, user?.uid]
  );

  const hasAnyScoreElements = useMemo(() => {
    if (!composition) return false;
    return composition.staves.some((staff) =>
      staff.measures.some((measure) =>
        measure.voices.some((voice) => voice.notes.length > 0)
      )
    );
  }, [composition]);

  useEffect(() => {
    let active = true;
    const hydrateOnboarding = async () => {
      if (!user?.uid) {
        setOnboardingHydrated(true);
        return;
      }

      const remote = await getFirstScoreOnboardingState(user.uid);
      if (!active) return;

      if (remote) {
        setFirstScoreProgress({
          placedNote: remote.placedNote,
          playedBack: remote.playedBack,
          savedScore: remote.savedScore,
        });
        setFirstScoreDone(remote.firstScoreDone);
        setChecklistDismissed(remote.checklistDismissed);
        setToolbarTipsHidden(remote.toolbarTipsHidden);
        lastSyncedOnboardingRef.current = JSON.stringify(remote);
      } else {
        lastSyncedOnboardingRef.current = JSON.stringify({
          ...defaultFirstScoreProgress,
          firstScoreDone: false,
          checklistDismissed: false,
          toolbarTipsHidden: false,
        } satisfies FirstScoreOnboardingState);
      }

      setOnboardingHydrated(true);
    };

    hydrateOnboarding();
    return () => {
      active = false;
    };
  }, [user?.uid]);

  useEffect(() => {
    if (isTourMode) return;
    if (!onboardingHydrated || !user?.uid) return;
    const payload: FirstScoreOnboardingState = {
      placedNote: firstScoreProgress.placedNote,
      playedBack: firstScoreProgress.playedBack,
      savedScore: firstScoreProgress.savedScore,
      firstScoreDone,
      checklistDismissed,
      toolbarTipsHidden,
    };
    const payloadJson = JSON.stringify(payload);
    if (payloadJson === lastSyncedOnboardingRef.current) return;
    const timer = window.setTimeout(() => {
      saveFirstScoreOnboardingState(user.uid, payload).catch((error) => {
        console.warn('Failed to sync onboarding state:', error);
        return;
      });
      lastSyncedOnboardingRef.current = payloadJson;
    }, 350);
    return () => window.clearTimeout(timer);
  }, [
    onboardingHydrated,
    user?.uid,
    firstScoreProgress.placedNote,
    firstScoreProgress.playedBack,
    firstScoreProgress.savedScore,
    firstScoreDone,
    checklistDismissed,
    toolbarTipsHidden,
    isTourMode,
  ]);

  useEffect(() => {
    if (firstScoreDone) return;
    if (!hasAnyScoreElements || firstScoreProgress.placedNote) return;
    setFirstScoreProgress((prev) => ({ ...prev, placedNote: true }));
  }, [hasAnyScoreElements, firstScoreProgress.placedNote, firstScoreDone]);

  useEffect(() => {
    if (firstScoreDone) return;
    if (playbackState !== 'playing' || firstScoreProgress.playedBack) return;
    setFirstScoreProgress((prev) => ({ ...prev, playedBack: true }));
  }, [playbackState, firstScoreProgress.playedBack, firstScoreDone]);

  useEffect(() => {
    if (firstScoreDone) return;
    if (!composition?.id || firstScoreProgress.savedScore) return;
    setFirstScoreProgress((prev) => ({ ...prev, savedScore: true }));
  }, [composition?.id, firstScoreProgress.savedScore, firstScoreDone]);

  useEffect(() => {
    if (firstScoreDone) return;
    const allDone = firstScoreProgress.placedNote && firstScoreProgress.playedBack && firstScoreProgress.savedScore;
    if (!allDone) return;
    setFirstScoreDone(true);
    setShowFirstScoreCelebration(true);
    setChecklistDismissed(false);
  }, [firstScoreDone, firstScoreProgress]);

  useEffect(() => {
    if (!showFirstScoreCelebration) return;
    const timer = window.setTimeout(() => setShowFirstScoreCelebration(false), 7000);
    return () => window.clearTimeout(timer);
  }, [showFirstScoreCelebration]);

  const showFirstScoreChecklist = onboardingHydrated && !firstScoreDone && !checklistDismissed && !isReadOnly && !isTourMode;
  const showToolbarTips = onboardingHydrated && !firstScoreDone && !toolbarTipsHidden && !isTourMode;
  const completedChecklistItems = [
    firstScoreProgress.placedNote,
    firstScoreProgress.playedBack,
    firstScoreProgress.savedScore,
  ].filter(Boolean).length;
  const totalChecklistItems = 3;

  const syncMeasureHashesFromComposition = (target: typeof composition) => {
    const nextHashes = new Map<string, string>();
    if (!target) {
      lastMeasureHashesRef.current = nextHashes;
      return;
    }
    target.staves.forEach((staff, staffIndex) => {
      staff.measures.forEach((measure, measureIndex) => {
        nextHashes.set(measureKey(staffIndex, measureIndex), hashMeasure(measure));
      });
    });
    lastMeasureHashesRef.current = nextHashes;
  };

  /**
   * Apply a batch of remote measure patches in a single setComposition call.
   * This avoids N re-renders when a remote reflow affects many measures at once.
   * Returns the IDs of all patches that were processed (applied or skipped as stale).
   */
  const applyRemoteMeasurePatches = (patches: CompositionMeasurePatch[]): string[] => {
    const current = useScoreStore.getState().composition;
    if (!current || patches.length === 0) return [];

    const ensureMeasureShell = (number: number): Measure => ({
      number,
      voices: [{ notes: [] }, { notes: [] }, { notes: [] }, { notes: [] }],
    });

    const staffTemplate = current.staves[0];
    // Shallow-copy staves and their measure arrays so we can apply multiple
    // patches without mutating the store state and without a full deep clone.
    const staves = current.staves.map((staff) => ({
      ...staff,
      measures: [...staff.measures],
    }));

    const processed: string[] = [];
    let anyApplied = false;

    for (const patch of patches) {
      while (staves.length <= patch.staffIndex) {
        const nextIndex = staves.length;
        staves.push({
          clef: staffTemplate?.clef ?? 'treble',
          instrument: staffTemplate?.instrument ?? 'piano',
          name: `Staff ${nextIndex + 1}`,
          measures: [],
        });
      }
      const targetStaff = staves[patch.staffIndex];
      while (targetStaff.measures.length <= patch.measureIndex) {
        targetStaff.measures.push(ensureMeasureShell(targetStaff.measures.length + 1));
      }

      const key = measureKey(patch.staffIndex, patch.measureIndex);
      const currentHash = hashMeasure(targetStaff.measures[patch.measureIndex]);

      // Already at the desired state — nothing to do.
      if (currentHash === patch.nextHash) {
        processed.push(patch.id);
        continue;
      }

      const remoteUpdatedAt = Math.max(patch.createdAtMs, patch.clientTimestamp || 0);
      const lastAppliedAt = lastAppliedPatchAtRef.current.get(key) ?? 0;

      // Stale patch — a newer one was already applied.
      if (remoteUpdatedAt < lastAppliedAt) {
        processed.push(patch.id);
        continue;
      }

      // Apply the measure in-place on the shallow-copied array.
      targetStaff.measures[patch.measureIndex] = patch.measure;
      suppressPublishMeasureKeysRef.current.add(key);
      measureUpdateTimesRef.current.set(key, remoteUpdatedAt);
      lastAppliedPatchAtRef.current.set(key, remoteUpdatedAt);
      processed.push(patch.id);
      anyApplied = true;
    }

    if (anyApplied) {
      setComposition({ ...current, staves });
    }

    return processed;
  };

  const publishPresence = async (options?: { force?: boolean }) => {
    if (!composition?.id || !user?.uid) return;
    if (isReadOnly) return;
    const payload = {
      compositionId: composition.id,
      uid: user.uid,
      displayName: user.displayName,
      email: user.email,
      isEditing: !isReadOnly,
      selection: {
        staffIndex: selectedStaffIndex,
        measureIndex: selectedMeasureIndex,
        voiceIndex: selectedVoiceIndex,
        noteIndex: selectedNote?.noteIndex ?? null,
      },
      cursor: cursorActivityRef.current,
    } as const;
    const signature = JSON.stringify(payload);
    const now = Date.now();
    if (
      !options?.force &&
      signature === lastPresencePayloadRef.current &&
      now - lastPresenceSentAtRef.current < 12_000
    ) {
      return;
    }
    try {
      await publishCompositionPresence(payload);
      lastPresencePayloadRef.current = signature;
      lastPresenceSentAtRef.current = now;
    } catch (error) {
      console.warn('Presence sync failed:', error);
    }
  };

  useEffect(() => {
    if (!discardNotice) return;
    const timer = window.setTimeout(() => setDiscardNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [discardNotice]);

  useEffect(() => {
    return () => {
      if (cursorPublishTimerRef.current) {
        window.clearTimeout(cursorPublishTimerRef.current);
        cursorPublishTimerRef.current = null;
      }
      if (batchFlushTimerRef.current) {
        window.clearTimeout(batchFlushTimerRef.current);
        batchFlushTimerRef.current = null;
      }
      pendingPatchBatchRef.current.clear();
    };
  }, []);

  useEffect(() => {
    seenPatchIdsRef.current.clear();
    lastPatchCountRef.current = 0;
    lastAppliedPatchAtRef.current.clear();
    syncMeasureHashesFromComposition(composition);
    if (!composition?.id || !user?.uid || !allowLiveScoreSync) {
      setCollaborators([]);
      return;
    }
    let unsubPresence: (() => void) | null = null;
    let heartbeat: number | null = null;
    let handleUnload: (() => void) | null = null;
    if (!isReadOnly) {
      unsubPresence = subscribeToCompositionPresence(
        composition.id,
        (presence) => setCollaborators(presence),
        (error) => console.warn('Presence subscription error:', error)
      );
      lastPresencePayloadRef.current = null;
      lastPresenceSentAtRef.current = 0;
      void publishPresence({ force: true });
      heartbeat = window.setInterval(() => {
        void publishPresence({ force: true });
      }, 15_000);
      handleUnload = () => {
        void clearCompositionPresence(composition.id!, user.uid);
      };
      window.addEventListener('beforeunload', handleUnload);
    } else {
      setCollaborators([]);
    }

    const unsubPatches = subscribeToMeasurePatches(
      composition.id,
      (patches, snapshotSize) => {
        const previousPatchCount = lastPatchCountRef.current;
        lastPatchCountRef.current = snapshotSize;
        if (previousPatchCount > 0 && snapshotSize === 0) {
          void (async () => {
            const restored = await getComposition(composition.id!);
            if (!restored) return;
            const shouldShowToast = !suppressNextDiscardToastRef.current;
            suppressNextDiscardToastRef.current = false;
            skipNextPatchPublishRef.current = true;
            seenPatchIdsRef.current.clear();
            suppressPublishMeasureKeysRef.current.clear();
            measureUpdateTimesRef.current.clear();
            syncMeasureHashesFromComposition(restored);
            setComposition(restored);
            setTitle(restored.title || 'Untitled Composition');
            setSelectedNote(null);
            if (shouldShowToast) {
              setDiscardNotice('Live changes were discarded by another editor; score restored to last save.');
            }
          })();
          return;
        }
        const newPatches = patches.filter((p) => !seenPatchIdsRef.current.has(p.id));
        if (newPatches.length > 0) {
          const processedIds = applyRemoteMeasurePatches(newPatches);
          processedIds.forEach((id) => seenPatchIdsRef.current.add(id));
        }
      },
      (error) => console.warn('Patch subscription error:', error)
    );

    return () => {
      if (heartbeat !== null) window.clearInterval(heartbeat);
      if (handleUnload) {
        window.removeEventListener('beforeunload', handleUnload);
      }
      if (!isReadOnly) {
        void clearCompositionPresence(composition.id!, user.uid);
      }
      if (unsubPresence) {
        unsubPresence();
      }
      unsubPatches();
    };
  }, [composition?.id, user?.uid, isReadOnly, allowLiveScoreSync]);

  useEffect(() => {
    if (isReadOnly) return;
    void publishPresence();
  }, [
    composition?.id,
    user?.uid,
    isReadOnly,
    selectedStaffIndex,
    selectedMeasureIndex,
    selectedVoiceIndex,
    selectedNote?.noteIndex,
  ]);

  useEffect(() => {
    if (!composition?.id || !user?.uid || !composition || isReadOnly) return;
    if (skipNextPatchPublishRef.current) {
      skipNextPatchPublishRef.current = false;
      syncMeasureHashesFromComposition(composition);
      return;
    }
    const previousHashes = lastMeasureHashesRef.current;
    const changedMeasures: Array<{
      key: string;
      staffIndex: number;
      measureIndex: number;
      measure: Measure;
      baseHash: string;
      nextHash: string;
    }> = [];
    const nextHashes = new Map<string, string>();

    composition.staves.forEach((staff, staffIndex) => {
      staff.measures.forEach((measure, measureIndex) => {
        const key = measureKey(staffIndex, measureIndex);
        const nextHash = hashMeasure(measure);
        const baseHash = previousHashes.get(key) ?? hashMeasure(undefined);
        nextHashes.set(key, nextHash);
        if (baseHash !== nextHash) {
          changedMeasures.push({ key, staffIndex, measureIndex, measure, baseHash, nextHash });
        }
      });
    });
    lastMeasureHashesRef.current = nextHashes;

    if (changedMeasures.length === 0) return;

    const now = Date.now();
    let hasNewChanges = false;
    changedMeasures.forEach((change) => {
      if (suppressPublishMeasureKeysRef.current.has(change.key)) {
        suppressPublishMeasureKeysRef.current.delete(change.key);
        return;
      }
      measureUpdateTimesRef.current.set(change.key, now);
      // Accumulate into the pending batch (later update overwrites earlier for same key)
      pendingPatchBatchRef.current.set(change.key, {
        compositionId: composition.id!,
        actorUid: user.uid,
        actorName: user.displayName,
        staffIndex: change.staffIndex,
        measureIndex: change.measureIndex,
        measure: change.measure,
        baseHash: change.baseHash,
        nextHash: change.nextHash,
        clientTimestamp: now,
      });
      hasNewChanges = true;
    });

    if (hasNewChanges) {
      // Reset the single flush timer so rapid edits coalesce into one writeBatch call.
      // A 100 ms window keeps latency low for single-measure edits while ensuring
      // that a reflow touching many measures is still sent as one round-trip.
      if (batchFlushTimerRef.current) window.clearTimeout(batchFlushTimerRef.current);
      batchFlushTimerRef.current = window.setTimeout(() => {
        const batch = [...pendingPatchBatchRef.current.values()].map((p) => ({
          ...p,
          clientTimestamp: Date.now(),
        }));
        pendingPatchBatchRef.current.clear();
        batchFlushTimerRef.current = null;
        if (batch.length === 0) return;
        void publishMeasurePatchBatch(batch).catch((error) => {
          console.warn('Measure patch batch publish failed:', error);
        });
      }, 100);
    }
  }, [composition, composition?.id, user?.uid, user?.displayName, isReadOnly]);
  
  const loadComposition = async (compositionId: string) => {
    try {
      setLoading(true);
      setViewModeLiveUpdates(false);
      clearRevisionHistory();
      setEditorsOnOpen([]);
      setEditorsOnOpenCheckedAt(null);
      const comp = await getComposition(compositionId);
      if (comp) {
        syncMeasureHashesFromComposition(comp);
        setComposition(comp);
        const [revisionTimeline, editingSnapshot] = await Promise.all([
          getCompositionRevisionTimeline(comp.id || compositionId),
          getCompositionEditingSnapshot(comp.id || compositionId, user?.uid),
        ]);
        setRevisionHistory(
          revisionTimeline.map((revision) => ({
            id: revision.id,
            createdAt: revision.createdAt,
            trigger: revision.trigger,
            label: revision.label,
            composition: revision.composition,
          }))
        );
        setEditorsOnOpen(editingSnapshot);
        setEditorsOnOpenCheckedAt(new Date().toISOString());
        setTitle(comp.title);
        setIsReadOnly(true); // Always start read-only when opening a saved composition
        resetPlaybackTempo(null); // Reset playback tempo when loading new composition
        // Reset playback instruments when loading new composition
        comp.staves.forEach((_, index) => setPlaybackInstrument(index, null));

        // Backfill legacy documents that predate owner metadata fields.
        if (
          user &&
          comp.userId === user.uid &&
          (!comp.ownerEmail || !comp.ownerName)
        ) {
          ensureCompositionOwnerMetadata({
            compositionId: comp.id || compositionId,
            ownerUid: user.uid,
            ownerEmail: user.email,
            ownerName: user.displayName,
          }).catch(() => {});

          setComposition({
            ...comp,
            ownerEmail: comp.ownerEmail || user.email || undefined,
            ownerName: comp.ownerName || user.displayName || undefined,
          });
        }
      }
    } catch (error) {
      console.error('Error loading composition:', error);
    } finally {
      setLoading(false);
    }
  };

  const persistRevisionSnapshot = async (trigger: RevisionTrigger, sourceComposition?: typeof composition) => {
    if (isTourMode) return;
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
    if (isTourMode) return;
    if (!user || !composition) return;
    try {
      setSaving(true);
      // Preserve the original owner's userId so the document's userId field never changes.
      // Pass the current user's uid separately as modifiedBy so we always know who last saved.
      const ownerId = composition.userId || user.uid;
      const savedId = await saveComposition(
        { ...composition, id: id || undefined, title, userId: ownerId },
        ownerId,
        user.uid,   // modifiedBy — the actual person hitting Save
        {
          ownerEmail: user.email,
          ownerName: user.displayName,
        }
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

      // Keep previously generated linked parts in sync whenever the full score is saved,
      // unless the user disables auto-sync for this score.
      if (
        !syncedComposition.linkedPartSource &&
        syncedComposition.id &&
        syncedComposition.autoSyncLinkedPartsOnSave !== false
      ) {
        void syncLinkedPartsFromSource({
          sourceComposition: syncedComposition,
          sourceCompositionId: syncedComposition.id,
          ownerUid: user.uid,
          viewerUid: user.uid,
          modifiedByUid: user.uid,
          ownerMeta: {
            ownerEmail: user.email,
            ownerName: user.displayName,
          },
        }).catch((syncError) => {
          console.warn('Linked part sync after save failed:', syncError);
        });
      }

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

  const handleTourExit = useCallback(() => {
    stopEditorPlayback();
    setTourStepIndex(0);
    resetComposition();
    navigate('/dashboard');
  }, [navigate, resetComposition]);

  const handleTourStepMeta = useCallback((meta: EditorTourStepMeta) => {
    if (meta.expandSections?.length) {
      setCollapsedRows((prev) => {
        const next = new Set(prev);
        for (const sectionId of meta.expandSections!) {
          next.delete(sectionId);
        }
        try {
          localStorage.setItem('stavium_toolbar_sections', JSON.stringify([...next]));
        } catch { /* ignore localStorage failures */ }
        return next;
      });
    }
    if (meta.collapseSections?.length) {
      setCollapsedRows((prev) => {
        const next = new Set(prev);
        for (const sectionId of meta.collapseSections!) {
          next.add(sectionId);
        }
        try {
          localStorage.setItem('stavium_toolbar_sections', JSON.stringify([...next]));
        } catch { /* ignore localStorage failures */ }
        return next;
      });
    }
    if (meta.expandMobileTab) {
      setMobileTab(meta.expandMobileTab);
      setToolbarOpen(true);
    }
    if (meta.collapseMobileToolbar) {
      setToolbarOpen(false);
    }
  }, []);

  /** Apply tour layout (expanded sections + mobile tab) in the same commit as the step change so spotlight measures real targets. */
  useLayoutEffect(() => {
    if (!isTourMode) return;
    const step = EDITOR_TOUR_STEPS[tourStepIndex];
    flushSync(() => {
      handleTourStepMeta({
        expandSections: step.expandSections,
        collapseSections: step.collapseSections,
        collapseMobileToolbar: step.collapseMobileToolbar,
        expandMobileTab: step.expandMobileTab,
      });
    });
  }, [isTourMode, tourStepIndex, handleTourStepMeta]);

  const handleBack = () => {
    stopEditorPlayback();
    navigate('/dashboard');
  };

  // Stop audio when leaving the editor by any route (unmount)
  useEffect(() => () => stopEditorPlayback(), []);
  const handleDiscardLiveChanges = async () => {
    if (!composition?.id || !user?.uid) return;
    const confirmed = window.confirm(
      'Discard all unsaved live collaboration changes and restore the last saved score?'
    );
    if (!confirmed) return;

    try {
      setDiscardingLiveChanges(true);
      suppressNextDiscardToastRef.current = true;
      // Fetch the saved composition and delete all live patches in parallel
      // so neither operation waits on the other.
      const [restored] = await Promise.all([
        getComposition(composition.id),
        clearCompositionMeasurePatches(composition.id),
      ]);
      if (restored) {
        skipNextPatchPublishRef.current = true;
        seenPatchIdsRef.current.clear();
        suppressPublishMeasureKeysRef.current.clear();
        measureUpdateTimesRef.current.clear();
        syncMeasureHashesFromComposition(restored);
        setComposition(restored);
        setTitle(restored.title || 'Untitled Composition');
        setSelectedNote(null);
        alert('Unsaved live collaboration changes discarded. Restored last saved version.');
      } else {
        suppressNextDiscardToastRef.current = false;
        alert('Could not reload saved score after discard.');
      }
    } catch (error) {
      suppressNextDiscardToastRef.current = false;
      console.error('Error discarding live collaboration changes:', error);
      alert('Failed to discard live collaboration changes.');
    } finally {
      setDiscardingLiveChanges(false);
    }
  };
  const handleCursorActivity = (payload: {
    staffIndex: number | null;
    measureIndex: number | null;
    voiceIndex: number | null;
    noteIndex: number | null;
    svgX?: number;
    svgY?: number;
  }) => {
    cursorActivityRef.current = payload;
    if (isReadOnly) return;
    if (!composition?.id || !user?.uid) return;
    if (cursorPublishTimerRef.current) {
      window.clearTimeout(cursorPublishTimerRef.current);
    }
    cursorPublishTimerRef.current = window.setTimeout(() => {
      void publishPresence();
      cursorPublishTimerRef.current = null;
    }, 120);
  };

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
  const ToolbarTip = ({ text }: { text: string }) => (
    <div className="w-full mb-1 px-2 py-1.5 rounded-md border border-sv-cyan/25 bg-sv-cyan/10 text-[11px] text-sv-cyan leading-relaxed">
      {text}
    </div>
  );

  const notesTipText = !hasAnyScoreElements
    ? 'Step 1: choose a duration in Notes, then click the staff to place your first note.'
    : selectedNote
    ? 'Great. Drag this note up/down to change pitch, or drag off staff to delete.'
    : 'Nice progress. Click any note to unlock Expression tools.';
  const structureTipText = (composition?.staves.length ?? 0) <= 1
    ? 'Building SATB or an ensemble? Add another staff here.'
    : 'Use Measure Properties for per-measure tempo, key, and time changes.';
  const scoreSettingsTipText = composition?.id
    ? 'Saved. Next: open Score Info in the header to set sharing.'
    : 'Step 3: set title/tempo, then click Save in the header.';
  const expressionTipText = isGregorianChant
    ? 'With a note selected, shape phrasing using chant symbols and ornaments.'
    : 'With a note selected, add accidentals, dynamics, lyrics, and chords.';

  /* ── Desktop toolbar rows ─────────────────────────────────────────────── */
  const desktopToolbar = (
    <div className="hidden md:flex flex-col bg-sv-card border-b border-sv-border">
      {showFirstScoreChecklist && (
        <div className="px-3 pt-3 pb-2 border-b border-sv-border">
          <div className="rounded-lg border border-sv-cyan/30 bg-sv-cyan/10 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-sv-cyan">First score checklist</p>
                <p className="text-[11px] text-sv-text-muted mt-0.5">
                  {completedChecklistItems}/{totalChecklistItems} complete - finish these three actions to complete onboarding.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setToolbarTipsHidden((prev) => {
                      return !prev;
                    });
                  }}
                  className="text-[11px] px-2 py-1 rounded border border-sv-border text-sv-text-muted hover:text-sv-text hover:border-sv-border-lt transition-colors"
                  title={toolbarTipsHidden ? 'Show contextual toolbar tips' : 'Hide contextual toolbar tips'}
                >
                  {toolbarTipsHidden ? 'Show Tip Bubbles' : 'Hide Tip Bubbles'}
                </button>
                <button
                  onClick={() => {
                    setChecklistDismissed(true);
                  }}
                  className="text-[11px] px-2 py-1 rounded border border-sv-border text-sv-text-muted hover:text-sv-text hover:border-sv-border-lt transition-colors"
                  title="Dismiss checklist for now"
                >
                  Not Now
                </button>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
              <div className={`rounded border px-2 py-1.5 ${firstScoreProgress.placedNote ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-sv-border bg-sv-card text-sv-text-muted'}`}>
                {firstScoreProgress.placedNote ? '✓' : '1.'} Place first note
              </div>
              <div className={`rounded border px-2 py-1.5 ${firstScoreProgress.playedBack ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-sv-border bg-sv-card text-sv-text-muted'}`}>
                {firstScoreProgress.playedBack ? '✓' : '2.'} Play once
              </div>
              <div className={`rounded border px-2 py-1.5 ${firstScoreProgress.savedScore ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-sv-border bg-sv-card text-sv-text-muted'}`}>
                {firstScoreProgress.savedScore ? '✓' : '3.'} Save score
              </div>
            </div>
          </div>
        </div>
      )}
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
          <PartExtractionPanel isReadOnly={true} />
          <Sep />
          <ExportToolbar isReadOnly={true} onSnapshotEvent={persistRevisionSnapshot} />
          <Sep />
          <VersionHistoryPanel isReadOnly={true} />
        </div>
      ) : (
        <>
          {/* ── Section 1: Notes & Rests ──────────────────────────────────── */}
          <div className="sv-section-notes border-b border-sv-border" data-tour-id="tour-toolbar-notes">
            <SectionHeader id="notes" icon="♩" label={isGregorianChant ? 'Neumes' : 'Notes & Rests'} />
            {!collapsedRows.has('notes') && (
              <div className="flex flex-wrap 2xl:flex-nowrap items-start gap-2 px-3 py-2">
            {showToolbarTips && <ToolbarTip text={notesTipText} />}
            <VoiceLaneToolbar />
                <div className="hidden 2xl:block"><Sep /></div>
            <NoteToolbar />
                {!isGregorianChant && <div className="hidden 2xl:block"><Sep /></div>}
            {!isGregorianChant && <RestToolbar />}
                <div className="hidden 2xl:block"><Sep /></div>
            <UndoRedoToolbar />
              </div>
            )}
          </div>

          {/* ── Section 2: Structure ─────────────────────────────────────── */}
          <div className="sv-section-structure border-b border-sv-border" data-tour-id="tour-toolbar-structure">
            <SectionHeader id="structure" icon="⊞" label="Structure" />
            {!collapsedRows.has('structure') && (
              <div className="flex flex-wrap 2xl:flex-nowrap items-start gap-2 px-3 py-2">
            {showToolbarTips && <ToolbarTip text={structureTipText} />}
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
            {!isGregorianChant && <AICompositionPanel isReadOnly={isReadOnly} />}
                <div className="hidden 2xl:block"><Sep /></div>
            <PartExtractionPanel isReadOnly={isReadOnly} />
                <div className="hidden 2xl:block"><Sep /></div>
            <ExportToolbar isReadOnly={false} onSnapshotEvent={persistRevisionSnapshot} />
                <div className="hidden 2xl:block"><Sep /></div>
            <VersionHistoryPanel isReadOnly={false} />
              </div>
            )}
          </div>

          {/* ── Section 3: Score Settings ─────────────────────────────────── */}
          <div
            className={`sv-section-score ${selectedNote && !collapsedRows.has('expression') ? 'border-b border-sv-border' : ''}`}
            data-tour-id="tour-toolbar-score"
          >
            <SectionHeader id="score" icon="♫" label="Score Settings" />
            {!collapsedRows.has('score') && (
              <div className="flex flex-wrap 2xl:flex-nowrap items-start gap-2 px-3 py-2">
            {showToolbarTips && <ToolbarTip text={scoreSettingsTipText} />}
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
            <div className="sv-section-expression" data-tour-id="tour-toolbar-expression">
              <SectionHeader id="expression" icon="✦" label="Note Expression" pulse />
              {!collapsedRows.has('expression') && (
            <div className="flex flex-wrap 2xl:flex-nowrap items-start gap-2 px-3 py-2">
              {showToolbarTips && <ToolbarTip text={expressionTipText} />}
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
                  <AdvancedNotationToolbar />
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
      <div className="flex flex-col gap-2 p-3">
        {showToolbarTips && <ToolbarTip text={notesTipText} />}
        <VoiceLaneToolbar />
        <NoteToolbar />
        {!isGregorianChant && <RestToolbar />}
      </div>
    ),
    expression: isReadOnly ? readOnlyNotice : (
      <div className="flex flex-col gap-2 p-3">
        {selectedNote ? (
          <>
            {showToolbarTips && <ToolbarTip text={expressionTipText} />}
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
                <AdvancedNotationToolbar />
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
      <div className="flex flex-col gap-2 p-3">
        {showToolbarTips && <ToolbarTip text={structureTipText} />}
        <StaffControls />
        {!isGregorianChant && <MeasureControls />}
        <div className="flex flex-wrap gap-2">
          <ClefSelector />
          <InstrumentSelector isReadOnly={isReadOnly} />
          <MeasurePropertiesPanel />
        </div>
        {!isGregorianChant && <AIArrangementPanel isReadOnly={isReadOnly} />}
        {!isGregorianChant && <AICompositionPanel isReadOnly={isReadOnly} />}
        <PartExtractionPanel isReadOnly={isReadOnly} />
        <StaffVolumeControls />
      </div>
    ),
    settings: (
      <div className="flex flex-col gap-2 p-3">
        {showToolbarTips && <ToolbarTip text={scoreSettingsTipText} />}
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
          <PartExtractionPanel isReadOnly={isReadOnly} />
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
      {isTourMode && (
        <div
          data-tour-id="tour-banner"
          className="flex-shrink-0 px-3 py-2 border-b border-amber-500/35 bg-amber-500/10 text-center"
        >
          <p className="text-xs sm:text-sm text-amber-200 font-medium">
            Tour mode — sample score only. Nothing you change here is saved to your account.
          </p>
        </div>
      )}

      {/* ── Top Header ─────────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 bg-sv-card border-b border-sv-border px-2 py-2 sm:px-3 flex flex-wrap items-center gap-x-2 gap-y-2">
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
          type="button"
          data-tour-id="tour-header-help"
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
          type="button"
          data-tour-id="tour-header-score-info"
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
          user={user}
        />

        <button
          onClick={() => setReviewOpen(true)}
          disabled={!composition?.id}
          className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium
                     transition-all duration-150 ${
            composition?.id
              ? 'bg-sv-elevated border-sv-border text-sv-text-muted hover:text-sv-text hover:border-sv-border-lt'
              : 'bg-sv-elevated border-sv-border text-sv-text-dim opacity-50 cursor-not-allowed'
          }`}
          title={composition?.id ? 'Open review comments' : 'Save composition to enable review comments'}
        >
          <span>💬</span>
          <span className="hidden sm:inline">Review</span>
        </button>
        {remoteCollaborators.length > 0 && (
          <div className="hidden lg:flex items-center gap-1.5 flex-shrink-0">
            <span className="text-[11px] text-sv-text-muted">In score:</span>
            {remoteCollaborators.slice(0, 3).map((collab) => (
              <span
                key={collab.id}
                className="px-2 py-1 rounded-full text-[11px] border"
                style={{
                  borderColor: `${collab.color}66`,
                  background: `${collab.color}20`,
                  color: collab.color,
                }}
                title={collab.email || collab.displayName || 'Collaborator'}
              >
                {collab.displayName || collab.email?.split('@')[0] || 'Collaborator'}
              </span>
            ))}
            {remoteCollaborators.length > 3 && (
              <span className="text-[11px] text-sv-text-dim">
                +{remoteCollaborators.length - 3}
              </span>
            )}
          </div>
        )}
        {showFirstScoreCelebration && (
          <div className="sv-onboarding-success flex-shrink-0 hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 text-emerald-300 text-xs font-medium">
            <span>✅</span>
            <span>First score complete</span>
          </div>
        )}

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
        {isReadOnly && composition?.id && (
          <label
            className={`flex-shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs ${
              viewModeLiveUpdates
                ? 'border-emerald-400/40 bg-emerald-500/12 text-emerald-300'
                : 'border-sv-border bg-sv-elevated text-sv-text-muted'
            }`}
            title="When on, this score view receives live collaboration updates in View mode."
          >
            <input
              type="checkbox"
              checked={viewModeLiveUpdates}
              onChange={(e) => setViewModeLiveUpdates(e.target.checked)}
              className="w-3.5 h-3.5"
            />
            <span className="hidden sm:inline">Live score updates</span>
            <span className="sm:hidden">Live</span>
          </label>
        )}
        {isReadOnly && editorsOnOpen.length > 0 && (
          <div
            className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-medium"
            title={`Checked on load${editorsOnOpenCheckedAt ? ` at ${new Date(editorsOnOpenCheckedAt).toLocaleTimeString()}` : ''}. Snapshot only (not live status).`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
            <span className="hidden sm:inline">
              Being edited ({editorsOnOpen.length})
            </span>
            <span className="sm:hidden">Editing</span>
          </div>
        )}

        {/* Title input — full-width row on narrow screens so Save/Discard are not clipped */}
        <input
          type="text"
          data-tour-id="tour-header-title"
          value={title}
          onChange={(e) => { if (!isReadOnly) setTitle(e.target.value); }}
          readOnly={isReadOnly}
          className={`min-w-0 px-3 py-1.5 bg-sv-elevated border border-sv-border rounded-lg
                     text-sv-text text-sm font-medium placeholder-sv-text-dim
                     focus:outline-none focus:border-sv-cyan/60 focus:ring-1 focus:ring-sv-cyan/20
                     transition-colors ${isReadOnly ? 'cursor-default select-none' : ''}
                     flex-[1_1_100%] md:flex-1 md:basis-auto`}
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

        {/* Discard + Save — full-width row on mobile; md:order-last keeps at end on desktop */}
        <div className="flex w-full flex-[1_1_100%] flex-wrap items-center justify-end gap-2 md:order-last md:ml-auto md:w-auto md:flex-[0_0_auto]">
          <button
            type="button"
            onClick={handleDiscardLiveChanges}
            disabled={discardingLiveChanges || !composition?.id || isReadOnly}
            className={`flex items-center gap-1.5 px-2 py-1.5 sm:px-3 rounded-lg text-xs sm:text-sm font-medium border transition-all duration-200 ${
              discardingLiveChanges
                ? 'bg-sv-elevated border-sv-border text-sv-text-dim'
                : 'bg-sv-elevated border-sv-border text-rose-400 hover:text-rose-300 hover:border-rose-500/50'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
            title={
              !composition?.id
                ? 'Save score first to enable discard'
                : isReadOnly
                ? 'Switch to Edit mode to discard unsaved changes'
                : 'Removes unsaved live co-edit changes and restores last saved version.'
            }
          >
            {discardingLiveChanges ? (
              <>
                <span className="md:hidden">…</span>
                <span className="hidden md:inline">Discarding…</span>
              </>
            ) : (
              <>
                <span className="md:hidden">Discard</span>
                <span className="hidden md:inline">Discard Unsaved Changes</span>
              </>
            )}
          </button>
          <button
            type="button"
            data-tour-id="tour-header-save"
            onClick={handleSave}
            disabled={saving || isReadOnly || isTourMode}
            style={{ display: isReadOnly ? 'none' : undefined }}
            className={`flex items-center gap-1 sm:gap-1.5 px-2 py-1.5 sm:px-3 rounded-lg text-xs sm:text-sm font-medium
                        transition-all duration-200 ${
              saveSuccess
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                : 'bg-sv-cyan text-sv-bg border border-sv-cyan hover:bg-sv-cyan-dim shadow-glow-sm'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
            title={isTourMode ? 'Disabled during tour — sample score is not saved' : 'Save (Ctrl+S)'}
          >
            {saving ? (
              <>
                <span className="w-3 h-3 border-2 border-sv-bg border-t-transparent rounded-full animate-spin" />
                <span>Saving…</span>
              </>
            ) : saveSuccess ? (
              <>
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                <span>Saved!</span>
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                </svg>
                <span>Save</span>
              </>
            )}
          </button>
        </div>

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
      </header>

      {/* ── Desktop Toolbars ───────────────────────────────────────────────── */}
      {desktopToolbar}

      {/* Mobile: score + playback + tool shell share one flex column so bottom tabs stay in view; md:contents keeps desktop layout unchanged */}
      <div className="max-md:flex max-md:min-h-0 max-md:flex-1 max-md:flex-col max-md:overflow-hidden md:contents">
        {/* ── Score Canvas ──────────────────────────────────────────────────── */}
        <div
          className="max-md:min-h-[18vh] max-md:flex-[3] overflow-hidden bg-sv-bg md:min-h-0 md:flex-1"
          data-tour-id="tour-score-canvas"
        >
          <ScoreEditor
            isReadOnly={isReadOnly}
            remotePresence={remoteCollaborators}
            onCursorActivity={handleCursorActivity}
          />
        </div>

        {/* ── Playback bar (always visible) ─────────────────────────────────── */}
        <div className="flex-shrink-0 border-t border-sv-border bg-sv-card" data-tour-id="tour-playback">
          <PlaybackControls isReadOnly={isReadOnly} />
        </div>

        {/* ── Mobile: scrollable tool panel + docked tab bar ─────────────────── */}
        <div className="md:hidden flex min-h-0 max-md:flex-[2] flex-col overflow-hidden border-t border-sv-border bg-sv-card">
          {toolbarOpen && (
            <div className="tool-panel-enter min-h-0 flex-1 overflow-y-auto overscroll-y-contain border-b border-sv-border bg-sv-card">
              {mobileTabContent[mobileTab]}
            </div>
          )}
          <div
            className="mt-auto flex w-full shrink-0 border-t border-sv-border/90 bg-sv-card pb-[max(0.25rem,env(safe-area-inset-bottom,0px))] shadow-[0_-4px_16px_rgba(0,0,0,0.28)]"
            data-tour-id="tour-mobile-tab-bar"
          >
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
                  className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5
                            transition-colors relative min-h-[44px] ${
                    isActive && toolbarOpen
                      ? 'text-sv-cyan bg-sv-cyan-muted'
                      : 'text-sv-text-muted hover:text-sv-text hover:bg-sv-elevated'
                  }`}
                >
                  {isActive && toolbarOpen && (
                    <span className="absolute top-0 left-1/4 right-1/4 h-0.5 rounded-b bg-sv-cyan" />
                  )}
                  <span className="text-base leading-none">{tab.icon}</span>
                  <span className="text-[10px] font-medium leading-none">{tab.label}</span>
                  {hasNote && (
                    <span
                      className="absolute right-1/4 top-1.5 h-1.5 w-1.5 rounded-full bg-sv-cyan"
                      style={{ boxShadow: '0 0 4px rgba(0,212,245,0.8)' }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <ScoreReviewPanel
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        compositionId={composition?.id}
        selectedStaffIndex={selectedStaffIndex}
        selectedMeasureIndex={selectedMeasureIndex}
        staves={composition?.staves ?? []}
        user={user}
      />
      {discardNotice && (
        <div className="fixed right-4 top-20 z-50 max-w-sm rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-sm text-amber-200 shadow-lg">
          {discardNotice}
        </div>
      )}

      {isTourMode && (
        <EditorTourOverlay
          steps={EDITOR_TOUR_STEPS}
          stepIndex={tourStepIndex}
          onStepIndexChange={setTourStepIndex}
          advanceSatisfied={tourAdvanceSatisfied}
          onExit={handleTourExit}
        />
      )}
    </div>
  );
};
