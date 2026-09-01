#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';

const IDENTICON_VERSION = 'v1';

export function auditAnswerSheets(cards, { now = new Date(), staleHours = 24 } = {}) {
  const issues = [];
  const all = [...cards.values()].flat();
  const byLearner = new Map();
  for (const record of all) {
    if (record.learnerId) {
      if (!byLearner.has(record.learnerId)) byLearner.set(record.learnerId, []);
      byLearner.get(record.learnerId).push(record);
    }
    if (record.status === 'live' && !record.sessionId) {
      issues.push(issue('missing-session', record, 'live allocation has no sessionId'));
    }
    if (record.status === 'live' && !['pending', 'delivered', 'cancelled'].includes(record.deliveryState)) {
      issues.push(issue('missing-delivery-state', record, 'legacy live allocation needs explicit delivered/cancelled reconciliation'));
    }
    if (record.status === 'live' && record.deliveryState === 'pending') {
      const ageHours = (now.getTime() - Date.parse(record.renderedAt)) / 3_600_000;
      if (!Number.isFinite(ageHours) || ageHours >= staleHours) {
        issues.push(issue('stale-live-pending-delivery', record, 'live reservation was never confirmed delivered'));
      }
    }
    if (record.status === 'released' || record.deliveryState === 'cancelled') {
      issues.push(issue('failed-or-unconfirmed-print', record, 'reservation rolled back before delivery'));
    }
    if (!Number.isInteger(record.generation) || !record.identiconVersion) {
      issues.push(issue('missing-lineage', record, 'generation or identicon version is absent'));
    }
    if (record.predecessorCardId && !cards.has(record.predecessorCardId)) {
      issues.push(issue('missing-predecessor-card', record, `predecessor ${record.predecessorCardId} does not exist`));
    }
  }

  for (const [learnerId, records] of byLearner) {
    const liveCards = [...new Set(records
      .filter((record) => record.status === 'live' && record.deliveryState !== 'cancelled')
      .map((record) => record.cardId))];
    if (liveCards.length > 1) {
      issues.push({ type: 'multiple-live-cards', learnerId, cardIds: liveCards });
    }
    const successorByPredecessor = new Map();
    for (const record of records) {
      if (!record.predecessorCardId) continue;
      if (!successorByPredecessor.has(record.predecessorCardId)) successorByPredecessor.set(record.predecessorCardId, new Set());
      successorByPredecessor.get(record.predecessorCardId).add(record.cardId);
    }
    for (const [predecessorCardId, successors] of successorByPredecessor) {
      if (successors.size > 1) {
        issues.push({ type: 'ambiguous-successors', learnerId, predecessorCardId, successorCardIds: [...successors] });
      }
    }
  }
  const blockingTypes = new Set([
    'multiple-live-cards', 'stale-live-pending-delivery', 'missing-delivery-state', 'missing-lineage',
    'missing-predecessor-card', 'ambiguous-successors',
  ]);
  return {
    schema: 'school.answer-sheet-audit/v1',
    generatedAt: now.toISOString(),
    totals: { cards: cards.size, records: all.length, issues: issues.length },
    issues,
    readyForShadow: !issues.some((entry) => entry.type === 'ambiguous-successors'),
    readyForEnforcement: !issues.some((entry) => blockingTypes.has(entry.type)),
  };
}

export function planUnambiguousBackfill(cards) {
  const changes = [];
  const manual = [];
  const byLearnerCard = new Map();
  for (const [cardId, records] of cards) {
    const learners = [...new Set(records.map((record) => record.learnerId).filter(Boolean))];
    if (learners.length !== 1 || records.some((record) => !record.renderedAt)) {
      manual.push({ cardId, reason: learners.length !== 1 ? 'card does not map to exactly one learner' : 'missing chronology' });
      continue;
    }
    const key = learners[0];
    if (!byLearnerCard.has(key)) byLearnerCard.set(key, []);
    byLearnerCard.get(key).push({ cardId, records, firstAt: records.map((r) => r.renderedAt).sort()[0] });
  }
  for (const [learnerId, learnerCards] of byLearnerCard) {
    learnerCards.sort((a, b) => a.firstAt.localeCompare(b.firstAt) || a.cardId.localeCompare(b.cardId));
    const tied = learnerCards.some((entry, index) => index > 0 && entry.firstAt === learnerCards[index - 1].firstAt);
    if (tied) {
      manual.push({ learnerId, cardIds: learnerCards.map((entry) => entry.cardId), reason: 'cards have tied first-use timestamps' });
      continue;
    }
    learnerCards.forEach((entry, index) => {
      changes.push({
        cardId: entry.cardId,
        generation: index + 1,
        predecessorCardId: index ? learnerCards[index - 1].cardId : null,
        identiconVersion: IDENTICON_VERSION,
      });
    });
  }
  return { changes, manual };
}

function issue(type, record, message) {
  return { type, cardId: record.cardId, recordId: record.recordId, learnerId: record.learnerId ?? null, message };
}

