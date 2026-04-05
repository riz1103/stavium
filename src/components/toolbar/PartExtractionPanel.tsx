import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserStore } from '../../app/store/userStore';
import { useScoreStore } from '../../app/store/scoreStore';
import { getStaffDisplayLabel, getVoiceDisplayLabel } from '../../utils/partExtractionUtils';
import {
  getComposition,
  getLinkedPartCompositions,
  LinkedPartSelection,
  refreshLinkedPartComposition,
  syncLinkedPartsFromSource,
} from '../../services/compositionService';

interface PartExtractionPanelProps {
  isReadOnly?: boolean;
}

type LinkedPartSummary = {
  id: string;
  title: string;
  staffLabel: string;
  voiceLabel: string;
};

const STAFF_ALL_KEY = (staffIndex: number) => `${staffIndex}:all`;
const STAFF_VOICE_KEY = (staffIndex: number, voiceIndex: number) => `${staffIndex}:v${voiceIndex}`;

const parseSelectionKey = (key: string): LinkedPartSelection | null => {
  const [staff, voice] = key.split(':');
  const staffIndex = Number(staff);
  if (!Number.isInteger(staffIndex) || staffIndex < 0) return null;
  if (voice === 'all') return { staffIndex, voiceIndex: null };
  if (voice?.startsWith('v')) {
    const voiceIndex = Number(voice.slice(1));
    if (Number.isInteger(voiceIndex) && voiceIndex >= 0 && voiceIndex < 4) {
      return { staffIndex, voiceIndex };
    }
  }
  return null;
};

const voiceHasContent = (notes: Array<{ notes: unknown[] }> | undefined, voiceIndex: number): boolean =>
  Array.isArray(notes) && Array.isArray(notes[voiceIndex]?.notes) && notes[voiceIndex].notes.length > 0;

const toErrorText = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown error';

