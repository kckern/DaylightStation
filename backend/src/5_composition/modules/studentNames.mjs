/**
 * The one learner-name resolver composition hands to school and piano
 * producers: the profile's `display_name` (then `name`), else a title-cased
 * id ('user_4' → 'User 4'). Never the raw id, since it is read on a phone
 * or aloud in a room.
 */
import { personDisplayName } from '#domains/notification/push/pushText.mjs';

/** @param {{ getUserProfile?: (id: string) => object|null }} configService */
export const studentDisplayName = (configService) => (learnerId) =>
  personDisplayName(configService?.getUserProfile?.(learnerId), learnerId);

export default studentDisplayName;
