import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyMove, COLORS, cubeDiagramSvg, FACES } from '@shared-gaming/rulesets/rubiks-cube/index.mjs';
import { schoolApi } from '../../schoolApi.js';
import './RubiksCube.scss';

const FACE_LABEL = { U: 'Up', R: 'Right', F: 'Front', D: 'Down', L: 'Left', B: 'Back' };
const FALLBACK_CUBE = Object.fromEntries(FACES.map((face) => [face, Array(9).fill(COLORS[face])]));
const PHYSICAL_COLORS = Object.values(COLORS);

function PhysicalCubeCoach({ physical, packet, busy, onImport, onPacket, onCoach, onAdvance, onVerify, lesson }) {
  const [faces, setFaces] = useState(() => structuredClone(FALLBACK_CUBE));
  const [faceIndex, setFaceIndex] = useState(0); const [paint, setPaint] = useState(COLORS.U); const [errors, setErrors] = useState([]);
  const face = FACES[faceIndex];
  const paintSticker = (index) => { if (index === 4) return; setFaces((old) => ({ ...old, [face]: old[face].map((color, i) => i === index ? paint : color) })); };
  const importFaces = async () => { const result = await onImport(faces); setErrors(result?.errors || []); };
  return <section className="rubiks-cube__physical" aria-label="My physical cube">
    <div><h3>My physical cube</h3><p>Keep the center named below facing the same way while you enter one face at a time. The middle sticker is locked because it names the face.</p></div>
    <div className="rubiks-cube__palette" aria-label="Sticker colour"><span>Paint:</span>{PHYSICAL_COLORS.map((color) => <button key={color} type="button" className={paint === color ? 'is-selected' : ''} onClick={() => setPaint(color)} style={{ '--sticker': color }}>{color}</button>)}</div>
    <div className="rubiks-cube__physical-entry"><p><b>{FACE_LABEL[face]} face</b> · Face {faceIndex + 1} of 6</p><div className="rubiks-cube__entry-face" aria-label={`Enter ${FACE_LABEL[face]} face`}>{faces[face].map((color, index) => <button key={index} type="button" disabled={index === 4 || busy} aria-label={index === 4 ? `${FACE_LABEL[face]} center: ${color}` : `${FACE_LABEL[face]} sticker ${index + 1}: ${color}`} onClick={() => paintSticker(index)} style={{ '--sticker': color }}>{index === 4 ? face : ''}</button>)}</div><div><button type="button" disabled={faceIndex === 0 || busy} onClick={() => setFaceIndex((value) => value - 1)}>Previous face</button><button type="button" disabled={faceIndex === FACES.length - 1 || busy} onClick={() => setFaceIndex((value) => value + 1)}>Next face</button><button type="button" disabled={busy} onClick={importFaces}>Check my cube</button></div></div>
    {errors.map((error) => <p key={error.code} className="rubiks-cube__error" role="alert">{error.message}</p>)}
    {physical?.entered && <div className="rubiks-cube__card"><p>Your entered cube is valid. Make a paper-first packet for this exact cube, then work from the packet while you hold your physical cube.</p><button type="button" disabled={busy} onClick={onPacket}>Make my paper plan</button>{packet && <div><p><b>Current paper plan:</b> {packet.steps.length} move groups · {packet.status}</p><ol>{packet.steps.map((step) => <li key={step.number}><b>{step.title}:</b> {step.moves.length ? step.moves.join(' ') : step.instruction}</li>)}</ol><p>When you finish the paper plan, re-enter all six faces to verify this packet.</p><button type="button" disabled={busy || packet.status === 'verified'} onClick={() => onVerify(faces)}>Verify my paper plan</button></div>}</div>}
    {physical?.verified?.[lesson.id] && <p className="rubiks-cube__notice" role="status">Physical cube verified for this lesson.</p>}
  </section>;
}

function CubeNet({ cube = FALLBACK_CUBE, onMove, disabled }) {
  return <div className="rubiks-cube__net" aria-label="Rubik’s Cube net">
    {FACES.map((face) => <div key={face} className={`rubiks-cube__face rubiks-cube__face--${face}`} aria-label={`${FACE_LABEL[face]} face`}>
      {cube[face]?.map((color, index) => <span key={index} className="rubiks-cube__sticker" aria-label={`${FACE_LABEL[face]} sticker ${index + 1}: ${color}`} style={{ '--sticker': color }} />)}
    </div>)}
    <div className="rubiks-cube__turns" aria-label="Cube turns">
      {FACES.map((face) => <div key={face} className="rubiks-cube__turn-group"><b>{face}</b><button type="button" disabled={disabled} onClick={() => onMove(face)}>{face}</button><button type="button" disabled={disabled} onClick={() => onMove(`${face}'`)}>{face}′</button><button type="button" disabled={disabled} onClick={() => onMove(`${face}2`)}>{face}2</button></div>)}
    </div>
  </div>;
}

