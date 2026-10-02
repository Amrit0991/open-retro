import type { Env } from '../types';
import type { TemplateSnapshot } from '../../shared/protocol';
import { TEMPLATES } from '../../shared/templates';

export interface BoardRow {
  id: string;
  name: string;
  owner_id: string;
  template: string;
  max_votes: number;
  created_at: number;
  template_snapshot: string | null;
}

export async function createBoard(
  env: Env,
  ownerId: string,
  name: string,
  templateRef: string,
  snapshot: TemplateSnapshot,
  maxVotes: number,
): Promise<BoardRow> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const snapJson = JSON.stringify(snapshot);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO boards (id,name,owner_id,template,max_votes,created_at,template_snapshot) VALUES (?,?,?,?,?,?,?)')
      .bind(id, name, ownerId, templateRef, maxVotes, now, snapJson),
    env.DB.prepare('INSERT INTO board_members (board_id,user_id,role,joined_at) VALUES (?,?,?,?)')
      .bind(id, ownerId, 'owner', now),
  ]);
  return { id, name, owner_id: ownerId, template: templateRef, max_votes: maxVotes, created_at: now, template_snapshot: snapJson };
}

// Resolve a board's column/glyph snapshot. New boards store it inline; older
// boards (no snapshot) fall back to the built-in template by `board.template`.
export function boardSnapshot(board: BoardRow): TemplateSnapshot | null {
  if (board.template_snapshot) return JSON.parse(board.template_snapshot) as TemplateSnapshot;
  return (TEMPLATES as Record<string, TemplateSnapshot>)[board.template] ?? null;
}

export async function listBoardsForUser(env: Env, userId: string) {
  const { results } = await env.DB.prepare(
    `SELECT b.*, m.role FROM boards b JOIN board_members m ON m.board_id=b.id
     WHERE m.user_id=? ORDER BY b.created_at DESC`).bind(userId).all<BoardRow & { role: string }>();
  return results;
}

export async function getBoard(env: Env, id: string): Promise<BoardRow | null> {
  return env.DB.prepare('SELECT * FROM boards WHERE id=?').bind(id).first<BoardRow>();
}

export async function isMember(env: Env, boardId: string, userId: string): Promise<boolean> {
  const r = await env.DB.prepare('SELECT 1 FROM board_members WHERE board_id=? AND user_id=?').bind(boardId, userId).first();
  return !!r;
}

export async function addMember(env: Env, boardId: string, userId: string): Promise<void> {
  await env.DB.prepare('INSERT OR IGNORE INTO board_members (board_id,user_id,role,joined_at) VALUES (?,?,?,?)')
    .bind(boardId, userId, 'member', Date.now()).run();
}

export async function countBoardsOwnedBy(env: Env, userId: string): Promise<number> {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM boards WHERE owner_id=?').bind(userId).first<{ n: number }>();
  return r?.n ?? 0;
}
