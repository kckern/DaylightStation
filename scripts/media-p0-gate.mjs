#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACCEPTED_STORIES,
  SUPPORTING_ACCEPTED_CRITERIA,
  validateReport,
} from './media-stable-core-gate.mjs';
import { groupedJourneys, playwrightExecute, runGroups } from './media-gate-runner.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const P0_EXTENSION_ENTRIES = Object.freeze([
  {
    story: 'PLACE.8a',
    criteria: ['PLACE.8a/AC1'],
    file: 'media-app-handoff-picker.runtime.test.mjs',
    grep: 'NowPlaying hand-off shows truthful aim plus explicit move/keep choices',
  },
  {
    story: 'STEER.1a',
    criteria: ['STEER.1a/AC2', 'STEER.1a/AC3'],
    file: 'media-app-handoff-picker.runtime.test.mjs',
    grep: 'NowPlaying hand-off shows truthful aim plus explicit move/keep choices',
  },
  {
    story: 'STEER.6a',
    criteria: ['STEER.6a/AC3'],
    file: 'media-app-stop-flow.runtime.test.mjs',
    grep: 'Stop keeps the queue reachable and separates Clear',
  },
  {
    story: 'RELY.4a',
    criteria: ['RELY.4a/AC1', 'RELY.4a/AC2'],
    file: 'media-app-queue-journey.runtime.test.mjs',
    // Both journeys: Undo restores the paused position and queue (AC1/AC2), and the offer lasts 10 s then goes (AC1).
    grep: 'RELY\\.4a/AC1',
  },
  {
    story: 'PLAY.6a',
    criteria: ['PLAY.6a/AC3'],
    file: 'media-app-remote-controls.runtime.test.mjs',
    grep: 'Add preserves playback and reports its position before Peek Next and Previous traverse the receiver queue',
  },
  {
    story: 'FIND.3a',
    criteria: ['FIND.3a/AC3'],
    file: 'media-app-search-states.runtime.test.mjs',
    grep: 'a failed source is named before a truthful widened result',
  },
  {
    story: 'FIND.4a',
    criteria: ['FIND.4a/AC2'],
    file: 'media-app-search-states.runtime.test.mjs',
    grep: 'a failed source is named before a truthful widened result',
  },
  {
    story: 'FIND.5a',
    criteria: ['FIND.5a/AC2'],
    file: 'media-app-browse-breadcrumb.runtime.test.mjs',
    grep: 'browse shows pictures, natural order, every parent, and collection actions',
  },
  {
    story: 'FIND.5a',
    criteria: ['FIND.5a/AC3'],
    file: 'media-app-browse-breadcrumb.runtime.test.mjs',
    grep: 'scrolling to the end loads the next page without a button hunt',
  },
  {
    story: 'FIND.5a',
    criteria: ['FIND.5a/AC4'],
    file: 'media-app-browse-breadcrumb.runtime.test.mjs',
    grep: 'browser Back restores the exact browse scroll and focused collection',
  },
  {
    story: 'FIND.6a',
    criteria: ['FIND.6a/AC1', 'FIND.6a/AC2', 'FIND.6a/AC3'],
    file: 'media-app-browse-breadcrumb.runtime.test.mjs',
    grep: 'browse shows pictures, natural order, every parent, and collection actions',
  },
  {
    story: 'HOUSE.2a',
    criteria: ['HOUSE.2a/AC3'],
    file: 'media-app-browser-control.runtime.test.mjs',
    grep: 'stable browser identities route a queue command through the actual receiver and return its ack',
  },
  {
    story: 'HOUSE.3a',
    criteria: ['HOUSE.3a/AC1', 'HOUSE.3a/AC3'],
    file: 'media-app-house-browser-session.runtime.test.mjs',
    grep: 'two browser devices agree on the local player title and state',
  },
  {
    story: 'HOUSE.4a',
    criteria: ['HOUSE.4a/AC2', 'HOUSE.4a/AC4'],
    file: 'media-app-browser-control.runtime.test.mjs',
    grep: 'stable browser identities route a queue command through the actual receiver and return its ack',
  },
  {
    story: 'AUTO.3a',
    criteria: ['AUTO.3a/AC1'],
    file: 'media-app-browser-control.runtime.test.mjs',
    grep: 'stable browser identities route a queue command through the actual receiver and return its ack',
  },
  {
    story: 'AUTO.3a',
    criteria: ['AUTO.3a/AC2'],
    file: 'media-app-house-browser-session.runtime.test.mjs',
    grep: 'two browser devices agree on the local player title and state',
  },  // Task 7 — outcomes, retry, paused restore, Start fresh. Only criteria with
  // exact runtime evidence; see the acceptance ledger for the rest.
  {
    story: 'RELY.3a',
    criteria: ['RELY.3a/AC1', 'RELY.3a/AC2', 'RELY.3a/AC3', 'RELY.3a/AC4'],
    file: 'media-app-outcomes.runtime.test.mjs',
    grep: 'RELY\\.3a',
  },
  {
    story: 'RELY.6a',
    criteria: ['RELY.6a/AC1'],
    file: 'media-app-outcomes.runtime.test.mjs',
    grep: 'RELY\\.3a',
  },
  {
    story: 'RELY.2a',
    criteria: ['RELY.2a/AC2'],
    file: 'media-app-outcomes.runtime.test.mjs',
    grep: 'RELY\\.2a',
  },
  {
    story: 'RELY.5a',
    criteria: ['RELY.5a/AC1', 'RELY.5a/AC2', 'RELY.5a/AC3'],
    file: 'media-app-local-failure.runtime.test.mjs',
    grep: 'RELY\\.5a',
  },
  {
    story: 'RELY.7a',
    criteria: ['RELY.7a/AC1', 'RELY.7a/AC5'],
    file: 'media-app-resume.runtime.test.mjs',
    grep: 'RELY\\.7a',
  },
  {
    story: 'RELY.7a',
    criteria: ['RELY.7a/AC2'],
    file: 'media-app-aim-journey.runtime.test.mjs',
    grep: 'a closed app restores',
  },
  {
    story: 'RELY.8a',
    criteria: ['RELY.8a/AC1', 'RELY.8a/AC2', 'RELY.8a/AC3'],
    file: 'media-app-reset-confirm.runtime.test.mjs',
    grep: 'RELY\\.8a',
  },  // Media P1/P2 batch C — house view, naming, admin, routines. Only criteria
  // the house-view journey proves at runtime; see the acceptance ledger.
  {
    story: 'HOUSE.2a',
    criteria: ['HOUSE.2a/AC5', 'HOUSE.2a/AC6'],
    file: 'media-app-house-view.runtime.test.mjs',
    grep: 'STEER\\.11a',
  },
  {
    story: 'HOUSE.5a',
    criteria: ['HOUSE.5a/AC1'],
    file: 'media-app-house-view.runtime.test.mjs',
    grep: 'STEER\\.11a',
  },
  {
    story: 'PLAY.10a',
    criteria: ['PLAY.10a/AC3', 'PLAY.10a/AC4'],
    file: 'media-app-house-view.runtime.test.mjs',
    grep: 'STEER\\.11a',
  },
  {
    story: 'STEER.11a',
    criteria: ['STEER.11a/AC1', 'STEER.11a/AC2'],
    file: 'media-app-house-view.runtime.test.mjs',
    grep: 'STEER\\.11a',
  },
  {
    story: 'RELY.14a',
    criteria: ['RELY.14a/AC1', 'RELY.14a/AC2'],
    file: 'media-app-house-view.runtime.test.mjs',
    grep: 'HOUSE\\.4a',
  },
  {
    story: 'HOUSE.4a',
    criteria: ['HOUSE.4a/AC3'],
    file: 'media-app-house-view.runtime.test.mjs',
    grep: 'HOUSE\\.4a',
  },
  {
    story: 'HOUSE.6a',
    criteria: ['HOUSE.6a/AC1', 'HOUSE.6a/AC2', 'HOUSE.6a/AC3'],
    file: 'media-app-house-view.runtime.test.mjs',
    grep: 'HOUSE\\.4a',
  },
  {
    story: 'AUTO.4a',
    criteria: ['AUTO.4a/AC1', 'AUTO.4a/AC2'],
    file: 'media-app-house-view.runtime.test.mjs',
    grep: 'HOUSE\\.4a',
  },
  // Batch B — handle and controls (P1), exact-SHA runtime evidence on two
  // virtual receivers (media-app-handle-controls.runtime.test.mjs).
  {
    story: 'PLAY.10a',
    criteria: ['PLAY.10a/AC1'],
    file: 'media-app-handle-controls.runtime.test.mjs',
    grep: "a screen's Remote has the same session controls",
  },
  {
    story: 'STEER.13a',
    criteria: ['STEER.13a/AC1', 'STEER.13a/AC2'],
    file: 'media-app-handle-controls.runtime.test.mjs',
    grep: "a screen's Remote has the same session controls",
  },
  {
    story: 'STEER.13b',
    criteria: ['STEER.13b/AC2'],
    file: 'media-app-handle-controls.runtime.test.mjs',
    grep: "a screen's Remote has the same session controls",
  },
  {
    story: 'RELY.4b',
    criteria: ['RELY.4b/AC1', 'RELY.4b/AC2', 'RELY.4b/AC3'],
    file: 'media-app-handle-controls.runtime.test.mjs',
    grep: 'RELY\\.4b/STEER\\.1b',
  },
  {
    story: 'STEER.1b',
    criteria: ['STEER.1b/AC5'],
    file: 'media-app-handle-controls.runtime.test.mjs',
    grep: 'RELY\\.4b/STEER\\.1b',
  },
  {
    story: 'PLAY.10a',
    criteria: ['PLAY.10a/AC2'],
    file: 'media-app-handle-controls.runtime.test.mjs',
    grep: 'PLAY\\.10a/AC2',
  },
  {
    story: 'STEER.13b',
    criteria: ['STEER.13b/AC1'],
    file: 'media-app-handle-controls.runtime.test.mjs',
    grep: 'STEER\\.13b/AC1',
  },
  {
    story: 'STEER.1b',
    criteria: ['STEER.1b/AC7'],
    file: 'media-app-handle-controls.runtime.test.mjs',
    grep: 'STEER\\.1b/AC7',
  },
  {
    story: 'PLACE.9a',
    criteria: ['PLACE.9a/AC1', 'PLACE.9a/AC2', 'PLACE.9a/AC3'],
    file: 'media-app-handle-controls.runtime.test.mjs',
    grep: 'PLACE\\.9a',
  },
  {
    story: 'PLACE.4a',
    criteria: ['PLACE.4a/AC1', 'PLACE.4a/AC2', 'PLACE.4a/AC3', 'PLACE.4a/AC4', 'PLACE.4a/AC5', 'PLACE.4a/AC7'],
    file: 'media-app-handle-controls.runtime.test.mjs',
    grep: 'PLACE\\.4a',
  },
  {
    story: 'STEER.10a',
    criteria: ['STEER.10a/AC1', 'STEER.10a/AC3'],
    file: 'media-app-handle-controls.runtime.test.mjs',
    grep: 'this device: sleep at the end',
  },
  {
    story: 'STEER.13a',
    criteria: ['STEER.13a/AC3'],
    file: 'media-app-handle-controls.runtime.test.mjs',
    grep: 'this device: sleep at the end',
  },
  // Batch A (start page + item surfaces, P1). The household routes are
  // answered by the journey's in-test household (the acceptance server blocks
  // household reads/writes); catalog, play and streams are real. Criteria whose
  // substance is a server rule (FIND.7a/AC3, FIND.10a/AC5+AC7, FIND.11a/AC2,
  // FIND.12a/AC3, FIND.13a/AC2) are deliberately not listed.
  {
    story: 'FIND.7a',
    criteria: ['FIND.7a/AC1', 'FIND.7a/AC2'],
    file: 'media-app-household-home.runtime.test.mjs',
    grep: 'household start page',
  },
  {
    story: 'FIND.9a',
    criteria: ['FIND.9a/AC1', 'FIND.9a/AC2', 'FIND.9a/AC3'],
    file: 'media-app-household-home.runtime.test.mjs',
    grep: 'household start page',
  },
  {
    story: 'FIND.10a',
    criteria: ['FIND.10a/AC1', 'FIND.10a/AC2', 'FIND.10a/AC4', 'FIND.10a/AC6'],
    file: 'media-app-household-home.runtime.test.mjs',
    grep: 'household start page',
  },
  {
    story: 'FIND.10a',
    criteria: ['FIND.10a/AC3'],
    file: 'media-app-household-home.runtime.test.mjs',
    grep: 'Now on another screen',
  },
  {
    story: 'FIND.12a',
    criteria: ['FIND.12a/AC1', 'FIND.12a/AC2'],
    file: 'media-app-household-home.runtime.test.mjs',
    grep: 'household start page',
  },
  {
    story: 'FIND.12b',
    criteria: ['FIND.12b/AC1', 'FIND.12b/AC2'],
    file: 'media-app-household-home.runtime.test.mjs',
    grep: 'household start page',
  },
  {
    story: 'FIND.13a',
    criteria: ['FIND.13a/AC1', 'FIND.13a/AC3'],
    file: 'media-app-household-home.runtime.test.mjs',
    grep: 'household start page',
  },
  {
    story: 'FIND.11a',
    criteria: ['FIND.11a/AC1', 'FIND.11a/AC3'],
    file: 'media-app-household-home.runtime.test.mjs',
    grep: 'Played earlier',
  },
  {
    story: 'PLAY.4a',
    criteria: ['PLAY.4a/AC1', 'PLAY.4a/AC2', 'PLAY.4a/AC3'],
    file: 'media-app-household-home.runtime.test.mjs',
    grep: 'saved spots and Start over',
  },
  // Batch D, player features (P2) — exact-SHA runtime evidence on the virtual
  // receiver (subtitles + audio language on a screen; subtitles on this device).
  {
    story: 'STEER.12a',
    criteria: ['STEER.12a/AC1', 'STEER.12a/AC2', 'STEER.12a/AC3'],
    file: 'media-app-player-features.runtime.test.mjs',
    grep: 'STEER\\.12a',
  },
  {
    story: 'PLAY.8a',
    criteria: ['PLAY.8a/AC1', 'PLAY.8a/AC2', 'PLAY.8a/AC3'],
    file: 'media-app-player-features.runtime.test.mjs',
    grep: 'Show briefly \\(PLAY',
  },
  {
    story: 'PLAY.8b',
    criteria: ['PLAY.8b/AC1', 'PLAY.8b/AC2'],
    file: 'media-app-player-features.runtime.test.mjs',
    grep: 'Show briefly \\(PLAY',
  },
  {
    story: 'PLAY.9a',
    criteria: ['PLAY.9a/AC1', 'PLAY.9a/AC2', 'PLAY.9a/AC3'],
    file: 'media-app-player-features.runtime.test.mjs',
    grep: 'PLAY\\.9a',
  },
  // Task 8, accessibility and size parity (phone/tablet/laptop, ordinary input, measured from
  // the live page: computed hit targets, contrast, live regions, layout).
  {
    story: 'RELY.11a',
    criteria: ['RELY.11a/AC1'],
    file: 'media-app-p0-accessibility.runtime.test.mjs',
    grep: 'RELY\\.11a/AC1',
  },
  {
    story: 'RELY.11a',
    criteria: ['RELY.11a/AC2', 'RELY.11a/AC3'],
    file: 'media-app-p0-accessibility.runtime.test.mjs',
    grep: 'RELY\\.11a/AC2',
  },
  {
    story: 'RELY.12a',
    criteria: ['RELY.12a/AC1', 'RELY.12a/AC2'],
    file: 'media-app-p0-accessibility.runtime.test.mjs',
    grep: 'RELY\\.12a',
  },
  {
    story: 'RELY.13a',
    criteria: ['RELY.13a/AC2'],
    file: 'media-app-p0-accessibility.runtime.test.mjs',
    grep: 'RELY\\.13a',
  },
  {
    story: 'RELY.14a',
    criteria: ['RELY.14a/AC3'],
    file: 'media-app-p0-accessibility.runtime.test.mjs',
    grep: 'RELY\\.14a/AC3',
  },
  // Media proof gaps, Phase 2b: journeys on the ordinary-device fixture (scripted screens, controllable search stream, real routines).
  {
    story: 'PLACE.2a',
    criteria: ['PLACE.2a/AC4'],
    file: 'media-app-active-aim.runtime.test.mjs',
    grep: "\\[PLACE\\.2a/AC4\\] sender aim survives two idle hours only |\\[PLACE\\.2a/AC4\\] the aim's two\\-hour idle clock does not r|\\[PLACE\\.2a/AC4\\] the two\\-hour clock stays suspended while",
  },
  {
    story: 'FIND.1a',
    criteria: ['FIND.1a/AC1', 'FIND.1a/AC2', 'FIND.1a/AC3', 'FIND.1a/AC4'],
    file: 'media-app-find-proof.runtime.test.mjs',
    grep: "\\[FIND\\.1a/AC1\\]\\[FIND\\.1a/AC2\\]\\[FIND\\.1a/AC4\\] laptop: search opens from every part of |\\[FIND\\.1a/AC1\\]\\[FIND\\.1a/AC2\\]\\[FIND\\.1a/AC4\\] phone: search opens from every part of t|\\[FIND\\.1a/AC1\\]\\[FIND\\.1a/AC2\\]\\[FIND\\.1a/AC4\\] tablet: search opens from every part of |\\[FIND\\.1a/AC3\\] search looks and behaves the same at eve|\\[FIND\\.3a/AC1\\]\\[FIND\\.3a/AC2\\]\\[FIND\\.3a/AC4\\] the \"still searching\" sign shows while s|\\[FIND\\.4a/AC1\\]\\[FIND\\.4a/AC3\\]\\[FIND\\.4a/AC4\\] laptop: a narrowed search with nothing w|\\[FIND\\.4a/AC1\\]\\[FIND\\.4a/AC3\\]\\[FIND\\.4a/AC4\\] phone: a narrowed search with nothing wi|\\[FIND\\.4a/AC1\\]\\[FIND\\.4a/AC3\\]\\[FIND\\.4a/AC4\\] tablet: a narrowed search with nothing w|\\[FIND\\.5a/AC1\\] every kind of content \\(video, music, hym|\\[FIND\\.8a/AC1\\] details open in one step from search, br|\\[FIND\\.8a/AC3\\]\\[FIND\\.8a/AC4\\] details offer the same play and line\\-up |\\[FIND\\.8b/AC1\\]\\[FIND\\.8b/AC4\\] a tap plays a playable item at the aim \\(|\\[FIND\\.8b/AC5\\] laptop: every result has a secondary act|\\[FIND\\.8b/AC5\\] phone: every result has a secondary acti|\\[FIND\\.8b/AC5\\] tablet: every result has a secondary act",
  },
  {
    story: 'FIND.3a',
    criteria: ['FIND.3a/AC1', 'FIND.3a/AC2', 'FIND.3a/AC4'],
    file: 'media-app-find-proof.runtime.test.mjs',
    grep: "\\[FIND\\.1a/AC1\\]\\[FIND\\.1a/AC2\\]\\[FIND\\.1a/AC4\\] laptop: search opens from every part of |\\[FIND\\.1a/AC1\\]\\[FIND\\.1a/AC2\\]\\[FIND\\.1a/AC4\\] phone: search opens from every part of t|\\[FIND\\.1a/AC1\\]\\[FIND\\.1a/AC2\\]\\[FIND\\.1a/AC4\\] tablet: search opens from every part of |\\[FIND\\.1a/AC3\\] search looks and behaves the same at eve|\\[FIND\\.3a/AC1\\]\\[FIND\\.3a/AC2\\]\\[FIND\\.3a/AC4\\] the \"still searching\" sign shows while s|\\[FIND\\.4a/AC1\\]\\[FIND\\.4a/AC3\\]\\[FIND\\.4a/AC4\\] laptop: a narrowed search with nothing w|\\[FIND\\.4a/AC1\\]\\[FIND\\.4a/AC3\\]\\[FIND\\.4a/AC4\\] phone: a narrowed search with nothing wi|\\[FIND\\.4a/AC1\\]\\[FIND\\.4a/AC3\\]\\[FIND\\.4a/AC4\\] tablet: a narrowed search with nothing w|\\[FIND\\.5a/AC1\\] every kind of content \\(video, music, hym|\\[FIND\\.8a/AC1\\] details open in one step from search, br|\\[FIND\\.8a/AC3\\]\\[FIND\\.8a/AC4\\] details offer the same play and line\\-up |\\[FIND\\.8b/AC1\\]\\[FIND\\.8b/AC4\\] a tap plays a playable item at the aim \\(|\\[FIND\\.8b/AC5\\] laptop: every result has a secondary act|\\[FIND\\.8b/AC5\\] phone: every result has a secondary acti|\\[FIND\\.8b/AC5\\] tablet: every result has a secondary act",
  },
  {
    story: 'FIND.4a',
    criteria: ['FIND.4a/AC1', 'FIND.4a/AC3', 'FIND.4a/AC4'],
    file: 'media-app-find-proof.runtime.test.mjs',
    grep: "\\[FIND\\.1a/AC1\\]\\[FIND\\.1a/AC2\\]\\[FIND\\.1a/AC4\\] laptop: search opens from every part of |\\[FIND\\.1a/AC1\\]\\[FIND\\.1a/AC2\\]\\[FIND\\.1a/AC4\\] phone: search opens from every part of t|\\[FIND\\.1a/AC1\\]\\[FIND\\.1a/AC2\\]\\[FIND\\.1a/AC4\\] tablet: search opens from every part of |\\[FIND\\.1a/AC3\\] search looks and behaves the same at eve|\\[FIND\\.3a/AC1\\]\\[FIND\\.3a/AC2\\]\\[FIND\\.3a/AC4\\] the \"still searching\" sign shows while s|\\[FIND\\.4a/AC1\\]\\[FIND\\.4a/AC3\\]\\[FIND\\.4a/AC4\\] laptop: a narrowed search with nothing w|\\[FIND\\.4a/AC1\\]\\[FIND\\.4a/AC3\\]\\[FIND\\.4a/AC4\\] phone: a narrowed search with nothing wi|\\[FIND\\.4a/AC1\\]\\[FIND\\.4a/AC3\\]\\[FIND\\.4a/AC4\\] tablet: a narrowed search with nothing w|\\[FIND\\.5a/AC1\\] every kind of content \\(video, music, hym|\\[FIND\\.8a/AC1\\] details open in one step from search, br|\\[FIND\\.8a/AC3\\]\\[FIND\\.8a/AC4\\] details offer the same play and line\\-up |\\[FIND\\.8b/AC1\\]\\[FIND\\.8b/AC4\\] a tap plays a playable item at the aim \\(|\\[FIND\\.8b/AC5\\] laptop: every result has a secondary act|\\[FIND\\.8b/AC5\\] phone: every result has a secondary acti|\\[FIND\\.8b/AC5\\] tablet: every result has a secondary act",
  },
  {
    story: 'FIND.5a',
    criteria: ['FIND.5a/AC1'],
    file: 'media-app-find-proof.runtime.test.mjs',
    grep: "\\[FIND\\.1a/AC1\\]\\[FIND\\.1a/AC2\\]\\[FIND\\.1a/AC4\\] laptop: search opens from every part of |\\[FIND\\.1a/AC1\\]\\[FIND\\.1a/AC2\\]\\[FIND\\.1a/AC4\\] phone: search opens from every part of t|\\[FIND\\.1a/AC1\\]\\[FIND\\.1a/AC2\\]\\[FIND\\.1a/AC4\\] tablet: search opens from every part of |\\[FIND\\.1a/AC3\\] search looks and behaves the same at eve|\\[FIND\\.3a/AC1\\]\\[FIND\\.3a/AC2\\]\\[FIND\\.3a/AC4\\] the \"still searching\" sign shows while s|\\[FIND\\.4a/AC1\\]\\[FIND\\.4a/AC3\\]\\[FIND\\.4a/AC4\\] laptop: a narrowed search with nothing w|\\[FIND\\.4a/AC1\\]\\[FIND\\.4a/AC3\\]\\[FIND\\.4a/AC4\\] phone: a narrowed search with nothing wi|\\[FIND\\.4a/AC1\\]\\[FIND\\.4a/AC3\\]\\[FIND\\.4a/AC4\\] tablet: a narrowed search with nothing w|\\[FIND\\.5a/AC1\\] every kind of content \\(video, music, hym|\\[FIND\\.8a/AC1\\] details open in one step from search, br|\\[FIND\\.8a/AC3\\]\\[FIND\\.8a/AC4\\] details offer the same play and line\\-up |\\[FIND\\.8b/AC1\\]\\[FIND\\.8b/AC4\\] a tap plays a playable item at the aim \\(|\\[FIND\\.8b/AC5\\] laptop: every result has a secondary act|\\[FIND\\.8b/AC5\\] phone: every result has a secondary acti|\\[FIND\\.8b/AC5\\] tablet: every result has a secondary act",
  },
  {
    story: 'FIND.8a',
    criteria: ['FIND.8a/AC1', 'FIND.8a/AC3', 'FIND.8a/AC4'],
    file: 'media-app-find-proof.runtime.test.mjs',
    grep: "\\[FIND\\.1a/AC1\\]\\[FIND\\.1a/AC2\\]\\[FIND\\.1a/AC4\\] laptop: search opens from every part of |\\[FIND\\.1a/AC1\\]\\[FIND\\.1a/AC2\\]\\[FIND\\.1a/AC4\\] phone: search opens from every part of t|\\[FIND\\.1a/AC1\\]\\[FIND\\.1a/AC2\\]\\[FIND\\.1a/AC4\\] tablet: search opens from every part of |\\[FIND\\.1a/AC3\\] search looks and behaves the same at eve|\\[FIND\\.3a/AC1\\]\\[FIND\\.3a/AC2\\]\\[FIND\\.3a/AC4\\] the \"still searching\" sign shows while s|\\[FIND\\.4a/AC1\\]\\[FIND\\.4a/AC3\\]\\[FIND\\.4a/AC4\\] laptop: a narrowed search with nothing w|\\[FIND\\.4a/AC1\\]\\[FIND\\.4a/AC3\\]\\[FIND\\.4a/AC4\\] phone: a narrowed search with nothing wi|\\[FIND\\.4a/AC1\\]\\[FIND\\.4a/AC3\\]\\[FIND\\.4a/AC4\\] tablet: a narrowed search with nothing w|\\[FIND\\.5a/AC1\\] every kind of content \\(video, music, hym|\\[FIND\\.8a/AC1\\] details open in one step from search, br|\\[FIND\\.8a/AC3\\]\\[FIND\\.8a/AC4\\] details offer the same play and line\\-up |\\[FIND\\.8b/AC1\\]\\[FIND\\.8b/AC4\\] a tap plays a playable item at the aim \\(|\\[FIND\\.8b/AC5\\] laptop: every result has a secondary act|\\[FIND\\.8b/AC5\\] phone: every result has a secondary acti|\\[FIND\\.8b/AC5\\] tablet: every result has a secondary act",
  },
  {
    story: 'FIND.8b',
    criteria: ['FIND.8b/AC1', 'FIND.8b/AC4', 'FIND.8b/AC5'],
    file: 'media-app-find-proof.runtime.test.mjs',
    grep: "\\[FIND\\.1a/AC1\\]\\[FIND\\.1a/AC2\\]\\[FIND\\.1a/AC4\\] laptop: search opens from every part of |\\[FIND\\.1a/AC1\\]\\[FIND\\.1a/AC2\\]\\[FIND\\.1a/AC4\\] phone: search opens from every part of t|\\[FIND\\.1a/AC1\\]\\[FIND\\.1a/AC2\\]\\[FIND\\.1a/AC4\\] tablet: search opens from every part of |\\[FIND\\.1a/AC3\\] search looks and behaves the same at eve|\\[FIND\\.3a/AC1\\]\\[FIND\\.3a/AC2\\]\\[FIND\\.3a/AC4\\] the \"still searching\" sign shows while s|\\[FIND\\.4a/AC1\\]\\[FIND\\.4a/AC3\\]\\[FIND\\.4a/AC4\\] laptop: a narrowed search with nothing w|\\[FIND\\.4a/AC1\\]\\[FIND\\.4a/AC3\\]\\[FIND\\.4a/AC4\\] phone: a narrowed search with nothing wi|\\[FIND\\.4a/AC1\\]\\[FIND\\.4a/AC3\\]\\[FIND\\.4a/AC4\\] tablet: a narrowed search with nothing w|\\[FIND\\.5a/AC1\\] every kind of content \\(video, music, hym|\\[FIND\\.8a/AC1\\] details open in one step from search, br|\\[FIND\\.8a/AC3\\]\\[FIND\\.8a/AC4\\] details offer the same play and line\\-up |\\[FIND\\.8b/AC1\\]\\[FIND\\.8b/AC4\\] a tap plays a playable item at the aim \\(|\\[FIND\\.8b/AC5\\] laptop: every result has a secondary act|\\[FIND\\.8b/AC5\\] phone: every result has a secondary acti|\\[FIND\\.8b/AC5\\] tablet: every result has a secondary act",
  },
  {
    story: 'HOUSE.3a',
    criteria: ['HOUSE.3a/AC2'],
    file: 'media-app-house-proof.runtime.test.mjs',
    grep: "\\[HOUSE\\.3a/AC2\\] when this device loses touch with the ho|\\[RELY\\.7a/AC4\\] a brief network hiccup does not reload t",
  },
  {
    story: 'RELY.7a',
    criteria: ['RELY.7a/AC4'],
    file: 'media-app-house-proof.runtime.test.mjs',
    grep: "\\[HOUSE\\.3a/AC2\\] when this device loses touch with the ho|\\[RELY\\.7a/AC4\\] a brief network hiccup does not reload t",
  },
  {
    story: 'FIND.10a',
    criteria: ['FIND.10a/AC5'],
    file: 'media-app-household-home.runtime.test.mjs',
    grep: "\\[FIND\\.10a/AC5\\] 5 minutes counts as unfinished even when|\\[FIND\\.11a/AC1\\]\\[FIND\\.11a/AC2\\]\\[FIND\\.11a/AC3\\] laptop: this screen's queue lists what p|\\[FIND\\.11a/AC1\\]\\[FIND\\.11a/AC2\\]\\[FIND\\.11a/AC3\\] phone: this screen's queue lists what pl|\\[FIND\\.11a/AC1\\]\\[FIND\\.11a/AC2\\]\\[FIND\\.11a/AC3\\] tablet: this screen's queue lists what p|\\[FIND\\.12a/AC1\\]\\[FIND\\.12a/AC2\\]\\[FIND\\.12a/AC3\\]\\[FIND\\.10a/AC6\\] laptop: favourite in one step from a til|\\[FIND\\.12a/AC1\\]\\[FIND\\.12a/AC2\\]\\[FIND\\.12a/AC3\\]\\[FIND\\.10a/AC6\\] phone: favourite in one step from a tile|\\[FIND\\.12a/AC1\\]\\[FIND\\.12a/AC2\\]\\[FIND\\.12a/AC3\\]\\[FIND\\.10a/AC6\\] tablet: favourite in one step from a til|\\[FIND\\.13a/AC1\\]\\[FIND\\.13a/AC2\\]\\[FIND\\.13a/AC3\\] laptop: remove from the household list i|\\[FIND\\.13a/AC1\\]\\[FIND\\.13a/AC2\\]\\[FIND\\.13a/AC3\\] phone: remove from the household list in|\\[FIND\\.13a/AC1\\]\\[FIND\\.13a/AC2\\]\\[FIND\\.13a/AC3\\] tablet: remove from the household list i|\\[FIND\\.7a/AC1\\]\\[FIND\\.7a/AC3\\]\\[FIND\\.12a/AC2\\]\\[FIND\\.12b/AC1\\]\\[FIND\\.9a/AC1\\]\\[FIND\\.10a/AC1\\]\\[FIND\\.10a/AC2\\]\\[FIND\\.10a/AC4\\] laptop: suggestions for this screen in o|\\[FIND\\.7a/AC1\\]\\[FIND\\.7a/AC3\\]\\[FIND\\.12a/AC2\\]\\[FIND\\.12b/AC1\\]\\[FIND\\.9a/AC1\\]\\[FIND\\.10a/AC1\\]\\[FIND\\.10a/AC2\\]\\[FIND\\.10a/AC4\\] phone: suggestions for this screen in or|\\[FIND\\.7a/AC1\\]\\[FIND\\.7a/AC3\\]\\[FIND\\.12a/AC2\\]\\[FIND\\.12b/AC1\\]\\[FIND\\.9a/AC1\\]\\[FIND\\.10a/AC1\\]\\[FIND\\.10a/AC2\\]\\[FIND\\.10a/AC4\\] tablet: suggestions for this screen in o",
  },
  {
    story: 'FIND.11a',
    criteria: ['FIND.11a/AC2'],
    file: 'media-app-household-home.runtime.test.mjs',
    grep: "\\[FIND\\.10a/AC5\\] 5 minutes counts as unfinished even when|\\[FIND\\.11a/AC1\\]\\[FIND\\.11a/AC2\\]\\[FIND\\.11a/AC3\\] laptop: this screen's queue lists what p|\\[FIND\\.11a/AC1\\]\\[FIND\\.11a/AC2\\]\\[FIND\\.11a/AC3\\] phone: this screen's queue lists what pl|\\[FIND\\.11a/AC1\\]\\[FIND\\.11a/AC2\\]\\[FIND\\.11a/AC3\\] tablet: this screen's queue lists what p|\\[FIND\\.12a/AC1\\]\\[FIND\\.12a/AC2\\]\\[FIND\\.12a/AC3\\]\\[FIND\\.10a/AC6\\] laptop: favourite in one step from a til|\\[FIND\\.12a/AC1\\]\\[FIND\\.12a/AC2\\]\\[FIND\\.12a/AC3\\]\\[FIND\\.10a/AC6\\] phone: favourite in one step from a tile|\\[FIND\\.12a/AC1\\]\\[FIND\\.12a/AC2\\]\\[FIND\\.12a/AC3\\]\\[FIND\\.10a/AC6\\] tablet: favourite in one step from a til|\\[FIND\\.13a/AC1\\]\\[FIND\\.13a/AC2\\]\\[FIND\\.13a/AC3\\] laptop: remove from the household list i|\\[FIND\\.13a/AC1\\]\\[FIND\\.13a/AC2\\]\\[FIND\\.13a/AC3\\] phone: remove from the household list in|\\[FIND\\.13a/AC1\\]\\[FIND\\.13a/AC2\\]\\[FIND\\.13a/AC3\\] tablet: remove from the household list i|\\[FIND\\.7a/AC1\\]\\[FIND\\.7a/AC3\\]\\[FIND\\.12a/AC2\\]\\[FIND\\.12b/AC1\\]\\[FIND\\.9a/AC1\\]\\[FIND\\.10a/AC1\\]\\[FIND\\.10a/AC2\\]\\[FIND\\.10a/AC4\\] laptop: suggestions for this screen in o|\\[FIND\\.7a/AC1\\]\\[FIND\\.7a/AC3\\]\\[FIND\\.12a/AC2\\]\\[FIND\\.12b/AC1\\]\\[FIND\\.9a/AC1\\]\\[FIND\\.10a/AC1\\]\\[FIND\\.10a/AC2\\]\\[FIND\\.10a/AC4\\] phone: suggestions for this screen in or|\\[FIND\\.7a/AC1\\]\\[FIND\\.7a/AC3\\]\\[FIND\\.12a/AC2\\]\\[FIND\\.12b/AC1\\]\\[FIND\\.9a/AC1\\]\\[FIND\\.10a/AC1\\]\\[FIND\\.10a/AC2\\]\\[FIND\\.10a/AC4\\] tablet: suggestions for this screen in o",
  },
  {
    story: 'FIND.12a',
    criteria: ['FIND.12a/AC3'],
    file: 'media-app-household-home.runtime.test.mjs',
    grep: "\\[FIND\\.10a/AC5\\] 5 minutes counts as unfinished even when|\\[FIND\\.11a/AC1\\]\\[FIND\\.11a/AC2\\]\\[FIND\\.11a/AC3\\] laptop: this screen's queue lists what p|\\[FIND\\.11a/AC1\\]\\[FIND\\.11a/AC2\\]\\[FIND\\.11a/AC3\\] phone: this screen's queue lists what pl|\\[FIND\\.11a/AC1\\]\\[FIND\\.11a/AC2\\]\\[FIND\\.11a/AC3\\] tablet: this screen's queue lists what p|\\[FIND\\.12a/AC1\\]\\[FIND\\.12a/AC2\\]\\[FIND\\.12a/AC3\\]\\[FIND\\.10a/AC6\\] laptop: favourite in one step from a til|\\[FIND\\.12a/AC1\\]\\[FIND\\.12a/AC2\\]\\[FIND\\.12a/AC3\\]\\[FIND\\.10a/AC6\\] phone: favourite in one step from a tile|\\[FIND\\.12a/AC1\\]\\[FIND\\.12a/AC2\\]\\[FIND\\.12a/AC3\\]\\[FIND\\.10a/AC6\\] tablet: favourite in one step from a til|\\[FIND\\.13a/AC1\\]\\[FIND\\.13a/AC2\\]\\[FIND\\.13a/AC3\\] laptop: remove from the household list i|\\[FIND\\.13a/AC1\\]\\[FIND\\.13a/AC2\\]\\[FIND\\.13a/AC3\\] phone: remove from the household list in|\\[FIND\\.13a/AC1\\]\\[FIND\\.13a/AC2\\]\\[FIND\\.13a/AC3\\] tablet: remove from the household list i|\\[FIND\\.7a/AC1\\]\\[FIND\\.7a/AC3\\]\\[FIND\\.12a/AC2\\]\\[FIND\\.12b/AC1\\]\\[FIND\\.9a/AC1\\]\\[FIND\\.10a/AC1\\]\\[FIND\\.10a/AC2\\]\\[FIND\\.10a/AC4\\] laptop: suggestions for this screen in o|\\[FIND\\.7a/AC1\\]\\[FIND\\.7a/AC3\\]\\[FIND\\.12a/AC2\\]\\[FIND\\.12b/AC1\\]\\[FIND\\.9a/AC1\\]\\[FIND\\.10a/AC1\\]\\[FIND\\.10a/AC2\\]\\[FIND\\.10a/AC4\\] phone: suggestions for this screen in or|\\[FIND\\.7a/AC1\\]\\[FIND\\.7a/AC3\\]\\[FIND\\.12a/AC2\\]\\[FIND\\.12b/AC1\\]\\[FIND\\.9a/AC1\\]\\[FIND\\.10a/AC1\\]\\[FIND\\.10a/AC2\\]\\[FIND\\.10a/AC4\\] tablet: suggestions for this screen in o",
  },
  {
    story: 'FIND.13a',
    criteria: ['FIND.13a/AC2'],
    file: 'media-app-household-home.runtime.test.mjs',
    grep: "\\[FIND\\.10a/AC5\\] 5 minutes counts as unfinished even when|\\[FIND\\.11a/AC1\\]\\[FIND\\.11a/AC2\\]\\[FIND\\.11a/AC3\\] laptop: this screen's queue lists what p|\\[FIND\\.11a/AC1\\]\\[FIND\\.11a/AC2\\]\\[FIND\\.11a/AC3\\] phone: this screen's queue lists what pl|\\[FIND\\.11a/AC1\\]\\[FIND\\.11a/AC2\\]\\[FIND\\.11a/AC3\\] tablet: this screen's queue lists what p|\\[FIND\\.12a/AC1\\]\\[FIND\\.12a/AC2\\]\\[FIND\\.12a/AC3\\]\\[FIND\\.10a/AC6\\] laptop: favourite in one step from a til|\\[FIND\\.12a/AC1\\]\\[FIND\\.12a/AC2\\]\\[FIND\\.12a/AC3\\]\\[FIND\\.10a/AC6\\] phone: favourite in one step from a tile|\\[FIND\\.12a/AC1\\]\\[FIND\\.12a/AC2\\]\\[FIND\\.12a/AC3\\]\\[FIND\\.10a/AC6\\] tablet: favourite in one step from a til|\\[FIND\\.13a/AC1\\]\\[FIND\\.13a/AC2\\]\\[FIND\\.13a/AC3\\] laptop: remove from the household list i|\\[FIND\\.13a/AC1\\]\\[FIND\\.13a/AC2\\]\\[FIND\\.13a/AC3\\] phone: remove from the household list in|\\[FIND\\.13a/AC1\\]\\[FIND\\.13a/AC2\\]\\[FIND\\.13a/AC3\\] tablet: remove from the household list i|\\[FIND\\.7a/AC1\\]\\[FIND\\.7a/AC3\\]\\[FIND\\.12a/AC2\\]\\[FIND\\.12b/AC1\\]\\[FIND\\.9a/AC1\\]\\[FIND\\.10a/AC1\\]\\[FIND\\.10a/AC2\\]\\[FIND\\.10a/AC4\\] laptop: suggestions for this screen in o|\\[FIND\\.7a/AC1\\]\\[FIND\\.7a/AC3\\]\\[FIND\\.12a/AC2\\]\\[FIND\\.12b/AC1\\]\\[FIND\\.9a/AC1\\]\\[FIND\\.10a/AC1\\]\\[FIND\\.10a/AC2\\]\\[FIND\\.10a/AC4\\] phone: suggestions for this screen in or|\\[FIND\\.7a/AC1\\]\\[FIND\\.7a/AC3\\]\\[FIND\\.12a/AC2\\]\\[FIND\\.12b/AC1\\]\\[FIND\\.9a/AC1\\]\\[FIND\\.10a/AC1\\]\\[FIND\\.10a/AC2\\]\\[FIND\\.10a/AC4\\] tablet: suggestions for this screen in o",
  },
  {
    story: 'FIND.7a',
    criteria: ['FIND.7a/AC3'],
    file: 'media-app-household-home.runtime.test.mjs',
    grep: "\\[FIND\\.10a/AC5\\] 5 minutes counts as unfinished even when|\\[FIND\\.11a/AC1\\]\\[FIND\\.11a/AC2\\]\\[FIND\\.11a/AC3\\] laptop: this screen's queue lists what p|\\[FIND\\.11a/AC1\\]\\[FIND\\.11a/AC2\\]\\[FIND\\.11a/AC3\\] phone: this screen's queue lists what pl|\\[FIND\\.11a/AC1\\]\\[FIND\\.11a/AC2\\]\\[FIND\\.11a/AC3\\] tablet: this screen's queue lists what p|\\[FIND\\.12a/AC1\\]\\[FIND\\.12a/AC2\\]\\[FIND\\.12a/AC3\\]\\[FIND\\.10a/AC6\\] laptop: favourite in one step from a til|\\[FIND\\.12a/AC1\\]\\[FIND\\.12a/AC2\\]\\[FIND\\.12a/AC3\\]\\[FIND\\.10a/AC6\\] phone: favourite in one step from a tile|\\[FIND\\.12a/AC1\\]\\[FIND\\.12a/AC2\\]\\[FIND\\.12a/AC3\\]\\[FIND\\.10a/AC6\\] tablet: favourite in one step from a til|\\[FIND\\.13a/AC1\\]\\[FIND\\.13a/AC2\\]\\[FIND\\.13a/AC3\\] laptop: remove from the household list i|\\[FIND\\.13a/AC1\\]\\[FIND\\.13a/AC2\\]\\[FIND\\.13a/AC3\\] phone: remove from the household list in|\\[FIND\\.13a/AC1\\]\\[FIND\\.13a/AC2\\]\\[FIND\\.13a/AC3\\] tablet: remove from the household list i|\\[FIND\\.7a/AC1\\]\\[FIND\\.7a/AC3\\]\\[FIND\\.12a/AC2\\]\\[FIND\\.12b/AC1\\]\\[FIND\\.9a/AC1\\]\\[FIND\\.10a/AC1\\]\\[FIND\\.10a/AC2\\]\\[FIND\\.10a/AC4\\] laptop: suggestions for this screen in o|\\[FIND\\.7a/AC1\\]\\[FIND\\.7a/AC3\\]\\[FIND\\.12a/AC2\\]\\[FIND\\.12b/AC1\\]\\[FIND\\.9a/AC1\\]\\[FIND\\.10a/AC1\\]\\[FIND\\.10a/AC2\\]\\[FIND\\.10a/AC4\\] phone: suggestions for this screen in or|\\[FIND\\.7a/AC1\\]\\[FIND\\.7a/AC3\\]\\[FIND\\.12a/AC2\\]\\[FIND\\.12b/AC1\\]\\[FIND\\.9a/AC1\\]\\[FIND\\.10a/AC1\\]\\[FIND\\.10a/AC2\\]\\[FIND\\.10a/AC4\\] tablet: suggestions for this screen in o",
  },
  {
    story: 'AUTO.3a',
    criteria: ['AUTO.3a/AC3'],
    file: 'media-app-misc-proof.runtime.test.mjs',
    grep: "\\[AUTO\\.3a/AC3\\] a device left open in the app shows, in |\\[STEER\\.3a/AC2\\] skip forward and back are available for ",
  },
  {
    story: 'STEER.3a',
    criteria: ['STEER.3a/AC2'],
    file: 'media-app-misc-proof.runtime.test.mjs',
    grep: "\\[AUTO\\.3a/AC3\\] a device left open in the app shows, in |\\[STEER\\.3a/AC2\\] skip forward and back are available for ",
  },
  {
    story: 'PLACE.6a',
    criteria: ['PLACE.6a/AC1', 'PLACE.6a/AC3'],
    file: 'media-app-move-proof.runtime.test.mjs',
    grep: "\\[PLACE\\.6a/AC1\\]\\[PLACE\\.6a/AC3\\] while this device plays and the aim is a|\\[PLACE\\.7a/AC2\\] Move to this device from another screen'|\\[PLACE\\.7a/AC4\\] if a move cannot happen I am told why an|\\[PLACE\\.7a/AC5\\] a photo slideshow moves with its place; |\\[PLACE\\.8a/AC4\\] hand\\-off from Now Playing with \"Keep pla",
  },
  {
    story: 'PLACE.7a',
    criteria: ['PLACE.7a/AC5'],
    file: 'media-app-move-proof.runtime.test.mjs',
    grep: "\\[PLACE\\.6a/AC1\\]\\[PLACE\\.6a/AC3\\] while this device plays and the aim is a|\\[PLACE\\.7a/AC2\\] Move to this device from another screen'|\\[PLACE\\.7a/AC4\\] if a move cannot happen I am told why an|\\[PLACE\\.7a/AC5\\] a photo slideshow moves with its place; |\\[PLACE\\.8a/AC4\\] hand\\-off from Now Playing with \"Keep pla",
  },
  {
    story: 'PLACE.8a',
    criteria: ['PLACE.8a/AC4'],
    file: 'media-app-move-proof.runtime.test.mjs',
    grep: "\\[PLACE\\.6a/AC1\\]\\[PLACE\\.6a/AC3\\] while this device plays and the aim is a|\\[PLACE\\.7a/AC2\\] Move to this device from another screen'|\\[PLACE\\.7a/AC4\\] if a move cannot happen I am told why an|\\[PLACE\\.7a/AC5\\] a photo slideshow moves with its place; |\\[PLACE\\.8a/AC4\\] hand\\-off from Now Playing with \"Keep pla",
  },
  {
    story: 'PLACE.1a',
    criteria: ['PLACE.1a/AC1', 'PLACE.1a/AC2'],
    file: 'media-app-place-proof.runtime.test.mjs',
    grep: "\\[PLACE\\.1a/AC1\\] laptop: the aim is visible on every surf|\\[PLACE\\.1a/AC1\\] phone: the aim is visible on every surfa|\\[PLACE\\.1a/AC1\\] tablet: the aim is visible on every surf|\\[PLACE\\.1a/AC2\\] the aim reads as the screen's name and r|\\[PLACE\\.3a/AC1\\]\\[PLACE\\.3a/AC2\\]\\[PLACE\\.3a/AC3\\] Play on\u2026 is offered on items everywhere,|\\[PLACE\\.5a/AC1\\]\\[PLACE\\.5a/AC2\\] each screen choice shows name, room and ",
  },
  {
    story: 'PLACE.3a',
    criteria: ['PLACE.3a/AC1', 'PLACE.3a/AC2', 'PLACE.3a/AC3'],
    file: 'media-app-place-proof.runtime.test.mjs',
    grep: "\\[PLACE\\.1a/AC1\\] laptop: the aim is visible on every surf|\\[PLACE\\.1a/AC1\\] phone: the aim is visible on every surfa|\\[PLACE\\.1a/AC1\\] tablet: the aim is visible on every surf|\\[PLACE\\.1a/AC2\\] the aim reads as the screen's name and r|\\[PLACE\\.3a/AC1\\]\\[PLACE\\.3a/AC2\\]\\[PLACE\\.3a/AC3\\] Play on\u2026 is offered on items everywhere,|\\[PLACE\\.5a/AC1\\]\\[PLACE\\.5a/AC2\\] each screen choice shows name, room and ",
  },
  {
    story: 'PLACE.5a',
    criteria: ['PLACE.5a/AC1', 'PLACE.5a/AC2'],
    file: 'media-app-place-proof.runtime.test.mjs',
    grep: "\\[PLACE\\.1a/AC1\\] laptop: the aim is visible on every surf|\\[PLACE\\.1a/AC1\\] phone: the aim is visible on every surfa|\\[PLACE\\.1a/AC1\\] tablet: the aim is visible on every surf|\\[PLACE\\.1a/AC2\\] the aim reads as the screen's name and r|\\[PLACE\\.3a/AC1\\]\\[PLACE\\.3a/AC2\\]\\[PLACE\\.3a/AC3\\] Play on\u2026 is offered on items everywhere,|\\[PLACE\\.5a/AC1\\]\\[PLACE\\.5a/AC2\\] each screen choice shows name, room and ",
  },
  {
    story: 'PLACE.1a',
    criteria: ['PLACE.1a/AC3', 'PLACE.1a/AC4'],
    file: 'media-app-playback-journey.runtime.test.mjs',
    grep: "\\[PLACE\\.1a/AC3\\]\\[PLACE\\.1a/AC4\\]\\[STEER\\.1b\\] opening a screen's controls does not red|\\[PLAY\\.1a/AC1\\]\\[PLAY\\.1a/AC3\\]\\[PLACE\\.1a/AC3\\] Play now plays at the aim from search, b|\\[PLAY\\.1b/AC1\\]\\[STEER\\.4a/AC1\\] discovered movie duration and progress r|\\[PLAY\\.5a/AC1\\]\\[PLAY\\.5a/AC2\\]\\[PLAY\\.6a/AC1\\]\\[PLACE\\.1a/AC3\\] Play next puts items right after what is|\\[STEER\\.3a/AC1\\]\\[STEER\\.3a/AC3\\] pause and resume reflect the real player|\\[STEER\\.4a/AC2\\] forward and back controls seek the real |\\[STEER\\.6a/AC1\\]\\[STEER\\.6a/AC2\\]\\[STEER\\.7a/AC2\\] stop ends actual playback and keeps the |\\[STEER\\.6a/AC2\\] Stop explicitly says how many queue item",
  },
  {
    story: 'STEER.3a',
    criteria: ['STEER.3a/AC1'],
    file: 'media-app-playback-journey.runtime.test.mjs',
    grep: "\\[PLACE\\.1a/AC3\\]\\[PLACE\\.1a/AC4\\]\\[STEER\\.1b\\] opening a screen's controls does not red|\\[PLAY\\.1a/AC1\\]\\[PLAY\\.1a/AC3\\]\\[PLACE\\.1a/AC3\\] Play now plays at the aim from search, b|\\[PLAY\\.1b/AC1\\]\\[STEER\\.4a/AC1\\] discovered movie duration and progress r|\\[PLAY\\.5a/AC1\\]\\[PLAY\\.5a/AC2\\]\\[PLAY\\.6a/AC1\\]\\[PLACE\\.1a/AC3\\] Play next puts items right after what is|\\[STEER\\.3a/AC1\\]\\[STEER\\.3a/AC3\\] pause and resume reflect the real player|\\[STEER\\.4a/AC2\\] forward and back controls seek the real |\\[STEER\\.6a/AC1\\]\\[STEER\\.6a/AC2\\]\\[STEER\\.7a/AC2\\] stop ends actual playback and keeps the |\\[STEER\\.6a/AC2\\] Stop explicitly says how many queue item",
  },
  {
    story: 'STEER.4a',
    criteria: ['STEER.4a/AC1', 'STEER.4a/AC2'],
    file: 'media-app-playback-journey.runtime.test.mjs',
    grep: "\\[PLACE\\.1a/AC3\\]\\[PLACE\\.1a/AC4\\]\\[STEER\\.1b\\] opening a screen's controls does not red|\\[PLAY\\.1a/AC1\\]\\[PLAY\\.1a/AC3\\]\\[PLACE\\.1a/AC3\\] Play now plays at the aim from search, b|\\[PLAY\\.1b/AC1\\]\\[STEER\\.4a/AC1\\] discovered movie duration and progress r|\\[PLAY\\.5a/AC1\\]\\[PLAY\\.5a/AC2\\]\\[PLAY\\.6a/AC1\\]\\[PLACE\\.1a/AC3\\] Play next puts items right after what is|\\[STEER\\.3a/AC1\\]\\[STEER\\.3a/AC3\\] pause and resume reflect the real player|\\[STEER\\.4a/AC2\\] forward and back controls seek the real |\\[STEER\\.6a/AC1\\]\\[STEER\\.6a/AC2\\]\\[STEER\\.7a/AC2\\] stop ends actual playback and keeps the |\\[STEER\\.6a/AC2\\] Stop explicitly says how many queue item",
  },
  {
    story: 'STEER.6a',
    criteria: ['STEER.6a/AC1', 'STEER.6a/AC2'],
    file: 'media-app-playback-journey.runtime.test.mjs',
    grep: "\\[PLACE\\.1a/AC3\\]\\[PLACE\\.1a/AC4\\]\\[STEER\\.1b\\] opening a screen's controls does not red|\\[PLAY\\.1a/AC1\\]\\[PLAY\\.1a/AC3\\]\\[PLACE\\.1a/AC3\\] Play now plays at the aim from search, b|\\[PLAY\\.1b/AC1\\]\\[STEER\\.4a/AC1\\] discovered movie duration and progress r|\\[PLAY\\.5a/AC1\\]\\[PLAY\\.5a/AC2\\]\\[PLAY\\.6a/AC1\\]\\[PLACE\\.1a/AC3\\] Play next puts items right after what is|\\[STEER\\.3a/AC1\\]\\[STEER\\.3a/AC3\\] pause and resume reflect the real player|\\[STEER\\.4a/AC2\\] forward and back controls seek the real |\\[STEER\\.6a/AC1\\]\\[STEER\\.6a/AC2\\]\\[STEER\\.7a/AC2\\] stop ends actual playback and keeps the |\\[STEER\\.6a/AC2\\] Stop explicitly says how many queue item",
  },
  {
    story: 'STEER.7a',
    criteria: ['STEER.7a/AC2'],
    file: 'media-app-playback-journey.runtime.test.mjs',
    grep: "\\[PLACE\\.1a/AC3\\]\\[PLACE\\.1a/AC4\\]\\[STEER\\.1b\\] opening a screen's controls does not red|\\[PLAY\\.1a/AC1\\]\\[PLAY\\.1a/AC3\\]\\[PLACE\\.1a/AC3\\] Play now plays at the aim from search, b|\\[PLAY\\.1b/AC1\\]\\[STEER\\.4a/AC1\\] discovered movie duration and progress r|\\[PLAY\\.5a/AC1\\]\\[PLAY\\.5a/AC2\\]\\[PLAY\\.6a/AC1\\]\\[PLACE\\.1a/AC3\\] Play next puts items right after what is|\\[STEER\\.3a/AC1\\]\\[STEER\\.3a/AC3\\] pause and resume reflect the real player|\\[STEER\\.4a/AC2\\] forward and back controls seek the real |\\[STEER\\.6a/AC1\\]\\[STEER\\.6a/AC2\\]\\[STEER\\.7a/AC2\\] stop ends actual playback and keeps the |\\[STEER\\.6a/AC2\\] Stop explicitly says how many queue item",
  },
  {
    story: 'PLAY.6a',
    criteria: ['PLAY.6a/AC1', 'PLAY.6a/AC2'],
    file: 'media-app-queue-journey.runtime.test.mjs',
    grep: "\\[PLAY\\.5a/AC1\\]\\[PLAY\\.5a/AC2\\]\\[PLAY\\.6a/AC1\\]\\[PLACE\\.1a/AC3\\] Play next puts items right after what is|\\[PLAY\\.6a/AC1\\]\\[STEER\\.8a/AC2\\] add without interrupting, then jump to a|\\[PLAY\\.6a/AC2\\] Add keeps the actual playing video advan",
  },
  {
    story: 'STEER.8a',
    criteria: ['STEER.8a/AC2'],
    file: 'media-app-queue-journey.runtime.test.mjs',
    grep: "\\[PLAY\\.5a/AC1\\]\\[PLAY\\.5a/AC2\\]\\[PLAY\\.6a/AC1\\]\\[PLACE\\.1a/AC3\\] Play next puts items right after what is|\\[PLAY\\.6a/AC1\\]\\[STEER\\.8a/AC2\\] add without interrupting, then jump to a|\\[PLAY\\.6a/AC2\\] Add keeps the actual playing video advan",
  },
  {
    story: 'PLAY.1a',
    criteria: ['PLAY.1a/AC3'],
    file: 'media-app-rely-proof.runtime.test.mjs',
    grep: "\\[PLAY\\.1a/AC1\\]\\[PLAY\\.1a/AC3\\]\\[PLACE\\.1a/AC3\\] Play now plays at the aim from search, b|\\[RELY\\.1a/AC2\\]\\[RELY\\.1a/AC3\\]\\[RELY\\.1a/AC4\\] laptop: every change to what is lined up|\\[RELY\\.1a/AC2\\]\\[RELY\\.1a/AC3\\]\\[RELY\\.1a/AC4\\] phone: every change to what is lined up |\\[RELY\\.1a/AC2\\]\\[RELY\\.1a/AC3\\]\\[RELY\\.1a/AC4\\] tablet: every change to what is lined up|\\[RELY\\.1a/AC5\\]\\[PLAY\\.1a/AC3\\] playing here confirms quietly; playing o|\\[RELY\\.2a/AC1\\]\\[RELY\\.2a/AC3\\] a far screen that needs waking shows its|\\[RELY\\.6a/AC2\\]\\[RELY\\.6a/AC3\\] a failed send offers Retry and \"Another ",
  },
  {
    story: 'RELY.1a',
    criteria: ['RELY.1a/AC2', 'RELY.1a/AC3', 'RELY.1a/AC4', 'RELY.1a/AC5'],
    file: 'media-app-rely-proof.runtime.test.mjs',
    grep: "\\[PLAY\\.1a/AC1\\]\\[PLAY\\.1a/AC3\\]\\[PLACE\\.1a/AC3\\] Play now plays at the aim from search, b|\\[RELY\\.1a/AC2\\]\\[RELY\\.1a/AC3\\]\\[RELY\\.1a/AC4\\] laptop: every change to what is lined up|\\[RELY\\.1a/AC2\\]\\[RELY\\.1a/AC3\\]\\[RELY\\.1a/AC4\\] phone: every change to what is lined up |\\[RELY\\.1a/AC2\\]\\[RELY\\.1a/AC3\\]\\[RELY\\.1a/AC4\\] tablet: every change to what is lined up|\\[RELY\\.1a/AC5\\]\\[PLAY\\.1a/AC3\\] playing here confirms quietly; playing o|\\[RELY\\.2a/AC1\\]\\[RELY\\.2a/AC3\\] a far screen that needs waking shows its|\\[RELY\\.6a/AC2\\]\\[RELY\\.6a/AC3\\] a failed send offers Retry and \"Another ",
  },
  {
    story: 'RELY.2a',
    criteria: ['RELY.2a/AC1', 'RELY.2a/AC3'],
    file: 'media-app-rely-proof.runtime.test.mjs',
    grep: "\\[PLAY\\.1a/AC1\\]\\[PLAY\\.1a/AC3\\]\\[PLACE\\.1a/AC3\\] Play now plays at the aim from search, b|\\[RELY\\.1a/AC2\\]\\[RELY\\.1a/AC3\\]\\[RELY\\.1a/AC4\\] laptop: every change to what is lined up|\\[RELY\\.1a/AC2\\]\\[RELY\\.1a/AC3\\]\\[RELY\\.1a/AC4\\] phone: every change to what is lined up |\\[RELY\\.1a/AC2\\]\\[RELY\\.1a/AC3\\]\\[RELY\\.1a/AC4\\] tablet: every change to what is lined up|\\[RELY\\.1a/AC5\\]\\[PLAY\\.1a/AC3\\] playing here confirms quietly; playing o|\\[RELY\\.2a/AC1\\]\\[RELY\\.2a/AC3\\] a far screen that needs waking shows its|\\[RELY\\.6a/AC2\\]\\[RELY\\.6a/AC3\\] a failed send offers Retry and \"Another ",
  },
  {
    story: 'RELY.6a',
    criteria: ['RELY.6a/AC2', 'RELY.6a/AC3'],
    file: 'media-app-rely-proof.runtime.test.mjs',
    grep: "\\[PLAY\\.1a/AC1\\]\\[PLAY\\.1a/AC3\\]\\[PLACE\\.1a/AC3\\] Play now plays at the aim from search, b|\\[RELY\\.1a/AC2\\]\\[RELY\\.1a/AC3\\]\\[RELY\\.1a/AC4\\] laptop: every change to what is lined up|\\[RELY\\.1a/AC2\\]\\[RELY\\.1a/AC3\\]\\[RELY\\.1a/AC4\\] phone: every change to what is lined up |\\[RELY\\.1a/AC2\\]\\[RELY\\.1a/AC3\\]\\[RELY\\.1a/AC4\\] tablet: every change to what is lined up|\\[RELY\\.1a/AC5\\]\\[PLAY\\.1a/AC3\\] playing here confirms quietly; playing o|\\[RELY\\.2a/AC1\\]\\[RELY\\.2a/AC3\\] a far screen that needs waking shows its|\\[RELY\\.6a/AC2\\]\\[RELY\\.6a/AC3\\] a failed send offers Retry and \"Another ",
  },
  {
    story: 'AUTO.1a',
    criteria: ['AUTO.1a/AC1', 'AUTO.1a/AC2', 'AUTO.1a/AC3'],
    file: 'media-app-routines.runtime.test.mjs',
    grep: "\\[AUTO\\.1a/AC1\\-AC3\\]\\[AUTO\\.2a/AC1\\] a routine starts the named screen with t|\\[AUTO\\.1a/AC3\\] a routine that cannot start is reported |\\[AUTO\\.2a/AC2\\]\\[AUTO\\.2a/AC3\\] a routine\\-started screen keeps its spot ",
  },
  {
    story: 'AUTO.2a',
    criteria: ['AUTO.2a/AC1', 'AUTO.2a/AC2', 'AUTO.2a/AC3'],
    file: 'media-app-routines.runtime.test.mjs',
    grep: "\\[AUTO\\.1a/AC1\\-AC3\\]\\[AUTO\\.2a/AC1\\] a routine starts the named screen with t|\\[AUTO\\.1a/AC3\\] a routine that cannot start is reported |\\[AUTO\\.2a/AC2\\]\\[AUTO\\.2a/AC3\\] a routine\\-started screen keeps its spot ",
  },
  {
    story: 'STEER.1a',
    criteria: ['STEER.1a/AC1'],
    file: 'media-app-steer-proof.runtime.test.mjs',
    grep: "\\[STEER\\.1a/AC1\\] laptop: while something plays here, a co|\\[STEER\\.1a/AC1\\] phone: while something plays here, a com|\\[STEER\\.1a/AC1\\] tablet: while something plays here, a co|\\[STEER\\.1b/AC1\\] the Remote lays its controls out like th|\\[STEER\\.1b/AC1\\]\\[STEER\\.1b/AC4\\] laptop: another screen's Remote shows th|\\[STEER\\.1b/AC1\\]\\[STEER\\.1b/AC4\\] phone: another screen's Remote shows the|\\[STEER\\.1b/AC1\\]\\[STEER\\.1b/AC4\\] tablet: another screen's Remote shows th|\\[STEER\\.6a/AC4\\] Stop also offers \"and turn the screen of|\\[STEER\\.7a/AC3\\]\\[STEER\\.7a/AC5\\] another screen's queue shows what is pla",
  },
  {
    story: 'STEER.1b',
    criteria: ['STEER.1b/AC1', 'STEER.1b/AC4'],
    file: 'media-app-steer-proof.runtime.test.mjs',
    grep: "\\[STEER\\.1a/AC1\\] laptop: while something plays here, a co|\\[STEER\\.1a/AC1\\] phone: while something plays here, a com|\\[STEER\\.1a/AC1\\] tablet: while something plays here, a co|\\[STEER\\.1b/AC1\\] the Remote lays its controls out like th|\\[STEER\\.1b/AC1\\]\\[STEER\\.1b/AC4\\] laptop: another screen's Remote shows th|\\[STEER\\.1b/AC1\\]\\[STEER\\.1b/AC4\\] phone: another screen's Remote shows the|\\[STEER\\.1b/AC1\\]\\[STEER\\.1b/AC4\\] tablet: another screen's Remote shows th|\\[STEER\\.6a/AC4\\] Stop also offers \"and turn the screen of|\\[STEER\\.7a/AC3\\]\\[STEER\\.7a/AC5\\] another screen's queue shows what is pla",
  },
  {
    story: 'STEER.6a',
    criteria: ['STEER.6a/AC4'],
    file: 'media-app-steer-proof.runtime.test.mjs',
    grep: "\\[STEER\\.1a/AC1\\] laptop: while something plays here, a co|\\[STEER\\.1a/AC1\\] phone: while something plays here, a com|\\[STEER\\.1a/AC1\\] tablet: while something plays here, a co|\\[STEER\\.1b/AC1\\] the Remote lays its controls out like th|\\[STEER\\.1b/AC1\\]\\[STEER\\.1b/AC4\\] laptop: another screen's Remote shows th|\\[STEER\\.1b/AC1\\]\\[STEER\\.1b/AC4\\] phone: another screen's Remote shows the|\\[STEER\\.1b/AC1\\]\\[STEER\\.1b/AC4\\] tablet: another screen's Remote shows th|\\[STEER\\.6a/AC4\\] Stop also offers \"and turn the screen of|\\[STEER\\.7a/AC3\\]\\[STEER\\.7a/AC5\\] another screen's queue shows what is pla",
  },
  {
    story: 'STEER.7a',
    criteria: ['STEER.7a/AC3', 'STEER.7a/AC5'],
    file: 'media-app-steer-proof.runtime.test.mjs',
    grep: "\\[STEER\\.1a/AC1\\] laptop: while something plays here, a co|\\[STEER\\.1a/AC1\\] phone: while something plays here, a com|\\[STEER\\.1a/AC1\\] tablet: while something plays here, a co|\\[STEER\\.1b/AC1\\] the Remote lays its controls out like th|\\[STEER\\.1b/AC1\\]\\[STEER\\.1b/AC4\\] laptop: another screen's Remote shows th|\\[STEER\\.1b/AC1\\]\\[STEER\\.1b/AC4\\] phone: another screen's Remote shows the|\\[STEER\\.1b/AC1\\]\\[STEER\\.1b/AC4\\] tablet: another screen's Remote shows th|\\[STEER\\.6a/AC4\\] Stop also offers \"and turn the screen of|\\[STEER\\.7a/AC3\\]\\[STEER\\.7a/AC5\\] another screen's queue shows what is pla",
  },
  {
    story: 'PLACE.5a',
    criteria: ['PLACE.5a/AC3', 'PLACE.5a/AC4'],
    file: 'media-app-verbs-proof.runtime.test.mjs',
    grep: "\\[PLAY\\.1a/AC1\\]\\[PLAY\\.1a/AC3\\]\\[PLACE\\.1a/AC3\\] Play now plays at the aim from search, b|\\[PLAY\\.1a/AC4\\]\\[PLACE\\.5a/AC3\\]\\[PLACE\\.5a/AC4\\] when the aimed screen is busy with someo|\\[PLAY\\.2a/AC1\\]\\[PLAY\\.2a/AC2\\]\\[PLAY\\.2a/AC3\\]\\[PLAY\\.3a/AC1\\]\\[PLAY\\.3a/AC2\\]\\[PLAY\\.3a/AC3\\] a whole collection plays from its first |\\[PLAY\\.5a/AC1\\]\\[PLAY\\.5a/AC2\\]\\[PLAY\\.6a/AC1\\]\\[PLACE\\.1a/AC3\\] Play next puts items right after what is|\\[PLAY\\.7a/AC1\\]\\[PLAY\\.7a/AC3\\] a whole collection can be played next or",
  },
  {
    story: 'PLAY.1a',
    criteria: ['PLAY.1a/AC1', 'PLAY.1a/AC4'],
    file: 'media-app-verbs-proof.runtime.test.mjs',
    grep: "\\[PLAY\\.1a/AC1\\]\\[PLAY\\.1a/AC3\\]\\[PLACE\\.1a/AC3\\] Play now plays at the aim from search, b|\\[PLAY\\.1a/AC4\\]\\[PLACE\\.5a/AC3\\]\\[PLACE\\.5a/AC4\\] when the aimed screen is busy with someo|\\[PLAY\\.2a/AC1\\]\\[PLAY\\.2a/AC2\\]\\[PLAY\\.2a/AC3\\]\\[PLAY\\.3a/AC1\\]\\[PLAY\\.3a/AC2\\]\\[PLAY\\.3a/AC3\\] a whole collection plays from its first |\\[PLAY\\.5a/AC1\\]\\[PLAY\\.5a/AC2\\]\\[PLAY\\.6a/AC1\\]\\[PLACE\\.1a/AC3\\] Play next puts items right after what is|\\[PLAY\\.7a/AC1\\]\\[PLAY\\.7a/AC3\\] a whole collection can be played next or",
  },
  {
    story: 'PLAY.2a',
    criteria: ['PLAY.2a/AC1', 'PLAY.2a/AC2'],
    file: 'media-app-verbs-proof.runtime.test.mjs',
    grep: "\\[PLAY\\.1a/AC1\\]\\[PLAY\\.1a/AC3\\]\\[PLACE\\.1a/AC3\\] Play now plays at the aim from search, b|\\[PLAY\\.1a/AC4\\]\\[PLACE\\.5a/AC3\\]\\[PLACE\\.5a/AC4\\] when the aimed screen is busy with someo|\\[PLAY\\.2a/AC1\\]\\[PLAY\\.2a/AC2\\]\\[PLAY\\.2a/AC3\\]\\[PLAY\\.3a/AC1\\]\\[PLAY\\.3a/AC2\\]\\[PLAY\\.3a/AC3\\] a whole collection plays from its first |\\[PLAY\\.5a/AC1\\]\\[PLAY\\.5a/AC2\\]\\[PLAY\\.6a/AC1\\]\\[PLACE\\.1a/AC3\\] Play next puts items right after what is|\\[PLAY\\.7a/AC1\\]\\[PLAY\\.7a/AC3\\] a whole collection can be played next or",
  },
  {
    story: 'PLAY.3a',
    criteria: ['PLAY.3a/AC1', 'PLAY.3a/AC2', 'PLAY.3a/AC3'],
    file: 'media-app-verbs-proof.runtime.test.mjs',
    grep: "\\[PLAY\\.1a/AC1\\]\\[PLAY\\.1a/AC3\\]\\[PLACE\\.1a/AC3\\] Play now plays at the aim from search, b|\\[PLAY\\.1a/AC4\\]\\[PLACE\\.5a/AC3\\]\\[PLACE\\.5a/AC4\\] when the aimed screen is busy with someo|\\[PLAY\\.2a/AC1\\]\\[PLAY\\.2a/AC2\\]\\[PLAY\\.2a/AC3\\]\\[PLAY\\.3a/AC1\\]\\[PLAY\\.3a/AC2\\]\\[PLAY\\.3a/AC3\\] a whole collection plays from its first |\\[PLAY\\.5a/AC1\\]\\[PLAY\\.5a/AC2\\]\\[PLAY\\.6a/AC1\\]\\[PLACE\\.1a/AC3\\] Play next puts items right after what is|\\[PLAY\\.7a/AC1\\]\\[PLAY\\.7a/AC3\\] a whole collection can be played next or",
  },
  {
    story: 'PLAY.5a',
    criteria: ['PLAY.5a/AC1', 'PLAY.5a/AC2'],
    file: 'media-app-verbs-proof.runtime.test.mjs',
    grep: "\\[PLAY\\.1a/AC1\\]\\[PLAY\\.1a/AC3\\]\\[PLACE\\.1a/AC3\\] Play now plays at the aim from search, b|\\[PLAY\\.1a/AC4\\]\\[PLACE\\.5a/AC3\\]\\[PLACE\\.5a/AC4\\] when the aimed screen is busy with someo|\\[PLAY\\.2a/AC1\\]\\[PLAY\\.2a/AC2\\]\\[PLAY\\.2a/AC3\\]\\[PLAY\\.3a/AC1\\]\\[PLAY\\.3a/AC2\\]\\[PLAY\\.3a/AC3\\] a whole collection plays from its first |\\[PLAY\\.5a/AC1\\]\\[PLAY\\.5a/AC2\\]\\[PLAY\\.6a/AC1\\]\\[PLACE\\.1a/AC3\\] Play next puts items right after what is|\\[PLAY\\.7a/AC1\\]\\[PLAY\\.7a/AC3\\] a whole collection can be played next or",
  },
  {
    story: 'PLAY.7a',
    criteria: ['PLAY.7a/AC1', 'PLAY.7a/AC3'],
    file: 'media-app-verbs-proof.runtime.test.mjs',
    grep: "\\[PLAY\\.1a/AC1\\]\\[PLAY\\.1a/AC3\\]\\[PLACE\\.1a/AC3\\] Play now plays at the aim from search, b|\\[PLAY\\.1a/AC4\\]\\[PLACE\\.5a/AC3\\]\\[PLACE\\.5a/AC4\\] when the aimed screen is busy with someo|\\[PLAY\\.2a/AC1\\]\\[PLAY\\.2a/AC2\\]\\[PLAY\\.2a/AC3\\]\\[PLAY\\.3a/AC1\\]\\[PLAY\\.3a/AC2\\]\\[PLAY\\.3a/AC3\\] a whole collection plays from its first |\\[PLAY\\.5a/AC1\\]\\[PLAY\\.5a/AC2\\]\\[PLAY\\.6a/AC1\\]\\[PLACE\\.1a/AC3\\] Play next puts items right after what is|\\[PLAY\\.7a/AC1\\]\\[PLAY\\.7a/AC3\\] a whole collection can be played next or",
  },
  // Phase 2a (proof gaps): P0 product features, exact-SHA runtime evidence on
  // the acceptance fixtures (live HLS channel, virtual receiver, offline
  // screen, seeded household, photo search result).
  {
    story: 'STEER.4a',
    criteria: ['STEER.4a/AC3'],
    file: 'media-app-p0-features-live.runtime.test.mjs',
    grep: 'STEER\\.4a/AC3',
  },
  {
    story: 'PLACE.6a',
    criteria: ['PLACE.6a/AC2'],
    file: 'media-app-p0-features-send.runtime.test.mjs',
    grep: 'PLACE\\.6a/AC2',
  },
  {
    story: 'HOUSE.2a',
    criteria: ['HOUSE.2a/AC2', 'HOUSE.2a/AC4'],
    file: 'media-app-p0-features-send.runtime.test.mjs',
    grep: 'HOUSE\\.2a/AC2\\+AC4',
  },
  {
    story: 'PLACE.7a',
    criteria: ['PLACE.7a/AC1', 'PLACE.7a/AC2'],
    file: 'media-app-p0-features-send.runtime.test.mjs',
    grep: 'HOUSE\\.2a/AC2\\+AC4',
  },
  {
    story: 'PLACE.7a',
    criteria: ['PLACE.7a/AC4'],
    file: 'media-app-p0-features-send.runtime.test.mjs',
    grep: 'PLACE\\.7a/AC4',
  },
  {
    story: 'FIND.8b',
    criteria: ['FIND.8b/AC2'],
    file: 'media-app-p0-features-find.runtime.test.mjs',
    grep: 'FIND\\.8b/AC2',
  },
  {
    story: 'FIND.8b',
    criteria: ['FIND.8b/AC3'],
    file: 'media-app-p0-features-find.runtime.test.mjs',
    grep: 'FIND\\.8b/AC3',
  },
  {
    story: 'FIND.1a',
    criteria: ['FIND.1a/AC5'],
    file: 'media-app-find-proof.runtime.test.mjs',
    grep: 'FIND\\.1a/AC5',
  },
  {
    story: 'FIND.8a',
    criteria: ['FIND.8a/AC2'],
    file: 'media-app-find-proof.runtime.test.mjs',
    grep: 'FIND\\.8a/AC2',
  },
  {
    story: 'RELY.13a',
    criteria: ['RELY.13a/AC1'],
    file: 'media-app-contrast-proof.runtime.test.mjs',
    grep: 'RELY\\.13a/AC1',
  },
  {
    story: 'PLAY.1a',
    criteria: ['PLAY.1a/AC5'],
    file: 'media-app-p0-features-find.runtime.test.mjs',
    grep: 'PLAY\\.1a/AC5',
  },
  {
    story: 'PLAY.5a',
    criteria: ['PLAY.5a/AC3'],
    file: 'media-app-p0-features-find.runtime.test.mjs',
    grep: 'PLAY\\.5a/AC3',
  },
  {
    story: 'STEER.1a',
    criteria: ['STEER.1a/AC4'],
    file: 'media-app-p0-features-steer.runtime.test.mjs',
    grep: 'STEER\\.1a/AC4',
  },
  {
    story: 'RELY.5a',
    criteria: ['RELY.5a/AC4'],
    file: 'media-app-p0-features-steer.runtime.test.mjs',
    grep: 'RELY\\.5a/AC4',
  },
  // Media proof gaps, batch B: defects found by the Phase 2b journeys, now fixed.
  {
    story: 'PLAY.2a',
    criteria: ['PLAY.2a/AC3', 'PLAY.7a/AC2'],
    file: 'media-app-verbs-proof.runtime.test.mjs',
    grep: '\\[PLAY\\.2a/AC3\\]\\[PLAY\\.7a/AC2\\] the confirmation of a whole',
  },
  {
    story: 'PLACE.8a',
    criteria: ['PLACE.8a/AC2'],
    file: 'media-app-move-proof.runtime.test.mjs',
    grep: '\\[PLACE\\.8a/AC4\\] hand\\-off from Now Playing with "Keep pla',
  },
  {
    story: 'PLACE.8a',
    criteria: ['PLACE.8a/AC3', 'PLACE.6a/AC4'],
    file: 'media-app-move-proof.runtime.test.mjs',
    grep: '\\[PLACE\\.8a/AC3\\]\\[PLACE\\.6a/AC4\\] hand\\-off from Now Playing with "Move play',
  },
  {
    story: 'PLACE.7a',
    criteria: ['PLACE.7a/AC3'],
    file: 'media-app-move-proof.runtime.test.mjs',
    grep: "\\[PLACE\\.7a/AC2\\] Move to this device from another screen'",
  },
  {
    story: 'RELY.1a',
    criteria: ['RELY.1a/AC1'],
    file: 'media-app-rely-proof.runtime.test.mjs',
    grep: '\\[RELY\\.1a/AC2\\]\\[RELY\\.1a/AC3\\]\\[RELY\\.1a/AC4\\] (laptop|phone|tablet): every change to what is lined up',
  },
  {
    story: 'HOUSE.2a',
    criteria: ['HOUSE.2a/AC1'],
    file: 'media-app-house-proof.runtime.test.mjs',
    grep: '\\[HOUSE\\.2a/AC1\\] (phone|laptop): each screen shows',
  },
  {
    story: 'AUTO.1b',
    criteria: ['AUTO.1b/AC1', 'AUTO.1b/AC2', 'AUTO.1b/AC3'],
    file: 'media-app-routines.runtime.test.mjs',
    grep: '\\[AUTO\\.1b/AC1\\-AC3\\] a routine can start playback on a named browser',
  },
  // Phase 3 (proof gaps): the P1/P2 rows closed by media-app-gaps-d-proof. The
  // StartedByLine in the controls header (HOUSE.5a/AC2) and room adjacency
  // (PLACE.4a/AC6) are product features; the rest are journeys on the fixtures.
  {
    story: 'HOUSE.4a',
    criteria: ['HOUSE.4a/AC1'],
    file: 'media-app-gaps-d-proof.runtime.test.mjs',
    grep: 'HOUSE\\.4a/AC1',
  },
  {
    story: 'HOUSE.5a',
    criteria: ['HOUSE.5a/AC2'],
    file: 'media-app-gaps-d-proof.runtime.test.mjs',
    grep: 'HOUSE\\.5a/AC2',
  },
  {
    story: 'HOUSE.6a',
    criteria: ['HOUSE.6a/AC4'],
    file: 'media-app-gaps-d-proof.runtime.test.mjs',
    grep: 'HOUSE\\.6a/AC4',
  },
  {
    story: 'PLACE.4a',
    criteria: ['PLACE.4a/AC6'],
    file: 'media-app-gaps-d-proof.runtime.test.mjs',
    grep: 'PLACE\\.4a/AC6',
  },
  {
    story: 'RELY.4a',
    criteria: ['RELY.4a/AC3'],
    file: 'media-app-gaps-d-proof.runtime.test.mjs',
    grep: 'RELY\\.4a/AC3',
  },
  {
    story: 'STEER.10a',
    criteria: ['STEER.10a/AC2'],
    file: 'media-app-gaps-d-proof.runtime.test.mjs',
    grep: 'STEER\\.10a/AC2',
  },
  {
    story: 'STEER.11a',
    criteria: ['STEER.11a/AC3'],
    file: 'media-app-gaps-d-proof.runtime.test.mjs',
    grep: 'STEER\\.11a/AC3',
  },
  {
    story: 'STEER.13b',
    criteria: ['STEER.13b/AC3'],
    file: 'media-app-gaps-d-proof.runtime.test.mjs',
    grep: 'STEER\\.13b/AC3',
  },
  {
    story: 'AUTO.4a',
    criteria: ['AUTO.4a/AC3'],
    file: 'media-app-gaps-d-proof.runtime.test.mjs',
    grep: 'AUTO\\.4a/AC3',
  },
  // Final integration: two Partial rows whose journeys already exist in media-app-steer-proof
  // (a screen that cannot seek/change speed says so; volume steps with large targets, local).
  {
    story: 'STEER.1b',
    criteria: ['STEER.1b/AC2'],
    file: 'media-app-steer-proof.runtime.test.mjs',
    grep: '\\[STEER\\.1b/AC2\\] controls a screen cannot support',
  },
  {
    story: 'STEER.5a',
    criteria: ['STEER.5a/AC1'],
    file: 'media-app-steer-proof.runtime.test.mjs',
    grep: '\\[STEER\\.5a/AC1\\] (laptop|phone|tablet): volume changes in steps',
  },
]);

