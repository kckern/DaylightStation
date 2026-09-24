# Finance Transaction Categorization

How a bank transaction gets a friendly name and a budget category, and how the
Jev decision model is measured against (and can take over) the category pick.

Code:

| Piece | File |
|---|---|
| Service (rules, LLM, Jev, Buxfer write) | `backend/src/3_applications/finance/TransactionCategorizationService.mjs` |
| Jev category judge | `backend/src/3_applications/finance/TransactionCategoryJudge.mjs` |
| Wiring | `createFinanceServices` in `backend/src/5_composition/bootstrap.mjs`, called from `backend/src/app.mjs` |
| Config read | `YamlFinanceDatastore.getCategorizationConfig` |
| Offline replay | `cli/finance-jev-replay.cli.mjs` |

Callers: the hourly `FinanceHarvestService` (apply) and
`POST /api/v1/finance/categorize` via `FinanceApiService.categorize`
(`preview: true` runs the dry run, anything else applies).

---

## 1. Pipeline

For each transaction in the batch:

1. **Description rules.** `descriptionRules` are regexes tried in order. The
   first matching rule wins; a description already equal to that rule's
   `rename` matches nothing. A match renames the transaction and, if the rule
   has a `tag`, tags it. On the apply path the Buxfer update is fired without
   being awaited.
2. **Does it need the LLM?** `#needsCategorization` is true when the
   transaction has **no tag**, or its description matches a **raw pattern**
   (`^Direct`, `Pwp`, `^xx`, `as of`, `*`, fullwidth `（`, `Privacycom`).
   A **settled** row is skipped (see below).
3. **LLM and Jev in parallel.** The LLM (`aiGateway.chatWithJson`) names the
   transaction (`friendlyName`, optional `memo`) and proposes a category. Jev
   (`TransactionCategoryJudge.judge`) independently picks a category from
   `validTags`. Jev never sees the LLM's answer, so agreement between the two
   means something.
4. **Decide** (`#decide`), in this order:
   - LLM error → the row fails (`AI error: …`). Jev cannot rescue it.
   - No `friendlyName` → the row fails. Jev cannot name a transaction.
   - `jev.mode: promote`, Jev's category is in `validTags`, and its confidence
     is a finite number `>= confidenceFloor` → Jev's category is used
     (`categoryVia: 'jev'`). This also rescues a blank or invalid LLM category.
   - LLM category not in `validTags` → the row fails (`Invalid category: …`).
   - Otherwise the LLM category is used (`categoryVia: 'llm'`).
5. **Write.** On the apply path a success writes
   `{ description: friendlyName, tags: category, memo }` to Buxfer.
   `processed[]` and `suggestions[]` entries carry `categoryVia`.

**Apply and preview decide alike.** `categorize()` (apply) and `preview()`
(dry run) share the rule matcher (`#compileRules` / `#matchRule`) and the same
`#categorizeTransaction`. Preview simulates each rule on a copy of the row, so
it asks the LLM about exactly the rows, with exactly the descriptions, that
apply would send: a rule-tagged row is suggested once (`source: 'rule'`) and not
sent to the LLM, and a rule without a tag sends the renamed description. Preview
never mutates its input and writes nothing.

**Settled rows.** Some good friendly names still look raw: the LLM names a
payroll deposit `"Direct Deposit"`, which matches `^Direct`. Before this fix,
every hourly harvest re-sent such a row to the LLM and rewrote Buxfer, and the
tag flipped between Income and Payroll (about 200 calls a week for one row).
Now, when the service writes a friendly name that still matches a raw pattern,
it remembers `id → friendlyName` and logs `categorization.settled`. A tagged row
whose description still equals that name is skipped by apply, preview and
`getUncategorized`. If the provider description changes again, the row is
sent again.

---

## 2. Config

`gpt.yml` in the household finance directory, read by
`getCategorizationConfig(householdId)`. It is read from disk on **every run**
(no cache), so edits take effect on the next harvest with no restart.

| Key | Meaning |
|---|---|
| `validTags` | The budget categories. Both the LLM and Jev must pick from these. |
| `chat` | LLM message template. A system message containing `__VALID_TAGS__` gets the JSON list of tags substituted in; the transaction description is appended as the user message. |
| `descriptionRules` | `[{ pattern, rename, tag? }]`, applied before the LLM (see Pipeline). |
| `jev` | **Optional.** Omit it and Jev runs in shadow with floor 0.8. |

```yaml
jev:
  mode: shadow          # shadow (default) | promote | off
  confidenceFloor: 0.8  # 0..1, default 0.8; only used by promote
```

- `shadow`: ask Jev beside the LLM and log the comparison. Results and Buxfer
  writes are exactly the LLM's.
- `promote`: Jev's category wins at `confidence >= confidenceFloor` (see
  Pipeline step 4). The LLM still supplies `friendlyName` and `memo`.
- `off`: Jev is not asked.

**Invalid policy.** An unknown `mode` falls back to `shadow`. A
`confidenceFloor` that is not a number in `[0, 1]` (including a string such as
`"0.9"`) falls back to `0.8`. Either logs `categorization.jev.policy.invalid`
(warn) with the bad `mode` / `confidenceFloor` and the values actually `using`,
once per distinct bad config per process.

Jev is available only when the backend has a decision gateway (see
"Typed decisions" in `docs/reference/core/configuration.md`). Without one the
judge returns no opinion, nothing is compared, and categorization is the
LLM-only legacy behaviour. The startup event `finance.categorization.enabled`
reports `{ validTags, jev }`.

---

## 3. The Jev question

One `choice` question per transaction, over the deduped `validTags` (at least
two are needed, otherwise the judge returns no opinion):

