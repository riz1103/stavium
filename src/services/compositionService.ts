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

export const saveComposition = async (
  composition: Composition,
  userId: string
): Promise<string> => {
  try {
    const compositionData: any = {
      ...composition,
      userId,
      updatedAt: Timestamp.now(),
      createdAt: composition.createdAt
        ? Timestamp.fromDate(composition.createdAt)
        : Timestamp.now(),
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
      const data = docSnap.data();
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