const STABLE_ENTRIES = [...ACCEPTED_STORIES, ...SUPPORTING_ACCEPTED_CRITERIA];

function stableJourneyByCriterion() {
  return new Map(STABLE_ENTRIES.flatMap((entry) => entry.criteria.map((criterion) => [
    criterion,
    { story: entry.story, file: entry.file, grep: entry.grep },
  ])));
}

export function validateP0Manifest(entries) {
  if (!Array.isArray(entries)) throw new Error('P0 manifest must be an array');

  const criteria = new Set();
  const stories = new Set();
  const stableJourneys = stableJourneyByCriterion();

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') throw new Error('P0 manifest entry must be an object');
    if (typeof entry.story !== 'string' || !entry.story) throw new Error('story is required');
    if (!entry.file || !entry.grep) throw new Error(`journey required for ${entry.story}`);
    if (!Array.isArray(entry.criteria) || entry.criteria.length === 0) {
      throw new Error(`criteria required for ${entry.story}`);
    }

    stories.add(entry.story);

    for (const criterion of entry.criteria) {
      if (typeof criterion !== 'string' || !criterion) throw new Error(`invalid criterion for ${entry.story}`);
      if (criteria.has(criterion)) throw new Error(`duplicate ${criterion}`);
      criteria.add(criterion);

      const stableJourney = stableJourneys.get(criterion);
      if (stableJourney && (entry.story !== stableJourney.story
        || entry.file !== stableJourney.file
        || entry.grep !== stableJourney.grep)) {
        throw new Error(`invalid journey for ${criterion}`);
      }
    }
  }

  for (const [criterion] of stableJourneys) {
    if (!criteria.has(criterion)) throw new Error(`missing ${criterion}`);
  }

  return { stories: stories.size, criteria: criteria.size };
}

