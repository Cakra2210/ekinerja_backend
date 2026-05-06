import { NextFunction, Request, Response } from "express";
import { pool } from "../config/database";
import {
  AuthenticatedUser,
  ensureAuthSchema,
  resolveActiveRole,
  verifyAccessToken
} from "../features/auth/auth.security";
import { getAllowedAccessRoles, normalizeAccountRole, normalizeRoleMatrix } from "../shared/accountRoles";
import { env } from "../config/env";
import { parseCookieHeader } from "../shared/cookies";

export type RequestUser = AuthenticatedUser;

export type AuthenticatedRequest = Request & {
  user?: RequestUser;
};

const buildAbsoluteUploadUrl = (req: Request, value?: string | null) => {
  if (!value) {
    return null;
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  return `${req.protocol}://${req.get("host")}${value.startsWith("/") ? value : `/${value}`}`;
};

const resolveRequestedRoleFromHeader = (req: Request) => {
  const rawValue = req.headers["x-active-role"];

  if (Array.isArray(rawValue)) {
    return rawValue[0] || null;
  }

  return rawValue ? String(rawValue) : null;
};

const getAssignedRoles = async (accountId: number, legacyRole?: RequestUser["role"] | null) => {
  const [rows] = await pool.query<any[]>(
    `SELECT role_name AS roleName
     FROM akun_pengguna_role
     WHERE akun_pengguna_id = ?
     ORDER BY role_name ASC`,
    [accountId]
  );

  return getAllowedAccessRoles(
    normalizeRoleMatrix(rows.map((row) => row.roleName)),
    legacyRole || null
  );
};

export const authenticate = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    await ensureAuthSchema();

    const authorization = String(req.headers.authorization || "").trim();
    const cookies = parseCookieHeader(req.headers.cookie);
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7).trim()
      : String(cookies[env.sessionCookieName] || "").trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Sesi login tidak ditemukan"
      });
    }
    const payload = verifyAccessToken(token);

    if (!payload) {
      return res.status(401).json({
        success: false,
        message: "Sesi login tidak valid atau sudah berakhir"
      });
    }

    const [rows] = await pool.query<any[]>(
      `SELECT ua.id,
              ua.pegawai_id AS employeeId,
              ua.username,
              ua.peran AS baseRole,
              ua.aktif AS isActive,
              ua.wajib_ganti_password AS mustChangePassword,
              e.nama_lengkap AS fullName,
              e.nip,
              e.path_foto_profil AS profilePhotoPath
       FROM akun_pengguna ua
       INNER JOIN pegawai e ON e.id = ua.pegawai_id
       WHERE ua.id = ?
       LIMIT 1`,
      [payload.sub]
    );

    if (!rows.length || !rows[0].isActive) {
      return res.status(401).json({
        success: false,
        message: "Akun tidak aktif atau tidak ditemukan"
      });
    }

    const legacyRole = normalizeAccountRole(rows[0].baseRole);
    const assignedRoles = await getAssignedRoles(Number(rows[0].id), legacyRole);
    const activeRole = resolveActiveRole(
      resolveRequestedRoleFromHeader(req),
      assignedRoles
    );

    req.user = {
      accountId: Number(rows[0].id),
      employeeId: Number(rows[0].employeeId),
      fullName: String(rows[0].fullName || ""),
      nip: String(rows[0].nip || ""),
      username: String(rows[0].username || ""),
      role: activeRole,
      assignedRoles,
      isActive: Boolean(rows[0].isActive),
      mustChangePassword: Boolean(rows[0].mustChangePassword),
      profilePhotoPath: rows[0].profilePhotoPath ? String(rows[0].profilePhotoPath) : null,
      profilePhotoUrl: buildAbsoluteUploadUrl(
        req,
        rows[0].profilePhotoPath ? String(rows[0].profilePhotoPath) : null
      )
    };

    return next();
  } catch (_error: any) {
    return res.status(500).json({
      success: false,
      message: "Gagal memvalidasi sesi login"
    });
  }
};

export const authorizeRoles = (...roles: RequestUser["role"][]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const currentRole = req.user?.role;

    if (!currentRole || !roles.includes(currentRole)) {
      return res.status(403).json({
        success: false,
        message: "Anda tidak memiliki hak akses untuk tindakan ini"
      });
    }

    return next();
  };
};
