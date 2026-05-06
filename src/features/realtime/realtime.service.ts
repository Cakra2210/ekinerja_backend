import type { Response } from "express";

type RealtimeScope =
  | "dashboard"
  | "kinerja"
  | "assignment"
  | "logbook"
  | "monitoring"
  | "references"
  | "accounts"
  | "general";

type RealtimePayload = {
  type: "data_changed" | "heartbeat";
  scope: RealtimeScope;
  table?: string;
  action?: string;
  timestamp: string;
};

type Client = {
  id: number;
  response: Response;
};

let nextClientId = 1;
const clients = new Map<number, Client>();

const writeEvent = (response: Response, payload: RealtimePayload) => {
  response.write(`event: ${payload.type}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const detectScope = (tableName?: string): RealtimeScope => {
  const table = String(tableName || "").toLowerCase();

  if (table.includes("assignment") || table.includes("penugasan")) return "assignment";
  if (table.includes("logbook") || table.includes("activity") || table.includes("aktivitas")) return "logbook";
  if (table.includes("periode") || table.includes("satuan") || table.includes("kategori") || table.includes("indikator")) return "references";
  if (table.includes("akun") || table.includes("access") || table.includes("role")) return "accounts";
  if (table.includes("kinerja")) return "kinerja";

  return "general";
};

export const registerRealtimeClient = (response: Response) => {
  const id = nextClientId;
  nextClientId += 1;

  clients.set(id, { id, response });

  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders?.();

  writeEvent(response, {
    type: "heartbeat",
    scope: "general",
    timestamp: new Date().toISOString()
  });

  return () => {
    clients.delete(id);
  };
};

export const broadcastDataChange = (options: { table?: string; action?: string; scope?: RealtimeScope } = {}) => {
  if (!clients.size) return;

  const payload: RealtimePayload = {
    type: "data_changed",
    scope: options.scope || detectScope(options.table),
    table: options.table,
    action: options.action,
    timestamp: new Date().toISOString()
  };

  for (const client of clients.values()) {
    try {
      writeEvent(client.response, payload);
    } catch {
      clients.delete(client.id);
    }
  }
};

setInterval(() => {
  if (!clients.size) return;

  const payload: RealtimePayload = {
    type: "heartbeat",
    scope: "general",
    timestamp: new Date().toISOString()
  };

  for (const client of clients.values()) {
    try {
      writeEvent(client.response, payload);
    } catch {
      clients.delete(client.id);
    }
  }
}, 25000).unref?.();
