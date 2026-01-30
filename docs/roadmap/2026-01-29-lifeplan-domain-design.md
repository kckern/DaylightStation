# Lifeplan Domain Design

> Implementing the Joy on Purpose (JOP) framework within Daylight Station

**Last Updated:** 2026-01-29
**Status:** Design Complete, Ready for Implementation

---

## Overview

Lifeplan is a new domain that implements the JOP Life Plan framework, serving as the **future** counterpart to Lifelog (past). Daylight Station becomes the **present fulcrum** between past data and future intent.

```
    PAST                 PRESENT               FUTURE
   +----------+        +----------+         +----------+
   | Lifelog  |------->| Daylight |<--------| Lifeplan |
   |          |        | Station  |         |          |
   | What     |        | What to  |         | What     |
   | happened |        | do NOW   |         | should   |
   |          |        |          |         | happen   |
   +----------+        +----------+         +----------+
```

The core question answered: **"What should I do right now, and why?"**

---

## The JOP Framework: Six Layers of Intentional Living

JOP (Joy on Purpose) is a framework for intentional living. Its core insight: **the purpose of life is to maximize joy**, and joy comes from meaningful progress toward worthwhile goals. Most people drift through life reacting to circumstances. The life plan provides a compass that always points toward the greatest possible joy.

The framework organizes life into six hierarchical layers, each building on the one above:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              PURPOSE                                         │
│                                                                             │
│  "Why do I exist?"                                                          │
│                                                                             │
│  Transcendent and singular. Cannot be completed, only approached.           │
│  Worth dying for, or it's not worth living for.                            │
│  Example: "To maximize joy through meaningful contribution"                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                             QUALITIES                                        │
│                                                                             │
│  "Who must I be to fulfill my purpose?"                                     │
│                                                                             │
│  Character traits you cultivate. Never "done" - perpetual aspiration.       │
│  Decompose into principles (general guidance) and rules (specific triggers).│
│  Examples: Physical vitality, intellectual growth, relational depth         │
├─────────────────────────────────────────────────────────────────────────────┤
│                              VALUES                                          │
│                                                                             │
│  "When two good things conflict, which wins?"                               │
│                                                                             │
│  Explicit ranking of priorities. Without ranking, you decide by mood.       │
│  Must be ordered - if you can't rank them, you don't value them.           │
│  Examples: Health > Family > Craft > Adventure > Wealth                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                              BELIEFS                                         │
│                                                                             │
│  "How does reality work? What causes what?"                                 │
│                                                                             │
│  If-then mappings between cause and effect. Recipes for outcomes.           │
│  Must be tested and updated. Strengthen with evidence, weaken without.      │
│  Examples: "If I exercise regularly, then I have more energy"               │
├─────────────────────────────────────────────────────────────────────────────┤
│                               GOALS                                          │
│                                                                             │
│  "What audacious outcomes will I achieve?"                                  │
│                                                                             │
│  Measurable, completable aims. Must be audacious enough to matter.          │
│  Require sacrifice, deadline, metrics. Progress toward purpose.             │
│  Examples: "Run a marathon by October", "Ship product by Q2"                │
├─────────────────────────────────────────────────────────────────────────────┤
│                               TASKS                                          │
│                                                                             │
│  "What do I do right now?"                                                  │
│                                                                             │
│  Daily actions that advance goals. The atomic unit of execution.            │
│  Every task should trace back through goals to purpose.                     │
│  Examples: "Morning run", "Review pull request", "Call mom"                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

### The Key Insight: Mapping Purpose to Tasks

The big picture is easy. Everyone wants a meaningful life. The hard part is **propagating purpose down to daily tasks** in a way that makes every action feel meaningful.

Without this mapping:
- Work feels like drudgery separate from "real life"
- You react to circumstances instead of proactively designing your days
- You accomplish tasks without feeling progress toward anything that matters
- You make inconsistent decisions because you lack explicit priorities

With this mapping:
- Every task connects to your highest purpose
- Work becomes "what I get to do" instead of "what I have to do"
- You can evaluate any potential action against your values
- Decisions become clearer because you have criteria to measure against

---

## Why DaylightStation is the Perfect Platform for JOP

DaylightStation is a **data refinery**. It ingests raw data from everywhere your life already lives and distills it into high-purity signal. This architecture is uniquely suited to operationalize the JOP framework.

### The Problem JOP Addresses

Most people are "terribly unhappy" - lonely, stressed, anxious, apathetic. They drift through life making ad-hoc decisions based on mood or pressure. They never explicitly define:
- What they want most (purpose)
- Who they need to be to get it (qualities)
- How to prioritize when good things conflict (values)
- What actually causes what (beliefs)
- What audacious outcomes to pursue (goals)

Without these explicit definitions, improvement is haphazard and joy is fleeting.

### The Problem DaylightStation Addresses

Your digital life is scattered across dozens of apps. The value is trapped:
- 20 browser tabs for 20 different services
- No synthesis - your fitness data doesn't talk to your calendar
- Doomscrolling on apps designed to capture attention, not serve it

The tools exist. The data exists. What's missing is the **last mile** - an interface that delivers the right information at the right moment.

### The Synthesis: Lifeplan + Lifelog

**Lifelog** captures what happened - the raw data of your life:
- Fitness activities from Strava/Garmin
- Time allocation from Calendar
- Tasks completed from Todoist
- Health metrics from Withings/Oura
- Content consumed from Plex
- Social interactions from email/messaging

**Lifeplan** defines what should happen - the intent:
- Purpose statement
- Quality principles and rules
- Value rankings
- Belief hypotheses
- Goal commitments
- Task priorities

**DaylightStation** is the present fulcrum that:
1. **Compares** plan intent to lifelog reality
2. **Calculates** drift between stated values and observed behavior
3. **Tests** beliefs automatically by detecting signals in the data
4. **Surfaces** gaps through kiosks, receipts, bots, and alerts
5. **Captures** feedback through ceremonies and journaling
6. **Evolves** the plan based on evidence

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           THE DATA REFINERY                                  │
│                                                                             │
│   Inputs (Lifelog)              Refinery                  Outputs           │
│   ─────────────────            ──────────              ───────────          │
│   Strava activities    ──┐                        ┌──  Kiosk dashboards     │
│   Calendar events      ──┤                        ├──  Morning receipts     │
│   Todoist tasks        ──┼──► [ Compare ]         ├──  Telegram nudges      │
│   Withings health      ──┤    [ Detect  ] ◄── Plan├──  Voice prompts        │
│   Oura readiness       ──┤    [ Surface ]         ├──  Ceremony flows       │
│   Journal entries      ──┤    [ Capture ]         └──  Drift alerts         │
│   Financial txns       ──┘    [ Evolve  ]                                   │
│                                   ▲                                          │
│                                   │                                          │
│                           ┌───────┴───────┐                                  │
│                           │   Lifeplan    │                                  │
│                           │   (Intent)    │                                  │
│                           └───────────────┘                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### What Makes This Different