function requiredDirectory(env) {
  const evidenceDir = env.MEDIA_P0_EVIDENCE_DIR;
  if (!env.BASE_URL) throw new Error('BASE_URL is required');
  if (!evidenceDir) throw new Error('MEDIA_P0_EVIDENCE_DIR is required');
  if (!existsSync(evidenceDir)) throw new Error(`evidence directory does not exist: ${evidenceDir}`);
  return evidenceDir;
}

export function runP0Gate({ env = process.env, strict = false, execute, loadavg, cpus } = {}) {
  const entries = [...STABLE_ENTRIES, ...P0_EXTENSION_ENTRIES];
  const manifest = validateP0Manifest(entries);
  const evidenceDir = requiredDirectory(env);
  const outcome = runGroups({
    groups: groupedJourneys(entries),
    execute: execute || ((journey) => playwrightExecute(journey, { cwd: ROOT, env })),
    validate: validateReport,
    evidenceDir,
    strict,
    ...(loadavg ? { loadavg } : {}),
    ...(cpus ? { cpus } : {}),
  });
  return { manifest, ...outcome };
}

function main() {
  const strict = process.argv.includes('--strict');
  const { manifest, lines, exitCode } = runP0Gate({ strict });
  process.stdout.write(`${[`media-p0: ${manifest.stories} stories / ${manifest.criteria} criteria`, ...lines].join('\n')}\n`);
  process.exitCode = exitCode;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`media-p0: FAIL: ${error.message}\n`);
    process.exitCode = 1;
  }
}
