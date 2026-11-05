/** `{{ order.reference }}` substitution. Deliberately has no logic, so owners can edit templates safely. */
export function renderTemplate(template: string, vars: Record<string, unknown>, escape: (s: string) => string = (s) => s): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const value = path.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), vars);
    return value === null || value === undefined ? '' : escape(String(value));
  });
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Variables used in a template that are not in the allowed list. */
export function unknownVariables(template: string, allowed: readonly string[]): string[] {
  const found = new Set<string>();
  for (const m of template.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) if (!allowed.includes(m[1])) found.add(m[1]);
  return [...found];
}
