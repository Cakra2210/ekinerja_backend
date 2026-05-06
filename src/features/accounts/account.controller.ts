import { ResultSetHeader } from "mysql2";
import { pool } from "../../config/database";
import { AccountPayload, AccountRole } from "../../types";
import { asyncHandler, fail, sendSuccess } from "../../shared/http";
import {
  ensureRequired,
  readBoolean,
  readPositiveId,
  readTrimmedString
} from "../../shared/validation";
import { ensureAuthSchema, hashPassword } from "../auth/auth.security";
import {
  DEFAULT_INITIAL_PASSWORD,
  getAllowedAccessRoles,
  normalizeAccountRole,
  normalizeRoleMatrix
} from "../../shared/accountRoles";

const readRoleMatrix = (body: Record<string, unknown>) => {
  const rawValue = body.roleMatrix ?? body["roleMatrix[]"] ?? body.role_matrix ?? body.roles;
  return normalizeRoleMatrix(rawValue);
};

const normalizeAccountPayload = (body: Record<string, unknown>): AccountPayload => ({
  employeeId: readPositiveId(body.employeeId, "Pegawai"),
  username: ensureRequired(readTrimmedString(body.username), "Username wajib diisi"),
  password: readTrimmedString(body.password),
  roleMatrix: readRoleMatrix(body),
  isActive: readBoolean(body.isActive, true)
});

const ensureEmployeeExists = async (employeeId: number) => {
  const [employeeRows] = await pool.query<any[]>(
    "SELECT id FROM pegawai WHERE id = ? LIMIT 1",
    [employeeId]
  );

  if (!employeeRows.length) {
    fail("Pegawai tidak ditemukan", 404);
  }
};

const syncAccountRoleMatrix = async (accountId: number, roles: AccountRole[]) => {
  const normalizedRoles = normalizeRoleMatrix(roles);

  await pool.query("DELETE FROM akun_pengguna_role WHERE akun_pengguna_id = ?", [accountId]);

  for (const roleName of normalizedRoles) {
    await pool.query(
      `INSERT INTO akun_pengguna_role (akun_pengguna_id, role_name)
       VALUES (?, ?)`,
      [accountId, roleName]
    );
  }
};

const readAssignedRolesMap = async () => {
  const [rows] = await pool.query<any[]>(
    `SELECT akun_pengguna_id AS accountId,
            role_name AS roleName
     FROM akun_pengguna_role
     ORDER BY akun_pengguna_id ASC, role_name ASC`
  );

  return rows.reduce<Record<number, AccountRole[]>>((acc, row) => {
    const accountId = Number(row.accountId);
    const normalizedRole = normalizeAccountRole(row.roleName);
    if (!acc[accountId]) {
      acc[accountId] = [];
    }
    if (!acc[accountId].includes(normalizedRole)) {
      acc[accountId].push(normalizedRole);
    }
    return acc;
  }, {});
};

export const getAccounts = asyncHandler(async (_req, res) => {
  await ensureAuthSchema();

  const [rows] = await pool.query<any[]>(
    `SELECT ua.id, ua.pegawai_id AS employeeId, ua.username, ua.peran AS legacyRole,
            ua.aktif AS isActive,
            ua.dibuat_pada AS createdAt,
            e.nip,
            e.nama_lengkap AS fullName,
            e.nama_jabatan AS position,
            '' AS departmentName
     FROM akun_pengguna ua
     INNER JOIN pegawai e ON e.id = ua.pegawai_id
     ORDER BY e.nama_lengkap ASC`
  );

  const roleMap = await readAssignedRolesMap();
  const mappedRows = rows.map((row) => ({
    ...row,
    roleMatrix: getAllowedAccessRoles(
      roleMap[Number(row.id)] || null,
      normalizeAccountRole(row.legacyRole)
    )
  }));

  return sendSuccess(res, mappedRows);
});

export const createAccount = asyncHandler(async (req, res) => {
  await ensureAuthSchema();
  const payload = normalizeAccountPayload(req.body as Record<string, unknown>);

  const password = payload.password || DEFAULT_INITIAL_PASSWORD;

  await ensureEmployeeExists(payload.employeeId);

  try {
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO akun_pengguna
       (pegawai_id, username, hash_password, peran, aktif, wajib_ganti_password)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        payload.employeeId,
        payload.username,
        await hashPassword(password),
        "pegawai",
        payload.isActive ? 1 : 0,
        1
      ]
    );

    await syncAccountRoleMatrix(Number(result.insertId), payload.roleMatrix);

    return sendSuccess(
      res,
      {
        id: result.insertId,
        employeeId: payload.employeeId,
        username: payload.username,
        roleMatrix: payload.roleMatrix,
        isActive: payload.isActive
      },
      "Akun pegawai berhasil dibuat",
      201
    );
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") {
      fail("Pegawai sudah memiliki akun atau username sudah digunakan", 409);
    }

    throw error;
  }
});

export const updateAccount = asyncHandler(async (req, res) => {
  await ensureAuthSchema();

  const id = readPositiveId(req.params.id, "ID akun");
  const payload = normalizeAccountPayload(req.body as Record<string, unknown>);

  await ensureEmployeeExists(payload.employeeId);

  const passwordClause = payload.password
    ? ", hash_password = ?, wajib_ganti_password = 1"
    : "";

  const params: Array<string | number> = [
    payload.employeeId,
    payload.username,
    payload.isActive ? 1 : 0
  ];

  if (payload.password) {
    params.push(await hashPassword(payload.password));
  }

  params.push(id);

  try {
    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE akun_pengguna
       SET pegawai_id = ?, username = ?, peran = 'pegawai', aktif = ?${passwordClause}
       WHERE id = ?`,
      params
    );

    if (result.affectedRows === 0) {
      fail("Akun pegawai tidak ditemukan", 404);
    }

    await syncAccountRoleMatrix(id, payload.roleMatrix);

    return sendSuccess(
      res,
      null,
      payload.password
        ? "Akun pegawai, matriks role, dan password berhasil diperbarui"
        : "Akun pegawai dan matriks role berhasil diperbarui"
    );
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") {
      fail("Pegawai sudah memiliki akun atau username sudah digunakan", 409);
    }

    throw error;
  }
});

export const deleteAccount = asyncHandler(async (req, res) => {
  const id = readPositiveId(req.params.id, "ID akun");

  const [result] = await pool.query<ResultSetHeader>(
    "DELETE FROM akun_pengguna WHERE id = ?",
    [id]
  );

  if (result.affectedRows === 0) {
    fail("Akun pegawai tidak ditemukan", 404);
  }

  return sendSuccess(res, null, "Akun pegawai berhasil dihapus");
});
