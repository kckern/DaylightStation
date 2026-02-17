import BodySection from './BodySection.jsx';
import ArticleSection from './ArticleSection.jsx';
import CommentsSection from './CommentsSection.jsx';
import StatsSection from './StatsSection.jsx';
import MetadataSection from './MetadataSection.jsx';
import EmbedSection from './EmbedSection.jsx';
import MediaSection from './MediaSection.jsx';
import ActionsSection from './ActionsSection.jsx';
import PlayerSection from './PlayerSection.jsx';
import GallerySection from './GallerySection.jsx';
import ScriptureSection from './ScriptureSection.jsx';
import TimelineSection from './TimelineSection.jsx';

const SECTION_MAP = {
  body: BodySection,
  article: ArticleSection,
  comments: CommentsSection,
  stats: StatsSection,
  metadata: MetadataSection,
  embed: EmbedSection,
  media: MediaSection,
  actions: ActionsSection,
  player: PlayerSection,
  gallery: GallerySection,
  scripture: ScriptureSection,
  timeline: TimelineSection,
};

export function renderSection(section, context) {
  const Component = SECTION_MAP[section.type];
  if (!Component) return null;
  return <Component data={section.data} {...context} />;
}
