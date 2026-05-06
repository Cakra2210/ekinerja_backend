"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.broadcastDataChange = exports.registerRealtimeClient = void 0;
let nextClientId = 1;
const clients = new Map();
const writeEvent = (response, payload) => {
    response.write(`event: ${payload.type}\n`);
    response.write(`data: ${JSON.stringify(payload)}\n\n`);
};
const detectScope = (tableName) => {
    const table = String(tableName || "").toLowerCase();
    if (table.includes("assignment") || table.includes("penugasan"))
        return "assignment";
    if (table.includes("logbook") || table.includes("activity") || table.includes("aktivitas"))
        return "logbook";
    if (table.includes("periode") || table.includes("satuan") || table.includes("kategori") || table.includes("indikator"))
        return "references";
    if (table.includes("akun") || table.includes("access") || table.includes("role"))
        return "accounts";
    if (table.includes("kinerja"))
        return "kinerja";
    return "general";
};
const registerRealtimeClient = (response) => {
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
exports.registerRealtimeClient = registerRealtimeClient;
const broadcastDataChange = (options = {}) => {
    if (!clients.size)
        return;
    const payload = {
        type: "data_changed",
        scope: options.scope || detectScope(options.table),
        table: options.table,
        action: options.action,
        timestamp: new Date().toISOString()
    };
    for (const client of clients.values()) {
        try {
            writeEvent(client.response, payload);
        }
        catch {
            clients.delete(client.id);
        }
    }
};
exports.broadcastDataChange = broadcastDataChange;
setInterval(() => {
    if (!clients.size)
        return;
    const payload = {
        type: "heartbeat",
        scope: "general",
        timestamp: new Date().toISOString()
    };
    for (const client of clients.values()) {
        try {
            writeEvent(client.response, payload);
        }
        catch {
            clients.delete(client.id);
        }
    }
}, 25000).unref?.();
