import { useLogActivity } from './shared/useLogActivity.js';
import { LogReadRegion } from './shared/LogReadRegion.jsx';
import { LogTimeline } from "./LogTimeline.jsx";
import { LifePage } from "../../components/index.js";
import { formatDate } from "../../lib/format.js";

/**
 * Full day detail view showing all sources as a timeline.
 *
 * @param {Object} props
 * @param {string} props.date - YYYY-MM-DD
 * @param {string} [props.username]
 * @param {string[]} [props.categories]
 */
export function LogDayDetail({ date, username, categories }) {
  const read = useLogActivity({ date, username, categories });

  return (
    <LogReadRegion read={read}>
      <LifePage title={formatDate(date)}>
        <LogTimeline summaries={read.summaries} />
      </LifePage>
    </LogReadRegion>
  );
}
