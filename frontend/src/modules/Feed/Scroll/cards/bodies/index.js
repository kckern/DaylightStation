/**
 * Feed card body module registry.
 *
 * Maps item `source` values to body components.
 * To add a new source-specific body, create a file in this folder
 * and register it here.
 */
import DefaultBody from './DefaultBody.jsx';
import RedditBody from './RedditBody.jsx';
import GratitudeBody from './GratitudeBody.jsx';
import WeatherBody from './WeatherBody.jsx';
import FitnessBody from './FitnessBody.jsx';
import JournalBody from './JournalBody.jsx';
import HealthBody from './HealthBody.jsx';
import PhotoBody from './PhotoBody.jsx';
import MediaBody from './MediaBody.jsx';
import ReadalongBody from './ReadalongBody.jsx';
import GoodreadsBody from './GoodreadsBody.jsx';
import EbookBody from './EbookBody.jsx';

const BODY_MODULES = {
  reddit: RedditBody,
  gratitude: GratitudeBody,
  weather: WeatherBody,
  fitness: FitnessBody,
  journal: JournalBody,
  health: HealthBody,
  photo: PhotoBody,
  plex: MediaBody,
  readalong: ReadalongBody,
  goodreads: GoodreadsBody,
  'abs-ebooks': EbookBody,
};

export { DefaultBody };

export function getBodyModule(source) {
  return BODY_MODULES[source] || DefaultBody;
}
