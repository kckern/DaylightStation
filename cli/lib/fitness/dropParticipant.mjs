/**
 * Remove a contaminating participant from a stored fitness session.
 *
 * The garage receiver enrolls any registered heart-rate strap that broadcasts
 * within range. Someone finishing an outdoor workout who walks past therefore
 * becomes a full participant of whatever session is running — earning coins,
 * satisfying zone challenges, and (once the Strava harvester matches their
 * activity to the session they are now "in") lending the household's media
 * list to their own activity title. That happened on 2026-07-25: activity
 * 19465331355, a 5.3 km outdoor run, ended up titled
 * "Super Wings—Webcaster Disaster" with twelve of the kids' episodes in its
 * description. See `#domains/fitness/services/activitySessionMatch.mjs` for the
 * guards that now prevent the match itself.
 *
 * This is a surgical strip, deliberately NOT a summary recompute: `buildSummary`
 * reassigns `summary.media[0].primary`, which would move the session's title to
 * whichever item happens to sort first. Cleaning up a contaminated roster must
 * not change what the session is about.
 *
 * Household coins are left as minted. They were really earned during the
 * session by the TreasureBox, `treasureBox.buckets` has no per-participant
 * decomposition to subtract from, and inventing one would be worse than an
 * honest note in the report.
 *
 * Dry-run by default; `--write` also lays down a backup outside any date dir.
 *
 * @module cli/lib/fitness/dropParticipant
 */

import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';

import { parseArgs, bool, str } from './argv.mjs';
import { CliError } from './context.mjs';

/**
 * @param {Object} args
 * @param {string} args.file - Absolute path to the session YAML
 * @param {string} args.participant - Participant id to remove
 * @param {string[]} [args.alsoDevices=[]] - Device ids whose `device:<id>:*`
 *   series belong to this participant but are not declared via `hr_device`
 * @param {boolean} [args.write=false] - Apply the change (default: dry run)
 * @returns {Promise<Object>} Report of what was (or would be) removed
 */
export async function dropParticipant({ file, participant, alsoDevices = [], write = false }) {
  if (!file) throw new CliError('--file is required');
  if (!participant) throw new CliError('--participant is required');

  const raw = await fs.readFile(file, 'utf8');
  const session = yaml.load(raw);

  const participants = session?.participants || {};
  if (!participants[participant]) {
    throw new CliError(
      `"${participant}" is not a participant of ${session?.sessionId || file}`
      + ` (have: ${Object.keys(participants).join(', ') || 'none'})`
    );
  }
  if (Object.keys(participants).length === 1) {
    throw new CliError(
      `"${participant}" is the only participant of ${session?.sessionId || file}`
      + ' — delete the session instead of emptying it'
    );
  }

  const meta = participants[participant];
  const activityId = meta?.strava?.activityId ?? null;

  // --- series: the participant's own, plus their HR device when unshared ----
  const series = session.timeline?.series || {};
  const seriesKeys = Object.keys(series).filter(k => k.startsWith(`${participant}:`));

  // A device is claimed when some OTHER participant declares it via hr_device.
  const claimedByOthers = (deviceId) => Object.entries(participants)
    .some(([id, m]) => id !== participant && String(m?.hr_device) === String(deviceId));

  const hrDevice = meta?.hr_device ? String(meta.hr_device) : null;

  // Explicitly named devices: real sessions frequently omit hr_device, and the
  // raw device feed is not byte-identical to `<id>:hr`, so ownership cannot be
  // inferred — the operator has to say. Refuse anything another participant
  // declares, since that would delete their trace.
  const named = alsoDevices.map(String).filter(Boolean);
  const stolen = named.filter(claimedByOthers);
  if (stolen.length > 0) {
    throw new CliError(
      `device ${stolen.join(', ')} is declared by another participant`
      + ` — refusing to remove someone else's heart-rate series`
    );
  }

  const deviceIds = new Set([
    ...(hrDevice && !claimedByOthers(hrDevice) ? [hrDevice] : []),
    ...named,
  ]);
  const deviceSeriesKeys = Object.keys(series)
    .filter(k => [...deviceIds].some(id => k.startsWith(`device:${id}:`)));

  // --- challenge rosters ----------------------------------------------------
  const events = session.timeline?.events || [];
  const challengeEvents = events.filter(e => e?.type === 'challenge'
    && (e.data?.metUsers?.includes(participant) || e.data?.missingUsers?.includes(participant)));

  // --- session-level strava link -------------------------------------------
  // Only pull it when nobody else is linked; `strava_notes` goes with it
  // because Pass 2 of reconciliation echoes our own pushed description back
  // into that field, so it is not a user note worth preserving here.
  const otherLinked = Object.entries(participants)
    .some(([id, m]) => id !== participant && m?.strava?.activityId);
  const dropsSessionStrava = !otherLinked && session.strava != null;
  const dropsStravaNotes = !otherLinked && session.strava_notes != null;

  const report = {
    file,
    sessionId: session?.sessionId || session?.session?.id || null,
    participant,
    declaredDevice: hrDevice,
    wrote: false,
    backupPath: null,
    removed: {
      participantEntry: true,
      summaryEntry: session.summary?.participants?.[participant] != null,
      seriesKeys,
      deviceSeriesKeys,
      challengeMentions: challengeEvents.length,
      sessionStrava: dropsSessionStrava,
      stravaNotes: dropsStravaNotes,
      activityId,
    },
    kept: {
      otherParticipants: Object.keys(participants).filter(id => id !== participant),
      treasureBoxCoins: session.treasureBox?.totalCoins ?? null,
      note: 'household coins left as minted — no per-participant bucket split exists',
    },
  };

  if (!write) return report;

  // --- apply ---------------------------------------------------------------
  delete session.participants[participant];
  if (session.summary?.participants) delete session.summary.participants[participant];
  for (const key of [...seriesKeys, ...deviceSeriesKeys]) delete series[key];

  for (const event of challengeEvents) {
    if (Array.isArray(event.data.metUsers)) {
      event.data.metUsers = event.data.metUsers.filter(u => u !== participant);
    }
    if (Array.isArray(event.data.missingUsers)) {
      event.data.missingUsers = event.data.missingUsers.filter(u => u !== participant);
    }
  }

  if (dropsSessionStrava) delete session.strava;
  if (dropsStravaNotes) delete session.strava_notes;

  // Backup OUTSIDE the date dir: the session lister globs every *.yml in a
  // YYYY-MM-DD folder and would load a backup as a duplicate sessionId.
  const dateDir = path.dirname(file);
  const sessionsRoot = path.dirname(dateDir);
  const backupDir = path.join(sessionsRoot, '_participant_backups');
  await fs.mkdir(backupDir, { recursive: true });
  const base = path.basename(file, '.yml');
  report.backupPath = path.join(
    backupDir,
    `${base}.${path.basename(dateDir)}.PRE-DROP-${participant}.bak.yml`
  );
  await fs.writeFile(report.backupPath, raw, 'utf8');

  await fs.writeFile(file, yaml.dump(session, { lineWidth: -1 }), 'utf8');
  report.wrote = true;

  return report;
}

