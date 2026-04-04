import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
  where,
} from 'firebase/firestore';
import { Measure } from '../types/music';
import { db } from './firebase';

const PRESENCE_COLLECTION = 'compositionPresence';
const PATCH_COLLECTION = 'compositionMeasurePatches';
const PRESENCE_TTL_MS = 90_000;

export interface CollaborationPresenceSelection {
  staffIndex: number | null;
  measureIndex: number | null;
  voiceIndex?: number | null;
  noteIndex?: number | null;
}

export interface CollaborationPresenceCursor {
  staffIndex: number | null;
  measureIndex: number | null;
  svgX?: number;
  svgY?: number;
}

export interface CollaborationPresence {
  id: string;
  compositionId: string;
  uid: string;
  displayName?: string;
  email?: string;
  color: string;
  isEditing: boolean;
  updatedAt: string;
  expiresAt: string;
  selection?: CollaborationPresenceSelection;
  cursor?: CollaborationPresenceCursor;
}

export interface PublishPresenceParams {
  compositionId: string;
  uid: string;
  displayName?: string | null;
  email?: string | null;
  isEditing: boolean;
  selection?: CollaborationPresenceSelection;
  cursor?: CollaborationPresenceCursor;
}

export interface PublishMeasurePatchParams {
  compositionId: string;
  actorUid: string;
  actorName?: string | null;
  staffIndex: number;
  measureIndex: number;
  measure: Measure;
  baseHash: string;
  nextHash: string;
  clientTimestamp: number;
}

export interface CompositionMeasurePatch {
  id: string;
  compositionId: string;
  actorUid: string;
  actorName?: string;
  staffIndex: number;
  measureIndex: number;
  measure: Measure;
  baseHash: string;
  nextHash: string;
  clientTimestamp: number;
  createdAt: string;
  createdAtMs: number;
}

const COLLABORATOR_COLORS = [
  '#22d3ee',
  '#f97316',
  '#84cc16',
  '#a855f7',
  '#06b6d4',
  '#ef4444',
  '#14b8a6',
  '#eab308',
];

const toIso = (value: unknown): string => {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }
  if (value && typeof value === 'object' && typeof (value as any).toDate === 'function') {
    return (value as any).toDate().toISOString();
  }
  return new Date().toISOString();
};

const toMs = (value: unknown): number => new Date(toIso(value)).getTime();

export const getCollaboratorColor = (seed: string): string => {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % COLLABORATOR_COLORS.length;
  return COLLABORATOR_COLORS[index];
};

const mapPresence = (snap: any): CollaborationPresence => {
  const data = snap.data() as any;
  const updatedAt = toIso(data.updatedAt);
  const expiresAt = toIso(data.expiresAt);
  return {
    id: snap.id,
    compositionId: String(data.compositionId ?? ''),
    uid: String(data.uid ?? ''),
    displayName: data.displayName ? String(data.displayName) : undefined,
    email: data.email ? String(data.email) : undefined,
    color: data.color ? String(data.color) : getCollaboratorColor(String(data.uid ?? snap.id)),
    isEditing: data.isEditing === true,
    updatedAt,
    expiresAt,
    selection: data.selection
      ? {
          staffIndex: typeof data.selection.staffIndex === 'number' ? data.selection.staffIndex : null,
          measureIndex: typeof data.selection.measureIndex === 'number' ? data.selection.measureIndex : null,
          voiceIndex: typeof data.selection.voiceIndex === 'number' ? data.selection.voiceIndex : null,
          noteIndex: typeof data.selection.noteIndex === 'number' ? data.selection.noteIndex : null,
        }
      : undefined,
    cursor: data.cursor
      ? {
          staffIndex: typeof data.cursor.staffIndex === 'number' ? data.cursor.staffIndex : null,
          measureIndex: typeof data.cursor.measureIndex === 'number' ? data.cursor.measureIndex : null,
          svgX: typeof data.cursor.svgX === 'number' ? data.cursor.svgX : undefined,
          svgY: typeof data.cursor.svgY === 'number' ? data.cursor.svgY : undefined,
        }
      : undefined,
  };
};