/** A compact isometric companion view.  It deliberately reads the same face
 * projection as the teaching net; there is no second client-side cube state. */
function CubePerspective({ cube }) {
  return <div className="rubiks-cube__perspective" aria-label="Three dimensional cube view">
    {['U', 'F', 'R'].map((face) => <div key={face} className={`rubiks-cube__perspective-face rubiks-cube__perspective-face--${face}`}>{cube[face]?.map((color, index) => <span key={index} style={{ '--sticker': color }} />)}</div>)}
  </div>;
}

function Quiz({ lesson, onAnswer, busy }) {
  const [answers, setAnswers] = useState(() => Array(lesson.questions?.length).fill(null));
  useEffect(() => setAnswers(Array(lesson.questions?.length).fill(null)), [lesson.id, lesson.questions?.length]);
  return <section className="rubiks-cube__quiz"><p>{lesson.prompt}</p>{lesson.questions?.map((question, index) => <fieldset key={index}><legend>{index + 1}. {question.prompt}</legend>{question.options.map((option, optionIndex) => <label key={option}><input type="radio" name={`cube-${lesson.id}-${index}`} checked={answers[index] === optionIndex} onChange={() => setAnswers((old) => old.map((value, i) => i === index ? optionIndex : value))} /> {option}</label>)}</fieldset>)}<button type="button" disabled={busy || answers.some((value) => value === null)} onClick={() => onAnswer(answers)}>Check my answers</button></section>;
}

