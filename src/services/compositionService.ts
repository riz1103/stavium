import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  getDocsFromCache,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  writeBatch,
  runTransaction,
  Timestamp,
} from 'firebase/firestore';
import { FirebaseError } from 'firebase/app';
import { db } from './firebase';
import { Composition } from '../types/music';

const COMPOSITIONS_COLLECTION = 'compositions';
const COMPOSITION_REVISIONS_COLLECTION = 'compositionRevisions';
const COMPOSITION_COMMENT_THREADS_COLLECTION = 'compositionCommentThreads';
const COMPOSITION_THREAD_COMMENTS_COLLECTION = 'compositionThreadComments';
const COMPOSITION_OWNERSHIP_TRANSFERS_COLLECTION = 'compositionOwnershipTransfers';
const MAX_COMPOSITION_REVISIONS = 20;
const DEFAULT_QUERY_RETRIES = 3;
const OWNERSHIP_TRANSFER_TTL_DAYS = 7;

export type RevisionTrigger = 'manual-save' | 'export-midi' | 'export-pdf';

export interface StoredCompositionRevision {
  id: string;
  compositionId: string;
  ownerId: string;
  createdBy: string;
  createdAt: string;
  trigger: RevisionTrigger;
  label: string;
  composition: Composition;
}

export type CompositionCommentThreadStatus = 'open' | 'resolved';

export interface CompositionCommentThread {
  id: string;
  compositionId: string;
  staffIndex: number;
  measureIndex: number;
  status: CompositionCommentThreadStatus;
  createdBy: string;
  createdByName?: string;
  createdByEmail?: string;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  threadTitle?: string;
  lastCommentAt: string;
  lastCommentPreview?: string;
}

export interface CompositionComment {
  id: string;
  threadId: string;
  compositionId: string;
  staffIndex: number;
  measureIndex: number;
  content: string;
  authorId: string;
  authorName?: string;
  authorEmail?: string;
  createdAt: string;
}

export type OwnershipTransferStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';

export interface CompositionOwnershipTransfer {
  id: string;
  compositionId: string;
  fromUid: string;
  fromEmail?: string;
  fromName?: string;
  toEmail: string;
  status: OwnershipTransferStatus;
  createdAt: string;
  expiresAt: string;
  respondedAt?: string;
  respondedByUid?: string;
}

const toFirestoreTimestamp = (value: unknown): Timestamp => {
  if (!value) return Timestamp.now();

  // Already a Firestore Timestamp instance.
  if (value instanceof Timestamp) return value;

  // Date instance.
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? Timestamp.now() : Timestamp.fromDate(value);
  }

  // ISO/date-like string.
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? Timestamp.now() : Timestamp.fromDate(parsed);
  }

  // Epoch milliseconds.
  if (typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? Timestamp.now() : Timestamp.fromDate(parsed);
  }

  // Firestore-like plain object { seconds, nanoseconds } (e.g. after JSON serialization).
  if (typeof value === 'object' && value !== null) {
    const maybe = value as { seconds?: unknown; nanoseconds?: unknown; toDate?: () => Date };
    if (typeof maybe.toDate === 'function') {
      const date = maybe.toDate();
      return Number.isNaN(date.getTime()) ? Timestamp.now() : Timestamp.fromDate(date);
    }
    if (typeof maybe.seconds === 'number') {
      const nanos = typeof maybe.nanoseconds === 'number' ? maybe.nanoseconds : 0;
      return new Timestamp(maybe.seconds, nanos);
    }
  }

  return Timestamp.now();
};

/**
 * Recursively remove all undefined values from an object/array.
 * Firestore does not allow undefined values, so we need to clean them out.
 * Preserves null values (Firestore allows null) but removes undefined.
 */
const removeUndefinedValues = (obj: any): any => {
  // Return null as-is (Firestore allows null)
  if (obj === null) {
    return null;
  }

  // Skip undefined values entirely
  if (obj === undefined) {
    return undefined; // Will be filtered out by caller
  }

  // Handle arrays - recursively clean and filter out undefined
  if (Array.isArray(obj)) {
    return obj
      .map(removeUndefinedValues)
      .filter(item => item !== undefined);
  }

  // Handle plain objects - recursively clean and exclude undefined values
  if (typeof obj === 'object' && obj.constructor === Object) {
    const cleaned: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const value = removeUndefinedValues(obj[key]);
        // Only include the key if the value is not undefined
        if (value !== undefined) {
          cleaned[key] = value;
        }
      }
    }
    return cleaned;
  }

  // Return primitives and other objects (Date, Timestamp, etc.) as-is
  return obj;
};

const normalizeRevisionTrigger = (value: unknown): RevisionTrigger => {
  if (value === 'export-midi' || value === 'export-pdf' || value === 'manual-save') {
    return value;
  }
  return 'manual-save';
};

