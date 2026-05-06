import fs from "fs";
import path from "path";
import { PoolConnection, ResultSetHeader } from "mysql2/promise";
import { pool } from "../../config/database";
import { AccountRole, EmployeeInput } from "../../types";
import { asyncHandler, fail, sendSuccess } from "../../shared/http";
import {
  ensureOneOf,
  ensureRequired,
  readBoolean,
  readDateString,
  readPositiveId,
  readTrimmedString
} from "../../shared/validation";
import { ensureAuthSchema, hashPassword } from "../auth/auth.security";
import { DEFAULT_INITIAL_PASSWORD, normalizeRoleMatrix } from "../../shared/accountRoles";

const allowedEmploymentStatuses = ["PNS", "CPNS", "PPPK", "TB STIS di Sekolah Tinggi Ilmu Statistik"] as const;
const allowedActiveStatuses = ["aktif", "tidak_aktif"] as const;
const allowedEducations = ["SD/SMP", "SMA", "D3", "D4", "S1", "S2", "S3"] as const;
const allowedRankGroups = [
  "Juru Muda (Ia)",
  "Juru Muda Tingkat I (Ib)",
  "Juru (Ic)",
  "Juru Tingkat I (Id)",
  "Pengatur Muda (IIa)",
  "Pengatur Muda Tingkat I (IIb)",
  "Pengatur (IIc)",
  "Pengatur Tingkat I (IId)",
  "Penata Muda (IIIa)",
  "Penata Muda Tingkat I (IIIb)",
  "Penata (IIIc)",
  "Penata Tingkat I (IIId)",
  "Pembina (IVa)",
  "Pembina Tingkat I (IVb)",
  "Pembina Utama Muda (IVc)",
  "Pembina Utama Madya (IVd)",
  "Pembina Utama (IVe)",
  "I/a",
  "I/b",
  "I/c",
  "I/d",
  "II/a",
  "II/b",
  "II/c",
  "II/d",
  "III/a",
  "III/b",
  "III/c",
  "III/d",
  "IV/a",
  "IV/b",
  "IV/c",
  "IV/d",
  "IV/e",
  "VII"
] as const;

const readOptionalDateString = (value: unknown, fieldName: string) => {
  const normalized = readTrimmedString(value);

  if (!normalized) {
    return null;
  }

  return readDateString(normalized, fieldName);
};

const readOptionalEmail = (value: unknown) => {
  const normalized = readTrimmedString(value).toLowerCase();

  if (!normalized) {
    return "";
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailPattern.test(normalized)) {
    fail("Email tidak valid", 400);
  }

  return normalized;
};

const allowedGenders = ["Laki-laki", "Perempuan"] as const;

const readOptionalGender = (value: unknown) => {
  const normalized = readTrimmedString(value);

  if (!normalized) {
    return "" as const;
  }

  return ensureOneOf(normalized, allowedGenders, "Jenis kelamin");
};

const normalizeEmployeePayload = (body: Record<string, unknown>): EmployeeInput => ({
  fullName: readTrimmedString(body.fullName),
  nip: readTrimmedString(body.nip),
  oldNip: readTrimmedString(body.oldNip),
  placeOfBirth: readTrimmedString(body.placeOfBirth),
  birthDate: readOptionalDateString(body.birthDate, "Tanggal lahir"),
  gender: readOptionalGender(body.gender),
  rankGroup: ensureOneOf(
    readTrimmedString(body.rankGroup),
    allowedRankGroups,
    "Golongan"
  ),
  rankStartDate: readOptionalDateString(body.rankStartDate, "TMT golongan"),
  email: readOptionalEmail(body.email),
  education: ensureOneOf(
    readTrimmedString(body.education).toUpperCase(),
    allowedEducations,
    "Pendidikan"
  ),
  diplomaDate: readOptionalDateString(body.diplomaDate, "Tanggal ijazah"),
  positionId: readPositiveId(body.positionId, "Jabatan"),
  employmentStatus: ensureOneOf(
    readTrimmedString(body.employmentStatus),
    allowedEmploymentStatuses,
    "Status kepegawaian"
  ),
  activeStatus: ensureOneOf(
    readTrimmedString(body.activeStatus).toLowerCase(),
    allowedActiveStatuses,
    "Status aktif"
  ),
  effectiveDate: readDateString(body.effectiveDate, "Tanggal efektif"),
  username: readTrimmedString(body.username),
  password: readTrimmedString(body.password),
  roleMatrix: normalizeRoleMatrix(
    body.roleMatrix ?? body["roleMatrix[]"] ?? body.role_matrix ?? body.roles
  ),
  removeProfilePhoto: readBoolean(body.removeProfilePhoto, false),
  profilePhotoPath: null
});

const validateEmployeePayload = (payload: EmployeeInput, isEditMode: boolean) => {
  ensureRequired(payload.fullName, "Nama pegawai wajib diisi");
  ensureRequired(payload.nip, "NIP wajib diisi");
  ensureRequired(payload.placeOfBirth, "Tempat lahir wajib diisi");
  ensureRequired(payload.birthDate || "", "Tanggal lahir wajib diisi");
  ensureRequired(payload.gender, "Jenis kelamin wajib diisi");
  ensureRequired(payload.rankGroup, "Golongan wajib diisi");
  ensureRequired(payload.email, "Email wajib diisi");
  ensureRequired(payload.username, "Username wajib diisi");

  if (!isEditMode) {
    ensureRequired(payload.password, "Password wajib diisi saat menambahkan pegawai");
  }
};

const deleteUploadedFile = (filePath?: string | null) => {
  if (!filePath) return;

  const normalized = filePath.startsWith("/") ? filePath.slice(1) : filePath;
  const absolutePath = path.resolve(process.cwd(), normalized);

  if (fs.existsSync(absolutePath)) {
    fs.unlinkSync(absolutePath);
  }
};

const toProfilePhotoPath = (file?: Express.Multer.File | null) => {
  if (!file) return null;
  return `/uploads/profile-photos/${file.filename}`;
};

const getDefaultDepartmentId = async (connection: PoolConnection) => {
  const [rows] = await connection.query<any[]>(
    "SELECT id FROM departemen ORDER BY id ASC LIMIT 1"
  );

  return rows[0]?.id ? Number(rows[0].id) : null;
};

const getEmployeeAccount = async (connection: PoolConnection, employeeId: number) => {
  const [rows] = await connection.query<any[]>(
    `SELECT id, username
     FROM akun_pengguna
     WHERE pegawai_id = ?
     LIMIT 1`,
    [employeeId]
  );

  return rows[0] || null;
};


const syncAccountRoleMatrix = async (connection: PoolConnection, accountId: number, roles: AccountRole[]) => {
  const normalizedRoles = normalizeRoleMatrix(roles);

  await connection.query("DELETE FROM akun_pengguna_role WHERE akun_pengguna_id = ?", [accountId]);

  for (const roleName of normalizedRoles) {
    await connection.query(
      `INSERT INTO akun_pengguna_role (akun_pengguna_id, role_name) VALUES (?, ?)`,
      [accountId, roleName]
    );
  }
};

const getPositionById = async (connection: PoolConnection, positionId: number) => {
  const [rows] = await connection.query<any[]>(
    `SELECT id, nama AS name
     FROM jabatan
     WHERE id = ?
     LIMIT 1`,
    [positionId]
  );

  return rows[0] || null;
};

const ensurePositionExists = async (connection: PoolConnection, positionId: number) => {
  const position = await getPositionById(connection, positionId);

  if (!position) {
    fail("Jabatan tidak ditemukan", 400);
  }

  return position;
};

const ensureDepartmentExists = async (
  connection: PoolConnection,
  currentDepartmentId?: number | null
) => {
  const departmentId = currentDepartmentId || (await getDefaultDepartmentId(connection));

  if (!departmentId) {
    fail("Data departemen belum tersedia", 400);
  }

  return departmentId;
};

