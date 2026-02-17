import FeedCard from './FeedCard.jsx';

export function renderFeedCard(item, colors = {}, options = {}) {
  const { onDismiss = null, onPlay = null } = typeof options === 'function' ? { onDismiss: options } : options;
  return <FeedCard key={item.id} item={item} colors={colors} onDismiss={onDismiss} onPlay={onPlay} />;
}

export default {};
