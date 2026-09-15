# Deferred device actions must not outlive their intent

A device action that waits before it acts — a timeout, a retry ladder, a
"last resort" branch — is a promise made about a room in the past. By the
time it fires, the room may have changed its mind. This runbook exists
because one of them fired into a living room full of people.

The Home Assistant config volume is **not** version controlled (its path is
in `CLAUDE.local.md`), so changes to its scripts leave no history. This
document is the record.

## The incident, 2026-09-15

A reading session in the living room hit its idle timeout after about two
minutes of quiet. The app asked Home Assistant to turn the TV off, which is
the reader's configured end policy for an empty room.

The TV-off script tries the normal off command first, then waits up to seven
minutes for the TV's power draw to fall below 5W. That wait exists for a good
reason: this OLED descends slowly from its post-off plateau, and an earlier
version cut the plug at 75 seconds, making every next wake a cold boot. If
the TV is still drawing real power when the wait expires, the script cuts the
plug as a last resort, on the assumption that the off command never landed.

Thirty seconds after the off began, the family turned the TV back on and
started watching something else. Nothing cancelled the pending script. Seven
minutes later its wait expired, it saw 134W, concluded the TV had ignored the
off command, and killed the plug mid-show. The cut was silent: no
notification, and the only trace was a service call in the recorder database.

| Time (UTC) | Event |
|---|---|
| 23:06:58 | Reading session idle timeout; app requests TV off; script starts |
| 23:07:06 | TV goes off normally |
| 23:07:13 | Script enters its seven-minute wait for power to fall |
| 23:07:32 | TV powered back on; people watching |
| 23:14:13 | Wait expires, sees 134W, cuts the plug |
| 23:14:17 | TV dark. Plug stayed off until restored by hand |

## The two guards now in place

Both live in the living-room TV scripts in the Home Assistant config.

1. **Turning the TV on cancels a pending off.** The on script's first step
   stops the off script. This covers every caller — the app, an NFC tag, a
   kitchen button, a dashboard — because they all run that one script.
2. **The cut re-checks intent before firing.** The off script records when it
   started, and the last-resort branch is guarded by a second condition: skip
   the cut if the on script was triggered after this run began. That is the
   same `last_triggered` intent signal the zombie wake guard already uses. It
   catches wakes that never ran the on script, such as a CEC wake from the
   Shield or the TV's own remote.

Both branches now raise a persistent notification: one saying the plug was
cut and why, one saying the cut was skipped because someone had turned the TV
back on. A safety net that acts on a household's behalf has to say so.

## Verifying a change to these scripts

Reload scripts in Home Assistant, then confirm all three cases. The first two
need an empty room, because a failure leaves a live seven-minute timer armed.

1. **Cancel:** start an off, turn the TV on during the wait. The off script
   should go to `off` immediately and the plug should stay on.
2. **Re-check:** start an off, then turn the TV on by a path that skips the on
   script. Let the wait expire. No cut, and a "skipped" notification.
3. **Genuine catch:** leave a TV drawing power with no deliberate wake. Let the
   wait expire. The cut fires and notifies.

## The rule

Any deferred action that can destroy state must:

- **be cancellable by the opposite intent** — the request that undoes it should
  stop it, not race it; and
- **re-check that intent at the moment it acts**, not only when it was armed.

A restart-mode script satisfies neither on its own: restarting on a second
*off* request says nothing about an *on* request arriving mid-wait.

When auditing, look for a wait or delay measured in minutes that ends in a
destructive branch. As of 2026-09-15 the living-room TV off script was the
only one in this house; the office equivalent cuts and restores power within
seconds, which cannot strand a room.
