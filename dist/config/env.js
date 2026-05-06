"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const nodeEnv = process.env.NODE_ENV || "development";
const authSecret = process.env.AUTH_SECRET || process.env.JWT_SECRET || "";
const parseBoolean = (value, fallback) => {
    if (value === undefined)
        return fallback;
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
};
const cookieSameSite = (process.env.COOKIE_SAME_SITE || "lax").toLowerCase();
const normalizedCookieSameSite = ["lax", "strict", "none"].includes(cookieSameSite)
    ? cookieSameSite
    : "lax";
if (nodeEnv === "production" && authSecret.length < 32) {
    throw new Error("AUTH_SECRET produksi wajib diisi minimal 32 karakter acak.");
}
exports.env = {
    nodeEnv,
    port: Number(process.env.PORT || 5000),
    dbHost: process.env.DB_HOST || "127.0.0.1",
    dbPort: Number(process.env.DB_PORT || 5432),
    dbUser: process.env.DB_USER || "postgres",
    dbPassword: process.env.DB_PASSWORD || "",
    dbName: process.env.DB_NAME || "kinerja_pegawai_bps",
    clientUrl: process.env.CLIENT_URL || "http://localhost:5173",
    authSecret,
    trustProxy: parseBoolean(process.env.TRUST_PROXY, nodeEnv === "production"),
    sessionCookieName: process.env.SESSION_COOKIE_NAME || "bps_kinerja_session",
    cookieSecure: parseBoolean(process.env.COOKIE_SECURE, nodeEnv === "production"),
    cookieSameSite: normalizedCookieSameSite,
    loginRateLimitWindowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
    loginRateLimitMax: Number(process.env.LOGIN_RATE_LIMIT_MAX || 8)
};
