"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteAccount = exports.updateAccount = exports.createAccount = exports.getAccounts = void 0;
const database_1 = require("../../config/database");
const http_1 = require("../../shared/http");
const validation_1 = require("../../shared/validation");
const auth_security_1 = require("../auth/auth.security");
const accountRoles_1 = require("../../shared/accountRoles");
const readRoleMatrix = (body) => {
    const rawValue = body.roleMatrix ?? body["roleMatrix[]"] ?? body.role_matrix ?? body.roles;
    return (0, accountRoles_1.normalizeRoleMatrix)(rawValue);
};
const normalizeAccountPayload = (body) => ({
    employeeId: (0, validation_1.readPositiveId)(body.employeeId, "Pegawai"),
    username: (0, validation_1.ensureRequired)((0, validation_1.readTrimmedString)(body.username), "Username wajib diisi"),
    password: (0, validation_1.readTrimmedString)(body.password),
    roleMatrix: readRoleMatrix(body),
    isActive: (0, validation_1.readBoolean)(body.isActive, true)
});
const ensureEmployeeExists = async (employeeId) => {
    const [employeeRows] = await database_1.pool.query("SELECT id FROM pegawai WHERE id = ? LIMIT 1", [employeeId]);
    if (!employeeRows.length) {
        (0, http_1.fail)("Pegawai tidak ditemukan", 404);
    }
};
const syncAccountRoleMatrix = async (accountId, roles) => {
    const normalizedRoles = (0, accountRoles_1.normalizeRoleMatrix)(roles);
    await database_1.pool.query("DELETE FROM akun_pengguna_role WHERE akun_pengguna_id = ?", [accountId]);
    for (const roleName of normalizedRoles) {
        await database_1.pool.query(`INSERT INTO akun_pengguna_role (akun_pengguna_id, role_name)
       VALUES (?, ?)`, [accountId, roleName]);
    }
};
const readAssignedRolesMap = async () => {
    const [rows] = await database_1.pool.query(`SELECT akun_pengguna_id AS accountId,
            role_name AS roleName
     FROM akun_pengguna_role
     ORDER BY akun_pengguna_id ASC, role_name ASC`);
    return rows.reduce((acc, row) => {
        const accountId = Number(row.accountId);
        const normalizedRole = (0, accountRoles_1.normalizeAccountRole)(row.roleName);
        if (!acc[accountId]) {
            acc[accountId] = [];
        }
        if (!acc[accountId].includes(normalizedRole)) {
            acc[accountId].push(normalizedRole);
        }
        return acc;
    }, {});
};
exports.getAccounts = (0, http_1.asyncHandler)(async (_req, res) => {
    await (0, auth_security_1.ensureAuthSchema)();
    const [rows] = await database_1.pool.query(`SELECT ua.id, ua.pegawai_id AS employeeId, ua.username, ua.peran AS legacyRole,
            ua.aktif AS isActive,
            ua.dibuat_pada AS createdAt,
            e.nip,
            e.nama_lengkap AS fullName,
            e.nama_jabatan AS position,
            '' AS departmentName
     FROM akun_pengguna ua
     INNER JOIN pegawai e ON e.id = ua.pegawai_id
     ORDER BY e.nama_lengkap ASC`);
    const roleMap = await readAssignedRolesMap();
    const mappedRows = rows.map((row) => ({
        ...row,
        roleMatrix: (0, accountRoles_1.getAllowedAccessRoles)(roleMap[Number(row.id)] || null, (0, accountRoles_1.normalizeAccountRole)(row.legacyRole))
    }));
    return (0, http_1.sendSuccess)(res, mappedRows);
});
exports.createAccount = (0, http_1.asyncHandler)(async (req, res) => {
    await (0, auth_security_1.ensureAuthSchema)();
    const payload = normalizeAccountPayload(req.body);
    const password = payload.password || accountRoles_1.DEFAULT_INITIAL_PASSWORD;
    await ensureEmployeeExists(payload.employeeId);
    try {
        const [result] = await database_1.pool.query(`INSERT INTO akun_pengguna
       (pegawai_id, username, hash_password, peran, aktif, wajib_ganti_password)
       VALUES (?, ?, ?, ?, ?, ?)`, [
            payload.employeeId,
            payload.username,
            await (0, auth_security_1.hashPassword)(password),
            "pegawai",
            payload.isActive ? 1 : 0,
            1
        ]);
        await syncAccountRoleMatrix(Number(result.insertId), payload.roleMatrix);
        return (0, http_1.sendSuccess)(res, {
            id: result.insertId,
            employeeId: payload.employeeId,
            username: payload.username,
            roleMatrix: payload.roleMatrix,
            isActive: payload.isActive
        }, "Akun pegawai berhasil dibuat", 201);
    }
    catch (error) {
        if (error?.code === "ER_DUP_ENTRY") {
            (0, http_1.fail)("Pegawai sudah memiliki akun atau username sudah digunakan", 409);
        }
        throw error;
    }
});
exports.updateAccount = (0, http_1.asyncHandler)(async (req, res) => {
    await (0, auth_security_1.ensureAuthSchema)();
    const id = (0, validation_1.readPositiveId)(req.params.id, "ID akun");
    const payload = normalizeAccountPayload(req.body);
    await ensureEmployeeExists(payload.employeeId);
    const passwordClause = payload.password
        ? ", hash_password = ?, wajib_ganti_password = 1"
        : "";
    const params = [
        payload.employeeId,
        payload.username,
        payload.isActive ? 1 : 0
    ];
    if (payload.password) {
        params.push(await (0, auth_security_1.hashPassword)(payload.password));
    }
    params.push(id);
    try {
        const [result] = await database_1.pool.query(`UPDATE akun_pengguna
       SET pegawai_id = ?, username = ?, peran = 'pegawai', aktif = ?${passwordClause}
       WHERE id = ?`, params);
        if (result.affectedRows === 0) {
            (0, http_1.fail)("Akun pegawai tidak ditemukan", 404);
        }
        await syncAccountRoleMatrix(id, payload.roleMatrix);
        return (0, http_1.sendSuccess)(res, null, payload.password
            ? "Akun pegawai, matriks role, dan password berhasil diperbarui"
            : "Akun pegawai dan matriks role berhasil diperbarui");
    }
    catch (error) {
        if (error?.code === "ER_DUP_ENTRY") {
            (0, http_1.fail)("Pegawai sudah memiliki akun atau username sudah digunakan", 409);
        }
        throw error;
    }
});
exports.deleteAccount = (0, http_1.asyncHandler)(async (req, res) => {
    const id = (0, validation_1.readPositiveId)(req.params.id, "ID akun");
    const [result] = await database_1.pool.query("DELETE FROM akun_pengguna WHERE id = ?", [id]);
    if (result.affectedRows === 0) {
        (0, http_1.fail)("Akun pegawai tidak ditemukan", 404);
    }
    return (0, http_1.sendSuccess)(res, null, "Akun pegawai berhasil dihapus");
});
