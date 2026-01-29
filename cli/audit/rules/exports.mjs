/**
 * Export rules - missing default exports, barrel issues
 */

export const rules = [
  {
    id: 'class-missing-default-export',
    severity: 'medium',
    description: 'Class without default export',
    // This is tricky to detect with grep - we look for class without corresponding default
    // This rule may need custom detection logic
    pattern: /^export class \w+ /,
    scope: 'backend/src/**/*.mjs',
    message: 'Classes should have both named and default export',
    // Note: This will have false positives, needs filtering in post-processing
    _needsPostProcess: true
  }
];

/**
 * Custom detection for missing default exports
 * Checks if file has `export class X` but no `export default`
 */
export async function detectMissingDefaults(files) {
  const { execSync } = await import('child_process');
  const violations = [];

  for (const file of files) {
    try {
      // Check if file has export class
      const hasClass = execSync(
        `grep -l "^export class" "${file}" 2>/dev/null || true`,
        { encoding: 'utf-8' }
      ).trim();

      if (!hasClass) continue;

      // Check if file has export default
      const hasDefault = execSync(
        `grep -l "^export default" "${file}" 2>/dev/null || true`,
        { encoding: 'utf-8' }
      ).trim();

      if (!hasDefault) {
        // Get the class name
        const classLine = execSync(
          `grep -n "^export class" "${file}" | head -1`,
          { encoding: 'utf-8' }
        ).trim();

        const match = classLine.match(/^(\d+):export class (\w+)/);
        if (match) {
          violations.push({
            rule: 'class-missing-default-export',
            severity: 'medium',
            file,
            line: parseInt(match[1], 10),
            code: `export class ${match[2]}`,
            message: `Class ${match[2]} should also have 'export default ${match[2]}'`
          });
        }
      }
    } catch (e) {
      // Ignore errors
    }
  }

  return violations;
}
