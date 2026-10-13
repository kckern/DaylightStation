# Singalong Transcript Sync — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update 112 hymn YAML files so the verse list matches what was actually performed in the `_ldsgc` recordings, using LLM subagents to compare noisy speech-to-text transcripts against canonical verse text.

**Architecture:** A two-phase dispatch: pilot 5 hymns first (review before proceeding), then full batch of remaining hymns in parallel. Each subagent reads one (YAML, transcript) pair, judges which verses were performed, and edits the YAML in place. No NLP — only LLM judgment.

**Tech Stack:** Claude Code Agent tool, YAML (flat files), no build step

---

## Context

### Paths

| Resource | Path |
|----------|------|
| Hymn YAMLs | `/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/content/singalong/hymn/` |
| Transcripts | `/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/media/audio/singalong/hymn/_ldsgc/` |

### YAML Edit Convention (established from `0232-let-us-oft-speak-kind-words.yml`)

**Skipped verse** — comment out every line of the verse block with `#`:
```yaml
#  - - Verse two line one
#    - Verse two line two
#    - Verse two line three
```

**Coda** — append as a new verse item at the end:
```yaml
  - - Kind words are sweet tones of the heart.
```

### Already-reviewed files — SKIP these

Files with `#` comment lines already contain manual edits and must not be re-processed:
- `0232-let-us-oft-speak-kind-words.yml`

### Subagent prompt template

Each subagent receives this prompt (fill in `{YAML_PATH}`, `{YAML_CONTENT}`, `{TRANSCRIPT_PATH}`, `{TRANSCRIPT_CONTENT}`):

```
You are comparing a hymn YAML against a noisy speech-to-text transcript of its _ldsgc recording.

YAML path: {YAML_PATH}
YAML content:
---
{YAML_CONTENT}
---

Transcript path: {TRANSCRIPT_PATH}
Transcript content:
---
{TRANSCRIPT_CONTENT}
---

Your job:
1. The YAML has N verses. Determine which were actually performed in the recording.
2. The transcript is very low-quality STT. Use LLM judgment — look for ANY recognizable
   content from each verse, even heavily garbled.
3. Check for a coda: musical content AFTER the last full verse — a repeated final line
   or tag phrase sung once more to close.

Rules:
- CONSERVATIVE: if you are uncertain whether a verse was omitted, leave it as-is.
- A verse is "missing" only if you can find NO recognizable content from it anywhere
  in the transcript.
- Do NOT change title, hymn_num, or any other metadata.
- Do NOT add any comment explaining WHY you commented a verse out — just comment the lines.

If edits are needed, use the Read tool to read the YAML, then Edit to apply changes:

Skipped verse format — prefix EVERY line of the verse block with `#`:
  Before:
    - - First line of verse
      - Second line
  After:
    #- - First line of verse
    #  - Second line

Coda format — append as a new verse item at the bottom of the verses list:
    - - Repeated closing phrase here.

After editing (or if no edits needed), report in this format:
  RESULT: <hymn-slug>
  VERSES_IN_YAML: <N>
  VERSES_PERFORMED: <list, e.g. 1,2,4>
  CODA: <yes/no + description, or none>
  CHANGES: <brief description or "none">
