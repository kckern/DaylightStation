# Life App — User Journey

**Last Updated:** 2026-07-09
**Status:** Design reference. Steps marked **[EXISTS]** are implemented today; **[PARTIAL]** works but is unfinished; **[GAP]** is proposed design that has no implementation yet. The gap markers make this doc double as a UX roadmap.

---

## The Person

**Maya, 41.** Project manager, married, two kids, trains for a half-marathon in the garage before work. She is organized at work and scattered at home: goals live in her head, resolutions evaporate by February, and she suspects her time doesn't go where her values are. She is not a productivity hobbyist — she will not maintain a system that demands maintenance. She already generates data without trying: workouts (Strava), calendar, a task app, family photos.

Two cold-start variants of Maya matter, because the system must onboard both:

| Variant | Plan file | Lifelog data | Implication |
|---------|-----------|--------------|-------------|
| **Data-rich cold start** | none | months of workouts, calendar, tasks already harvested | The system can *show her herself* before asking her anything |
| **True cold start** | none | nothing | Everything must come from conversation and quick instruments; the log fills in behind her |

The design rule that follows: **never ask for what the system can observe, and never generate what only she can say.** Time allocation, activity patterns, streaks — observable. Purpose, values ranking, what a goal *means* — only hers.

---

## Journey at a Glance

```
 Phase 0          Phase 1              Phase 2           Phase 3            Phase 4
 DISCOVERY   →    ONBOARDING      →    DAILY LOOP   →    WEEKLY CYCLE  →    MONTHLY+
 "what is        "minimum viable      morning nudge     retro ritual       phase review,
  this?"          plan in 15 min"     evening capture   drift check        belief verdicts,
                  + coach fills                                            season/era vision
                  gaps over 2 weeks
                                      ←──────  LAPSE & RECOVERY loops back in  ──────
```

Each step below is described in beats: **Cue** (what pulls her in) → **Feeling** → **Intent** → **Sees** → **Does** → **System responds**.

---

## Phase 0 — Discovery: Entry Points

The app has no single front door. Maya can arrive through any of these, and each colors her first impression:

| # | Entry point | Status | How it happens | Her state of mind |
|---|-------------|--------|----------------|-------------------|
| E1 | **Direct URL** `/life` | [EXISTS] | Spouse mentions it; bookmark on the family tablet | Curious, low commitment, will bounce in 60s if confused |
| E2 | **Telegram nudge** | [EXISTS] | Ceremony reminder or coach message with a "Begin" action | Interrupted mid-life; will act only if one tap gets her there |
| E3 | **Coach chat** `/life/coach` | [EXISTS] | She asks the household bot a life-adjacent question and gets referred | Conversational, expects dialogue not UI |
| E4 | **Weekly Review TV ritual** | [EXISTS, separate surface] | Sunday couch ritual browsing the week's photos while narrating aloud (see [weekly-review.md](./weekly-review.md)) | Reflective, relaxed, voice-first — the natural feeder into life planning |
| E5 | **Post-workout / post-event moment** | [GAP] | Fitness recap or calendar wrap-up offers "log how that felt" deep link | Endorphins up; 30-second attention window |
| E6 | **In-app notification** | [PARTIAL — WebSocket channel broadcasts; no UI renders it] | Notification appears inside any DaylightStation surface | Already in the ecosystem, one click away |

**Decision point D0 — the first 60 seconds.** Whatever the entry, a user with no plan lands on a dashboard built to render a plan. Today `/life/now` renders empty charts for her **[GAP — no empty-state]**. The design requirement: an empty plan must never show empty widgets. It must show *one sentence and one button*: "You don't have a life plan yet. Talk to your coach for ten minutes and you'll have one." → routes to Phase 1. Secondary link, small: "I'd rather look around first" → Log views (which work with zero plan, and with lifelog data are genuinely impressive — the data-rich Maya sees her actual year at a glance and thinks *it already knows me*).

---

## Phase 1 — Onboarding: From Nothing to a Minimum Viable Plan

### Design position (the "how should this even work?" question)

Four elicitation methods were considered; onboarding uses **all four, each where it is strongest**, rather than picking one:

| Method | Where it wins | Where it fails |
|--------|--------------|----------------|
| **Blank form / free authoring** | Power users, later editing in Plan views | Blank-page paralysis; the domain model (beliefs! cadences! qualities!) is jargon to a newcomer |
| **Structured wizard** | Mechanical config: cadence, notification channels | Sterile for meaning-laden content; purpose does not come from a dropdown |
| **Card-sort / multiple choice instrument** | Ranking values fast, low friction, works on tablet/TV | Can't capture *why*; produces generic answers if used alone |
| **Coach interview (lifeplan-guide agent)** | Purpose, goal meaning, belief surfacing — things that emerge from stories | Exhausting if it's a 45-minute interrogation up front |
| **Generation from evidence (lifelog)** | Time-allocation baseline, candidate goals ("you ride 3x/week — is that serving a goal?"), later belief evidence | Cannot know what matters to her; generated-only plans feel imposed and get abandoned |

