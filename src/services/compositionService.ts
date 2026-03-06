import {
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
    // Strip out any undefined top-level properties before saving.
    Object.keys(compositionData).forEach((key) => {
      if (compositionData[key] === undefined) {
        delete compositionData[key];
      }
    });

    if (composition.id) {
      // Update existing composition
      const docRef = doc(db, COMPOSITIONS_COLLECTION, composition.id);
      await updateDoc(docRef, compositionData);
      return composition.id;
    } else {
      // Create new composition
      const docRef = doc(collection(db, COMPOSITIONS_COLLECTION));
      await setDoc(docRef, {
        ...compositionData,
        id: docRef.id,
      });
      return docRef.id;
    }
  } catch (error) {
    console.error('Error saving composition:', error);
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
