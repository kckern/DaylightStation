import * as language from '../Programs/SentenceLadder/languageApi.js';
import * as cards from '../Programs/Flashcards/CardLadder/cardLadderApi.js';
import * as gratitude from '../Programs/Gratitude/gratitudeApi.js';
import * as teacher from '../teacher/teacherWorkspaceApi.js';
import * as words from '../teacher/cardLadderAdminApi.js';
import * as admin from '../admin/schoolAdminApi.js';
import { useScopedSchoolClient } from './useSchoolApi.js';

const languageClient = options => language.createLanguageApi(options);
const cardClient = options => cards.createCardLadderApi(options);
const gratitudeClient = options => gratitude.createGratitudeApi(options);
const teacherClient = options => teacher.createTeacherWorkspaceApi(options);
const wordClient = options => words.createCardLadderAdminApi(options);
const adminClient = options => admin.createSchoolAdminApi(options);

export const useLanguageApi = () => useScopedSchoolClient(languageClient, language.languageApi);
export const useCardLadderApi = options => useScopedSchoolClient(cardClient, null, options);
export const useGratitudeApi = options => useScopedSchoolClient(gratitudeClient, null, options);
export const useTeacherWorkspaceApi = () => useScopedSchoolClient(teacherClient, teacher.teacherWorkspaceApi);
export const useCardLadderAdminApi = () => useScopedSchoolClient(wordClient, words.cardLadderAdminApi);
export const useSchoolAdminApi = () => useScopedSchoolClient(adminClient, admin.schoolAdminApi);
