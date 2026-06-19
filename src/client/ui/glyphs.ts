import { TEMPLATES } from '../../shared/templates';

// Pretty display name for a template id, falling back to a title-cased slug.
export function templateName(template: string): string {
  const known = (TEMPLATES as Record<string, { name: string }>)[template];
  if (known) return known.name;
  return template
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