Most productivity systems are static documents you forget about. Lifeplan is **alive**:

| Traditional | Lifeplan |
|-------------|----------|
| Write goals in a notebook | Goals have state machines (dream → committed → achieved) |
| Hope you remember your values | System calculates value drift from actual time allocation |
| Believe things without testing | Beliefs have operationalized signals that auto-detect |
| Review plan when you remember | Ceremonies trigger at configured cadences |
| No feedback on what works | Rule effectiveness tracked (triggered/followed/helped) |

Every action becomes an experiment. The system learns what works for you.

---

## Design Principles

From JOP, the critical insight is that Lifeplan must support two modes:

1. **Static snapshot**: What is my plan right now?
2. **Dynamic evolution**: How does my plan improve through living it?

The plan is a living document. Every action is an experiment. The system must capture not just intent, but the feedback loop that refines intent over time.

### Operational Philosophy

This design extends beyond a static data model to include:

- **Four feedback loops** that make the system learn (Goal, Belief, Value, Quality)
- **Ceremonies** that create temporal structure for reflection and data collection
- **State machines** that enforce valid transitions and capture history
- **Accountability mechanisms** that surface gaps between intent and reality
- **Flexible cadences** that adapt to individual rhythms (not locked to calendar)

---

## The Four Feedback Loops

The system operates through four distinct learning loops, each with its own cadence and mechanics.

### What's Actually Timebound in JOP?

| Layer | Timebound? | Nature |
|-------|------------|--------|
| Purpose | No | Transcendent, aspirational - you approach it, never complete it |
| Qualities | No | Ongoing cultivation - you're never "done" being healthy |
| Values | No | Ranking may shift, but values persist |
| Beliefs | **Partially** | Adopted date, last tested - they age and need validation |
| Goals | **Yes** | Deadlines, completion states, measurable end |
| Tasks | **Yes** | Specific times, recurrence, done/not done |

The **execution layer** (Goals + Tasks) is timebound. Everything above is **perpetual but evolvable**.

### The Two Meta-Loops

```
┌─────────────────────────────────────────────────────────────────┐
│                     EXECUTION LOOP (Tactical)                   │
│                                                                 │
│    Plan ──────► Act ──────► Measure ──────► Adjust             │
│                                                                 │
│    "Am I doing what I said I'd do?"                            │
│    Cadence: Unit/Cycle                                          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     EVOLUTION LOOP (Strategic)                  │
│                                                                 │
│    Plan ──────► Live ──────► Learn ──────► Revise              │
│                                                                 │
│    "Is what I said I'd do still the right thing?"              │
│    Cadence: Cycle/Phase/Season                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Flexible Cadence Model

Time boxes are abstract and configurable, not locked to calendar units. This allows the system to adapt to individual rhythms.

### Cadence Levels

| Level | Default Duration | Purpose | Typical Mapping |
|-------|------------------|---------|-----------------|
| **Unit** | 1 day | Atomic execution period | Day |
| **Cycle** | 7 days | Sprint/iteration period | Week |
| **Phase** | 30 days | Medium-term review | Month |
| **Season** | 90 days | Strategic assessment | Quarter |
| **Era** | 365 days | Major life review | Year |

### Configuration

Each user configures their own cadence durations:

```yaml
cadence:
  unit:
    duration: 1 day      # Person A: 1 day, Person B: 3 days
    alias: "day"         # Human-readable name
  cycle:
    duration: 7 days     # Person A: 1 week, Person B: 2 weeks
    alias: "week"
  phase:
    duration: 30 days    # Person A: 1 month, Person B: 6 weeks
    alias: "month"
  season:
    duration: 90 days    # Person A: quarter, Person B: 4 months
    alias: "quarter"
  era:
    duration: 365 days   # Person A: year, Person B: 18 months
    alias: "year"
```

### Cadence Relationships

```
┌─────────────────────────────────────────────────────────────────┐
│ ERA (strategic life direction)                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ SEASON (strategic alignment)                              │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │ PHASE (goal portfolio health)                       │  │  │
│  │  │  ┌───────────────────────────────────────────────┐  │  │  │
│  │  │  │ CYCLE (sprint/iteration)                      │  │  │  │
│  │  │  │  ┌─────────────────────────────────────────┐  │  │  │  │
│  │  │  │  │ UNIT (execution)                        │  │  │  │  │
│  │  │  │  └─────────────────────────────────────────┘  │  │  │  │
│  │  │  └───────────────────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Timing References

Forcing functions and ceremonies reference cadences, not fixed durations:

| Instead of... | Use... |
|---------------|--------|
| "30 days" | "1 phase" |
| "Weekly" | "Every cycle" |
| "3 weeks" | "3 cycles" |
| "Quarterly" | "Every season" |
| "Annual" | "Every era" |

---

## Loop 1: Goal Loop

### State Machine

```
                              ┌─────────────────────────────────────────┐
                              │                                         │
                              ▼                                         │
┌──────────┐  explore   ┌────────────┐  not worth it  ┌───────────┐    │
│  dream   │───────────►│ considered │───────────────►│ abandoned │    │
│          │            │            │                │           │    │
│ "What if │            │ "Is this   │                │ "Not for  │    │
│  I..."   │            │  worth the │                │  me"      │    │
└────┬─────┘            │  sacrifice?│                └───────────┘    │
     │                  └─────┬──────┘                      ▲          │
     │ not serious            │ commit                      │          │
     ▼                        ▼                             │          │
┌───────────┐           ┌───────────┐  give up             │          │
│ abandoned │           │ committed │──────────────────────┤          │
│           │           │ (active)  │                      │          │
│ "Just a   │           │           │  life happens        │          │
│  fantasy" │           │ Deadline, │─────────────┐        │          │
└───────────┘           │ metrics,  │             │        │          │
                        │ sacrifice │             ▼        │          │
                        └─────┬─────┘      ┌──────────┐    │          │
                              │            │  paused  │────┤          │
              ┌───────────────┼────────────└────┬─────┘    │          │
              │               │                 │ resume   │          │
              ▼               ▼                 ▼          │          │
        ┌──────────┐   ┌──────────┐      ┌───────────┐    │          │
        │ achieved │   │  failed  │──────│reconsidered│───┘          │
        │          │   │          │      │(try again?)│              │
        │ "Done!"  │   │ "Missed  │      └───────────┘               │
        └────┬─────┘   │ deadline"│                                   │
             │         └──────────┘                                   │
             │ spawn new goal                                         │
             └────────────────────────────────────────────────────────┘
```

