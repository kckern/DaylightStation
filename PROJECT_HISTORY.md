# Daylight Station: A Project History

Daylight Station began as a self-hosted household dashboard and grew into a
personal computing environment: a place where media, health, home automation,
learning, creative practice, physical devices, and family routines can share
one model of the household.

This is the story of that evolution. It is not an exhaustive changelog. It
groups the repository's commit history into the product ideas and capabilities
that emerged over time, with extra detail for the twelve months from September
2025 through August 2026.

> **History snapshot:** Commits reachable from `420e148`, through August 31,
> 2026. Dates are commit dates. Merge commits and iterative development commits
> are included in the period totals, so the counts describe activity rather
> than discrete features.

## The arc of the project

| Era | What Daylight Station was becoming |
| --- | --- |
| 2023 | A Dockerized React and Node application with its first external data source |
| 2024 | A personal finance and data-harvesting dashboard |
| Early 2025 | A household display, media player, health tracker, and Telegram nutrition assistant |
| Late 2025 | A sensor-aware family fitness room with resilient media playback |
| Early 2026 | A domain-driven platform for content, devices, agents, life planning, and multiple screens |
| Mid 2026 | A collection of purpose-built experiences: cycling, piano, art, games, news, and ambient displays |
| Late summer 2026 | A physical-digital homeschool system spanning screens, paper, calculators, scanners, and teacher workflows |

## Quarter-by-quarter history

### 2023 Q3 — The station comes online

**15 commits.** The first commits established the deployable shape of Daylight
Station. The application was Dockerized, the frontend and backend were
separated, the server-rendering experiment was removed, and a new client
framework took its place. The first “Infinity” API appeared in August,
establishing the pattern that would define the project: collect information
elsewhere, normalize it, and present it through a household-owned interface.

### 2023 Q4 — A pause after the foundation

**No commits recorded.** The repository history shows no fourth-quarter
development after the initial Docker, frontend, backend, and API foundation.

### 2024 Q1 — Harvesters and scheduled data

**15 commits.** In March, the frontend moved to Vite, backend code moved toward
ES modules, and harvesters began collecting data such as Last.fm history. New
media and Infinity tables appeared, while executable jobs, key handling, and a
crontab established scheduled collection as a core operating pattern.

### 2024 Q2 — The budget experiment begins

**1 commit.** A June “Budget WIP” commit marked the start of the first major
domain beyond data collection and media.

### 2024 Q3 — Personal finance becomes a product

**31 commits.** The budget experiment grew into a working finance surface with
a budget engine, shell generation, charts, short-term views, day-to-day spending,
payroll handling, budget blocks, unbudgeted-spending logic, and reloadable data.
Mortgage preparation, refinance fees, and a mortgage panel extended the model
from monthly cash flow to long-term household decisions.

This quarter established an enduring Daylight Station principle: raw personal
data becomes valuable when the station applies household-specific rules and
presents a decision, warning, or next action.

### 2024 Q4 — Consolidation and deployment preparation

**2 commits.** A budget memo captured the finance work and a December Docker
preparation commit readied the project for its next development cycle.

### 2025 Q1 — The dashboard becomes a household display

**90 commits.** After a quiet winter, development accelerated in March. Weather,
calendar events, upcoming items, health and weight trends, ClickUp tasks,
budgets, and mortgage data were assembled into a richer home display.

The first substantial media experience arrived alongside it: Plex video,
scripture reading, a queue, keyboard navigation, media routes, and a TV menu.
Daylight Station was becoming interactive rather than simply informational.

### 2025 Q2 — Media, nutrition, and health take shape

**272 commits.** April and May hardened the media foundation. The Player gained
autoplay, fades, shaders, playback speed, audio support, caching, queue behavior,
watch memory, watchlists, and Plex proxying. The menu became hierarchical and
remote-friendly, with content scrollers and shared playback controls. Early Art
and Journalist applications also appeared.

