import { TouchButton } from "../../../../../../frontend/src/lib/ui/index.js";
import Icon from "../../home/icons/Icon.jsx";
import { useSchoolDebriefKeys } from "./useSchoolDebriefKeys.js";

/** Today / resume / yesterday-late offers (spec §6). The late offer comes first: today's work closes it. */
export default function SchoolDebriefStartCard({ today, lateDay = null, onStart }) {
  const offers = [];
  if (lateDay) offers.push({ key: 'late', day: lateDay, label: "Yesterday's debrief (late)" });
  if (today && !['completed', 'excused'].includes(today.phase)) {
    offers.push({ key: 'today', day: today.studyDay, label: today.phase === 'not-started' ? 'Tell me about school today' : 'Pick up where you left off' });
  }
  useSchoolDebriefKeys({ enter: () => offers[0] && onStart(offers[0].day), ...Object.fromEntries(offers.map((o, i) => [String(i + 1), () => onStart(o.day)])) });
  return (
    <section className="sd-item sd-start" aria-label="After-school debrief">
      <h1><Icon name="writing" /> After-school debrief</h1>
      <div className="sd-controls sd-controls--stack">
        {offers.map((o, i) => (
          <TouchButton key={o.key} variant={i === 0 ? 'primary' : 'secondary'} keyHint={i === 0 ? 'Enter' : String(i + 1)} onClick={() => onStart(o.day)}>{o.label}</TouchButton>
        ))}
      </div>
    </section>
  );
}
