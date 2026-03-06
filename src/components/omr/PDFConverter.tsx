import React, { useState, useRef } from 'react';
import { omrService, validatePDFFile, ConversionFormat } from '../../services/omrService';
import type { MusicXMLResponse, VexFlowResponse } from '../../services/omrService';

interface PDFConverterProps {
  onVexFlowConverted?: (data: VexFlowResponse['data']) => void;
  onMusicXMLConverted?: (content: string) => void;
  className?: string;
}

export const PDFConverter: React.FC<PDFConverterProps> = ({
  onVexFlowConverted,
  onMusicXMLConverted,
  className = ''
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [convertingFormat, setConvertingFormat] = useState<ConversionFormat | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      try {
        validatePDFFile(selectedFile);
        setFile(selectedFile);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid file');
        setFile(null);
      }
    }
  };

  const convertPDF = async (format: ConversionFormat) => {
    if (!file) {
      setError('Please select a file');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setConvertingFormat(format);

    try {
      switch (format) {
        case 'musicxml': {
          const response = await omrService.convertToMusicXML(file);
          setResult(response.file_content);
          onMusicXMLConverted?.(response.file_content);
          break;
        }
        case 'midi': {
          const blob = await omrService.convertToMIDI(file);
          const filename = `${file.name.replace(/\.pdf$/i, '')}.mid`;
          omrService.downloadMIDI(blob, filename);
          setResult('MIDI file downloaded successfully');
          break;
        }
        case 'vexflow': {
          const response = await omrService.convertToVexFlow(file);
          setResult(JSON.stringify(response.data, null, 2));
          onVexFlowConverted?.(response.data);
          break;
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Conversion failed';
      setError(errorMessage);
      console.error('Conversion error:', err);
    } finally {
      setLoading(false);
      setConvertingFormat(null);
    }
  };

  const handleFileClick = () => {
    fileInputRef.current?.click();
  };

  const clearFile = () => {
    setFile(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className={`pdf-converter ${className}`}>
      <div className="mb-4">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          onChange={handleFileSelect}
          className="hidden"
          id="pdf-file-input"
        />
        <label
          htmlFor="pdf-file-input"
          className="sv-btn-ghost cursor-pointer"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          {file ? file.name : 'Select PDF File'}
        </label>
        {file && (
          <button
            onClick={clearFile}
            className="sv-btn-ghost ml-2"
            aria-label="Clear file"
          >
            ✕
          </button>
        )}
      </div>

      {file && (
        <div className="mb-4 p-3" style={{ background: 'var(--sv-card)', border: '1px solid var(--sv-border)', borderRadius: '6px' }}>
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-sm font-medium" style={{ color: 'var(--sv-text)' }}>{file.name}</p>
              <p className="text-xs" style={{ color: 'var(--sv-text-muted)' }}>
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-4 flex-wrap">
        <button
          onClick={() => convertPDF('musicxml')}
          disabled={loading || !file}
          className="sv-btn-active"
          style={{ opacity: loading || !file ? 0.5 : 1, cursor: loading || !file ? 'not-allowed' : 'pointer' }}
        >
          {loading && convertingFormat === 'musicxml' ? 'Converting...' : 'Convert to MusicXML'}
        </button>
        <button
          onClick={() => convertPDF('midi')}
          disabled={loading || !file}
          className="sv-btn-active"
          style={{ opacity: loading || !file ? 0.5 : 1, cursor: loading || !file ? 'not-allowed' : 'pointer' }}
        >
          {loading && convertingFormat === 'midi' ? 'Converting...' : 'Convert to MIDI'}
        </button>
        <button
          onClick={() => convertPDF('vexflow')}
          disabled={loading || !file}
          className="sv-btn-active"
          style={{ opacity: loading || !file ? 0.5 : 1, cursor: loading || !file ? 'not-allowed' : 'pointer' }}
        >
          {loading && convertingFormat === 'vexflow' ? 'Converting...' : 'Convert to VexFlow'}
        </button>
      </div>

      {loading && (
        <div className="mb-4 flex items-center gap-2" style={{ color: 'var(--sv-text-muted)' }}>
          <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--sv-border)', borderTopColor: 'var(--sv-cyan)' }} />
          <span>Processing PDF conversion...</span>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 rounded-lg" style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
          <p className="text-sm" style={{ color: 'rgb(239, 68, 68)' }}>
            <strong>Error:</strong> {error}
          </p>
        </div>
      )}

      {result && !loading && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold" style={{ color: 'var(--sv-text)' }}>Result:</h3>
            <button
              onClick={() => setResult(null)}
              className="sv-btn-ghost text-sm"
            >
              Clear
            </button>
          </div>
          <div className="p-4 rounded-lg overflow-auto max-h-96" style={{ background: 'var(--sv-card)', border: '1px solid var(--sv-border)' }}>
            <pre className="text-xs whitespace-pre-wrap font-mono" style={{ color: 'var(--sv-text)' }}>
              {result}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};

export default PDFConverter;
