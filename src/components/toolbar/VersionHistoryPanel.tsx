import { useMemo, useState } from 'react';
import { CompositionRevision, useScoreStore } from '../../app/store/scoreStore';

interface VersionHistoryPanelProps {
  isReadOnly?: boolean;
}

const TRIGGER_LABELS: Record<CompositionRevision['trigger'], string> = {
  'manual-save': 'Save',
  'export-midi': 'MIDI',
  'export-pdf': 'PDF',
};

export const VersionHistoryPanel = ({ isReadOnly = false }: VersionHistoryPanelProps) => {
  const revisions = useScoreStore((state) => state.revisionHistory);
  const restoreRevision = useScoreStore((state) => state.restoreRevision);
  const [open, setOpen] = useState(false);

  const formattedRevisions = useMemo(
    () =>
      revisions.map((revision) => ({
        ...revision,
        time: new Date(revision.createdAt).toLocaleString(),
      })),
    [revisions]
  );

  return (
    <div className="relative">
      <div className="sv-toolbar">
        <span className="sv-toolbar-label">Version History</span>
        <button
          onClick={() => setOpen((value) => !value)}
          className="sv-btn-ghost"
          title="Open version history timeline"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>Timeline ({revisions.length})</span>
        </button>
      </div>

      {open && (
        <div className="absolute right-0 mt-2 z-40 w-[320px] max-h-80 overflow-y-auto rounded-lg border border-sv-border bg-sv-card p-2 shadow-lg">
          {formattedRevisions.length === 0 ? (
            <p className="text-xs text-sv-text-dim px-2 py-2">
              No snapshots yet. Save or export to create revision points.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {formattedRevisions.map((revision) => (
                <div
                  key={revision.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-sv-border px-2 py-1.5"
                >
                  <div className="min-w-0">
                    <div className="text-xs text-sv-text truncate">{revision.label}</div>
                    <div className="text-[11px] text-sv-text-dim truncate">
                      {revision.time} - {TRIGGER_LABELS[revision.trigger]}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (isReadOnly) return;
                      const confirmed = window.confirm(
                        'Restore this revision? Your current unsaved edits will be replaced.'
                      );
                      if (confirmed) {
                        restoreRevision(revision.id);
                        setOpen(false);
                      }
                    }}
                    disabled={isReadOnly}
                    className={isReadOnly ? 'sv-btn-ghost opacity-40 cursor-not-allowed' : 'sv-btn-ghost'}
                    title={isReadOnly ? 'Switch to edit mode to restore' : 'Restore this revision'}
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
