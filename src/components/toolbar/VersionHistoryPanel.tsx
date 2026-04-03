import { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
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
  const composition = useScoreStore((state) => state.composition);
  const restoreRevision = useScoreStore((state) => state.restoreRevision);
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState<boolean>(window.innerWidth < 768);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const [triggerFilter, setTriggerFilter] = useState<'all' | CompositionRevision['trigger']>('all');
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const formattedRevisions = useMemo(
    () =>
      revisions.map((revision) => ({
        ...revision,
        time: new Date(revision.createdAt).toLocaleString(),
      })),
    [revisions]
  );

  const filteredRevisions = useMemo(() => {
    if (triggerFilter === 'all') return formattedRevisions;
    return formattedRevisions.filter((revision) => revision.trigger === triggerFilter);
  }, [formattedRevisions, triggerFilter]);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!open) return;
    const recalcPosition = () => {
      if (isMobile) {
        setPos({
          top: Math.max(16, window.innerHeight * 0.18),
          left: 12,
          width: Math.min(window.innerWidth - 24, 420),
          maxHeight: Math.min(window.innerHeight - 24, window.innerHeight * 0.74),
        });
        return;
      }

      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const panelWidth = 360;
      const margin = 10;
      let left = rect.right - panelWidth;
      if (left + panelWidth + margin > window.innerWidth) left = window.innerWidth - panelWidth - margin;
      if (left < margin) left = margin;
      const top = rect.bottom + 10;
      const maxHeight = Math.max(220, window.innerHeight - top - 20);
      setPos({
        top,
        left,
        width: panelWidth,
        maxHeight,
      });
    };

    recalcPosition();
    window.addEventListener('resize', recalcPosition);
    window.addEventListener('scroll', recalcPosition, true);
    return () => {
      window.removeEventListener('resize', recalcPosition);
      window.removeEventListener('scroll', recalcPosition, true);
    };
  }, [open, isMobile]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedPanel = panelRef.current?.contains(target);
      const clickedAnchor = anchorRef.current?.contains(target);
      if (!clickedPanel && !clickedAnchor) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const restoreRevisionWithPrompt = (revisionId: string) => {
    if (isReadOnly) return;
    const confirmed = window.confirm(
      'Restore this revision? Your current unsaved edits will be replaced.'
    );
    if (confirmed) {
      restoreRevision(revisionId);
      setOpen(false);
    }
  };

  const listContent = (
    <>
      <div className="mb-2 rounded-lg border border-sv-cyan/40 bg-sv-cyan/10 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-sv-cyan truncate">Current state</div>
            <div className="text-[11px] text-sv-text-dim truncate">
              {composition?.updatedAt
                ? `Live edits · ${new Date(composition.updatedAt).toLocaleString()}`
                : 'Live edits'}
            </div>
          </div>
          <span
            className="inline-flex items-center rounded-full border border-sv-cyan/40 px-2 py-0.5 text-[10px] font-medium text-sv-cyan"
            title="This is your current working version"
          >
            Active
          </span>
        </div>
      </div>

      <div className="mb-2 flex items-center gap-1.5 flex-wrap">
        {([
          ['all', 'All'],
          ['manual-save', 'Save'],
          ['export-midi', 'MIDI'],
          ['export-pdf', 'PDF'],
        ] as const).map(([value, label]) => {
          const active = triggerFilter === value;
          return (
            <button
              key={value}
              onClick={() => setTriggerFilter(value)}
              className={`px-2 py-1 rounded-md text-[11px] border transition-colors ${
                active
                  ? 'bg-sv-cyan/20 border-sv-cyan/45 text-sv-cyan'
                  : 'bg-sv-elevated border-sv-border text-sv-text-muted hover:text-sv-text hover:border-sv-border-lt'
              }`}
              title={`Show ${label} revisions`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {filteredRevisions.length === 0 ? (
        <p className="text-xs text-sv-text-dim px-2 py-2">
          {formattedRevisions.length === 0
            ? 'No snapshots yet. Save or export to create revision points.'
            : 'No revisions match the selected filter.'}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {filteredRevisions.map((revision, index) => (
            <div
              key={revision.id}
              className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 ${
                index === 0
                  ? 'border-amber-400/40 bg-amber-400/10'
                  : 'border-sv-border bg-sv-elevated/50'
              }`}
            >
              <div className="min-w-0">
                <div className="text-xs text-sv-text truncate inline-flex items-center gap-1.5">
                  <span>{revision.label}</span>
                  {index === 0 && (
                    <span className="text-[10px] text-amber-300 border border-amber-300/40 rounded px-1 py-0.5">
                      Latest
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-sv-text-dim truncate">
                  {revision.time} · {TRIGGER_LABELS[revision.trigger]}
                </div>
              </div>
              <button
                onClick={() => restoreRevisionWithPrompt(revision.id)}
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
    </>
  );

  return (
    <>
      <div className="sv-toolbar">
        <span className="sv-toolbar-label">Version History</span>
        <button
          ref={anchorRef}
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

      {open && pos && ReactDOM.createPortal(
        <>
          <div
            className="fixed inset-0 z-[9990]"
            onClick={() => setOpen(false)}
            style={{
              background: isMobile ? 'rgba(3, 7, 18, 0.58)' : 'transparent',
              backdropFilter: isMobile ? 'blur(2px)' : undefined,
              WebkitBackdropFilter: isMobile ? 'blur(2px)' : undefined,
            }}
          />
          <div
            ref={panelRef}
            className="fixed z-[9991] rounded-xl border border-sv-border bg-sv-card shadow-2xl overflow-hidden"
            style={{
              top: pos.top,
              left: isMobile ? Math.max(12, (window.innerWidth - pos.width) / 2) : pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
            }}
          >
            <div className="px-3 py-2 border-b border-sv-border bg-sv-elevated flex items-center justify-between">
              <span className="text-xs font-semibold text-sv-text">Revision Timeline</span>
              <button
                onClick={() => setOpen(false)}
                className="w-6 h-6 rounded-md text-sv-text-dim hover:text-sv-text hover:bg-sv-panel transition-colors"
                title="Close timeline"
              >
                <svg className="w-3.5 h-3.5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-2 overflow-y-auto" style={{ maxHeight: pos.maxHeight - 42 }}>
              {listContent}
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
};
