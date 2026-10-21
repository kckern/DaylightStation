import { TouchButton } from "../../../../../../../frontend/src/lib/ui/index.js";
import Icon from "../../../home/icons/Icon.jsx";
import { useSchoolDebriefKeys } from "../useSchoolDebriefKeys.js";

/** A grown-up rejected this day: nothing to do here but go and talk. Enter finishes. */
export default function TalkToGrownUpItem({ onFinish }) {
  useSchoolDebriefKeys({ enter: onFinish });
  return (
    <section className="sd-item sd-talk" aria-label="Talk to a grown-up">
      <h2><Icon name="writing" /> A grown-up wants to talk with you about this one.</h2>
      <div className="sd-controls"><TouchButton variant="primary" keyHint="Enter" onClick={onFinish}>Done</TouchButton></div>
    </section>
  );
}