### States Defined

| State | Description | Required Fields |
|-------|-------------|-----------------|
| **dream** | Aspiration without commitment | `name`, `quality` (optional) |
| **considered** | Active evaluation - researching, estimating sacrifice | `name`, `quality`, `why`, `estimated_sacrifice` |
| **committed** | Active pursuit with accountability | `name`, `quality`, `why`, `sacrifice`, `deadline`, `metrics`, `audacity` |
| **paused** | Temporarily suspended (life circumstances) | Same as committed + `paused_reason`, `resume_conditions` |
| **achieved** | Successfully completed | Same as committed + `achieved_date`, `retrospective` |
| **failed** | Deadline passed without achieving | Same as committed + `failed_date`, `retrospective` |
| **abandoned** | Consciously decided not to pursue | `abandoned_reason`, `abandoned_from_state` |

### Valid Transitions

```javascript
const GOAL_TRANSITIONS = {
  dream: ['considered', 'abandoned'],
  considered: ['committed', 'dream', 'abandoned'],
  committed: ['achieved', 'failed', 'paused', 'abandoned'],
  paused: ['committed', 'abandoned'],
  failed: ['considered'],  // Try again
  achieved: [],
  abandoned: [],
};
```

### Evaluation Logic

**Commitment Gate (considered → committed):**
- Does this goal serve a quality I care about?
- Does this align with my top values?
- Is the sacrifice acceptable given current commitments?
- Is this audacious enough to matter?
- Do I have metrics I can actually track?

**Progress Evaluation:**
- Time elapsed vs deadline
- Metrics progress vs expected pace
- Status: `on_track` | `at_risk` | `behind`

### Cadence

| Check | Frequency | Action |
|-------|-----------|--------|
| Dream review | Every phase | "Any dreams ready to explore?" |
| Considered timeout | After 1 phase | "Commit or release?" |
| Progress check | Every cycle | Calculate status, alert if behind |
| Deadline alerts | 1 phase / 2 cycles / 1 cycle / 1 unit before | Escalating urgency |
| Post-completion retro | On terminal state | Retrospective prompts |

---

## Loop 2: Belief Loop

### State Machine

```
┌──────────────┐         ┌──────────────┐
│ hypothesized │────────►│   testing    │◄───────────┐
│              │         │              │            │
│ "I think     │         │ Actively     │            │
│  this is     │         │ experimenting│            │
│  true"       │         └──────┬───────┘            │
└──────────────┘                │                    │
       │                        │ evidence           │
       │ no test for            ▼                    │
       │ 60+ days        ┌─────────────┐             │
       │                 │  confirmed  │ (>0.8)      │
       │                 │  uncertain  │ (0.4-0.8)   │
       │                 │  refuted    │ (<0.4)      │
       │                 └──────┬──────┘             │
       │                        │                    │
       ▼                        │ counter-evidence   │
┌──────────────┐                └────────────────────┘
│   dormant    │
│              │
│ Confidence   │
│ decaying     │
└──────────────┘
```

### Evidence Types and Confidence Updates

| did_if | got_then | Type | Meaning | Δ Confidence |
|--------|----------|------|---------|--------------|
| true | true | **Confirmation** | Hypothesis supported | +0.02 to +0.05 |
| true | false | **Disconfirmation** | Did the thing, didn't get result | -0.05 to -0.10 |
| false | true | **Spurious** | Got result without the cause | -0.10 to -0.15 |
| false | false | **Untested** | No data point | 0 (dormancy decay) |

### Operationalization

Beliefs need signals for automatic detection:

```yaml
beliefs:
  - id: exercise-energy
    if: "I exercise regularly"
    then: "I have more energy"

    # Operationalized
    if_signal:
      type: threshold
      source: strava
      measure: weekly_activities
      operator: ">="
      value: 3

    then_signal:
      type: composite
      components:
        - source: oura
          measure: daily_readiness
          weight: 0.4
        - source: self_report
          measure: energy_rating
          weight: 0.6
      threshold: 70
```

### Dormancy Decay

Beliefs need periodic validation. Untested beliefs decay:

```javascript
// ~2% decay per month after 60 days untested
const monthsStale = (daysSinceLastTest - 60) / 30;
const decayFactor = Math.pow(0.98, monthsStale);
effectiveConfidence = storedConfidence * decayFactor;
```

### Cadence

| Check | Frequency | Action |
|-------|-----------|--------|
| Evidence collection | Every cycle | Auto-detect from lifelog + metrics |
| Self-report prompt | End of cycle (in retro) | "Any observations about your beliefs?" |
| Dormancy check | Every phase | Flag beliefs untested >2 phases |
| Calibration review | Every season | "Are your confidence levels accurate?" |

---

## Loop 3: Value Loop

### The Problem Values Solve

Values answer: **"When two good things conflict, which wins?"**

Without explicit ranking, you make ad-hoc decisions based on mood or pressure. With ranking + conflict resolution rules, you have a consistent framework.

### Alignment States

```
┌───────────┐         drift detected        ┌───────────┐
│  aligned  │──────────────────────────────►│  drifting │
│           │                               │           │
│ Behavior  │◄──────────────────────────────│ Behavior  │
│ matches   │      course correct           │ diverging │
│ ranking   │                               │ from rank │
└───────────┘                               └─────┬─────┘
      ▲                                           │
      │                              sustained drift (3+ weeks)
      │                                           │
      │ reaffirm                                  ▼
      │ ranking                           ┌───────────────┐
      │                                   │ reconsidering │
      │◄──────────────────────────────────│               │
      │                                   │ "Is my        │
      │               reorder             │  ranking      │
      │◄──────────────────────────────────│  wrong?"      │
                                          └───────────────┘
```

### Drift Calculation

```javascript
calculateValueDrift(values, lifelog, period) {
  // Categorize time/energy by value served
  const allocation = this.categorizeByValue(lifelog, values);
  // { health: 0.25, family: 0.15, craft: 0.45, adventure: 0.05, wealth: 0.10 }

  // Compare to stated ranking
  const stated = values.map(v => v.id);
  const observed = Object.entries(allocation)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  // Spearman correlation
  const correlation = this.spearmanCorrelation(stated, observed);

  return {
    correlation,
    allocation,
    statedOrder: stated,
    observedOrder: observed,
    status: correlation > 0.8 ? 'aligned'
          : correlation > 0.5 ? 'drifting'
          : 'reconsidering',
  };
}
```

