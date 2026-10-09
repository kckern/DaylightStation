import { EpaperDisplayService } from "../application/epaper/EpaperDisplayService.mjs";
import { createEpaperRouter } from "../api/epaper.mjs";

/**
 * Compose the currently optional ePaper API without implicitly mounting it.
 * A caller that enables the display supplies the concrete adapter here.
 */
export function createEpaperApiRouter({ epaperAdapter = null, clock, logger = console } = {}) {
  const epaperService = new EpaperDisplayService({ display: epaperAdapter, clock });
  return createEpaperRouter({ epaperService, logger });
}
