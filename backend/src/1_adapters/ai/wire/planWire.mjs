import { encode } from '@toon-format/toon';
import { findJsonBlocks } from './jsonBlocks.mjs';
import { isEncodableData, isTable, templateShape } from './shapes.mjs';
import { buildReplySkeleton, rewriteCueLine, stripFormatSentences, TOON_REPLY_RULES } from './replyFormat.mjs';

/** The nearest non-blank text before a block reads like an instruction about the reply's format. */
const REPLY_CUE = /\b(?:respond|reply|return|answer|output)\b.*\b(?:json|exactly as)\b/i;

/** The nearest non-blank line (or same-line prefix) before `index`, with its span. */
function cueLineBefore(text, index) {
  let end = index;
  while (end > 0) {
    const start = text.lastIndexOf('\n', end - 1) + 1;
    const line = text.slice(start, end);
    if (line.trim()) return { start, end, line };
    if (start === 0) return null;
    end = start - 1;
  }
  return null;
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
