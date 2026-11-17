import { useTeacherWorkspaceApi } from '../../runtime/useSchoolFeatureApi.js';
import { SchoolButton } from '../../portal/SchoolButton.jsx';
import { useState } from 'react';


const POPUP_NAME = 'daylight-school-launch-preview';
const POPUP_FEATURES = 'popup,width=1180,height=820,resizable=yes,scrollbars=yes';

/** Open the real learner launch-card renderer with every action disabled. */
export default function LaunchPreviewAction({ learnerId, subject, label = 'Preview launch card' }) {
  const teacherWorkspaceApi = useTeacherWorkspaceApi();
  const [blockedUrl, setBlockedUrl] = useState(null);
  if (!learnerId || !subject) return null;
  // Older test doubles and cutback bundles may not carry the additive helper;
  // keep the URL construction compatible while the server route is additive.
  const url = typeof teacherWorkspaceApi.launchPreviewUrl === 'function'
    ? teacherWorkspaceApi.launchPreviewUrl(learnerId, subject)
    : `/api/v1/school/teacher/learners/${encodeURIComponent(learnerId)}/launch-preview?${new URLSearchParams({ subject })}`;
  const open = () => {
    const popup = window.open(url, POPUP_NAME, POPUP_FEATURES);
    if (!popup) {
      setBlockedUrl(url);
      return;
    }
    setBlockedUrl(null);
    popup.focus?.();
  };
  return (
    <span className="teacher-launch-preview-action">
      <SchoolButton variant="plain" type="button" className="teacher-btn teacher-btn--quiet" onClick={open}>{label} ↗</SchoolButton>
      {blockedUrl && (
        <a className="teacher-launch-preview-action__fallback" href={blockedUrl} target="_blank" rel="noreferrer">
          Pop-up blocked — open preview
        </a>
      )}
    </span>
  );
}
