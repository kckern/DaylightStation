import FeedCard from './FeedCard.jsx';

export function renderFeedCard(item) {
  return <FeedCard key={item.id} item={item} />;
}

export default {};