Nutrition grew from a food log into NutriList and Telegram workflows driven by
barcodes, UPC lookup, images, reports, and coaching. Health data arrived from
Withings, Garmin, Strava, and FitnessSyncer, while daily health views joined the
financial and media applications. The quarter closed with more modular storage,
data paths, and frontend organization.

### 2025 Q3 — Real-time household control and the fitness room

**213 commits.** July and August connected the growing set of applications.
WebSocket navigation gave displays a shared real-time command channel. Media
gained composite audio/video playback, per-item controls, dynamic volume,
continuous and shuffled queues, centralized keyboard handling, and office-TV
control.

Nutrition gained AI-assisted food classification and post-log coaching. The
recognizable application family emerged—Home, TV, Fitness, LifeLog, Nutrition,
and Gratitude—along with thermal printing and purpose-built television and kiosk
interfaces.

#### September 2025 — Fitness becomes a first-class environment

**93 commits.** The month began with smaller Gratitude, poetry, finance, and
printer improvements, but the center of gravity quickly moved to Fitness.

An ANT+ extension brought heart-rate and cadence sensors into the system, with
multi-dongle support, equipment mapping, device simulation, and user assignment.
The Fitness application gained Plex-backed shows and seasons, a sidebar and
participant roster, heart-rate zones, session persistence, coins and a
“treasure box,” and a dedicated player with queues, overlays, seek thumbnails,
and a responsive workout-room layout.

This was the point where Daylight Station stopped treating fitness as another
dashboard card. It became a live, multi-person, sensor-aware room.

### 2025 Q4 — Resilient playback and durable sessions

**394 commits.** The final quarter of 2025 turned the new fitness room into a
reliable household system. Playback resilience, sensor-driven governance,
durable session history, bots, coaching, and structured observability all grew
together. The station could now remember an experience, recover it, and use it
as context for another application.

#### October 2025 — Playback learns to survive the living room

**16 commits.** October was small in count but important in direction. The
shared Player was decomposed into smaller pieces and gained stall recovery,
queue hardening, playback diagnostics, dropped-frame reporting, adaptive video
bitrate, and health checks. Fitness device presentation was refined for
multiple heart-rate and cadence sensors.

The project was beginning to account for the realities of always-on kiosks:
weak networks, imperfect streams, touch and remote input, and displays that
must recover without an operator opening developer tools.

#### November 2025 — The workout becomes an orchestrated session

**138 commits.** Fitness gained kiosk behavior, resumable Plex playback,
voice-memo capture, music playlists, guest sensor assignment, microphone and
volume controls, screenshots, autosave, participant rosters, and camera-centric
vitals displays.

A governance system could now pause or challenge playback based on workout
requirements. The player accumulated a formal resilience layer with startup
watchdogs, seek intent, error recovery, hard-reset tracking, metrics, and
diagnostic overlays. Heart-rate zones and device state were no longer decorative
telemetry; they could change what the room did.

#### December 2025 — Sessions become durable household memory

**240 commits.** Fitness playback acquired watched-state and resume tracking,
session timelines, compact persisted data, race charts, volume boost, ambient
lighting tied to heart-rate zones, and reusable plugin surfaces for cameras,
charts, showcases, and pose detection.

At the same time, the surrounding platform widened. Structured logging was
rolled through the backend. NutriBot gained real UPC lookup, image input,
reports, adjustments, coaching, and household-scoped storage. Gratitude and
prayer cards could be selected and printed intelligently. A Journalist bot
started producing morning debriefs from calendar, mail, tasks, nutrition,
music, and journal context. Multi-user authentication, additional harvesters,
and a print-job queue closed the year.

The key shift was durability: activities, media progress, conversations, food,
and printed artifacts were becoming parts of a common household history.

### 2026 Q1 — From household application to household platform

**3,620 commits.** The first quarter of 2026 rebuilt Daylight Station's
foundations while rapidly expanding its scope. A domain-driven backend, common
content and screen frameworks, administration and identity, richer media,
agents, life planning, and physical-device workflows established a platform
that could support many purpose-built experiences without each inventing its
own infrastructure.

