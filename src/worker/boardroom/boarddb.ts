import { TEMPLATES } from '../../shared/templates';
import type { BoardSnapshot, Card, ColumnDef, TemplateId } from '../../shared/protocol';

// Wraps a Durable Object's embedded SQLite (`ctx.storage.sql`). All methods are
// synchronous — the SQLite storage backend exposes a synchronous `SqlStorage`.
export class BoardDb {
  constructor(private sql: SqlStorage) {
    this.init();
  }

  // Idempotent: `CREATE TABLE IF NOT EXISTS` runs safely on every DO construction.
  // One statement per `exec` call — the runtime rejects multi-statement strings.
  private init(): void {
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK (id=1), template TEXT, max_votes INTEGER, owner_id TEXT, seeded INTEGER DEFAULT 0)',
    );
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS columns (id TEXT PRIMARY KEY, title TEXT, subtitle TEXT, position INTEGER)',
    );
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, column_id TEXT, text TEXT, author_id TEXT, author_name TEXT, position REAL, created_at INTEGER)',
    );
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS votes (card_id TEXT, user_id TEXT, count INTEGER, PRIMARY KEY (card_id, user_id))',
    );
  }

  // Idempotent: a `seeded` flag guards against double-inserting columns.
  seed(template: TemplateId, maxVotes: number, ownerId: string): void {
    const row = this.sql.exec('SELECT seeded FROM meta WHERE id=1').toArray()[0] as
      | { seeded: number }
      | undefined;
    if (row?.seeded === 1) return;
    this.sql.exec(
      'INSERT OR REPLACE INTO meta (id,template,max_votes,owner_id,seeded) VALUES (1,?,?,?,1)',
      template,
      maxVotes,
      ownerId,
    );
    TEMPLATES[template].columns.forEach((col: ColumnDef, i: number) => {
      this.sql.exec(
        'INSERT OR IGNORE INTO columns (id,title,subtitle,position) VALUES (?,?,?,?)',
        col.id,
        col.title,
        col.subtitle,
        i,
      );
    });
  }

  getMeta(): { template: TemplateId; maxVotes: number; ownerId: string } {
    const m = this.sql.exec('SELECT template,max_votes,owner_id FROM meta WHERE id=1').one() as {
      template: string;
      max_votes: number;
      owner_id: string;
    };
    return { template: m.template as TemplateId, maxVotes: Number(m.max_votes), ownerId: m.owner_id };
  }

  setMaxVotes(n: number): void {
    this.sql.exec('UPDATE meta SET max_votes=? WHERE id=1', n);
  }

  snapshot(userId: string): BoardSnapshot {
    const meta = this.getMeta();
    const columns = this.sql
      .exec('SELECT id,title,subtitle FROM columns ORDER BY position')
      .toArray() as unknown as ColumnDef[];
    const cards = (
      this.sql
        .exec(
          `SELECT c.id,c.column_id,c.text,c.author_id,c.author_name,c.position,c.created_at,
                  COALESCE((SELECT SUM(count) FROM votes v WHERE v.card_id=c.id),0) AS votes
           FROM cards c ORDER BY c.position, c.created_at, c.id`,
        )
        .toArray() as Array<{
        id: string;
        column_id: string;
        text: string;
        author_id: string;
        author_name: string;
        position: number;
        created_at: number;
        votes: number;
      }>
    ).map(
      (r): Card => ({
        id: r.id,
        columnId: r.column_id,
        text: r.text,
        authorId: r.author_id,
        authorName: r.author_name,
        position: Number(r.position),
        createdAt: Number(r.created_at),
        votes: Number(r.votes),
      }),
    );
    const yourVotes: Record<string, number> = {};
    for (const r of this.sql
      .exec('SELECT card_id,count FROM votes WHERE user_id=?', userId)
      .toArray() as Array<{ card_id: string; count: number }>) {
      yourVotes[r.card_id] = Number(r.count);
    }
    return { meta, columns, cards, yourVotes };
  }

  // Inserts a card at the end of its column. position = MAX(position)+1024 keeps
  // gaps wide enough for fractional reordering later. created_at is the tiebreaker.
  addCard(card: {
    id: string;
    columnId: string;
    text: string;
    authorId: string;
    authorName: string;
  }): Card {
    const now = Date.now();
    const max = Number(
      (
        this.sql
          .exec('SELECT COALESCE(MAX(position),0) AS m FROM cards WHERE column_id=?', card.columnId)
          .one() as { m: number }
      ).m,
    );
    const position = max + 1024;
    this.sql.exec(
      'INSERT INTO cards (id,column_id,text,author_id,author_name,position,created_at) VALUES (?,?,?,?,?,?,?)',
      card.id,
      card.columnId,
      card.text,
      card.authorId,
      card.authorName,
      position,
      now,
    );
    return {
      id: card.id,
      columnId: card.columnId,
      text: card.text,
      authorId: card.authorId,
      authorName: card.authorName,
      position,
      createdAt: now,
      votes: 0,
    };
  }

  getCard(id: string): Card | null {
    const r = this.sql
      .exec(
        `SELECT id,column_id,text,author_id,author_name,position,created_at,
                COALESCE((SELECT SUM(count) FROM votes WHERE card_id=?1),0) AS votes
         FROM cards WHERE id=?1`,
        id,
      )
      .toArray()[0] as
      | {
          id: string;
          column_id: string;
          text: string;
          author_id: string;
          author_name: string;
          position: number;
          created_at: number;
          votes: number;
        }
      | undefined;
    return r
      ? {
          id: r.id,
          columnId: r.column_id,
          text: r.text,
          authorId: r.author_id,
          authorName: r.author_name,
          position: Number(r.position),
          createdAt: Number(r.created_at),
          votes: Number(r.votes),
        }
      : null;
  }

  columnExists(columnId: string): boolean {
    return !!this.sql.exec('SELECT 1 FROM columns WHERE id=?', columnId).toArray()[0];
  }

  editCard(id: string, text: string): boolean {
    return this.sql.exec('UPDATE cards SET text=? WHERE id=?', text, id).rowsWritten > 0;
  }

  // Delete votes first, then the card. We do not rely on FK cascade.
  deleteCard(id: string): void {
    this.sql.exec('DELETE FROM votes WHERE card_id=?', id);
    this.sql.exec('DELETE FROM cards WHERE id=?', id);
  }

  // Atomic per-user vote-budget enforcement in a SINGLE conditional statement —
  // no read-modify-write window. The budget guard is duplicated on BOTH branches
  // of the upsert: an `ON CONFLICT DO UPDATE ... WHERE` gates only the UPDATE
  // branch, so the `INSERT ... SELECT ... WHERE` must also carry the guard or a
  // first vote on a fresh card/user would bypass the cap. `rowsWritten > 0`
  // distinguishes a recorded vote from an over-budget rejection.
  voteAtomic(cardId: string, userId: string): boolean {
    const c = this.sql.exec(
      `INSERT INTO votes (card_id, user_id, count)
         SELECT ?1, ?2, 1
         WHERE (SELECT COALESCE(SUM(count),0) FROM votes WHERE user_id=?2) < (SELECT max_votes FROM meta WHERE id=1)
       ON CONFLICT(card_id, user_id) DO UPDATE SET count = count + 1
         WHERE (SELECT COALESCE(SUM(count),0) FROM votes WHERE user_id=?2) < (SELECT max_votes FROM meta WHERE id=1)`,
      cardId,
      userId,
    );
    return c.rowsWritten > 0;
  }

  // Decrement then prune. Always allowed — unvoting never exceeds the budget.
  unvote(cardId: string, userId: string): void {
    this.sql.exec(
      'UPDATE votes SET count=count-1 WHERE card_id=? AND user_id=? AND count>0',
      cardId,
      userId,
    );
    this.sql.exec('DELETE FROM votes WHERE card_id=? AND user_id=? AND count<=0', cardId, userId);
  }

  voteTotal(cardId: string): number {
    return Number(
      (this.sql.exec('SELECT COALESCE(SUM(count),0) AS t FROM votes WHERE card_id=?', cardId).one() as {
        t: number;
      }).t,
    );
  }

  userVoteCount(cardId: string, userId: string): number {
    const r = this.sql
      .exec('SELECT count FROM votes WHERE card_id=? AND user_id=?', cardId, userId)
      .toArray()[0] as { count: number } | undefined;
    return r ? Number(r.count) : 0;
  }

  // Ordered ids+positions in a column. Tie-break `position, created_at, id` mirrors
  // the snapshot ordering so renormalize preserves the visible card order.
  private columnCards(columnId: string): { id: string; position: number }[] {
    return (
      this.sql
        .exec(
          'SELECT id, position FROM cards WHERE column_id=? ORDER BY position, created_at, id',
          columnId,
        )
        .toArray() as Array<{ id: string; position: number }>
    ).map((c) => ({ id: c.id, position: Number(c.position) }));
  }

  // Safety valve for fractional-position underflow: rewrite every card in the
  // column to evenly spaced positions (1024, 2048, …). One UPDATE per card —
  // `sql.exec` is single-statement.
  private renormalize(columnId: string): { id: string; position: number }[] {
    const positions = this.columnCards(columnId).map((c, i) => ({
      id: c.id,
      position: (i + 1) * 1024,
    }));
    for (const p of positions) {
      this.sql.exec('UPDATE cards SET position=? WHERE id=?', p.position, p.id);
    }
    return positions;
  }

  // Moves a card into `toColumnId` between its CURRENT neighbours. Reads the live
  // stored positions of beforeId/afterId (scoped to the target column) — never
  // trusts client-sent positions. beforeId = neighbour above (smaller position),
  // afterId = neighbour below (larger). When the midpoint gap underflows we move
  // the card then renormalize the whole column and report a 'reordered' result.
  moveCard(
    cardId: string,
    toColumnId: string,
    beforeId: string | null,
    afterId: string | null,
  ):
    | { type: 'moved'; columnId: string; position: number }
    | { type: 'reordered'; columnId: string; positions: { id: string; position: number }[] } {
    const pos = (id: string | null): number | undefined => {
      if (!id) return undefined;
      const r = this.sql
        .exec('SELECT position FROM cards WHERE id=? AND column_id=?', id, toColumnId)
        .toArray()[0] as { position: number } | undefined;
      return r ? Number(r.position) : undefined;
    };
    const before = pos(beforeId); // neighbour above (smaller position)
    const after = pos(afterId); // neighbour below (larger position)
    let position: number;
    if (before !== undefined && after !== undefined) {
      if (after - before < 1e-9) {
        // Underflow: set column then renormalize the whole target column.
        this.sql.exec('UPDATE cards SET column_id=? WHERE id=?', toColumnId, cardId);
        const positions = this.renormalize(toColumnId);
        return { type: 'reordered', columnId: toColumnId, positions };
      }
      position = (before + after) / 2;
    } else if (after !== undefined) {
      position = after - 1024;
    } else if (before !== undefined) {
      position = before + 1024;
    } else {
      const m = Number(
        (
          this.sql
            .exec('SELECT COALESCE(MAX(position),0) AS m FROM cards WHERE column_id=?', toColumnId)
            .one() as { m: number }
        ).m,
      );
      position = m + 1024;
    }
    this.sql.exec('UPDATE cards SET column_id=?, position=? WHERE id=?', toColumnId, position, cardId);
    return { type: 'moved', columnId: toColumnId, position };
  }
}
