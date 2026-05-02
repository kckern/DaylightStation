/**
 * ISkill — a bundle of related tools + prompt fragment + config.
 *
 * Implementations must provide:
 *   name: string
 *   getTools(): ITool[]
 *   getPromptFragment(satellite): string
 *   getConfig(): object
 */
export function isSkill(obj) {
  return !!obj
    && typeof obj.name === 'string'
    && typeof obj.getTools === 'function'
    && typeof obj.getPromptFragment === 'function'
    && typeof obj.getConfig === 'function';
}

export function assertSkill(obj) {
  if (!isSkill(obj)) throw new Error('Object does not implement ISkill');
}

export default { isSkill, assertSkill };
