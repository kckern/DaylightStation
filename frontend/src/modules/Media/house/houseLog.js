// frontend/src/modules/Media/house/houseLog.js
// Structured events for the house view, screen naming/admin, routines and
// house-wide actions (RQ-HOUSE-04/06/07/08, RQ-STEER-11/13/21, RQ-PLAY-10,
// RQ-RELY-12, RQ-AUTO-05). Same durable `media` app logger as mediaLog.js
// (context.app + sessionLog come from MediaApp's configure call); kept in
// its own file so parallel work on mediaLog.js never collides with it.
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';

const logger = createAppLogger('media');
const SAMPLED = { maxPerMinute: 30, aggregate: true };

const info = (event) => (data) => logger.info(event, data);
const debug = (event) => (data) => logger.debug(event, data);
const warn = (event) => (data) => logger.warn(event, data);
const sampled = (event) => (data) => logger.sampled(event, data, SAMPLED);

export const houseLog = {
  registryLoaded:       debug('house.registry-loaded'),
  registryFailed:       warn('house.registry-failed'),
  screenAnnounced:      info('house.screen-announced'),
  announceFailed:       warn('house.announce-failed'),
  screenRenamed:        info('house.screen-renamed'),
  renameConflict:       info('house.rename-conflict'),
  roomSet:              info('house.room-set'),
  roomNeighboursSet:    info('house.room-neighbours-set'),
  screenAdded:          info('house.screen-added'),
  screenMerged:         info('house.screen-merged'),
  screenUnmerged:       info('house.screen-unmerged'),
  screenRetired:        info('house.screen-retired'),
  screenRestored:       info('house.screen-restored'),
  adminActionFailed:    warn('house.admin-action-failed'),
  startStatus:          sampled('house.start-status'),
  startStatusFailed:    warn('house.start-status-failed'),
  startedByLoaded:      debug('house.started-by-loaded'),
  startedByFailed:      warn('house.started-by-failed'),
  quietAll:             info('house.quiet-all'),
  quietAllUnreached:    warn('house.quiet-all-unreached'),
  addOnlyOff:           info('house.add-only-off'),
  addOnlyOffFailed:     warn('house.add-only-off-failed'),
  putBack:              info('house.put-back'),
  putBackFailed:        warn('house.put-back-failed'),
  screenOff:            info('house.screen-off'),
  screenOffFailed:      warn('house.screen-off-failed'),
  firstUseShown:        info('house.first-use-shown'),
  firstUseNamed:        info('house.first-use-named'),
  firstUseSkipped:      info('house.first-use-skipped'),
  routinesLoaded:       debug('house.routines-loaded'),
  routinesFailed:       warn('house.routines-failed'),
  viewOpened:           info('house.view-opened'),
};

export default houseLog;