### Three Responses to Drift

| Response | When Appropriate | System Action |
|----------|------------------|---------------|
| **Course correct** | Temporary drift, values feel right | Alert + suggestions to realign |
| **Accept & reorder** | Consistent pattern, ranking feels wrong | Prompt reordering, capture rationale |
| **Investigate** | Unclear cause | Guided reflection prompts |

### Cadence

| Check | Frequency | Action |
|-------|-----------|--------|
| Allocation drift | Every cycle | Calculate, alert if drifting |
| Conflict detection | On tagged events | Prompt resolution if missing |
| Sustained drift review | After 3 cycles drifting | Force decision |
| Full value review | Every season | Complete reassessment |

---

## Loop 4: Quality Loop

### What Qualities Are

Qualities are **character traits** you cultivate. Unlike goals (which complete), qualities are **perpetual aspirations**. You're never "done" being healthy.

Qualities decompose into:
- **Principles**: General guidance ("I prioritize sleep")
- **Rules**: Specific trigger→action mappings ("When tired → walk instead of caffeine")

### Rule States

```
┌──────────────┐         ┌──────────────┐
│   defined    │────────►│   tested     │
│              │ trigger │              │
│ Rule exists  │ matched │ Have tried   │
│ but untried  │         │ applying it  │
└──────────────┘         └──────┬───────┘
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
             ┌───────────┐ ┌─────────┐ ┌───────────┐
             │ effective │ │  mixed  │ │ineffective│
             │           │ │         │ │           │
             │ Works     │ │Sometimes│ │ Doesn't   │
             │ reliably  │ │ works   │ │ help      │
             └───────────┘ └─────────┘ └─────┬─────┘
                                             │
                                             ▼
                                      ┌───────────┐
                                      │  revised  │
                                      │  deleted  │
                                      └───────────┘
```

### Rule Effectiveness

```javascript
evaluateRuleEffectiveness(rule) {
  const followRate = rule.times_followed / rule.times_triggered;
  const helpRate = rule.times_helped / rule.times_followed;

  if (followRate >= 0.7 && helpRate >= 0.7) return 'effective';
  if (followRate < 0.5) return 'not_followed';
  if (helpRate < 0.5) return 'ineffective';
  return 'mixed';
}
```

### Rule Creation Sources

1. **Top-down**: User defines rules explicitly
2. **Bottom-up**: System detects patterns and suggests rules
3. **Friction-driven**: User records friction, system suggests rule to address it

### Cadence

| Check | Frequency | Action |
|-------|-----------|--------|
| Trigger detection | Real-time | Surface relevant rules |
| Outcome logging | After rule followed/not | Track effectiveness |
| Rule effectiveness review | Every phase | Flag ineffective rules |
| Pattern detection | Every cycle | Suggest new rules |

---

## Ceremonies

Ceremonies create temporal containers for reflection and data collection. Without them, the loops don't get the data they need. Ceremonies align to the flexible cadence model, not fixed calendar units.

### Ceremony Hierarchy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ERA REVIEW                                                                   │
│ Purpose review, life audit, major goal setting                              │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ SEASON REVIEW                                                         │  │
│  │ Value alignment, goal portfolio review, belief calibration            │  │
│  │                                                                       │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │ PHASE REVIEW                                                    │  │  │
│  │  │ Goal health, belief evidence review, quality audit              │  │  │
│  │  │                                                                 │  │  │
│  │  │  ┌───────────────────────────────────────────────────────────┐  │  │  │
│  │  │  │ CYCLE CEREMONIES                                          │  │  │  │
│  │  │  │ Start: Planning | End: Retrospective                      │  │  │  │
│  │  │  │                                                           │  │  │  │
│  │  │  │  ┌─────────────────────────────────────────────────────┐  │  │  │  │
│  │  │  │  │ UNIT CEREMONIES                                     │  │  │  │  │
│  │  │  │  │ Start: Intention | End: Capture                     │  │  │  │  │
│  │  │  │  └─────────────────────────────────────────────────────┘  │  │  │  │
│  │  │  └───────────────────────────────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Ceremony Definitions

#### Unit Start: Intention (5-10 min)

**Inputs displayed:**
- This unit's calendar
- Active goals (top 3 by urgency)
- Applicable rules based on context
- Previous unit's incomplete items

**Prompts:**
- "What's your #1 priority this unit?"
- "Any rules especially relevant?"
- "Anything blocking you?"

**Captures:**
- `unit_focus`: 1-3 items
- `anticipated_triggers`: Rules I'll likely need
- `blockers`: Free text

#### Unit End: Capture (5-10 min)

**Inputs displayed:**
- Unit intention commitment
- This unit's lifelog (auto-collected)
- Rules triggered this unit

**Prompts:**
- "Did you accomplish your #1 priority?"
- "Any observations about goals/beliefs?"
- "Any friction points?"
- "Any wins?"

**Captures:**
- `focus_completed`: Boolean per item
- `observations`: Quick notes
- `friction`: What got in the way
- `wins`: What went well

#### Cycle End: Retrospective (15-20 min)

**Goal Loop Input:**
- "For goals behind: What's the real blocker?"
- "Any goal feel wrong to pursue anymore?"
- "Any dream calling to be explored?"

**Belief Loop Input:**
- "Did you test any beliefs this cycle?"
- "Any evidence for or against?"
- "Any new belief emerging?"

**Value Loop Input:**
- "Your time went: [allocation]. Does this match your values?"
- "Any value conflicts? How did you resolve?"

**Quality Loop Input:**
- "Which rules did you apply? Did they help?"
- "Any rules you ignored? Why?"
- "Any new rule emerging?"

#### Phase Review (30-45 min)

- Goal health check (stalled goals, approaching deadlines)
- Belief evidence review (confidence updates, dormant beliefs)
- Quality audit (ineffective rules, unfollowed rules)
- Pattern detection (recurring friction, behavior patterns)

#### Season Review (60-90 min)

- Value deep dive (season allocation vs ranking)
- Goal portfolio (dreams backlog, considered decisions, achieved/failed retros)
- Belief calibration (are confidence levels accurate?)
- Purpose check (still resonating?)

#### Era Review (half day)

- Purpose reassessment (still transcendent and meaningful?)
- Life audit (what qualities are thriving/neglected?)
- Major goal setting (what audacious goals for next era?)
- Value ranking reassessment (major life changes reflected?)

### Accountability Mechanisms

**1. Commitment Visibility**
- Unit focus displayed in kiosk, receipts, telegram
- Cycle targets visible in unit ceremonies

