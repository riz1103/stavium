import { useEffect, useMemo, useState } from 'react';
import {
  addCommentToThread,
  createCommentThread,
  getThreadComments,
  getCompositionCommentThreads,
  setCommentThreadResolved,
  type CompositionComment,
  type CompositionCommentThread,
} from '../../services/compositionService';
import { Staff } from '../../types/music';

interface ScoreReviewPanelProps {
  open: boolean;
  onClose: () => void;
  compositionId?: string;
  selectedStaffIndex: number | null;
  selectedMeasureIndex: number | null;
  staves: Staff[];
  user: {
    uid: string;
    email?: string | null;
    displayName?: string | null;
  } | null;
}

type ThreadFilter = 'open' | 'resolved';

const formatDateTime = (iso: string) => {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return 'Just now';
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getStaffLabel = (staves: Staff[], index: number) => {
  const staff = staves[index];
  if (!staff) return `Staff ${index + 1}`;
  return staff.name?.trim() ? `${staff.name} (Staff ${index + 1})` : `Staff ${index + 1}`;
};

const getThreadTitle = (
  thread: CompositionCommentThread,
  commentsByThread: Record<string, CompositionComment[]>
) => {
  const explicitTitle = thread.threadTitle?.trim();
  if (explicitTitle) return explicitTitle;

  const firstCommentTitle = commentsByThread[thread.id]?.[0]?.content?.trim();
  if (firstCommentTitle) return firstCommentTitle;

  return thread.lastCommentPreview?.trim() || 'Thread';
};

export const ScoreReviewPanel = ({
  open,
  onClose,
  compositionId,
  selectedStaffIndex,
  selectedMeasureIndex,
  staves,
  user,
}: ScoreReviewPanelProps) => {
  const [loading, setLoading] = useState(false);
  const [threads, setThreads] = useState<CompositionCommentThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [commentsByThread, setCommentsByThread] = useState<Record<string, CompositionComment[]>>({});
  const [filter, setFilter] = useState<ThreadFilter>('open');
  const [newThreadText, setNewThreadText] = useState('');
  const [replyText, setReplyText] = useState('');
  const [targetStaff, setTargetStaff] = useState<number>(Math.max(0, selectedStaffIndex ?? 0));
  const [targetMeasure, setTargetMeasure] = useState<number>(Math.max(0, selectedMeasureIndex ?? 0));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTargetStaff(Math.max(0, selectedStaffIndex ?? 0));
  }, [selectedStaffIndex]);

  useEffect(() => {
    setTargetMeasure(Math.max(0, selectedMeasureIndex ?? 0));
  }, [selectedMeasureIndex]);

  useEffect(() => {
    if (!open || !compositionId) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const loaded = await getCompositionCommentThreads(compositionId);
        if (cancelled) return;
        setThreads(loaded);
        setActiveThreadId((current) => {
          if (current && loaded.some((thread) => thread.id === current)) return current;
          return loaded.length > 0 ? loaded[0].id : null;
        });
      } catch (err) {
        console.error('Failed to load review threads:', err);
        if (!cancelled) setError('Could not load review threads right now.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [open, compositionId]);

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? null,
    [threads, activeThreadId]
  );

  useEffect(() => {
    if (!open || !activeThreadId || commentsByThread[activeThreadId]) return;
    let cancelled = false;
    const run = async () => {
      try {
        const comments = await getThreadComments(activeThreadId);
        if (cancelled) return;
        setCommentsByThread((prev) => ({ ...prev, [activeThreadId]: comments }));
      } catch (err) {
        console.error('Failed to load thread comments:', err);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [open, activeThreadId, commentsByThread]);

  useEffect(() => {
    if (targetStaff < 0 || targetStaff >= staves.length) {
      setTargetStaff(0);
      return;
    }
    const measureCount = staves[targetStaff]?.measures.length ?? 1;
    if (targetMeasure >= measureCount) {
      setTargetMeasure(Math.max(0, measureCount - 1));
    }
  }, [targetStaff, targetMeasure, staves]);

  const visibleThreads = useMemo(
    () => threads.filter((thread) => thread.status === filter),
    [threads, filter]
  );

  const activeComments = activeThread ? commentsByThread[activeThread.id] ?? [] : [];
  const measureCountForTarget = staves[targetStaff]?.measures.length ?? 1;

  const refreshThreads = async () => {
    if (!compositionId) return;
    const loaded = await getCompositionCommentThreads(compositionId);
    setThreads(loaded);
  };

  const handleCreateThread = async () => {
    const text = newThreadText.trim();
    if (!text || !compositionId || !user) return;
    try {
      setSubmitting(true);
      setError(null);
      const created = await createCommentThread({
        compositionId,
        staffIndex: targetStaff,
        measureIndex: targetMeasure,
        content: text,
        authorId: user.uid,
        authorName: user.displayName ?? undefined,
        authorEmail: user.email ?? undefined,
      });
      setThreads((prev) => [created.thread, ...prev]);
      setCommentsByThread((prev) => ({ ...prev, [created.thread.id]: [created.comment] }));
      setActiveThreadId(created.thread.id);
      setNewThreadText('');
      setFilter(created.thread.status);
    } catch (err) {
      console.error('Failed to create thread:', err);
      setError('Could not create thread. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReply = async () => {
    const text = replyText.trim();
    if (!text || !activeThread || !compositionId || !user) return;
    try {
      setSubmitting(true);
      setError(null);
      const comment = await addCommentToThread({
        threadId: activeThread.id,
        compositionId,
        staffIndex: activeThread.staffIndex,
        measureIndex: activeThread.measureIndex,
        content: text,
        authorId: user.uid,
        authorName: user.displayName ?? undefined,
        authorEmail: user.email ?? undefined,
      });
      setCommentsByThread((prev) => ({
        ...prev,
        [activeThread.id]: [...(prev[activeThread.id] ?? []), comment],
      }));
      setReplyText('');
      await refreshThreads();
    } catch (err) {
      console.error('Failed to post reply:', err);
      setError('Could not post reply. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleResolved = async () => {
    if (!activeThread || !user) return;
    try {
      setSubmitting(true);
      setError(null);
      const nextResolved = activeThread.status !== 'resolved';
      await setCommentThreadResolved(activeThread.id, nextResolved, user.uid);
      await refreshThreads();
      setFilter(nextResolved ? 'resolved' : 'open');
    } catch (err) {
      console.error('Failed to update thread status:', err);
      setError('Could not update thread status.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="fixed z-50 top-0 right-0 h-screen w-full sm:w-[480px] bg-sv-card border-l border-sv-border shadow-2xl flex flex-col">
        <div className="px-4 py-3 border-b border-sv-border flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-sv-text">Review Comments</h2>
            <p className="text-xs text-sv-text-dim">Asynchronous score review by staff and measure.</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-md text-sv-text-dim hover:text-sv-text hover:bg-sv-elevated transition-colors"
            title="Close review panel"
          >
            ✕
          </button>
        </div>

        {!compositionId ? (
          <div className="p-4 text-sm text-sv-text-muted">
            Save this composition first, then open Review to add comment threads.
          </div>
        ) : (
          <>
            <div className="p-4 border-b border-sv-border space-y-2">
              <p className="text-xs font-medium text-sv-text uppercase tracking-[0.12em]">New Thread</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-sv-text-muted">
                  Staff
                  <select
                    value={targetStaff}
                    onChange={(e) => setTargetStaff(Number(e.target.value))}
                    className="mt-1 w-full sv-input text-sm"
                  >
                    {staves.map((_, i) => (
                      <option key={i} value={i}>
                        {getStaffLabel(staves, i)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-sv-text-muted">
                  Measure
                  <select
                    value={targetMeasure}
                    onChange={(e) => setTargetMeasure(Number(e.target.value))}
                    className="mt-1 w-full sv-input text-sm"
                  >
                    {Array.from({ length: Math.max(1, measureCountForTarget) }).map((_, i) => (
                      <option key={i} value={i}>
                        Measure {i + 1}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <textarea
                value={newThreadText}
                onChange={(e) => setNewThreadText(e.target.value)}
                placeholder="Leave a review comment for this location..."
                className="w-full min-h-[80px] sv-input text-sm resize-y"
              />
              <button
                onClick={handleCreateThread}
                disabled={!newThreadText.trim() || submitting || !user}
                className="sv-btn-primary w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Start Thread
              </button>
            </div>

            <div className="px-4 pt-3 pb-2 border-b border-sv-border flex items-center gap-2">
              {(['open', 'resolved'] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    filter === value
                      ? 'bg-sv-cyan/15 border-sv-cyan/50 text-sv-cyan'
                      : 'bg-sv-elevated border-sv-border text-sv-text-muted hover:text-sv-text'
                  }`}
                >
                  {value === 'open' ? 'Open' : 'Resolved'}
                </button>
              ))}
            </div>

            <div className="flex-1 min-h-0 grid grid-cols-1 sm:grid-cols-[210px_1fr]">
              <div className="border-r border-sv-border overflow-y-auto">
                {loading ? (
                  <div className="p-3 text-xs text-sv-text-dim">Loading threads...</div>
                ) : visibleThreads.length === 0 ? (
                  <div className="p-3 text-xs text-sv-text-dim">No {filter} threads yet.</div>
                ) : (
                  <div className="p-2 space-y-1">
                    {visibleThreads.map((thread) => (
                      <button
                        key={thread.id}
                        onClick={() => setActiveThreadId(thread.id)}
                        className={`w-full text-left p-2 rounded-lg border transition-colors ${
                          activeThreadId === thread.id
                            ? 'border-sv-cyan/50 bg-sv-cyan/10'
                            : 'border-sv-border bg-sv-elevated hover:border-sv-border-lt'
                        }`}
                      >
                        <p className="text-[11px] text-sv-text-dim">
                          {getStaffLabel(staves, thread.staffIndex)} · Measure {thread.measureIndex + 1}
                        </p>
                        <p className="text-xs text-sv-text mt-1 font-semibold line-clamp-2">
                          {getThreadTitle(thread, commentsByThread)}
                        </p>
                        {thread.lastCommentPreview &&
                          thread.lastCommentPreview.trim() !== getThreadTitle(thread, commentsByThread) && (
                          <p className="text-[11px] text-sv-text-muted mt-1 line-clamp-2">
                            {thread.lastCommentPreview}
                          </p>
                          )}
                        <p className="text-[11px] text-sv-text-dim mt-1">{formatDateTime(thread.lastCommentAt)}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col min-h-0">
                {activeThread ? (
                  <>
                    <div className="p-3 border-b border-sv-border">
                      <p className="text-xs text-sv-text-dim">
                        {getStaffLabel(staves, activeThread.staffIndex)} · Measure {activeThread.measureIndex + 1}
                      </p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full border ${
                            activeThread.status === 'resolved'
                              ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'
                              : 'text-amber-300 border-amber-500/40 bg-amber-500/10'
                          }`}
                        >
                          {activeThread.status === 'resolved' ? 'Resolved' : 'Open'}
                        </span>
                        <button
                          onClick={handleToggleResolved}
                          disabled={submitting || !user}
                          className="sv-btn-ghost text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {activeThread.status === 'resolved' ? 'Unresolve thread' : 'Resolve thread'}
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 space-y-2">
                      {activeComments.length === 0 ? (
                        <p className="text-xs text-sv-text-dim">Loading comments...</p>
                      ) : (
                        activeComments.map((comment) => (
                          <div key={comment.id} className="rounded-lg border border-sv-border bg-sv-elevated p-2.5">
                            <p className="text-xs text-sv-text-dim">
                              {comment.authorName || comment.authorEmail || 'Reviewer'} · {formatDateTime(comment.createdAt)}
                            </p>
                            <p className="text-sm text-sv-text mt-1 whitespace-pre-wrap">{comment.content}</p>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="p-3 border-t border-sv-border space-y-2">
                      <textarea
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder="Reply to thread..."
                        className="w-full min-h-[74px] sv-input text-sm resize-y"
                      />
                      <button
                        onClick={handleReply}
                        disabled={!replyText.trim() || submitting || !user}
                        className="sv-btn-primary w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Add Reply
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="p-4 text-xs text-sv-text-dim">Select a thread to view comments.</div>
                )}
              </div>
            </div>

            {error && (
              <div className="m-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {error}
              </div>
            )}
          </>
        )}
      </aside>
    </>
  );
};