const getEmployeeListQuery = `SELECT e.id,
                                     e.nip,
                                     e.nama_lengkap AS fullName,
                                     e.nip_lama AS oldNip,
                                     e.tempat_lahir AS placeOfBirth,
                                     DATE_FORMAT(e.tanggal_lahir, '%Y-%m-%d') AS birthDate,
                                     e.jenis_kelamin AS gender,
                                     e.pangkat_golongan AS rankGroup,
                                     DATE_FORMAT(e.tmt_golongan, '%Y-%m-%d') AS rankStartDate,
                                     e.email AS email,
                                     e.pendidikan_terakhir AS education,
                                     DATE_FORMAT(e.tanggal_ijazah, '%Y-%m-%d') AS diplomaDate,
                                     e.jabatan_id AS positionId,
                                     COALESCE(p.nama, e.nama_jabatan) AS positionName,
                                     COALESCE(p.nama, e.nama_jabatan) AS position,
                                     e.status_kepegawaian AS employmentStatus,
                                     e.status_aktif AS activeStatus,
                                     DATE_FORMAT(e.tanggal_masuk, '%Y-%m-%d') AS joinDate,
                                     DATE_FORMAT(e.tanggal_keluar, '%Y-%m-%d') AS exitDate,
                                     CASE
                                       WHEN e.status_aktif = 'tidak_aktif' AND e.tanggal_keluar IS NOT NULL
                                         THEN DATE_FORMAT(e.tanggal_keluar, '%Y-%m-%d')
                                       ELSE DATE_FORMAT(e.tanggal_masuk, '%Y-%m-%d')
                                     END AS effectiveDate,
                                     e.departemen_id AS departmentId,
                                     d.nama AS departmentName,
                                     ua.peran AS accountRole,
                                     (SELECT GROUP_CONCAT(ar.role_name ORDER BY ar.role_name SEPARATOR ',')
                                      FROM akun_pengguna_role ar
                                      WHERE ar.akun_pengguna_id = ua.id) AS accountRoleMatrix,
                                     ua.username AS accountUsername,
                                     ua.aktif AS accountActive,
                                     e.path_foto_profil AS profilePhotoPath
                              FROM pegawai e
                              LEFT JOIN jabatan p ON p.id = e.jabatan_id
                              LEFT JOIN departemen d ON d.id = e.departemen_id
                              LEFT JOIN akun_pengguna ua ON ua.pegawai_id = e.id
                              ORDER BY e.nama_lengkap ASC`;

export const getEmployees = asyncHandler(async (_req, res) => {
  try {
    await ensureAuthSchema();
    const [rows] = await pool.query<any[]>(getEmployeeListQuery);

    return sendSuccess(res, rows);
  } catch (error: any) {
    if (error?.code === "ER_BAD_FIELD_ERROR") {
      fail(
        "Struktur tabel pegawai belum sesuai. Jalankan migrasi biodata pegawai terlebih dahulu.",
        500
      );
    }

    fail("Gagal mengambil data pegawai", 500);
  }
});

export const createEmployee = asyncHandler(async (req, res) => {
  const connection = await pool.getConnection();
  const uploadedPhotoPath = toProfilePhotoPath(req.file as Express.Multer.File | undefined);

  try {
    await ensureAuthSchema();
    const payload = normalizeEmployeePayload(req.body as Record<string, unknown>);
    validateEmployeePayload(payload, false);

    const position = await ensurePositionExists(connection, payload.positionId);
    const defaultDepartmentId = await ensureDepartmentExists(connection);

    const joinDate = payload.activeStatus === "aktif" ? payload.effectiveDate : null;
    const exitDate = payload.activeStatus === "tidak_aktif" ? payload.effectiveDate : null;

    await connection.beginTransaction();

    const [result] = await connection.query<any>(
      `INSERT INTO pegawai
       (nip, nip_lama, nama_lengkap, tempat_lahir, tanggal_lahir, jenis_kelamin, pangkat_golongan, tmt_golongan, email, pendidikan_terakhir, tanggal_ijazah, departemen_id, jabatan_id, nama_jabatan, status_kepegawaian, status_aktif, tanggal_masuk, tanggal_keluar, path_foto_profil)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.nip,
        payload.oldNip,
        payload.fullName,
        payload.placeOfBirth,
        payload.birthDate,
        payload.gender || null,
        payload.rankGroup,
        payload.rankStartDate,
        payload.email,
        payload.education,
        payload.diplomaDate,
        defaultDepartmentId,
        payload.positionId,
        position.name,
        payload.employmentStatus,
        payload.activeStatus,
        joinDate,
        exitDate,
        uploadedPhotoPath
      ]
    );

    const [accountResult] = await connection.query<ResultSetHeader>(
      `INSERT INTO akun_pengguna (pegawai_id, username, hash_password, peran, aktif, wajib_ganti_password)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        result.insertId,
        payload.username,
        await hashPassword(payload.password || DEFAULT_INITIAL_PASSWORD),
        "pegawai",
        payload.activeStatus === "aktif" ? 1 : 0,
        1
      ]
    );

    await syncAccountRoleMatrix(connection, Number(accountResult.insertId), payload.roleMatrix);

    await connection.commit();

    return sendSuccess(
      res,
      { id: Number(result.insertId), profilePhotoPath: uploadedPhotoPath },
      "Pegawai berhasil ditambahkan",
      201
    );
  } catch (error: any) {
    await connection.rollback();
    deleteUploadedFile(uploadedPhotoPath);

    if (error?.code === "ER_DUP_ENTRY") {
      const message = String(error?.sqlMessage || "").includes("username")
        ? "Username sudah digunakan"
        : "NIP sudah digunakan";
      fail(message, 400);
    }

    if (error?.code === "ER_BAD_FIELD_ERROR") {
      fail(
        "Struktur tabel pegawai belum sesuai. Jalankan migrasi biodata pegawai terlebih dahulu.",
        500
      );
    }

    if (error?.code === "ER_NO_SUCH_TABLE") {
      fail(
        "Tabel jabatan atau akun belum tersedia. Jalankan patch_add_jabatan.sql dan patch_add_akun_pengguna.sql terlebih dahulu.",
        500
      );
    }

    throw error;
  } finally {
    connection.release();
  }
});

