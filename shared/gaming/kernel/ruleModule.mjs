export function defineRuleModule(module) {
  if (!module || typeof module !== 'object') throw new Error('RuleModule must be an object');
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(String(module.id || ''))) throw new Error('RuleModule.id is invalid');
  if (!Number.isInteger(module.version) || module.version < 1) throw new Error('RuleModule.version must be a positive integer');
  for (const method of ['validateDefinition', 'createInitialState', 'handleCommand', 'project']) {
    if (typeof module[method] !== 'function') throw new Error(`RuleModule.${method} is required`);
  }
  return Object.freeze({ ...module });
}