export const PartExtractionPanel = ({ isReadOnly = false }: PartExtractionPanelProps) => {
  const navigate = useNavigate();
  const user = useUserStore((s) => s.user);
  const composition = useScoreStore((s) => s.composition);
  const setComposition = useScoreStore((s) => s.setComposition);
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState('');
  const [linkedParts, setLinkedParts] = useState<LinkedPartSummary[]>([]);
  const [selectionKeys, setSelectionKeys] = useState<string[]>([]);
  const [targetsOpen, setTargetsOpen] = useState(false);

  const linkedSource = composition?.linkedPartSource;
  const isLinkedPart = !!linkedSource;

  const ownerUid = useMemo(() => {
    if (!user) return null;
    return user.uid;
  }, [user]);

  const staffVoiceOptions = useMemo(() => {
    if (!composition || isLinkedPart) return [];
    return composition.staves.map((staff, staffIndex) => {
      const voiceIndexes = [0, 1, 2, 3].filter(
        (voiceIndex) =>
          voiceIndex === 0 ||
          staff.measures.some((measure) => voiceHasContent(measure.voices as any, voiceIndex))
      );
      return {
        staffIndex,
        staffLabel: getStaffDisplayLabel(staff, staffIndex),
        voiceIndexes,
      };
    });
  }, [composition, isLinkedPart]);

  const selectedTargetCount = useMemo(() => selectionKeys.length, [selectionKeys]);

  useEffect(() => {
    if (!composition || isLinkedPart) {
      setSelectionKeys([]);
      return;
    }
    setSelectionKeys(composition.staves.map((_, staffIndex) => STAFF_ALL_KEY(staffIndex)));
  }, [composition?.id, composition?.staves.length, isLinkedPart]);

  useEffect(() => {
    let active = true;
    const loadLinkedParts = async () => {
      if (!composition?.id || isLinkedPart || !user?.uid) {
        if (active) setLinkedParts([]);
        return;
      }
      const linked = await getLinkedPartCompositions(composition.id, user.uid);
      if (!active) return;
      setLinkedParts(
        linked
          .filter((part): part is typeof part & { id: string } => !!part.id)
          .map((part) => ({
            id: part.id,
            title: part.title || 'Untitled Part',
            staffLabel: part.linkedPartSource?.staffLabel || 'Part',
            voiceLabel: getVoiceDisplayLabel(part.linkedPartSource?.voiceIndex),
          }))
      );
    };
    void loadLinkedParts();
    return () => {
      active = false;
    };
  }, [composition?.id, isLinkedPart, user?.uid]);

  const handleGenerateOrSyncParts = async () => {
    if (!composition || !user || !ownerUid) return;
    if (!composition.id) {
      setStatus('Save this score first, then extract linked parts.');
      return;
    }
    const selections = selectionKeys
      .map(parseSelectionKey)
      .filter((selection): selection is LinkedPartSelection => !!selection);
    if (selections.length === 0) {
      setStatus('Select at least one staff or voice target first.');
      return;
    }

    try {
      setSyncing(true);
      setStatus('');
      const result = await syncLinkedPartsFromSource({
        sourceComposition: composition,
        sourceCompositionId: composition.id,
        ownerUid,
        viewerUid: user.uid,
        partSelections: selections,
        modifiedByUid: user.uid,
        ownerMeta: {
          ownerEmail: user.email,
          ownerName: user.displayName,
        },
      });

      const refreshedLinked = await getLinkedPartCompositions(composition.id, user.uid);
      setLinkedParts(
        refreshedLinked
          .filter((part): part is typeof part & { id: string } => !!part.id)
          .map((part) => ({
            id: part.id,
            title: part.title || 'Untitled Part',
            staffLabel: part.linkedPartSource?.staffLabel || 'Part',
            voiceLabel: getVoiceDisplayLabel(part.linkedPartSource?.voiceIndex),
          }))
      );
      setStatus(
        `Linked parts synced (${selections.length} target${selections.length === 1 ? '' : 's'}): ${result.created} created, ${result.updated} updated, ${result.skipped} unchanged.`
      );
    } catch (error) {
      console.error('Error syncing linked parts:', error);
      setStatus(`Failed to sync linked parts: ${toErrorText(error)}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleRefreshThisPart = async () => {
    if (!composition || !linkedSource || !user || !ownerUid) return;
    try {
      setSyncing(true);
      setStatus('');
      const result = await refreshLinkedPartComposition({
        partComposition: composition,
        ownerUid,
        modifiedByUid: user.uid,
        ownerMeta: {
          ownerEmail: user.email,
          ownerName: user.displayName,
        },
      });

      if (result.refreshed && result.partId) {
        const refreshed = await getComposition(result.partId);
        if (refreshed) {
          setComposition(refreshed);
        }
        setStatus('Part refreshed from source score.');
        return;
      }

      if (result.reason === 'up-to-date') {
        setStatus('Part already matches source score.');
        return;
      }

      if (result.reason === 'missing-source') {
        setStatus('Source score not found for this linked part.');
        return;
      }

      if (result.reason === 'missing-source-staff') {
        setStatus('Source staff no longer exists in the full score.');
        return;
      }

      setStatus('This score is not linked to a source part.');
    } catch (error) {
      console.error('Error refreshing linked part:', error);
      setStatus(`Failed to refresh linked part from source: ${toErrorText(error)}`);
    } finally {
      setSyncing(false);
    }
  };

  if (!composition) return null;

  if (isLinkedPart) {
    return (
      <div className="sv-toolbar flex-wrap gap-y-1.5">
        <span className="sv-toolbar-label">Linked Part</span>
        <button
          onClick={handleRefreshThisPart}
          disabled={syncing || isReadOnly}
          className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-sv-cyan text-sv-bg hover:bg-sv-cyan-dim disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Refresh this part from latest source score"
        >
          {syncing ? 'Refreshing...' : 'Refresh from source'}
        </button>
        <button
          onClick={() => navigate(`/editor/${linkedSource.compositionId}`)}
          className="px-2.5 py-1.5 rounded-md text-xs font-medium border border-sv-border text-sv-text-muted hover:text-sv-text hover:border-sv-border-lt transition-colors"
          title="Open source full score"
        >
          Open source score
        </button>
        <span className="text-xs text-sv-text-dim max-w-[380px] truncate">
          Source: {linkedSource.sourceTitle} - {linkedSource.staffLabel}
        </span>
        {status && <span className="text-xs text-sv-text-dim max-w-[360px] truncate">{status}</span>}
        {isReadOnly && (
          <span className="text-xs text-amber-400">Switch to Edit mode to refresh this part.</span>
        )}
      </div>
    );
  }

  return (
    <div className="sv-toolbar flex-wrap gap-y-1.5 max-w-[900px]">
      <span className="sv-toolbar-label">Part Extraction</span>
      <button
        onClick={handleGenerateOrSyncParts}
        disabled={syncing || isReadOnly}
        className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-sv-cyan text-sv-bg hover:bg-sv-cyan-dim disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        title="Generate per-staff linked parts and keep them in sync"
      >
        {syncing ? 'Syncing...' : linkedParts.length > 0 ? 'Sync linked parts' : 'Generate linked parts'}
      </button>
      <span className="text-xs text-sv-text-dim">
        {linkedParts.length > 0 ? `${linkedParts.length} linked part scores` : 'No linked part scores yet'}
      </span>
      {!isReadOnly && (
        <button
          onClick={() => setTargetsOpen((open) => !open)}
          disabled={syncing}
          className="px-2 py-1 rounded border border-sv-border bg-sv-elevated text-[11px] text-sv-text-muted hover:text-sv-text hover:border-sv-border-lt disabled:opacity-50 transition-colors"
          title="Show or hide staff/voice target selection"
        >
          {targetsOpen ? 'Hide targets' : `Targets (${selectedTargetCount})`}
        </button>
      )}
      {status && <span className="text-xs text-sv-text-dim max-w-[360px] truncate">{status}</span>}
      {isReadOnly && (
        <span className="text-xs text-amber-400">Switch to Edit mode to generate/sync linked parts.</span>
      )}
      {linkedParts.length > 0 && (
        <div className="w-full mt-1.5 flex flex-wrap gap-1.5">
          {linkedParts.map((part) => (
            <button
              key={part.id}
              onClick={() => navigate(`/editor/${part.id}`)}
              className="px-2 py-1 rounded border border-sv-border bg-sv-elevated text-[11px] text-sv-text-muted hover:text-sv-text hover:border-sv-cyan/50 transition-colors"
              title={`Open ${part.title}`}
            >
              Open {part.staffLabel} ({part.voiceLabel})
            </button>
          ))}
        </div>
      )}
      {targetsOpen && !isReadOnly && (
        <div className="w-full mt-1.5 rounded border border-sv-border bg-sv-elevated/40 p-2">
          <div className="text-[11px] text-sv-text-dim mb-1">
            Select staves and voices to extract/sync ({selectedTargetCount} selected)
          </div>
          <div className="max-h-36 overflow-y-auto pr-1 flex flex-col gap-1.5">
            {staffVoiceOptions.map((staffOption) => {
              const allKey = STAFF_ALL_KEY(staffOption.staffIndex);
              const allSelected = selectionKeys.includes(allKey);
              return (
                <div key={staffOption.staffIndex} className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-sv-text min-w-[88px]">{staffOption.staffLabel}</span>
                  <button
                    disabled={syncing}
                    onClick={() => {
                      setSelectionKeys((prev) => {
                        if (prev.includes(allKey)) {
                          return prev.filter((k) => k !== allKey);
                        }
                        return [
                          ...prev.filter((k) => !k.startsWith(`${staffOption.staffIndex}:`)),
                          allKey,
                        ];
                      });
                    }}
                    className={`px-2 py-0.5 rounded border text-[11px] transition-colors ${
                      allSelected
                        ? 'border-sv-cyan/50 bg-sv-cyan/15 text-sv-cyan'
                        : 'border-sv-border text-sv-text-muted hover:text-sv-text'
                    }`}
                    title="Extract all voices for this staff"
                  >
                    All
                  </button>
                  {staffOption.voiceIndexes.map((voiceIndex) => {
                    const key = STAFF_VOICE_KEY(staffOption.staffIndex, voiceIndex);
                    const selected = selectionKeys.includes(key);
                    return (
                      <button
                        key={key}
                        disabled={syncing}
                        onClick={() => {
                          setSelectionKeys((prev) => {
                            const withoutAll = prev.filter(
                              (k) => k !== STAFF_ALL_KEY(staffOption.staffIndex)
                            );
                            if (withoutAll.includes(key)) {
                              return withoutAll.filter((k) => k !== key);
                            }
                            return [...withoutAll, key];
                          });
                        }}
                        className={`px-2 py-0.5 rounded border text-[11px] transition-colors ${
                          selected
                            ? 'border-sv-cyan/50 bg-sv-cyan/15 text-sv-cyan'
                            : 'border-sv-border text-sv-text-muted hover:text-sv-text'
                        }`}
                        title={`Extract ${getVoiceDisplayLabel(voiceIndex)} only`}
                      >
                        {getVoiceDisplayLabel(voiceIndex)}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
