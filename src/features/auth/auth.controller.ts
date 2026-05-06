import { Request, Response } from "express";
import { pool } from "../../config/database";
import {
  createAccessToken,
  ensureAuthSchema,
  hashPassword,
  isLegacySha256Hash,
  resolveActiveRole,
  verifyPassword
} from "./auth.security";
import {
  getAllowedAccessRoles,
  normalizeAccountRole,
  normalizeRoleMatrix
} from "../../shared/accountRoles";
import type { AccountRole } from "../../types";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware";
import { clearAuthCookie, setAuthCookie } from "../../shared/cookies";

const buildAbsoluteUploadUrl = (req: Request | AuthenticatedRequest, value?: string | null) => {
  if (!value) {
    return null;
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  return `${req.protocol}://${req.get("host")}${value.startsWith("/") ? value : `/${value}`}`;
};

const resolveRequestedRoleFromHeader = (req: Request | AuthenticatedRequest) => {
  const rawValue = req.headers["x-active-role"];

  if (Array.isArray(rawValue)) {
    return rawValue[0] || null;
  }

  return rawValue ? String(rawValue) : null;
};

const getAssignedRoles = async (accountId: number, legacyRole?: AccountRole | null) => {
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

const mapUser = (
  row: any,
  req: Request | AuthenticatedRequest,
  assignedRoles?: AccountRole[]
) => {
  const profilePhotoPath = row.profilePhotoPath ? String(row.profilePhotoPath) : null;
  const legacyRole = normalizeAccountRole(row.legacyRole ?? row.baseRole ?? row.role);
  const roleMatrix = getAllowedAccessRoles(
    assignedRoles ?? normalizeRoleMatrix(row.assignedRoles),
    legacyRole
  );
  const activeRole = resolveActiveRole(
    row.activeRole ?? resolveRequestedRoleFromHeader(req),
    roleMatrix
  );

  return {
    accountId: Number(row.id),
    employeeId: Number(row.employeeId),
    fullName: String(row.fullName || ""),
    nip: String(row.nip || ""),
    username: String(row.username || ""),
    role: activeRole,
    assignedRoles: roleMatrix,
    isActive: Boolean(row.isActive),
    mustChangePassword: Boolean(row.mustChangePassword),
    profilePhotoPath,
    profilePhotoUrl: buildAbsoluteUploadUrl(req, profilePhotoPath)
  };
};

const createAuthResponse = (
  row: any,
  req: Request | AuthenticatedRequest,
  res: Response,
  assignedRoles?: AccountRole[],
  message = "Login berhasil"
) => {
  const user = mapUser(row, req, assignedRoles);
  const session = createAccessToken(user);
  setAuthCookie(res, session.token, session.expiresAt);

  return {
    success: true,
    message,
    data: {
      user,
      expiresAt: new Date(session.expiresAt).toISOString(),
      mustChangePassword: user.mustChangePassword
    }
  };
};

export const login = async (req: Request, res: Response) => {
  try {
    await ensureAuthSchema();

    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "").trim();

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Username dan password wajib diisi"
      });
    }

    const [rows] = await pool.query<any[]>(
      `SELECT ua.id,
              ua.pegawai_id AS employeeId,
              ua.username,
              ua.hash_password AS passwordHash,
              ua.peran AS legacyRole,
              ua.aktif AS isActive,
              ua.wajib_ganti_password AS mustChangePassword,
              e.nama_lengkap AS fullName,
              e.nip,
              e.path_foto_profil AS profilePhotoPath
       FROM akun_pengguna ua
       INNER JOIN pegawai e ON e.id = ua.pegawai_id
       WHERE ua.username = ?
       LIMIT 1`,
      [username]
    );

    if (!rows.length) {
      return res.status(401).json({
        success: false,
        message: "Username atau password tidak sesuai"
      });
    }

    const account = rows[0];
    const isPasswordValid = await verifyPassword(password, String(account.passwordHash || ""));

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Username atau password tidak sesuai"
      });
    }

    if (!account.isActive) {
      return res.status(403).json({
        success: false,
        message: "Akun tidak aktif. Hubungi admin sistem"
      });
    }

    const shouldUpgradeHash = isLegacySha256Hash(String(account.passwordHash || ""));

    if (shouldUpgradeHash) {
      const upgradedHash = await hashPassword(password);
      await pool.query(
        `UPDATE akun_pengguna
         SET hash_password = ?,
             wajib_ganti_password = 1,
             login_terakhir_pada = NOW()
         WHERE id = ?`,
        [upgradedHash, account.id]
      );
      account.passwordHash = upgradedHash;
      account.mustChangePassword = 1;
    } else {
      await pool.query(
        `UPDATE akun_pengguna
         SET login_terakhir_pada = NOW()
         WHERE id = ?`,
        [account.id]
      );
    }

    const assignedRoles = await getAssignedRoles(Number(account.id), normalizeAccountRole(account.legacyRole));
    return res.json(createAuthResponse(account, req, res, assignedRoles));
  } catch (error: any) {
    if (error?.code === "ER_NO_SUCH_TABLE") {
      return res.status(500).json({
        success: false,
        message:
          "Tabel akun login belum tersedia. Jalankan patch_sync_login_accounts.sql terlebih dahulu."
      });
    }

    if (error?.code === "ER_BAD_FIELD_ERROR") {
      return res.status(500).json({
        success: false,
        message:
          "Struktur tabel pegawai belum mendukung foto profil. Jalankan sql_patch_employee_profile_photo.sql terlebih dahulu."
      });
    }

    console.error("[auth.login]", error);

    return res.status(500).json({
      success: false,
      message: "Gagal memproses login"
    });
  }
};

