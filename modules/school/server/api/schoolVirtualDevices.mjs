/**
 * /api/v1/school/devices — the Virtual Device Console's HTTP surface.
 *
 * The School physical console spans a laser printer, a thermal printer, a
 * barcode scanner, TV/headset playback and an OMR bubble-sheet reader. None of
 * that can live in CI and most of it is not yet assembled, so Phase E built a
 * double for each one. This router is their face: it lets a human (or a
 * Playwright run) print, scan, play to completion, fill in bubbles and knock a
 * printer offline from a browser, with no hardware attached.
 *
 * FAIL CLOSED. Every route is registered only when its double is actually
 * injected, and the factory registers nothing at all when no doubles are
 * passed — so a production deployment cannot reach "make the printer fail"
 * even by guessing the path. The composition root gates the wiring behind
 * `school.yml` → `virtualDevices: true` (default false); this file makes an
 * absent double structurally impossible to call rather than merely unlikely.
 *
 * Thin shell, like every other router here: it validates the request shape,
 * calls the double, and maps the double's error `code` to a status. All the
 * behaviour lives in the doubles. Errors go to `errorHandlerMiddleware`
 * (`shape: 'string'`) rather than a hand-rolled 500.
 *
 * @module api/v1/routers/schoolVirtualDevices
 */
import express from 'express';
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';

/** Printers that can be faulted, and the faults the doubles accept. */
const FAULT_DEVICES = Object.freeze(['laser', 'thermal']);
const CAPTURE_KINDS = Object.freeze(['laser', 'thermal']);

/**
 * The doubles raise `InfrastructureError`s carrying a `code`. Left alone those
 * all map to 503 by name, which would tell a caller "the virtual printer is
 * down" when they actually sent a bad dispatch id. Map by code at the boundary
 * — importing the domain/system error classes into 4_api is a layer violation
 * (`api-no-domains`), and the code is the stable part of the contract anyway.
 */
const STATUS_BY_CODE = Object.freeze({
  UNKNOWN_DISPATCH: 404,
  UNKNOWN_CARD: 404,
  INVALID_CARD: 400,
  INVALID_DISPATCH: 400,
  INVALID_DISPATCH_STATE: 409,
  INVALID_ADVANCE: 400,
  INVALID_FAULT: 400,
  INVALID_FORM_MAP: 400,
  UNKNOWN_OMR_ITEM: 400,
  UNKNOWN_OMR_CHOICE: 400,
  OMR_CONFLICTING_ITEMS: 400,
  OMR_NOT_AMBIGUABLE: 400,
  OMR_ROW_OVERFLOW: 400,
});

/** @returns {Error} an error the house handler will render at `status`. */
function httpError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

/**
 * Run a double and re-stamp its error with an HTTP status derived from the
 * error code, so `errorHandlerMiddleware` renders 404/400/409 instead of 503.
 */
function callDouble(fn) {
  try {
    return fn();
  } catch (err) {
    const mapped = STATUS_BY_CODE[err?.code];
    if (mapped && err.status === undefined) err.status = mapped;
    throw err;
  }
}

async function callDoubleAsync(fn) {
  try {
    return await fn();
  } catch (err) {
    const mapped = STATUS_BY_CODE[err?.code];
    if (mapped && err.status === undefined) err.status = mapped;
    throw err;
  }
}

/**
 * @param {Object} deps
 * @param {Object} [deps.consoleOperations] - Semantic virtual-device console
 * @param {Object} [deps.logger=console]
 * @returns {import('express').Router} empty when nothing is wired
 */
