import { useLogActivity } from './shared/useLogActivity.js';
import { LogTimeline } from "./LogTimeline.jsx";
import { LifePage, LoadingState, ErrorState } from "../../components/index.js";
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
  const { summaries, loading, error, refetch } = useLogActivity({ date, username, categories });

  if (loading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <LifePage title={formatDate(date)}>
      <LogTimeline summaries={summaries} />
    </LifePage>
  );
}