**The governing principle: *seed in one sitting, deepen over two weeks.*** Onboarding is not a gate she passes; it's a first conversation that produces a deliberately incomplete plan, plus a cadence of tiny follow-ups that finish it while she's already using the app. Nothing blocks daily use on plan completeness.

### 1.1 First session — "Fifteen minutes to a plan" [GAP — flow does not exist; coach + plan model do]

**Cue:** The empty-state button ("Talk to your coach") or E3 directly.
**Feeling:** Guarded. She has been burned by onboarding quizzes that produce a horoscope.
**Intent:** "Show me this is worth it before I invest."

The session is a chat with the lifeplan-guide agent, structured as five short movements. The agent writes plan sections *as she talks* (it has plan tools), and — critically — **shows her each artifact as it lands** ("Here's what I've got so far" cards inline in chat), so she watches the plan assemble instead of trusting a black box.

| Movement | Agent asks / does | Her input | Plan artifact produced |
|----------|-------------------|-----------|------------------------|
| **a. Orientation** (1 min) | One-paragraph promise: "I'll ask a few questions, you'll leave with a working plan, and everything is editable later. Nothing is graded." | — | — |
| **b. Values card-sort** (3 min) | Presents ~12 value cards (Health, Family, Craft, Faith, Adventure, Security…), asks her to pick five that resonate, then drag-rank them. Multiple-choice instrument embedded in chat, not free text. **[GAP — card-sort UI]** | Taps + drag | `values[]` with ranks |
| **c. Evidence mirror** (2 min, data-rich variant only) | Shows her actual last-30-days time allocation from lifelog next to her freshly ranked values: "You ranked Health #2 — it's already 4 hrs/week of your time. You ranked Craft #3 — I can't see any time going there. Fair?" | Reacts, corrects | Baseline drift snapshot; trust ("it sees the real me") |
| **d. Goals, not resolutions** (5 min) | "Pick one or two things — not five — you'd genuinely like to be different by [next season boundary]." Coach probes each: what does done look like, what's the first milestone, what would block it. Offers lifelog-derived candidates in the data-rich case ("formalize the half-marathon?"). | Conversation | 1–2 `goals[]` in `considered`/`ready` state with a milestone each |
| **e. One belief, planted** (3 min) | Translates jargon: "You said mornings are when training actually happens. Let's make that a testable bet: *if I train before 8am, I'll actually train.* I'll quietly collect evidence and tell you if you're right." | "sure" | 1 `beliefs[]` entry in `hypothesized`; belief system introduced as *a bet the system checks*, not homework |
| **f. Cadence + consent** (1 min) | "I'll check in each morning (what matters today) and evening (how it went), and we'll review Sundays. Where should nudges land — Telegram, phone push, or only in-app?" Explicit consent per channel. **[PARTIAL — channels exist; no consent UI, routing is a hardcoded default]** | Picks channels/times | `cadence`, `ceremonies` enablement, notification prefs |

**Exit state:** a real `lifeplan.yml` — 5 ranked values, 1–2 goals, 1 belief, cadence set. Purpose is *deliberately not asked yet* (see 1.3). The coach closes with the contract: "Tomorrow morning I'll send your first check-in. Two minutes, tops."

**Feeling at exit:** mild surprise ("that was painless") + a visible artifact she can point at. The Plan views now render real content she recognizes as her own words.

**Decision point D1 — she abandons mid-session.** Every movement writes incrementally; quitting after (b) still leaves ranked values. The next entry resumes where she left off ("We got your values down last time — 5 more minutes to set a goal?"). **[GAP — resume logic]**

### 1.2 The first 48 hours — proving the loop

**Cue:** 7:00am Telegram: *"Set your intentions — Your unit intention ceremony is due. [Begin]"* **[EXISTS — scheduled daily, deep-links to `/life/ceremony/unit_intention`]**
**Feeling:** Test-drive skepticism: "let's see if this is actually two minutes."
**Sees:** Ceremony flow — her 1–2 active goals listed, prompt for today's intentions, an energy selector. **[EXISTS]**
**Does:** Types one line ("intervals at 6, no phone after 9"), taps energy, done.
**System:** Records the ceremony (dedupes the nudge for the rest of the day), thanks her in one line. Evening variant (`unit_capture`) mirrors it: "How did today actually go?" against this morning's intentions.

