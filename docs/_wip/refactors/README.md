# Refactors

Structural work on code that already exists and already works: moving ownership,
redrawing boundaries, extracting modules, changing how things are wired.

## Why this is its own folder

A refactor is not a plan, an audit, or a bug, but it generates all three — and
without a home of its own the pieces scatter. The application-module work is the
example that prompted this folder: five planning documents in `../plans/`, two
evidence directories in `../audits/`, a roadmap in `../../roadmap/`, and a
tooling tree under `../../../tests/`, with nothing anywhere naming the whole
thing or saying what state it was in. Answering "is this refactor live, and
where does it stand" meant knowing all seven locations already.

## What goes here

One file per refactor initiative, `YYYY-MM-DD-topic.md`, dated by when the work
started. Each one is an **index and status page**, not a copy: it says what the
refactor is, what has actually happened, and where every artifact lives. The
plans stay in `../plans/`, the evidence stays in `../audits/` — they are linked
from here, not moved.

That split is deliberate. The material carries hundreds of relative links to
`backend/`, `tests/` and each other; relocating it would break them wholesale
for a tidier tree, which is a bad trade. A refactor page is cheap, and it is the
thing that was actually missing.

## What a page must answer

Someone arriving cold, or returning after two months, needs these in this order:

1. **Is this live?** Proposed, in progress, paused, landed, or abandoned.
2. **What has actually changed in the codebase?** Distinct from what has been
   designed. A refactor that has moved no code should say so in its first lines.
3. **Where is everything?** Every plan, packet and tool, linked.
4. **What is the next action, and what authorizes it?**

Keep the page current when the state changes. A stale status line on a refactor
page is worse than no page, because it will be believed.

## Moving on

When a refactor lands, move its page to `../../_archive/` with the outcome
recorded. When it is abandoned, do the same and say why — an abandoned refactor
is a decision worth keeping, and the next person to propose it deserves to find
the reasoning rather than repeat it.
