import { Composition, Staff } from '../types/music';

const deepClone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const MAX_VOICE_LANES = 4;
const isValidVoiceIndex = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < MAX_VOICE_LANES;

export const getStaffDisplayLabel = (staff: Staff, staffIndex: number): string => {
  const trimmedName = staff.name?.trim();
  if (trimmedName) return trimmedName;

  const trimmedInstrument = staff.instrument?.trim();
  if (trimmedInstrument) {
    return `${trimmedInstrument.charAt(0).toUpperCase()}${trimmedInstrument.slice(1)}`;
  }
  return `Staff ${staffIndex + 1}`;
};

export const getVoiceDisplayLabel = (voiceIndex: number | null | undefined): string =>
  isValidVoiceIndex(voiceIndex) ? `V${voiceIndex + 1}` : 'All voices';

const buildVoiceScopedStaff = (
  sourceStaff: Staff,
  sourceVoiceIndex?: number | null
): Staff => {
  const clonedStaff = deepClone(sourceStaff);
  if (!isValidVoiceIndex(sourceVoiceIndex)) {
    return clonedStaff;
  }

  return {
    ...clonedStaff,
    measures: clonedStaff.measures.map((measure) => {
      const selectedVoice = measure.voices[sourceVoiceIndex] ?? { notes: [] };
      return {
        ...measure,
        voices: [
          { notes: [...selectedVoice.notes] },
          { notes: [] },
          { notes: [] },
          { notes: [] },
        ],
      };
    }),
  };
};

export const buildPartSourceSignature = (
  sourceComposition: Composition,
  sourceStaffIndex: number,
  sourceVoiceIndex?: number | null
): string => {
  const staff = sourceComposition.staves[sourceStaffIndex];
  const scopedStaff = buildVoiceScopedStaff(staff, sourceVoiceIndex);
  const payload = {
    sourceStaffIndex,
    sourceVoiceIndex: isValidVoiceIndex(sourceVoiceIndex) ? sourceVoiceIndex : null,
    title: sourceComposition.title,
    tempo: sourceComposition.tempo,
    timeSignature: sourceComposition.timeSignature,
    keySignature: sourceComposition.keySignature,
    notationSystem: sourceComposition.notationSystem,
    chantSpacingDensity: sourceComposition.chantSpacingDensity,
    chantInterpretation: sourceComposition.chantInterpretation,
    anacrusis: sourceComposition.anacrusis,
    pickupBeats: sourceComposition.pickupBeats,
    showMeasureNumbers: sourceComposition.showMeasureNumbers,
    playChords: sourceComposition.playChords,
    staff: scopedStaff,
  };
  return JSON.stringify(payload);
};

export const buildLinkedPartComposition = (params: {
  sourceComposition: Composition;
  sourceCompositionId: string;
  sourceStaffIndex: number;
  sourceVoiceIndex?: number | null;
  syncedAtIso?: string;
  preserveExistingId?: string;
  preserveCreatedAt?: Composition['createdAt'];
  preserveOwnerId?: string;
  preservePrivacy?: Composition['privacy'];
  preserveSharePermission?: Composition['sharePermission'];
  preserveSharedEmails?: string[];
}): Composition => {
  const {
    sourceComposition,
    sourceCompositionId,
    sourceStaffIndex,
    sourceVoiceIndex,
    syncedAtIso = new Date().toISOString(),
    preserveExistingId,
    preserveCreatedAt,
    preserveOwnerId,
    preservePrivacy,
    preserveSharePermission,
    preserveSharedEmails,
  } = params;

  const sourceStaff = sourceComposition.staves[sourceStaffIndex];
  if (!sourceStaff) {
    throw new Error(`Staff index ${sourceStaffIndex} not found in source composition.`);
  }

  const staffLabel = getStaffDisplayLabel(sourceStaff, sourceStaffIndex);
  const normalizedVoiceIndex = isValidVoiceIndex(sourceVoiceIndex) ? sourceVoiceIndex : null;
  const sourceSignature = buildPartSourceSignature(
    sourceComposition,
    sourceStaffIndex,
    normalizedVoiceIndex
  );
  const clonedStaff = buildVoiceScopedStaff(sourceStaff, normalizedVoiceIndex);
  delete clonedStaff.hidden;

  return {
    ...sourceComposition,
    id: preserveExistingId,
    createdAt: preserveCreatedAt ?? sourceComposition.createdAt,
    userId: preserveOwnerId ?? sourceComposition.userId,
    title: `${sourceComposition.title} - ${staffLabel}${
      normalizedVoiceIndex !== null ? ` (${getVoiceDisplayLabel(normalizedVoiceIndex)})` : ''
    } Part`,
    staves: [clonedStaff],
    privacy: preservePrivacy ?? sourceComposition.privacy ?? 'private',
    sharePermission: preserveSharePermission ?? sourceComposition.sharePermission,
    sharedEmails: preserveSharedEmails ?? sourceComposition.sharedEmails,
    linkedPartSource: {
      compositionId: sourceCompositionId,
      staffIndex: sourceStaffIndex,
      voiceIndex: normalizedVoiceIndex,
      staffLabel,
      sourceTitle: sourceComposition.title,
      sourceSignature,
      sourceUpdatedAt: sourceComposition.updatedAt
        ? new Date(sourceComposition.updatedAt).toISOString()
        : syncedAtIso,
      syncedAt: syncedAtIso,
    },
  };
};
