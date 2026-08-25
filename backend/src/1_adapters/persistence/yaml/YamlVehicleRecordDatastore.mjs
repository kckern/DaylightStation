/**
 * Persistence for the records a person authored.
 *
 *   household/automotive/<vehicle-id>/
 *     vehicle.yml     identity, VIN, purchase/sale
 *     service.yml     maintenance records
 *     fuel.yml        fill-ups
 *     documents.yml   glove box index
 *     files/          the documents and photos themselves
 *
 * Deliberately OUTSIDE `history/automotive/`, which the relay owns and appends
 * to. A history-format migration must never be in a position to rewrite
 * something a person typed.
 *
 * Serialization lives here, not in the domain: entities are reconstituted on
 * read and flattened on write, so the domain never learns what YAML is.
 *
 * @module adapters/persistence/yaml/YamlVehicleRecordDatastore
 */

import path from 'path';
import { IVehicleRecordRepository } from '#apps/automotive/ports/IVehicleRecordRepository.mjs';
import { ServiceRecord } from '#domains/automotive/entities/ServiceRecord.mjs';
import { FuelLog } from '#domains/automotive/entities/FuelLog.mjs';
import { Document } from '#domains/automotive/entities/Document.mjs';
import { loadYamlSafe, saveYaml, ensureDir, dirExists, listDirs } from '#system/utils/FileIO.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const RESERVED_LOG_DIR = 'log';

export class YamlVehicleRecordDatastore extends IVehicleRecordRepository {
  #root;
  #logger;

  /**
   * @param {object} deps
   * @param {string} deps.recordsRoot absolute path to .../household/automotive
   * @param {object} [deps.logger]
   */
  constructor({ recordsRoot, logger = console } = {}) {
    super();
    if (!recordsRoot) {
      throw new InfrastructureError('YamlVehicleRecordDatastore requires recordsRoot', {
        code: 'MISSING_DEPENDENCY', dependency: 'recordsRoot',
      });
    }
    this.#root = recordsRoot;
    this.#logger = logger;
  }

