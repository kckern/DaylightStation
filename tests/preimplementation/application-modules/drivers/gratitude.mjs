import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { candidatePreflight, loadGratitudeImplementation } from './gratitude-target.mjs';
const implementation = await loadGratitudeImplementation();
const { createGratitudeRouter, createApiRouter, errorHandlerMiddleware, permissionGate, GratitudeService, GratitudeHouseholdService, GratitudeCardPrintService, GratitudeEvents, YamlGratitudeDatastore } = implementation;
export const householdA = 'audit-household-a';
export const householdB = 'audit-household-b';
export const stamp = '2026-09-05T12:00:00.000Z';
export const logger = {
  info() {},
  debug() {},
  warn() {},
  error() {},
  child() {
    return this;
  }
};
export function candidateDriver() {
  const preflight = candidatePreflight();
  if (preflight.target !== 'candidate') throw new Error('CANDIDATE_NOT_IMPLEMENTED: select PRE_TARGET=candidate; baseline fallback is forbidden');
  return implementation;
}
export function fixture({
  printerOutcome = true,
  missingPrinter = false,
  renderer = true,
  access = null
} = {}) {
  if (!process.env.PRE_RUN_ROOT || process.env.DAYLIGHT_BASE_PATH || process.env.DAYLIGHT_DATA_PATH) throw new Error('Unsafe fixture environment');
  const runRoot = fs.realpathSync(process.env.PRE_RUN_ROOT);
  const directory = fs.mkdtempSync(path.join(runRoot, 'gratitude-'));
  const records = new Map();
  const writes = [];
  const broadcasts = [];
  const effects = [];
  function assertHousehold(hid) {
    if (![householdA, householdB].includes(hid)) throw new Error('UNSAFE_HOUSEHOLD_REFUSED');
  }
  const key = (p, hid) => {
    assertHousehold(hid);
    return hid + ':' + p;
  };
  const dataService = {
    household: {
      read(p, hid = householdA) {
        return structuredClone(records.get(key(p, hid)) ?? null);
      },
      write(p, value, hid = householdA) {
        const k = key(p, hid);
        writes.push({
          path: p,
          household: hid,
          value: structuredClone(value)
        });
        records.set(k, structuredClone(value));
      },
      resolvePath(p, hid = householdA) {
        assertHousehold(hid);
        if (p !== 'gratitude/snapshots') throw new Error('UNSAFE_PATH_REFUSED');
        return path.join(directory, hid, 'gratitude/snapshots.yml');
      }
    }
  };
  const store = new YamlGratitudeDatastore({
    dataService,
    logger
  });
  const service = new GratitudeService({
    store
  });
  const directoryPort = {
    defaultHouseholdId: () => householdA,
    timezone: () => 'UTC',
    userIds: hid => hid === householdB ? ['visitor'] : ['alex', 'bryn'],
    userProfile: id => id === 'alex' ? {
      display_name: 'Alex',
      group_label: 'Family A'
    } : id === 'bryn' ? {
      name: 'Bryn'
    } : null
  };
  const household = new GratitudeHouseholdService({
    householdDirectory: directoryPort,
    gratitudeService: service
  });
  const events = new GratitudeEvents({
    publish: p => broadcasts.push(p),
    nowMs: () => 123456,
    timestamp: () => stamp
  });
  const cardPrintService = new GratitudeCardPrintService({
    printerRegistry: {
      resolve(location) {
        effects.push(['resolve', location]);
        if (missingPrinter) throw new Error('Unknown printer');
        return {
          id: 'fake-printer'
        };
      }
    },
    imagePrintGateway: {
      async print(printer, job) {
        effects.push(['print', printer.id, job]);
        return printerOutcome;
      }
    }
  });
  const selectedIds = {
    gratitude: [],
    hopes: []
  };
  const createCanvas = async upside => {
    effects.push(['render', upside]);
    return {
      canvas: {
        toBuffer: () => Buffer.from('synthetic-png')
      },
      width: 580,
      height: 450,
      selectedIds
    };
  };
  const productRouter = createGratitudeRouter({
    gratitudeService: service,
    gratitudeHouseholdService: household,
    gratitudeEvents: events,
    cardPrintService,
    createGratitudeCardCanvas: renderer ? createCanvas : null,
    logger
  });
  const api = createApiRouter({
    safeConfig: {},
    routers: {
      gratitude: productRouter
    },
    logger
  });
  const outer = express.Router();
  if (access) outer.use('/api/v1', permissionGate({
    ...access,
    logger
  }));
  outer.use('/api/v1', api);
  outer.use(errorHandlerMiddleware());
  async function request(method, suffix, {
    body,
    query = {},
    roles = [],
    user = null,
    householdId = householdB
  } = {}) {
    const url = '/api/v1/gratitude' + suffix;
    const req = {
      method,
      url,
      originalUrl: url,
      baseUrl: '',
      headers: {},
      body,
      query,
      roles,
      user,
      householdId,
      get(name) {
        return this.headers[name.toLowerCase()];
      }
    };
    Object.defineProperty(req, 'path', {
      get() {
        return this.url.split('?')[0];
      }
    });
    return new Promise((resolve, reject) => {
      let status = 200;
      const headers = {};
      const done = body => resolve({
        status,
        headers,
        body
      });
      const res = {
        headersSent: false,
        status(value) {
          status = value;
          return this;
        },
        setHeader(name, value) {
          headers[name.toLowerCase()] = value;
          return this;
        },
        json: done,
        send: done,
        end: done
      };
      outer.handle(req, res, error => error ? reject(error) : resolve({
        status: 404,
        headers,
        body: null,
        unhandled: true
      }));
    });
  }
  return {
    store,
    service,
    household,
    events,
    dataService,
    records,
    writes,
    broadcasts,
    effects,
    selectedIds,
    productRouter,
    request,
    directory
  };
}