// ---------------------------------------------------------------------------
// CLI surface
// ---------------------------------------------------------------------------

export const spec = {
  name: 'drop-participant',
  summary: 'remove a contaminating participant (and their strava link) from a session',
  usage: 'fitness session drop-participant --file=<session.yml> --participant=<id> [--write]',
  details: `  --file=PATH          Session YAML to edit (required)
  --participant=ID     Participant id to remove (required)
  --also-device=IDS    Comma-separated device ids whose device:<id>:* series
                       belong to this participant. Needed when the session
                       omits their hr_device (common) — ownership is never
                       guessed, and a device another participant declares is
                       refused.
  --write              Apply (default: dry run)

  Removes the participant's entry, summary block, timeline series and — when
  no one else uses it — their HR device series; strips them from challenge
  rosters; and drops the session-level strava block plus the echoed
  strava_notes when they carried the only link.

  Household coins are NOT recomputed: they were really minted during the
  session and treasureBox.buckets has no per-participant split. The summary is
  not rebuilt either, so the primary-media flag (the session title) stays put.

  A pre-drop backup lands in fitness/log/_participant_backups/ —
  deliberately outside any scanned YYYY-MM-DD dir.`,
};

/**
 * @param {string[]} argv - argv tail AFTER the group+command tokens
 * @returns {Promise<Object>} the report
 */
export async function run(argv) {
  const { flags } = parseArgs(argv, { valueFlags: ['file', 'participant', 'also-device'] });

  const report = await dropParticipant({
    file: str(flags, 'file'),
    participant: str(flags, 'participant'),
    alsoDevices: (str(flags, 'also-device') || '').split(',').map(s => s.trim()).filter(Boolean),
    write: bool(flags, 'write'),
  });

  const { removed, kept } = report;
  console.log(`${report.wrote ? 'DROPPED' : 'DRY RUN'} — ${report.participant} from session ${report.sessionId}`);
  console.log(`  participant entry:   ${removed.participantEntry ? 'remove' : '—'}`);
  console.log(`  summary entry:       ${removed.summaryEntry ? 'remove' : '—'}`);
  console.log(`  timeline series:     ${removed.seriesKeys.join(', ') || '—'}`);
  console.log(`  device series:       ${removed.deviceSeriesKeys.join(', ') || '— (shared or none)'}`);
  console.log(`  challenge rosters:   ${removed.challengeMentions} event(s)`);
  console.log(`  session strava:      ${removed.sessionStrava ? `remove (activity ${removed.activityId})` : '—'}`);
  console.log(`  strava_notes:        ${removed.stravaNotes ? 'remove' : '—'}`);
  console.log(`  keeps participants:  ${kept.otherParticipants.join(', ')}`);
  console.log(`  coins:               ${kept.treasureBoxCoins} — ${kept.note}`);
  if (report.backupPath) console.log(`  backup:              ${report.backupPath}`);
  if (!report.wrote) console.log('\nRe-run with --write to apply.');
  if (report.wrote && removed.activityId) {
    console.log(
      `\nThe provider activity still carries the household title/description. Restore it with:\n`
      + `  node cli/fitness.cli.mjs strava update ${removed.activityId} --name "<original title>" --description " "`
    );
  }

  return report;
}
