/**
 * usageAttribution — who a ledger row's spend belongs to.
 *
 * One OpenAIAdapter instance serves every app. Consumers receive a scoped
 * VIEW of it (`adapter.scoped({ app })`, then `.scoped({ feature })` in a use
 * case) and each call through a view carries its tags as a per-call
 * `usageTags` option down to the ledger write. Nothing on the shared adapter
 * is mutated, so two views calling at once cannot cross-tag.
 *
 * The view is a Proxy over the adapter: every property and method resolves on
 * the adapter itself (methods bound to it, so private fields work), and
 * `instanceof` still holds. Only the methods named in `taggedArgs` are
 * wrapped — their options argument gains the merged tags.
 */
import { currentOrigin } from '#system/runtime/aiContext.mjs';

/**
 * The attribution fields every ledger row carries.
 * @param {Object} [usageTags]
 * @returns {{ app: string|null, feature: string|null, origin: string|null }}
 */
export function usageAttribution(usageTags = null) {
  return {
    app: usageTags?.app ?? null,
    feature: usageTags?.feature ?? null,
    origin: currentOrigin() ?? null,
  };
}

/** Keep only defined tag values so a later `{ feature: undefined }` does not erase one. */
function cleanTags(tags) {
  const out = {};
  for (const [key, value] of Object.entries(tags || {})) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * @param {Object} target - The real adapter
 * @param {Object} tags - Attribution tags, e.g. `{ app: 'health' }`
 * @param {Object<string, number>} taggedArgs - method name → index of its options argument
 * @returns {Proxy} a view of `target`
 */
export function createScopedView(target, tags, taggedArgs) {
  const own = cleanTags(tags);
  const cache = new Map();

  const wrap = (name, index) => (...args) => {
    const callArgs = [...args];
    while (callArgs.length <= index) callArgs.push(undefined);
    const options = callArgs[index] && typeof callArgs[index] === 'object' ? callArgs[index] : {};
    callArgs[index] = { ...options, usageTags: { ...own, ...cleanTags(options.usageTags) } };
    return target[name](...callArgs);
  };

  return new Proxy(target, {
    get(obj, prop) {
      if (prop === 'scoped') {
        return (more = {}) => createScopedView(target, { ...own, ...cleanTags(more) }, taggedArgs);
      }
      if (prop === 'usageTags') return { ...own };
      if (typeof prop === 'string' && Object.hasOwn(taggedArgs, prop) && typeof obj[prop] === 'function') {
        // The wrapper looks the method up at call time, so one per view is enough.
        if (!cache.has(prop)) cache.set(prop, { raw: null, fn: wrap(prop, taggedArgs[prop]) });
        return cache.get(prop).fn;
      }
      const raw = Reflect.get(obj, prop, obj);
      if (typeof raw !== 'function') return raw;
      // Bound so private fields resolve on the adapter; re-bound if the
      // adapter's method was replaced (tests stub methods on the instance).
      const hit = cache.get(prop);
      if (hit?.raw === raw) return hit.fn;
      const fn = raw.bind(obj);
      cache.set(prop, { raw, fn });
      return fn;
    },
  });
}

export default { usageAttribution, createScopedView };
