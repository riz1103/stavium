import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { Composition } from '../types/music';

const COMPOSITIONS_COLLECTION = 'compositions';
const COMPOSITION_REVISIONS_COLLECTION = 'compositionRevisions';
const MAX_COMPOSITION_REVISIONS = 20;

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

export const saveComposition = async (
  composition: Composition,
  userId: string,
  modifiedByUid?: string
): Promise<string> => {
  try {
    const compositionData: any = {
      ...composition,
      userId,
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
    const snapshots = await getDocs(query(colRef, where('compositionId', '==', compositionId)));
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
    const allSnapshots = await getDocs(query(colRef, where('compositionId', '==', params.compositionId)));
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
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      return {
        ...data,
        id: docSnap.id,
        createdAt: data.createdAt?.toDate(),
        updatedAt: data.updatedAt?.toDate(),
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
      promise: getDocs(query(colRef, where('userId', '==', userId))),
    },
    {
      label: 'public',
      promise: getDocs(query(colRef, where('privacy', '==', 'public'))),
    },
  ];

  if (userEmail) {
    namedQueries.push({
      label: 'shared-with-email',
      promise: getDocs(query(colRef, where('sharedEmails', 'array-contains', userEmail))),
    });
  }

  // Use allSettled so one failing query doesn't kill the others
  const results = await Promise.allSettled(namedQueries.map((q) => q.promise));

  const byId = new Map<string, Composition>();

  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.warn(`[compositions] "${namedQueries[i].label}" query failed:`, result.reason);
      return;
    }
    result.value.forEach((docSnap) => {
      const data = docSnap.data() as any;
      const comp: Composition = {
        ...data,
        id: docSnap.id,
        createdAt: data.createdAt?.toDate?.() ?? data.createdAt,
        updatedAt: data.updatedAt?.toDate?.() ?? data.updatedAt,
      } as Composition;
      byId.set(comp.id!, comp);
    });
  });

  return Array.from(byId.values());
};

export const deleteComposition = async (
  compositionId: string
): Promise<void> => {
  try {
    const docRef = doc(db, COMPOSITIONS_COLLECTION, compositionId);
    await deleteDoc(docRef);
  } catch (error) {
    console.error('Error deleting composition:', error);
    throw error;
  }
};
