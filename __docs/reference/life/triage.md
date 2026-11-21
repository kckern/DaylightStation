# Life triage

Triage pre-sorts a person's mailbox and task lists and walks them through the rest
in a guided session under **Life → Now**. It lives in
`__app_modules/personal/triage/` (server) and
`__app_modules/personal/life/browser/views/now/` (the Now card and the session view).

## What it does

Three tiers:

1. **Done for you.** An unattended pass (cron, default `0 5 * * *`, or **Start
   triage → run now**) archives quick-win mail and closes obviously dead tasks.
   Every action is logged with its inverse and can be undone from the session's
   "What I did" log.
2. **Your call.** Anything borderline becomes a card: a one-line reason, 3–4
   choices with one marked *suggested*, and a text/voice box.
3. **Copilot.** Mail that needs a reply gets a draft to edit and send; tasks get
   *do this week / push to next month / drop / turn into a smaller next step*.

A voice transcript is added to the current card’s draft for review. Moving to
another card or leaving Triage cancels the pending transcript request. The
answer is sent only when the person submits it.

The session runs urgent replies first, then **Recap → Unsure → Replies → Todos**,
skipping empty steps. Stopping part-way leaves the rest queued; nothing unreached
is decided by default.

**Start triage** links from Now to `/life/now/triage`. **Stop for now** and
**Back to Now** return to `/life/now`. The Now destination stays selected
throughout the session, and switching household members opens the new member's
triage view.

## Never-auto rules

Whatever Jev's confidence, nothing is acted on unattended when the item:

- is from a real person the owner has written to (only automated senders qualify);
- mentions legal / medical / school matters;
- comes from a person (not an automated sender) and mentions a deadline or a money amount;
- carries an attachment from a non-automated sender;
- is starred, or sits in a thread the owner replied to.

Tasks close unattended only as an **exact duplicate** (same normalised title, same
list, both open, the newer one closes, and never both copies in one pass) or when
**long overdue** (non-recurring, due and untouched for `overdueDays`), and only
when the task read is complete. The keyword lists live in
`server/domain/guardrails.mjs` and deliberately over-block. Missing facts block.

Deadline and money words in mail from an **automated** sender (sign-in links that
"expire", receipts, statements) are not blocks: Jev is told the mail mentions them
(`mentions` in its state) and weighs them. Beyond the rules, mail is archived only
when Jev answers *archive* with confidence ≥ `autoArchiveConfidence`.

When Jev answers *keep* with confidence ≥ 0.85 the mail gets no card: it stays in
the inbox and the pass logs it as **Kept** (in both modes, since nothing changes in
the mailbox). The recap counts it as *Left in inbox, no card needed*.

## Configuration

`data/household/triage/config.yml` (registry key `triage`):

```yaml
triage:
  enabled: false
  defaults:
    mode: dryRun            # off | dryRun | live
    inboxWindowDays: 14
    inboxMax: 200
    autoArchiveConfidence: 0.92   # below 0.8 disables the user
    overdueDays: 60
    schedule: "0 5 * * *"
    taskDomain: personal    # work domain for "Make a todo"
  users:
    <username>: {}          # explicit opt-in; scalars override defaults
```

The default user is the household head. Task access goes through the work
module (`work/config.yml`); a user must be enrolled there too for the todo half.

**Dry run** (`mode: dryRun`) never archives or closes anything unattended and
creates no mailbox drafts; cards show *Would have archived / closed*. The owner's
own taps in the session are real in both modes.

## Who may use it

`GET /status` and `GET /summary` (counts only) are open. Everything that shows
mail or task content or acts on it (`/session`, `/log`, `/run`, answers, skip,
resolve, undo) requires the user's own **login session** (the app's auth:
`tokenResolver` → `req.user` with a live `sid`; revoke a device under Admin →
Household → Sessions). A session for another user gets 403
`session_user_mismatch`.

Grant the app route in `data/system/config/auth.yml`:

```yaml
app_routes:
  triage: [triage/*]
```

and give the owner's role the `triage` app.

## How actions stay safe

- **Version check.** Every answer re-reads the item; a changed or vanished item
  returns `conflict` and nothing happens.
- **One lock per user** shared by the pass and answers (answers wait up to 30 s,
  then 409 `pass_running`). Pass writes merge against a fresh read, so an answered
  card is never brought back.
- **Applying state.** Sending a reply or creating a task marks the card
  `applying` first. If the result is unknown the card stays *in doubt*: the owner
  answers *Did this go through?* (`POST /cards/:id/resolve`); triage never re-sends
  on its own.
- **Free text never sends.** A typed or spoken answer can edit a draft or pick a
  reversible choice; Send always needs a tap.
- **Task writes** go only through the work module's commands: the owner's taps as
  a *web* principal (login session; the tap is the confirmation), the unattended
  pass as the *triage-overnight* system principal, which may only `complete`.
  See [Work coordination](../work/coordination.md#web-and-system-principals).

## Integrations

Only adapters know providers. The mailbox port (`server/ports/IMailbox.mjs`) has a
Gmail adapter; it needs the Google token to include `gmail.modify` and
`gmail.compose`. Missing permission is detected at the first rejected write: that
pass stops writing, cards the rest and the Now card shows **Reconnect
&lt;mailbox&gt;**. A connections admin page and Google re-consent flow are not
built yet.

## API

| Route | Guard | Purpose |
|---|---|---|
| `GET /api/v1/triage/status` | open | `{ username, enrolled, mode }` |
| `GET /api/v1/triage/summary` | open | counts, mailbox state, dry-run counts |
| `GET /api/v1/triage/session` | login | ordered open cards and steps |
| `POST /api/v1/triage/run` | login | run a pass now |
| `POST /api/v1/triage/cards/:id/answer` | login | `{ choice? , text?, draft? }` |
| `POST /api/v1/triage/cards/:id/skip` | login | leave for next time |
| `POST /api/v1/triage/cards/:id/resolve` | login | `{ happened }` for an in-doubt card |
| `GET /api/v1/triage/log?sinceDays=7` | login | what was done |
| `POST /api/v1/triage/log/:entryId/undo` | login | undo one action |

The browser scopes each read to the view that displays it. Leaving Now or Triage
aborts that view's pending read, and closing Review aborts its log read. Each
read flow has a 10-second deadline. The guided session shares its deadline
between the enrollment summary and the authenticated session read. After a
timeout, Retry repeats only the affected GET flow.

A current protected read or command that receives `401 login_required` opens
sign-in. If someone else is signed in, `403 session_user_mismatch` names the
selected member and offers the same sign-in form. Choosing a household member
leaves the signed-in account in place. Signing in reloads the selected member's
guided session. Triage commands keep their own outcome and retry controls.

In the action log, Undo can be retried when the server reports
`failed/propose_failed`, which means the undo command did not start. Other
unconfirmed failures do not offer resubmission because the original action's
state may be unknown. When keyboard focus was on Undo, it moves to Retry undo
after this safe-to-retry response.

## Logs

`context.app:triage` in the log store. Events: `triage.pass.started|completed|skipped|failed`,
`triage.card.answered`, `triage.card.conflict`, `triage.undo.*`,
`triage.mailbox.scope_missing`, `triage.schedule.empty`.

## Data

Per user, through the data service: `users/<u>/apps/triage/queue`,
`users/<u>/apps/triage/log/<YYYY-MM>`, `users/<u>/apps/triage/state`. A corrupt
file is reported, never overwritten.
