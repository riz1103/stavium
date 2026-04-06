import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EditorTourMobileTab, EditorTourStep } from '../../tour/editorTourSteps';

export type EditorTourStepMeta = {
  expandSections?: string[];
  expandMobileTab?: EditorTourMobileTab;
};

type Props = {
  steps: EditorTourStep[];
  stepIndex: number;
  onStepIndexChange: (index: number) => void;
  /** True when the current step's hands-on task is complete (ignored for read-only steps) */
  advanceSatisfied: boolean;
  onExit: () => void;
};

const PADDING = 8;

/** Desktop + mobile both mount some toolbars; `querySelector` would return the hidden copy first. */
function findVisibleTourTarget(targetId: string): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(`[data-tour-id="${CSS.escape(targetId)}"]`);
  for (const node of nodes) {
    const r = node.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const st = window.getComputedStyle(node);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) continue;
    return node;
  }
  return null;
}

export const EditorTourOverlay = ({
  steps,
  stepIndex,
  onStepIndexChange,
  advanceSatisfied,
  onExit,
}: Props) => {
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [hole, setHole] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  const step = steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  const waitFor = step?.waitFor ?? 'manual';
  const needsAction = waitFor !== 'manual';
  const canContinue = !needsAction || advanceSatisfied;

  const measure = useCallback(() => {
    if (!step?.targetId) {
      setHole(null);
      setTooltipPos(null);
      return;
    }
    const el = findVisibleTourTarget(step.targetId);
    if (!el) {
      setHole(null);
      setTooltipPos(null);
      return;
    }
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const r = el.getBoundingClientRect();
    const top = r.top - PADDING;
    const left = r.left - PADDING;
    const width = r.width + PADDING * 2;
    const height = r.height + PADDING * 2;
    setHole({ top, left, width, height });

    const ttWidth = Math.min(360, window.innerWidth - 24);
    let ttLeft = left;
    if (ttLeft + ttWidth > window.innerWidth - 12) {
      ttLeft = Math.max(12, window.innerWidth - 12 - ttWidth);
    }
    const cardEstimate = Math.min(300, Math.max(200, window.innerHeight * 0.42));
    const belowTop = top + height + 12;
    const spaceBelow = window.innerHeight - belowTop - 16;
    const aboveTop = top - 12 - cardEstimate;
    let ttTop: number;
    if (spaceBelow < cardEstimate && aboveTop >= 12 && aboveTop + cardEstimate < top - 8) {
      ttTop = aboveTop;
    } else {
      ttTop = belowTop;
    }
    if (ttTop + cardEstimate > window.innerHeight - 12) {
      ttTop = Math.max(12, window.innerHeight - 12 - cardEstimate);
    }
    if (ttTop < 12) ttTop = 12;
    setTooltipPos({ top: ttTop, left: ttLeft, width: ttWidth });
  }, [step]);

  useLayoutEffect(() => {
    measure();
  }, [measure, stepIndex]);

  /** Parent applies mobile tab + toolbar via flushSync; one frame later the visible target exists. */
  useEffect(() => {
    const id = window.setTimeout(() => measure(), 0);
    const id2 = window.setTimeout(() => measure(), 120);
    return () => {
      window.clearTimeout(id);
      window.clearTimeout(id2);
    };
  }, [measure, stepIndex]);

  useEffect(() => {
    const onResize = () => measure();
    const onScroll = () => measure();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [measure]);

  const goNext = () => {
    if (!canContinue) return;
    if (isLast) {
      onExit();
      return;
    }
    onStepIndexChange(Math.min(stepIndex + 1, steps.length - 1));
  };

  const goPrev = () => {
    onStepIndexChange(Math.max(stepIndex - 1, 0));
  };

  const backdrop =
    hole && step?.targetId ? (
      <>
        <div
          className="fixed z-[10050] bg-black/65 pointer-events-auto"
          style={{ top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }}
          aria-hidden
        />
        <div
          className="fixed z-[10050] bg-black/65 pointer-events-auto"
          style={{ top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }}
          aria-hidden
        />
        <div
          className="fixed z-[10050] bg-black/65 pointer-events-auto"
          style={{ top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height }}
          aria-hidden
        />
        <div
          className="fixed z-[10050] bg-black/65 pointer-events-auto"
          style={{
            top: hole.top,
            left: hole.left + hole.width,
            right: 0,
            height: hole.height,
          }}
          aria-hidden
        />
        <div
          className="fixed z-[10050] pointer-events-none border-2 border-sv-cyan rounded-lg shadow-[0_0_0_1px_rgba(0,212,245,0.35)]"
          style={{
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
          }}
          aria-hidden
        />
      </>
    ) : (
      <div className="fixed inset-0 z-[10050] bg-black/65 pointer-events-auto" aria-hidden />
    );

  const centeredCard = !step?.targetId || !tooltipPos;
  const continueLabel = needsAction ? 'Continue' : 'Next';

  const tooltip = (
    <div
      className={`fixed z-[10052] rounded-xl border border-sv-border bg-sv-card shadow-xl p-4 pointer-events-auto max-md:max-h-[min(50vh,280px)] max-md:overflow-y-auto ${
        centeredCard ? 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(420px,calc(100vw-24px))]' : ''
      }`}
      style={
        centeredCard
          ? undefined
          : tooltipPos
          ? {
              top: tooltipPos.top,
              left: tooltipPos.left,
              width: tooltipPos.width,
              maxWidth: 'calc(100vw - 24px)',
            }
          : undefined
      }
      role="dialog"
      aria-labelledby="editor-tour-title"
      aria-describedby="editor-tour-body"
    >
      <p id="editor-tour-title" className="text-sm font-semibold text-sv-text mb-2">
        {step?.title}{' '}
        <span className="text-sv-text-dim font-normal">
          ({stepIndex + 1}/{steps.length})
        </span>
      </p>
      <p id="editor-tour-body" className="text-sm text-sv-text-muted leading-relaxed mb-2">
        {step?.body}
      </p>
      {needsAction && (
        <p
          className={`text-xs leading-relaxed mb-3 px-2 py-1.5 rounded-md border ${
            advanceSatisfied
              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
          }`}
        >
          {advanceSatisfied
            ? 'Nice — you can continue.'
            : step?.taskHint ?? 'Complete the highlighted action to unlock Continue.'}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onExit}
          className="text-xs font-medium text-sv-text-muted hover:text-sv-text px-2 py-1.5 rounded-lg"
        >
          Exit tour
        </button>
        <div className="flex gap-2">
          {!isFirst && (
            <button
              type="button"
              onClick={goPrev}
              className="px-3 py-1.5 rounded-lg border border-sv-border text-sm text-sv-text-muted hover:text-sv-text hover:border-sv-border-lt"
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={goNext}
            disabled={!canContinue && needsAction}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              !canContinue && needsAction
                ? 'bg-sv-elevated text-sv-text-dim cursor-not-allowed border border-sv-border'
                : 'bg-sv-cyan text-sv-bg hover:bg-sv-cyan-dim'
            }`}
          >
            {isLast ? 'Done' : continueLabel}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[10049] pointer-events-none" role="presentation">
      {backdrop}
      {tooltip}
    </div>,
    document.body
  );
};
