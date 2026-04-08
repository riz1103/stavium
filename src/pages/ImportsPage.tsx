import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserStore } from '../app/store/userStore';
import { useScoreStore } from '../app/store/scoreStore';
import { logout } from '../services/authService';
import { omrService } from '../services/omrService';
import {
  subscribeToUserJobs,
  deleteScannedJob,
  getScannedJob,
  ScannedJob,
  JobStatus,
} from '../services/importsService';
import { saveComposition } from '../services/compositionService';
import { importCompositionFromFileWithOptions, type ScanVoiceMode } from '../utils/importUtils';
import { Composition } from '../types/music';
import { storage } from '../services/firebase';
import { ref, getBytes } from 'firebase/storage';

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(date: Date | undefined): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function getFilename(job: ScannedJob): string {
  return (
    job.file_info?.filename ||
    job.filenames?.[0] ||
    job.id.substring(0, 8) + '…'
  );
}

type ImportSourceKind = 'pdf' | 'image' | 'audio' | 'other';

function getImportSourceKind(job: ScannedJob): ImportSourceKind {
  const names = [
    job.file_info?.filename,
    ...(job.filenames?.length ? job.filenames : []),
  ]
    .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
    .map((n) => n.toLowerCase());

  const primary = names[0] || getFilename(job).toLowerCase();
  const extOf = (path: string) =>
    path.includes('.') ? path.slice(path.lastIndexOf('.')) : '';
  const ext = extOf(primary);
  const ft = (job.file_info?.file_type || '').toLowerCase();

  const hasExt = (list: string[]) =>
    names.some((n) => list.some((e) => n.endsWith(e)));

  if (ft === 'pdf' || hasExt(['.pdf'])) return 'pdf';

  const audioExts = ['.wav', '.mp3', '.m4a', '.flac', '.ogg'];
  if (hasExt(audioExts) || ['wav', 'mp3', 'm4a', 'flac', 'ogg'].includes(ft)) {
    return 'audio';
  }

  const imageExts = ['.jpg', '.jpeg', '.png', '.tiff', '.tif'];
  if (
    hasExt(imageExts) ||
    ['jpg', 'jpeg', 'png', 'tiff', 'tif', 'images'].includes(ft)
  ) {
    return 'image';
  }

  if (ext && audioExts.includes(ext)) return 'audio';
  if (ext && imageExts.includes(ext)) return 'image';
  if (ext === '.pdf') return 'pdf';

  return 'other';
}

