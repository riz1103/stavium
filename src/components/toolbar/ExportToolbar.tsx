import { useState } from 'react';
import { useScoreStore } from '../../app/store/scoreStore';
import { exportToMIDI, exportToPDF } from '../../utils/exportUtils';

interface ExportToolbarProps {
  isReadOnly?: boolean;
}

export const ExportToolbar = ({ isReadOnly = false }: ExportToolbarProps) => {
  const composition = useScoreStore((state) => state.composition);
  const [exporting, setExporting] = useState(false);

  const handleExportMIDI = async () => {
    if (!composition) return;
    try {
      setExporting(true);
      const blob = await exportToMIDI(composition);
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `${composition.title || 'composition'}.mid`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting MIDI:', error);
      alert('Failed to export MIDI file');
    } finally {
      setExporting(false);
    }
  };

  const handleExportPDF = () => {
    if (!composition) return;
    try { exportToPDF(composition); }
    catch (error) { console.error('Error exporting PDF:', error); alert('Failed to export PDF'); }
  };

  if (!composition) return null;

  return (
    <div className="sv-toolbar">
      <span className="sv-toolbar-label">Export</span>
      <button
        onClick={handleExportMIDI}
        disabled={exporting}
        title="Export as MIDI"
        className={exporting ? 'sv-btn-ghost opacity-50 cursor-not-allowed' : 'sv-btn-ghost'}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
        </svg>
        <span>{exporting ? 'Exporting…' : 'MIDI'}</span>
      </button>
      <button
        onClick={handleExportPDF}
        title="Export as PDF"
        className="sv-btn-ghost"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
        <span>PDF</span>
      </button>
    </div>
  );
};
