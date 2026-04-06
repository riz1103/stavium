import { useMemo, useState } from 'react';
import { useScoreStore } from '../../app/store/scoreStore';
import {
  HarmonyStyle,
  ChordProgressionCandidate,
  CountermelodyCandidate,
  reharmonizeMelody,
  generateSATBVoicing,
  generateCountermelody,
} from '../../services/aiCompositionService';
import { ArrangementCandidate } from '../../services/arrangementService';

type CompositionTool = 'reharmonize' | 'satb' | 'countermelody';

const TOOL_TABS: { id: CompositionTool; label: string; title: string }[] = [
  { id: 'reharmonize',   label: 'Reharmonize', title: 'Suggest new chord progressions for the melody' },
  { id: 'satb',          label: 'SATB Voicing', title: 'Generate 4-part SATB staves from chord symbols' },
  { id: 'countermelody', label: 'Countermelody', title: 'Create a countermelody for the selected staff' },
];

const STYLE_OPTIONS: { value: HarmonyStyle; label: string }[] = [
  { value: 'classical', label: 'Classical' },
  { value: 'jazz',      label: 'Jazz' },
  { value: 'pop',       label: 'Pop' },
  { value: 'modal',     label: 'Modal' },
];

interface CandidateCardProps {
  title: string;
  description: string;
  source: 'ai' | 'heuristic';
  onApply: () => void;
  applyLabel?: string;
}

const CandidateCard = ({ title, description, source, onApply, applyLabel = 'Apply' }: CandidateCardProps) => (
  <div className="rounded-lg border border-sv-border bg-sv-elevated p-2.5 text-xs">
    <div className="flex items-center justify-between gap-2 mb-1">
      <p className="text-sv-text font-medium truncate">{title}</p>
      <span className="text-[10px] px-1.5 py-0.5 rounded border border-sv-border text-sv-text-dim flex-shrink-0">
        {source === 'ai' ? 'AI' : 'Fallback'}
      </span>
    </div>
    <p className="text-sv-text-muted leading-relaxed min-h-[30px]">{description}</p>
    <button
      onClick={onApply}
      className="mt-2 w-full px-2 py-1.5 rounded-md bg-sv-cyan/15 border border-sv-cyan/40 text-sv-cyan hover:bg-sv-cyan/25 transition-colors"
    >
      {applyLabel}
    </button>
  </div>
);

interface AICompositionPanelProps {
  isReadOnly?: boolean;
}

