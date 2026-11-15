/** Deterministic question vocabulary. There is no generative fallback here. */
const TEMPLATES = { status: title => 'Did you finish: ' + title + '?', outcome: title => 'How did ' + title + ' go?', confirm: title => 'Is this right: ' + title + '?' };
const BANNED = /\b(why|feel|feeling|motive|what drove|what does that say|hoping|should you)\b|\beither\b|\bor\b/i;
export function lintQuestion({ text, form, subjectKind }) {
  const valid = Object.hasOwn(TEMPLATES, form) && ['loop','event','person'].includes(subjectKind) && typeof text === 'string' && text.length <= 300 && text.endsWith('?') && (text.match(/\?/g) ?? []).length === 1 && !BANNED.test(text) && !/[\r\n]/.test(text);
  return { valid, reason: valid ? null : 'unsupported_question' };
}
export function buildQuestion({ object, form = object?.loop?.kind_of ?? 'status' }) {
  if (object?.kind !== 'loop' || !Object.hasOwn(TEMPLATES, form)) return null;
  const question = { id: object.id + ':' + form, objectId: object.id, form, subjectKind: object.kind, text: TEMPLATES[form](object.title),
    choices: [{text:'Yes',action:'yes'},{text:'Not yet',action:'not_yet'},{text:'Drop it',action:'drop'}] };
  return lintQuestion(question).valid ? question : null;
}
