import {
  collection,
  query,
  where,
  onSnapshot,
  deleteDoc,
  doc,
  getDoc,
} from 'firebase/firestore';
import { db } from './firebase';

export type JobStatus = 'on_queue' | 'processing' | 'completed' | 'failed';

export interface ScannedJobFileInfo {
  file_id: string;
  file_type: string;
  filename: string;
}

export interface ScannedJob {
  id: string;
  conversion_type: string;
  created_at: Date;
  updated_at: Date;
  file_info: ScannedJobFileInfo;
  filenames: string[];
  owner: string;
  preprocess: boolean;
  status: JobStatus;
  /** MusicXML text content — populated by the backend when status = 'completed' */
  file_content?: string;
  /** Storage download URL — alternative delivery for large results */
  file_url?: string;
  /** Human-readable error details when status = 'failed' */
  error_message?: string;
  /** Allow arbitrary extra fields the backend may write on completion */
  [key: string]: unknown;
}

const SCANNED_COLLECTION = 'scanned';

/**
 * Real-time listener for all scanned jobs belonging to a user.
 * Returns an unsubscribe function.
 */
export const subscribeToUserJobs = (
  userId: string,
  callback: (jobs: ScannedJob[]) => void,
  onError?: (error: Error) => void
): (() => void) => {
  const colRef = collection(db, SCANNED_COLLECTION);
  // Use only a single-field filter to avoid requiring a composite index.
  // Sorting is done client-side below.
  const q = query(colRef, where('owner', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const jobs: ScannedJob[] = snapshot.docs
        .map((docSnap) => {
          const data = docSnap.data();
          return {
            ...data,
            id: docSnap.id,
            created_at: data.created_at?.toDate?.() ?? new Date(),
            updated_at: data.updated_at?.toDate?.() ?? new Date(),
          } as ScannedJob;
        })
        // Newest-first, sorted client-side
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
      callback(jobs);
    },
    (error) => {
      console.error('[importsService] Snapshot error:', error);
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  );
};

/**
 * Fetch a single scanned job by its document ID.
 * Use this when you need the latest data before acting on a completed job.
 */
export const getScannedJob = async (jobId: string): Promise<ScannedJob | null> => {
  const docRef = doc(db, SCANNED_COLLECTION, jobId);
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists()) return null;
  const data = docSnap.data();
  return {
    ...data,
    id: docSnap.id,
    created_at: data.created_at?.toDate?.() ?? new Date(),
    updated_at: data.updated_at?.toDate?.() ?? new Date(),
  } as ScannedJob;
};

/**
 * Delete a scanned job document from Firestore.
 */
export const deleteScannedJob = async (jobId: string): Promise<void> => {
  const docRef = doc(db, SCANNED_COLLECTION, jobId);
  await deleteDoc(docRef);
};
