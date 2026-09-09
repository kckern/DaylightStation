# The reading session: a taxonomy of concerns

**Why this exists.** The reading feature has grown eight surfaces, and several of
them draw the same thing for different reasons while others draw two different
things as one. That is what produces the defects we keep finding one at a time:
the cover on screen twice, a progress bar and a pip row both claiming "progress",
a subject word sitting where a name goes, a history card whose date and whose
count came from different scopes.

So: name the JOBS, name the ELEMENTS, and hold the rule that **one element does
one job**, and **one job has one home per surface**.

---

## 1. The jobs — the questions someone actually asks

| # | Job | The question, as asked | Asked by |
|---|---|---|---|
| **J1** | Attribution | *Whose is this?* | child, passing adult |
| **J2** | Curriculum | *What does this count toward?* | adult, mostly |
| **J3** | Obligation | *How many do I owe today, how many are done?* | child |
| **J4** | Content identity | *Which book is this?* | child |
| **J5** | Position | *How far through this one are we?* | child, adult |
| **J6** | Today's evidence | *What did I actually do today?* | child, adult |
| **J7** | The long run | *What have I done over time — am I on a streak?* | child |
| **J8** | Affordance | *What happens now, and what can I do about it?* | child |
| **J9** | Ambient | *What day and time is it?* | nobody — **incidental learning** |

**J9 is different from the rest and must stay that way.** Nothing depends on it,
nothing breaks without it, and it is the only job on this list that exists to be
*practised* rather than *used*. It earns its place only while it costs nothing.

---

## 2. The elements — and the single job each one owns

| Element | Owns | Must never also carry |
|---|---|---|
| Portrait | J1 | the subject, the count, the book |
| Name | J1 | anything |
| Subject mark (icon + word) | J2 | the child's identity |
| Pip row | J3 | how far through a story |
| **Live pip** (sweep + pulse) | **J5** | — *see the overload below* |
| Cover, on the stage | J4 | — |
| Title, as words | J4 — **only where no cover can be drawn** | — |
| Recent shelf | J6 + J7 | the obligation |
| Streak grid | J7 | today's detail |
| Clock / date | J9 | anything load-bearing |
| Countdown bar | J8 | position in a story |
| Up-next card | J1 + J4 + J8 | the obligation |

### The one deliberate overload

The pip row carries **J3**; the live pip inside it carries **J5**. That is two
jobs in one object, and it is allowed for one reason: **they are the same
currency.** This story fills *this* pip. The sweep is not a second progress
notion bolted on — it is the pip saying how close it is to being filled.

The rule that keeps it honest: **the sweep may never appear on a pip that is not
the one this story fills**, and there may never be a second position indicator
anywhere on the screen. The Player's own bar was exactly that second indicator,
which is why the frame now suppresses it.

---

## 3. The surfaces — which jobs are in scope where

`•` = owns it · `–` = deliberately absent

| | J1 whose | J2 counts toward | J3 owed | J4 which book | J5 how far | J6 today | J7 long run | J8 what now | J9 date/time |
|---|---|---|---|---|---|---|---|---|---|
| **open** (pick) | • | – | • | • *(the choices)* | – | • | • | • | • |
| **picking** (countdown) | – | – | – | • | – | – | – | • | – |
| **rail** (during) | • | • | • | – | • | – | – | – | • |
| **stage** (during) | – | – | – | • | – | – | – | – | – |
| **book-done** | • | – | • | • | – | – | – | – | – |
| **celebrating** | • | – | • | – | – | • | • | – | • |
| **handover** (proposed) | • *(the NEXT child)* | – | – | • | – | – | – | • | – |
| **wind-down** (proposed) | – | – | – | – | – | – | – | • | – |

### The reasoning behind the deliberate absences

- **J4 is absent from the rail.** The stage is showing the same artwork a foot
  away, larger. Two copies of one fact is the rail spending its width on the one
  question the stage already answers best.
- **J5 is absent everywhere but the rail.** One position indicator, one place.
- **J7 lives on `open`, not on the rail.** A streak grid is for lingering over,
  and `open` is the only screen a child lingers on. The rail is 173px wide.
- **J6 lives on `celebrating`, not `open`.** "What did I do today" is a closing
  statement. On `open` the history is J7's job — the shape of the last few days,
  not a receipt for the last hour.
- **J2 is on the rail only.** It is an adult's question. It belongs where it is
  legible but out of the way, never in the child's decision path.
- **J3 is absent from `picking`.** That screen has exactly one job — *you picked
  this, you have a few seconds to change your mind* — and a count beside it is a
  second thing to read during a deliberately short window.

---

## 4. The rules that fall out

1. **One element, one job.** The only sanctioned overload is the live pip, and
   it is sanctioned because both jobs are the same currency.
2. **One job, one home per surface.** If two elements on a screen answer the
   same question, one of them is wrong — usually the smaller one.
3. **The same job wears the same object everywhere.** The obligation is pips on
   every surface that shows it. It is never a sentence in one place and dots in
   another, because a child would have to learn two notations for one fact.
4. **A partition and a count on one element must share a scope.** The recent
   card's date said "today" while its `x3` counted a seven-day window — two
   facts about different scopes printed as one. Partition first, aggregate
   inside the partition, never across it.
5. **J9 may never become load-bearing.** A wall clock is not a countdown. The
   moment the time of day changes what a child *should do*, it has stopped being
   incidental and needs to be designed as J8 instead.
6. **Absence is a decision and gets written down.** Every `–` above is a choice
   someone can otherwise "fix" by adding the thing back.

---

## 5. What this immediately tells us to change

| Finding | Rule broken | Action |
|---|---|---|
| Cover drawn on rail *and* stage | 2 | Rail drops the cover — **done** |
| Player bar *and* pips both claim progress | 2 | Frame forces the focused shader — **done** |
| Subject word captioning the portrait | 1 | Subject becomes its own mark above — **done** |
| Recent card's date and count disagree | 4 | Partition by day, dedupe inside — **in progress** |
| Recent covers drawn 3:4 for square audiobook art | — *(fidelity, not taxonomy)* | Square tiles |
| Day ends by returning to the pick screen | 3, 6 | `celebrating` → handover **or** wind-down |
| Streak / long-run view does not exist | — | New element on `open` |
| Today's evidence not shown at the close | — | Covers + clock times on `celebrating` |

---

## 6. Open questions this taxonomy does not settle

- **Where does the up-next card live** — is `handover` a surface of its own, or a
  state of `celebrating`? The table above assumes its own surface.
- **Does the streak count books, or days the obligation was met?** J7 is "am I
  on a streak", which argues for days-met, with volume as a secondary number.
- **Is `book-done` still needed** once `celebrating` carries J6 properly, or does
  it collapse into a shorter form of the same screen?