export const AICompositionPanel = ({ isReadOnly = false }: AICompositionPanelProps) => {
  const composition        = useScoreStore((s) => s.composition);
  const selectedStaffIndex = useScoreStore((s) => s.selectedStaffIndex);
  const replaceStaffChords = useScoreStore((s) => s.replaceStaffChords);
  const replaceArrangedStaves = useScoreStore((s) => s.replaceArrangedStaves);
  const appendArrangedStaves  = useScoreStore((s) => s.appendArrangedStaves);

  const [activeTool, setActiveTool] = useState<CompositionTool>('reharmonize');
  const [style, setStyle] = useState<HarmonyStyle>('classical');
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState('');

  // Per-tool candidate lists
  const [reharmCandidates, setReharmCandidates]     = useState<ChordProgressionCandidate[]>([]);
  const [satbCandidates, setSatbCandidates]          = useState<ArrangementCandidate[]>([]);
  const [counterCandidates, setCounterCandidates]    = useState<CountermelodyCandidate[]>([]);

  const sourceStaffIndex = useMemo(() => {
    if (!composition || composition.staves.length === 0) return null;
    if (selectedStaffIndex === null) return 0;
    return Math.max(0, Math.min(selectedStaffIndex, composition.staves.length - 1));
  }, [composition, selectedStaffIndex]);

  const sourceStaffName = useMemo(() => {
    if (sourceStaffIndex === null || !composition) return '';
    const staff = composition.staves[sourceStaffIndex];
    return staff?.name ?? `Staff ${sourceStaffIndex + 1}`;
  }, [composition, sourceStaffIndex]);

  const handleGenerate = async () => {
    if (!composition || sourceStaffIndex === null) return;
    setGenerating(true);
    setStatus('');

    if (activeTool === 'reharmonize') {
      const result = await reharmonizeMelody(composition, sourceStaffIndex, style);
      setReharmCandidates(result.candidates);
      setStatus(result.warning ?? `Generated ${result.candidates.length} chord progression ideas.`);
    } else if (activeTool === 'satb') {
      const result = await generateSATBVoicing(composition, sourceStaffIndex, style);
      setSatbCandidates(result.candidates);
      setStatus(result.warning ?? `Generated ${result.candidates.length} SATB voicing ideas.`);
    } else {
      const result = await generateCountermelody(composition, sourceStaffIndex, style);
      setCounterCandidates(result.candidates);
      setStatus(result.warning ?? `Generated ${result.candidates.length} countermelody ideas.`);
    }

    setGenerating(false);
  };

  const handleApplyReharm = (candidate: ChordProgressionCandidate) => {
    if (sourceStaffIndex === null) return;
    replaceStaffChords(sourceStaffIndex, candidate.progressions);
    setStatus(`Applied "${candidate.title}" chord progression to ${sourceStaffName}.`);
  };

  const handleApplySATB = (candidate: ArrangementCandidate) => {
    replaceArrangedStaves(candidate.staves);
    setStatus(`Applied "${candidate.title}" SATB voicing (replaced previous AI staves).`);
  };

  const handleApplyCounter = (candidate: CountermelodyCandidate) => {
    appendArrangedStaves([candidate.staff]);
    setStatus(`Added "${candidate.title}" as a new staff.`);
  };

  const handleTabChange = (tool: CompositionTool) => {
    setActiveTool(tool);
    setStatus('');
  };

  if (!composition || isReadOnly || composition.notationSystem === 'gregorian-chant') return null;

  const currentCandidates =
    activeTool === 'reharmonize' ? reharmCandidates :
    activeTool === 'satb'        ? satbCandidates :
    counterCandidates;

  const toolDescriptions: Record<CompositionTool, string> = {
    reharmonize:   'Generates alternative chord progressions and applies them as chord symbols above the staff.',
    satb:          'Builds 4-part Soprano/Alto/Tenor/Bass staves from the chord symbols on the selected staff.',
    countermelody: 'Creates a new melodic line in contrary or complementary motion to the selected staff.',
  };

  return (
    <div className="sv-toolbar flex-wrap gap-y-2 max-w-[820px]">
      <span className="sv-toolbar-label">AI Compose</span>

      {/* Tool tabs */}
      <div className="flex gap-0.5 rounded-md border border-sv-border overflow-hidden">
        {TOOL_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            title={tab.title}
            className={`px-2.5 py-1 text-xs transition-colors ${
              activeTool === tab.id
                ? 'bg-sv-cyan text-sv-bg font-medium'
                : 'bg-sv-card text-sv-text-muted hover:text-sv-text hover:bg-sv-elevated'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Style */}
      <select
        value={style}
        onChange={(e) => setStyle(e.target.value as HarmonyStyle)}
        className="sv-select w-24"
        title="Harmony style"
      >
        {STYLE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={sourceStaffIndex === null || generating}
        className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-sv-cyan text-sv-bg hover:bg-sv-cyan-dim disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        title={`Run ${TOOL_TABS.find((t) => t.id === activeTool)?.label} on "${sourceStaffName}"`}
      >
        {generating ? 'Generating…' : 'Generate 3 ideas'}
      </button>

      {/* Tool description */}
      <span className="text-[11px] text-sv-text-dim italic hidden md:block max-w-[280px] truncate">
        {toolDescriptions[activeTool]}
      </span>

      {/* Status */}
      {status && (
        <span className="w-full text-xs text-sv-text-dim max-w-[640px] truncate">{status}</span>
      )}

      {/* Candidates grid */}
      {currentCandidates.length > 0 && (
        <div className="w-full mt-1 grid grid-cols-1 md:grid-cols-3 gap-2">
          {activeTool === 'reharmonize' &&
            (reharmCandidates as ChordProgressionCandidate[]).map((c) => (
              <CandidateCard
                key={c.id}
                title={c.title}
                description={c.description}
                source={c.source}
                applyLabel="Apply chords"
                onApply={() => handleApplyReharm(c)}
              />
            ))}

          {activeTool === 'satb' &&
            (satbCandidates as ArrangementCandidate[]).map((c) => (
              <CandidateCard
                key={c.id}
                title={c.title}
                description={c.description}
                source={c.source}
                applyLabel="Apply SATB staves"
                onApply={() => handleApplySATB(c)}
              />
            ))}

          {activeTool === 'countermelody' &&
            (counterCandidates as CountermelodyCandidate[]).map((c) => (
              <CandidateCard
                key={c.id}
                title={c.title}
                description={c.description}
                source={c.source}
                applyLabel="Add to score"
                onApply={() => handleApplyCounter(c)}
              />
            ))}
        </div>
      )}
    </div>
  );
};