#### January 2026 — A platform replaces the original backend

**1,472 commits.** January was the architectural turning point. The backend was
reorganized around domain, application, adapter, API, and composition layers.
A versioned `/api/v1` surface, parity tests, cutover controls, configuration
services, integration discovery, household routing, centralized I/O, structured
logging, and tiered test harnesses replaced the earlier collection of routes
and scripts.

The new content domain introduced stable item identities and capabilities for
listing, playing, queueing, viewing, and reading. Plex, local files, Immich,
Komga, Audiobookshelf, singing, reading, and canvas/art sources could participate
through adapters. Watch state, search, smart selection, media composition, and
streaming were promoted into shared services.

User-facing work continued throughout the migration: piano MIDI visualization,
live notation, jump-rope support, a v3 fitness-session format, deep links,
simulation controls, voice memos, household device control, adaptive image and
video effects, and stronger playback telemetry. Agent orchestration and cost
tracking also appeared as new platform domains.

January changed the answer to “what is Daylight Station?” It was no longer one
large household app. It was a platform on which household applications could be
built consistently.

#### February 2026 — Content, feeds, administration, calls, and games

**1,352 commits.** The new architecture was exercised across several complete
product surfaces.

The Admin application gained content-list editing, drag-and-drop organization,
configuration editing, scheduler management, household and device management,
integration health, first-run setup, login, invitations, and role-aware access.
A configurable screen framework introduced widget registries, layouts, input
adapters, overlays, subscriptions, and data providers for keyboards, remotes,
and numpads.

The Feed and Reader systems became a “grounded feed”: RSS, Reddit, Google News,
YouTube, Plex, comics, books, and other sources flowed through allocation,
deduplication, dismissal, age, spacing, and pagination policies. The frontend
added masonry cards, a reading inbox, inline playback, and a shared mini player.

February also delivered Home Line one-to-one video calling with TV wake-up and
camera readiness checks; a native Android audio bridge; RetroArch launching and
scheduled access; a new Media application with queues, search, device presence,
casting, and cross-device playback state; and piano games including Tetris,
flashcards, Space Invaders, and a note-driven side scroller. Fitness gained
historical charts, printed receipts, stronger simulation, session leadership,
and Strava reconciliation.

#### March 2026 — The station learns context and intention

**796 commits.** The screen framework became the shared runtime for configurable
home and fitness screens, complete with nested panels, replaceable slots,
overlays, real-time subscriptions, and YAML-driven actions. Media gained
image-and-audio compositions, face-aware Ken Burns framing, title cards,
segmented playback, and a responsive three-panel browsing experience.

The largest new domain was LifePlan. Goals, beliefs, values, qualities, rules,
purpose, cadence, ceremonies, drift, alignment, feedback, and metrics formed a
model of intentional life. A Life application exposed dashboards, time-scale
views of the life log, plan editing, guided ceremonies, coaching chat, calendar
feeds, and an agent able to reason across the plan.

Health modeling advanced through calorie reconciliation, metabolic estimates,
nutrition adjustment, and a Health Coach that could deliver morning briefs,
exercise reactions, daily reports, and weekly digests. Other additions included
semantic pose and exercise detection, a weekly photo-and-calendar review with
voice capture, barcode and QR command infrastructure, an e-paper adapter, a
document-processing pipeline, and deeper mortgage analysis.

March connected the station's growing factual memory to plans, reflection, and
timely action.

### 2026 Q2 — The platform reaches into rooms and devices

**3,397 commits.** The second quarter joined software sessions to physical
places. Media could move across a live device fleet; cameras, NFC tags,
gamepads, bikes, pianos, printers, e-paper panels, speakers, and ambient sensors
became first-class participants. At the same time, complete experiences such as
Cycle Game, Art Mode, Playback Hub, NewsReporter, and the Piano kiosk showed what
the new architecture could support.

