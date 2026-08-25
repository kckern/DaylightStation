# Language Reels — Product Requirements

## Status and purpose

**Status:** initial implementation in progress. The imported source collection is
draft-only; a reel remains unavailable to learners until its authored record is
reviewed and marked `approved`.

Language Reels is a new School language-learning program, adjacent to Sentence
Ladder. It turns a short authentic-language reel into a sequence of preparation,
listening, guided reconstruction, watching, comprehension, and optional spoken
participation. Sentence Ladder remains the sentence-level, corpus-progression
program; Language Reels is a self-contained scene-comprehension experience.

The initial source collection is already arranged in topical folders, such as
`Language_Practice`, `Food_Dining`, and `Workplace`. Each sampled reel has a
matched MP4, SRT, and YAML file. YAML currently supplies a Korean transcript,
vocabulary with English definitions/examples, and sometimes grammar notes. SRT
supplies the spoken-line time bounds. The production program must normalize this
material rather than use an inbox folder as a runtime API.

## Learning outcomes

After a reel, the learner should be able to recognize high-value words and
phrases, follow the audio before relying on visuals, reconstruct selected lines
from context, understand the scene, and answer questions about its meaning. When
speaking is enabled, the learner also hears their voice participate in the reel.
This is a low-pressure experience, never a pronunciation assessment.

## Daily assignment policy

An enrolled learner may receive one Language Reel per School study day. At
agenda creation the server chooses a category first, then a reel from that
category; the selected pair is persisted against the study-day key so a
reprinted agenda does not reshuffle the learner's work. Only reviewed,
`approved` reels enter that selection pool. An empty approved pool produces no
Language Reel offer rather than exposing an unreviewed import.

## Scope

### In scope

- A dedicated School program beside Sentence Ladder.
- Short, authored reels with timed transcript and a resolver-backed media asset.
- A resumable sequence: optional flashcards, audio-only listen, line cloze,
  full watch, comprehension, then optional speaking.
- Four-choice formative cloze with one answer and credible author-reviewed
  decoys.
- A short, authored listening-comprehension quiz.
- Optional microphone capture, review, re-record, and time-aligned replay of
  selected learner lines.
- Durable learner progress/attempt evidence and host-agnostic media resolution.

### Not in scope

- Speech recognition, pronunciation/accent scoring, or correctness grading of
  audio recordings.
- Isolating a person’s voice from a normal mixed MP4 soundtrack.
- Unreviewed arbitrary-video import, video editing, live conversation, or a
  teacher visual-authoring UI.
- Replacing Sentence Ladder's corpus, rungs, or daily queue.
- Offline downloads or persistent learner audio by default.

## Learner flow

The activity is linear and clearly shows the current stage. A learner may replay
the current media or leave and resume. The server records durable progress; the
browser must not be the source of truth. Permission, autoplay, and media errors
must offer recovery and must never silently complete a stage.

### 1. Optional preparation flashcards

The author selects a small deck of high-value words/set phrases. Cards normally
show target text first and English definition, contextual example, and optional
audio after reveal. Use the existing School flashcard presentation where its
contract fits, but scope the deck to the reel session.

Cards may support later cloze answers, but not every cloze answer needs a card.
The cloze stage must remain a contextual listening exercise rather than a
trivial recall of the immediately preceding screen. An author can omit this
stage where vocabulary priming adds no value.

### 2. Audio-only first listen

The learner presses Play and hears the complete reel without video, captions,
or transcript text. It uses the same media asset later used for watching; the
video surface is simply hidden. Provide play/pause, restart, seek,
elapsed/duration, and volume controls. The learner must reach the end once;
replays remain available.

Autoplay is not required. A learner-initiated first Play establishes browser
audio activation. Failed playback shows a retry state and does not advance.

### 3. Guided line reconstruction

Selected transcript lines appear one at a time with one word, phrase, or
grammatical unit blanked. Four choices appear below: exactly one answer and
three plausible decoys. The learner can replay the timed line clip, selects an
answer, receives immediate feedback, and retries when wrong. The full
transcript is hidden during this stage.

Authors must avoid giveaway blanks: ungrammatical decoys, mismatched register,
word-length clues, or multiple technically correct options. Decoys can be
plausible by sound, meaning, grammar, or topic. First response, retries, and
eventual correctness are retained. Completion requires each required item to be
correct at least once; this is formative evidence, not a high-stakes score.

