import { encode } from '@toon-format/toon';
import { findJsonBlocks } from './jsonBlocks.mjs';
import { isEncodableData, isTable, templateShape } from './shapes.mjs';
import { buildReplySkeleton, rewriteCueLine, stripFormatSentences, TOON_REPLY_RULES } from './replyFormat.mjs';

/**
 * The nearest non-blank text before a block is an IMPERATIVE about the reply's
 * format: a verb that starts the line, a sentence (after `.` `:` `!` `?`) or a
 * bullet/number, then `in`/`with`/`as` … `JSON` within the sentence, or `JSON`
 * directly ("Return JSON:"), or `respond|reply exactly as`. Noun uses such as
 * "the previous reply as JSON:" are not cues.
 */
const REPLY_CUE = /(?:^\s*(?:(?:[-*•]|\d+[.)])\s+)?|[.:!?]\s+)(?:(?:respond|reply|return|answer|output)\b(?:[^\n.!?]*?\b(?:in|with|as)\s+(?:[^\n.!?]*?\s)?|\s+)json\b|(?:respond|reply)\s+exactly\s+as\b)/i;

/**
 * The cue for a block: its same-line prefix, else the line directly above.
 * A blank line ends the paragraph, so a cue from an earlier paragraph is no cue.
 */
function cueLineBefore(text, index) {
  const start = text.lastIndexOf('\n', index - 1) + 1;
  const prefix = text.slice(start, index);
  if (prefix.trim()) return { start, end: index, line: prefix };
  if (start === 0) return null;
  const prevEnd = start - 1;
  const prevStart = text.lastIndexOf('\n', prevEnd - 1) + 1;
  const line = text.slice(prevStart, prevEnd);
  return line.trim() ? { start: prevStart, end: prevEnd, line } : null;
}

function applyEdits(text, edits) {
  return [...edits].sort((a, b) => b.start - a.start)
    .reduce((out, edit) => out.slice(0, edit.start) + edit.text + out.slice(edit.end), text);
}

const rowCount = (value) => (Array.isArray(value)
  ? value.length
  : Object.values(value).filter((v) => isTable(v, 2)).reduce((n, v) => n + v.length, 0));

/**
 * Decide, for one call, what to re-encode as TOON. Pure: never mutates the
 * caller's messages; returns the same array when nothing changes.
 * @param {Array} messages
 * @param {{reply?: boolean}} opts - reply: rewrite an eligible reply template to TOON
 */
export function planWire(messages, { reply = false } = {}) {
  const untouched = (skip) => ({ messages, shape: null, toonReply: false, replyEligible: false, rewrites: [], skip });
  if (!Array.isArray(messages)) return untouched('no-messages');

  const found = messages.map((message) => {
    const templates = [];
    const data = [];
    if (typeof message?.content !== 'string') return { templates, data };
    for (const block of findJsonBlocks(message.content)) {
      const cue = cueLineBefore(message.content, block.start);
      if (cue && REPLY_CUE.test(cue.line)) templates.push({ ...block, cue });
      else if (isEncodableData(block.value)) data.push(block);
    }
    return { templates, data };
  });

  const templates = found.flatMap((f, index) => f.templates.map((t) => ({ ...t, messageIndex: index })));
  if (templates.length > 1) return untouched('ambiguous');
  const template = templates[0] ?? null;
  const shape = template ? templateShape(template.value) : null;
  if (template && shape === null) return untouched('ambiguous');
  // A data block sharing the cue's span would collide with the cue edit.
  if (template && found[template.messageIndex].data
    .some((block) => block.start < template.cue.end && block.end > template.cue.start)) {
    return untouched('ambiguous');
  }

  const replyEligible = shape?.kind === 'table';
  const toonReply = replyEligible && reply;
  const rewrites = [];

  const out = messages.map((message, index) => {
    const edits = found[index].data.map((block) => {
      rewrites.push({ kind: 'input', rows: rowCount(block.value) });
      return { start: block.start, end: block.end, text: encode(block.value, { delimiter: '\t' }) };
    });
    const ownsTemplate = toonReply && template.messageIndex === index;
    if (ownsTemplate) {
      edits.push({ start: template.start, end: template.end, text: buildReplySkeleton(template.value, shape) });
      edits.push({ start: template.cue.start, end: template.cue.end, text: rewriteCueLine(template.cue.line) });
      rewrites.push({ kind: 'template', columns: shape.columns.length });
    }
    if (!edits.length) return message;
    let content = applyEdits(message.content, edits);
    if (ownsTemplate) content = `${stripFormatSentences(content).trimEnd()}\n\n${TOON_REPLY_RULES}`;
    return { ...message, content };
  });

  let skip = null;
  if (!rewrites.length) skip = !template ? 'no-cue' : shape.kind === 'flat' ? 'flat-object' : null;
  return { messages: rewrites.length ? out : messages, shape: toonReply ? shape : null, toonReply, replyEligible, rewrites, skip };
}
