"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureAuthSchema = exports.verifyAccessToken = exports.createAccessToken = exports.verifyPassword = exports.isLegacySha256Hash = exports.hashLegacyPassword = exports.hashPassword = exports.resolveActiveRole = void 0;
const crypto_1 = require("crypto");
const util_1 = require("util");
const database_1 = require("../../config/database");
const env_1 = require("../../config/env");
const accountRoles_1 = require("../../shared/accountRoles");
const scrypt = (0, util_1.promisify)(crypto_1.scrypt);
const TOKEN_VERSION = 1;
const SESSION_DURATION_MS = 1000 * 60 * 60 * 8;
const LEGACY_SHA256_LENGTH = 64;
let authSchemaEnsured = false;
const base64UrlEnkode = (value) => Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
const base64UrlDekode = (value) => {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padding = (4 - (normalized.length % 4)) % 4;
    return Buffer.from(`${normalized}${"=".repeat(padding)}`, "base64").toString("utf8");
};
const tokenSecret = () => env_1.env.authSecret || "employee-performance-local-dev-secret";
const resolveActiveRole = (requestedRole, assignedRoles) => {
    const allowedRoles = (0, accountRoles_1.getAllowedAccessRoles)(assignedRoles);
    const normalizedRequestedRole = String(requestedRole || "").trim().toLowerCase();
    if (allowedRoles.includes(normalizedRequestedRole)) {
        return normalizedRequestedRole;
    }
    return (0, accountRoles_1.getDefaultAccessRole)(allowedRoles);
};
exports.resolveActiveRole = resolveActiveRole;
const hashPassword = async (password) => {
    const salt = (0, crypto_1.randomBytes)(16).toString("hex");
    const derivedKey = (await scrypt(password, salt, 64));
    return `scrypt$${salt}$${derivedKey.toString("hex")}`;
};
exports.hashPassword = hashPassword;
const hashLegacyPassword = (password) => (0, crypto_1.createHash)("sha256").update(password).digest("hex");
exports.hashLegacyPassword = hashLegacyPassword;
const isLegacySha256Hash = (hash) => /^[a-f0-9]{64}$/i.test(hash) && hash.length === LEGACY_SHA256_LENGTH;
exports.isLegacySha256Hash = isLegacySha256Hash;
const verifyPassword = async (password, storedHash) => {
    if (!storedHash) {
        return false;
    }
    if (storedHash.startsWith("scrypt$")) {
        const [, salt, expectedKey] = storedHash.split("$");
        if (!salt || !expectedKey) {
            return false;
        }
        const derivedKey = (await scrypt(password, salt, 64));
        const expectedBuffer = Buffer.from(expectedKey, "hex");
        if (derivedKey.length !== expectedBuffer.length) {
            return false;
        }
        return (0, crypto_1.timingSafeEqual)(derivedKey, expectedBuffer);
    }
    if ((0, exports.isLegacySha256Hash)(storedHash)) {
        return (0, crypto_1.timingSafeEqual)(Buffer.from((0, exports.hashLegacyPassword)(password), "hex"), Buffer.from(storedHash, "hex"));
    }
    return false;
};
exports.verifyPassword = verifyPassword;
const createAccessToken = (user) => {
    const expiresAt = Date.now() + SESSION_DURATION_MS;
    const payload = {
        v: TOKEN_VERSION,
        sub: user.accountId,
        employeeId: user.employeeId,
        role: user.role,
        assignedRoles: user.assignedRoles,
        username: user.username,
        exp: expiresAt
    };
    const enkodedPayload = base64UrlEnkode(JSON.stringify(payload));
    const signature = base64UrlEnkode((0, crypto_1.createHmac)("sha256", tokenSecret()).update(enkodedPayload).digest());
    return {
        token: `${enkodedPayload}.${signature}`,
        expiresAt
    };
};
exports.createAccessToken = createAccessToken;
const verifyAccessToken = (token) => {
    const [enkodedPayload, signature] = token.split(".");
    if (!enkodedPayload || !signature) {
        return null;
    }
    const expectedSignature = base64UrlEnkode((0, crypto_1.createHmac)("sha256", tokenSecret()).update(enkodedPayload).digest());
    if (Buffer.byteLength(signature) !== Buffer.byteLength(expectedSignature) ||
        !(0, crypto_1.timingSafeEqual)(Buffer.from(signature), Buffer.from(expectedSignature))) {
        return null;
    }
    try {
        const payload = JSON.parse(base64UrlDekode(enkodedPayload));
        if (payload.v !== TOKEN_VERSION || payload.exp <= Date.now()) {
            return null;
        }
        return payload;
    }
    catch (_error) {
        return null;
    }
};
exports.verifyAccessToken = verifyAccessToken;
const ensureAuthSchema = async () => {
    if (authSchemaEnsured) {
        return;
    }
    await database_1.pool.query(`
    ALTER TABLE akun_pengguna
    ALTER COLUMN hash_password TYPE VARCHAR(255)
  `);
    await database_1.pool.query(`
    ALTER TABLE akun_pengguna
    ALTER COLUMN hash_password SET NOT NULL
  `);
    await database_1.pool.query(`
    ALTER TABLE akun_pengguna
    ADD COLUMN IF NOT EXISTS wajib_ganti_password SMALLINT NOT NULL DEFAULT 0
  `);
    await database_1.pool.query(`
    ALTER TABLE akun_pengguna
    ADD COLUMN IF NOT EXISTS login_terakhir_pada TIMESTAMP NULL
  `);
    await database_1.pool.query(`
    CREATE TABLE IF NOT EXISTS akun_pengguna_role (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      akun_pengguna_id INTEGER NOT NULL,
      role_name VARCHAR(50) NOT NULL,
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uq_akun_role UNIQUE (akun_pengguna_id, role_name),
      CONSTRAINT fk_akun_role_akun
        FOREIGN KEY (akun_pengguna_id) REFERENCES akun_pengguna(id)
        ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
    authSchemaEnsured = true;
};
exports.ensureAuthSchema = ensureAuthSchema;