**2. Gap Visibility**
- Goal gaps: "Goal X is N% behind pace"
- Value drift: "Your time doesn't match your values (correlation: N)"
- Belief dormancy: "Belief Y untested for N units"

**3. Trend Tracking**
- Cycle velocity (4-cycle rolling average)
- Value drift trend over 4 cycles
- Goal progress rate vs projected completion

**4. Forcing Functions**
- Stalled goal (2 cycles no progress): Must choose - recommit, pause, abandon
- Considered timeout (1 phase): Must choose - commit, demote, abandon
- Sustained drift (3+ cycles): Force decision - course correct, reorder, investigate

---

## Domain Architecture

### Layer Mapping

```
backend/src/
├── 0_system/
│   └── scheduling/
│       └── CeremonyScheduler.mjs      # Triggers ceremonies at configured times
│
├── 1_domains/
│   └── lifeplan/
│       ├── entities/
│       │   ├── Purpose.mjs
│       │   ├── Quality.mjs
│       │   ├── Rule.mjs
│       │   ├── Value.mjs
│       │   ├── Belief.mjs
│       │   ├── Evidence.mjs
│       │   ├── Goal.mjs
│       │   ├── Milestone.mjs
│       │   ├── Task.mjs
│       │   ├── FeedbackEntry.mjs
│       │   ├── Cycle.mjs               # Execution period (formerly Sprint)
│       │   ├── Ceremony.mjs
│       │   ├── CeremonyRecord.mjs
│       │   ├── LifePlan.mjs            # Aggregate root
│       │   └── index.mjs
│       │
│       ├── services/
│       │   ├── GoalStateService.mjs    # State machine logic
│       │   ├── BeliefEvaluator.mjs     # Evidence → confidence
│       │   ├── ValueDriftCalculator.mjs
│       │   ├── RuleMatchingService.mjs
│       │   ├── ProgressCalculator.mjs
│       │   └── index.mjs
│       │
│       ├── value-objects/
│       │   ├── GoalState.mjs
│       │   ├── BeliefState.mjs
│       │   ├── AlignmentState.mjs
│       │   ├── EvidenceType.mjs
│       │   ├── CeremonyType.mjs
│       │   ├── CadenceLevel.mjs        # unit | cycle | phase | season | era
│       │   └── index.mjs
│       │
│       └── index.mjs
│
├── 2_adapters/
│   ├── persistence/yaml/
│   │   ├── YamlLifePlanStore.mjs
│   │   ├── YamlCeremonyRecordStore.mjs
│   │   └── YamlCycleStore.mjs
│   │
│   └── lifeplan/
│       ├── metrics/
│       │   ├── StravaMetricAdapter.mjs
│       │   ├── TodoistMetricAdapter.mjs
│       │   ├── GithubMetricAdapter.mjs
│       │   ├── CalendarMetricAdapter.mjs
│       │   └── SelfReportMetricAdapter.mjs
│       │
│       └── signals/
│           ├── BeliefSignalDetector.mjs
│           └── ContextSignalDetector.mjs
│
├── 3_applications/
│   └── lifeplan/
│       ├── ports/
│       │   ├── ILifePlanRepository.mjs
│       │   ├── ICeremonyRecordRepository.mjs
│       │   ├── ICycleRepository.mjs
│       │   ├── IMetricSource.mjs
│       │   ├── ISignalDetector.mjs
│       │   └── index.mjs
│       │
│       ├── services/
│       │   ├── AlignmentService.mjs      # "What should I do now?"
│       │   ├── DriftService.mjs          # Multi-dimensional drift
│       │   ├── FeedbackService.mjs       # Record observations
│       │   ├── RetroService.mjs          # Generate retrospectives
│       │   ├── PlanRevisionService.mjs   # Suggest plan updates
│       │   ├── CycleService.mjs          # Cycle planning, velocity
│       │   ├── CadenceService.mjs        # Cadence timing calculations
│       │   ├── CeremonyService.mjs       # Ceremony orchestration
│       │   └── index.mjs
│       │
│       ├── usecases/
│       │   ├── GetCurrentFocus.mjs
│       │   ├── CalculateDrift.mjs
│       │   ├── RecordFeedback.mjs
│       │   ├── UpdateBeliefConfidence.mjs
│       │   ├── TransitionGoalState.mjs
│       │   ├── GenerateRetro.mjs
│       │   ├── PlanCycle.mjs
│       │   ├── RunCeremony.mjs
│       │   └── index.mjs
│       │
│       ├── LifePlanContainer.mjs         # DI container
│       └── index.mjs
│
└── 4_api/
    └── v1/routers/
        └── lifeplan.mjs
```

### Key Services

| Service | Layer | Responsibility |
|---------|-------|----------------|
| `GoalStateService` | Domain | Validate and execute state transitions |
| `BeliefEvaluator` | Domain | Calculate confidence updates from evidence |
| `ValueDriftCalculator` | Domain | Compare allocation vs ranking |
| `RuleMatchingService` | Domain | Match context to applicable rules |
| `ProgressCalculator` | Domain | Calculate goal progress from metrics |
| `AlignmentService` | Application | The "present fulcrum" - what to do now |
| `DriftService` | Application | Multi-dimensional drift across all loops |
| `FeedbackService` | Application | Record observations, link to plan elements |
| `RetroService` | Application | Generate retrospective content |
| `CeremonyService` | Application | Orchestrate ceremony flows |
| `CycleService` | Application | Cycle planning, velocity tracking |
| `CadenceService` | Application | Cadence timing calculations |

### Integration Points

**With Lifelog:**
```javascript
// Drift calculation compares plan intent vs lifelog reality
const lifelog = await this.lifelogAggregator.aggregate(username, 'week');
const drift = this.driftService.calculate(plan, lifelog);
```

**With ConfigService:**
```javascript
// Load user-specific ceremony configuration
const ceremonyConfig = await configService.get(hid, uid, 'lifeplan', 'ceremonies');
```

**With Journalist:**
```javascript
// Journalist can route observations to Lifeplan FeedbackService
// Lifeplan can feed prompts to Journalist for reflection capture
```

**With Scheduling:**
```javascript
// CeremonyScheduler triggers ceremonies based on cadence timing
taskRegistry.register('lifeplan:unit_intention', calculateCadenceCron('unit'), async () => {
  await ceremonyService.triggerCeremony('unit_intention', username);
});
```

---

## Data Model

**File location:** `data/household[-{hid}]/users/{uid}/lifeplan.yml`

