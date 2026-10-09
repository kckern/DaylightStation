import { StravaClientAdapter } from './adapters/StravaClientAdapter.mjs';

/** Installed Strava activity gateway shared with the harvesting runtime. */
export function createActivityGateway({httpClient,configService,logger}) {
  return new StravaClientAdapter({httpClient,configService,logger});
}
