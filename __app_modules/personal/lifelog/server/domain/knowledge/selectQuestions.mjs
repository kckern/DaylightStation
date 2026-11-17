/** Code selects questions; source/model ordering never determines what is asked. */
import { objectsOf, REPLY_WINDOW_MS } from './contracts.mjs';
import { daysBetween, localDateFor } from './calendar.mjs';
import { deliveredAsks, unansweredAsks } from './sweepKnowledge.mjs';
import { buildQuestion } from './questionForms.mjs';
export function scoreLoop({ stakes = 1, overdueDays = 0, evidenceMoved = false, unansweredAsks: ignored = 0 }) {
  return stakes * 3 + Math.min(7, Math.max(0, overdueDays)) + (evidenceMoved ? 2 : 0) - ignored * 2;
}
function linkedLoopConcerns(snapshot) {
  const loops=objectsOf(snapshot).filter(object=>object.kind==='loop');
  const parents=new Map(loops.map(object=>[object.id,object.id]));
  const find=id=>{
    const visited=[];let current=id;
    while(parents.get(current)!==current){visited.push(current);current=parents.get(current);}
    for(const item of visited)parents.set(item,current);
    return current;
  };
  for(const object of loops)for(const link of object.links??[])if(parents.has(link)) {
    const roots=[find(object.id),find(link)].sort();parents.set(roots[1],roots[0]);
  }
  return id=>find(id);
}
export function selectQuestions({ snapshot, askDate, asOf, timezone, max = 2 }) {
  localDateFor(asOf, timezone);
  const health = snapshot.health ?? {};
  if (!health.available || health.conflicted || health.recovering || !Number.isFinite(health.lastSweepAt) || health.lastSweepAt > asOf || asOf - health.lastSweepAt > REPLY_WINDOW_MS) return { questions: [], quizCandidates: [], reason: 'unavailable' };
  const concernFor=linkedLoopConcerns(snapshot);
  const asks = deliveredAsks(snapshot); const candidates = [];
  for (const object of objectsOf(snapshot)) {
    if (object.kind !== 'loop' || !['open','waiting'].includes(object.status) || !['normal','user_initiated'].includes(object.ask_policy)) continue;
    const policy = object.loop?.ask ?? {};
    const eligible = policy.eligible_from ?? object.loop?.due;
    if ((eligible && askDate < eligible) || (object.loop?.due && askDate <= object.loop.due) || (policy.deferred_until && askDate < policy.deferred_until)) continue;
    const mine = asks.filter(a => a.objectId === object.id && (policy.reopenedAt == null || a.deliveredAt > policy.reopenedAt));
    const ignored = unansweredAsks(snapshot, object.id, asOf, policy.reopenedAt).length;
    if (ignored >= (policy.max_asks ?? 2) || mine.filter(a => a.response?.action === 'skip').length >= 2) continue;
    const lastAskDate = mine.map(a => a.askDate).filter(Boolean).sort().at(-1);
    if (lastAskDate && daysBetween(lastAskDate,askDate) < Math.max(3,policy.cooldown_days ?? 7)) continue;
    const question = buildQuestion({ object }); if (!question) continue;
    const moved = object.evidence?.some(e => !e.retracted && e.source === 'user' && e.date === object.touched && mine.length && (e.at ?? 0) > Math.max(...mine.map(a => a.deliveredAt))) ?? false;
    candidates.push({ object, question, score: scoreLoop({stakes:object.loop?.stakes ?? 1, overdueDays: object.loop?.due ? daysBetween(object.loop.due,askDate) : 0, evidenceMoved:moved,unansweredAsks:ignored}) });
  }
  candidates.sort((a,b) => b.score-a.score || (a.object.loop.due ?? '9999').localeCompare(b.object.loop.due ?? '9999') || a.object.touched.localeCompare(b.object.touched) || a.object.id.localeCompare(b.object.id));
  const questions = []; const concerns = new Set(); let sensitive = false;
  const backoff = snapshot.state?.backoff;
  const inBackoff = backoff?.until > askDate;
  const weekend = [0,6].includes(new Date(askDate+'T12:00:00Z').getUTCDay());
  const limit = inBackoff ? (weekend ? Math.min(1,max) : 0) : Math.min(2,max);
  for (const c of candidates) {
    if (questions.length >= limit || c.object.ask_policy === 'user_initiated') continue;
    const linked = [concernFor(c.object.id),...(c.object.links ?? []).filter(id => id.startsWith('concern.'))];
    if (linked.some(id => concerns.has(id)) || (sensitive && c.object.sensitivity !== 'normal')) continue;
    questions.push(c.question); linked.forEach(id => concerns.add(id)); sensitive ||= c.object.sensitivity !== 'normal';
  }
  const chosen = new Set(questions.map(q => q.objectId));
  const quizCandidates = candidates.filter(c => !chosen.has(c.object.id)).filter(c => {
    const queued = (snapshot.quiz ?? []).find(q => q.objectId === c.object.id);
    return !queued || asOf - queued.enqueuedAt < 7*86400000 || c.object.touched > (queued.evidenceDate ?? c.object.touched);
  }).slice(0,5).map(c => c.question);
  return { questions, quizCandidates, reason: questions.length || quizCandidates.length ? 'selected' : 'empty' };
}

export function experimentArm({ activationDate, askDate, days = 14 }) {
  const elapsed = daysBetween(activationDate,askDate);
  if (Number.isFinite(elapsed) && elapsed < 0) return 'legacy';
  return Number.isFinite(elapsed) && elapsed < days && Number(askDate.slice(-2)) % 2 === 0 ? 'legacy' : 'knowledge';
}