```yaml
# lifeplan.yml - Complete schema with operational concepts

# ============================================================
# METADATA
# ============================================================

meta:
  version: "2.0"
  created: 2024-01-15
  last_modified: 2024-03-20
  last_ceremony: 2024-03-20

# ============================================================
# CADENCE CONFIGURATION
# Flexible time boxes - not locked to calendar units
# ============================================================

cadence:
  unit:
    duration: 1 day
    alias: "day"
  cycle:
    duration: 7 days
    alias: "week"
  phase:
    duration: 30 days
    alias: "month"
  season:
    duration: 90 days
    alias: "quarter"
  era:
    duration: 365 days
    alias: "year"

# ============================================================
# PURPOSE
# ============================================================

purpose:
  statement: "To maximize joy through meaningful contribution"
  adopted: 2024-01-15
  last_reviewed: 2024-06-01
  review_cadence: era  # Review purpose every era
  notes: "Refined after reading JOP framework"

# ============================================================
# QUALITIES
# Character traits with principles and operational rules
# ============================================================

qualities:
  physical:
    id: physical
    name: "Physical Vitality"
    description: "Maintain energy and capability through health"
    icon: "💪"

    principles:
      - "I prioritize sleep as the foundation of energy"
      - "I move my body daily"
      - "I fuel my body with whole foods"

    rules:
      - id: afternoon-tiredness
        trigger: "When I feel tired in the afternoon"
        trigger_detection:
          type: time_based
          conditions:
            time_range: "14:00-16:00"
        action: "I take a 20-minute walk instead of caffeine"
        status: effective  # defined | tested | effective | mixed | ineffective | obsolete
        stats:
          times_triggered: 23
          times_followed: 18
          times_helped: 15
        notes:
          - date: 2024-03-15
            outcome: positive
            note: "Walk cleared my head"

      - id: travel-exercise
        trigger: "When traveling"
        trigger_detection:
          type: calendar_signal
          conditions:
            event_type: travel
        action: "I pack workout clothes and find hotel gyms"
        status: tested
        stats:
          times_triggered: 5
          times_followed: 3
          times_helped: 3

  intellectual:
    id: intellectual
    name: "Intellectual Growth"
    description: "Continuously learn and solve meaningful problems"
    icon: "🧠"
    principles:
      - "I read deeply rather than widely"
      - "I seek to understand before seeking to be understood"
    rules: []

  relational:
    id: relational
    name: "Deep Relationships"
    description: "Nurture authentic connections"
    icon: "❤️"
    principles:
      - "I am fully present with people I'm with"
      - "I prioritize quality time over quantity"
    rules:
      - id: phone-at-dinner
        trigger: "When my phone buzzes during family dinner"
        action: "I ignore it until dinner is complete"
        status: effective
        stats:
          times_triggered: 12
          times_followed: 11
          times_helped: 11

# ============================================================
# VALUES
# Ranked priorities with conflict resolution
# ============================================================

values:
  - id: health
    rank: 1
    name: "Health"
    above_because: "Without health, nothing else is possible"
    conflicts_with:
      - value: craft
        resolution: "Health trumps work deadlines; I don't sacrifice sleep for shipping"
        tested: true
        last_tested: 2024-02-15

  - id: family
    rank: 2
    name: "Family"
    above_because: "Family relationships are irreplaceable and finite"
    conflicts_with:
      - value: craft
        resolution: "Family events take priority over work projects"
        tested: true
      - value: adventure
        resolution: "Family adventures together before solo adventures"
        tested: false

  - id: craft
    rank: 3
    name: "Craft"
    above_because: "Mastery provides lasting satisfaction"

  - id: adventure
    rank: 4
    name: "Adventure"
    above_because: "Novel experiences expand perspective"

  - id: wealth
    rank: 5
    name: "Wealth"
    above_because: "Resources enable higher values"

# Value alignment tracking (updated by system)
value_alignment:
  last_calculated: 2024-03-20
  status: drifting  # aligned | drifting | reconsidering
  correlation: 0.65
  observed_order: [craft, health, family, wealth, adventure]
  cycles_drifting: 2  # Uses cadence units, not calendar weeks
  history:
    - date: 2024-03-13
      correlation: 0.72
      status: aligned
    - date: 2024-03-20
      correlation: 0.65
      status: drifting

# ============================================================
# BELIEFS
# If-then hypotheses with operationalization
# ============================================================

beliefs:
  - id: exercise-energy
    if: "I exercise regularly"
    then: "I have more energy for everything else"

    if_signal:
      type: threshold
      source: strava
      measure: weekly_activities
      operator: ">="
      value: 3

    then_signal:
      type: composite
      components:
        - source: oura
          measure: daily_readiness
          weight: 0.4
        - source: self_report
          measure: energy_rating
          weight: 0.6
      aggregation: weighted_average
      threshold: 70

    status: confirmed
    confidence: 0.85
    adopted: 2023-06-01
    last_tested: 2024-03-20
    test_count: 47
    evaluation_cadence: cycle  # Evaluate every cycle

    evidence:
      - date: 2024-03-15
        did_if: true
        got_then: true
        type: confirmation
        delta: 0.02
        auto_detected: true
        note: "Week of 4 runs, energy scores averaged 78"

  - id: deep-work-blocks
    if: "I protect 3+ hour blocks for deep work"
    then: "I accomplish more meaningful work"

    if_signal:
      type: calendar_analysis
      source: calendar
      conditions:
        block_duration_min: 180
        no_meetings: true
      measure: weekly_blocks
      operator: ">="
      value: 3

    then_signal:
      type: self_report
      measure: meaningful_work_rating
      threshold: 7

    status: uncertain
    confidence: 0.68
    adopted: 2024-01-01
    last_tested: 2024-03-10
    test_count: 12
    evaluation_cadence: cycle  # Evaluate every cycle
    evidence: []

# ============================================================
# GOALS
# With full state machine
# ============================================================

goals:
  # DREAM state
  learn-piano:
    id: learn-piano
    name: "Learn to play piano"
    quality: intellectual
    state: dream
    created_at: 2024-03-01
    state_history:
      - state: dream
        timestamp: 2024-03-01T10:00:00Z
        reason: "created"

  # CONSIDERED state
  write-book:
    id: write-book
    name: "Write a book about personal systems"
    quality: intellectual
    state: considered
    why: "Share what I've learned with others"
    estimated_sacrifice: "10 hours/week for 6 months"
    audacity: high
    created_at: 2024-02-15
    state_history:
      - state: dream
        timestamp: 2024-02-15T10:00:00Z
        reason: "created"
      - state: considered
        timestamp: 2024-03-01T10:00:00Z
        reason: "exploring seriously"
    evaluation:
      alignment_checked: true
      sacrifice_acceptable: null
      metrics_defined: false
      deadline_set: false

  # COMMITTED state
  run-marathon:
    id: run-marathon
    name: "Run a Marathon"
    quality: physical
    state: committed
    why: "Proving I can commit to a long-term physical goal"
    sacrifice: "6 hours/week training for 6 months"
    audacity: high
    deadline: 2024-10-01
    created_at: 2024-01-15
    committed_at: 2024-02-01

    state_history:
      - state: dream
        timestamp: 2024-01-15T10:00:00Z
        reason: "created"
      - state: considered
        timestamp: 2024-01-20T10:00:00Z
        reason: "researching training plans"
      - state: committed
        timestamp: 2024-02-01T10:00:00Z
        reason: "registered for race"

    metrics:
      - id: weekly-runs
        source: strava
        measure: weekly_runs
        target: 3
        current: 2
        last_updated: 2024-03-20

      - id: monthly-miles
        source: strava
        measure: monthly_miles
        target: 80
        current: 45
        last_updated: 2024-03-20

    milestones:
      - id: base-building
        name: "Build aerobic base"
        deadline: 2024-05-01
        status: in_progress

      - id: first-half
        name: "Complete half marathon"
        deadline: 2024-07-01
        status: pending
        blocked_by: [base-building]

    task_sources:
      - system: todoist
        project: "Marathon Training"
      - system: calendar
        calendar: "Training Schedule"

    progress_snapshots:
      - date: 2024-03-01
        progress: 0.35
        scope: 100
      - date: 2024-03-15
        progress: 0.42
        scope: 100

  # ACHIEVED state
  complete-certification:
    id: complete-certification
    name: "Complete AWS certification"
    quality: intellectual
    state: achieved
    why: "Validate cloud skills"
    sacrifice: "2 hours/day studying for 2 months"
    audacity: medium
    deadline: 2024-02-28
    created_at: 2023-12-01
    committed_at: 2023-12-15
    completed_at: 2024-02-20

    state_history:
      - state: dream
        timestamp: 2023-12-01T10:00:00Z
        reason: "created"
      - state: committed
        timestamp: 2023-12-15T10:00:00Z
        reason: "scheduled exam"
      - state: achieved
        timestamp: 2024-02-20T10:00:00Z
        reason: "passed exam"

    retrospective:
      sacrifice_accuracy: "Accurate"
      what_worked: "Daily study routine, practice exams"
      what_didnt: "Waited too long to start practice exams"
      would_repeat: true
      learnings: "Start practice exams earlier"

  # ABANDONED state
  learn-guitar:
    id: learn-guitar
    name: "Learn guitar"
    quality: intellectual
    state: abandoned
    created_at: 2023-06-01
    completed_at: 2024-01-15

    state_history:
      - state: dream
        timestamp: 2023-06-01T10:00:00Z
        reason: "created"
      - state: considered
        timestamp: 2023-08-01T10:00:00Z
        reason: "bought guitar"
      - state: abandoned
        timestamp: 2024-01-15T10:00:00Z
        reason: "piano more appealing"

    retrospective:
      abandoned_from_state: considered
      abandoned_reason: "Discovered I prefer piano"
      learnings: "Try before committing - rent instruments first"

# ============================================================
# CYCLES (formerly "sprints")
# Time-boxed execution periods aligned to cadence.cycle
# ============================================================

cycles:
  current:
    id: "2024-C12"
    start: 2024-03-18
    end: 2024-03-25  # Duration determined by cadence.cycle
    status: active

    focus_goals:
      - run-marathon
      - ship-product

    commitments:
      - goal_id: run-marathon
        cycle_target: "3 runs totaling 20 miles"

      - goal_id: ship-product
        cycle_target: "Complete auth feature"

    capacity: 20

  history:
    - id: "2024-C10"
      start: 2024-03-04
      end: 2024-03-11
      status: completed
      results:
        committed: 18
        completed: 15
        velocity: 0.83
      retro_notes: "Missed one run due to travel"

  velocity_history: [0.78, 0.82, 0.85, 0.83]

# ============================================================
# CEREMONIES
# Aligned to flexible cadence levels
# ============================================================

ceremonies:
  config:
    # Unit ceremonies (e.g., daily if unit = 1 day)
    unit_intention:
      enabled: true
      timing: start_of_unit
      time: "07:00"
      channel: telegram
      duration_target: 10

    unit_capture:
      enabled: true
      timing: end_of_unit
      time: "21:00"
      channel: telegram
      duration_target: 10

    # Cycle ceremonies (e.g., weekly if cycle = 7 days)
    cycle_planning:
      enabled: true
      timing: start_of_cycle
      time: "18:00"
      channel: app
      duration_target: 20

    cycle_retro:
      enabled: true
      timing: end_of_cycle
      time: "19:00"
      channel: app
      duration_target: 20

    # Phase ceremonies (e.g., monthly if phase = 30 days)
    phase_review:
      enabled: true
      timing: start_of_phase
      time: "10:00"
      channel: app
      duration_target: 45

    # Season ceremonies (e.g., quarterly if season = 90 days)
    season_review:
      enabled: true
      timing: start_of_season
      time: "10:00"
      channel: app
      duration_target: 90

    # Era ceremonies (e.g., annual if era = 365 days)
    era_review:
      enabled: true
      timing: start_of_era
      time: "10:00"
      channel: app
      duration_target: 240  # Half day

  adherence:
    last_phase:  # Rolling phase window
      unit_intention: 0.85
      unit_capture: 0.78
      cycle_retro: 1.0
    streak:
      unit_intention: 5
      cycle_retro: 8

# ============================================================
# FEEDBACK LOG
# ============================================================

feedback:
  - id: fb-001
    date: 2024-03-20
    type: observation
    relates_to:
      type: belief
      id: exercise-energy
    observation: "After 3 cycles of consistent morning runs, energy noticeably higher"
    action_taken: "Increased confidence in exercise-energy belief"
    ceremony_source: cycle_retro

  - id: fb-002
    date: 2024-03-15
    type: friction
    relates_to:
      type: goal
      id: run-marathon
    observation: "Finding it hard to run on travel days"
    action_taken: "Added rule about packing workout clothes"
    ceremony_source: unit_capture
    spawned_rule: travel-exercise

  - id: fb-003
    date: 2024-03-10
    type: gap
    relates_to:
      type: value
      id: family
    observation: "Spent 3 evenings on work instead of family"
    action_taken: "Set hard stop at 6 PM"
    ceremony_source: cycle_retro

# ============================================================
# TASKS (Native to Lifeplan)
# ============================================================

tasks:
  - id: cycle-review
    goal: null
    recurrence: "end_of_cycle 19:00"
    description: "Cycle retro ceremony"
    last_completed: 2024-03-17
    streak: 8

  - id: belief-check
    goal: null
    recurrence: "start_of_phase"
    description: "Phase belief evidence review"
    last_completed: 2024-03-01

  - id: morning-run
    goal: run-marathon
    recurrence: "MWF 06:00"  # Some recurrences are still calendar-based
    description: "30-minute morning run"
    last_completed: 2024-03-20
```