function readCards(directory) {
  const cards = new Map();
  if (!fs.existsSync(directory)) return cards;
  for (const name of fs.readdirSync(directory).filter((entry) => entry.endsWith('.yml')).sort()) {
    const records = yaml.load(fs.readFileSync(path.join(directory, name), 'utf8'));
    cards.set(name.slice(0, -4), Array.isArray(records) ? records : []);
  }
  return cards;
}

function applyBackfill(directory, cards, changes) {
  for (const change of changes) {
    const records = cards.get(change.cardId).map((record) => ({ ...record, ...change }));
    writeCardAtomic(directory, change.cardId, records);
  }
}

function writeCardAtomic(directory, cardId, records) {
  const target = path.join(directory, `${cardId}.yml`);
  const temporary = path.join(directory, `.${cardId}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporary, yaml.dump(records, { noRefs: true }), 'utf8');
  fs.renameSync(temporary, target);
}

function option(argv, name) {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] ?? null : null;
}

function explicitReconciliation(argv, cards) {
  const cardId = option(argv, '--card');
  const recordId = option(argv, '--record');
  const reviewer = option(argv, '--reviewer');
  const reason = option(argv, '--reason');
  if (!cardId || !recordId || !reviewer || !reason) {
    throw new Error('reconcile requires --card --record --reviewer --reason');
  }
  const records = cards.get(cardId);
  const record = records?.find((entry) => entry.recordId === recordId);
  if (!record) throw new Error(`allocation ${cardId}/${recordId} not found`);
  const deliveryState = option(argv, '--delivery-state');
  if (deliveryState && !['delivered', 'cancelled'].includes(deliveryState)) {
    throw new Error('--delivery-state must be delivered|cancelled');
  }
  const generationRaw = option(argv, '--generation');
  const generation = generationRaw == null ? null : Number(generationRaw);
  if (generationRaw != null && (!Number.isInteger(generation) || generation < 1)) {
    throw new Error('--generation must be a positive integer');
  }
  const predecessorRaw = option(argv, '--predecessor');
  const predecessorCardId = predecessorRaw === 'none' ? null : predecessorRaw;
  const patch = {
    ...(deliveryState ? {
      deliveryState,
      ...(deliveryState === 'delivered' ? { deliveredAt: record.deliveredAt ?? record.renderedAt } : {}),
    } : {}),
    ...(generation != null ? { generation } : {}),
    ...(predecessorRaw != null ? { predecessorCardId } : {}),
    identiconVersion: IDENTICON_VERSION,
  };
  return { cardId, recordId, reviewer, reason, patch };
}

function applyExplicitReconciliation(directory, cards, reconciliation) {
  const records = cards.get(reconciliation.cardId).map((record) => {
    if (record.recordId !== reconciliation.recordId) return record;
    return {
      ...record,
      ...reconciliation.patch,
      migrationReconciliations: [...(record.migrationReconciliations ?? []), {
        at: new Date().toISOString(), reviewer: reconciliation.reviewer,
        reason: reconciliation.reason, patch: reconciliation.patch,
      }],
    };
  });
  writeCardAtomic(directory, reconciliation.cardId, records);
}

export function main(argv = process.argv.slice(2), out = process.stdout) {
  const command = argv[0] ?? 'audit';
  const directoryAt = argv.indexOf('--directory');
  const directory = directoryAt >= 0 ? argv[directoryAt + 1] : null;
  if (!directory) throw new Error('usage: answer-sheet-audit <audit|backfill|reconcile> --directory <print-root/cards> [--apply]');
  const cards = readCards(path.resolve(directory));
  if (command === 'audit') {
    const report = auditAnswerSheets(cards);
    const rendered = argv.includes('--summary') ? {
      schema: report.schema,
      generatedAt: report.generatedAt,
      totals: report.totals,
      issueCounts: Object.fromEntries([...new Set(report.issues.map((issue) => issue.type))]
        .sort().map((type) => [type, report.issues.filter((issue) => issue.type === type).length])),
      multipleLiveCards: report.issues.filter((issue) => issue.type === 'multiple-live-cards'),
      readyForShadow: report.readyForShadow,
      readyForEnforcement: report.readyForEnforcement,
    } : report;
    out.write(`${JSON.stringify(rendered, null, 2)}\n`);
    return;
  }
  if (command === 'reconcile') {
    const reconciliation = explicitReconciliation(argv, cards);
    const applied = argv.includes('--apply');
    if (applied) applyExplicitReconciliation(path.resolve(directory), cards, reconciliation);
    out.write(`${JSON.stringify({ reconciliation, applied }, null, 2)}\n`);
    return;
  }
  if (command !== 'backfill') throw new Error(`unknown command '${command}'`);
  const plan = planUnambiguousBackfill(cards);
  const applied = argv.includes('--apply');
  if (applied) applyBackfill(path.resolve(directory), cards, plan.changes);
  out.write(`${JSON.stringify({ ...plan, applied }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