export function createSchoolVirtualDevicesRouter({
  consoleOperations = null,
  logger = console,
} = {}) {
  const router = express.Router();

  if (!consoleOperations?.available) {
    // Nothing to drive: register no routes. Every path under the mount 404s,
    // which is the only correct answer for a console that does not exist.
    logger.warn?.('school.virtual-devices.not-wired', {});
    return router;
  }
  logger.info?.('school.virtual-devices.mounted', {});

  // ---------------------------------------------------------------------------
  // Status — what exists right now, so the console can render fault toggles and
  // capture counts without probing each route.
  // ---------------------------------------------------------------------------
  router.get('/status', asyncHandler(async (_req, res) => {
    res.json(consoleOperations.status());
  }));

  // ---------------------------------------------------------------------------
  // Captures — everything the two printers "produced", newest first.
  // ---------------------------------------------------------------------------
  if (consoleOperations.capturesAvailable) {
    router.get('/captures', asyncHandler(async (_req, res) => {
      res.json({ captures: consoleOperations.listCaptures() });
    }));

    // Raw bytes, never base64-in-JSON: a PDF is served as a PDF so the console
    // can drop the URL straight into an <iframe>.
    router.get('/captures/:kind/:id', asyncHandler(async (req, res) => {
      const { kind, id } = req.params;
      if (!CAPTURE_KINDS.includes(kind)) {
        throw httpError(400, `unknown capture kind ${kind} (expected ${CAPTURE_KINDS.join('|')})`, 'UNKNOWN_CAPTURE_KIND');
      }

      const capture = await consoleOperations.capture(kind, id);
      if (capture.kind === 'device_not_wired') throw httpError(404, `virtual ${capture.device} printer is not wired`, 'DEVICE_NOT_WIRED');
      if (capture.kind === 'not_found') throw httpError(404, `unknown ${capture.capture} ${id}`, 'UNKNOWN_CAPTURE');
      if (capture.kind === 'laser') {
        const { job } = capture;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Length', String(job.pdf.length));
        res.setHeader('Content-Disposition', `inline; filename="${job.jobId}.pdf"`);
        return res.end(job.pdf);
      }

      const { receipt } = capture;
      // The thermal double captures a JSON item list plus a decoded text
      // transcript — it renders no PNG — so the capture is served as JSON, with
      // ?format=text for the paper's-eye view.
      if (req.query.format === 'text') {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.end(receipt.transcript ?? '');
      }
      return res.json(receipt);
    }));
  }

  // ---------------------------------------------------------------------------
  // Scanner
  // ---------------------------------------------------------------------------
  if (consoleOperations.scannerAvailable) {
    router.post('/scan', asyncHandler(async (req, res) => {
      const { code, device, route } = req.body || {};
      const payload = callDouble(() => consoleOperations.scan(code, { device, route }));
      // The double drops an empty code rather than emitting a scan; a request
      // that produced no scan is a bad request, not a silent success.
      if (!payload) throw httpError(400, 'scan requires a non-empty code', 'INVALID_SCAN');
      res.json(payload);
    }));

    router.get('/scan', asyncHandler(async (_req, res) => {
      res.json(consoleOperations.scans());
    }));
  }

  // ---------------------------------------------------------------------------
  // Playback
  // ---------------------------------------------------------------------------
  if (consoleOperations.playbackAvailable) {
    router.get('/playback', asyncHandler(async (_req, res) => {
      res.json({ dispatches: consoleOperations.dispatches() });
    }));

    router.post('/playback/:dispatchId/complete', asyncHandler(async (req, res) => {
      res.json(callDouble(() => consoleOperations.complete(req.params.dispatchId)));
    }));

    router.post('/playback/:dispatchId/interrupt', asyncHandler(async (req, res) => {
      res.json(callDouble(() => consoleOperations.interrupt(req.params.dispatchId)));
    }));

    router.post('/playback/:dispatchId/advance', asyncHandler(async (req, res) => {
      const { seconds } = req.body || {};
      res.json(callDouble(() => consoleOperations.advance(req.params.dispatchId, seconds)));
    }));
  }

  // ---------------------------------------------------------------------------
  // OMR — a bubble sheet filled in by hand instead of by pencil.
  // ---------------------------------------------------------------------------
  if (consoleOperations.omrAvailable) {
    router.get('/omr/forms/:formId/layout', asyncHandler(async (req, res) => {
      const result = await consoleOperations.formLayout(req.params.formId);
      if (result.kind === 'invalid') throw httpError(400, 'formId is required', 'INVALID_FORM_ID');
      if (result.kind === 'not_found') throw httpError(404, `unknown form ${req.params.formId}`, 'UNKNOWN_FORM');
      res.json({
        formId: req.params.formId,
        formVersion: result.formVersion,
        layout: result.layout,
      });
    }));

    router.post('/omr/submit', asyncHandler(async (req, res) => {
      const { formId, answers = {}, ambiguous = [], blank = [] } = req.body || {};
      if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) {
        throw httpError(400, 'answers must be an object of itemId to choice', 'INVALID_OMR_ANSWERS');
      }
      if (!Array.isArray(ambiguous) || !Array.isArray(blank)) {
        throw httpError(400, 'ambiguous and blank must be arrays of itemIds', 'INVALID_OMR_ANSWERS');
      }
      const result = await callDoubleAsync(() => consoleOperations.submitOmr({ formId, answers, ambiguous, blank }));
      if (result.kind === 'invalid') throw httpError(400, 'formId is required', 'INVALID_FORM_ID');
      if (result.kind === 'not_found') throw httpError(404, `unknown form ${formId}`, 'UNKNOWN_FORM');
      res.json({ formId, formVersion: result.formVersion, sheet: result.sheet });
    }));

    router.get('/omr/sheets', asyncHandler(async (_req, res) => {
      res.json({ sheets: consoleOperations.sheets() });
    }));
  }

  // ---------------------------------------------------------------------------
  // Fault injection — the whole reason this surface is gated.
  // ---------------------------------------------------------------------------
  if (consoleOperations.faultsAvailable) {
    router.post('/fault', asyncHandler(async (req, res) => {
      const { device, fault = null } = req.body || {};
      if (!FAULT_DEVICES.includes(device)) {
        throw httpError(400, `unknown device ${device} (expected ${FAULT_DEVICES.join('|')})`, 'UNKNOWN_DEVICE');
      }
      const result = callDouble(() => consoleOperations.setFault(device, fault));
      if (result.kind === 'not_wired') throw httpError(404, `virtual ${device} printer is not wired`, 'DEVICE_NOT_WIRED');
      logger.info?.('school.virtual-devices.fault', { device, fault });
      res.json({ device, fault: result.fault });
    }));
  }

  router.use(errorHandlerMiddleware({ shape: 'string' }));
  return router;
}

export default createSchoolVirtualDevicesRouter;
