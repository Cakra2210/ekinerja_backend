import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from "crypto";
import { promisify } from "util";
import { pool } from "../../config/database";
import { env } from "../../config/env";
import { AccountRole } from "../../types";
import { getAllowedAccessRoles, getDefaultAccessRole } from "../../shared/accountRoles";

const scrypt = promisify(scryptCallback);
const TOKEN_VERSION = 1;
const SESSION_DURATION_MS = 1000 * 60 * 60 * 8;
const LEGACY_SHA256_LENGTH = 64;

export type AuthenticatedUser = {
  accountId: number;
  employeeId: number;
  fullName: string;
  nip: string;
  username: string;
  role: AccountRole;
  assignedRoles: AccountRole[];
  isActive: boolean;
  mustChangePassword: boolean;
  profilePhotoPath?: string | null;
  profilePhotoUrl?: string | null;
};

type SessionPayload = {
  v: number;
  sub: number;
  employeeId: number;
  role: AccountRole;
  assignedRoles: AccountRole[];
  username: string;
  exp: number;
};

let authSchemaEnsured = false;

const base64UrlEnkode = (value: string | Buffer) =>
  Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const base64UrlDekode = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(`${normalized}${"=".repeat(padding)}`, "base64").toString("utf8");
};

const tokenSecret = () => env.authSecret || "employee-performance-local-dev-secret";

export const resolveActiveRole = (
  requestedRole?: string | null,
  assignedRoles?: AccountRole[] | null
): AccountRole => {
  const allowedRoles = getAllowedAccessRoles(assignedRoles);
  const normalizedRequestedRole = String(requestedRole || "").trim().toLowerCase() as AccountRole;

  if (allowedRoles.includes(normalizedRequestedRole)) {
    return normalizedRequestedRole;
  }

  return getDefaultAccessRole(allowedRoles);
};

export const hashPassword = async (password: string) => {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derivedKey.toString("hex")}`;
};

export const hashLegacyPassword = (password: string) =>
  createHash("sha256").update(password).digest("hex");

export const isLegacySha256Hash = (hash: string) =>
  /^[a-f0-9]{64}$/i.test(hash) && hash.length === LEGACY_SHA256_LENGTH;

export const verifyPassword = async (password: string, storedHash: string) => {
  if (!storedHash) {
    return false;
  }

  if (storedHash.startsWith("scrypt$")) {
    const [, salt, expectedKey] = storedHash.split("$");

    if (!salt || !expectedKey) {
      return false;
    }

    const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
    const expectedBuffer = Buffer.from(expectedKey, "hex");

    if (derivedKey.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(derivedKey, expectedBuffer);
  }

  if (isLegacySha256Hash(storedHash)) {
    return timingSafeEqual(
      Buffer.from(hashLegacyPassword(password), "hex"),
      Buffer.from(storedHash, "hex")
    );
  }

  return false;
};

export const createAccessToken = (user: AuthenticatedUser) => {
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  const payload: SessionPayload = {
    v: TOKEN_VERSION,
    sub: user.accountId,
    employeeId: user.employeeId,
    role: user.role,
    assignedRoles: user.assignedRoles,
    username: user.username,
    exp: expiresAt
  };

  const enkodedPayload = base64UrlEnkode(JSON.stringify(payload));
  const signature = base64UrlEnkode(
    createHmac("sha256", tokenSecret()).update(enkodedPayload).digest()
  );

  return {
    token: `${enkodedPayload}.${signature}`,
    expiresAt
  };
};

export const verifyAccessToken = (token: string): SessionPayload | null => {
  const [enkodedPayload, signature] = token.split(".");

  if (!enkodedPayload || !signature) {
    return null;
  }

  const expectedSignature = base64UrlEnkode(
    createHmac("sha256", tokenSecret()).update(enkodedPayload).digest()
  );

  if (
    Buffer.byteLength(signature) !== Buffer.byteLength(expectedSignature) ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDekode(enkodedPayload)) as SessionPayload;

    if (payload.v !== TOKEN_VERSION || payload.exp <= Date.now()) {
      return null;
    }

    return payload;
  } catch (_error) {
    return null;
  }
};

export const ensureAuthSchema = async () => {
  if (authSchemaEnsured) {
    return;
  }

  await pool.query(`
    ALTER TABLE akun_pengguna
    ALTER COLUMN hash_password TYPE VARCHAR(255)
  `);

  await pool.query(`
    ALTER TABLE akun_pengguna
    ALTER COLUMN hash_password SET NOT NULL
  `);

  await pool.query(`
    ALTER TABLE akun_pengguna
    ADD COLUMN IF NOT EXISTS wajib_ganti_password SMALLINT NOT NULL DEFAULT 0
  `);

  await pool.query(`
    ALTER TABLE akun_pengguna
    ADD COLUMN IF NOT EXISTS login_terakhir_pada TIMESTAMP NULL
  `);

  await pool.query(`
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