This 48-hour window is where habit either takes or dies. Rules that protect it:
- Nudges arrive **once** per ceremony per period — completing it silences it. [EXISTS via ceremony-record dedupe]
- The ceremony never guilt-trips a miss. Yesterday's blank is just blank.
- Reply-in-Telegram (answer the nudge inline without opening the app) is the ideal for this step. **[GAP — actions render as buttons but only deep-link]**

### 1.3 Coach micro-interviews — finishing the plan while she uses it [GAP]

Instead of a long day-one interrogation, the coach's daily `CadenceCheck` assignment **[EXISTS as a scheduled agent job]** carries *one* extra question on days 2–14, chosen by what's missing:

| Day ~ | Micro-question | Fills |
|-------|----------------|-------|
| 2 | "You ranked Family #1. What does a *good* family week actually look like?" | `qualities` — her words become quality descriptions |
| 4 | "What's something you keep doing that you wish you didn't?" | `anti_goals` / shadow material |
| 6 | "When you're 80, what do you want to have been true?" (only now, with trust built) | `purpose` draft — the coach drafts a statement *from her own answers*, she edits/approves; it is never generated from nothing |
| 9 | "Your bet about morning training: 4-for-5 this week. Feel right?" | first belief evidence conversation |
| 12 | "Anything you believed about yourself that this month is disproving?" | second belief, `hypothesized` |

Each is answerable in one Telegram reply. Each answer is written into the plan and *shown back* ("added to your plan — edit here"). By the end of week two the plan has purpose, qualities, and 2–3 live beliefs, and Maya never sat through an interview.

**Decision point D2 — she ignores the micro-questions.** They stop after two consecutive ignores and retry the following cycle. The plan remains functional without them; missing sections just render as gentle "not yet defined — want the coach to ask you about this?" affordances in Plan views. **[GAP]**

---

## Phase 2 — The Daily Loop (steady state)

| Beat | Cue | Feeling | Sees | Does | System |
|------|-----|---------|------|------|--------|
| **Morning intention** | 7:00 Telegram nudge [EXISTS] | Routine, 90 seconds with coffee | Active goals, yesterday's capture, today's calendar summary **[PARTIAL — no calendar in ceremony content yet]** | One line of intentions + energy level | Records; feeds evening comparison |
| **Midday glance** | Self-initiated `/life/now` | "Am I on track?" (rare, optional) | Dashboard: cadence position, drift gauge, value allocation vs. declared ranks, goal progress bars, belief confidence chips [EXISTS] | Nothing — reads and closes | — |
| **Evening capture** | ~9:00 nudge [EXISTS] | Honest, tired | This morning's intentions echoed back | "Did the intervals. Phone rule failed." | Capture recorded; failures are *data*, feeding belief evidence and rule effectiveness — never scolding |
| **Coach on demand** | She opens `/life/coach` [EXISTS] | Stuck, venting, or negotiating with herself | Chat with full plan/lifelog context; coach remembers prior conversations (working memory persists across threads) [EXISTS] | Talks | Coach can update goals, log feedback, propose transitions — each proposal confirmed, never silently applied |

**Decision point D3 — the goal state machine surfaces in plain language.** When captures repeatedly contradict a goal ("blocked again"), the coach or Goal Detail view offers transitions: *pause it, shrink it, or let it go* (`paused` / milestone edit / `abandoned`). The nine-state machine is never shown as a diagram; it's shown as those verbs. Letting go is framed as a legitimate outcome that keeps the plan honest, not a failure. [PARTIAL — transitions exist in UI; coach-proposed transitions exist as tools; the plain-language framing is prompt work]

---

## Phase 3 — The Weekly Cycle

**Cue:** Sunday. Two converging rituals: the `cycle_retro` nudge [EXISTS], and the couch **Weekly Review** photo-narration ritual (E4) the family already does.
**Feeling:** Reflective; this is the one deliberate sit-down of the week.
**Intent:** "Close the week. Notice what actually happened."

**Sees (cycle retro flow [EXISTS]):** goal-by-goal progress, belief evidence collected this week, value drift for the cycle, rule effectiveness — each step asks for a short reaction, not an essay.

**The drift moment** is the emotional center of the week: declared value ranks vs. where time actually went (Spearman correlation, shown as a gauge, not a statistic). The three reactions and their affordances:

| Reaction | Affordance |
|----------|-----------|
| "That's fair, I'll adjust behavior" | Sets next week's intention seed |
| "My ranking was wrong" | Re-rank values right there (value drift often means the *declaration* was aspirational, not the behavior wrong) |
| "The data's wrong" | Correct category mapping — trust in the mirror matters more than any single reading **[GAP — no mapping-correction UI]** |

**Interview cycle:** the retro is the coach's richest input. Its summary lands in the coach's context so Monday's check-in continues the thread ("you said Craft got zero hours — tonight's free after 8").