### 4. Full video watch

The learner now watches the original reel normally. Captions are off by default
for the first watch. Afterwards, target-language captions/transcript can be
revealed; an English translation, if authored, is behind an explicit reveal.
Completion requires reaching the end once; rewatching is always available.

### 5. Listening comprehension

The learner answers three to five authored questions about meaning, intention,
sequence, relationship, setting, or important details. The questions must not
only re-ask cloze blanks. Use existing School question-bank types where they
fit (initially multiple choice; later matching, short answer, and cloze). The
author defines the pass rule. This stage records durable assessment evidence
separately from flashcard and formative-cloze activity.

## Optional speaking: Voice-in-the-Reel

Voice-in-the-Reel is an opt-in final stage. It is available only when the reel
declares selected speaking segments and the device has a microphone. It lets a
learner record selected timed lines, then replay the reel with those recordings
at the selected moments.

For each segment, the program must:

1. show the target-language prompt;
2. let the learner replay the source/model line before recording;
3. request microphone permission only after a learner action;
4. record a take, offer review, and allow re-recording;
5. accept a take without assessing it; and
6. offer the synchronized final replay after all required segments are accepted.

During replay, the source media continues visually. Source audio is muted for a
selected replacement window while the learner’s accepted recording plays.
Learners can replay the result and re-record before leaving. A denied mic,
recording failure, or unavailable mic offers **Skip speaking for this reel**;
it does not block the core activity.

For a dialogue, authors typically choose one speaker’s non-overlapping turns,
so the learner takes that side while hearing the counterpart’s original turns.
For a monologue, authors choose a smaller set of key sentences or phrases, so
the learner participates without having to perform the full narration. Both use
the same segment configuration; they are not separate activity types.

### Essential audio constraint

SRT tells us *when* a line occurs, not how to separately control that speaker's
voice. A normal MP4 contains a mixed soundtrack, so the browser cannot mute
only one person while retaining simultaneous music, effects, or overlapping
speech. The first implementation therefore mutes the **entire source audio**
during each selected window and plays the learner’s take in its place. This is
appropriate for clean, non-overlapping turns and selected monologue lines.

If background sound must continue beneath the learner, the media pipeline needs
a backing/stem track or an authored clip with the target voice removed. That is
a separate future capability, not something an SRT alone can provide.

## Content contract

Each reel is an authored, versioned unit. A loader may ingest the existing
MP4/SRT/YAML trio, but runtime code consumes normalized content. Example:

```yaml
schema: school.language-reel/v1
id: korean-language-practice-introductions-001
title: Formal introductions
languages: { source: en, target: ko }
media:
  assetId: media://language-reels/korean/introductions-001
transcript:
  - id: l01
    startMs: 1
    endMs: 1240
    text: 안녕하십니까?
    speaker: a # optional; useful for dialogue authoring
vocabulary:
  - id: country
    term: 나라
    definition: country
    exampleLineId: l04
cloze:
  - id: c01
    lineId: l04
    prompt: 어느 [blank] 사람입니까?
    answer: 나라
    decoys: [이름, 직업, 학교]
comprehension:
  bankId: language-reels/korean/introductions-001-comprehension
  requiredCount: 3
speaking:
  enabled: true
  segments:
    - lineId: l01
      prompt: 안녕하십니까?
      replacementPaddingMs: { before: 0, after: 100 }
```

The API returns the normalized activity and a browser-playable `playbackUrl`.
Frontend code must not construct Plex URLs or expose filesystem paths. A resolver
can later use a media directory, Plex, proxy, or other provider without changing
authored reel content. Return media type, known duration, optional poster, and
seek/range capability with the resolved URL. Audio-only and video stages must
use the same asset/revision.

### Content validation

- Stable IDs are unique; all `lineId` and vocabulary references resolve.
- Transcript lines have `startMs < endMs`, are time ordered, and fit known
  duration when available.
- A cloze has exactly one blank, one answer, exactly three distinct decoys, and
  no decoy identical to the answer.
- Speaking windows do not overlap each other; authors resolve overlapping
  dialogue deliberately before publication.
- Resolved media is authorized and playable by supported browser media.
- A standard publishable reel includes cloze and comprehension. Flashcards and
  speaking are optional.