#### April 2026 — Screens and physical triggers become one system

**987 commits.** Fitness sessions became resumable and mergeable, gained a
suggestions engine and longitudinal views, and introduced cadence-driven cycle
challenges with audiovisual feedback. Health gained a unified dashboard, food
catalog, quick entry, historical charts, and direct web nutrition input.

The Media application was rebuilt around a durable local session engine and a
live device fleet. It could search and browse content, cast to one or many
screens, inspect remote sessions, take over playback, hand it off, acknowledge
commands, and persist state. Shared command contracts connected HTTP, WebSocket,
and device state.

Physical context also became a core input. Reolink cameras and Home Assistant
controls produced live camera cards and picture-in-picture doorbell views. NFC
and other state triggers were unified behind resolvers, guarded dispatch, named
responses, side effects, and unknown-tag workflows. Gamepads could drive menus,
and the home dashboard exposed live climate, motion, and lighting controls.

#### May 2026 — Household intelligence gets tools and guardrails

**836 commits.** A health archive, calibrated body-composition data, named
periods, historical comparisons, correlations, anomaly detection, personal
baselines, compliance tracking, and event drill-down gave the Health Coach a
much deeper evidence base. The Health interface gained streaming conversation,
tool attribution, mentions, and a persistent ask bar.

The agent framework was consolidated around shared runtimes, tool bundles,
policy decorators, transcripts, memory, streaming endpoints, and per-user
threads. The “brain” exposed an OpenAI-compatible endpoint and could perform
policy-gated voice media search. A new `dscli` made system health, Home
Assistant, content, finance, memory, agents, and other services available to
operators and automation without using the UI.

Late in the month, Playback Hub became a proper domain and Admin surface for
coordinating named speakers and headsets, schedules, volume bounds, targeted
commands, contention, health checks, and audio-flow verification. Fitness cycle
challenges and rider-selection hardware were hardened, while the shared player
gained clearer terminal-stall and close-watchdog behavior.

#### June 2026 — Purpose-built experiences bloom

**1,574 commits.** June was a burst of complete, distinctive applications.

The Cycle Game turned exercise bikes into a multi-rider race with cadence-based
distance, ghosts, laps, false starts, records, soundtracks, results, synthwave
graphics, and multiple broadcast visualizations. Fitness also gained dance
party lighting and music, menu music, improved guest handling, richer session
timelines, momentum views, and exercise-equipment automation.

Art Mode transformed screens into ambient museum displays with mattes, plaques,
diptychs, curated Immich collections, automatic crops, background music,
curtains, ambient-light dimming, and an Admin curation tool. E-paper panels
brought calendars, tasks, photos, color rendering, and telemetry to low-power
hardware. NewsReporter could assemble scheduled, AI-consolidated reports and
print them to receipt printers.

An EmulatorJS-based arcade added governed access, gamepad pairing, save ownership,
per-user resume, retro display treatments, and a unified game library. The Piano
kiosk expanded into courses, music, sheet music, lessons, recording, games,
instrument control, live notation, MIDI history, theory views, and a native
Android sound engine. By month end, Piano Producer offered a loop-layering song
workspace, while content filtering could mute, skip, blur, and explain authored
segments of media.

### 2026 Q3 — A household learning operating system emerges

**4,403 commits through August 31.** Creative practice, family games, physical
input, household policy, and education converged during the quarter. Piano grew
into a curriculum and assessment environment; shared gates, economy, triggers,
and dispatch linked activities across rooms; and School expanded from a quiz
app into an accountable physical-digital learning system.

#### July 2026 — Creative practice meets household learning

**2,230 commits.** Piano became a serious learning and creation environment.
Producer grew into a touch-first song builder with loop capture, overdubbing,
arrangement, harmonic suggestions, synth routing, and saved drafts. Sheet music
gained engraving-quality rendering, Listen/Learn/Polish/Perform modes, hand
selection, looping, metronome scheduling, measure-level scoring, practice
history, live note feedback, and resilient kiosk support. Courses, karaoke,
play-along material, personal sound presets, and a reorganized curriculum were
unified into the kiosk.

