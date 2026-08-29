import os from 'node:os';
import path from 'node:path';
import { ensureDir, writeBinary } from '#system/utils/FileIO.mjs';
import { INutriReportDelivery } from '#apps/nutribot/ports/INutriReportDelivery.mjs';

/** Owns the temporary-file convention required by messaging transports. */
export class TemporaryNutriReportDelivery extends INutriReportDelivery {
  #renderer; #now; #logger;

  constructor({ renderer, now = () => Date.now(), logger = console } = {}) {
    super();
    if (!renderer?.renderDailyReport) {
      throw new TypeError('TemporaryNutriReportDelivery requires renderer.renderDailyReport');
    }
    this.#renderer = renderer;
    this.#now = now;
    this.#logger = logger;
  }

  async prepare(report) {
    const bytes = await this.#renderer.renderDailyReport(report);
    const directory = path.join(os.tmpdir(), 'nutribot-reports');
    ensureDir(directory);
    const locator = path.join(directory, `report-${report.date}-${this.#now()}.png`);
    writeBinary(locator, bytes);
    this.#logger.debug?.('nutribot.report-artifact.prepared', { locator });

    return Object.freeze({
      sendTo: (messaging, caption, options = {}) => messaging.sendPhoto(locator, caption, options),
    });
  }
}

export default TemporaryNutriReportDelivery;
