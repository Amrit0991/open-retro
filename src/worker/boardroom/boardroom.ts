import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';
import { BoardDb } from './boarddb';
import * as h from './handlers';
import type {
  ClientMessage,
  ServerMessage,
  Identity,
  ActionResult,
  TemplateId,
} from '../../shared/protocol';

interface Attachment {
  userId: string;
  displayName: string;
}

export class BoardRoom extends DurableObject<Env> {
  db: BoardDb;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = new BoardDb(ctx.storage.sql);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const userId = request.headers.get('x-user-id')!;
    const displayName = request.headers.get('x-display-name') || 'Someone';

    // Seed synchronously on first connect from Worker-provided metadata (no D1 read here).
    this.db.seed(
      request.headers.get('x-template') as TemplateId,
      Number(request.headers.get('x-max-votes')),
      request.headers.get('x-owner-id')!,
    );

    // Persist board id once for the D1 write-through mirror. This storage await is in
    // fetch, NOT inside an action critical section, so it's safe.
    if (!(await this.ctx.storage.get('boardId'))) {
      await this.ctx.storage.put('boardId', request.headers.get('x-board-id'));
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server); // hibernatable
    server.serializeAttachment({ userId, displayName } satisfies Attachment);
    // init snapshot synchronously, before returning — socket already registered for future broadcasts
    server.send(
      JSON.stringify({ type: 'init', snapshot: this.db.snapshot(userId) } satisfies ServerMessage),
    );
    return new Response(null, { status: 101, webSocket: client });
  }

  private identity(ws: WebSocket): Identity {
    const a = ws.deserializeAttachment() as Attachment;
    return { userId: a.userId, displayName: a.displayName };
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    const actor = this.identity(ws); // identity from the socket, NEVER the message
    const result = this.dispatch(actor, msg); // synchronous critical section (no await inside)
    if (result.actor) this.sendTo(ws, result.actor);
    if (result.broadcast) this.broadcast(result.broadcast);
    const mirror = (result as { mirrorMaxVotes?: number }).mirrorMaxVotes;
    if (mirror !== undefined) this.ctx.waitUntil(this.mirrorMaxVotes(mirror)); // best-effort, after critical section
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    // No in-memory socket map to clean up (hibernation-safe). Acknowledge the close.
    ws.close();
  }

  // No-await synchronous dispatch. Every branch returns before any I/O await — this
  // atomicity is load-bearing for the per-user vote-budget guard in BoardDb.
  private dispatch(actor: Identity, msg: ClientMessage): ActionResult {
    switch (msg.type) {
      case 'add_card':
        return h.handleAddCard(this.db, actor, msg);
      case 'edit_card':
        return h.handleEditCard(this.db, actor, msg);
      case 'delete_card':
        return h.handleDeleteCard(this.db, actor, msg);
      case 'move_card':
        return h.handleMoveCard(this.db, actor, msg);
      case 'vote':
        return h.handleVote(this.db, actor, msg);
      case 'unvote':
        return h.handleUnvote(this.db, actor, msg);
      case 'set_max_votes':
        return h.handleSetMaxVotes(this.db, actor, msg);
      default:
        return { actor: [{ type: 'error', code: 'unknown_action', msg: 'unknown' }] };
    }
  }

  private sendTo(ws: WebSocket, msgs: ServerMessage[]): void {
    for (const m of msgs) ws.send(JSON.stringify(m));
  }

  // Iterate live sockets from the runtime (hibernation-safe — no in-memory map).
  private broadcast(msgs: ServerMessage[]): void {
    const payloads = msgs.map((m) => JSON.stringify(m));
    for (const sock of this.ctx.getWebSockets()) {
      for (const p of payloads) sock.send(p);
    }
  }

  // Best-effort write-through to the D1 denormalized mirror. Failure is acceptable.
  private async mirrorMaxVotes(n: number): Promise<void> {
    const boardId = await this.ctx.storage.get<string>('boardId');
    if (boardId) {
      await this.env.DB.prepare('UPDATE boards SET max_votes=? WHERE id=?')
        .bind(n, boardId)
        .run()
        .catch(() => {});
    }
  }
}
