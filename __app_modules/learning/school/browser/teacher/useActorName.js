/**
 * A teacher id as the teacher's name. Records keep `attestedBy`,
 * `decidedBy`, `closedBy` and the like as the actor's id; the console shows
 * who did it by the roster's display name, never the raw id when a name is
 * known.
 *
 * `useTeacherProfileOptional`, not the throwing `useTeacherProfile`: these are
 * read-only labels on panels that may be mounted outside the console, and an
 * unknown name is an id on screen, not a crashed panel.
 */
import { useTeacherProfileOptional } from "./TeacherProfileContext.jsx";

export function useActorName() {
  const profile = useTeacherProfileOptional();
  const teachers = profile?.teachers ?? [];
  const current = profile?.currentTeacher ?? null;
  return (id) => teachers.find((teacher) => teacher.id === id)?.name
    ?? (current?.id === id ? current?.name : null)
    ?? id
    ?? 'someone';
}

export default useActorName;
