import FeedCard from './FeedCard.jsx';

export function renderFeedCard(item, colors = {}) {
  return <FeedCard key={item.id} item={item} colors={colors} />;
}

export default {};