---

## API Layer

```
# Core Plan Operations
GET  /api/v1/lifeplan/plan                    # Full lifeplan
PATCH /api/v1/lifeplan/plan/:section          # Update section
GET  /api/v1/lifeplan/plan/export             # Export as YAML

# Cadence Configuration
GET  /api/v1/lifeplan/cadence                 # Get cadence config
PATCH /api/v1/lifeplan/cadence                # Update cadence durations

# Present Moment (The Fulcrum)
GET  /api/v1/lifeplan/focus?scope=unit        # "What should I do now?"
GET  /api/v1/lifeplan/drift                   # Multi-dimensional drift
GET  /api/v1/lifeplan/rules/applicable        # Rules for current context

# Goals (with state machine)
GET  /api/v1/lifeplan/goals                   # All goals by state
GET  /api/v1/lifeplan/goals/:goalId           # Single goal
POST /api/v1/lifeplan/goals/:goalId/transition # State transition
PATCH /api/v1/lifeplan/goals/:goalId/metrics  # Update metrics

# Beliefs
GET  /api/v1/lifeplan/beliefs                 # All beliefs
POST /api/v1/lifeplan/beliefs/:id/evidence    # Add evidence
PATCH /api/v1/lifeplan/beliefs/:id/confidence # Update confidence

# Feedback Loop
POST /api/v1/lifeplan/feedback                # Record observation
GET  /api/v1/lifeplan/feedback?period=cycle   # Get feedback

# Retrospectives
GET  /api/v1/lifeplan/retro?period=cycle      # Generate retrospective
GET  /api/v1/lifeplan/suggestions             # Pattern-based suggestions
POST /api/v1/lifeplan/suggestions/:id/accept  # Accept suggestion

# Ceremonies
GET  /api/v1/lifeplan/ceremony/:type          # Get ceremony content
POST /api/v1/lifeplan/ceremony/:type/complete # Record completion

# Cycles (execution periods)
GET  /api/v1/lifeplan/cycle/current           # Current cycle
POST /api/v1/lifeplan/cycle/plan              # Plan new cycle
GET  /api/v1/lifeplan/cycle/velocity          # Velocity history
```

