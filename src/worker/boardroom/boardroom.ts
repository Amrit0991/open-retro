import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';
import { BoardDb } from './boarddb';

export class BoardRoom extends DurableObject<Env> {
  db: BoardDb;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = new BoardDb(ctx.storage.sql);
  }

  // test seam: lets vitest drive the db directly via runInDurableObject
  _db(): BoardDb {
    return this.db;
  }
}