export const getCurrentSession = async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;

  if (!user) {
    return res.status(401).json({
      success: false,
      message: "Sesi login tidak ditemukan"
    });
  }

  const session = createAccessToken(user);
  setAuthCookie(res, session.token, session.expiresAt);

  return res.json({
    success: true,
    data: {
      user,
      expiresAt: new Date(session.expiresAt).toISOString(),
      mustChangePassword: user.mustChangePassword
    }
  });
};

export const logout = async (_req: AuthenticatedRequest, res: Response) => {
  clearAuthCookie(res);
  return res.json({ success: true, message: "Logout berhasil", data: null });
};

export const changePassword = async (req: AuthenticatedRequest, res: Response) => {
  try {
    await ensureAuthSchema();

    const currentUser = req.user;

    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message: "Sesi login tidak ditemukan"
      });
    }

    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");
    const confirmPassword = String(req.body?.confirmPassword || "");

    if (!newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Password baru dan konfirmasi password wajib diisi"
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password baru minimal 6 karakter"
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Konfirmasi password baru tidak sesuai"
      });
    }

    const [rows] = await pool.query<any[]>(
      `SELECT ua.id,
              ua.hash_password AS passwordHash,
              ua.wajib_ganti_password AS mustChangePassword,
              ua.peran AS legacyRole,
              ua.username,
              ua.aktif AS isActive,
              ua.pegawai_id AS employeeId,
              e.nama_lengkap AS fullName,
              e.nip,
              e.path_foto_profil AS profilePhotoPath
       FROM akun_pengguna ua
       INNER JOIN pegawai e ON e.id = ua.pegawai_id
       WHERE ua.id = ?
       LIMIT 1`,
      [currentUser.accountId]
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Akun login tidak ditemukan"
      });
    }

    const account = rows[0];

    if (!account.mustChangePassword) {
      const isCurrentPasswordValid = await verifyPassword(
        currentPassword,
        String(account.passwordHash || "")
      );

      if (!isCurrentPasswordValid) {
        return res.status(400).json({
          success: false,
          message: "Password saat ini tidak sesuai"
        });
      }
    }

    const passwordHash = await hashPassword(newPassword);

    await pool.query(
      `UPDATE akun_pengguna
       SET hash_password = ?,
           wajib_ganti_password = 0
       WHERE id = ?`,
      [passwordHash, currentUser.accountId]
    );

    account.passwordHash = passwordHash;
    account.mustChangePassword = 0;
    account.activeRole = currentUser.role;
    const assignedRoles = await getAssignedRoles(Number(account.id), normalizeAccountRole(account.legacyRole));

    return res.json(createAuthResponse(account, req, res, assignedRoles, "Password berhasil diperbarui"));
  } catch (error) {
    console.error("[auth.changePassword]", error);

    return res.status(500).json({
      success: false,
      message: "Gagal memperbarui password"
    });
  }
};
