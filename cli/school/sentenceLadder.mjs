#!/usr/bin/env node
/**
 * cli/school/sentenceLadder.mjs — `school sentence-ladder` — sentence-ladder
 * operations.
 *
 *   trace   one learner's sittings on a day, from the log store: per sentence
 *           and rung, the pieces and their spans, every take with how much of
 *           it was voice, every playback, time sat on a review, restarts and
 *           what drove them, stalls — and a summary per sentence.
 *
 * A composition root: fetching and un-flattening here, every rule of how a
 * sitting reads in `#domains/school/language/trace.mjs` (pure).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatSentenceTrace } from '#domains/school/language/index.mjs';
import {
  DEFAULT_LOGSTORE, LOG_QUERY_LIMIT, addDaysIso, parseLogLines, quoteLogsqlValue, todayIso, unflattenRow,
} from './logStore.mjs';

const ENTRYPOINT = fileURLToPath(import.meta.url);
const HELP = `school sentence-ladder — sentence-ladder operations

Usage:
  school.mjs sentence-ladder trace --learner <id> [--day YYYY-MM-DD] [--corpus <id>]

trace reads $DAYLIGHT_LOGSTORE (default ${DEFAULT_LOGSTORE}) for that learner's
school.language.* events on --day (default: today) and prints each sitting
(one program run = one trace): a header, then per sentence and rung the
timeline — cuts with every piece's span, takes with voiced/silent/trailing
silence, playbacks (sentence, span, take, compare) with how they ended, idle
time on a review, restarts/redos with the key or touch that drove them
([via · phase]), silent warnings, stalls — and a summary line. Events are
ordered by traceSeq, never by _time. Only info and above reach the store.
`;

function option(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

/** The day plus the next — the store's _time is local time labelled UTC, so a
 *  tight window loses events near midnight. */
const timeWindow = (day) => `_time:[${day}T00:00:00, ${addDaysIso(day, 2)}T00:00:00]`;

function traceQuery({ learnerId, corpus, day }) {
  const parts = ['_msg:~"school.language"', `data.learnerId:${quoteLogsqlValue(learnerId)}`];
  if (corpus) parts.push(`data.corpus:${quoteLogsqlValue(corpus)}`);
  parts.push(timeWindow(day));
  return parts.join(' AND ');
}

async function trace(argv, io, fetchImpl = globalThis.fetch) {
  const learnerId = option(argv, '--learner');
  if (!learnerId) throw new Error('--learner is required');
  const day = option(argv, '--day') ?? todayIso();
  const corpus = option(argv, '--corpus');

  let rows;
  try {
    const res = await fetchImpl(`${DEFAULT_LOGSTORE.replace(/\/$/, '')}/select/logsql/query`, {
      method: 'POST',
      body: new URLSearchParams({ query: traceQuery({ learnerId, corpus, day }), limit: String(LOG_QUERY_LIMIT) }),
    });
    if (!res?.ok) throw new Error(`HTTP ${res?.status ?? '?'}`);
    rows = parseLogLines(await res.text());
  } catch (error) {
    io.stderr.write(`log store unreachable at ${DEFAULT_LOGSTORE} (${error.message}) — no trace\n`);
    return 1;
  }
  if (rows.length === LOG_QUERY_LIMIT) {
    io.stderr.write(`warning: the log store returned ${LOG_QUERY_LIMIT} rows (the query limit) — results may be truncated; narrow with --corpus\n`);
  }
  const output = formatSentenceTrace(rows.map(unflattenRow));
  if (!output) {
    io.stderr.write(`no sentence-ladder events for ${learnerId} on ${day}${corpus ? ` in ${corpus}` : ''}\n`);
    return 1;
  }
  io.stdout.write(`${output}\n`);
  return 0;
}

export async function main(argv = process.argv.slice(2), io = process, deps = {}) {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') { io.stdout.write(HELP); return command ? 0 : 2; }
  try {
    if (command === 'trace') return await trace(rest, io, deps.fetch ?? globalThis.fetch);
    io.stderr.write(HELP);
    return 2;
  } catch (error) {
    io.stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === ENTRYPOINT) {
  main().then((code) => { process.exitCode = code; });
}
