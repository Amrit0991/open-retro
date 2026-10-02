import type { Env } from '../types';
import { DEFAULT_COLUMN_ICON, type TemplateColumnInput, type TemplateSummary, type ColumnDef, type Tone } from '../../shared/protocol';

export interface TemplateRow { id: string; owner_id: string; name: string; columns_json: string; created_at: number; updated_at: number; }

export function toSummary(row: TemplateRow): TemplateSummary {
  const raw = JSON.parse(row.columns_json) as { id: string; title: string; subtitle: string; tone: Tone }[];
  const columns: ColumnDef[] = raw.map((c) => ({ id: c.id, title: c.title, subtitle: c.subtitle, tone: c.tone, icon: DEFAULT_COLUMN_ICON }));
  return { id: row.id, name: row.name, glyph: { tone: columns[0]?.tone ?? 'slate', icon: DEFAULT_COLUMN_ICON }, columns, readOnly: false };
}

function pack(columns: TemplateColumnInput[]): string {
  return JSON.stringify(columns.map((c) => ({ id: crypto.randomUUID(), title: c.title.trim(), subtitle: c.subtitle.trim(), tone: c.tone })));
}

export async function createTemplate(env: Env, ownerId: string, name: string, columns: TemplateColumnInput[]): Promise<TemplateSummary> {
  const id = crypto.randomUUID(); const now = Date.now();
  // pack once: a second pack() call would mint a different id set for the returned summary than the row stored.
  const packed = pack(columns);
  await env.DB.prepare('INSERT INTO templates (id,owner_id,name,columns_json,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .bind(id, ownerId, name.trim(), packed, now, now).run();
  return toSummary({ id, owner_id: ownerId, name: name.trim(), columns_json: packed, created_at: now, updated_at: now });
}

export async function listTemplates(env: Env, ownerId: string): Promise<TemplateSummary[]> {
  const { results } = await env.DB.prepare('SELECT * FROM templates WHERE owner_id=? ORDER BY created_at DESC').bind(ownerId).all<TemplateRow>();
  return results.map(toSummary);
}

export async function getTemplate(env: Env, id: string): Promise<TemplateRow | null> {
  return env.DB.prepare('SELECT * FROM templates WHERE id=?').bind(id).first<TemplateRow>();
}

export async function updateTemplate(env: Env, id: string, ownerId: string, name: string, columns: TemplateColumnInput[]): Promise<boolean> {
  const res = await env.DB.prepare('UPDATE templates SET name=?, columns_json=?, updated_at=? WHERE id=? AND owner_id=?')
    .bind(name.trim(), pack(columns), Date.now(), id, ownerId).run();
  return (res.meta.changes ?? 0) > 0;
}

export async function deleteTemplate(env: Env, id: string, ownerId: string): Promise<boolean> {
  const res = await env.DB.prepare('DELETE FROM templates WHERE id=? AND owner_id=?').bind(id, ownerId).run();
  return (res.meta.changes ?? 0) > 0;
}
