"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authorizeRoles = exports.authenticate = void 0;
const database_1 = require("../config/database");
const auth_security_1 = require("../features/auth/auth.security");
const accountRoles_1 = require("../shared/accountRoles");
const env_1 = require("../config/env");
const cookies_1 = require("../shared/cookies");
const buildAbsoluteUploadUrl = (req, value) => {
    if (!value) {
        return null;
    }
    if (/^https?:\/\//i.test(value)) {
        return value;
    }
    return `${req.protocol}://${req.get("host")}${value.startsWith("/") ? value : `/${value}`}`;
};
const resolveRequestedRoleFromHeader = (req) => {
    const rawValue = req.headers["x-active-role"];
    if (Array.isArray(rawValue)) {
        return rawValue[0] || null;
    }
    return rawValue ? String(rawValue) : null;
};
const getAssignedRoles = async (accountId, legacyRole) => {
    const [rows] = await database_1.pool.query(`SELECT role_name AS roleName
     FROM akun_pengguna_role
     WHERE akun_pengguna_id = ?
     ORDER BY role_name ASC`, [accountId]);
    return (0, accountRoles_1.getAllowedAccessRoles)((0, accountRoles_1.normalizeRoleMatrix)(rows.map((row) => row.roleName)), legacyRole || null);
};
const authenticate = async (req, res, next) => {
    try {
        await (0, auth_security_1.ensureAuthSchema)();
        const authorization = String(req.headers.authorization || "").trim();
        const cookies = (0, cookies_1.parseCookieHeader)(req.headers.cookie);
        const token = authorization.startsWith("Bearer ")
            ? authorization.slice(7).trim()
            : String(cookies[env_1.env.sessionCookieName] || "").trim();
        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Sesi login tidak ditemukan"
            });
        }
        const payload = (0, auth_security_1.verifyAccessToken)(token);
        if (!payload) {
            return res.status(401).json({
                success: false,
                message: "Sesi login tidak valid atau sudah berakhir"
            });
        }
        const [rows] = await database_1.pool.query(`SELECT ua.id,
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
       LIMIT 1`, [payload.sub]);
        if (!rows.length || !rows[0].isActive) {
            return res.status(401).json({
                success: false,
                message: "Akun tidak aktif atau tidak ditemukan"
            });
        }
        const legacyRole = (0, accountRoles_1.normalizeAccountRole)(rows[0].baseRole);
        const assignedRoles = await getAssignedRoles(Number(rows[0].id), legacyRole);
        const activeRole = (0, auth_security_1.resolveActiveRole)(resolveRequestedRoleFromHeader(req), assignedRoles);
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
            profilePhotoUrl: buildAbsoluteUploadUrl(req, rows[0].profilePhotoPath ? String(rows[0].profilePhotoPath) : null)
        };
        return next();
    }
    catch (_error) {
        return res.status(500).json({
            success: false,
            message: "Gagal memvalidasi sesi login"
        });
    }
};
exports.authenticate = authenticate;
const authorizeRoles = (...roles) => {
    return (req, res, next) => {
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
exports.authorizeRoles = authorizeRoles;
