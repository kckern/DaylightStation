/**
 * SyllabiPanel — publish and edit syllabi (teacher.syllabi.edit): the saved,
 * named, reusable arguments a course enrollment materializes from
 * (docs/reference/school/teacher.md §7 — enrollment). A syllabus holds no
 * learner: it is published curriculum, which is why it lives on this page
 * and not Operations (settled design, not re-litigated here). Without one,
 * the enrollment drawer dead-ends on "No syllabus published for this course
 * yet." and a course cannot be brought into service from the console at all.
 *
 * `PUT /lifecycle/syllabi/:id` REPLACES THE WHOLE RECORD. This panel edits
 * eight fields — `title`, `courseId`, `profile`, the three `policy.*` keys,
 * `passing`, `term` — and round-trips everything else on the record the
 * editor was opened with, `timingTemplate` and `schedule` above all: a
 * course's calendar, with no UI here and no error if it silently vanished.
 * This is the same discipline `AssignmentsView.mergeEntries` holds to for a
 * list of entries; here there is one object, so the rule is simpler still —
 * spread the original record, then override only what this form edits.
 *
 * `syllabusId` follows the title as a slug while creating (the pattern
 * `PeriodsTimeline` uses for period ids) and is read-only once the syllabus
 * exists: enrollments reference it by id, and renaming the key would strand
 * them. Archive is two-tap and names its consequence: an archived syllabus
 * materializes no new enrollments, but existing ones keep their
 * already-materialized snapshot.
 *
 * `modules` is refused outright by `validateSyllabus` and is not offered
 * here — a syllabus covers its whole course. Profiles are authored per-course
 * (`work.profiles`) and no existing read exposes them to this panel, so
 * profile is a free-text field: an unknown one comes back as a named server
 * refusal rather than a client-side guess.
 *
 * Server validation is the authority — `validateSyllabus`'s named errors are
 * shown verbatim (`errors.save`), never re-implemented here. The one client
 * guard is `passing`: a blank field must not silently clear a real value, so
 * clearing it back to "course default" is a separate, deliberate checkbox —
 * the same posture `CurriculumBrowser`'s pass-override Set/Clear split holds.
 *
 * NO CONCURRENCY BASELINE: unlike periods (`baseHistoryLength`) and
 * assignments (`baseUpdatedAt`), `syllabi.save` takes no base* parameter and
 * `YamlSyllabusStore.put` performs no compare-and-swap — a save here always
 * wins, last-write-wins. That gap predates this panel; it is named, not
 * invented around.
 */
import { useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import PanelFrame from './PanelFrame.jsx';
import { useTeacherWrite } from '../useTeacherWrite.js';
import { curriculumTitles } from '../curriculumTitles.js';

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const ORDERINGS = ['fixed', 'sequence', 'shuffle_once'];
const idFromLabel = (label) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function SyllabusEditor({
  mode, original, courseIds, titles, existingIds = [], onCancel, onSaved,
}) {
  const { run, busy, errors } = useTeacherWrite({ panel: 'syllabi' });
  const [draft, setDraft] = useState(() => ({
    syllabusId: original.syllabusId ?? '',
    title: original.title ?? '',
    courseId: original.courseId ?? (courseIds[0] ?? ''),
    profile: original.profile ?? '',
    moduleOrder: original.policy?.module_order ?? '',
    lessonOrder: original.policy?.lesson_order ?? '',
    requiredOpeningModule: original.policy?.required_opening_module ?? '',
    passing: original.passing != null ? String(original.passing) : '',
    clearPassing: false,
    term: original.term ?? '',
    // An EXISTING syllabusId is settled — a title tweak must never silently
    // rename the key enrollments reference (design point 4). Only a CREATE
    // starts unsettled, following the title until touched by hand.
    idTouched: mode === 'edit',
  }));
  const [localError, setLocalError] = useState(null);

  // A stale course id (assigned once, since dropped from the catalog) must
  // still show up as itself rather than blanking the select silently — the
  // same "not in catalog" posture AssignmentsView holds for stale entries.
  const courseOptions = [
    ...courseIds,
    ...(original.courseId && !courseIds.includes(original.courseId) ? [original.courseId] : []),
  ];

  const patch = (field, value) => setDraft((d) => ({ ...d, [field]: value }));

  const onTitleChange = (value) => setDraft((d) => ({
    ...d,
    title: value,
    syllabusId: mode === 'create' && !d.idTouched ? idFromLabel(value) : d.syllabusId,
  }));

  const save = () => {
    if (mode === 'create') {
      if (!SLUG.test(draft.syllabusId)) {
        setLocalError('Syllabus id must be lowercase letters, numbers, and hyphens, starting with a letter or number.');
        return;
      }
      if (existingIds.includes(draft.syllabusId)) {
        setLocalError(`"${draft.syllabusId}" is already in use — pick a different id.`);
        return;
      }
    }
    if (!draft.title.trim()) { setLocalError('Title is required.'); return; }
    if (!draft.courseId) { setLocalError('Choose a course.'); return; }

    // Blank must never silently CLEAR a real pass bar (design point 6): only
    // an explicit clear (the checkbox) or a real typed number changes it.
    // Anything else round-trips whatever the record already held.
    let passing = original.passing ?? null;
    if (!draft.clearPassing && draft.passing.trim() !== '') {
      const typed = draft.passing.trim();
      const parsed = Number.parseInt(typed, 10);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100 || String(parsed) !== typed) {
        setLocalError('Pass bar must be a whole number 1-100.');
        return;
      }
      passing = parsed;
    } else if (draft.clearPassing) {
      passing = null;
    }
    setLocalError(null);

    const policy = {
      ...(draft.moduleOrder ? { module_order: draft.moduleOrder } : {}),
      ...(draft.lessonOrder ? { lesson_order: draft.lessonOrder } : {}),
      ...(draft.requiredOpeningModule.trim() ? { required_opening_module: draft.requiredOpeningModule.trim() } : {}),
    };

    // THE ROUND-TRIP: start from the record this editor was opened with —
    // carrying timingTemplate, schedule, and anything else this panel does
    // not render or understand — and override only the fields this form
    // actually edits. A blank editor built from scratch here would silently
    // destroy a course's calendar on the next save.
    const body = {
      ...original,
      title: draft.title.trim(),
      courseId: draft.courseId,
      profile: draft.profile.trim() || null,
      policy: Object.keys(policy).length ? policy : null,
      passing,
      term: draft.term.trim() || null,
    };

    const id = mode === 'create' ? draft.syllabusId : original.syllabusId;
    run('save', ({ actorId, pin }) => schoolApi.putSyllabus(id, { ...body, editedBy: actorId, pin }), {
      onSuccess: onSaved,
    });
  };

  return (
    <div className="teacher-syllabi__editor">
      <div className="teacher-periods__editrow">
        <input aria-label="Title" placeholder="Title" value={draft.title} onChange={(e) => onTitleChange(e.target.value)} />
        <input
          aria-label="Syllabus id"
          placeholder="syllabus-id"
          value={draft.syllabusId}
          readOnly={mode === 'edit'}
          disabled={mode === 'edit'}
          onChange={(e) => setDraft((d) => ({ ...d, syllabusId: e.target.value, idTouched: true }))}
        />
        <select aria-label="Course" value={draft.courseId} onChange={(e) => patch('courseId', e.target.value)}>
          <option value="">choose a course</option>
          {courseOptions.map((id) => <option key={id} value={id}>{titles.course(id)}</option>)}
        </select>
      </div>
      <div className="teacher-periods__editrow">
        <input aria-label="Profile" placeholder="Profile (optional)" value={draft.profile} onChange={(e) => patch('profile', e.target.value)} />
        <input aria-label="Term" placeholder="Term (optional)" value={draft.term} onChange={(e) => patch('term', e.target.value)} />
      </div>
      <div className="teacher-periods__editrow">
        <select aria-label="Module order" value={draft.moduleOrder} onChange={(e) => patch('moduleOrder', e.target.value)}>
          <option value="">module order: course default</option>
          {ORDERINGS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <select aria-label="Lesson order" value={draft.lessonOrder} onChange={(e) => patch('lessonOrder', e.target.value)}>
          <option value="">lesson order: course default</option>
          {ORDERINGS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <input
          aria-label="Required opening module"
          placeholder="Required opening module (optional)"
          value={draft.requiredOpeningModule}
          onChange={(e) => patch('requiredOpeningModule', e.target.value)}
        />
      </div>
      <div className="teacher-periods__editrow">
        <input
          aria-label="Pass bar"
          inputMode="numeric"
          placeholder="Pass % (blank keeps the current value)"
          value={draft.passing}
          disabled={draft.clearPassing}
          onChange={(e) => patch('passing', e.target.value)}
        />
        <label className="teacher-assignments__pick">
          <input
            type="checkbox"
            checked={draft.clearPassing}
            onChange={(e) => setDraft((d) => ({ ...d, clearPassing: e.target.checked, passing: e.target.checked ? '' : d.passing }))}
          />
          Use the course default pass bar
        </label>
      </div>
      <div className="teacher-assignments__actions">
        <button type="button" disabled={busy === 'save'} onClick={save}>Save</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
      {(localError || errors.save) && <p className="teacher-panel__error">{localError ?? errors.save}</p>}
    </div>
  );
}

function SyllabusSummary({
  record, titles, armed, onEdit, onArm, onDisarm, onArchived,
}) {
  const { run, busy, errors } = useTeacherWrite({ panel: 'syllabi' });
  const archive = () => run('archive', ({ actorId, pin }) => schoolApi.archiveSyllabus(record.syllabusId, {
    archivedBy: actorId, pin,
  }), { onSuccess: onArchived });

  const policyBits = [
    record.policy?.module_order && `module ${record.policy.module_order}`,
    record.policy?.lesson_order && `lesson ${record.policy.lesson_order}`,
    record.policy?.required_opening_module && `opens with ${record.policy.required_opening_module}`,
  ].filter(Boolean);

  return (
    <div className="teacher-syllabi__summary">
      <div className="teacher-syllabi__head">
        <span className="teacher-syllabi__title">{record.title}</span>
        <span className="teacher-syllabi__course">{titles.course(record.courseId)}</span>
      </div>
      <div className="teacher-syllabi__meta">
        <span>{record.profile ? `profile ${record.profile}` : 'no profile'}</span>
        <span>{record.passing != null ? `pass ${record.passing}%` : 'course default pass bar'}</span>
        <span>{record.term ?? 'no term'}</span>
        {policyBits.length > 0 && <span>{policyBits.join(' · ')}</span>}
      </div>
      {armed ? (
        <div className="teacher-close-period__confirm" role="alert">
          <span>
            Archive &ldquo;{record.title}&rdquo;? It will materialize no new enrollments; existing enrollments keep their snapshot.
          </span>
          <button type="button" disabled={busy === 'archive'} onClick={archive}>Confirm</button>
          <button type="button" onClick={onDisarm}>Cancel</button>
        </div>
      ) : (
        <div className="teacher-assignments__actions">
          <button type="button" onClick={onEdit}>Edit</button>
          <button type="button" onClick={onArm}>Archive</button>
        </div>
      )}
      {errors.archive && <p className="teacher-panel__error">{errors.archive}</p>}
    </div>
  );
}

export default function SyllabiPanel() {
  const syllabi = usePanelFetch(() => schoolApi.syllabi(), {
    panel: 'syllabi',
    isEmpty: (d) => !(d?.syllabi ?? []).length,
  });
  const catalog = usePanelFetch(() => schoolApi.curriculumUnits(), {
    panel: 'syllabi-catalog',
    notFoundAs: 'unavailable',
    isEmpty: (d) => !(d?.units ?? []).length,
  });
  const [editingId, setEditingId] = useState(null); // null | 'new' | an existing syllabusId
  const [armedArchive, setArmedArchive] = useState(null);

  const units = catalog.data?.units ?? [];
  const courseIds = [...new Set(units.filter((u) => u.courseId).map((u) => u.courseId))];
  const titles = curriculumTitles(units);
  const list = syllabi.data?.syllabi ?? [];

  const stopEditing = () => setEditingId(null);
  const afterSave = () => { setEditingId(null); syllabi.retry(); };

  return (
    <PanelFrame title="Syllabi" state={syllabi.state} retry={syllabi.retry} alwaysRender>
      {(syllabi.state === 'ok' || syllabi.state === 'empty') && (
        <div className="teacher-syllabi">
          {syllabi.state === 'empty' && (
            <p className="teacher-panel__empty">No syllabi published yet.</p>
          )}
          {syllabi.state === 'ok' && (
            <ul className="teacher-syllabi__list">
              {list.map((record) => (
                <li key={record.syllabusId} className="teacher-syllabi__row">
                  {editingId === record.syllabusId ? (
                    <SyllabusEditor
                      mode="edit"
                      original={record}
                      courseIds={courseIds}
                      titles={titles}
                      onCancel={stopEditing}
                      onSaved={afterSave}
                    />
                  ) : (
                    <SyllabusSummary
                      record={record}
                      titles={titles}
                      armed={armedArchive === record.syllabusId}
                      onEdit={() => setEditingId(record.syllabusId)}
                      onArm={() => setArmedArchive(record.syllabusId)}
                      onDisarm={() => setArmedArchive(null)}
                      onArchived={() => { setArmedArchive(null); syllabi.retry(); }}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          {editingId === 'new' && (
            <div className="teacher-syllabi__row">
              <SyllabusEditor
                mode="create"
                original={{}}
                courseIds={courseIds}
                titles={titles}
                existingIds={list.map((s) => s.syllabusId)}
                onCancel={stopEditing}
                onSaved={afterSave}
              />
            </div>
          )}
          {catalog.state === 'ok' && editingId === null && (
            <button type="button" className="teacher-assignments__edit" onClick={() => setEditingId('new')}>Add syllabus</button>
          )}
        </div>
      )}
    </PanelFrame>
  );
}
