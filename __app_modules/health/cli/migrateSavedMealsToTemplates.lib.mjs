/**
 * One-time conversion of saved meals into all-core meal templates (PRD F6.3).
 *
 * The saved-meals *endpoints* are NOT retired by this: they are the transport
 * behind copy-day-to-today (create → log → delete). What retires is saved meals
 * as a user-facing SURFACE — the template picker becomes the single one — so
 * every kept saved meal has to exist as a template or it becomes unreachable.
 *
 * IDEMPOTENT BY NAME. `backfill`, the other replay-shaped tool in this app, is
 * not (decision 2.29: it increments `useCount` once per row per run), and the
 * habit that makes that safe is to prove the property rather than assume it —
 * so a second run over the same data must leave the store byte-identical, and
 * a test asserts exactly that by snapshotting between runs.
 *
 * Pure: every dependency arrives as an argument, so the test drives the same
 * function the CLI does rather than a re-implementation of it.
 */

/** Names collide the way a person reads them: case- and whitespace-insensitive. */
export const normalizeName = (name) => String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * @param {Object} deps
 * @param {Object} deps.mealsStore - ISavedMealsDatastore
 * @param {Object} deps.templateStore - IMealTemplateDatastore
 * @param {string} deps.userId
 * @param {() => string} deps.createId
 * @param {string} deps.nowIso - ISO timestamp for templates the source meal cannot date
 * @param {boolean} [deps.dryRun=false] - report what would happen, write nothing
 * @returns {Promise<{ total, created, skipped, createdNames, skippedNames }>}
 */
export async function migrateSavedMealsToTemplates({
  mealsStore, templateStore, userId, createId, nowIso, dryRun = false, logger = null,
}) {
  const meals = await mealsStore.list(userId);
  const existing = await templateStore.list(userId);
  // Every template counts as an occupant of its name, proposals included: two
  // templates with one name is a picker the person cannot tell apart.
  const taken = new Set(existing.map((t) => normalizeName(t.name)));

  const createdNames = [];
  const skippedNames = [];

  for (const meal of meals) {
    const key = normalizeName(meal?.name);
    if (!key || taken.has(key)) { skippedNames.push(meal?.name ?? '(unnamed)'); continue; }
    const components = (meal.items || []).map((item) => ({
      name: item.name,
      // ALL-CORE. A saved meal recorded no roles, and inferring variants from a
      // flat snapshot would silently drop food out of the logged meal.
      role: 'core',
      calories: Number(item.calories) || 0,
      protein: Number(item.protein) || 0,
      carbs: Number(item.carbs) || 0,
      fat: Number(item.fat) || 0,
      color: item.color || 'yellow',
      icon: item.icon ?? null,
      grams: Number(item.grams) || 0,
      unit: item.unit || 'serving',
      amount: Number.isFinite(Number(item.amount)) ? Number(item.amount) : 1,
    })).filter((c) => c.name);

    if (components.length === 0) { skippedNames.push(meal?.name ?? '(unnamed)'); continue; }

    const template = {
      id: createId(),
      name: meal.name,
      icon: meal.icon ?? null,
      components,
      // The meal's own history travels with it: a migrated template that has
      // been eaten forty times should not sort as if it were new.
      createdAt: meal.createdAt || nowIso,
      useCount: Number(meal.useCount) || 0,
      lastUsed: meal.lastUsed ?? null,
      source: 'manual',
      status: 'active',
      proposalKey: null,
      migratedFromMealId: meal.id ?? null,
    };
    if (!dryRun) await templateStore.save(template, userId);
    taken.add(key);
    createdNames.push(meal.name);
  }

  const summary = {
    total: meals.length,
    created: createdNames.length,
    skipped: skippedNames.length,
    createdNames,
    skippedNames,
    dryRun,
  };
  logger?.info?.('health.templates.migration', summary);
  return summary;
}

export default migrateSavedMealsToTemplates;