```js
choice(
  'Which budget category does this bank transaction belong to? '
  + '`description` is the raw bank or card description; it may carry payment-processor noise such as "Pwp", "Sq *", '
  + '"Privacycom" or reference numbers. `type` is how the bank classed it (expense, income, transfer, refund, '
  + 'dividend, investment sale), `amount` is the absolute amount, and `account` is the account it posted to.',
  validTags,
)
```

State (`TransactionCategoryJudge.stateFor(txn)`):

```js
{
  description: 'Sq *6 Saplings Sugarhouse', // what the LLM sees at this point (after rules)
  type: 'expense',                           // txn.type || txn.transactionType || null
  amount: 42.5,                              // Math.abs(Number(txn.amount)) or null
  account: 'Visa',                           // txn.accountName || null
  date: '2026-09-20',                        // txn.date || null
}
```

There is **no merchant field** in the transaction data; the merchant is only
whatever `description` says. Timeout is 5 s. The judge never throws: no model,
too few tags, a failed call or a rejected promise all mean "no opinion".
A pick outside `validTags` comes back as `category: null`.

---

## 4. Observability

Events (structured log; the service logs through the backend's `finance` child logger):

| Event | Level | Fields |
|---|---|---|
| `categorization.jev.compare` | info | `id`, `path` (`apply` \| `preview`), `mode`, `floor`, `llmCategory`, `llmValid` (LLM category is in `validTags`), `llmError` (the LLM call itself failed; not rescuable), `jevCategory`, `confidence`, `agreed` (Jev category equals LLM category), `via` (`llm` \| `jev` \| `null` when the row failed), `cjk`, `model`, `jevMs` |
| `categorization.jev.failed` | warn | `id`, `error`, `ms`. The Jev call failed; no compare is logged for that row. |
| `categorization.jev.policy.invalid` | warn | `mode`, `confidenceFloor`, `using` |
| `categorization.settled` | info | `id`, `friendlyName` |
| `categorization.success` | info | `id`, `date`, `friendlyName`, `category`, `categoryVia` |
| `finance.categorization.enabled` | info | `validTags` (count), `jev` (bool) |

`llmError` separates "the LLM call failed" from "the LLM answered with a blank
or invalid category" (`llmError: false, llmValid: false`), which is the case
promote can rescue.

Queries (see "Reading Logs" in `CLAUDE.md` for reaching the store):

```bash
# Agreement split, last 7 days
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query="categorization.jev.compare" AND _time:7d | stats by ("data.agreed","data.llmValid") count() as n'

# Every disagreement, to read by hand
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query="categorization.jev.compare" AND data.agreed:false AND _time:7d'
```

---

## 5. Promotion

Only about 26 distinct transactions a week reach the LLM, and the log store
keeps 7 days, so prod shadow alone cannot build a sample. The main evidence is
the offline replay; prod shadow confirms it week by week.

**Criteria** (all must hold):

- Replay over at least 300 tagged rows across at least 2 budget periods:
  `agreementAtFloor >= 0.92` with `coverage >= 0.6` at the chosen floor.
- Two consecutive weekly prod checks where every `agreed:false, llmValid:true`
  row at `confidence >= floor` has been read, and Jev was right or the call was
  ambiguous (e.g. Income vs Payroll).
- CJK rows (`cjk: true`) reviewed separately. If their agreement is materially
  lower, stay in shadow.

**Promote** by setting `jev: { mode: promote, confidenceFloor: <floor> }` in
the finance `gpt.yml`. No restart. Roll back with `mode: shadow`.

### Replay CLI

```bash
node cli/finance-jev-replay.cli.mjs [--period YYYY-MM-DD] [--limit 200] [--floor 0.8] [--household <id>]
```

Runs the same judge over a budget period's already-tagged transactions (rows
with exactly one tag that is in `validTags`; default period is the latest) and
prints a JSON summary: `total`, `judged`, `agreement`, `confident`,
`coverage` (confident / total), `agreementAtFloor`, `cjk { judged, agreement }`,
the top `disagreements` (`"<tag> -> <jev pick>"`), and `judgeErrors`.

- **Read-only.** Buxfer is never constructed, the finance store is reached only
  through its read methods, and Jev calls are not written to the AI usage
  ledger. Jev bills input tokens only.
- **Exit codes:** `0` summary printed; `2` bad arguments; `3` config problem
  (no Jev key, no `validTags`, no budget period); `4` every judgement failed
  (bad key, Jev down), with the error counts instead of a zero summary.
- Rows are judged one at a time with a 5 s timeout each, so `--limit 200` can
  take several minutes when Jev is slow.
- **Upper bound.** Stored descriptions are already the cleaned friendly names,
  which is easier than the raw descriptions Jev sees live. Treat replay
  agreement as an upper bound and confirm it with prod shadow.

**Baseline: none yet.** No replay has been run against live Jev, so there are
no baseline numbers. Record the first run here (date, period, `--limit`,
`--floor`, and the summary).

---

## 6. Known limits

- **The settled map is in-process.** A restart forgets it, which costs one
  re-ask per settled row.
- **CJK accuracy is weaker** per the provider. `cjk` is logged on every
  comparison and broken out by the replay.
- **LLM few-shot drift.** Few-shot examples in `chat` that use categories not
  in `validTags` teach the LLM to fail validation. Jev cannot return a tag
  outside `validTags`, and promote rescues such rows when Jev is confident.
- **`BuxferAdapter.processTransactions`** is an older, unused categorization
  loop (`aiGateway.categorize(description)`). Nothing calls it; this pipeline
  does not go through it.
- **Latency.** In shadow and promote each row also waits for Jev (up to its
  5 s timeout) when Jev is slower than the LLM.