export default function RubiksCubeProgram({ userId = null, courseId = 'beginner-v1', cubeGrant = null, onExit }) {
  const preview = !userId || !cubeGrant;
  const [data, setData] = useState(null); const [error, setError] = useState(null); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(null); const [show3d, setShow3d] = useState(false); const [showPhysical, setShowPhysical] = useState(false); const [demoCube, setDemoCube] = useState(null); const [demoPlaying, setDemoPlaying] = useState(false); const demoTimer = useRef(null);
  const load = useCallback(async () => {
    const result = preview ? await schoolApi.rubiksCubePreview() : await schoolApi.rubiksCubeOpen({ userId, courseId, grant: cubeGrant });
    if (!result.ok) { setError(preview ? 'The cube preview could not load.' : 'This cube course needs a current assignment.'); return; }
    setData(result.data); setError(null);
  }, [preview, userId, courseId, cubeGrant]);
  useEffect(() => { load(); }, [load]);
  const lesson = data?.lesson; const active = data?.active; const cube = active?.cube || FALLBACK_CUBE;
  useEffect(() => {
    setDemoCube(null); setDemoPlaying(false); clearInterval(demoTimer.current);
    return () => clearInterval(demoTimer.current);
  }, [lesson?.id]);
  const request = async (call) => { setBusy(true); setNotice(null); const result = await call(); setBusy(false); if (!result.ok) { setError(result.data?.error || 'That did not save. Try again.'); return; } setData(result.data); return result.data; };
  const openLesson = (lessonId) => request(() => schoolApi.rubiksCubeOpen({ userId, courseId, grant: cubeGrant, lessonId }));
  const turn = (move) => request(() => schoolApi.rubiksCubeTurn({ userId, courseId, grant: cubeGrant, lessonId: lesson.id, move, expectedRevision: active.revision }));
  const hint = async () => { const next = await request(() => schoolApi.rubiksCubeHint({ userId, courseId, grant: cubeGrant, lessonId: lesson.id })); if (next?.hint) setNotice(next.hint.text); };
  const answer = async (answers) => { const next = await request(() => schoolApi.rubiksCubeAnswer({ userId, courseId, grant: cubeGrant, lessonId: lesson.id, answers })); if (next?.quiz) setNotice(next.quiz.passed ? `Passed — ${next.quiz.percent}%` : `${next.quiz.percent}% — try again for 80%.`); };
  const completeDemo = () => request(() => schoolApi.rubiksCubeDemo({ userId, courseId, grant: cubeGrant, lessonId: lesson.id }));
  const restart = () => request(() => schoolApi.rubiksCubeRestart({ userId, courseId, grant: cubeGrant, lessonId: lesson.id }));
  const importPhysical = (faces) => request(() => schoolApi.rubiksCubePhysicalImport({ userId, courseId, grant: cubeGrant, faces }));
  const startPhysicalCoach = () => request(() => schoolApi.rubiksCubePhysicalCoach({ userId, courseId, grant: cubeGrant, lessonId: lesson.id }));
  const advancePhysicalCoach = () => request(() => schoolApi.rubiksCubePhysicalCoachAdvance({ userId, courseId, grant: cubeGrant }));
  const verifyPhysical = (faces) => request(() => schoolApi.rubiksCubePhysicalVerify({ userId, courseId, grant: cubeGrant, lessonId: lesson.id, faces }));
  const makePacket = () => request(() => schoolApi.rubiksCubePacket({ userId, courseId, grant: cubeGrant, lessonId: lesson.id }));
  const verifyPacket = (faces) => request(() => schoolApi.rubiksCubePacketVerify({ userId, courseId, grant: cubeGrant, packetId: data.packet?.id, faces }));
  const replayDemo = () => {
    if (!lesson?.moves?.length) return;
    clearInterval(demoTimer.current); setDemoPlaying(true); let displayed = FALLBACK_CUBE; let index = 0; setDemoCube(displayed);
    demoTimer.current = setInterval(() => {
      displayed = applyMove(displayed, lesson.moves[index]); setDemoCube(displayed); index += 1;
      if (index >= lesson.moves.length) { clearInterval(demoTimer.current); setDemoPlaying(false); }
    }, 550);
  };
  const demoMoves = useMemo(() => lesson?.moves?.join(' · ') || null, [lesson]);
  const diagramSvg = lesson ? cubeDiagramSvg(lesson.kind === 'demo' && demoCube ? demoCube : cube, { title: `${lesson.title} cube diagram`, monochrome: false }) : null;
  if (error) return <section className="rubiks-cube rubiks-cube--error"><p>{error}</p><button type="button" onClick={load}>Try again</button></section>;
  if (!data || !lesson) return <section className="rubiks-cube">Loading cube course…</section>;
  const displayedCube = lesson.kind === 'demo' && demoCube ? demoCube : cube;
  const currentLesson = data.course.units?.flatMap((unit) => unit.lessons).find((item) => item.id === lesson.id);
  return <section className="rubiks-cube"><header className="rubiks-cube__header"><div><p>Rubik’s Cube Foundations {preview && '· Preview'}</p><h2>{lesson.title}</h2><p>{lesson.prompt}</p>{!preview && <p className="rubiks-cube__progress">{data.progress?.completed ?? 0} of {data.progress?.total ?? 0} activities complete{currentLesson?.bestSeconds !== null && currentLesson?.bestSeconds !== undefined ? ` · best ${currentLesson.bestSeconds}s` : ''}</p>}</div><div>{!preview && <button type="button" onClick={() => setShowPhysical((value) => !value)}>{showPhysical ? 'Hide' : 'My physical cube'}</button>}{onExit && <button type="button" onClick={onExit}>Done</button>}</div></header>
    {showPhysical && !preview && <PhysicalCubeCoach physical={data.physical} packet={data.packet} busy={busy} lesson={lesson} onImport={importPhysical} onPacket={makePacket} onCoach={startPhysicalCoach} onAdvance={advancePhysicalCoach} onVerify={verifyPacket} />}
    {!preview && <nav className="rubiks-cube__units" aria-label="Course units">{data.course.units.map((unit) => <div key={unit.id}><b>{unit.title}</b>{unit.lessons.map((item) => <button type="button" key={item.id} disabled={!item.unlocked || busy} className={item.id === lesson.id ? 'is-current' : ''} onClick={() => openLesson(item.id)}>{item.completed ? '✓ ' : ''}{item.title}</button>)}</div>)}</nav>}
    <main className="rubiks-cube__activity"><div><CubeNet cube={displayedCube} onMove={turn} disabled={preview || busy || ['demo', 'quiz'].includes(lesson.kind)} /><div className="rubiks-cube__diagram" dangerouslySetInnerHTML={{ __html: diagramSvg }} /><button type="button" className="rubiks-cube__view-toggle" onClick={() => setShow3d((value) => !value)}>{show3d ? 'Hide' : 'Show'} 3-D view</button>{show3d && <CubePerspective cube={displayedCube} />}</div>
      {lesson.kind === 'demo' && <div className="rubiks-cube__card"><p>Watch the pattern: <strong>{demoMoves}</strong></p><p>The cube above plays the exact sequence. Replay it as often as you want, then continue when the idea makes sense.</p><button type="button" disabled={demoPlaying} onClick={replayDemo}>{demoPlaying ? 'Playing…' : 'Replay demonstration'}</button>{preview ? <p className="rubiks-cube__preview-note">Sign in with an assignment to save your progress and unlock the full course.</p> : <button type="button" disabled={busy} onClick={completeDemo}>I understand — continue</button>}</div>}
      {lesson.kind === 'quiz' && <Quiz lesson={lesson} onAnswer={answer} busy={busy || preview} />}
      {['lesson', 'challenge'].includes(lesson.kind) && <div className="rubiks-cube__card"><p>{lesson.kind === 'challenge' ? 'Solve the whole cube. Correctness matters more than speed.' : 'Return every face to one colour. Any legal solution counts.'}</p><p>Moves: {active.moves?.length ?? 0}{active.hints ? ` · hints used: ${active.hints}` : ''}</p><button type="button" disabled={busy} onClick={hint}>Need a hint</button><button type="button" disabled={busy} onClick={restart}>Start over</button></div>}
      {notice && <p className="rubiks-cube__notice" role="status">{notice}</p>}
    </main>
  </section>;
}
