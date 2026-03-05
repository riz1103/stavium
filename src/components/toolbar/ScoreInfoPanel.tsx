import React, { useRef, useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { useScoreStore } from '../../app/store/scoreStore';

interface ScoreInfoPanelProps {
  open: boolean;
  onClose: () => void;
  /** Anchor element – panel will position itself below this */
  anchorRef: React.RefObject<HTMLElement>;
  /** Whether the current user is the owner. Only owners may change credits/sharing. */
  isOwner?: boolean;
}

const PRIVACY_ICONS: Record<string, string> = {
  private: '🔒',
  shared:  '👥',
  public:  '🌐',
};

export const ScoreInfoPanel = ({ open, onClose, anchorRef, isOwner = true }: ScoreInfoPanelProps) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const composition          = useScoreStore((s) => s.composition);
  const updateAuthor         = useScoreStore((s) => s.updateAuthor);
  const updateArrangedBy     = useScoreStore((s) => s.updateArrangedBy);
  const updatePrivacy        = useScoreStore((s) => s.updatePrivacy);
  const updateSharedEmails   = useScoreStore((s) => s.updateSharedEmails);
  const updateSharePermission = useScoreStore((s) => s.updateSharePermission);

  const [emailsInput, setEmailsInput] = React.useState(
    composition?.sharedEmails?.join(', ') || ''
  );

  useEffect(() => {
    setEmailsInput(composition?.sharedEmails?.join(', ') || '');
  }, [composition?.sharedEmails]);

  // Calculate position from anchor whenever opening
  useEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    // Position below anchor, aligned to left edge of button
    const panelWidth = 320;
    const margin = 8;
    let left = rect.left;
    // Ensure it doesn't overflow right edge
    if (left + panelWidth + margin > window.innerWidth) {
      left = window.innerWidth - panelWidth - margin;
    }
    // Ensure it doesn't overflow left edge
    if (left < margin) {
      left = margin;
    }
    setPos({
      top: rect.bottom + 8,
      left,
    });
  }, [open, anchorRef]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose, anchorRef]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open || !composition || !pos) return null;

  const privacy = composition.privacy || 'private';
  const sharePermission = composition.sharePermission || 'view';

  const formatDateTime = (d?: Date) => {
    if (!d) return '—';
    const date = d instanceof Date ? d : new Date(d);
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return ReactDOM.createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[9998]"
        onClick={onClose}
        style={{
          background: 'rgba(3, 7, 18, 0.75)', // strong dark overlay
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          animation: 'fadeIn 0.15s ease-out',
        }}
      />
      
      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed z-[9999] w-80 rounded-xl shadow-2xl overflow-hidden"
        style={{
          top: pos.top,
          left: pos.left,
          background: 'linear-gradient(145deg, rgba(15,23,42,0.98), rgba(15,23,42,0.94))',
          border: '1px solid rgba(148, 163, 184, 0.35)',
          boxShadow: '0 18px 45px rgba(0,0,0,0.7)',
          animation: 'slideDown 0.18s ease-out',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-sv-elevated border-b border-sv-border">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-sv-cyan" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
            </svg>
            <span className="text-sm font-semibold text-sv-text">Score Information</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md text-sv-text-dim
                       hover:text-sv-text hover:bg-sv-panel transition-colors"
            title="Close"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 flex flex-col gap-5 max-h-[calc(100vh-220px)] overflow-y-auto">

        {/* Non-owner notice */}
        {!isOwner && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-900/30 border border-amber-700/40 text-amber-300 text-xs">
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
            </svg>
            Only the composer can change these settings.
          </div>
        )}

        {/* Composer & Arranger */}
        <div className="flex flex-col gap-3">
          <h3 className="text-[11px] font-semibold text-sv-text uppercase tracking-[0.14em]">CREDITS</h3>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-sv-text">Composer</label>
              <input
                type="text"
                value={composition.author || ''}
                onChange={(e) => isOwner && updateAuthor(e.target.value)}
                readOnly={!isOwner}
                placeholder="e.g. J.S. Bach"
                className={`sv-input w-full text-sm ${!isOwner ? 'opacity-50 cursor-default' : ''}`}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-sv-text">Arranged by</label>
              <input
                type="text"
                value={composition.arrangedBy || ''}
                onChange={(e) => isOwner && updateArrangedBy(e.target.value)}
                readOnly={!isOwner}
                placeholder="Arranger name"
                className={`sv-input w-full text-sm ${!isOwner ? 'opacity-50 cursor-default' : ''}`}
              />
            </div>
          </div>
        </div>

        <div className="h-px bg-sv-border" />

        {/* Privacy */}
        <div className="flex flex-col gap-3">
          <h3 className="text-[11px] font-semibold text-sv-text uppercase tracking-[0.14em]">SHARING</h3>

          {/* Privacy level */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-sv-text">Visibility</label>
            <div className="flex gap-2">
              {(['private', 'shared', 'public'] as const).map((level) => {
                const isActive = privacy === level;
                return (
                <button
                  key={level}
                  onClick={() => isOwner && updatePrivacy(level)}
                  disabled={!isOwner}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs font-medium
                              transition-all duration-150 ${
                    !isOwner
                      ? isActive
                        ? 'bg-sv-cyan/10 border-sv-cyan/40 text-sv-cyan/60 cursor-default'
                        : 'bg-sv-elevated border-sv-border text-sv-text-dim cursor-default opacity-50'
                      : isActive
                        ? 'bg-sv-cyan/20 border-sv-cyan text-sv-cyan shadow-sm'
                        : 'bg-sv-elevated border-sv-border text-sv-text-muted hover:border-sv-border-lt hover:text-sv-text'
                  }`}
                  aria-pressed={isActive}
                >
                  {isActive && (
                    <span className="text-[10px] mr-0.5">✓</span>
                  )}
                  <span className="text-sm">{PRIVACY_ICONS[level]}</span>
                  <span className="capitalize">{level}</span>
                </button>
              )})}
            </div>
          </div>

          {/* Share permission — only when shared or public */}
          {(privacy === 'shared' || privacy === 'public') && (
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-sv-text">Permission</label>
              <div className="flex gap-2">
                {(['view', 'edit'] as const).map((perm) => {
                  const isActive = sharePermission === perm;
                  return (
                  <button
                    key={perm}
                    onClick={() => isOwner && updateSharePermission(perm)}
                    disabled={!isOwner}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs font-medium
                                transition-all duration-150 ${
                      !isOwner
                        ? isActive
                          ? 'bg-sv-cyan/10 border-sv-cyan/40 text-sv-cyan/60 cursor-default'
                          : 'bg-sv-elevated border-sv-border text-sv-text-dim cursor-default opacity-50'
                        : isActive
                          ? 'bg-sv-cyan/20 border-sv-cyan text-sv-cyan shadow-sm'
                          : 'bg-sv-elevated border-sv-border text-sv-text-muted hover:border-sv-border-lt hover:text-sv-text'
                    }`}
                    aria-pressed={isActive}
                  >
                    {isActive && (
                      <span className="text-[10px] mr-0.5">✓</span>
                    )}
                    <span className="text-sm">{perm === 'view' ? '👁' : '✏'}</span>
                    <span>{perm === 'view' ? 'View only' : 'Can edit'}</span>
                  </button>
                )})}
              </div>
            </div>
          )}

          {/* Emails — only when shared */}
          {privacy === 'shared' && (
            <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-sv-text">Share with emails</label>
              <input
                type="text"
                value={emailsInput}
                onChange={(e) => isOwner && setEmailsInput(e.target.value)}
                onBlur={() =>
                  isOwner && updateSharedEmails(emailsInput.split(',').map((s) => s.trim()))
                }
                readOnly={!isOwner}
                placeholder="email1@example.com, email2@example.com"
                className={`sv-input w-full text-sm ${!isOwner ? 'opacity-50 cursor-default' : ''}`}
              />
              {isOwner && (
                <p className="text-xs text-sv-text-dim leading-relaxed">Separate multiple emails with commas</p>
              )}
            </div>
          )}
        </div>

        <div className="h-px bg-sv-border" />

        {/* Dates (read-only) */}
        <div className="flex flex-col gap-3">
          <h3 className="text-[11px] font-semibold text-sv-text uppercase tracking-[0.14em]">METADATA</h3>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center py-1.5 px-2 rounded-md bg-sv-elevated">
              <span className="text-xs text-sv-text">Created</span>
              <span className="text-xs text-sv-text font-medium">{formatDateTime(composition.createdAt)}</span>
            </div>
            <div className="flex justify-between items-center py-1.5 px-2 rounded-md bg-sv-elevated">
              <span className="text-xs text-sv-text">Last modified</span>
              <span className="text-xs text-sv-text font-medium">{formatDateTime(composition.updatedAt)}</span>
            </div>
          </div>
        </div>

      </div>
    </div>
    </>,
    document.body
  );
};
