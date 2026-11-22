/**
 * Per-type item parameter registry for the admin Lists editor.
 *
 * A list item may carry `params`, a plain object owned by the item's type
 * (e.g. a Charades item `app:party-games/charades:fhe` with
 * `{autostart, participants, clue_modes}`). Types register themselves here;
 * the Lists editor asks `paramsTypeFor(item)` and renders the returned
 * type's Editor without knowing anything about the type.
 *
 * type: {
 *   id: string,                          unique key; a second register with the same id is ignored
 *   label: string,                       human name for the editor title
 *   matches(input: string) -> boolean,   does this type own the item with this input?
 *   summary(params: object) -> string,   one-line description for the row
 *   Editor({ value, onChange }),         React component editing the params object
 * }
 */
const TYPES = [];

const STRING_FIELDS = ['id', 'label'];
const FUNCTION_FIELDS = ['matches', 'summary', 'Editor'];

function assertShape(type) {
  if (!type || typeof type !== 'object') {
    throw new TypeError('registerItemParams: type must be an object');
  }
  for (const field of STRING_FIELDS) {
    if (typeof type[field] !== 'string' || !type[field]) {
      throw new TypeError(`registerItemParams: "${field}" must be a non-empty string`);
    }
  }
  for (const field of FUNCTION_FIELDS) {
    if (typeof type[field] !== 'function') {
      throw new TypeError(`registerItemParams(${type.id}): "${field}" must be a function`);
    }
  }
}

export function registerItemParams(type) {
  assertShape(type);
  if (!TYPES.some(t => t.id === type.id)) TYPES.push(type);
}

export function paramsTypeFor(item) {
  const input = typeof item?.input === 'string' ? item.input : '';
  if (!input) return null;
  return TYPES.find(t => t.matches(input)) || null;
}

/** Test-only: clear every registered type. */
export function __resetItemParams() {
  TYPES.length = 0;
}