## Progress, resume, and recording retention

Record reel ID, immutable content revision, learner, timestamps, per-stage
completion, media completion events, every cloze attempt, issued comprehension
answers/results, and speaking status (`completed`, `skipped`, `unavailable`, or
`failed`). Flashcard, formative cloze, assessment, and completion signals must
remain distinct in reporting. An incomplete activity resumes at the first
required incomplete stage. Content revisions do not overwrite historical
assessment evidence.

The initial retention policy should be **session-only takes**: accepted audio
exists long enough to construct the final Voice-in-the-Reel replay, then is
discarded at session expiry. Persisting recordings requires a separate explicit
privacy, storage, access, and deletion decision. It is not necessary to grant
speaking completion credit.

## Functional and quality requirements

1. Learners can discover assigned/available reels by title, topic, and target
   language.
2. Enabled stages appear in configured order; disabled optional stages vanish
   without broken progress.
3. A line can be replayed without losing its in-progress cloze response.
4. The feature is touch-first, with keyboard behavior as enhancement.
5. The speaking feature is hidden where no mic or no segments exist, and never
   claims to grade speech.
6. All controls have visible labels and usable focus/touch targets; playback,
   current stage, and recording state are accessible.
7. Target scripts, including Korean, render without clipping or font fallback.
8. The microphone has a visible active indicator, is released between takes,
   and captured tracks/object URLs are cleaned up on error and navigation.
9. Media-host changes require no authored-schema migration.
10. Authors can validate and preview timing, cloze, and replacement windows
    before publication; initial developer tooling is sufficient.

## Architecture direction

Create a sibling program module rather than inserting reel state into Sentence
Ladder. Reuse School identity/session guardrails, question-bank runner,
flashcard presentation, capability detection, structured logging, and the
existing microphone-capture pattern where appropriate. Keep reel sequencing,
transcript timing, media resolution, and replacement playback in a dedicated
Language Reels module/domain.

The player needs a clock-authoritative design. The media element timeline can
drive the first version, but all selected-window behavior must be deterministic
on seek, pause, resume, and replay. A Web Audio graph is a later refinement if
timer drift, gain envelopes, or separate backing tracks demand it.

## Delivery slices

### A. Core learning loop

- Normalize and validate a small pilot set of current reels.
- Build resolver-backed media playback.
- Deliver audio-only, cloze, full watch, multiple-choice comprehension, durable
  progress, and structured logging.

### B. Learning-quality tooling

- Add vocabulary flashcards from existing YAML vocabulary.
- Add richer question-bank types, caption/transcript reveal, author validation,
  preview, and topical browsing.

### C. Voice-in-the-Reel

- Add mic capability gating, record/review/re-record, session-only takes, and
  non-overlapping replacement-window replay.
- Test permission denial, seek/pause/resume, replay, and cleanup paths.

### D. If content requires it

- Add backing/stem tracks or author-supplied voice-removed clips.
- Consider persistent recordings or speech feedback only after separate policy
  and research work.

## Initial acceptance criteria

1. A validated reel can reference one asset, timed lines, at least two clozes,
   and three comprehension questions.
2. A learner completes enabled stages in the required order: preparation,
   audio-only listen, cloze, full watch, comprehension, optional speaking.
3. Audio-only hides moving video and transcript, while the later stage plays
   the same asset as video.
4. Required clozes cannot advance until correct, but can replay their line.
5. Refreshing resumes the appropriate stage for the learner/content revision.
6. Content holds no Plex URL or filesystem path; resolver changes do not change
   reel documents.
7. Media/microphone failure is recoverable and never false-completes progress.
8. The final questions test whole-reel comprehension, not merely blanked words.

## Decisions still needed

- Are reels assigned by parent/teacher queue, freely browsed by topic, or both?
- Does flashcard evidence feed a broader vocabulary system or only this session?
- What is the default comprehension pass rule?
- Is preparation skippable when authored?
- Can speaking ever be required when hardware exists, or is it always optional?
- What exact session expiry applies to temporary recordings?
- What visual treatment should audio-only use: a quiet static card, waveform,
  or intentionally minimal listening screen?
- Which current SRTs need human cleanup for speaker labels, laughter/non-speech
  cues, timing, and natural cloze-sized segments before a pilot?