const toIsoString = (value: unknown): string => {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? new Date().toISOString() : value.toISOString();
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }
  if (typeof value === 'object' && value !== null && typeof (value as any).toDate === 'function') {
    const date = (value as any).toDate();
    return Number.isNaN(date?.getTime?.()) ? new Date().toISOString() : date.toISOString();
  }
  return new Date().toISOString();
};

const sortByNewest = (a: StoredCompositionRevision, b: StoredCompositionRevision) =>
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isTransientFirestoreError = (error: unknown): boolean => {
  if (!(error instanceof FirebaseError)) return false;
  return (
    error.code === 'unavailable' ||
    error.code === 'deadline-exceeded' ||
    error.code === 'aborted'
  );
};

const isMissingIndexError = (error: unknown): boolean =>
  error instanceof FirebaseError &&
  (error.code === 'failed-precondition' || error.code === 'invalid-argument') &&
  /requires an index|create it here/i.test(error.message);

const isPermissionError = (error: unknown): boolean =>
  error instanceof FirebaseError && error.code === 'permission-denied';

async function getDocsWithRetry(
  queryRef: any,
  request: () => Promise<Awaited<ReturnType<typeof getDocs>>>,
  label: string,
  retries: number = DEFAULT_QUERY_RETRIES
): Promise<Awaited<ReturnType<typeof getDocs>>> {
  let attempt = 0;
  let lastError: unknown;
  let sawTransientError = false;

  while (attempt < retries) {
    try {
      return await request();
    } catch (error) {
      lastError = error;
      if (isTransientFirestoreError(error)) sawTransientError = true;
      const shouldRetry = isTransientFirestoreError(error) && attempt < retries - 1;
      if (!shouldRetry) break;
      const backoffMs = 250 * Math.pow(2, attempt);
      console.warn(`[firestore] "${label}" transient error, retrying in ${backoffMs}ms`, error);
      await sleep(backoffMs);
      attempt += 1;
    }
  }

  // Last-resort fallback: if network transport is flaky, serve cached results.
  if (sawTransientError) {
    try {
      const cached = await getDocsFromCache(queryRef);
      console.warn(`[firestore] "${label}" served from local cache after transient failures.`);
      return cached as Awaited<ReturnType<typeof getDocs>>;
    } catch {
      // No local cache available; surface original error below.
    }
  }

  throw lastError;
}

const mapRevisionDoc = (docSnap: any): StoredCompositionRevision => {
  const data = docSnap.data() as any;
  return {
    id: docSnap.id,
    compositionId: String(data.compositionId ?? ''),
    ownerId: String(data.ownerId ?? ''),
    createdBy: String(data.createdBy ?? data.ownerId ?? ''),
    createdAt: toIsoString(data.createdAt),
    trigger: normalizeRevisionTrigger(data.trigger),
    label: String(data.label ?? 'Snapshot'),
    composition: data.composition as Composition,
  };
};

const normalizeThreadStatus = (value: unknown): CompositionCommentThreadStatus =>
  value === 'resolved' ? 'resolved' : 'open';