export const updateEmployee = asyncHandler(async (req, res) => {
  const connection = await pool.getConnection();
  const uploadedPhotoPath = toProfilePhotoPath(req.file as Express.Multer.File | undefined);

  try {
    await ensureAuthSchema();
    const id = readPositiveId(req.params.id, "ID pegawai");
    const payload = normalizeEmployeePayload(req.body as Record<string, unknown>);
    validateEmployeePayload(payload, true);

    const [existingRows] = await connection.query<any[]>(
      `SELECT id,
              departemen_id AS departmentId,
              DATE_FORMAT(tanggal_masuk, '%Y-%m-%d') AS joinDate,
              DATE_FORMAT(tanggal_keluar, '%Y-%m-%d') AS exitDate,
              path_foto_profil AS profilePhotoPath
       FROM pegawai
       WHERE id = ?
       LIMIT 1`,
      [id]
    );

    if (!existingRows.length) {
      fail("Data pegawai tidak ditemukan", 404);
    }

    const existingEmployee = existingRows[0];
    const position = await ensurePositionExists(connection, payload.positionId);
    const departmentId = await ensureDepartmentExists(connection, existingEmployee.departmentId);

    const joinDate =
      payload.activeStatus === "aktif"
        ? payload.effectiveDate
        : existingEmployee.joinDate || null;

    const exitDate = payload.activeStatus === "tidak_aktif" ? payload.effectiveDate : null;

    let nextProfilePhotoPath: string | null = existingEmployee.profilePhotoPath || null;

    if (payload.removeProfilePhoto) {
      nextProfilePhotoPath = null;
    }

    if (uploadedPhotoPath) {
      nextProfilePhotoPath = uploadedPhotoPath;
    }

    await connection.beginTransaction();

    await connection.query(
      `UPDATE pegawai
       SET nip = ?,
           nip_lama = ?,
           nama_lengkap = ?,
           tempat_lahir = ?,
           tanggal_lahir = ?,
           jenis_kelamin = ?,
           pangkat_golongan = ?,
           tmt_golongan = ?,
           email = ?,
           pendidikan_terakhir = ?,
           tanggal_ijazah = ?,
           departemen_id = ?,
           jabatan_id = ?,
           nama_jabatan = ?,
           status_kepegawaian = ?,
           status_aktif = ?,
           tanggal_masuk = ?,
           tanggal_keluar = ?,
           path_foto_profil = ?
       WHERE id = ?`,
      [
        payload.nip,
        payload.oldNip,
        payload.fullName,
        payload.placeOfBirth,
        payload.birthDate,
        payload.gender || null,
        payload.rankGroup,
        payload.rankStartDate,
        payload.email,
        payload.education,
        payload.diplomaDate,
        departmentId,
        payload.positionId,
        position.name,
        payload.employmentStatus,
        payload.activeStatus,
        joinDate,
        exitDate,
        nextProfilePhotoPath,
        id
      ]
    );

    const existingAccount = await getEmployeeAccount(connection, id);

    if (existingAccount) {
      const passwordClause = payload.password ? ", hash_password = ?, wajib_ganti_password = 1" : "";
      const params: Array<string | number> = [
        payload.username,
        payload.activeStatus === "aktif" ? 1 : 0
      ];

      if (payload.password) {
        params.push(await hashPassword(payload.password));
      }

      params.push(existingAccount.id);

      await connection.query(
        `UPDATE akun_pengguna
         SET username = ?, peran = 'pegawai', aktif = ?${passwordClause}
         WHERE id = ?`,
        params
      );

      await syncAccountRoleMatrix(connection, Number(existingAccount.id), payload.roleMatrix);
    } else {
      ensureRequired(payload.password, "Password wajib diisi karena akun pegawai belum tersedia");

      const [accountResult] = await connection.query<ResultSetHeader>(
        `INSERT INTO akun_pengguna (pegawai_id, username, hash_password, peran, aktif, wajib_ganti_password)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          id,
          payload.username,
          await hashPassword(payload.password || DEFAULT_INITIAL_PASSWORD),
          "pegawai",
          payload.activeStatus === "aktif" ? 1 : 0,
          1
        ]
      );

      await syncAccountRoleMatrix(connection, Number(accountResult.insertId), payload.roleMatrix);
    }

    await connection.commit();

    if ((payload.removeProfilePhoto || uploadedPhotoPath) && existingEmployee.profilePhotoPath) {
      deleteUploadedFile(existingEmployee.profilePhotoPath);
    }

    return sendSuccess(res, { profilePhotoPath: nextProfilePhotoPath }, "Data pegawai berhasil diperbarui");
  } catch (error: any) {
    await connection.rollback();
    deleteUploadedFile(uploadedPhotoPath);

    if (error?.code === "ER_DUP_ENTRY") {
      const message = String(error?.sqlMessage || "").includes("username")
        ? "Username sudah digunakan"
        : "NIP sudah digunakan";
      fail(message, 400);
    }

    if (error?.code === "ER_BAD_FIELD_ERROR") {
      fail(
        "Struktur tabel pegawai belum sesuai. Jalankan migrasi biodata pegawai terlebih dahulu.",
        500
      );
    }

    if (error?.code === "ER_NO_SUCH_TABLE") {
      fail(
        "Tabel jabatan atau akun belum tersedia. Jalankan patch_add_jabatan.sql dan patch_add_akun_pengguna.sql terlebih dahulu.",
        500
      );
    }

    throw error;
  } finally {
    connection.release();
  }
});

export const deleteEmployee = asyncHandler(async (req, res) => {
  const id = readPositiveId(req.params.id, "ID pegawai");

  const [rows] = await pool.query<any[]>(
    `SELECT path_foto_profil AS profilePhotoPath
     FROM pegawai
     WHERE id = ?
     LIMIT 1`,
    [id]
  );

  await pool.query("DELETE FROM evaluasi_kinerja WHERE pegawai_id = ?", [id]);
  await pool.query("DELETE FROM pegawai WHERE id = ?", [id]);

  deleteUploadedFile(rows[0]?.profilePhotoPath || null);

  return sendSuccess(res, null, "Pegawai berhasil dihapus");
});


const ensureSafeIdentifier = (value: string, label: string) => {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    fail(`${label} tidak valid`, 400);
  }

  return value;
};

export const getDynamicDatabaseTables = asyncHandler(async (_req, res) => {
  const [rows] = await pool.query<any[]>(
    `SELECT
        TABLE_NAME AS tableName,
        TABLE_ROWS AS estimatedRows,
        CREATE_TIME AS createdAt,
        UPDATE_TIME AS updatedAt
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME ASC`
  );

  return sendSuccess(res, rows.map((row) => ({
    tableName: String(row.tableName || ""),
    estimatedRows: Number(row.estimatedRows || 0),
    createdAt: row.createdAt ? String(row.createdAt) : null,
    updatedAt: row.updatedAt ? String(row.updatedAt) : null
  })));
});

export const getDynamicDatabaseTableData = asyncHandler(async (req, res) => {
  const rawTableName = readTrimmedString(req.params.tableName);
  const tableName = ensureSafeIdentifier(rawTableName, "Nama tabel");
  const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
  const limit = Math.min(100, Math.max(10, Number.parseInt(String(req.query.limit || "25"), 10) || 25));
  const offset = (page - 1) * limit;
  const search = readTrimmedString(req.query.search);
  const requestedSortBy = readTrimmedString(req.query.sortBy);
  const sortDirection = readTrimmedString(req.query.sortDirection).toLowerCase() === "desc" ? "DESC" : "ASC";

  const [tableRows] = await pool.query<any[]>(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_TYPE = 'BASE TABLE'
       AND TABLE_NAME = ?
     LIMIT 1`,
    [tableName]
  );

  if (!tableRows.length) {
    fail("Tabel tidak ditemukan", 404);
  }

  const [columnRows] = await pool.query<any[]>(
    `SELECT
        COLUMN_NAME AS columnName,
        DATA_TYPE AS dataType,
        COLUMN_TYPE AS columnType,
        IS_NULLABLE AS isNullable,
        COLUMN_KEY AS columnKey,
        ORDINAL_POSITION AS ordinalPosition
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION ASC`,
    [tableName]
  );

  const columns = columnRows.map((row) => ({
    columnName: String(row.columnName || ""),
    dataType: String(row.dataType || ""),
    columnType: String(row.columnType || ""),
    isNullable: String(row.isNullable || "") === "YES",
    columnKey: String(row.columnKey || ""),
    ordinalPosition: Number(row.ordinalPosition || 0)
  }));

  const allowedColumns = new Set(columns.map((column) => column.columnName));
  const searchableColumns = columns
    .filter((column) => [
      "char",
      "varchar",
      "text",
      "tinytext",
      "mediumtext",
      "longtext",
      "enum",
      "set",
      "date",
      "datetime",
      "timestamp",
      "time",
      "year",
      "int",
      "bigint",
      "smallint",
      "mediumint",
      "tinyint",
      "decimal",
      "float",
      "double"
    ].includes(column.dataType))
    .map((column) => column.columnName);

  const whereParts: string[] = [];
  const whereParams: any[] = [];

  if (search && searchableColumns.length) {
    whereParts.push(`(${searchableColumns.map((columnName) => `CAST(\`${columnName}\` AS CHAR) LIKE ?`).join(" OR ")})`);
    searchableColumns.forEach(() => whereParams.push(`%${search}%`));
  }

  const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
  const primaryColumn = columns.find((column) => column.columnKey === "PRI")?.columnName;
  const sortBy = requestedSortBy && allowedColumns.has(requestedSortBy)
    ? requestedSortBy
    : primaryColumn || columns[0]?.columnName || "";
  const orderSql = sortBy ? `ORDER BY \`${sortBy}\` ${sortDirection}` : "";

  const [[countRow]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total FROM \`${tableName}\` ${whereSql}`,
    whereParams
  );

  const [rows] = await pool.query<any[]>(
    `SELECT * FROM \`${tableName}\` ${whereSql} ${orderSql} LIMIT ? OFFSET ?`,
    [...whereParams, limit, offset]
  );

  return sendSuccess(res, {
    tableName,
    columns,
    rows,
    pagination: {
      page,
      limit,
      totalRows: Number(countRow?.total || 0),
      totalPages: Math.max(1, Math.ceil(Number(countRow?.total || 0) / limit))
    },
    search,
    sortBy,
    sortDirection: sortDirection.toLowerCase()
  });
});


const EMPLOYEE_DYNAMIC_RECAP_VARIABLES: Record<string, { label: string; expression: string }> = {
  gender: {
    label: "Jenis Kelamin",
    expression: "COALESCE(NULLIF(TRIM(p.jenis_kelamin), ''), 'Tidak Terisi')"
  },
  position: {
    label: "Jabatan",
    expression: "COALESCE(NULLIF(TRIM(COALESCE(j.nama, p.nama_jabatan)), ''), 'Tidak Terisi')"
  },
  education: {
    label: "Pendidikan Terakhir",
    expression: "COALESCE(NULLIF(TRIM(p.pendidikan_terakhir), ''), 'Tidak Terisi')"
  },
  employmentStatus: {
    label: "Status Kepegawaian",
    expression: "COALESCE(NULLIF(TRIM(p.status_kepegawaian), ''), 'Tidak Terisi')"
  },
  activeStatus: {
    label: "Status Aktif",
    expression: "COALESCE(NULLIF(TRIM(p.status_aktif), ''), 'Tidak Terisi')"
  },
  rankGroup: {
    label: "Pangkat/Golongan",
    expression: "COALESCE(NULLIF(TRIM(p.pangkat_golongan), ''), 'Tidak Terisi')"
  },
  birthDecade: {
    label: "Dekade Kelahiran",
    expression: "CASE WHEN p.tanggal_lahir IS NULL THEN 'Tidak Terisi' ELSE CONCAT(FLOOR(YEAR(p.tanggal_lahir) / 10) * 10, '-an') END"
  },
  generationName: {
    label: "Nama Generasi Umur",
    expression: "CASE WHEN p.tanggal_lahir IS NULL THEN 'Tidak Terisi' WHEN YEAR(p.tanggal_lahir) BETWEEN 1946 AND 1964 THEN 'Baby Boomers' WHEN YEAR(p.tanggal_lahir) BETWEEN 1965 AND 1980 THEN 'Generasi X' WHEN YEAR(p.tanggal_lahir) BETWEEN 1981 AND 1996 THEN 'Milenial / Generasi Y' WHEN YEAR(p.tanggal_lahir) BETWEEN 1997 AND 2012 THEN 'Generasi Z' WHEN YEAR(p.tanggal_lahir) BETWEEN 2013 AND 2024 THEN 'Generasi Alpha' WHEN YEAR(p.tanggal_lahir) >= 2025 THEN 'Generasi Beta' ELSE 'Sebelum Baby Boomers' END"
  },
  ageGroup: {
    label: "Kelompok Umur",
    expression: "CASE WHEN p.tanggal_lahir IS NULL THEN 'Tidak Terisi' WHEN TIMESTAMPDIFF(YEAR, p.tanggal_lahir, CURDATE()) < 17 THEN '<17' WHEN TIMESTAMPDIFF(YEAR, p.tanggal_lahir, CURDATE()) BETWEEN 17 AND 24 THEN '17-24' WHEN TIMESTAMPDIFF(YEAR, p.tanggal_lahir, CURDATE()) BETWEEN 25 AND 31 THEN '25-31' WHEN TIMESTAMPDIFF(YEAR, p.tanggal_lahir, CURDATE()) BETWEEN 32 AND 38 THEN '32-38' ELSE '>38' END"
  },
  joinYear: {
    label: "Tahun Masuk",
    expression: "CASE WHEN p.tanggal_masuk IS NULL THEN 'Tidak Terisi' ELSE CAST(YEAR(p.tanggal_masuk) AS CHAR) END"
  }
};

const normalizeDynamicRecapVariable = (value: unknown, fallback: string) => {
  const key = readTrimmedString(value) || fallback;

  if (!EMPLOYEE_DYNAMIC_RECAP_VARIABLES[key]) {
    fail("Variabel rekap tidak valid", 400);
  }

  return key;
};

export const getEmployeeDynamicRecapVariables = asyncHandler(async (_req, res) => {
  return sendSuccess(res, Object.entries(EMPLOYEE_DYNAMIC_RECAP_VARIABLES).map(([key, value]) => ({
    key,
    label: value.label
  })));
});

export const getEmployeeDynamicRecap = asyncHandler(async (req, res) => {
  const xKey = normalizeDynamicRecapVariable(req.query.x, "position");
  const yKey = normalizeDynamicRecapVariable(req.query.y, "gender");
  const search = readTrimmedString(req.query.search);
  const activeOnly = req.query.activeOnly === undefined ? true : String(req.query.activeOnly) !== "false";

  const xVariable = EMPLOYEE_DYNAMIC_RECAP_VARIABLES[xKey];
  const yVariable = EMPLOYEE_DYNAMIC_RECAP_VARIABLES[yKey];

  const whereParts: string[] = ["1 = 1"];
  const params: any[] = [];

  if (activeOnly) {
    whereParts.push("p.status_aktif = 'aktif'");
  }

  if (search) {
    whereParts.push(`(
      p.nama_lengkap LIKE ?
      OR p.nip LIKE ?
      OR COALESCE(j.nama, p.nama_jabatan, '') LIKE ?
      OR COALESCE(p.jenis_kelamin, '') LIKE ?
      OR COALESCE(p.pendidikan_terakhir, '') LIKE ?
      OR COALESCE(p.pangkat_golongan, '') LIKE ?
      OR COALESCE(p.status_kepegawaian, '') LIKE ?
      OR COALESCE(p.status_aktif, '') LIKE ?
    )`);
    for (let i = 0; i < 8; i += 1) {
      params.push(`%${search}%`);
    }
  }

  const [rows] = await pool.query<any[]>(
    `SELECT
        ${xVariable.expression} AS xValue,
        ${yVariable.expression} AS yValue,
        COUNT(*) AS total
     FROM pegawai p
     LEFT JOIN jabatan j ON j.id = p.jabatan_id
     WHERE ${whereParts.join(" AND ")}
     GROUP BY xValue, yValue
     ORDER BY xValue ASC, yValue ASC`,
    params
  );

  const [xRows] = await pool.query<any[]>(
    `SELECT ${xVariable.expression} AS value, COUNT(*) AS total
     FROM pegawai p
     LEFT JOIN jabatan j ON j.id = p.jabatan_id
     WHERE ${whereParts.join(" AND ")}
     GROUP BY value
     ORDER BY value ASC`,
    params
  );

  const [yRows] = await pool.query<any[]>(
    `SELECT ${yVariable.expression} AS value, COUNT(*) AS total
     FROM pegawai p
     LEFT JOIN jabatan j ON j.id = p.jabatan_id
     WHERE ${whereParts.join(" AND ")}
     GROUP BY value
     ORDER BY value ASC`,
    params
  );

  const [[summary]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS totalEmployees
     FROM pegawai p
     LEFT JOIN jabatan j ON j.id = p.jabatan_id
     WHERE ${whereParts.join(" AND ")}`,
    params
  );

  const xCategories = xRows.map((row) => String(row.value || "Tidak Terisi"));
  const yCategories = yRows.map((row) => String(row.value || "Tidak Terisi"));
  const matrixMap = new Map<string, number>();

  rows.forEach((row) => {
    const xValue = String(row.xValue || "Tidak Terisi");
    const yValue = String(row.yValue || "Tidak Terisi");
    matrixMap.set(`${xValue}|||${yValue}`, Number(row.total || 0));
  });

  const matrixRows = xCategories.map((xValue) => {
    const values: Record<string, number> = {};
    let rowTotal = 0;

    yCategories.forEach((yValue) => {
      const total = matrixMap.get(`${xValue}|||${yValue}`) || 0;
      values[yValue] = total;
      rowTotal += total;
    });

    return {
      xValue,
      values,
      rowTotal
    };
  });

  const columnTotals: Record<string, number> = {};
  yCategories.forEach((yValue) => {
    columnTotals[yValue] = matrixRows.reduce((sum, row) => sum + (row.values[yValue] || 0), 0);
  });

  return sendSuccess(res, {
    variables: Object.entries(EMPLOYEE_DYNAMIC_RECAP_VARIABLES).map(([key, value]) => ({
      key,
      label: value.label
    })),
    selected: {
      x: { key: xKey, label: xVariable.label },
      y: { key: yKey, label: yVariable.label }
    },
    summary: {
      totalEmployees: Number(summary?.totalEmployees || 0),
      totalXCategories: xCategories.length,
      totalYCategories: yCategories.length,
      activeOnly
    },
    xCategories,
    yCategories,
    rows: matrixRows,
    columnTotals,
    search
  });
});

const dashboardLeadershipRoles = new Set([
  "super_admin",
  "admin_satker",
  "kepala_satker",
  "kasubbag_umum",
  "pejabat_penilai",
  "reviewer"
]);

const readDateParam = (value: unknown, fallback: string) => {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const normalized = readTrimmedString(rawValue);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : fallback;
};

const readOptionalParam = (value: unknown) => {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return readTrimmedString(rawValue);
};

const readOptionalNumberParam = (value: unknown) => {
  const rawValue = Array.isArray(value) ? value[0] : value;
  if (rawValue === undefined || rawValue === null || rawValue === "") return null;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const toSqlDate = (date = new Date()) => date.toISOString().slice(0, 10);

const normalizeActivityStatus = (status: unknown) => {
  const value = String(status || "").toLowerCase();
  if (value === "dijeda") return "jeda";
  if (["berjalan", "jeda", "selesai"].includes(value)) return value;
  return "belum_mulai";
};

const normalizeTextValue = (value: unknown, fallback = "-") => {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
};

const getTableColumnSet = async (tableName: string) => {
  const [rows] = await pool.query<any[]>(
    `SELECT COLUMN_NAME AS columnName
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?`,
    [tableName]
  );

  return new Set(rows.map((row) => String(row.columnName)));
};

const buildActivityStatusSql = (alias: string, columns: Set<string>) => {
  const baseStatus = `CASE
    WHEN ${alias}.status = 'dijeda' THEN 'jeda'
    WHEN ${alias}.status IN ('berjalan', 'jeda', 'selesai') THEN ${alias}.status
    ELSE 'belum_mulai'
  END`;

  if (columns.has("status_aktivitas")) {
    return `COALESCE(NULLIF(${alias}.status_aktivitas, ''), ${baseStatus})`;
  }

  return baseStatus;
};

const buildActivityDurationSql = (alias: string, statusSql: string, columns: Set<string>) => {
  if (columns.has("started_at")) {
    const pausedSeconds = columns.has("total_paused_seconds")
      ? `COALESCE(${alias}.total_paused_seconds, 0)`
      : "0";
    const pausedAt = columns.has("paused_at") ? `${alias}.paused_at` : "NULL";
    const finishedAt = columns.has("finished_at") ? `${alias}.finished_at` : "NULL";

    return `GREATEST(0, CASE
      WHEN ${statusSql} = 'berjalan' AND ${alias}.started_at IS NOT NULL
        THEN TIMESTAMPDIFF(SECOND, ${alias}.started_at, NOW()) - ${pausedSeconds}
      WHEN ${statusSql} = 'jeda' AND ${alias}.started_at IS NOT NULL AND ${pausedAt} IS NOT NULL
        THEN TIMESTAMPDIFF(SECOND, ${alias}.started_at, ${pausedAt}) - ${pausedSeconds}
      WHEN ${statusSql} = 'selesai' AND ${alias}.started_at IS NOT NULL AND ${finishedAt} IS NOT NULL
        THEN TIMESTAMPDIFF(SECOND, ${alias}.started_at, ${finishedAt}) - ${pausedSeconds}
      ELSE COALESCE(${alias}.durasi_menit, 0) * 60
    END)`;
  }

  return `GREATEST(0, COALESCE(${alias}.durasi_menit, 0) * 60)`;
};

const buildPausedDurationSql = (alias: string, columns: Set<string>) => {
  if (columns.has("total_paused_seconds")) {
    return `GREATEST(0, COALESCE(${alias}.total_paused_seconds, 0))`;
  }

  return "0";
};

const buildJobTypeSql = (positionExpression: string) => `CASE
  WHEN LOWER(${positionExpression}) LIKE '%kepala bps%' THEN 'Kepala BPS'
  WHEN LOWER(${positionExpression}) LIKE '%kasubbag%' OR LOWER(${positionExpression}) LIKE '%subbagian umum%' THEN 'Kasubbag Umum'
  WHEN LOWER(${positionExpression}) LIKE '%ketua tim%' OR LOWER(${positionExpression}) LIKE '%koordinator%' THEN 'Ketua Tim'
  WHEN LOWER(${positionExpression}) LIKE '%statistisi%' OR LOWER(${positionExpression}) LIKE '%pranata komputer%' OR LOWER(${positionExpression}) LIKE '%fungsional%' THEN 'Jabatan Fungsional'
  WHEN LOWER(${positionExpression}) LIKE '%mitra%' THEN 'Mitra Statistik'
  ELSE 'Pelaksana/Staf'
END`;

const buildAccessFilter = (role: string | undefined, employeeId: number | undefined, params: any[]) => {
  if (!employeeId) {
    return "1 = 0";
  }

  if (role === "pegawai") {
    params.push(employeeId);
    return "p.id = ?";
  }

  if (role === "ketua_tim") {
    params.push(employeeId, employeeId, employeeId);
    return `(
      p.id = ?
      OR EXISTS (
        SELECT 1
        FROM kinerja_tim_anggota access_m
        INNER JOIN kinerja_tim_kerja access_t ON access_t.id = access_m.tim_kerja_id
        WHERE access_m.pegawai_id = p.id
          AND access_t.status = 'aktif'
          AND (
            access_t.ketua_pegawai_id = ?
            OR access_t.id IN (
              SELECT own_m.tim_kerja_id
              FROM kinerja_tim_anggota own_m
              WHERE own_m.pegawai_id = ?
                AND LOWER(COALESCE(own_m.peran, '')) LIKE '%ketua%'
            )
          )
      )
    )`;
  }

  if (role && dashboardLeadershipRoles.has(role)) {
    return "1 = 1";
  }

  params.push(employeeId);
  return "p.id = ?";
};

const getConditionBadge = (row: Record<string, any>) => {
  const status = normalizeActivityStatus(row.activityStatus);
  const activeAssignments = Number(row.activeAssignments || 0);
  const overdueAssignments = Number(row.overdueAssignments || 0);
  const isOverdueActivity = Boolean(row.isOverdueActivity);
  const nearestDeadline = row.nearestDeadline ? String(row.nearestDeadline) : "";
  const today = toSqlDate();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowText = toSqlDate(tomorrow);

  if (overdueAssignments > 0 || isOverdueActivity) return "Terlambat";
  if (activeAssignments > 5) return "Beban Tinggi";
  if (nearestDeadline === today || nearestDeadline === tomorrowText) return "Mendekati Deadline";
  if (status === "berjalan") return "Sedang Bekerja";
  if (status === "jeda") return "Jeda";
  if (Number(row.totalActivitiesToday || 0) === 0) return "Belum Mulai";
  return "Normal";
};

export const getEmployeeConditionDashboard = asyncHandler(async (req, res) => {
  const user = (req as any).user;
  const query = req.query as Record<string, unknown>;
  const today = toSqlDate();
  const startDate = readDateParam(query.startDate || query.date, today);
  const endDate = readDateParam(query.endDate || query.date, startDate);
  const position = readOptionalParam(query.position || query.jabatan);
  const jobType = readOptionalParam(query.jobType || query.jenisJabatan);
  const rawActivityStatus = readOptionalParam(query.activityStatus);
  const activityStatus = rawActivityStatus ? normalizeActivityStatus(rawActivityStatus) : "";
  const assignmentStatus = readOptionalParam(query.assignmentStatus || query.statusPenugasan);
  const conditionFilter = readOptionalParam(query.condition || query.kondisiPegawai);
  const deadlineFilter = readOptionalParam(query.deadline);
  const activityType = readOptionalParam(query.activityType || query.jenisKegiatan);
  const keyword = readOptionalParam(query.keyword || query.search);
  const teamId = readOptionalNumberParam(query.teamId || query.timKerjaId);
  const leaderId = readOptionalNumberParam(query.leaderId || query.ketuaTimId);
  const selectedEmployeeId = readOptionalNumberParam(query.employeeId || query.pegawaiId);
  const limit = Math.min(Math.max(Number(query.limit || 80), 10), 150);

  const logbookColumns = await getTableColumnSet("kinerja_logbook");
  const statusSql = buildActivityStatusSql("cur", logbookColumns);
  const durationSql = buildActivityDurationSql("cur", statusSql, logbookColumns);
  const pausedSql = buildPausedDurationSql("l", logbookColumns);
  const logStatusSql = buildActivityStatusSql("l", logbookColumns);
  const logDurationSql = buildActivityDurationSql("l", logStatusSql, logbookColumns);
  const curPausedSql = buildPausedDurationSql("cur", logbookColumns);
  const positionExpression = "COALESCE(j.nama, p.nama_jabatan, '')";
  const jobTypeSql = buildJobTypeSql(positionExpression);

  const whereParams: any[] = [];
  const whereClauses = ["p.status_aktif = 'aktif'", buildAccessFilter(user?.role, user?.employeeId, whereParams)];

  if (position) {
    whereClauses.push(`${positionExpression} LIKE ?`);
    whereParams.push(`%${position}%`);
  }

  if (jobType) {
    whereClauses.push(`${jobTypeSql} = ?`);
    whereParams.push(jobType);
  }

  if (teamId) {
    whereClauses.push(`EXISTS (
      SELECT 1 FROM kinerja_tim_anggota filter_m
      WHERE filter_m.pegawai_id = p.id AND filter_m.tim_kerja_id = ?
    )`);
    whereParams.push(teamId);
  }

  if (leaderId) {
    whereClauses.push(`EXISTS (
      SELECT 1
      FROM kinerja_tim_anggota filter_lm
      INNER JOIN kinerja_tim_kerja filter_lt ON filter_lt.id = filter_lm.tim_kerja_id
      WHERE filter_lm.pegawai_id = p.id AND filter_lt.ketua_pegawai_id = ?
    )`);
    whereParams.push(leaderId);
  }

  if (selectedEmployeeId) {
    whereClauses.push("p.id = ?");
    whereParams.push(selectedEmployeeId);
  }

  if (["berjalan", "jeda", "selesai"].includes(activityStatus)) {
    whereClauses.push(`${statusSql} = ?`);
    whereParams.push(activityStatus);
  } else if (activityStatus === "belum_mulai") {
    whereClauses.push(`(cur.id IS NULL OR ${statusSql} = 'belum_mulai')`);
  }

  if (assignmentStatus) {
    whereClauses.push(`EXISTS (
      SELECT 1 FROM kinerja_assignment filter_a
      WHERE filter_a.pegawai_id = p.id AND filter_a.status = ?
    )`);
    whereParams.push(assignmentStatus);
  }

  if (activityType) {
    whereClauses.push(`EXISTS (
      SELECT 1 FROM kinerja_assignment filter_type_a
      WHERE filter_type_a.pegawai_id = p.id AND filter_type_a.jenis_penugasan = ?
    )`);
    whereParams.push(activityType);
  }

  if (deadlineFilter === "hari_ini") {
    whereClauses.push(`EXISTS (
      SELECT 1 FROM kinerja_assignment deadline_a
      WHERE deadline_a.pegawai_id = p.id
        AND deadline_a.status <> 'selesai'
        AND deadline_a.target_selesai = CURDATE()
    )`);
  } else if (deadlineFilter === "besok") {
    whereClauses.push(`EXISTS (
      SELECT 1 FROM kinerja_assignment deadline_a
      WHERE deadline_a.pegawai_id = p.id
        AND deadline_a.status <> 'selesai'
        AND deadline_a.target_selesai = DATE_ADD(CURDATE(), INTERVAL 1 DAY)
    )`);
  } else if (deadlineFilter === "terlambat") {
    whereClauses.push(`EXISTS (
      SELECT 1 FROM kinerja_assignment deadline_a
      WHERE deadline_a.pegawai_id = p.id
        AND deadline_a.status <> 'selesai'
        AND deadline_a.target_selesai < CURDATE()
    )`);
  }

  if (keyword) {
    whereClauses.push(`(
      p.nama_lengkap LIKE ?
      OR p.nip LIKE ?
      OR COALESCE(cur.uraian_kegiatan, '') LIKE ?
      OR EXISTS (
        SELECT 1 FROM kinerja_assignment keyword_a
        WHERE keyword_a.pegawai_id = p.id AND keyword_a.judul LIKE ?
      )
    )`);
    whereParams.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }

  const accessTeamParams: any[] = [];
  let teamAccessClause = "1 = 1";
  if (user?.role === "pegawai") {
    teamAccessClause = "0 = 1";
  } else if (user?.role === "ketua_tim") {
    teamAccessClause = `(t.ketua_pegawai_id = ? OR EXISTS (
      SELECT 1 FROM kinerja_tim_anggota own_tm
      WHERE own_tm.tim_kerja_id = t.id
        AND own_tm.pegawai_id = ?
        AND LOWER(COALESCE(own_tm.peran, '')) LIKE '%ketua%'
    ))`;
    accessTeamParams.push(user.employeeId, user.employeeId);
  }

  const [employeeRows] = await pool.query<any[]>(
    `SELECT p.id,
            p.nip,
            p.nama_lengkap AS fullName,
            ${positionExpression} AS positionName,
            ${jobTypeSql} AS jobType,
            COALESCE(d.nama, '-') AS departmentName,
            COALESCE(team_info.teamIds, '') AS teamIds,
            COALESCE(team_info.teamNames, '-') AS teamName,
            COALESCE(team_info.teamRoles, '-') AS teamRole,
            COALESCE(team_info.leaderNames, '-') AS leaderName,
            cur.id AS currentActivityId,
            COALESCE(cur.uraian_kegiatan, '') AS currentActivity,
            COALESCE(assign_cur.judul, '') AS currentAssignment,
            DATE_FORMAT(cur.tanggal_kegiatan, '%Y-%m-%d') AS activityDate,
            ${statusSql} AS activityStatus,
            ${durationSql} AS durationSeconds,
            ${curPausedSql} AS pausedSeconds,
            DATE_FORMAT(cur.diperbarui_pada, '%Y-%m-%d %H:%i:%s') AS lastActivityAt,
            DATE_FORMAT(assign_cur.target_selesai, '%Y-%m-%d') AS currentAssignmentDeadline,
            CASE
              WHEN ${statusSql} IN ('berjalan', 'jeda') AND assign_cur.target_selesai IS NOT NULL AND assign_cur.target_selesai < CURDATE()
                THEN 1
              ELSE 0
            END AS isOverdueActivity,
            COALESCE(assign_stats.activeAssignments, 0) AS activeAssignments,
            COALESCE(assign_stats.finishedAssignments, 0) AS finishedAssignments,
            COALESCE(assign_stats.overdueAssignments, 0) AS overdueAssignments,
            DATE_FORMAT(assign_stats.nearestDeadline, '%Y-%m-%d') AS nearestDeadline,
            COALESCE(log_stats.totalActivitiesToday, 0) AS totalActivitiesToday,
            COALESCE(log_stats.runningCount, 0) AS runningCount,
            COALESCE(log_stats.pausedCount, 0) AS pausedCount,
            COALESCE(log_stats.finishedCount, 0) AS finishedCount,
            COALESCE(log_stats.totalActiveDurationSeconds, 0) AS totalActiveDurationSeconds,
            COALESCE(log_stats.totalPausedSeconds, 0) AS totalPausedSeconds,
            COALESCE(recent.recentActivities, '') AS recentActivitiesText
     FROM pegawai p
     LEFT JOIN jabatan j ON j.id = p.jabatan_id
     LEFT JOIN departemen d ON d.id = p.departemen_id
     LEFT JOIN (
       SELECT m.pegawai_id,
              GROUP_CONCAT(DISTINCT t.id ORDER BY t.nama_tim SEPARATOR ',') AS teamIds,
              GROUP_CONCAT(DISTINCT t.nama_tim ORDER BY t.nama_tim SEPARATOR ', ') AS teamNames,
              GROUP_CONCAT(DISTINCT COALESCE(m.peran, '-') ORDER BY COALESCE(m.peran, '-') SEPARATOR ', ') AS teamRoles,
              GROUP_CONCAT(DISTINCT COALESCE(k.nama_lengkap, '-') ORDER BY COALESCE(k.nama_lengkap, '-') SEPARATOR ', ') AS leaderNames
       FROM kinerja_tim_anggota m
       INNER JOIN kinerja_tim_kerja t ON t.id = m.tim_kerja_id AND t.status = 'aktif'
       LEFT JOIN pegawai k ON k.id = t.ketua_pegawai_id
       GROUP BY m.pegawai_id
     ) team_info ON team_info.pegawai_id = p.id
     LEFT JOIN (
       SELECT l.*
       FROM kinerja_logbook l
       INNER JOIN (
         SELECT pegawai_id, MAX(id) AS latestId
         FROM kinerja_logbook
         WHERE tanggal_kegiatan BETWEEN ? AND ?
         GROUP BY pegawai_id
       ) latest ON latest.latestId = l.id
     ) cur ON cur.pegawai_id = p.id
     LEFT JOIN kinerja_assignment assign_cur ON assign_cur.id = cur.assignment_id
     LEFT JOIN (
       SELECT pegawai_id,
              SUM(CASE WHEN status <> 'selesai' THEN 1 ELSE 0 END) AS activeAssignments,
              SUM(CASE WHEN status = 'selesai' THEN 1 ELSE 0 END) AS finishedAssignments,
              SUM(CASE WHEN status <> 'selesai' AND target_selesai < CURDATE() THEN 1 ELSE 0 END) AS overdueAssignments,
              MIN(CASE WHEN status <> 'selesai' THEN target_selesai ELSE NULL END) AS nearestDeadline
       FROM kinerja_assignment
       GROUP BY pegawai_id
     ) assign_stats ON assign_stats.pegawai_id = p.id
     LEFT JOIN (
       SELECT l.pegawai_id,
              COUNT(*) AS totalActivitiesToday,
              SUM(CASE WHEN ${logStatusSql} = 'berjalan' THEN 1 ELSE 0 END) AS runningCount,
              SUM(CASE WHEN ${logStatusSql} = 'jeda' THEN 1 ELSE 0 END) AS pausedCount,
              SUM(CASE WHEN ${logStatusSql} = 'selesai' THEN 1 ELSE 0 END) AS finishedCount,
              SUM(${logDurationSql}) AS totalActiveDurationSeconds,
              SUM(${pausedSql}) AS totalPausedSeconds
       FROM kinerja_logbook l
       WHERE l.tanggal_kegiatan BETWEEN ? AND ?
       GROUP BY l.pegawai_id
     ) log_stats ON log_stats.pegawai_id = p.id
     LEFT JOIN (
       SELECT rr.pegawai_id,
              GROUP_CONCAT(CONCAT(DATE_FORMAT(rr.tanggal_kegiatan, '%d/%m %H:%i'), ' — ', LEFT(rr.uraian_kegiatan, 80)) ORDER BY rr.diperbarui_pada DESC SEPARATOR '||') AS recentActivities
       FROM (
         SELECT l.*
         FROM kinerja_logbook l
         WHERE l.tanggal_kegiatan BETWEEN ? AND ?
         ORDER BY l.diperbarui_pada DESC
         LIMIT 250
       ) rr
       GROUP BY rr.pegawai_id
     ) recent ON recent.pegawai_id = p.id
     WHERE ${whereClauses.join(" AND ")}
     ORDER BY isOverdueActivity DESC, overdueAssignments DESC, activeAssignments DESC, p.nama_lengkap ASC
     LIMIT ?`,
    [startDate, endDate, startDate, endDate, startDate, endDate, ...whereParams, limit]
  );

  const rowsWithCondition = employeeRows.map((row) => ({
    id: Number(row.id),
    nip: normalizeTextValue(row.nip),
    fullName: normalizeTextValue(row.fullName),
    positionName: normalizeTextValue(row.positionName),
    jobType: normalizeTextValue(row.jobType),
    departmentName: normalizeTextValue(row.departmentName),
    teamIds: String(row.teamIds || "").split(",").filter(Boolean).map((id) => Number(id)),
    teamName: normalizeTextValue(row.teamName),
    teamRole: normalizeTextValue(row.teamRole),
    leaderName: normalizeTextValue(row.leaderName),
    currentActivityId: row.currentActivityId ? Number(row.currentActivityId) : null,
    currentActivity: normalizeTextValue(row.currentActivity, "Belum ada aktivitas hari ini"),
    currentAssignment: normalizeTextValue(row.currentAssignment, "-"),
    currentAssignmentDeadline: row.currentAssignmentDeadline || null,
    activityDate: row.activityDate || null,
    activityStatus: normalizeActivityStatus(row.activityStatus),
    durationSeconds: Number(row.durationSeconds || 0),
    pausedSeconds: Number(row.pausedSeconds || 0),
    lastActivityAt: row.lastActivityAt || null,
    isOverdueActivity: Boolean(row.isOverdueActivity),
    activeAssignments: Number(row.activeAssignments || 0),
    finishedAssignments: Number(row.finishedAssignments || 0),
    overdueAssignments: Number(row.overdueAssignments || 0),
    nearestDeadline: row.nearestDeadline || null,
    totalActivitiesToday: Number(row.totalActivitiesToday || 0),
    runningCount: Number(row.runningCount || 0),
    pausedCount: Number(row.pausedCount || 0),
    finishedCount: Number(row.finishedCount || 0),
    totalActiveDurationSeconds: Number(row.totalActiveDurationSeconds || 0),
    totalPausedSeconds: Number(row.totalPausedSeconds || 0),
    recentActivities: String(row.recentActivitiesText || "")
      .split("||")
      .filter(Boolean)
      .slice(0, 5),
    condition: getConditionBadge(row),
    workload: Number(row.activeAssignments || 0) > 5 ? "Beban Tinggi" : Number(row.activeAssignments || 0) >= 3 ? "Sedang" : "Normal"
  }));

  const filteredEmployees = conditionFilter
    ? rowsWithCondition.filter((row) => row.condition === conditionFilter)
    : rowsWithCondition;

  const [teamRows] = await pool.query<any[]>(
    `SELECT t.id,
            t.nama_tim AS teamName,
            COALESCE(k.nama_lengkap, '-') AS leaderName,
            COUNT(DISTINCT m.pegawai_id) AS memberCount,
            COUNT(DISTINCT CASE WHEN log_now.activityStatus = 'berjalan' THEN log_now.logId ELSE NULL END) AS runningActivities,
            COUNT(DISTINCT CASE WHEN log_now.activityStatus = 'jeda' THEN log_now.logId ELSE NULL END) AS pausedActivities,
            COUNT(DISTINCT CASE WHEN a.status <> 'selesai' THEN a.id END) AS activeAssignments,
            COUNT(DISTINCT CASE WHEN a.status <> 'selesai' AND a.target_selesai < CURDATE() THEN a.id END) AS overdueAssignments,
            DATE_FORMAT(MIN(CASE WHEN a.status <> 'selesai' THEN a.target_selesai ELSE NULL END), '%Y-%m-%d') AS nearestDeadline
     FROM kinerja_tim_kerja t
     LEFT JOIN pegawai k ON k.id = t.ketua_pegawai_id
     LEFT JOIN kinerja_tim_anggota m ON m.tim_kerja_id = t.id
     LEFT JOIN kinerja_assignment a ON a.tim_kerja_id = t.id
     LEFT JOIN (
       SELECT l.id AS logId, l.tim_kerja_id, ${logStatusSql} AS activityStatus
       FROM kinerja_logbook l
       WHERE l.tanggal_kegiatan BETWEEN ? AND ?
     ) log_now ON log_now.tim_kerja_id = t.id
     WHERE t.status = 'aktif' AND ${teamAccessClause}
     GROUP BY t.id, t.nama_tim, k.nama_lengkap
     ORDER BY overdueAssignments DESC, activeAssignments DESC, t.nama_tim ASC
     LIMIT 30`,
    [startDate, endDate, ...accessTeamParams]
  );

  const teams = teamRows.map((team) => {
    const overdueAssignments = Number(team.overdueAssignments || 0);
    const activeAssignments = Number(team.activeAssignments || 0);
    const pausedActivities = Number(team.pausedActivities || 0);
    const condition = overdueAssignments > 0
      ? "Terlambat"
      : activeAssignments > 10
        ? "Beban Tinggi"
        : pausedActivities > 0
          ? "Perlu Perhatian"
          : "Normal";

    return {
      id: Number(team.id),
      teamName: normalizeTextValue(team.teamName),
      leaderName: normalizeTextValue(team.leaderName),
      memberCount: Number(team.memberCount || 0),
      runningActivities: Number(team.runningActivities || 0),
      pausedActivities,
      activeAssignments,
      overdueAssignments,
      nearestDeadline: team.nearestDeadline || null,
      condition
    };
  });

  const attentionItems = filteredEmployees
    .filter((row) => ["Terlambat", "Beban Tinggi", "Mendekati Deadline", "Jeda", "Belum Mulai"].includes(row.condition))
    .slice(0, 12)
    .map((row) => ({
      id: row.id,
      type: row.condition,
      title: row.fullName,
      description:
        row.condition === "Terlambat"
          ? "Memiliki aktivitas atau penugasan melewati batas akhir."
          : row.condition === "Beban Tinggi"
            ? `Memiliki ${row.activeAssignments} penugasan aktif.`
            : row.condition === "Mendekati Deadline"
              ? `Deadline terdekat ${row.nearestDeadline || "hari ini/besok"}.`
              : row.condition === "Jeda"
                ? "Aktivitas sedang jeda dan perlu dipantau."
                : "Belum memulai aktivitas pada periode ini.",
      employee: row.fullName,
      teamName: row.teamName
    }));

  const summary = {
    totalEmployees: filteredEmployees.length,
    activeToday: filteredEmployees.filter((row) => row.totalActivitiesToday > 0).length,
    running: filteredEmployees.filter((row) => row.activityStatus === "berjalan").length,
    paused: filteredEmployees.filter((row) => row.activityStatus === "jeda").length,
    notStarted: filteredEmployees.filter((row) => row.condition === "Belum Mulai").length,
    finishedToday: filteredEmployees.reduce((total, row) => total + row.finishedCount, 0),
    overdue: filteredEmployees.filter((row) => row.condition === "Terlambat").length,
    highWorkload: filteredEmployees.filter((row) => row.condition === "Beban Tinggi").length,
    activeTeams: teams.length
  };

  const [filterTeams] = await pool.query<any[]>(
    `SELECT t.id, t.nama_tim AS name, t.ketua_pegawai_id AS leaderId, COALESCE(k.nama_lengkap, '-') AS leaderName
     FROM kinerja_tim_kerja t
     LEFT JOIN pegawai k ON k.id = t.ketua_pegawai_id
     WHERE t.status = 'aktif' AND ${teamAccessClause}
     ORDER BY t.nama_tim ASC`,
    accessTeamParams
  );

  const [filterPositions] = await pool.query<any[]>(
    `SELECT id, nama AS name FROM jabatan ORDER BY nama ASC`
  );

  const employeeFilterAccessParams: any[] = [];
  const employeeFilterAccessClause = buildAccessFilter(user?.role, user?.employeeId, employeeFilterAccessParams);
  const [filterEmployees] = await pool.query<any[]>(
    `SELECT p.id, p.nama_lengkap AS name, p.nip
     FROM pegawai p
     LEFT JOIN jabatan j ON j.id = p.jabatan_id
     WHERE p.status_aktif = 'aktif' AND ${employeeFilterAccessClause}
     ORDER BY p.nama_lengkap ASC
     LIMIT 250`,
    employeeFilterAccessParams
  );

  return sendSuccess(res, {
    period: { startDate, endDate },
    serverNow: new Date().toISOString(),
    summary,
    teams,
    attentionItems,
    employees: filteredEmployees,
    filters: {
      teams: filterTeams.map((team) => ({ id: Number(team.id), name: normalizeTextValue(team.name), leaderId: team.leaderId ? Number(team.leaderId) : null, leaderName: normalizeTextValue(team.leaderName) })),
      positions: filterPositions.map((positionRow) => ({ id: Number(positionRow.id), name: normalizeTextValue(positionRow.name) })),
      employees: filterEmployees.map((employee) => ({ id: Number(employee.id), name: normalizeTextValue(employee.name), nip: normalizeTextValue(employee.nip) })),
      jobTypes: ["Kepala BPS", "Kasubbag Umum", "Ketua Tim", "Anggota Tim", "Jabatan Fungsional", "Pelaksana/Staf", "Mitra Statistik"],
      activityStatuses: ["semua", "berjalan", "jeda", "selesai", "belum_mulai"],
      assignmentStatuses: ["semua", "draft", "berjalan", "selesai", "tertunda"],
      conditions: ["Sedang Bekerja", "Jeda", "Belum Mulai", "Terlambat", "Mendekati Deadline", "Beban Tinggi", "Normal"],
      deadlines: ["semua", "hari_ini", "besok", "terlambat"],
      activityTypes: ["semua", "individu", "tim", "lintas_tim", "lapangan", "pengolahan", "pst"]
    }
  });
});
