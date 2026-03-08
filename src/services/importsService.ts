import {
  collection,
  query,
  where,
  onSnapshot,
  deleteDoc,
  doc,
  getDoc,
} from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';
import { db, storage } from './firebase';

export type JobStatus = 'on_queue' | 'processing' | 'completed' | 'failed';

export interface ScannedJobFileInfo {
  file_id: string;
  file_type: string;
  filename: string;
  storage_path?: string;
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
 * Delete a scanned job document from Firestore and associated storage files.
 * Deletes upload files and result files. If files don't exist, still proceeds with deletion.
 */
export const deleteScannedJob = async (jobId: string): Promise<void> => {
  // First, get the job data to find file paths
  const job = await getScannedJob(jobId);
  if (!job) {
    // Job doesn't exist, nothing to delete
    return;
  }

  const filesToDelete = new Set<string>();

  // Collect upload file paths
  if (job.file_info?.storage_path) {
    filesToDelete.add(job.file_info.storage_path);
  }
  
  if (job.file_info?.file_id) {
    // For single file
    if (!job.filenames || job.filenames.length === 1) {
      const filename = job.file_info.filename || job.filenames?.[0];
      if (filename) {
        let fileExtension = job.file_info.file_type;
        // If file_type is invalid (like "images"), extract from filename
        if (!fileExtension || fileExtension === 'images' || !fileExtension.match(/^(pdf|jpg|jpeg|png|tiff|tif)$/i)) {
          fileExtension = filename.split('.').pop()?.toLowerCase() || 'pdf';
        }
        filesToDelete.add(`uploads/${job.file_info.file_id}.${fileExtension}`);
      }
    }
    
    // For multiple images, try to delete all of them with various patterns
    if (job.filenames && job.filenames.length > 1) {
      job.filenames.forEach((filename, index) => {
        const fileExtension = filename.split('.').pop()?.toLowerCase() || 'png';
        // Try multiple storage patterns
        filesToDelete.add(`uploads/${job.file_info.file_id}_${index}.${fileExtension}`);
        filesToDelete.add(`uploads/${job.file_info.file_id}-${index}.${fileExtension}`);
        filesToDelete.add(`uploads/${job.file_info.file_id}/page_${index}.${fileExtension}`);
        const paddedIndex = String(index + 1).padStart(4, '0');
        filesToDelete.add(`uploads/${job.file_info.file_id}/page_${paddedIndex}.${fileExtension}`);
      });
    }
  }

  // Collect result file paths
  const raw = job as Record<string, unknown>;
  const resultMap = raw['result'];
  if (resultMap && typeof resultMap === 'object' && !Array.isArray(resultMap)) {
    const resultObj = resultMap as Record<string, unknown>;
    if (typeof resultObj['storage_path'] === 'string') {
      filesToDelete.add(resultObj['storage_path']);
    }
  }

  // Delete storage files (ignore errors if files don't exist)
  for (const filePath of filesToDelete) {
    try {
      const storageRef = ref(storage, filePath);
      await deleteObject(storageRef);
    } catch (err) {
      // File might not exist, that's okay - continue with deletion
      const errorCode = (err as any)?.code;
      if (errorCode !== 'storage/object-not-found') {
        // Log other errors but don't fail the deletion
        console.warn(`Failed to delete storage file ${filePath}:`, err);
      }
    }
  }

  // Finally, delete the Firestore document
  const docRef = doc(db, SCANNED_COLLECTION, jobId);
  await deleteDoc(docRef);
};