**[GAP — convergence]:** the TV Weekly Review recording (spoken narration of the week) is transcribed but not yet mined for belief evidence / feedback entries. Designed intent: the Sunday couch ritual *is* data entry, without feeling like it.

---

## Phase 4 — Monthly and Beyond

### Phase review (monthly) [EXISTS — flow renders full plan]
**Cue:** `phase_review` nudge on the phase boundary. **Feeling:** zoomed out, slightly ceremonial. **Does:** walks the whole plan — which goals moved states this month, which beliefs changed confidence, whether qualities still ring true. This is where **belief verdicts** land: a belief that gathered a month of evidence gets promoted (`confirmed`), demoted (`refuted` — triggering the cascade review of anything built on it), or left `testing`. The cascade is presented as: *"this was load-bearing for two goals — want to look at those too?"* [PARTIAL — cascade logic exists in domain; no UI presentation]

### Season alignment / era vision [GAP — no UI; backend types exist]
Quarterly: re-rank values against a season of drift data; set the next season's theme. Annually: the era vision conversation — the only ceremony designed as a *long* coach interview, revisiting purpose with a year of evidence. Both currently fall through to "not yet implemented" in the ceremony flow.

### Belief dormancy [EXISTS — domain]
A belief untested for 60+ days decays toward `dormant`; the coach surfaces it ("still betting on this, or retire it?") rather than letting the plan accumulate dead weight. [GAP — surfacing]

---

## Lapse & Recovery — the journey nobody designs for

Week 6: Maya gets sick, then busy. Nine days of ignored nudges.

| Beat | Design | Status |
|------|--------|--------|
| **Nudge decay** | After 3 unanswered daily nudges, drop to cycle-cadence only ("we'll be here Sunday"). Never accumulate guilt ("you missed 9 check-ins" is forbidden copy). | [GAP — nudges currently fire every scheduled day regardless] |
| **Re-entry cue** | The Sunday retro nudge persists — the weekly ritual is the recovery hook, not the daily one | [EXISTS by shape — cycle nudges continue] |
| **Re-entry experience** | First ceremony back opens with a bridge, not a backlog: "Two weeks since we talked. One question: did anything change that your plan should know about?" One answer re-syncs the plan; unanswered ceremonies from the gap are simply never mentioned | [GAP] |
| **Her feeling to protect** | Relief that the door is open, not shame at the gap. Shame is the #1 uninstall driver for reflective tools | design principle |

---

## Inventory: Cues, Decision Points, Input Cycles

**All cues/hooks** (what can ever ping Maya): morning/evening ceremony nudges, weekly/monthly/seasonal ceremony nudges [EXISTS, prod-scheduled], coach CadenceCheck message [EXISTS], drift alert (threshold-crossing between retros) [PARTIAL — category exists, no trigger], belief-verdict-ready [GAP], dormant-belief prompt [GAP], post-workout capture hook (E5) [GAP]. Routing per category: ceremony → Telegram+push+app; drift → Telegram+app; rest app-only. One nudge per ceremony per period, silenced by completion.

**All decision points:** D0 first-60-seconds (engage/bounce), D1 abandon-mid-onboarding (resume), D2 ignore micro-interviews (back off), D3 goal transitions (pause/shrink/let go), drift reaction (behavior/ranking/data), belief verdict (confirm/refute/keep testing → cascade), channel consent, lapse re-entry.

**All input cycles** (every place she gives the system information): onboarding session (chat + card-sort), daily intention/capture (one-liners), coach chat (free dialogue), retro reactions (short structured), phase review (walkthrough), micro-interview replies (one Telegram line), plan view edits (direct manipulation), weekly review narration (voice, ambient) [transcript-mining GAP].

---

## Implementation Status Roll-up

| Journey element | Status |
|-----------------|--------|
| Ceremony nudges (Telegram/push/app), dedupe, deep-link | EXISTS |
| Daily/weekly/monthly ceremony flows | EXISTS |
| Dashboard, drift, log views, plan CRUD views | EXISTS |
| Coach with plan/lifelog tools + persistent memory | EXISTS |
| Empty-state → onboarding entry | GAP |
| First-session guided onboarding (card-sort, evidence mirror, incremental plan writing, resume) | GAP |
| Micro-interview drip (days 2–14) | GAP |
| Reply-in-Telegram ceremony completion | GAP |
| Nudge decay + lapse re-entry bridge | GAP |
| Season/era ceremony UI | GAP |
| Weekly Review transcript → plan evidence | GAP |
| Drift category-mapping correction | GAP |
| Belief cascade / dormancy surfacing in UI | PARTIAL |

---

## See Also

- [life-domain-architecture.md](./life-domain-architecture.md) — the layer map behind every surface named here
- [weekly-review.md](./weekly-review.md) — the TV ritual that feeds Phase 3
