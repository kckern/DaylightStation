#!/usr/bin/env node
/**
 * `school` — the single entrypoint for every School command line tool.
 *
 * Each namespace below is a thin dispatch to a module in `cli/school/`, and
 * every one of those modules exports the same `main(argv) -> exitCode`
 * contract. This file adds no policy: it routes, prints help, and exits.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THERE ARE TWO PIPELINES. PICKING THE WRONG ONE IS THE CLASSIC MISTAKE.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. WORKSHEET pipeline — `school worksheet …`
 *
 *    A course lesson's question bank becomes a per-learner worksheet.
 *
 *      content/school/<subject>/<course>/units/<unit>/lessons/<lesson>/
 *        worksheet.yml            school.question-bank/v2
 *                ↓  issueWorksheet()  (#domains/school/questionBankV2.mjs)
 *        a worksheet instance — items chosen and choices SHUFFLED for one
 *        learner at one profile (`lower` 6 questions / 3-4 choices,
 *        `upper` 10 questions / 5 choices + 1-2 multi-select)
 *                ↓  worksheetInstanceDocument()
 *        a print document whose choices render INLINE ("A. A pure heart")
 *
 *    This is what the atlas and every real course use. Answer position is
 *    never authored — the generator shuffles it. Use this for coursework.
 *
 * 2. DOCUMENT pipeline — `school docs …`
 *
 *    A hand-authored document CLASS becomes a published, printable artifact.
 *
 *      content/school/learning-catalog/documents/…  school.document-source/v1
 *                ↓  publish   →  published/ + derived-banks/
 *                ↓  render    →  PDF (+ optional physical card allocation)
 *
 *    Use this for one-off documents and for card allocation/reprint. It is
 *    NOT the way to print a course lesson.
 *
 * On paper, answers ALWAYS ride a separate physical OMR card. A sheet
 * rendered with a card attached prints a `Student No.` box and no on-page
 * bubbles; a hand-graded sheet is marked by circling the printed choice.
 *
 * Usage:  node cli/school.mjs <namespace> <command> [options]
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NAMESPACES = {
  worksheet: {
    module: './school/worksheet.mjs',
    blurb: 'issue and render a course lesson worksheet (the coursework path)',
  },
  sim: {
    module: './school/sim.mjs',
    blurb: 'end-to-end lifecycle proof for any course — writes nothing real',
  },
  docs: {
    module: './school/docs.mjs',
    blurb: 'authored print documents: validate, publish, render, cards, reprint',
  },
  catalog: {
    module: './school/catalog.mjs',
    blurb: 'validate the published curriculum catalog (the promotion gate)',
  },
  certify: {
    module: './school/certify.mjs',
    blurb: 'certify published content against every surface profile',
  },
  calc: {
    module: './school/calc.mjs',
    blurb: 'validate the SchoolCalc (TI-86) content mount',
  },
  learner: {
    module: './school/learner.mjs',
    blurb: 'admin: rekey a learner id across both school data roots',
  },
  omr: {
    module: './school/omr.mjs',
    blurb: 'rebuild decoded quiz day files from the raw OMR manifest',
  },
};

const HELP = `school — School command line tools

Usage:
  node cli/school.mjs <namespace> <command> [options]

Namespaces:
${Object.entries(NAMESPACES).map(([name, { blurb }]) => `  ${name.padEnd(10)} ${blurb}`).join('\n')}

Two pipelines — pick deliberately:

  COURSEWORK        school worksheet issue <lesson> --profile lower|upper
                    Reads a lesson's school.question-bank/v2, picks and
                    SHUFFLES choices for one learner, renders inline choices.
                    This is what course lessons use.

  AUTHORED DOCS     school docs publish <file> && school docs render <file>
                    Compiles a school.document-source/v1 class into a
                    published artifact. Also owns card allocation and
                    reprint. Not the way to print a course lesson.

  SIMULATION       school sim --subject <s> --course <c> --lower <learner>
                    Runs the whole workflow — agenda, issue, render, card
                    scan, grade, remediation — against a throwaway state
                    directory it deletes afterwards. Card ids and student
                    numbers it mints are simulation-only and will NOT scan on
                    real hardware; nothing is written to the household tree.

Answers always ride a separate physical OMR card; sheets never print
fillable bubbles.

Run a namespace with --help for its own commands:
  node cli/school.mjs docs --help
`;

export async function main(argv = process.argv.slice(2)) {
  const [namespace, ...rest] = argv;

  if (!namespace || namespace === '--help' || namespace === '-h' || namespace === 'help') {
    process.stdout.write(HELP);
    return namespace ? 0 : 2;
  }

  const entry = NAMESPACES[namespace];
  if (!entry) {
    process.stderr.write(`Unknown namespace: ${namespace}\n\n`);
    process.stdout.write(HELP);
    return 2;
  }

  const mod = await import(entry.module);
  if (typeof mod.main !== 'function') {
    process.stderr.write(`${namespace}: module does not export main(argv)\n`);
    return 1;
  }
  const code = await mod.main(rest);
  return typeof code === 'number' ? code : 0;
}

const ENTRYPOINT = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === ENTRYPOINT) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`${err.stack || err.message}\n`);
      process.exit(1);
    });
}
