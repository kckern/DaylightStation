import ReflectionResponse from '../../shared/ReflectionResponse.jsx';
import { schoolDebriefLog } from '../schoolDebriefLog.js';
export default function PromptItem({ onSubmit, ...props }) {
  return <ReflectionResponse {...props} events={schoolDebriefLog} fieldSpaceStartsRecording onSubmit={({ text, via, audioRef }) => onSubmit({ text, via, audioRef })} />;
}