const toSafeNumber = (value: unknown, fallback: number = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const mapCommentThreadDoc = (docSnap: any): CompositionCommentThread => {
  const data = docSnap.data() as any;
  return {
    id: docSnap.id,
    compositionId: String(data.compositionId ?? ''),
    staffIndex: toSafeNumber(data.staffIndex, 0),
    measureIndex: toSafeNumber(data.measureIndex, 0),
    status: normalizeThreadStatus(data.status),
    createdBy: String(data.createdBy ?? ''),
    createdByName: data.createdByName ? String(data.createdByName) : undefined,
    createdByEmail: data.createdByEmail ? String(data.createdByEmail) : undefined,
    createdAt: toIsoString(data.createdAt),
    resolvedAt: data.resolvedAt ? toIsoString(data.resolvedAt) : undefined,
    resolvedBy: data.resolvedBy ? String(data.resolvedBy) : undefined,
    threadTitle: data.threadTitle ? String(data.threadTitle) : undefined,
    lastCommentAt: toIsoString(data.lastCommentAt ?? data.createdAt),
    lastCommentPreview: data.lastCommentPreview ? String(data.lastCommentPreview) : undefined,
  };
};

const mapThreadCommentDoc = (docSnap: any): CompositionComment => {
  const data = docSnap.data() as any;
  return {
    id: docSnap.id,
    threadId: String(data.threadId ?? ''),
    compositionId: String(data.compositionId ?? ''),
    staffIndex: toSafeNumber(data.staffIndex, 0),
    measureIndex: toSafeNumber(data.measureIndex, 0),
    content: String(data.content ?? ''),
    authorId: String(data.authorId ?? ''),
    authorName: data.authorName ? String(data.authorName) : undefined,
    authorEmail: data.authorEmail ? String(data.authorEmail) : undefined,
    createdAt: toIsoString(data.createdAt),
  };
};

const normalizeOwnershipTransferStatus = (value: unknown): OwnershipTransferStatus => {
  if (
    value === 'accepted' ||
    value === 'declined' ||
    value === 'cancelled' ||
    value === 'expired' ||
    value === 'pending'
  ) {
    return value;
  }
  return 'pending';
};

const mapOwnershipTransferDoc = (docSnap: any): CompositionOwnershipTransfer => {
  const data = docSnap.data() as any;
  return {
    id: docSnap.id,
    compositionId: String(data.compositionId ?? ''),
    fromUid: String(data.fromUid ?? ''),
    fromEmail: data.fromEmail ? String(data.fromEmail) : undefined,
    fromName: data.fromName ? String(data.fromName) : undefined,
    toEmail: String(data.toEmail ?? ''),
    status: normalizeOwnershipTransferStatus(data.status),
    createdAt: toIsoString(data.createdAt),
    expiresAt: toIsoString(data.expiresAt),
    respondedAt: data.respondedAt ? toIsoString(data.respondedAt) : undefined,
    respondedByUid: data.respondedByUid ? String(data.respondedByUid) : undefined,
  };
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const chunkArray = <T,>(items: T[], chunkSize: number): T[][] => {
  if (chunkSize <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
};

const deleteDocRefsInBatches = async (refs: Array<ReturnType<typeof doc>>): Promise<void> => {
  if (refs.length === 0) return;
  // Keep safely below Firestore's 500-op batch limit.
  const BATCH_LIMIT = 450;
  const chunks = chunkArray(refs, BATCH_LIMIT);
  for (const chunk of chunks) {
    const batch = writeBatch(db);
    chunk.forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
};

export const saveComposition = async (
  composition: Composition,
  userId: string,
  modifiedByUid?: string,
  ownerMeta?: { ownerEmail?: string | null; ownerName?: string | null }
): Promise<string> => {
  try {
    const compositionData: any = {
      ...composition,
      userId,
      ownerEmail: composition.ownerEmail ?? ownerMeta?.ownerEmail ?? null,
      ownerName: composition.ownerName ?? ownerMeta?.ownerName ?? null,
      // Track who last saved the document; falls back to the owner when not supplied.
      modifiedBy: modifiedByUid ?? userId,
      updatedAt: Timestamp.now(),
      // `createdAt` may arrive as Date, string, Timestamp, or plain serialized object.
      createdAt: toFirestoreTimestamp(composition.createdAt),
    };

    // Firestore does not allow fields with value `undefined`
    // Recursively strip out all undefined values (including nested objects and arrays)
    const cleanedData = removeUndefinedValues(compositionData);

    if (composition.id) {
      // Update existing composition
      const docRef = doc(db, COMPOSITIONS_COLLECTION, composition.id);
      await updateDoc(docRef, cleanedData);
      return composition.id;
    } else {
      // Create new composition
      const docRef = doc(collection(db, COMPOSITIONS_COLLECTION));
      await setDoc(docRef, {
        ...cleanedData,
        id: docRef.id,
      });
      return docRef.id;
    }
  } catch (error) {
    console.error('Error saving composition:', error);
    throw error;
  }
};

export const getCompositionRevisionTimeline = async (
  compositionId: string
): Promise<StoredCompositionRevision[]> => {
  if (!compositionId) return [];
  try {
    const colRef = collection(db, COMPOSITION_REVISIONS_COLLECTION);
    const q = query(colRef, where('compositionId', '==', compositionId));
    const snapshots = await getDocsWithRetry(
      q,
      () => getDocs(q),
      'composition-revisions'
    );
    const revisions = snapshots.docs.map(mapRevisionDoc).sort(sortByNewest);
    return revisions.slice(0, MAX_COMPOSITION_REVISIONS);
  } catch (error) {
    console.error('Error loading composition revisions:', error);
    return [];
  }
};

export const saveCompositionRevisionSnapshot = async (params: {
  compositionId: string;
  ownerId: string;
  createdBy: string;
  trigger: RevisionTrigger;
  label: string;
  composition: Composition;
}): Promise<StoredCompositionRevision[]> => {
  try {
    if (!params.compositionId) return [];

    const docPayload = removeUndefinedValues({
      compositionId: params.compositionId,
      ownerId: params.ownerId,
      createdBy: params.createdBy,
      trigger: params.trigger,
      label: params.label,
      createdAt: Timestamp.now(),
      composition: params.composition,
    });

    await addDoc(collection(db, COMPOSITION_REVISIONS_COLLECTION), docPayload);

    const colRef = collection(db, COMPOSITION_REVISIONS_COLLECTION);
    const q = query(colRef, where('compositionId', '==', params.compositionId));
    const allSnapshots = await getDocsWithRetry(
      q,
      () => getDocs(q),
      'composition-revisions-refresh'
    );
    const allRevisions = allSnapshots.docs.map(mapRevisionDoc).sort(sortByNewest);

    const keep = allRevisions.slice(0, MAX_COMPOSITION_REVISIONS);
    const purge = allRevisions.slice(MAX_COMPOSITION_REVISIONS);
    if (purge.length > 0) {
      await Promise.all(purge.map((revision) =>
        deleteDoc(doc(db, COMPOSITION_REVISIONS_COLLECTION, revision.id))
      ));
    }

    return keep;
  } catch (error) {
    console.error('Error saving composition revision snapshot:', error);
    throw error;
  }
};

export const getComposition = async (
  compositionId: string
): Promise<Composition | null> => {
  try {
    const docRef = doc(db, COMPOSITIONS_COLLECTION, compositionId);
    const docSnap = await (async () => {
      let attempt = 0;
      let lastError: unknown;
      while (attempt < DEFAULT_QUERY_RETRIES) {
        try {
          return await getDoc(docRef);
        } catch (error) {
          lastError = error;
          const shouldRetry = isTransientFirestoreError(error) && attempt < DEFAULT_QUERY_RETRIES - 1;
          if (!shouldRetry) break;
          const backoffMs = 250 * Math.pow(2, attempt);
          console.warn(`[firestore] "get-composition" transient error, retrying in ${backoffMs}ms`, error);
          await sleep(backoffMs);
          attempt += 1;
        }
      }
      throw lastError;
    })();

    if (docSnap.exists()) {
      const data = docSnap.data();
      return {
        ...data,
        id: docSnap.id,
        createdAt: data.createdAt?.toDate(),
        updatedAt: data.updatedAt?.toDate(),
        pendingOwnershipTransferExpiresAt: data.pendingOwnershipTransferExpiresAt?.toDate?.() ?? data.pendingOwnershipTransferExpiresAt,
      } as Composition;
    }
    return null;
  } catch (error) {
    console.error('Error getting composition:', error);
    throw error;
  }
};

/**
 * Return all compositions the user can see:
 * - their own
 * - any public compositions
 * - any shared compositions where their email is in sharedEmails
 */
export const getUserCompositions = async (
  userId: string,
  userEmail?: string | null
): Promise<Composition[]> => {
  const colRef = collection(db, COMPOSITIONS_COLLECTION);

  const namedQueries: { label: string; promise: ReturnType<typeof getDocs> }[] = [
    {
      label: 'own',
      promise: (() => {
        const q = query(colRef, where('userId', '==', userId));
        return getDocsWithRetry(q, () => getDocs(q), 'dashboard-own');
      })(),
    },
    {
      label: 'public',
      promise: (() => {
        const q = query(colRef, where('privacy', '==', 'public'));
        return getDocsWithRetry(q, () => getDocs(q), 'dashboard-public');
      })(),
    },
  ];

  if (userEmail) {
    namedQueries.push({
      label: 'shared-with-email',
      promise: (() => {
        const q = query(colRef, where('sharedEmails', 'array-contains', userEmail));
        return getDocsWithRetry(q, () => getDocs(q), 'dashboard-shared-with-email');
      })(),
    });
  }

  // Use allSettled so one failing query doesn't kill the others
  const results = await Promise.allSettled(namedQueries.map((q) => q.promise));

  const byId = new Map<string, Composition>();
  let successfulQueries = 0;

  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.warn(`[compositions] "${namedQueries[i].label}" query failed:`, result.reason);
      return;
    }
    successfulQueries += 1;
    result.value.forEach((docSnap) => {
      const data = docSnap.data() as any;
      const comp: Composition = {
        ...data,
        id: docSnap.id,
        createdAt: data.createdAt?.toDate?.() ?? data.createdAt,
        updatedAt: data.updatedAt?.toDate?.() ?? data.updatedAt,
        pendingOwnershipTransferExpiresAt:
          data.pendingOwnershipTransferExpiresAt?.toDate?.() ?? data.pendingOwnershipTransferExpiresAt,
      } as Composition;
      byId.set(comp.id!, comp);
    });
  });

  if (successfulQueries === 0) {
    throw new Error('All composition queries failed.');
  }

  return Array.from(byId.values());
};

export const deleteComposition = async (
  compositionId: string
): Promise<void> => {
  try {
    if (!compositionId) return;

    // 1) Load all child docs first.
    const revisionQuery = query(
      collection(db, COMPOSITION_REVISIONS_COLLECTION),
      where('compositionId', '==', compositionId)
    );
    const threadQuery = query(
      collection(db, COMPOSITION_COMMENT_THREADS_COLLECTION),
      where('compositionId', '==', compositionId)
    );
    const compositionCommentQuery = query(
      collection(db, COMPOSITION_THREAD_COMMENTS_COLLECTION),
      where('compositionId', '==', compositionId)
    );
    const ownershipTransferQuery = query(
      collection(db, COMPOSITION_OWNERSHIP_TRANSFERS_COLLECTION),
      where('compositionId', '==', compositionId)
    );

    const [revisionSnap, threadSnap, compositionCommentSnap, ownershipTransferSnap] = await Promise.all([
      getDocsWithRetry(revisionQuery, () => getDocs(revisionQuery), 'delete-composition-revisions'),
      getDocsWithRetry(threadQuery, () => getDocs(threadQuery), 'delete-composition-threads'),
      getDocsWithRetry(
        compositionCommentQuery,
        () => getDocs(compositionCommentQuery),
        'delete-composition-comments'
      ),
      getDocsWithRetry(
        ownershipTransferQuery,
        () => getDocs(ownershipTransferQuery),
        'delete-composition-ownership-transfers'
      ),
    ]);

    const revisionRefs = revisionSnap.docs.map((snap) =>
      doc(db, COMPOSITION_REVISIONS_COLLECTION, snap.id)
    );
    const threadRefs = threadSnap.docs.map((snap) =>
      doc(db, COMPOSITION_COMMENT_THREADS_COLLECTION, snap.id)
    );
    const ownershipTransferRefs = ownershipTransferSnap.docs.map((snap) =>
      doc(db, COMPOSITION_OWNERSHIP_TRANSFERS_COLLECTION, snap.id)
    );

    // Include comments found by compositionId and by each threadId
    // to clean up legacy docs that may miss compositionId.
    const commentRefById = new Map<string, ReturnType<typeof doc>>();
    compositionCommentSnap.docs.forEach((snap) => {
      commentRefById.set(
        snap.id,
        doc(db, COMPOSITION_THREAD_COMMENTS_COLLECTION, snap.id)
      );
    });

    await Promise.all(
      threadSnap.docs.map(async (threadDocSnap) => {
        const q = query(
          collection(db, COMPOSITION_THREAD_COMMENTS_COLLECTION),
          where('threadId', '==', threadDocSnap.id)
        );
        const commentsForThread = await getDocsWithRetry(
          q,
          () => getDocs(q),
          'delete-composition-comments-by-thread'
        );
        commentsForThread.docs.forEach((snap) => {
          commentRefById.set(
            snap.id,
            doc(db, COMPOSITION_THREAD_COMMENTS_COLLECTION, snap.id)
          );
        });
      })
    );
    const commentRefs = Array.from(commentRefById.values());

    // 2) Delete children first (comments -> threads/revisions), then parent doc.
    await deleteDocRefsInBatches(commentRefs);
    await deleteDocRefsInBatches(revisionRefs);
    await deleteDocRefsInBatches(threadRefs);
    await deleteDocRefsInBatches(ownershipTransferRefs);

    // 3) Delete composition itself last.
    await deleteDoc(doc(db, COMPOSITIONS_COLLECTION, compositionId));
  } catch (error) {
    console.error('Error deleting composition:', error);
    throw error;
  }
};

export const getCompositionCommentThreads = async (
  compositionId: string
): Promise<CompositionCommentThread[]> => {
  if (!compositionId) return [];
  try {
    const colRef = collection(db, COMPOSITION_COMMENT_THREADS_COLLECTION);
    const q = query(
      colRef,
      where('compositionId', '==', compositionId),
      orderBy('lastCommentAt', 'desc')
    );
    const snapshots = await getDocsWithRetry(
      q,
      () => getDocs(q),
      'composition-comment-threads'
    );
    return snapshots.docs.map(mapCommentThreadDoc);
  } catch (error) {
    if (isMissingIndexError(error)) {
      // Fallback path when the composite index isn't created yet.
      // We query by compositionId only, then sort client-side.
      try {
        const colRef = collection(db, COMPOSITION_COMMENT_THREADS_COLLECTION);
        const q = query(colRef, where('compositionId', '==', compositionId));
        const snapshots = await getDocsWithRetry(
          q,
          () => getDocs(q),
          'composition-comment-threads-fallback'
        );
        return snapshots.docs
          .map(mapCommentThreadDoc)
          .sort((a, b) => new Date(b.lastCommentAt).getTime() - new Date(a.lastCommentAt).getTime());
      } catch (fallbackError) {
        console.error('Error loading composition comment threads (fallback):', fallbackError);
        return [];
      }
    }

    if (isPermissionError(error)) {
      console.error(
        'Error loading composition comment threads: permission denied. Publish latest firestore.rules for compositionCommentThreads/compositionThreadComments.',
        error
      );
      return [];
    }

    console.error('Error loading composition comment threads:', error);
    return [];
  }
};

export const getThreadComments = async (
  threadId: string
): Promise<CompositionComment[]> => {
  if (!threadId) return [];
  try {
    const colRef = collection(db, COMPOSITION_THREAD_COMMENTS_COLLECTION);
    const q = query(
      colRef,
      where('threadId', '==', threadId),
      orderBy('createdAt', 'asc')
    );
    const snapshots = await getDocsWithRetry(
      q,
      () => getDocs(q),
      'composition-thread-comments'
    );
    return snapshots.docs.map(mapThreadCommentDoc);
  } catch (error) {
    if (isMissingIndexError(error)) {
      // Fallback path when the threadId+createdAt index isn't ready yet.
      try {
        const colRef = collection(db, COMPOSITION_THREAD_COMMENTS_COLLECTION);
        const q = query(colRef, where('threadId', '==', threadId));
        const snapshots = await getDocsWithRetry(
          q,
          () => getDocs(q),
          'composition-thread-comments-fallback'
        );
        return snapshots.docs
          .map(mapThreadCommentDoc)
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      } catch (fallbackError) {
        console.error('Error loading thread comments (fallback):', fallbackError);
        return [];
      }
    }

    if (isPermissionError(error)) {
      console.error(
        'Error loading thread comments: permission denied. Publish latest firestore.rules for compositionCommentThreads/compositionThreadComments.',
        error
      );
      return [];
    }

    console.error('Error loading thread comments:', error);
    return [];
  }
};

export const createCommentThread = async (params: {
  compositionId: string;
  staffIndex: number;
  measureIndex: number;
  content: string;
  authorId: string;
  authorName?: string;
  authorEmail?: string;
}): Promise<{ thread: CompositionCommentThread; comment: CompositionComment }> => {
  const now = Timestamp.now();
  const trimmed = params.content.trim();
  const title = trimmed.slice(0, 100);
  const preview = trimmed.slice(0, 180);
  const threadPayload = removeUndefinedValues({
    compositionId: params.compositionId,
    staffIndex: params.staffIndex,
    measureIndex: params.measureIndex,
    status: 'open',
    createdBy: params.authorId,
    createdByName: params.authorName,
    createdByEmail: params.authorEmail,
    createdAt: now,
    threadTitle: title,
    lastCommentAt: now,
    lastCommentPreview: preview,
  });

  const threadRef = await addDoc(collection(db, COMPOSITION_COMMENT_THREADS_COLLECTION), threadPayload);
  const commentPayload = removeUndefinedValues({
    threadId: threadRef.id,
    compositionId: params.compositionId,
    staffIndex: params.staffIndex,
    measureIndex: params.measureIndex,
    content: trimmed,
    authorId: params.authorId,
    authorName: params.authorName,
    authorEmail: params.authorEmail,
    createdAt: now,
  });
  const commentRef = await addDoc(collection(db, COMPOSITION_THREAD_COMMENTS_COLLECTION), commentPayload);

  return {
    thread: {
      id: threadRef.id,
      compositionId: params.compositionId,
      staffIndex: params.staffIndex,
      measureIndex: params.measureIndex,
      status: 'open',
      createdBy: params.authorId,
      createdByName: params.authorName,
      createdByEmail: params.authorEmail,
      createdAt: now.toDate().toISOString(),
      threadTitle: title,
      lastCommentAt: now.toDate().toISOString(),
      lastCommentPreview: preview,
    },
    comment: {
      id: commentRef.id,
      threadId: threadRef.id,
      compositionId: params.compositionId,
      staffIndex: params.staffIndex,
      measureIndex: params.measureIndex,
    content: trimmed,
      authorId: params.authorId,
      authorName: params.authorName,
      authorEmail: params.authorEmail,
      createdAt: now.toDate().toISOString(),
    },
  };
};

export const addCommentToThread = async (params: {
  threadId: string;
  compositionId: string;
  staffIndex: number;
  measureIndex: number;
  content: string;
  authorId: string;
  authorName?: string;
  authorEmail?: string;
}): Promise<CompositionComment> => {
  const now = Timestamp.now();
  const trimmed = params.content.trim();
  const commentPayload = removeUndefinedValues({
    threadId: params.threadId,
    compositionId: params.compositionId,
    staffIndex: params.staffIndex,
    measureIndex: params.measureIndex,
    content: trimmed,
    authorId: params.authorId,
    authorName: params.authorName,
    authorEmail: params.authorEmail,
    createdAt: now,
  });
  const commentRef = await addDoc(collection(db, COMPOSITION_THREAD_COMMENTS_COLLECTION), commentPayload);

  const threadRef = doc(db, COMPOSITION_COMMENT_THREADS_COLLECTION, params.threadId);
  await updateDoc(threadRef, removeUndefinedValues({
    lastCommentAt: now,
    lastCommentPreview: trimmed.slice(0, 180),
  }));

  return {
    id: commentRef.id,
    threadId: params.threadId,
    compositionId: params.compositionId,
    staffIndex: params.staffIndex,
    measureIndex: params.measureIndex,
    content: trimmed,
    authorId: params.authorId,
    authorName: params.authorName,
    authorEmail: params.authorEmail,
    createdAt: now.toDate().toISOString(),
  };
};

export const setCommentThreadResolved = async (
  threadId: string,
  resolved: boolean,
  actorId: string
): Promise<void> => {
  const threadRef = doc(db, COMPOSITION_COMMENT_THREADS_COLLECTION, threadId);
  await updateDoc(threadRef, removeUndefinedValues({
    status: resolved ? 'resolved' : 'open',
    resolvedAt: resolved ? Timestamp.now() : null,
    resolvedBy: resolved ? actorId : null,
  }));
};

export const getPendingOwnershipTransferForComposition = async (
  compositionId: string,
  currentEmail?: string | null
): Promise<CompositionOwnershipTransfer | null> => {
  if (!compositionId) return null;
  try {
    const q = query(
      collection(db, COMPOSITION_OWNERSHIP_TRANSFERS_COLLECTION),
      where('compositionId', '==', compositionId)
    );
    const snapshots = await getDocsWithRetry(
      q,
      () => getDocs(q),
      'ownership-transfer-by-composition'
    );
    const transfers = snapshots.docs
      .map(mapOwnershipTransferDoc)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const pending = transfers.find((transfer) => transfer.status === 'pending') ?? null;
    if (!pending) return null;

    // Auto-expire stale transfers to reduce neglected requests.
    if (new Date(pending.expiresAt).getTime() <= Date.now()) {
      await updateDoc(doc(db, COMPOSITION_OWNERSHIP_TRANSFERS_COLLECTION, pending.id), {
        status: 'expired',
        respondedAt: Timestamp.now(),
      });
      const compositionRef = doc(db, COMPOSITIONS_COLLECTION, compositionId);
      await updateDoc(compositionRef, removeUndefinedValues({
        pendingOwnershipTransferId: null,
        pendingOwnershipTransferExpiresAt: null,
      }));
      return null;
    }

    // Optional safety: if caller passed email, ensure we only return pending transfer
    // relevant to either owner view or destination view.
    if (currentEmail) {
      const normalized = normalizeEmail(currentEmail);
      if (normalizeEmail(pending.toEmail) === normalized) return pending;
      return pending;
    }
    return pending;
  } catch (error) {
    console.error('Error loading ownership transfer:', error);
    return null;
  }
};

export const requestOwnershipTransfer = async (params: {
  compositionId: string;
  fromUid: string;
  fromEmail?: string | null;
  fromName?: string | null;
  toEmail: string;
}): Promise<CompositionOwnershipTransfer> => {
  const toEmail = normalizeEmail(params.toEmail);
  if (!toEmail || !toEmail.includes('@')) {
    throw new Error('Please enter a valid destination email address.');
  }

  const createdAt = Timestamp.now();
  const expiresAt = Timestamp.fromDate(
    new Date(Date.now() + OWNERSHIP_TRANSFER_TTL_DAYS * 24 * 60 * 60 * 1000)
  );

  const transferRef = await addDoc(collection(db, COMPOSITION_OWNERSHIP_TRANSFERS_COLLECTION), removeUndefinedValues({
    compositionId: params.compositionId,
    fromUid: params.fromUid,
    fromEmail: params.fromEmail ? normalizeEmail(params.fromEmail) : undefined,
    fromName: params.fromName ?? undefined,
    toEmail,
    status: 'pending',
    createdAt,
    expiresAt,
  }));

  await updateDoc(doc(db, COMPOSITIONS_COLLECTION, params.compositionId), removeUndefinedValues({
    pendingOwnershipTransferId: transferRef.id,
    pendingOwnershipTransferExpiresAt: expiresAt,
  }));

  return {
    id: transferRef.id,
    compositionId: params.compositionId,
    fromUid: params.fromUid,
    fromEmail: params.fromEmail ? normalizeEmail(params.fromEmail) : undefined,
    fromName: params.fromName ?? undefined,
    toEmail,
    status: 'pending',
    createdAt: createdAt.toDate().toISOString(),
    expiresAt: expiresAt.toDate().toISOString(),
  };
};

export const cancelOwnershipTransfer = async (transferId: string, compositionId: string): Promise<void> => {
  await updateDoc(doc(db, COMPOSITION_OWNERSHIP_TRANSFERS_COLLECTION, transferId), {
    status: 'cancelled',
    respondedAt: Timestamp.now(),
  });
  await updateDoc(doc(db, COMPOSITIONS_COLLECTION, compositionId), removeUndefinedValues({
    pendingOwnershipTransferId: null,
    pendingOwnershipTransferExpiresAt: null,
  }));
};

export const declineOwnershipTransfer = async (params: {
  transferId: string;
  compositionId: string;
  recipientUid: string;
}): Promise<void> => {
  await updateDoc(doc(db, COMPOSITION_OWNERSHIP_TRANSFERS_COLLECTION, params.transferId), {
    status: 'declined',
    respondedAt: Timestamp.now(),
    respondedByUid: params.recipientUid,
  });
  await updateDoc(doc(db, COMPOSITIONS_COLLECTION, params.compositionId), removeUndefinedValues({
    pendingOwnershipTransferId: null,
    pendingOwnershipTransferExpiresAt: null,
  }));
};

export const acceptOwnershipTransfer = async (params: {
  transferId: string;
  compositionId: string;
  recipientUid: string;
  recipientEmail: string;
  recipientName?: string | null;
}): Promise<void> => {
  const normalizedRecipientEmail = normalizeEmail(params.recipientEmail);
  const transferRef = doc(db, COMPOSITION_OWNERSHIP_TRANSFERS_COLLECTION, params.transferId);
  const compositionRef = doc(db, COMPOSITIONS_COLLECTION, params.compositionId);

  await runTransaction(db, async (transaction) => {
    const transferSnap = await transaction.get(transferRef);
    const compositionSnap = await transaction.get(compositionRef);
    if (!transferSnap.exists() || !compositionSnap.exists()) {
      throw new Error('Ownership transfer request is no longer available.');
    }

    const transfer = mapOwnershipTransferDoc(transferSnap);
    const composition = compositionSnap.data() as any;

    if (transfer.status !== 'pending') {
      throw new Error('This ownership transfer request is no longer pending.');
    }
    if (transfer.compositionId !== params.compositionId) {
      throw new Error('Transfer request does not match this composition.');
    }
    if (normalizeEmail(transfer.toEmail) !== normalizedRecipientEmail) {
      throw new Error('This transfer request is addressed to a different email.');
    }
    if (new Date(transfer.expiresAt).getTime() <= Date.now()) {
      transaction.update(transferRef, { status: 'expired', respondedAt: Timestamp.now() });
      transaction.update(compositionRef, removeUndefinedValues({
        pendingOwnershipTransferId: null,
        pendingOwnershipTransferExpiresAt: null,
      }));
      throw new Error('This ownership transfer request has expired.');
    }
    if (composition.pendingOwnershipTransferId !== params.transferId) {
      throw new Error('Another ownership transfer is currently active.');
    }

    transaction.update(transferRef, removeUndefinedValues({
      status: 'accepted',
      respondedAt: Timestamp.now(),
      respondedByUid: params.recipientUid,
    }));

    transaction.update(compositionRef, removeUndefinedValues({
      userId: params.recipientUid,
      ownerEmail: normalizedRecipientEmail,
      ownerName: params.recipientName ?? null,
      pendingOwnershipTransferId: null,
      pendingOwnershipTransferExpiresAt: null,
      updatedAt: Timestamp.now(),
      modifiedBy: params.recipientUid,
    }));
  });
};

export const ensureCompositionOwnerMetadata = async (params: {
  compositionId: string;
  ownerUid: string;
  ownerEmail?: string | null;
  ownerName?: string | null;
}): Promise<void> => {
  if (!params.compositionId || !params.ownerUid) return;
  try {
    const compositionRef = doc(db, COMPOSITIONS_COLLECTION, params.compositionId);
    const snap = await getDoc(compositionRef);
    if (!snap.exists()) return;
    const data = snap.data() as any;

    if (String(data.userId ?? '') !== params.ownerUid) return;

    const nextOwnerEmail = params.ownerEmail ? normalizeEmail(params.ownerEmail) : null;
    const nextOwnerName = params.ownerName?.trim() || null;
    const hasOwnerEmail = typeof data.ownerEmail === 'string' && data.ownerEmail.trim().length > 0;
    const hasOwnerName = typeof data.ownerName === 'string' && data.ownerName.trim().length > 0;

    if (hasOwnerEmail && hasOwnerName) return;

    await updateDoc(compositionRef, removeUndefinedValues({
      ownerEmail: hasOwnerEmail ? data.ownerEmail : nextOwnerEmail,
      ownerName: hasOwnerName ? data.ownerName : nextOwnerName,
      updatedAt: Timestamp.now(),
      modifiedBy: params.ownerUid,
    }));
  } catch (error) {
    console.error('Error ensuring composition owner metadata:', error);
  }
};
