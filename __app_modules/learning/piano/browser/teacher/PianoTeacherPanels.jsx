import PianoProgramsPanel from './PianoProgramsPanel.jsx';
import PianoLessonSittingsPanel from './PianoLessonSittingsPanel.jsx';

/** The piano panels on the teacher console: programs, then lesson sittings. */
export default function PianoTeacherPanels(props) {
  return (
    <>
      <PianoProgramsPanel {...props} />
      <PianoLessonSittingsPanel {...props} />
    </>
  );
}