  async listVehicleIds() {
    if (!dirExists(this.#root)) return [];
    // `log/` is the ONE reserved name inside a household domain (see
    // configuration.md, "one domain, one folder") — append-only history, not
    // live state. This root is the automotive domain itself, so its sibling
    // log/ would otherwise enumerate as a vehicle named "log". It did,
    // briefly, and showed up in /api/v1/automotive/vehicles.
    return listDirs(this.#root).filter((name) => name !== RESERVED_LOG_DIR).sort();
  }

  async readVehicle(vehicleId) {
    return loadYamlSafe(this.#file(vehicleId, 'vehicle')) || null;
  }

  async saveVehicle(vehicleId, vehicle) {
    this.#ensureVehicleDir(vehicleId);
    saveYaml(this.#file(vehicleId, 'vehicle'), vehicle, { noRefs: true });
    return vehicle;
  }

  async listServiceRecords(vehicleId) {
    return this.#loadList(vehicleId, 'service', (row) => new ServiceRecord({
      id: row.id,
      date: new Date(row.date),
      type: row.type,
      vendor: row.vendor ?? null,
      cost: numberOrNull(row.cost),
      odometerKm: numberOrNull(row.odometer_km),
      intervalMonths: numberOrNull(row.interval_months),
      intervalKm: numberOrNull(row.interval_km),
      notes: row.notes || '',
      attachments: Array.isArray(row.attachments) ? row.attachments : [],
    }));
  }

  async saveServiceRecord(vehicleId, record) {
    return this.#upsert(vehicleId, 'service', record, dehydrateServiceRecord);
  }

  async deleteServiceRecord(vehicleId, recordId) {
    return this.#remove(vehicleId, 'service', recordId);
  }

  async listFuelLogs(vehicleId) {
    return this.#loadList(vehicleId, 'fuel', (row) => new FuelLog({
      id: row.id,
      date: new Date(row.date),
      odometerKm: numberOrNull(row.odometer_km),
      volumeL: Number(row.volume_l),
      priceTotal: numberOrNull(row.price_total),
      placeId: row.place ?? null,
      partial: row.partial === true,
      notes: row.notes || '',
    }));
  }

  async saveFuelLog(vehicleId, log) {
    return this.#upsert(vehicleId, 'fuel', log, dehydrateFuelLog);
  }

  async deleteFuelLog(vehicleId, logId) {
    return this.#remove(vehicleId, 'fuel', logId);
  }

  async listDocuments(vehicleId) {
    return this.#loadList(vehicleId, 'documents', (row) => new Document({
      id: row.id,
      kind: row.kind || 'other',
      label: row.label,
      file: row.file ?? null,
      issued: row.issued ?? null,
      expires: row.expires ?? null,
      notes: row.notes || '',
    }));
  }

  async saveDocument(vehicleId, document) {
    return this.#upsert(vehicleId, 'documents', document, dehydrateDocument);
  }

  // ---- internals -----------------------------------------------------------

  #file(vehicleId, name) {
    return path.join(this.#root, sanitize(vehicleId), name);
  }

  #ensureVehicleDir(vehicleId) {
    ensureDir(path.join(this.#root, sanitize(vehicleId)));
  }

  /**
   * Reconstitute a list, skipping rows the domain refuses.
   *
   * A single malformed row — a fill-up someone hand-edited to zero litres —
   * must not blank the whole fuel history. The bad row is logged and dropped;
   * everything else still loads.
   */
  #loadList(vehicleId, name, toEntity) {
    const rows = loadYamlSafe(this.#file(vehicleId, name));
    if (!Array.isArray(rows)) return [];
    const entities = [];
    for (const row of rows) {
      try {
        entities.push(toEntity(row));
      } catch (error) {
        this.#logger.warn?.('automotive.records.row_rejected', {
          vehicleId, file: name, id: row?.id, error: error.message,
        });
      }
    }
    return entities;
  }

  /** Insert or replace by id, keeping the file sorted newest-first by date. */
  #upsert(vehicleId, name, entity, dehydrate) {
    this.#ensureVehicleDir(vehicleId);
    const file = this.#file(vehicleId, name);
    const rows = loadYamlSafe(file) || [];
    const next = dehydrate(entity);
    const index = rows.findIndex((row) => row?.id === next.id);
    if (index === -1) rows.push(next); else rows[index] = next;
    rows.sort(byDateDescending);
    saveYaml(file, rows, { noRefs: true });
    return entity;
  }

  #remove(vehicleId, name, id) {
    const file = this.#file(vehicleId, name);
    const rows = loadYamlSafe(file) || [];
    const remaining = rows.filter((row) => row?.id !== id);
    if (remaining.length === rows.length) return false;
    saveYaml(file, remaining, { noRefs: true });
    return true;
  }
}

/** Newest first; rows without a date sink to the bottom rather than sorting as epoch 0. */
function byDateDescending(a, b) {
  const aDate = a?.date || a?.expires || '';
  const bDate = b?.date || b?.expires || '';
  if (!aDate && !bDate) return 0;
  if (!aDate) return 1;
  if (!bDate) return -1;
  return bDate.localeCompare(aDate);
}

const numberOrNull = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_');

function dehydrateServiceRecord(record) {
  return {
    id: record.id,
    date: record.date.toISOString().slice(0, 10),
    type: record.type,
    vendor: record.vendor,
    cost: record.cost,
    odometer_km: record.odometerKm,
    interval_months: record.intervalMonths,
    interval_km: record.intervalKm,
    notes: record.notes,
    attachments: record.attachments,
  };
}

function dehydrateFuelLog(log) {
  return {
    id: log.id,
    date: log.date.toISOString().slice(0, 10),
    odometer_km: log.odometerKm,
    volume_l: log.volumeL,
    price_total: log.priceTotal,
    price_per_litre: log.pricePerLitre,
    place: log.placeId,
    partial: log.partial,
    notes: log.notes,
  };
}

function dehydrateDocument(document) {
  return {
    id: document.id,
    kind: document.kind,
    label: document.label,
    file: document.file,
    issued: document.issued?.toISOString().slice(0, 10) ?? null,
    expires: document.expires?.toISOString().slice(0, 10) ?? null,
    notes: document.notes,
  };
}
