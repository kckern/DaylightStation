import { SchoolActivityFrame } from '../portal/SchoolActivityFrame.jsx';
import { SchoolButton } from '../portal/SchoolButton.jsx';
import { activityFor } from './activityManifest.js';
import QuizRunner from "../quiz/QuizRunner.jsx";
import FlashcardRunner from "../flashcards/FlashcardRunner.jsx";
import SchoolHome from "../home/SchoolHome.jsx";
import SubjectPage from "../home/SubjectPage.jsx";
import LibraryPage from "../home/LibraryPage.jsx";
import PrintCenter from "../print/PrintCenter.jsx";
import TypingTutor from "../Typing/TypingTutor.jsx";
import GeographyGrid from "../geography/GeographyGrid.jsx";
import ChessLessons from "../chess/ChessLessons.jsx";
import GeoQuizRunner from "../geography/GeoQuizRunner.jsx";
import SentenceLadderProgram from "../Programs/SentenceLadder/SentenceLadderProgram.jsx";
import LanguageReelsProgram from "../Programs/LanguageReels/LanguageReelsProgram.jsx";
import FlashcardProgram from "../Programs/Flashcards/FlashcardProgram.jsx";
import CardLadderProgram from "../Programs/Flashcards/CardLadder/CardLadderProgram.jsx";
import RubiksCubeProgram from "../Programs/RubiksCube/RubiksCubeProgram.jsx";
import GratitudeProgram from "../Programs/Gratitude/GratitudeProgram.jsx";
import SchoolDebriefProgram from "../Programs/SchoolDebrief/SchoolDebriefProgram.jsx";
import BookShelf from "../books/BookShelf.jsx";
import ReportPanel from "../report/ReportPanel.jsx";
import AdaptiveTutorPanel from "../remediation/AdaptiveTutorPanel.jsx";
import LearningCatalogBrowser from "../catalog/LearningCatalogBrowser.jsx";
import LearningContentReader from "../catalog/LearningContentReader.jsx";
import LearningProbeRunner from "../probes/LearningProbeRunner.jsx";
import BankScreen from "../bank/BankScreen.jsx";
import { ReadalongPlaylistPlayer } from "../../../../../__capabilities/playback/browser/readalong.mjs";

export const ACTIVITY_RENDERERS = Object.freeze({
  'home': SchoolHome,
  'subject': SubjectPage,
  'library': LibraryPage,
  'print': PrintCenter,
  'typing': TypingTutor,
  'geography': GeographyGrid,
  'chess': ChessLessons,
  'geography-drill': GeoQuizRunner,
  'quiz': QuizRunner,
  'flashcard': FlashcardRunner,
  'progress': ReportPanel,
  'remediation': AdaptiveTutorPanel,
  'catalog': LearningCatalogBrowser,
  'learning-reader': LearningContentReader,
  'learning-probe': LearningProbeRunner,
  'flashcards': FlashcardProgram,
  'card-ladder': CardLadderProgram,
  'rubiks-cube': RubiksCubeProgram,
  'gratitude': GratitudeProgram,
  'school-debrief': SchoolDebriefProgram,
  'book-log': BookShelf,
  'economy-bank': BankScreen,
  'sentence-ladder': SentenceLadderProgram,
  'language-reels': LanguageReelsProgram,
  'lesson-companion': ReadalongPlaylistPlayer
});
/** Frames compose existing learning adapters; they do not mint authority or credit. */
export default function SchoolActivityHost({activityId,renderProps={}}) {
  const entry=activityFor(activityId), Renderer=ACTIVITY_RENDERERS[activityId];
  if(!entry || !Renderer) return <section role="alert"><p>This activity is unavailable on this screen.</p>{renderProps.onExit && <SchoolButton onClick={renderProps.onExit}>Back</SchoolButton>}</section>;
  return <SchoolActivityFrame layout={entry.layout} className="school-activity--adapter"><Renderer {...renderProps}/></SchoolActivityFrame>;
}