function ImportJobFileIcon({ job }: { job: ScannedJob }) {
  const kind = getImportSourceKind(job);

  if (kind === 'pdf') {
    return (
      <svg className="w-5 h-5 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    );
  }

  if (kind === 'audio') {
    return (
      <svg className="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12v-.28c0-.682.153-1.354.447-1.985.234-.847.958-1.354 1.938-1.354H6.75z" />
      </svg>
    );
  }

  if (kind === 'image') {
    return (
      <svg className="w-5 h-5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    );
  }

  return (
    <svg className="w-5 h-5 text-sv-text-dim" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  );
}

// ─── Time formatting helpers ──────────────────────────────────────────────────

function formatEstimatedTime(seconds: number): string {
  if (!seconds || seconds <= 0) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins > 0) {
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  return `${secs}s`;
}

function calculateProgress(job: ScannedJob, currentTime: Date): number {
  if (job.status !== 'processing' || !job.estimated_time || job.estimated_time <= 0) {
    return 0;
  }
  
  const now = currentTime.getTime();
  const updatedAt = job.updated_at?.getTime() || job.created_at?.getTime() || now;
  const timeSpent = (now - updatedAt) / 1000; // Convert to seconds
  
  const percentage = (timeSpent / job.estimated_time) * 100;
  
  // Cap at 99% as requested
  return Math.min(99, Math.max(0, percentage));
}

// ─── Status badge ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  JobStatus,
  { label: string; classes: string; dot: string; pulse?: boolean }
> = {
  on_queue: {
    label: 'Queued',
    classes: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
    dot: 'bg-amber-400',
  },
  processing: {
    label: 'Processing',
    classes: 'bg-sv-cyan/15 text-sv-cyan border border-sv-cyan/30',
    dot: 'bg-sv-cyan',
    pulse: true,
  },
  completed: {
    label: 'Completed',
    classes: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
    dot: 'bg-emerald-400',
  },
  failed: {
    label: 'Failed',
    classes: 'bg-rose-500/15 text-rose-400 border border-rose-500/30',
    dot: 'bg-rose-400',
  },
};

function StatusBadge({ status }: { status: JobStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.on_queue;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.classes}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot} ${cfg.pulse ? 'animate-pulse' : ''}`} />
      {cfg.label}
    </span>
  );
}

// ─── MusicXML → Composition helper ──────────────────────────────────────────

async function musicXmlToComposition(
  xmlContent: string,
  filename: string,
  scanVoiceMode: ScanVoiceMode
): Promise<Composition> {
  const blob = new Blob([xmlContent], { type: 'application/xml' });
  const file = new File([blob], filename.replace(/\.(pdf|jpg|jpeg|png|tiff|tif|wav|mp3|m4a|flac|ogg)$/i, '.musicxml') || 'import.musicxml', {
    type: 'application/xml',
  });
  return importCompositionFromFileWithOptions(file, undefined, { scanVoiceMode });
}

// ─── Fetch result content ────────────────────────────────────────────────────

async function fetchJobResult(jobId: string): Promise<string> {
  // Re-fetch the Firestore doc for the latest content
  const job = await getScannedJob(jobId);
  if (!job) throw new Error('Job not found');
  if (job.status !== 'completed') throw new Error('Job is not completed yet');

  const raw = job as Record<string, unknown>;

  // Helper: resolve a string value (downloading if it's a URL)
  const resolveString = async (val: string, label: string): Promise<string> => {
    if (val.startsWith('http://') || val.startsWith('https://')) {
      const res = await fetch(val);
      if (!res.ok) throw new Error(`Failed to download result from "${label}" URL (${res.status})`);
      return await res.text();
    }
    return val;
  };

  // Helper: download from Firebase Storage using storage_path
  // First tries direct Firebase SDK access, falls back to backend API if CORS fails
  const downloadFromStorage = async (storagePath: string): Promise<string> => {
    try {
      // Try direct Firebase SDK access first
      const storageRef = ref(storage, storagePath);
      const bytes = await getBytes(storageRef);
      // Convert bytes to text (assuming UTF-8 encoding for MusicXML)
      return new TextDecoder('utf-8').decode(bytes);
    } catch (err) {
      // If CORS error or other access issue, try backend API as fallback
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (errorMessage.includes('CORS') || errorMessage.includes('cors') || errorMessage.includes('Access-Control')) {
        try {
          return await omrService.downloadFromStorageViaBackend(storagePath);
        } catch (backendErr) {
          throw new Error(
            `Failed to download from Firebase Storage. Direct access failed (CORS), and backend fallback also failed: ${backendErr instanceof Error ? backendErr.message : String(backendErr)}`
          );
        }
      }
      throw new Error(`Failed to download from Firebase Storage: ${errorMessage}`);
    }
  };

  // 1. NEW FORMAT: result.storage_path — download from Firebase Storage
  const resultMap = raw['result'];
  if (resultMap && typeof resultMap === 'object' && !Array.isArray(resultMap)) {
    const resultObj = resultMap as Record<string, unknown>;
    
    // Check for new format: result.storage_path
    if (typeof resultObj['storage_path'] === 'string' && resultObj['storage_path'].trim().length > 0) {
      return await downloadFromStorage(resultObj['storage_path']);
    }
    
    // OLD FORMAT: result.content — the structure confirmed by the backend (map → content field)
    if (typeof resultObj['content'] === 'string' && resultObj['content'].trim().length > 0) {
      return await resolveString(resultObj['content'], 'result.content');
    }
  }

  // 2. Top-level string fields (fallback for alternative backend responses)
  const topLevelCandidates = [
    'file_content', 'content', 'output', 'musicxml', 'musicxml_content',
    'xml_content', 'converted_content', 'download_url', 'file_url',
    'result_url', 'storage_url', 'output_url',
  ];

  for (const key of topLevelCandidates) {
    const val = raw[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      return await resolveString(val, key);
    }
  }

  const knownKeys = Object.keys(job).join(', ');
  throw new Error(
    `No result content found for this job. ` +
    `Available fields: [${knownKeys}]. ` +
    `If "result" is listed, its sub-fields may be missing "content" or "storage_path".`
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export const ImportsPage = () => {
  const user        = useUserStore((state) => state.user);
  const setUser     = useUserStore((state) => state.setUser);
  const setComposition = useScoreStore((state) => state.setComposition);
  const navigate    = useNavigate();

  const [jobs, setJobs]           = useState<ScannedJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError]     = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null); // job id being actioned
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [dragOver, setDragOver]   = useState(false);
  const [avatarDropdownOpen, setAvatarDropdownOpen] = useState(false);
  const [avatarImageError, setAvatarImageError]     = useState(false);
  const [selectedPDF, setSelectedPDF] = useState<File | null>(null);
  const [pageRange, setPageRange] = useState<string>('');
  const [preprocess, setPreprocess] = useState(false);
  const [uploadingStatus, setUploadingStatus] = useState<string>('Queueing conversion...');
  const [audioAvailable, setAudioAvailable] = useState<boolean | null>(null);
  const [audioHealthError, setAudioHealthError] = useState<string | null>(null);
  const [scanVoiceMode, setScanVoiceMode] = useState<ScanVoiceMode>('conservative');
  const [currentTime, setCurrentTime] = useState(new Date()); // For real-time progress updates
  const [navMenuOpen, setNavMenuOpen] = useState(false);
  const avatarDropdownRef = useRef<HTMLDivElement>(null);
  const navMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef      = useRef<HTMLInputElement>(null);

  // ── Avatar helpers ─────────────────────────────────────────────────────────
  const photoURL =
    user?.photoURL ||
    ((user as unknown as { photoUrl?: string } | null)?.photoUrl ?? undefined);
  const hasPhotoURL = photoURL && typeof photoURL === 'string' && photoURL.trim() !== '';

  const getInitials = (): string => {
    if (user?.displayName) {
      const parts = user.displayName.trim().split(/\s+/);
      if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      if (parts[0].length >= 2) return parts[0].substring(0, 2).toUpperCase();
      return parts[0][0].toUpperCase();
    }
    if (user?.email) return user.email.substring(0, 2).toUpperCase();
    return 'U';
  };

  // ── Subscribe to jobs ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    setJobsLoading(true);
    const unsub = subscribeToUserJobs(
      user.uid,
      (updated) => { setJobs(updated); setJobsLoading(false); setJobsError(null); },
      (err) => { setJobsLoading(false); setJobsError(err.message); }
    );
    return () => unsub();
  }, [user, navigate]);

  // ── Update current time for progress calculation ───────────────────────────
  useEffect(() => {
    // Update every second for real-time progress
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Backend health check (audio availability) ──────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const checkHealth = async () => {
      try {
        const health = await omrService.healthCheck();
        if (cancelled) return;
        const audioEnabled = health.audio_transcription_available === true;
        setAudioAvailable(audioEnabled);
        setAudioHealthError(audioEnabled ? null : 'Audio transcription not available on server');
      } catch {
        if (cancelled) return;
        setAudioAvailable(false);
        setAudioHealthError('Audio transcription not available on server');
      }
    };
    checkHealth();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Close avatar dropdown when clicking outside ────────────────────────────
  useEffect(() => {
    if (!avatarDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (avatarDropdownRef.current && !avatarDropdownRef.current.contains(e.target as Node)) {
        setAvatarDropdownOpen(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [avatarDropdownOpen]);

  // Close mobile nav when clicking outside
  useEffect(() => {
    if (!navMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (navMenuRef.current && !navMenuRef.current.contains(e.target as Node)) {
        setNavMenuOpen(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [navMenuOpen]);

  const handleAudioUpload = useCallback(async (file: File) => {
    if (audioAvailable !== true) {
      throw new Error('Audio transcription not available on server');
    }

    setUploadingStatus('Queueing audio conversion...');
    await omrService.queueAudioConversion(file, 'musicxml');
  }, [audioAvailable]);

  // ── Upload logic ───────────────────────────────────────────────────────────
  const handleFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setUploadError(null);
    setUploading(true);
    setUploadingStatus('Queueing conversion...');
    try {
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.tiff', '.tif'];
      const audioExtensions = ['.wav', '.mp3', '.m4a', '.flac', '.ogg'];
      const allImages = files.every((f) =>
        imageExtensions.some((ext) => f.name.toLowerCase().endsWith(ext))
      );
      const allAudio = files.every((f) =>
        audioExtensions.some((ext) => f.name.toLowerCase().endsWith(ext))
      );

      if (allImages) {
        setUploadingStatus('Queueing image conversion...');
        const pageNumbers = files.map((_, i) => i + 1);
        await omrService.queueImagesConversion(files, pageNumbers, preprocess);
        // Reset state after successful upload
        setSelectedPDF(null);
        setPageRange('');
      } else if (allAudio) {
        if (files.length !== 1) {
          throw new Error('Please upload one audio file at a time (WAV, MP3, M4A, FLAC, OGG).');
        }
        await handleAudioUpload(files[0]);
      } else if (files.length === 1 && files[0].name.toLowerCase().endsWith('.pdf')) {
        // For PDFs, show the page range input instead of uploading immediately
        setSelectedPDF(files[0]);
        // Don't upload yet - wait for user to optionally set page range and click upload
      } else {
        throw new Error(
          'Please upload one PDF, one audio file (WAV, MP3, M4A, FLAC, OGG), or one/more image files (JPEG, PNG, TIFF).'
        );
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }, [handleAudioUpload, preprocess]);

  // ── Upload PDF with optional page range ────────────────────────────────────
  const handlePDFUpload = useCallback(async () => {
    if (!selectedPDF) return;
    setUploadError(null);
    setUploading(true);
    setUploadingStatus('Queueing PDF conversion...');
    try {
      await omrService.queuePDFConversion(selectedPDF, pageRange || undefined, preprocess);
      // Success — the Firestore listener will automatically pick up the new job
      setSelectedPDF(null);
      setPageRange('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }, [selectedPDF, pageRange, preprocess]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    e.target.value = '';
    handleFiles(files);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  };

  // ── Delete job ─────────────────────────────────────────────────────────────
  const handleDelete = async (job: ScannedJob, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete import "${getFilename(job)}"? This cannot be undone.`)) return;
    try {
      setDeletingId(job.id);
      await deleteScannedJob(job.id);
    } catch (err) {
      console.error('Failed to delete job:', err);
      alert('Failed to delete the import job.');
    } finally {
      setDeletingId(null);
    }
  };

  // ── Open in editor ─────────────────────────────────────────────────────────
  const handleOpenInEditor = async (job: ScannedJob) => {
    try {
      setActionLoading(job.id);
      const xmlContent = await fetchJobResult(job.id);
      const composition = await musicXmlToComposition(xmlContent, getFilename(job), scanVoiceMode);
      setComposition({ ...composition, userId: user?.uid });
      navigate('/editor', { state: { imported: true } });
    } catch (err) {
      console.error('Failed to open in editor:', err);
      alert(err instanceof Error ? err.message : 'Failed to open in editor.');
    } finally {
      setActionLoading(null);
    }
  };

  // ── Save as composition ────────────────────────────────────────────────────
  const handleSaveAsComposition = async (job: ScannedJob) => {
    if (!user) return;
    try {
      setActionLoading(job.id + '_save');
      const xmlContent = await fetchJobResult(job.id);
      const composition = await musicXmlToComposition(xmlContent, getFilename(job), scanVoiceMode);
      const savedId = await saveComposition(
        { ...composition, userId: user.uid, createdAt: new Date() },
        user.uid,
        user.uid,
        {
          ownerEmail: user.email,
          ownerName: user.displayName,
        }
      );
      setComposition({ ...composition, id: savedId, userId: user.uid });
      navigate(`/editor/${savedId}`, { state: { imported: true } });
    } catch (err) {
      console.error('Failed to save composition:', err);
      alert(err instanceof Error ? err.message : 'Failed to save composition.');
    } finally {
      setActionLoading(null);
    }
  };

  // ── Download raw MusicXML result ───────────────────────────────────────────
  const handleDownloadMusicXML = async (job: ScannedJob) => {
    try {
      setActionLoading(job.id + '_xml');
      const xmlContent = await fetchJobResult(job.id);

      const filenameBase = getFilename(job).replace(/\.[^/.]+$/, '');
      const downloadName = `${filenameBase || 'import'}.musicxml`;
      const blob = new Blob([xmlContent], { type: 'application/xml' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Failed to download MusicXML:', err);
      alert(err instanceof Error ? err.message : 'Failed to download MusicXML.');
    } finally {
      setActionLoading(null);
    }
  };

  // ── Download original file(s) ─────────────────────────────────────────────
  const handleDownloadOriginal = async (job: ScannedJob) => {
    try {
      setActionLoading(job.id + '_download');
      
      // Check if there are multiple files (images)
      const hasMultipleFiles = job.filenames && job.filenames.length > 1;
      
      if (hasMultipleFiles) {
        // Download all files individually
        // Try multiple path patterns since backend might store them differently
        for (let i = 0; i < job.filenames.length; i++) {
          const filename = job.filenames[i];
          const fileExtension = filename.split('.').pop()?.toLowerCase() || 'png';
          
          // Try multiple storage path patterns
          const possiblePaths: string[] = [];
          
          if (job.file_info?.file_id) {
            // Pattern 1: file_id_0.png, file_id_1.png, etc.
            possiblePaths.push(`uploads/${job.file_info.file_id}_${i}.${fileExtension}`);
            // Pattern 2: file_id-0.png, file_id-1.png, etc.
            possiblePaths.push(`uploads/${job.file_info.file_id}-${i}.${fileExtension}`);
            // Pattern 3: file_id/page_0.png, file_id/page_1.png, etc.
            possiblePaths.push(`uploads/${job.file_info.file_id}/page_${i}.${fileExtension}`);
            // Pattern 4: file_id/page_0001.png, file_id/page_0002.png, etc.
            const paddedIndex = String(i + 1).padStart(4, '0');
            possiblePaths.push(`uploads/${job.file_info.file_id}/page_${paddedIndex}.${fileExtension}`);
            // Pattern 5: file_id with original filename
            possiblePaths.push(`uploads/${job.file_info.file_id}/${filename}`);
          }
          
          // Pattern 6: Direct filename match
          possiblePaths.push(`uploads/${filename}`);
          
          // Try each path until one works
          let downloaded = false;
          for (const storagePath of possiblePaths) {
            try {
              const storageRef = ref(storage, storagePath);
              const bytes = await getBytes(storageRef);
              
              const mimeTypes: Record<string, string> = {
                'pdf': 'application/pdf',
                'jpg': 'image/jpeg',
                'jpeg': 'image/jpeg',
                'png': 'image/png',
                'tiff': 'image/tiff',
                'tif': 'image/tiff',
              };
              const mimeType = mimeTypes[fileExtension] || 'application/octet-stream';
              
              const blob = new Blob([bytes], { type: mimeType });
              const url = window.URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = filename;
              document.body.appendChild(a);
              a.click();
              window.URL.revokeObjectURL(url);
              document.body.removeChild(a);
              
              downloaded = true;
              break; // Success, move to next file
            } catch (pathErr) {
              // Try next path
              continue;
            }
          }
          
          if (!downloaded) {
            console.warn(`Failed to download ${filename} - tried paths:`, possiblePaths);
          }
          
          // Small delay between downloads to avoid browser blocking
          if (i < job.filenames.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
      } else {
        // Single file download
        let storagePath = job.file_info?.storage_path;
        
        // Fallback: construct path from file_id if storage_path not available
        if (!storagePath && job.file_info?.file_id) {
          // Get file extension from filename or file_type
          const filename = getFilename(job);
          let fileExtension = job.file_info?.file_type;
          
          // If file_type is not a valid extension, extract from filename
          if (!fileExtension || fileExtension === 'images') {
            fileExtension = filename.split('.').pop()?.toLowerCase() || 'pdf';
          }
          
          // Normalize common extensions
          if (fileExtension === 'jpg') fileExtension = 'jpeg';
          
          storagePath = `uploads/${job.file_info.file_id}.${fileExtension}`;
        }
        
        if (!storagePath) {
          throw new Error('Original file path not found');
        }

        // Try downloading with the constructed path
        let downloaded = false;
        const pathsToTry = [storagePath];
        
        // If the first path fails, try alternative patterns
        if (job.file_info?.file_id) {
          const filename = getFilename(job);
          pathsToTry.push(`uploads/${job.file_info.file_id}/${filename}`);
          pathsToTry.push(`uploads/${filename}`);
        }
        
        for (const pathToTry of pathsToTry) {
          try {
            const storageRef = ref(storage, pathToTry);
            const bytes = await getBytes(storageRef);
            
            // Get the original filename
            const filename = getFilename(job);
            let fileExtension = job.file_info?.file_type;
            
            // If file_type is not a valid extension, extract from filename
            if (!fileExtension || fileExtension === 'images' || !fileExtension.match(/^(pdf|jpg|jpeg|png|tiff|tif)$/i)) {
              fileExtension = filename.split('.').pop()?.toLowerCase() || 'pdf';
            }
            
            const downloadFilename = filename.endsWith(`.${fileExtension}`) 
              ? filename 
              : `${filename}.${fileExtension}`;

            // Determine MIME type
            const mimeTypes: Record<string, string> = {
              'pdf': 'application/pdf',
              'jpg': 'image/jpeg',
              'jpeg': 'image/jpeg',
              'png': 'image/png',
              'tiff': 'image/tiff',
              'tif': 'image/tiff',
            };
            const mimeType = mimeTypes[fileExtension.toLowerCase()] || 'application/octet-stream';

            // Create blob and download
            const blob = new Blob([bytes], { type: mimeType });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = downloadFilename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            
            downloaded = true;
            break; // Success, exit loop
          } catch (pathErr) {
            // Try next path
            continue;
          }
        }
        
        if (!downloaded) {
          throw new Error(`Failed to download file. Tried paths: ${pathsToTry.join(', ')}`);
        }
      }
    } catch (err) {
      console.error('Failed to download original file:', err);
      alert(err instanceof Error ? err.message : 'Failed to download original file.');
    } finally {
      setActionLoading(null);
    }
  };

  // ── Logout ─────────────────────────────────────────────────────────────────
  const handleLogout = async () => {
    try { await logout(); setUser(null); navigate('/login'); }
    catch (err) { console.error(err); }
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-sv-bg flex flex-col overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 border-b border-sv-border bg-sv-card relative">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between gap-2">
          {/* Logo + nav (desktop) + hamburger (mobile) */}
          <div ref={navMenuRef} className="flex items-center gap-3 sm:gap-6 min-w-0 flex-1">
            <button
              onClick={() => navigate('/dashboard')}
              className="flex items-center gap-2 sm:gap-3 hover:opacity-80 transition-opacity flex-shrink-0"
            >
              <img src="/stavium_logo.png" alt="Stavium" className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg object-cover" />
              <div className="min-w-0">
                <span className="text-base sm:text-lg font-bold tracking-widest text-sv-text uppercase">STAVIUM</span>
                <span className="hidden sm:block text-xs text-sv-text-dim tracking-[0.2em] uppercase -mt-0.5">
                  Compose · Play · Create
                </span>
              </div>
            </button>

            {/* Nav links — desktop */}
            <nav className="hidden sm:flex items-center gap-1">
              <button
                onClick={() => navigate('/dashboard')}
                className="px-3 py-1.5 rounded-md text-sm text-sv-text-muted hover:text-sv-text hover:bg-sv-elevated transition-colors"
              >
                Compositions
              </button>
              <button
                className="px-3 py-1.5 rounded-md text-sm font-medium text-sv-cyan bg-sv-cyan/10 border border-sv-cyan/20"
              >
                Imports
              </button>
              <button
                onClick={() => navigate('/help')}
                className="px-3 py-1.5 rounded-md text-sm text-sv-text-muted hover:text-sv-text hover:bg-sv-elevated transition-colors"
              >
                Help
              </button>
            </nav>

            {/* Hamburger — mobile only */}
            <button
              type="button"
              onClick={() => { setNavMenuOpen((o) => !o); setAvatarDropdownOpen(false); }}
              className="sm:hidden flex items-center justify-center w-10 h-10 rounded-lg text-sv-text hover:bg-sv-elevated transition-colors ml-auto"
              aria-label="Open menu"
              aria-expanded={navMenuOpen}
            >
              {navMenuOpen ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>

          {/* Mobile nav menu */}
          {navMenuOpen && (
            <div className="sm:hidden absolute top-full left-0 right-0 z-40 bg-sv-card border-b border-sv-border shadow-lg">
              <nav className="px-3 py-2 flex flex-col gap-0.5 max-w-6xl mx-auto">
                <button
                  onClick={() => { navigate('/dashboard'); setNavMenuOpen(false); }}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg text-left text-sm font-medium text-sv-text-muted hover:text-sv-text hover:bg-sv-elevated transition-colors"
                >
                  Compositions
                </button>
                <button
                  className="flex items-center gap-3 px-4 py-3 rounded-lg text-left text-sm font-medium text-sv-cyan bg-sv-cyan/10 border border-sv-cyan/20"
                >
                  Imports
                </button>
                <button
                  onClick={() => { navigate('/help'); setNavMenuOpen(false); }}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg text-left text-sm font-medium text-sv-text-muted hover:text-sv-text hover:bg-sv-elevated transition-colors"
                >
                  Help
                </button>
              </nav>
            </div>
          )}

          {/* Avatar dropdown */}
          <div className="relative" ref={avatarDropdownRef}>
            <button
              onClick={() => setAvatarDropdownOpen((o) => !o)}
              className="flex items-center gap-2 rounded-lg hover:bg-sv-elevated transition-colors p-1.5"
              aria-label="User menu"
            >
              {hasPhotoURL && !avatarImageError ? (
                <img
                  src={photoURL}
                  alt={user?.displayName || user?.email || 'User'}
                  className="w-8 h-8 rounded-full object-cover border border-sv-border"
                  onError={() => setAvatarImageError(true)}
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-sv-cyan/20 flex items-center justify-center border border-sv-border">
                  <span className="text-sv-cyan text-xs font-semibold">{getInitials()}</span>
                </div>
              )}
              <svg
                className={`w-4 h-4 text-sv-text-dim transition-transform ${avatarDropdownOpen ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {avatarDropdownOpen && (
              <div className="absolute right-0 mt-2 w-64 bg-sv-card border border-sv-border rounded-lg shadow-lg z-50 overflow-hidden">
                <div className="p-4 border-b border-sv-border">
                  <div className="flex items-center gap-3">
                    {hasPhotoURL && !avatarImageError ? (
                      <img src={photoURL} alt="" className="w-10 h-10 rounded-full object-cover border border-sv-border" onError={() => setAvatarImageError(true)} />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-sv-cyan/20 flex items-center justify-center border border-sv-border">
                        <span className="text-sv-cyan text-sm font-semibold">{getInitials()}</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      {user?.displayName && (
                        <p className="text-sm font-medium text-sv-text truncate">{user.displayName}</p>
                      )}
                      <p className="text-xs text-sv-text-muted truncate">{user?.email}</p>
                    </div>
                  </div>
                </div>
                <div className="p-2">
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-sv-text hover:bg-sv-elevated rounded-md transition-colors text-left"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Main ───────────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 py-4 sm:py-8">

          {/* Page title */}
          <div className="mb-6">
            <h2 className="text-2xl font-semibold text-sv-text">OCR Imports</h2>
            <p className="text-sm text-sv-text-muted mt-1">
              Upload PDF/image scans for OCR queue jobs, or upload one audio file to transcribe directly into notation.
            </p>
          </div>

          <div className="mb-6 p-3 rounded-lg bg-violet-500/10 border border-violet-500/25 flex items-start gap-3">
            <span className="flex-shrink-0 mt-0.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-violet-200 bg-violet-500/20 border border-violet-400/30">
              Beta
            </span>
            <p className="text-sm text-sv-text-muted leading-relaxed">
              Audio-to-score is still in beta. Transcription may not match your recording accurately—review and edit the result in the editor.
            </p>
          </div>

          {audioHealthError && (
            <div className="mb-6 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-start gap-3">
              <svg className="w-5 h-5 text-amber-300 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="text-amber-200 text-sm font-medium">Audio transcription unavailable</p>
                <p className="text-amber-100/80 text-sm mt-0.5">Audio transcription not available on server</p>
              </div>
            </div>
          )}

          {/* ── Upload drop zone ──────────────────────────────────────────────── */}
          <div
            className={`relative rounded-xl border-2 border-dashed transition-all mb-8 cursor-pointer
              ${dragOver
                ? 'border-sv-cyan bg-sv-cyan/5 scale-[1.01]'
                : 'border-sv-border hover:border-sv-cyan/50 hover:bg-sv-cyan/5'
              }
              ${uploading ? 'pointer-events-none opacity-60' : ''}`}
            onClick={() => !uploading && fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif,.wav,.mp3,.m4a,.flac,.ogg"
              onChange={handleInputChange}
              className="hidden"
            />

            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              {uploading ? (
                <>
                  <div className="w-10 h-10 border-2 border-sv-border border-t-sv-cyan rounded-full animate-spin mb-4" />
                  <p className="text-sv-text font-medium">{uploadingStatus}</p>
                  <p className="text-sv-text-muted text-sm mt-1">Your job will appear in the list below.</p>
                </>
              ) : (
                <>
                  <div className="w-14 h-14 rounded-2xl bg-sv-cyan/10 border border-sv-cyan/20 flex items-center justify-center mb-4">
                    <svg className="w-7 h-7 text-sv-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  <p className="text-sv-text font-medium mb-1">
                    Drop files here or <span className="text-sv-cyan">click to browse</span>
                  </p>
                  <p className="text-sv-text-muted text-sm">
                    PDF sheets, image scans (JPEG, PNG, TIFF), or one audio file (WAV, MP3, M4A, FLAC, OGG)
                  </p>
                </>
              )}
            </div>
          </div>

          {/* ── Pre-processing option ───────────────────────────────────────────── */}
          <div className="mb-6 flex items-start gap-3 p-3 rounded-lg bg-sv-card/50 border border-sv-border">
            <input
              id="preprocess"
              type="checkbox"
              checked={preprocess}
              onChange={(e) => setPreprocess(e.target.checked)}
              className="mt-1 w-4 h-4 rounded border-sv-border bg-sv-elevated text-sv-cyan focus:ring-sv-cyan/50"
            />
            <label htmlFor="preprocess" className="flex-1 cursor-pointer">
              <span className="text-sm font-medium text-sv-text">Enable pre-processing</span>
              <p className="text-xs text-sv-text-muted mt-0.5">
                Improve OCR on scans by enhancing contrast and cleaning the image before conversion. Turn on for low-quality or noisy scans.
              </p>
            </label>
          </div>

          {/* ── Scan voice split mode ───────────────────────────────────────────── */}
          <div className="mb-6 p-3 rounded-lg bg-sv-card/50 border border-sv-border">
            <label htmlFor="scan-voice-mode" className="block text-sm font-medium text-sv-text mb-1.5">
              Scan voice split mode
            </label>
            <select
              id="scan-voice-mode"
              value={scanVoiceMode}
              onChange={(e) => setScanVoiceMode(e.target.value as ScanVoiceMode)}
              className="w-full sm:w-80 px-3 py-2 rounded-lg bg-sv-elevated border border-sv-border text-sv-text text-sm
                         focus:outline-none focus:ring-2 focus:ring-sv-cyan/50 focus:border-sv-cyan/50 transition-all"
            >
              <option value="conservative">Conservative (recommended)</option>
              <option value="aggressive">Aggressive multi-voice split</option>
            </select>
            <p className="text-xs text-sv-text-muted mt-1.5">
              Conservative keeps scans cleaner and avoids noisy voice splitting. Aggressive keeps more detected parallel voices.
            </p>
          </div>

          {/* ── PDF Page Range Input (shown when PDF is selected) ───────────────── */}
          {selectedPDF && !uploading && (
            <div className="mb-6 p-4 rounded-xl bg-sv-card border border-sv-border">
              <div className="flex items-start gap-3 mb-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-sv-elevated border border-sv-border flex items-center justify-center">
                  <svg className="w-5 h-5 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-sv-text truncate">{selectedPDF.name}</p>
                  <p className="text-xs text-sv-text-muted mt-0.5">
                    {(selectedPDF.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                <button
                  onClick={() => {
                    setSelectedPDF(null);
                    setPageRange('');
                    if (fileInputRef.current) {
                      fileInputRef.current.value = '';
                    }
                  }}
                  className="flex-shrink-0 text-sv-text-dim hover:text-sv-text transition-colors"
                  title="Remove file"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label htmlFor="page-range" className="block text-xs font-medium text-sv-text mb-1.5">
                    Page Range (Optional)
                  </label>
                  <input
                    id="page-range"
                    type="text"
                    value={pageRange}
                    onChange={(e) => setPageRange(e.target.value)}
                    placeholder="e.g., 1-3, 1,3,5, or 1-3,5-7"
                    className="w-full px-3 py-2 rounded-lg bg-sv-elevated border border-sv-border text-sv-text text-sm
                               placeholder:text-sv-text-dim focus:outline-none focus:ring-2 focus:ring-sv-cyan/50 focus:border-sv-cyan/50
                               transition-all"
                  />
                  <p className="text-xs text-sv-text-muted mt-1.5">
                    Leave empty to process all pages. Examples: <code className="text-sv-cyan">1-3</code>, <code className="text-sv-cyan">1,3,5</code>, <code className="text-sv-cyan">1-3,5-7</code>
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handlePDFUpload}
                    disabled={uploading}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold
                               bg-sv-cyan/10 border border-sv-cyan/30 text-sv-cyan
                               hover:bg-sv-cyan/20 hover:border-sv-cyan/50 transition-all
                               disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    Upload PDF
                  </button>
                  <button
                    onClick={() => {
                      setSelectedPDF(null);
                      setPageRange('');
                      if (fileInputRef.current) {
                        fileInputRef.current.value = '';
                      }
                    }}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-sv-text-dim hover:text-sv-text
                               hover:bg-sv-elevated border border-sv-border transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Upload error */}
          {uploadError && (
            <div className="mb-6 p-4 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-start gap-3">
              <svg className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <p className="text-rose-300 text-sm font-medium">Upload failed</p>
                <p className="text-rose-400/80 text-sm mt-0.5">{uploadError}</p>
              </div>
              <button
                onClick={() => setUploadError(null)}
                className="ml-auto text-rose-400/60 hover:text-rose-400 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* ── Job list ──────────────────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-sv-text">Import Jobs</h3>
              {jobs.length > 0 && (
                <span className="text-xs text-sv-text-dim">{jobs.length} job{jobs.length !== 1 ? 's' : ''}</span>
              )}
            </div>

            {/* Loading */}
            {jobsLoading ? (
              <div className="flex items-center justify-center py-16 gap-3">
                <div className="w-6 h-6 border-2 border-sv-border border-t-sv-cyan rounded-full animate-spin" />
                <p className="text-sv-text-dim text-sm">Loading jobs…</p>
              </div>

            /* Firestore error */
            ) : jobsError ? (
              <div className="p-4 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-start gap-3">
                <svg className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <p className="text-rose-300 text-sm font-medium">Failed to load import jobs</p>
                  <p className="text-rose-400/80 text-sm mt-0.5 font-mono">{jobsError}</p>
                </div>
              </div>

            /* Empty */
            ) : jobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 sv-card rounded-2xl animate-fade-in">
                <div className="text-5xl mb-4 opacity-30">🎼</div>
                <h3 className="text-lg font-semibold text-sv-text mb-2">No imports yet</h3>
                <p className="text-sv-text-muted text-sm text-center max-w-sm">
                  Upload a PDF or image scan above to start an OCR conversion job.
                </p>
              </div>

            /* List */
            ) : (
              <div className="space-y-3 animate-fade-in">
                {jobs.map((job) => {
                  const filename = getFilename(job);
                  const isActioning =
                    actionLoading === job.id ||
                    actionLoading === job.id + '_save' ||
                    actionLoading === job.id + '_download' ||
                    actionLoading === job.id + '_xml';
                  const isDeleting  = deletingId === job.id;

                  return (
                    <div
                      key={job.id}
                      className="sv-card rounded-xl p-4 group hover:border-sv-border-lt transition-all duration-200"
                    >
                      <div className="flex items-start gap-4">
                        {/* File icon */}
                        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-sv-elevated border border-sv-border flex items-center justify-center">
                          <ImportJobFileIcon job={job} />
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
                            <p className="text-sm font-semibold text-sv-text truncate max-w-sm" title={filename}>
                              {filename}
                            </p>
                            <StatusBadge status={job.status} />
                          </div>

                          <div className="flex items-center gap-3 flex-wrap text-xs text-sv-text-dim">
                            <span className="capitalize">{job.conversion_type}</span>
                            <span>·</span>
                            <span>Submitted {formatDate(job.created_at)}</span>
                            {job.updated_at && job.updated_at.getTime() !== job.created_at?.getTime() && (
                              <>
                                <span>·</span>
                                <span>Updated {formatDate(job.updated_at)}</span>
                              </>
                            )}
                          </div>

                          {/* Estimated time / Progress */}
                          {(job.status === 'on_queue' || job.status === 'processing') && job.estimated_time && (
                            <div className="mt-2">
                              {job.status === 'on_queue' ? (
                                <div className="flex items-center gap-2 text-xs text-sv-text-dim">
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                  <span>Estimated: {formatEstimatedTime(job.estimated_time)}</span>
                                </div>
                              ) : (
                                <div className="space-y-1.5">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="text-sv-text-dim">Processing...</span>
                                    <span className="text-sv-cyan font-medium">
                                      {Math.round(calculateProgress(job, currentTime))}%
                                    </span>
                                  </div>
                                  <div className="w-full h-1.5 bg-sv-elevated rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-sv-cyan transition-all duration-500 ease-out"
                                      style={{ width: `${calculateProgress(job, currentTime)}%` }}
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Error message */}
                          {job.status === 'failed' && (job.error?.message || job.error_message) && (
                            <div className="mt-2 p-3 rounded-md bg-rose-500/10 border border-rose-500/20">
                              <div className="flex items-start gap-2">
                                <svg className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-semibold text-rose-400 mb-1">Conversion Failed</p>
                                  <p className="text-xs text-rose-300/90 whitespace-pre-wrap break-words">
                                    {job.error?.message || job.error_message}
                                  </p>
                                  {job.error?.type && (
                                    <p className="text-xs text-rose-400/60 mt-1">Error Type: {job.error.type}</p>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Actions */}
                          <div className="flex items-center gap-2 mt-3 flex-wrap">
                            {/* Download original file(s) - available for all jobs with file info */}
                            {(job.file_info?.storage_path || job.file_info?.file_id || (job.filenames && job.filenames.length > 0)) && (
                              <button
                                onClick={() => handleDownloadOriginal(job)}
                                disabled={isActioning}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                                           bg-blue-500/10 border border-blue-500/30 text-blue-400
                                           hover:bg-blue-500/20 hover:border-blue-500/50 transition-all
                                           disabled:opacity-50 disabled:cursor-not-allowed
                                           cursor-pointer active:scale-95"
                                title={job.filenames && job.filenames.length > 1 
                                  ? `Download ${job.filenames.length} original files` 
                                  : "Download original uploaded file"}
                              >
                                {isActioning && actionLoading === job.id + '_download' ? (
                                  <span className="w-3 h-3 border border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
                                ) : (
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                  </svg>
                                )}
                                {job.filenames && job.filenames.length > 1 
                                  ? `Download (${job.filenames.length})` 
                                  : 'Download Original'}
                              </button>
                            )}

                            {job.status === 'completed' && (
                              <>
                                <button
                                  onClick={() => handleOpenInEditor(job)}
                                  disabled={isActioning}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                                             bg-sv-cyan/10 border border-sv-cyan/30 text-sv-cyan
                                             hover:bg-sv-cyan/20 hover:border-sv-cyan/50 transition-all
                                             disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  {isActioning && actionLoading === job.id ? (
                                    <span className="w-3 h-3 border border-sv-cyan/30 border-t-sv-cyan rounded-full animate-spin" />
                                  ) : (
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                    </svg>
                                  )}
                                  Open in Editor
                                </button>

                                <button
                                  onClick={() => handleSaveAsComposition(job)}
                                  disabled={isActioning}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                                             bg-emerald-500/10 border border-emerald-500/30 text-emerald-400
                                             hover:bg-emerald-500/20 hover:border-emerald-500/50 transition-all
                                             disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  {isActioning && actionLoading === job.id + '_save' ? (
                                    <span className="w-3 h-3 border border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin" />
                                  ) : (
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                        d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                                    </svg>
                                  )}
                                  Save as Composition
                                </button>

                                <button
                                  onClick={() => handleDownloadMusicXML(job)}
                                  disabled={isActioning}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                                             bg-violet-500/10 border border-violet-500/30 text-violet-300
                                             hover:bg-violet-500/20 hover:border-violet-500/50 transition-all
                                             disabled:opacity-50 disabled:cursor-not-allowed"
                                  title="Download raw MusicXML result file"
                                >
                                  {isActioning && actionLoading === job.id + '_xml' ? (
                                    <span className="w-3 h-3 border border-violet-300/30 border-t-violet-300 rounded-full animate-spin" />
                                  ) : (
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                        d="M8 9l3 3-3 3m5 0h3M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                    </svg>
                                  )}
                                  Download MusicXML
                                </button>
                              </>
                            )}

                            {job.status === 'on_queue' && (
                              <span className="text-xs text-sv-text-dim italic">
                                Waiting in queue…
                              </span>
                            )}
                            {job.status === 'processing' && (
                              <span className="text-xs text-sv-text-dim italic">
                                Conversion in progress…
                              </span>
                            )}

                            {job.status === 'failed' && (
                              <span className="text-xs text-rose-400/70 italic">
                                This job failed. Delete and try again.
                              </span>
                            )}

                            {/* Delete */}
                            <button
                              onClick={(e) => handleDelete(job, e)}
                              disabled={isDeleting || isActioning}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                                         text-sv-text-dim hover:text-rose-400 hover:bg-rose-500/10 border border-transparent
                                         hover:border-rose-500/20 transition-all ml-auto
                                         disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Delete job"
                            >
                              {isDeleting ? (
                                <span className="w-3 h-3 border border-sv-text-dim/30 border-t-sv-text-dim rounded-full animate-spin" />
                              ) : (
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              )}
                              <span className="hidden sm:inline">Delete</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};
