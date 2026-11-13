import { makeTeacherGate } from './application/TeacherGate.mjs';
import { SchoolTeacherConfigSource } from './adapters/SchoolTeacherConfigSource.mjs';

/** Shared Teacher authorization and its live School configuration projection. */
export function createTeacherAuthorization({configService,userService,householdId,logger}) {
  const config = new SchoolTeacherConfigSource({configService});
  const gate = makeTeacherGate({loadTeachers:config.teachers,userService,householdId,logger});
  return {gate};
}