```

---

## Task 1: Pilot — 5 hymns

Dispatch these 5 agents **in parallel** (single message, multiple Agent tool calls):

| Slug | YAML | Transcript |
|------|------|------------|
| `0002-the-spirit-of-god` | `.../hymn/0002-the-spirit-of-god.yml` | `.../hymn/_ldsgc/0002-the-spirit-of-god.txt` |
| `0027-praise-to-the-man` | `.../hymn/0027-praise-to-the-man.yml` | `.../hymn/_ldsgc/0027-praise-to-the-man.txt` |
| `0030-come-come-ye-saints` | `.../hymn/0030-come-come-ye-saints.yml` | `.../hymn/_ldsgc/0030-come-come-ye-saints.txt` |
| `0085-how-firm-a-foundation` | `.../hymn/0085-how-firm-a-foundation.yml` | `.../hymn/_ldsgc/0085-how-firm-a-foundation.txt` |
| `0204-silent-night` | `.../hymn/0204-silent-night.yml` | `.../hymn/_ldsgc/0204-silent-night.txt` |

**Step 1:** Read each YAML and transcript file (10 reads total, can be parallel)

**Step 2:** Dispatch 5 agents in one message using the subagent prompt template above

**Step 3:** Collect all 5 RESULT reports

**Step 4:** Read each edited YAML and verify the changes look correct

**Step 5:** Pause — present the 5 RESULT reports to the user and ask: "Pilot looks correct — proceed with full batch?" before continuing.

---

## Task 2: Full batch — remaining 107 hymns

Skip `0232-let-us-oft-speak-kind-words` (already edited). Process all others.

Full slug list (107 hymns, split into 5 parallel batches of ~21 each):

**Batch A** (slugs 0001–0083):
```
0001-the-morning-breaks
0003-now-let-us-rejoice
0005-high-on-the-mountain-top
0006-redeemer-of-israel
0007-israel-israel-god-is-calling
0009-come-rejoice
0019-we-thank-thee-o-god-for-a-prophet
0021-come-listen-to-a-prophets-voice
0023-we-ever-pray-for-thee
0024-god-bless-our-prophet-dear
0026-joseph-smiths-first-prayer
0035-for-the-strength-of-the-hills
0041-let-zion-in-her-beauty-rise
0044-beautiful-zion-built-above
0052-the-day-dawn-is-breaking
0055-lo-the-mighty-god-appearing
0058-come-ye-children-of-the-lord
0064-on-this-day-of-joy-and-gladness
0066-rejoice-the-lord-is-king
0067-glory-to-god-on-high
0078-god-of-our-fathers-whose-almighty-hand
```

**Batch B** (slugs 0070–0134):
```
0070-sing-praise-to-him
0071-with-songs-of-praise
0072-praise-to-the-lord-the-almighty
0073-praise-the-lord-with-heart-and-voice
0075-in-hymns-of-praise
0081-press-forward-saints
0083-guide-us-o-thou-great-jehovah
0087-god-is-love
0090-from-all-that-dwell-below-the-skies
0094-come-ye-thankful-people
0096-dearest-children-god-is-near-you
0097-lead-kindly-light
0098-i-need-thee-every-hour
0100-nearer-my-god-to-thee
0103-precious-savior-dear-redeemer
0104-jesus-savior-pilot-me
0109-the-lord-my-pasture-will-prepare
0113-our-saviors-love
0116-come-follow-me
0117-come-unto-jesus
0127-does-the-journey-seem-long
```

**Batch C** (slugs 0129–0243):
```
0129-where-can-i-turn-for-peace
0131-more-holiness-give-me
0134-i-believe-in-christ
0135-my-redeemer-lives
0140-did-you-think-to-pray
0141-jesus-the-very-thought-of-thee
0147-sweet-is-the-work
0153-lord-we-ask-thee-ere-we-part
0156-sing-we-now-at-parting
0166-abide-with-me
0195-how-great-the-wisdom-and-the-love
0199-he-is-risen
0200-christ-the-lord-is-risen-today
0201-joy-to-the-world
0202-oh-come-all-ye-faithful
0208-o-little-town-of-bethlehem
0209-hark-the-herald-angels-sing
0213-the-first-noel
0220-lord-i-would-follow-thee
0221-dear-to-the-heart-of-the-shepherd
0223-have-i-done-any-good
```

**Batch D** (slugs 0227–0335):
```
0227-there-is-sunshine-in-my-soul-today
0228-you-can-make-the-pathway-bright
0237-do-what-is-right
0239-choose-the-right
0243-let-us-all-press-on
0249-called-to-serve
0252-put-your-shoulder-to-the-wheel
0256-as-zions-youth-in-latter-days
0258-o-thou-rock-of-our-salvation
0264-hark-all-ye-nations
0265-arise-o-god-and-shine
0270-ill-go-where-you-want-me-to-go
0272-oh-say-what-is-truth
0277-as-i-search-the-holy-scriptures
0294-love-at-home
0300-families-can-be-together-forever
0301-i-am-a-child-of-god
0303-keep-the-commandments
0304-teach-me-to-walk-in-the-light
0308-love-one-another
0319-ye-elders-of-israel
```

**Batch E** (slugs 0335–1208):
```
0335-brightly-beams-our-fathers-mercy
1001-come-thou-fount-of-every-blessing
1003-it-is-well-with-my-soul
1004-i-will-walk-with-jesus
1006-think-a-sacred-song
1008-bread-of-life-living-water
1009-gethsemane
1010-amazing-grace
1016-behold-the-wounds-in-jesus-hands
1020-softly-and-tenderly-jesus-is-calling
1021-i-know-that-my-savior-loves-me
1022-faith-in-every-footstep
1023-standing-on-the-promises
1033-oh-how-great-is-our-joy
1035-as-i-keep-the-sabbath-day
1039-because
1041-o-lord-who-gave-thy-life-for-me
1042-thou-gracious-god-whose-mercy-lends
1045-jesus-is-the-way
1048-our-prayer-to-thee
1207-still-still-still
1208-go-tell-it-on-the-mountain
```

**Step 1:** For each batch, read all YAMLs and transcripts (can pre-read in parallel)

**Step 2:** Dispatch all 5 batches simultaneously — one Agent call per hymn within each batch message

**Step 3:** Collect RESULT reports as agents complete

**Step 4:** Spot-check 5–10 edited YAMLs by reading them directly

---

## Task 3: Summary report

After all agents complete, read every edited YAML and compile:
- How many hymns had at least one verse commented out
- How many had codas added
- Any that reported uncertainty or anomalies

Present as a short table to the user.
