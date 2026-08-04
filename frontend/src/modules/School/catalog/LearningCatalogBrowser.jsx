import { useEffect, useMemo, useState } from 'react';
import { schoolApi } from '../schoolApi.js';
import { useSchoolProfile } from '../identity/SchoolProfileContext.jsx';

const MODULE_LABELS = Object.freeze({
  lecture_notes: 'Read', examples: 'Examples', problems: 'Practice',
  flashcards: 'Flashcards', quiz: 'Quiz', learning_probe: 'Learning check',
  activity: 'Activity', tool: 'Tool', custom: 'Interactive',
});

/** Browse the authored School taxonomy without knowing any subject names. */
export default function LearningCatalogBrowser({ onLaunch }) {
  const { status, currentUser, isGuest } = useSchoolProfile();
  const [catalogs, setCatalogs] = useState(null);
  const [path, setPath] = useState([]);
  const [lesson, setLesson] = useState(null);
  const [loadingLesson, setLoadingLesson] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (status !== 'ready') return undefined;
    let alive = true;
    setCatalogs(null);
    setPath([]);
    setLesson(null);
    setError(null);
    schoolApi.learningCatalogs(currentUser?.id ?? null).then(({ ok, data }) => {
      if (!alive) return;
      if (!ok || data?.schema !== 'school.catalog-index/v1' || !Array.isArray(data.catalogs)) {
        setError('The learning Catalog is unavailable.');
        setCatalogs([]);
        return;
      }
      setCatalogs(data.catalogs);
    });
    return () => { alive = false; };
  }, [currentUser?.id, isGuest, status]);

  const current = path[path.length - 1] ?? null;
  const choices = useMemo(() => {
    if (!current) return catalogs ?? [];
    if (current.kind === 'catalog') return current.value.subjects ?? [];
    if (current.kind === 'subject') return current.value.courses ?? [];
    if (current.kind === 'course') return current.value.units ?? [];
    if (current.kind === 'unit') return current.value.lessons ?? [];
    return [];
  }, [catalogs, current]);

  const kind = !current ? 'catalog'
    : current.kind === 'catalog' ? 'subject'
      : current.kind === 'subject' ? 'course'
        : current.kind === 'course' ? 'unit'
          : current.kind === 'unit' ? 'lesson' : 'module';

  const open = async (value) => {
    setError(null);
    if (kind !== 'lesson') {
      setPath((trail) => [...trail, { kind, value }]);
      return;
    }
    const catalog = path.find((entry) => entry.kind === 'catalog')?.value;
    const subject = path.find((entry) => entry.kind === 'subject')?.value;
    const course = path.find((entry) => entry.kind === 'course')?.value;
    const unit = path.find((entry) => entry.kind === 'unit')?.value;
    const address = {
      catalogId: catalog.catalogId, subjectId: subject.subjectId,
      courseId: course.courseId, unitId: unit.unitId, lessonId: value.lessonId,
    };
    setLoadingLesson(true);
    const response = await schoolApi.learningLesson(address, currentUser?.id ?? null);
    setLoadingLesson(false);
    if (!response.ok || response.data?.schema !== 'school.learning-lesson/v1') {
      setError('This lesson could not be loaded.');
      return;
    }
    setLesson(response.data);
    setPath((trail) => [...trail, { kind: 'lesson', value }]);
  };

  const goTo = (count) => {
    setPath((trail) => trail.slice(0, count));
    setLesson(null);
    setError(null);
  };

  if (catalogs === null) return <div className="school-learning-catalog is-status">Loading Catalog…</div>;

  const modules = current?.kind === 'lesson' ? (lesson?.lesson?.modules ?? []) : [];
  return (
    <section className="school-learning-catalog" aria-label="Learning Catalog">
      <nav className="school-learning-catalog__trail" aria-label="Catalog location">
        <button type="button" onClick={() => goTo(0)}>Catalog</button>
        {path.map((entry, index) => (
          <span key={`${entry.kind}:${entry.value[`${entry.kind}Id`] ?? index}`}>
            <span aria-hidden>›</span>
            <button type="button" onClick={() => goTo(index + 1)}>{entry.value.title}</button>
          </span>
        ))}
      </nav>
      {error && <p className="school-learning-catalog__error" role="alert">{error}</p>}
      {loadingLesson && <p className="school-learning-catalog__status">Loading lesson…</p>}
      {!loadingLesson && current?.kind !== 'lesson' && (
        <div className="school-learning-catalog__grid">
          {choices.map((choice) => {
            const id = choice[`${kind}Id`];
            return (
              <button key={id} type="button" onClick={() => open(choice)}>
                <strong>{choice.title}</strong>
                {choice.description && <span>{choice.description}</span>}
                {choice.estimatedMinutes && <small>{choice.estimatedMinutes} min</small>}
              </button>
            );
          })}
          {choices.length === 0 && !error && <p className="school-learning-catalog__status">Nothing is published here yet.</p>}
        </div>
      )}
      {!loadingLesson && current?.kind === 'lesson' && lesson && (
        <div className="school-learning-catalog__lesson">
          <header>
            <p>Lesson</p>
            <h2>{lesson.lesson.title}</h2>
            {lesson.lesson.objectives?.length > 0 && (
              <ul>{lesson.lesson.objectives.map((objective) => <li key={objective}>{objective}</li>)}</ul>
            )}
          </header>
          <ol className="school-learning-catalog__modules">
            {modules.map((module, index) => (
              <li key={module.moduleId}>
                <button type="button" onClick={() => onLaunch({
                  module,
                  learning: {
                    catalogId: lesson.context.catalog.catalogId,
                    subjectId: lesson.context.subject.subjectId,
                    courseId: lesson.context.course.courseId,
                    unitId: lesson.context.unit.unitId,
                    lessonId: lesson.lesson.lessonId,
                    moduleId: module.moduleId,
                    conceptIds: module.conceptIds ?? [],
                  },
                })}>
                  <span className="school-learning-catalog__module-index">{index + 1}</span>
                  <span><strong>{module.title ?? MODULE_LABELS[module.type] ?? 'Module'}</strong><small>{MODULE_LABELS[module.type] ?? module.type}</small></span>
                  <span aria-hidden>›</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
