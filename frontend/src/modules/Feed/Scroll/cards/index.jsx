import FeedCard from './FeedCard.jsx';

export function renderFeedCard(item, colors = {}, onDismiss = null) {
  return <FeedCard key={item.id} item={item} colors={colors} onDismiss={onDismiss} />;
}

export default {};
