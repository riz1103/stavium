import { useMemo, useState } from 'react';
import { useScoreStore } from '../../app/store/scoreStore';
import {
  ArrangementCandidate,
  ArrangementDifficulty,
  ArrangementInstrumentation,
  ArrangementStyle,
  generateArrangementCandidates,
} from '../../services/arrangementService';

interface AIArrangementPanelProps {
  isReadOnly?: boolean;
}

export const AIArrangementPanel = ({ isReadOnly = false }: AIArrangementPanelProps) => {
  const composition = useScoreStore((s) => s.composition);
  const selectedStaffIndex = useScoreStore((s) => s.selectedStaffIndex);
  const replaceArrangedStaves = useScoreStore((s) => s.replaceArrangedStaves);

  const [style, setStyle] = useState<ArrangementStyle>('classical');
  const [difficulty, setDifficulty] = useState<ArrangementDifficulty>('intermediate');
  const [instrumentation, setInstrumentation] = useState<ArrangementInstrumentation>('satb-choir');
  const [candidates, setCandidates] = useState<ArrangementCandidate[]>([]);
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState<string>('');

  const sourceStaffIndex = useMemo(() => {
    if (!composition || composition.staves.length === 0) return null;
    if (selectedStaffIndex === null) return 0;
    return Math.max(0, Math.min(selectedStaffIndex, composition.staves.length - 1));
  }, [composition, selectedStaffIndex]);

  const handleGenerate = async () => {
    if (!composition || sourceStaffIndex === null) return;
    setGenerating(true);
    setStatus('');
    const result = await generateArrangementCandidates(composition, {
      sourceStaffIndex,
      style,
      difficulty,
      instrumentation,
    });
    setCandidates(result.candidates);
    setStatus(result.warning ?? `Generated ${result.candidates.length} arrangement ideas.`);
    setGenerating(false);
  };

  const handleApplyCandidate = (candidate: ArrangementCandidate) => {
    replaceArrangedStaves(candidate.staves);
    setStatus(`Applied "${candidate.title}" and replaced previous AI arrangement.`);
  };

  if (!composition || isReadOnly || composition.notationSystem === 'gregorian-chant') return null;

  return (
    <div className="sv-toolbar flex-wrap gap-y-1.5 max-w-[760px]">
      <span className="sv-toolbar-label">AI Arrange</span>
      <select
        value={style}
        onChange={(e) => setStyle(e.target.value as ArrangementStyle)}
        className="sv-select w-24"
        title="Arrangement style"
      >
        <option value="classical">Classical</option>
        <option value="pop">Pop</option>
        <option value="jazz">Jazz</option>
        <option value="gospel">Gospel</option>
      </select>
      <select
        value={difficulty}
        onChange={(e) => setDifficulty(e.target.value as ArrangementDifficulty)}
        className="sv-select w-28"
        title="Arrangement complexity"
      >
        <option value="beginner">Beginner</option>
        <option value="intermediate">Intermediate</option>
        <option value="advanced">Advanced</option>
      </select>
      <select
        value={instrumentation}
        onChange={(e) => setInstrumentation(e.target.value as ArrangementInstrumentation)}
        className="sv-select w-36"
        title="Target instrumentation"
      >
        <option value="satb-choir">SATB Choir</option>
        <option value="piano-duet">Piano Duet</option>
        <option value="string-section">String Section</option>
      </select>
      <button
        onClick={handleGenerate}
        disabled={sourceStaffIndex === null || generating}
        className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-sv-cyan text-sv-bg hover:bg-sv-cyan-dim disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        title="Generate 3 arrangement ideas from selected melody staff"
      >
        {generating ? 'Generating...' : 'Generate 3 ideas'}
      </button>
      {status && <span className="text-xs text-sv-text-dim max-w-[340px] truncate">{status}</span>}
      {candidates.length > 0 && (
        <div className="w-full mt-1.5 grid grid-cols-1 md:grid-cols-3 gap-2">
          {candidates.map((candidate) => (
            <div key={candidate.id} className="rounded-lg border border-sv-border bg-sv-elevated p-2.5 text-xs">
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="text-sv-text font-medium truncate">{candidate.title}</p>
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-sv-border text-sv-text-dim">
                  {candidate.source === 'ai' ? 'AI' : 'Fallback'}
                </span>
              </div>
              <p className="text-sv-text-muted leading-relaxed min-h-[30px]">{candidate.description}</p>
              <button
                onClick={() => handleApplyCandidate(candidate)}
                className="mt-2 w-full px-2 py-1.5 rounded-md bg-sv-cyan/15 border border-sv-cyan/40 text-sv-cyan hover:bg-sv-cyan/25 transition-colors"
              >
                Apply this idea
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