const mapMeasurePatch = (snap: any): CompositionMeasurePatch => {
  const data = snap.data() as any;
  const createdAtMs = toMs(data.createdAt);
  return {
    id: snap.id,
    compositionId: String(data.compositionId ?? ''),
    actorUid: String(data.actorUid ?? ''),
    actorName: data.actorName ? String(data.actorName) : undefined,
    staffIndex: Number(data.staffIndex ?? 0),
    measureIndex: Number(data.measureIndex ?? 0),
    measure: data.measure as Measure,
    baseHash: String(data.baseHash ?? ''),
    nextHash: String(data.nextHash ?? ''),
    clientTimestamp: Number(data.clientTimestamp ?? createdAtMs),
    createdAt: toIso(data.createdAt),
    createdAtMs,
  };
};

export const subscribeToCompositionPresence = (
  compositionId: string,
  callback: (presence: CollaborationPresence[]) => void,
  onError?: (error: Error) => void
): (() => void) => {
  const q = query(
    collection(db, PRESENCE_COLLECTION),
    where('compositionId', '==', compositionId)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const now = Date.now();
      const activePresence = snapshot.docs
        .map(mapPresence)
        .filter((entry) => new Date(entry.expiresAt).getTime() > now)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      callback(activePresence);
    },
    (error) => {
      console.error('[collaborationService] Presence snapshot error:', error);
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  );
};

export const publishCompositionPresence = async (params: PublishPresenceParams): Promise<void> => {
  const presenceId = `${params.compositionId}_${params.uid}`;
  const docRef = doc(db, PRESENCE_COLLECTION, presenceId);
  await setDoc(
    docRef,
    {
      compositionId: params.compositionId,
      uid: params.uid,
      displayName: params.displayName ?? null,
      email: params.email ?? null,
      color: getCollaboratorColor(params.uid),
      isEditing: params.isEditing,
      selection: params.selection ?? null,
      cursor: params.cursor ?? null,
      updatedAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + PRESENCE_TTL_MS),
    },
    { merge: true }
  );
};

export const clearCompositionPresence = async (compositionId: string, uid: string): Promise<void> => {
  const presenceId = `${compositionId}_${uid}`;
  await deleteDoc(doc(db, PRESENCE_COLLECTION, presenceId));
};

export const publishMeasurePatch = async (params: PublishMeasurePatchParams): Promise<void> => {
  await addDoc(collection(db, PATCH_COLLECTION), {
    compositionId: params.compositionId,
    actorUid: params.actorUid,
    actorName: params.actorName ?? null,
    staffIndex: params.staffIndex,
    measureIndex: params.measureIndex,
    measure: params.measure,
    baseHash: params.baseHash,
    nextHash: params.nextHash,
    clientTimestamp: params.clientTimestamp,
    createdAt: serverTimestamp(),
  });
};

export const subscribeToMeasurePatches = (
  compositionId: string,
  callback: (patches: CompositionMeasurePatch[]) => void,
  onError?: (error: Error) => void
): (() => void) => {
  const q = query(
    collection(db, PATCH_COLLECTION),
    where('compositionId', '==', compositionId)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const patches = snapshot.docs
        .map(mapMeasurePatch)
        .sort((a, b) => a.createdAtMs - b.createdAtMs);
      callback(patches);
    },
    (error) => {
      console.error('[collaborationService] Measure patch snapshot error:', error);
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  );
};

export const clearCompositionMeasurePatches = async (compositionId: string): Promise<void> => {
  if (!compositionId) return;
  const patchQuery = query(
    collection(db, PATCH_COLLECTION),
    where('compositionId', '==', compositionId)
  );
  const snapshot = await getDocs(patchQuery);
  if (snapshot.empty) return;

  const BATCH_LIMIT = 450;
  const refs = snapshot.docs.map((patchDoc) => doc(db, PATCH_COLLECTION, patchDoc.id));
  for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    refs.slice(i, i + BATCH_LIMIT).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
};
