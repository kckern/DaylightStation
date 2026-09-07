import { finishDate, lastFinish, recordingTime } from './readingHistory.js';
export default function FinishContext({ item }) {
  const finish = lastFinish(item);
  const date = finishDate(finish.day);
  const recorded = recordingTime(finish.recordedAt);
  return <div className="school-books__finish-context">
    <p>{date ? `Last finished ${date}` : 'Previously finished'}</p>
    {recorded && <p className="school-books__recorded">Recorded {recorded}</p>}
  </div>;
}
