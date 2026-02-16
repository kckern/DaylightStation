import ExternalCard from './ExternalCard.jsx';
import GroundingCard from './GroundingCard.jsx';
import MediaCard from './MediaCard.jsx';

const CARD_MAP = {
  freshrss: ExternalCard,
  headline: ExternalCard,
  reddit: ExternalCard,
  entropy: GroundingCard,
  health: GroundingCard,
  weather: GroundingCard,
  gratitude: GroundingCard,
  fitness: GroundingCard,
  tasks: GroundingCard,
  photo: MediaCard,
  plex: MediaCard,
};

export function renderFeedCard(item) {
  const Card = CARD_MAP[item.source] || ExternalCard;
  return <Card key={item.id} item={item} />;
}

export default CARD_MAP;