Several household-wide systems appeared alongside it. GameShow provided a
Jeopardy-style TV game with physical buzzers, teams, scoring, audio cues, saved
sessions, and a phone host controller. The Economy domain introduced household
coins, earning policies, metered spending, and paid piano/game activity. Trigger
handling unified NFC, barcodes, state changes, HTTP endpoints, scripts, and
screen commands. DoNow added presence-aware, approval-aware dispatch of “start
this, there, now” requests across household surfaces.

Most consequentially, the first School application shipped. It began with
learner identity, quizzes, flashcards, grading, and a subject-oriented media
catalog, then expanded into course progress, geography drills, typing, language
study, worksheets, parental approval, and quiz gates. By the end of the month,
it had curriculum contracts, planners, work sessions, printable PDFs and
receipts, OMR grading, opaque action tokens, virtual hardware, scan-to-screen
launching, review queues, and daily agendas. Daylight Station was becoming a
homeschool operating system rather than merely hosting educational content.

#### August 2026 — The physical-digital school comes together

**2,173 commits.** August concentrated on making School complete, accountable,
and usable across real household hardware.

Curriculum acquired surface certification so a lesson could prove it worked on
paper, a screen, or a TI-86 calculator before publication. The print system
gained a workbook design language, rich document blocks, deterministic variants,
teacher keys, OMR allocation, tracked quizzes, exact reprints, scan diagnostics,
durable evidence, report cards, and retained artifacts. The teacher console
grew Today, Planning, Records, and Repair workspaces with PIN-gated actions,
assignments, periods, milestones, overrides, review queues, learner-day
drill-downs, report PDFs, audit trails, and catalog-drift handling.

SchoolCalc connected adaptive study and offline continuation to TI-86 hardware.
OMR readers, a keypad, QR scanning, Bluetooth presence, pressure mats, and
physical relays became observable, recoverable parts of the system. New school
programs covered rich flashcards, geography, Glossika language study, Language
Reels, Rubik's Cube, story time, exercise anatomy, and piano courses. Daily
planning became enrollment-, schedule-, and date-aware, while scan ceremonies,
status boards, receipts, and launch cards made physical work visible on screens.

The shared Player gained enforceable media gates and comprehension checkpoints.
Piano adopted a daily lesson gate, practice-before-games rules, server-held time
budgets, common assessment services, exercise practice, Piano Hero, card battles,
and chord-addressed board games backed by Stockfish and a shared opponent
platform.

Outside School, the classical Surround system enriched performances with
movement maps, composer and performer context, translations, structural rails,
and cross-item seeking. Gaming gained a unified runtime and party-game design
system. Fitness added study-mode video controls and weekly “rings.” State Gates
then connected School and Fitness policies to the broader station.

By the end of August, the original dashboard had evolved into a coordinated
household environment. Data could arrive from APIs, sensors, scanners,
calculators, cameras, instruments, and people; domain services could interpret
it; and the result could return through TVs, tablets, speakers, bots, printers,
e-paper panels, or physical learning workflows.

## What has remained constant

The implementation has changed radically, but the project's direction has been
consistent:

- **Self-hosted first.** Household data and policy remain under household control.
- **Context over dashboards.** Information should appear where and when it is useful.
- **Purpose-built surfaces.** A TV, piano tablet, receipt, phone, and calculator should not pretend to be the same interface.
- **Integration creates value.** Media becomes better with fitness context; learning becomes better with paper, presence, and devices; health becomes better with history and reflection.
- **The household is the system boundary.** People, rooms, devices, schedules, and shared memory are modeled together.

That continuity is the clearest history of Daylight Station: each generation of
the project has brought more of the household into one intentional, locally
owned conversation.
