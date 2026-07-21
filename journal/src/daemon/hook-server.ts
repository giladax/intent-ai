/**
 * HTTP server that receives Claude Code hook events and serves live state.
 *
 * Two endpoints:
 *   POST /hooks  — receives hook payloads; responds 200 immediately, then parses async
 *   GET  /live   — returns current session state + suggestion as JSON
 *   GET  /health — returns 200 OK
 *
 * CORS is enabled for all origins so the dashboard (port 3456) can poll /live.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { SessionState, PromptSuggestion } from './types.js';

type HookCallback = (body: Record<string, unknown>) => void;

export class HookServer {
  private server: Server;
  private port: number;
  private host = '127.0.0.1';
  private onHook: HookCallback;
  private getState: () => { state: SessionState | null; suggestion: PromptSuggestion | null };

  constructor(opts: {
    port?: number;
    onHook: HookCallback;
    getState: () => { state: SessionState | null; suggestion: PromptSuggestion | null };
  }) {
    this.port = opts.port ?? 4317;
    this.onHook = opts.onHook;
    this.getState = opts.getState;
    this.server = createServer((req, res) => this.handleRequest(req, res));
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const method = req.method ?? '';
    const url = req.url ?? '';

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    if (method === 'POST' && url === '/hooks') {
      this.handleHooks(req, res);
      return;
    }

    if (method === 'GET' && url === '/live') {
      this.handleLive(res);
      return;
    }

    if (method === 'GET' && url === '/health') {
      res.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
      res.end('OK');
      return;
    }

    res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
    res.end('Not Found');
  }

  /**
   * POST /hooks — respond 200 immediately, then parse body and call onHook.
   * This is critical: UserPromptSubmit blocks CC until it gets the response,
   * so we must not delay the 200 with any processing.
   */
  private handleHooks(req: IncomingMessage, res: ServerResponse): void {
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      // Respond FIRST — unblock Claude Code
      res.writeHead(200);
      res.end();

      // Then parse and process
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        const body = JSON.parse(raw) as Record<string, unknown>;
        this.onHook(body);
      } catch (err) {
        console.warn('[hook-server] Failed to parse hook body:', (err as Error).message);
      }
    });
  }

  /**
   * GET /live — return current session state and suggestion as JSON.
   */
  private handleLive(res: ServerResponse): void {
    const data = this.getState();
    const json = JSON.stringify(data);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(json);
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, this.host, () => resolve());
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  get address(): string {
    return `${this.host}:${this.port}`;
  }
}