---

## Implementation Phases

### Phase 1: Foundation

**Entities with state machines:**
- Goal.mjs (full state machine: dream → considered → committed → ...)
- Belief.mjs (with operationalization fields)
- Value.mjs (with conflict tracking)
- Quality.mjs + Rule.mjs (with effectiveness stats)

**Domain services:**
- GoalStateService.mjs (validate and execute transitions)
- BeliefEvaluator.mjs (evidence → confidence)

**Adapters:**
- YamlLifePlanStore.mjs (read/write)

**Deliverables:**
- Sample lifeplan.yml with full schema
- Entity validation
- State transition tests

### Phase 2: Alignment Engine

**Services:**
- AlignmentService.mjs (the present fulcrum)
- DriftService.mjs (multi-dimensional)
- ProgressCalculator.mjs

**Integration:**
- Connect to LifelogAggregator
- Value drift calculation

**Deliverables:**
- `/api/v1/lifeplan/focus` endpoint
- `/api/v1/lifeplan/drift` endpoint

### Phase 3: Feedback Loop

**Services:**
- FeedbackService.mjs
- RetroService.mjs
- PlanRevisionService.mjs

**Deliverables:**
- Feedback capture API
- Retrospective generation
- Pattern-based suggestions

### Phase 4: Ceremonies

**Services:**
- CeremonyService.mjs (orchestration)
- CeremonyScheduler.mjs (triggers)
- CadenceService.mjs (timing calculations)

**Integration:**
- Telegram for unit ceremonies (quick, high-frequency)
- App for cycle/phase/season ceremonies (longer, more involved)

**Deliverables:**
- Ceremony flows
- Adherence tracking
- Forcing functions
- Cadence configuration UI

### Phase 5: Cycles & Velocity

**Services:**
- CycleService.mjs (planning, tracking)

**Deliverables:**
- Cycle planning flow
- Velocity tracking
- Burndown calculation

### Phase 6: External Integration

**Adapters:**
- StravaMetricAdapter.mjs
- TodoistMetricAdapter.mjs
- CalendarMetricAdapter.mjs
- BeliefSignalDetector.mjs

**Deliverables:**
- Automatic metric updates
- Belief evidence detection

---

## Dependencies

| Existing System | How Lifeplan Uses It |
|-----------------|---------------------|
| `LifelogAggregator` | Source of "what happened" for drift |
| `ConfigService` | Load user/household context + cadence config |
| `Journalist` | AI-guided reflection, feedback capture |
| `Telegram adapter` | Unit ceremony delivery (quick, high-frequency) |
| `Scheduling/TaskRegistry` | Ceremony triggers (cadence-aware) |

**No breaking changes** - Lifeplan adds alongside existing domains.

---

## JOP Framework Reference

| Component | JOP Definition | Lifeplan Implementation |
|-----------|----------------|------------------------|
| **Purpose** | Single transcendent aim | `purpose.statement` with review tracking |
| **Qualities** | Character traits | `qualities[].principles[]` + `rules[]` with effectiveness |
| **Values** | Ranked priorities | `values[]` with `conflicts_with[]` and drift tracking |
| **Beliefs** | If-then mappings | `beliefs[]` with operationalization and evidence |
| **Goals** | Audacious outcomes | `goals[]` with full state machine |
| **Tasks** | Unit-level actions | Native + external `task_sources[]` |

**Key JOP principles captured:**

1. **Purpose can't be measured directly** - Progress through qualities, values, goals
2. **Plan must evolve through feedback** - Four loops, ceremonies, retros
3. **Qualities need principles and rules** - With operational effectiveness tracking
4. **Beliefs strengthen/weaken through evidence** - Operationalized signals, dormancy decay
5. **Goals must be audacious** - State machine enforces commitment gate
6. **Values require explicit ranking** - Drift detection, conflict resolution
7. **Cadences adapt to the individual** - Flexible time boxes (unit/cycle/phase/season/era) instead of calendar-locked periods

The system answers JOP's core question: **"What should I do right now, and why?"** through the `AlignmentService` that combines plan intent with Lifelog reality to suggest the highest-value action for this moment.
