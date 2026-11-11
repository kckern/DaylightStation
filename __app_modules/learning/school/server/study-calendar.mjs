/** Study-day/window value contract shared by installed measures. */
export {studyDayFor,isInWindow,weekWindowFor} from './domain/measures/weeklyWindow.mjs';
/** The household calendar's day-off tiers (`school.yml → calendar`). */
export {dayOffTier,EXCUSING_TIERS,isoWeekday} from './domain/schoolCalendar.mjs';
