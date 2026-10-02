import { LIMITS, type TemplateColumnInput, type Tone } from '../../shared/protocol';

const TONES: Tone[] = ['green', 'blue', 'coral', 'purple', 'amber', 'pink', 'slate'];

export function validateTemplate(body: any): { name: string; columns: TemplateColumnInput[] } | { error: string } {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > LIMITS.templateName) return { error: 'bad_name' };
  const raw = Array.isArray(body?.columns) ? body.columns : [];
  if (raw.length < 1 || raw.length > LIMITS.templateColumnsMax) return { error: 'bad_columns' };
  const columns: TemplateColumnInput[] = [];
  for (const c of raw) {
    const title = typeof c?.title === 'string' ? c.title.trim() : '';
    const subtitle = typeof c?.subtitle === 'string' ? c.subtitle.trim() : '';
    if (!title || title.length > LIMITS.columnTitle) return { error: 'bad_column_title' };
    if (subtitle.length > LIMITS.columnSubtitle) return { error: 'bad_column_subtitle' };
    if (!TONES.includes(c?.tone)) return { error: 'bad_tone' };
    columns.push({ title, subtitle, tone: c.tone });
  }
  return { name, columns };
}
