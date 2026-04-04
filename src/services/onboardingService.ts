import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from './firebase';

const USER_ONBOARDING_COLLECTION = 'userOnboarding';

export interface FirstScoreOnboardingState {
  placedNote: boolean;
  playedBack: boolean;
  savedScore: boolean;
  firstScoreDone: boolean;
  checklistDismissed: boolean;
  toolbarTipsHidden: boolean;
}

const toBool = (value: unknown): boolean => value === true;

export const getFirstScoreOnboardingState = async (
  uid: string
): Promise<FirstScoreOnboardingState | null> => {
  if (!uid) return null;
  try {
    const ref = doc(db, USER_ONBOARDING_COLLECTION, uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data() as Record<string, unknown>;
    return {
      placedNote: toBool(data.placedNote),
      playedBack: toBool(data.playedBack),
      savedScore: toBool(data.savedScore),
      firstScoreDone: toBool(data.firstScoreDone),
      checklistDismissed: toBool(data.checklistDismissed),
      toolbarTipsHidden: toBool(data.toolbarTipsHidden),
    };
  } catch (error) {
    console.warn('Failed to load onboarding state:', error);
    return null;
  }
};

export const saveFirstScoreOnboardingState = async (
  uid: string,
  state: FirstScoreOnboardingState
): Promise<void> => {
  if (!uid) return;
  const ref = doc(db, USER_ONBOARDING_COLLECTION, uid);
  await setDoc(
    ref,
    {
      ...state,
      updatedAt: Timestamp.now(),
    },
    { merge: true }
  );
};
