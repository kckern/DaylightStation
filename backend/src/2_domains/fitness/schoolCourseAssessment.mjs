/** Pure evaluation for School-requested Fitness attempts. */

const get = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);

export function evaluateSchoolFitnessAttempt({ policy, observations }) {
  const criteria = [];
  const root = evaluateNode(policy, observations ?? {}, criteria, 'successPolicy');
  return {
    result: root.pass ? 'passed' : 'needs_remediation',
    passed: root.pass,
    criteria,
    observations: structuredClone(observations ?? {}),
  };
}

function evaluateNode(node, observations, criteria, path) {
  if (Array.isArray(node?.all)) {
    const children = node.all.map((child, index) => evaluateNode(child, observations, criteria, `${path}.all[${index}]`));
    return { pass: children.every((child) => child.pass) };
  }
  if (Array.isArray(node?.any)) {
    const children = node.any.map((child, index) => evaluateNode(child, observations, criteria, `${path}.any[${index}]`));
    return { pass: children.some((child) => child.pass) };
  }
  if (node?.atLeast && Array.isArray(node.atLeast.of)) {
    const children = node.atLeast.of.map((child, index) => evaluateNode(child, observations, criteria, `${path}.atLeast.of[${index}]`));
    return { pass: children.filter((child) => child.pass).length >= node.atLeast.count };
  }
  const observed = resolveObserved(node, observations);
  const pass = compare(observed, node?.op, node?.value);
  criteria.push({ path, metric: node?.metric ?? null, op: node?.op ?? null, expected: node?.value, observed, pass });
  return { pass };
}

function resolveObserved(node, observations) {
  const value = get(observations, node.metric ?? '');
  if (node.metric === 'heart_rate.seconds_in_range' || node.metric === 'cadence.seconds_in_range') {
    const [min, max] = node.range ?? [];
    return value?.find?.((entry) => entry.min === min && entry.max === max)?.seconds ?? 0;
  }
  if (node.metric === 'heart_rate.seconds_in_zone') {
    return value?.[node.zone] ?? 0;
  }
  return value ?? null;
}

function compare(observed, op, expected) {
  if (op === 'eq') return observed === expected;
  if (typeof observed !== 'number' || !Number.isFinite(observed)) return false;
  if (op === 'gte') return observed >= expected;
  if (op === 'lte') return observed <= expected;
  if (op === 'between') return observed >= expected[0] && observed <= expected[1];
  return false;
}

