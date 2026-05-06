import { ResultSetHeader } from "mysql2/promise";
import { pool } from "../../config/database";
import { AuthenticatedRequest } from "../../middleware/auth.middleware";
import { asyncHandler, fail, sendSuccess } from "../../shared/http";
import {
  ensureOneOf,
  ensureRequired,
  readBoolean,
  readPositiveId,
  readTrimmedString
} from "../../shared/validation";

let automationSchemaReady = false;

const MAPPING_STATUSES = ["aktif", "arsip"] as const;
const MAPPING_SOURCES = ["manual", "sinkron_tim"] as const;
const TARGET_PERIOD_TYPES = ["bulanan", "triwulan", "semester"] as const;

const readOptionalPositiveId = (value: unknown, fieldName: string) => {
  const normalized = readTrimmedString(value);
  if (!normalized) return null;
  return readPositiveId(normalized, fieldName);
};

const ensurePeriodExists = async (periodId: number) => {
  const [rows] = await pool.query<any[]>(`SELECT id FROM kinerja_periode WHERE id = ? LIMIT 1`, [periodId]);
  if (!rows.length) fail("Periode kinerja tidak ditemukan", 404);
};

const ensureEmployeeExists = async (employeeId: number) => {
  const [rows] = await pool.query<any[]>(`SELECT id FROM pegawai WHERE id = ? LIMIT 1`, [employeeId]);
  if (!rows.length) fail("Pegawai tidak ditemukan", 404);
};

const ensureTeamExists = async (teamId: number) => {
  const [rows] = await pool.query<any[]>(`SELECT id FROM kinerja_tim_kerja WHERE id = ? LIMIT 1`, [teamId]);
  if (!rows.length) fail("Tim kerja tidak ditemukan", 404);
};

const ensureMappingExists = async (mappingId: number) => {
  const [rows] = await pool.query<any[]>(`SELECT id FROM kinerja_pemetaan_penilai WHERE id = ? LIMIT 1`, [mappingId]);
  if (!rows.length) fail("Pemetaan penilai tidak ditemukan", 404);
};

const ensureColumnExists = async (tableName: string, columnName: string, definitionSql: string) => {
  const [rows] = await pool.query<any[]>(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );

  if (!rows.length) {
    await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`);
  }
};

const ensureIndexExists = async (tableName: string, indexName: string, createSql: string) => {
  const [rows] = await pool.query<any[]>(
    `SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [tableName, indexName]
  );

  if (!rows.length) {
    await pool.query(createSql);
  }
};

const ensureForeignKeyExists = async (tableName: string, constraintName: string, createSql: string) => {
  const [rows] = await pool.query<any[]>(
    `SELECT CONSTRAINT_NAME
     FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?
     LIMIT 1`,
    [tableName, constraintName]
  );

  if (!rows.length) {
    await pool.query(createSql);
  }
};

const ensureAutomationSchema = async () => {
  if (automationSchemaReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_pemetaan_penilai (
      id INT NOT NULL AUTO_INCREMENT,
      periode_id INT NOT NULL,
      pegawai_id INT NOT NULL,
      tim_kerja_id INT NULL,
      penilai_pegawai_id INT NULL,
      reviewer_pegawai_id INT NULL,
      sumber_mapping ENUM('manual','sinkron_tim') NOT NULL DEFAULT 'manual',
      catatan TEXT NULL,
      status ENUM('aktif','arsip') NOT NULL DEFAULT 'aktif',
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureIndexExists("kinerja_pemetaan_penilai", "uq_kinerja_pemetaan_penilai_periode_pegawai", "ALTER TABLE kinerja_pemetaan_penilai ADD UNIQUE INDEX uq_kinerja_pemetaan_penilai_periode_pegawai (periode_id, pegawai_id)");
  await ensureIndexExists("kinerja_pemetaan_penilai", "idx_kinerja_pemetaan_penilai_tim", "ALTER TABLE kinerja_pemetaan_penilai ADD INDEX idx_kinerja_pemetaan_penilai_tim (tim_kerja_id)");
  await ensureIndexExists("kinerja_pemetaan_penilai", "idx_kinerja_pemetaan_penilai_penilai", "ALTER TABLE kinerja_pemetaan_penilai ADD INDEX idx_kinerja_pemetaan_penilai_penilai (penilai_pegawai_id)");
  await ensureIndexExists("kinerja_pemetaan_penilai", "idx_kinerja_pemetaan_penilai_reviewer", "ALTER TABLE kinerja_pemetaan_penilai ADD INDEX idx_kinerja_pemetaan_penilai_reviewer (reviewer_pegawai_id)");
  await ensureForeignKeyExists("kinerja_pemetaan_penilai", "fk_kinerja_pemetaan_penilai_periode", "ALTER TABLE kinerja_pemetaan_penilai ADD CONSTRAINT fk_kinerja_pemetaan_penilai_periode FOREIGN KEY (periode_id) REFERENCES kinerja_periode (id) ON DELETE CASCADE ON UPDATE CASCADE");
  await ensureForeignKeyExists("kinerja_pemetaan_penilai", "fk_kinerja_pemetaan_penilai_pegawai", "ALTER TABLE kinerja_pemetaan_penilai ADD CONSTRAINT fk_kinerja_pemetaan_penilai_pegawai FOREIGN KEY (pegawai_id) REFERENCES pegawai (id) ON DELETE CASCADE ON UPDATE CASCADE");
  await ensureForeignKeyExists("kinerja_pemetaan_penilai", "fk_kinerja_pemetaan_penilai_tim", "ALTER TABLE kinerja_pemetaan_penilai ADD CONSTRAINT fk_kinerja_pemetaan_penilai_tim FOREIGN KEY (tim_kerja_id) REFERENCES kinerja_tim_kerja (id) ON DELETE SET NULL ON UPDATE CASCADE");
  await ensureForeignKeyExists("kinerja_pemetaan_penilai", "fk_kinerja_pemetaan_penilai_penilai", "ALTER TABLE kinerja_pemetaan_penilai ADD CONSTRAINT fk_kinerja_pemetaan_penilai_penilai FOREIGN KEY (penilai_pegawai_id) REFERENCES pegawai (id) ON DELETE SET NULL ON UPDATE CASCADE");
  await ensureForeignKeyExists("kinerja_pemetaan_penilai", "fk_kinerja_pemetaan_penilai_reviewer", "ALTER TABLE kinerja_pemetaan_penilai ADD CONSTRAINT fk_kinerja_pemetaan_penilai_reviewer FOREIGN KEY (reviewer_pegawai_id) REFERENCES pegawai (id) ON DELETE SET NULL ON UPDATE CASCADE");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_otomatisasi_log (
      id INT NOT NULL AUTO_INCREMENT,
      periode_id INT NULL,
      proses_kode VARCHAR(80) NOT NULL,
      proses_nama VARCHAR(150) NOT NULL,
      parameter_json LONGTEXT NULL,
      hasil_json LONGTEXT NULL,
      diproses_oleh INT NULL,
      diproses_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureIndexExists("kinerja_otomatisasi_log", "idx_kinerja_otomatisasi_log_periode", "ALTER TABLE kinerja_otomatisasi_log ADD INDEX idx_kinerja_otomatisasi_log_periode (periode_id)");
  await ensureIndexExists("kinerja_otomatisasi_log", "idx_kinerja_otomatisasi_log_proses", "ALTER TABLE kinerja_otomatisasi_log ADD INDEX idx_kinerja_otomatisasi_log_proses (proses_kode)");
  await ensureIndexExists("kinerja_otomatisasi_log", "idx_kinerja_otomatisasi_log_pemroses", "ALTER TABLE kinerja_otomatisasi_log ADD INDEX idx_kinerja_otomatisasi_log_pemroses (diproses_oleh)");
  await ensureForeignKeyExists("kinerja_otomatisasi_log", "fk_kinerja_otomatisasi_log_periode", "ALTER TABLE kinerja_otomatisasi_log ADD CONSTRAINT fk_kinerja_otomatisasi_log_periode FOREIGN KEY (periode_id) REFERENCES kinerja_periode (id) ON DELETE SET NULL ON UPDATE CASCADE");
  await ensureForeignKeyExists("kinerja_otomatisasi_log", "fk_kinerja_otomatisasi_log_pemroses", "ALTER TABLE kinerja_otomatisasi_log ADD CONSTRAINT fk_kinerja_otomatisasi_log_pemroses FOREIGN KEY (diproses_oleh) REFERENCES pegawai (id) ON DELETE SET NULL ON UPDATE CASCADE");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_notifikasi (
      id INT NOT NULL AUTO_INCREMENT,
      pegawai_id INT NOT NULL,
      jenis_notifikasi VARCHAR(60) NOT NULL,
      judul VARCHAR(200) NOT NULL,
      isi TEXT NOT NULL,
      link_tujuan VARCHAR(255) NULL,
      referensi_tipe VARCHAR(60) NULL,
      referensi_id INT NULL,
      status_baca ENUM('baru','dibaca') NOT NULL DEFAULT 'baru',
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureIndexExists("kinerja_notifikasi", "idx_kinerja_notifikasi_pegawai", "ALTER TABLE kinerja_notifikasi ADD INDEX idx_kinerja_notifikasi_pegawai (pegawai_id)");
  await ensureForeignKeyExists("kinerja_notifikasi", "fk_kinerja_notifikasi_pegawai", "ALTER TABLE kinerja_notifikasi ADD CONSTRAINT fk_kinerja_notifikasi_pegawai FOREIGN KEY (pegawai_id) REFERENCES pegawai (id) ON DELETE CASCADE ON UPDATE CASCADE");

  await ensureColumnExists("kinerja_evaluasi_akhir_tahun", "sumber_generate", "sumber_generate VARCHAR(60) NULL AFTER status");

  automationSchemaReady = true;
};

const normalizeMappingPayload = (body: Record<string, unknown>) => ({
  periodeId: readPositiveId(body.periodeId, "Periode kinerja"),
  pegawaiId: readPositiveId(body.pegawaiId, "Pegawai"),
  timKerjaId: readOptionalPositiveId(body.timKerjaId, "Tim kerja"),
  penilaiPegawaiId: readOptionalPositiveId(body.penilaiPegawaiId, "Penilai"),
  reviewerPegawaiId: readOptionalPositiveId(body.reviewerPegawaiId, "Reviewer"),
  sourceType: ensureOneOf(
    readTrimmedString(body.sourceType || "manual").toLowerCase(),
    MAPPING_SOURCES,
    "Sumber pemetaan"
  ),
  note: readTrimmedString(body.note),
  status: ensureOneOf(
    readTrimmedString(body.status || "aktif").toLowerCase(),
    MAPPING_STATUSES,
    "Status pemetaan"
  )
});

const buildMappingRecord = (row: any) => ({
  id: Number(row.id),
  periodeId: Number(row.periodeId),
  periodeName: String(row.periodeName || "-"),
  pegawaiId: Number(row.pegawaiId),
  pegawaiName: String(row.pegawaiName || "-"),
  timKerjaId: row.timKerjaId == null ? null : Number(row.timKerjaId),
  timKerjaName: String(row.timKerjaName || "-"),
  penilaiPegawaiId: row.penilaiPegawaiId == null ? null : Number(row.penilaiPegawaiId),
  penilaiPegawaiName: String(row.penilaiPegawaiName || "-"),
  reviewerPegawaiId: row.reviewerPegawaiId == null ? null : Number(row.reviewerPegawaiId),
  reviewerPegawaiName: String(row.reviewerPegawaiName || "-"),
  sourceType: String(row.sourceType || "manual"),
  note: String(row.note || ""),
  status: String(row.status || "aktif"),
  createdAt: row.createdAt ? String(row.createdAt) : null,
  updatedAt: row.updatedAt ? String(row.updatedAt) : null
});

const buildLogRecord = (row: any) => {
  let parameterJson: any = null;
  let resultJson: any = null;
  try {
    parameterJson = row.parameterJson ? JSON.parse(String(row.parameterJson)) : null;
  } catch {
    parameterJson = row.parameterJson ? String(row.parameterJson) : null;
  }
  try {
    resultJson = row.resultJson ? JSON.parse(String(row.resultJson)) : null;
  } catch {
    resultJson = row.resultJson ? String(row.resultJson) : null;
  }

  return {
    id: Number(row.id),
    periodeId: row.periodeId == null ? null : Number(row.periodeId),
    periodeName: String(row.periodeName || "-"),
    processCode: String(row.processCode || ""),
    processName: String(row.processName || ""),
    parameterJson,
    resultJson,
    processedBy: row.processedBy == null ? null : Number(row.processedBy),
    processedByName: String(row.processedByName || "-"),
    processedAt: row.processedAt ? String(row.processedAt) : null
  };
};

const writeAutomationLog = async (payload: {
  periodId?: number | null;
  processCode: string;
  processName: string;
  parameters: Record<string, unknown>;
  result: Record<string, unknown>;
  processedBy?: number | null;
}) => {
  await pool.query(
    `INSERT INTO kinerja_otomatisasi_log
      (periode_id, proses_kode, proses_nama, parameter_json, hasil_json, diproses_oleh)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      payload.periodId || null,
      payload.processCode,
      payload.processName,
      JSON.stringify(payload.parameters || {}),
      JSON.stringify(payload.result || {}),
      payload.processedBy || null
    ]
  );
};

const createNotificationIfMissing = async (payload: {
  employeeId: number;
  type: string;
  title: string;
  content: string;
  link: string | null;
  referenceType: string;
  referenceId: number;
}) => {
  const [rows] = await pool.query<any[]>(
    `SELECT id
     FROM kinerja_notifikasi
     WHERE pegawai_id = ?
       AND referensi_tipe = ?
       AND referensi_id = ?
       AND DATE(dibuat_pada) = CURRENT_DATE()
     LIMIT 1`,
    [payload.employeeId, payload.referenceType, payload.referenceId]
  );

  if (rows.length) return false;

  await pool.query(
    `INSERT INTO kinerja_notifikasi
      (pegawai_id, jenis_notifikasi, judul, isi, link_tujuan, referensi_tipe, referensi_id, status_baca)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'baru')`,
    [payload.employeeId, payload.type, payload.title, payload.content, payload.link, payload.referenceType, payload.referenceId]
  );
  return true;
};

const addMonths = (date: Date, months: number) => {
  const clone = new Date(date.getTime());
  const originalDate = clone.getDate();
  clone.setMonth(clone.getMonth() + months, 1);
  const lastDay = new Date(clone.getFullYear(), clone.getMonth() + 1, 0).getDate();
  clone.setDate(Math.min(originalDate, lastDay));
  return clone;
};

const toDateString = (date: Date) => date.toISOString().slice(0, 10);

const buildSlices = (startDateRaw: string, endDateRaw: string, type: (typeof TARGET_PERIOD_TYPES)[number]) => {
  const stepMonths = type === "bulanan" ? 1 : type === "triwulan" ? 3 : 6;
  const startDate = new Date(startDateRaw);
  const endDate = new Date(endDateRaw);
  const slices: Array<{ startDate: string; endDate: string; periodNumber: number }> = [];

  let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  let index = 1;
  while (cursor.getTime() <= endDate.getTime()) {
    const nextCursor = addMonths(cursor, stepMonths);
    const sliceEnd = new Date(Math.min(endDate.getTime(), new Date(nextCursor.getTime() - 24 * 60 * 60 * 1000).getTime()));
    slices.push({
      startDate: toDateString(cursor),
      endDate: toDateString(sliceEnd),
      periodNumber: index
    });
    cursor = new Date(nextCursor.getFullYear(), nextCursor.getMonth(), nextCursor.getDate());
    index += 1;
  }

  return slices;
};

const splitTarget = (target: number | null, parts: number) => {
  if (target == null || !parts || parts <= 0) {
    return new Array(parts).fill(null);
  }

  const base = Math.floor(((target / parts) * 100)) / 100;
  const result: Array<number | null> = [];
  let accumulated = 0;
  for (let index = 0; index < parts; index += 1) {
    if (index === parts - 1) {
      result.push(Number((target - accumulated).toFixed(2)));
    } else {
      result.push(Number(base.toFixed(2)));
      accumulated += base;
    }
  }
  return result;
};

export const getKinerjaEvaluatorMappings = asyncHandler(async (req, res) => {
  await ensureAutomationSchema();
  const periodId = readOptionalPositiveId(req.query.periodeId, "Periode kinerja");
  const teamId = readOptionalPositiveId(req.query.timKerjaId, "Tim kerja");
  const employeeId = readOptionalPositiveId(req.query.pegawaiId, "Pegawai");
  const search = readTrimmedString(req.query.search);

  const conditions: string[] = ["1 = 1"];
  const params: any[] = [];

  if (periodId) {
    conditions.push("m.periode_id = ?");
    params.push(periodId);
  }
  if (teamId) {
    conditions.push("m.tim_kerja_id = ?");
    params.push(teamId);
  }
  if (employeeId) {
    conditions.push("m.pegawai_id = ?");
    params.push(employeeId);
  }
  if (search) {
    conditions.push("(pg.nama_lengkap LIKE ? OR pn.nama_lengkap LIKE ? OR pr.nama_lengkap LIKE ? OR p.nama_periode LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  const [rows] = await pool.query<any[]>(
    `SELECT m.id,
            m.periode_id AS periodeId,
            p.nama_periode AS periodeName,
            m.pegawai_id AS pegawaiId,
            COALESCE(pg.nama_lengkap, '-') AS pegawaiName,
            m.tim_kerja_id AS timKerjaId,
            COALESCE(t.nama_tim, '-') AS timKerjaName,
            m.penilai_pegawai_id AS penilaiPegawaiId,
            COALESCE(pn.nama_lengkap, '-') AS penilaiPegawaiName,
            m.reviewer_pegawai_id AS reviewerPegawaiId,
            COALESCE(pr.nama_lengkap, '-') AS reviewerPegawaiName,
            m.sumber_mapping AS sourceType,
            COALESCE(m.catatan, '') AS note,
            m.status,
            DATE_FORMAT(m.dibuat_pada, '%Y-%m-%d %H:%i:%s') AS createdAt,
            DATE_FORMAT(m.diperbarui_pada, '%Y-%m-%d %H:%i:%s') AS updatedAt
     FROM kinerja_pemetaan_penilai m
     INNER JOIN kinerja_periode p ON p.id = m.periode_id
     INNER JOIN pegawai pg ON pg.id = m.pegawai_id
     LEFT JOIN kinerja_tim_kerja t ON t.id = m.tim_kerja_id
     LEFT JOIN pegawai pn ON pn.id = m.penilai_pegawai_id
     LEFT JOIN pegawai pr ON pr.id = m.reviewer_pegawai_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY p.tahun DESC, p.nama_periode ASC, pg.nama_lengkap ASC`,
    params
  );

  return sendSuccess(res, rows.map(buildMappingRecord));
});

export const createKinerjaEvaluatorMapping = asyncHandler(async (req, res) => {
  await ensureAutomationSchema();
  const payload = normalizeMappingPayload(req.body || {});
  await ensurePeriodExists(payload.periodeId);
  await ensureEmployeeExists(payload.pegawaiId);
  if (payload.timKerjaId) await ensureTeamExists(payload.timKerjaId);
  if (payload.penilaiPegawaiId) await ensureEmployeeExists(payload.penilaiPegawaiId);
  if (payload.reviewerPegawaiId) await ensureEmployeeExists(payload.reviewerPegawaiId);

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO kinerja_pemetaan_penilai
      (periode_id, pegawai_id, tim_kerja_id, penilai_pegawai_id, reviewer_pegawai_id, sumber_mapping, catatan, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.periodeId,
      payload.pegawaiId,
      payload.timKerjaId,
      payload.penilaiPegawaiId,
      payload.reviewerPegawaiId,
      payload.sourceType,
      payload.note || null,
      payload.status
    ]
  );

  return sendSuccess(res, { id: result.insertId }, "Pemetaan penilai berhasil ditambahkan", 201);
});

export const updateKinerjaEvaluatorMapping = asyncHandler(async (req, res) => {
  await ensureAutomationSchema();
  const id = readPositiveId(req.params.id, "Pemetaan penilai");
  await ensureMappingExists(id);
  const payload = normalizeMappingPayload(req.body || {});
  await ensurePeriodExists(payload.periodeId);
  await ensureEmployeeExists(payload.pegawaiId);
  if (payload.timKerjaId) await ensureTeamExists(payload.timKerjaId);
  if (payload.penilaiPegawaiId) await ensureEmployeeExists(payload.penilaiPegawaiId);
  if (payload.reviewerPegawaiId) await ensureEmployeeExists(payload.reviewerPegawaiId);

  await pool.query(
    `UPDATE kinerja_pemetaan_penilai
     SET periode_id = ?, pegawai_id = ?, tim_kerja_id = ?, penilai_pegawai_id = ?, reviewer_pegawai_id = ?, sumber_mapping = ?, catatan = ?, status = ?
     WHERE id = ?`,
    [
      payload.periodeId,
      payload.pegawaiId,
      payload.timKerjaId,
      payload.penilaiPegawaiId,
      payload.reviewerPegawaiId,
      payload.sourceType,
      payload.note || null,
      payload.status,
      id
    ]
  );

  return sendSuccess(res, null, "Pemetaan penilai berhasil diperbarui");
});

export const deleteKinerjaEvaluatorMapping = asyncHandler(async (req, res) => {
  await ensureAutomationSchema();
  const id = readPositiveId(req.params.id, "Pemetaan penilai");
  const [result] = await pool.query<ResultSetHeader>(`DELETE FROM kinerja_pemetaan_penilai WHERE id = ?`, [id]);
  if (!result.affectedRows) fail("Pemetaan penilai tidak ditemukan", 404);
  return sendSuccess(res, null, "Pemetaan penilai berhasil dihapus");
});

export const syncKinerjaEvaluatorMappings = asyncHandler(async (req: AuthenticatedRequest, res) => {
  await ensureAutomationSchema();
  const periodId = readPositiveId(req.body?.periodeId, "Periode kinerja");
  const teamId = readOptionalPositiveId(req.body?.timKerjaId, "Tim kerja");
  const replaceManual = readBoolean(req.body?.replaceManual, false);
  await ensurePeriodExists(periodId);
  if (teamId) await ensureTeamExists(teamId);

  const params: any[] = [];
  const teamFilter = teamId ? "WHERE tk.id = ?" : "";
  if (teamId) params.push(teamId);

  const [rows] = await pool.query<any[]>(
    `SELECT tk.id AS teamId,
            tk.nama_tim AS teamName,
            tk.ketua_pegawai_id AS leaderId,
            ta.pegawai_id AS memberId
     FROM kinerja_tim_kerja tk
     INNER JOIN kinerja_tim_anggota ta ON ta.tim_kerja_id = tk.id
     ${teamFilter}
     ORDER BY tk.nama_tim ASC, ta.pegawai_id ASC`,
    params
  );

  const [existingRows] = await pool.query<any[]>(
    `SELECT id, pegawai_id AS employeeId, sumber_mapping AS sourceType
     FROM kinerja_pemetaan_penilai
     WHERE periode_id = ?`,
    [periodId]
  );
  const existingByEmployee = new Map<number, { id: number; sourceType: string }>(
    existingRows.map((row) => [Number(row.employeeId), { id: Number(row.id), sourceType: String(row.sourceType || "manual") }])
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const employeeId = Number(row.memberId || 0);
    const leaderId = row.leaderId == null ? null : Number(row.leaderId);
    const current = existingByEmployee.get(employeeId);

    if (!employeeId || !leaderId || employeeId === leaderId) {
      skipped += 1;
      continue;
    }

    if (current?.sourceType === "manual" && !replaceManual) {
      skipped += 1;
      continue;
    }

    if (current) {
      await pool.query(
        `UPDATE kinerja_pemetaan_penilai
         SET tim_kerja_id = ?, penilai_pegawai_id = ?, reviewer_pegawai_id = NULL, sumber_mapping = 'sinkron_tim', status = 'aktif'
         WHERE id = ?`,
        [Number(row.teamId), leaderId, current.id]
      );
      updated += 1;
    } else {
      const [result] = await pool.query<ResultSetHeader>(
        `INSERT INTO kinerja_pemetaan_penilai
          (periode_id, pegawai_id, tim_kerja_id, penilai_pegawai_id, reviewer_pegawai_id, sumber_mapping, status)
         VALUES (?, ?, ?, ?, NULL, 'sinkron_tim', 'aktif')`,
        [periodId, employeeId, Number(row.teamId), leaderId]
      );
      existingByEmployee.set(employeeId, { id: result.insertId, sourceType: "sinkron_tim" });
      created += 1;
    }
  }

  const result = {
    totalCandidates: rows.length,
    created,
    updated,
    skipped,
    replaceManual
  };

  await writeAutomationLog({
    periodId,
    processCode: "sync_evaluator_mappings",
    processName: "Sinkronisasi Pemetaan Penilai dari Tim Kerja",
    parameters: { periodId, teamId, replaceManual },
    result,
    processedBy: req.user?.employeeId || null
  });

  return sendSuccess(res, result, "Sinkronisasi pemetaan penilai selesai");
});

export const generateKinerjaIkiBulk = asyncHandler(async (req: AuthenticatedRequest, res) => {
  await ensureAutomationSchema();
  const periodId = readPositiveId(req.body?.periodeId, "Periode kinerja");
  const teamId = readOptionalPositiveId(req.body?.timKerjaId, "Tim kerja");
  const replaceExisting = readBoolean(req.body?.replaceExisting, false);
  await ensurePeriodExists(periodId);
  if (teamId) await ensureTeamExists(teamId);

  const [teamRows] = await pool.query<any[]>(
    `SELECT tk.id AS teamId, tk.ketua_pegawai_id AS leaderId, ta.pegawai_id AS memberId
     FROM kinerja_tim_kerja tk
     LEFT JOIN kinerja_tim_anggota ta ON ta.tim_kerja_id = tk.id`
  );
  const teamMembers = new Map<number, number[]>();
  for (const row of teamRows) {
    const id = Number(row.teamId || 0);
    if (!id) continue;
    if (!teamMembers.has(id)) teamMembers.set(id, []);
    const list = teamMembers.get(id)!;
    const memberId = row.memberId == null ? null : Number(row.memberId);
    const leaderId = row.leaderId == null ? null : Number(row.leaderId);
    if (leaderId && !list.includes(leaderId)) list.push(leaderId);
    if (memberId && !list.includes(memberId)) list.push(memberId);
  }

  const filters = ["iku.periode_id = ?", "c.status IN ('draft','aktif')"];
  const params: any[] = [periodId];
  if (teamId) {
    filters.push("c.tim_kerja_id = ?");
    params.push(teamId);
  }

  const [rows] = await pool.query<any[]>(
    `SELECT c.id,
            c.tim_kerja_id AS teamId,
            c.pegawai_id AS employeeId,
            c.indikator_kinerja_id AS indicatorId,
            COALESCE(i.nama, '') AS indicatorName,
            COALESCE(i.definisi, '') AS indicatorDefinition,
            i.target_default AS targetDefault,
            i.satuan_id AS unitId,
            i.bobot_default AS weightDefault
     FROM kinerja_cascading_iku c
     INNER JOIN kinerja_iku_satker iku ON iku.id = c.iku_satker_id
     INNER JOIN indikator_kinerja i ON i.id = c.indikator_kinerja_id
     WHERE ${filters.join(" AND ")}
     ORDER BY c.tim_kerja_id ASC, i.nama ASC`,
    params
  );

  let generated = 0;
  let updated = 0;
  let skipped = 0;
  const touchedEmployees = new Set<number>();

  for (const row of rows) {
    const employeeCandidates = row.employeeId
      ? [Number(row.employeeId)]
      : row.teamId && teamMembers.has(Number(row.teamId))
        ? teamMembers.get(Number(row.teamId))!
        : [];

    for (const employeeId of employeeCandidates) {
      touchedEmployees.add(employeeId);
      const [existingRows] = await pool.query<any[]>(
        `SELECT id
         FROM kinerja_iki_pegawai
         WHERE periode_id = ? AND pegawai_id = ? AND indikator_kinerja_id = ?
         LIMIT 1`,
        [periodId, employeeId, Number(row.indicatorId)]
      );

      if (existingRows.length) {
        if (!replaceExisting) {
          skipped += 1;
          continue;
        }

        await pool.query(
          `UPDATE kinerja_iki_pegawai
           SET tim_kerja_id = ?,
               nama_iki = ?,
               target = ?,
               satuan_id = ?,
               bobot = ?,
               metode_ukur = ?,
               sumber_bukti = ?
           WHERE id = ?`,
          [
            row.teamId == null ? null : Number(row.teamId),
            String(row.indicatorName || ""),
            row.targetDefault == null ? null : Number(row.targetDefault),
            row.unitId == null ? null : Number(row.unitId),
            row.weightDefault == null ? null : Number(row.weightDefault),
            String(row.indicatorDefinition || ""),
            "Dihasilkan otomatis dari cascading indikator",
            Number(existingRows[0].id)
          ]
        );
        updated += 1;
      } else {
        await pool.query(
          `INSERT INTO kinerja_iki_pegawai
            (periode_id, pegawai_id, tim_kerja_id, indikator_kinerja_id, nama_iki, target, satuan_id, bobot, metode_ukur, sumber_bukti, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
          [
            periodId,
            employeeId,
            row.teamId == null ? null : Number(row.teamId),
            Number(row.indicatorId),
            String(row.indicatorName || ""),
            row.targetDefault == null ? null : Number(row.targetDefault),
            row.unitId == null ? null : Number(row.unitId),
            row.weightDefault == null ? null : Number(row.weightDefault),
            String(row.indicatorDefinition || ""),
            "Dihasilkan otomatis dari cascading indikator"
          ]
        );
        generated += 1;
      }
    }
  }

  const result = {
    totalMappings: rows.length,
    affectedEmployees: touchedEmployees.size,
    generated,
    updated,
    skipped,
    replaceExisting
  };

  await writeAutomationLog({
    periodId,
    processCode: "generate_iki_bulk",
    processName: "Generate IKI Massal",
    parameters: { periodId, teamId, replaceExisting },
    result,
    processedBy: req.user?.employeeId || null
  });

  return sendSuccess(res, result, "Generate IKI massal selesai");
});

export const generateKinerjaPeriodicTargetsBulk = asyncHandler(async (req: AuthenticatedRequest, res) => {
  await ensureAutomationSchema();
  const periodId = readPositiveId(req.body?.periodeId, "Periode kinerja");
  const targetType = ensureOneOf(
    readTrimmedString(req.body?.targetType || req.body?.jenisPeriode).toLowerCase(),
    TARGET_PERIOD_TYPES,
    "Jenis target periodik"
  );
  const replaceExisting = readBoolean(req.body?.replaceExisting, false);
  await ensurePeriodExists(periodId);

  const [[period]] = await pool.query<any[]>(
    `SELECT tanggal_mulai AS startDate, tanggal_selesai AS endDate
     FROM kinerja_periode
     WHERE id = ? LIMIT 1`,
    [periodId]
  );
  if (!period) fail("Periode kinerja tidak ditemukan", 404);

  const slices = buildSlices(String(period.startDate), String(period.endDate), targetType);
  if (!slices.length) fail("Periode kinerja belum memiliki rentang tanggal yang valid", 400);

  const [ikiRows] = await pool.query<any[]>(
    `SELECT id, nama_iki AS ikiName, target
     FROM kinerja_iki_pegawai
     WHERE periode_id = ?
     ORDER BY nama_iki ASC`,
    [periodId]
  );

  let generatedForIki = 0;
  let skippedIki = 0;
  let generatedTargets = 0;

  for (const row of ikiRows) {
    const ikiId = Number(row.id);
    const [existingRows] = await pool.query<any[]>(
      `SELECT id FROM kinerja_target_periodik WHERE iki_pegawai_id = ? LIMIT 1`,
      [ikiId]
    );

    if (existingRows.length && !replaceExisting) {
      skippedIki += 1;
      continue;
    }

    if (existingRows.length && replaceExisting) {
      await pool.query(`DELETE FROM kinerja_target_periodik WHERE iki_pegawai_id = ?`, [ikiId]);
    }

    const values = splitTarget(row.target == null ? null : Number(row.target), slices.length);
    for (const [index, slice] of slices.entries()) {
      await pool.query(
        `INSERT INTO kinerja_target_periodik
          (iki_pegawai_id, jenis_periode, periode_ke, tanggal_mulai, tanggal_selesai, target, milestone, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')`,
        [
          ikiId,
          targetType,
          slice.periodNumber,
          slice.startDate,
          slice.endDate,
          values[index],
          `Dihasilkan otomatis ${targetType} #${slice.periodNumber}`
        ]
      );
      generatedTargets += 1;
    }
    generatedForIki += 1;
  }

  const result = {
    totalIki: ikiRows.length,
    generatedForIki,
    skippedIki,
    generatedTargets,
    targetType,
    replaceExisting
  };

  await writeAutomationLog({
    periodId,
    processCode: "generate_periodic_targets_bulk",
    processName: "Generate Target Periodik Massal",
    parameters: { periodId, targetType, replaceExisting },
    result,
    processedBy: req.user?.employeeId || null
  });

  return sendSuccess(res, result, "Generate target periodik massal selesai");
});

export const generateKinerjaOverdueNotifications = asyncHandler(async (req: AuthenticatedRequest, res) => {
  await ensureAutomationSchema();
  const periodId = readPositiveId(req.body?.periodeId, "Periode kinerja");
  await ensurePeriodExists(periodId);

  const [assignmentRows] = await pool.query<any[]>(
    `SELECT a.id,
            a.pegawai_id AS employeeId,
            COALESCE(a.judul, '-') AS title,
            DATE_FORMAT(a.target_selesai, '%Y-%m-%d') AS endDate
     FROM kinerja_assignment a
     WHERE a.periode_id = ?
       AND a.target_selesai < CURRENT_DATE()
       AND a.status IN ('draft','berjalan','tertunda')`,
    [periodId]
  );

  const [targetRows] = await pool.query<any[]>(
    `SELECT tp.id,
            iki.pegawai_id AS employeeId,
            COALESCE(iki.nama_iki, '-') AS ikiName,
            DATE_FORMAT(tp.tanggal_selesai, '%Y-%m-%d') AS endDate
     FROM kinerja_target_periodik tp
     INNER JOIN kinerja_iki_pegawai iki ON iki.id = tp.iki_pegawai_id
     LEFT JOIN kinerja_realisasi_indikator ri
       ON ri.target_periodik_id = tp.id
      AND ri.status IN ('verified','finalized')
     WHERE iki.periode_id = ?
       AND tp.tanggal_selesai < CURRENT_DATE()
       AND ri.id IS NULL`,
    [periodId]
  );

  let createdNotifications = 0;
  for (const row of assignmentRows) {
    const created = await createNotificationIfMissing({
      employeeId: Number(row.employeeId),
      type: "assignment_overdue",
      title: "Penugasan melewati tenggat",
      content: `Penugasan ${String(row.title || "-")} belum selesai sampai ${String(row.endDate || "-")}.`,
      link: "/kinerja/assignment",
      referenceType: "assignment",
      referenceId: Number(row.id)
    });
    if (created) createdNotifications += 1;
  }

  for (const row of targetRows) {
    const created = await createNotificationIfMissing({
      employeeId: Number(row.employeeId),
      type: "target_periodik_overdue",
      title: "Realisasi target periodik belum dilaporkan",
      content: `Target periodik untuk ${String(row.ikiName || "-")} belum direalisasikan sampai ${String(row.endDate || "-")}.`,
      link: "/kinerja/realization",
      referenceType: "target_periodik",
      referenceId: Number(row.id)
    });
    if (created) createdNotifications += 1;
  }

  const result = {
    overdueAssignments: assignmentRows.length,
    overdueTargets: targetRows.length,
    createdNotifications
  };

  await writeAutomationLog({
    periodId,
    processCode: "generate_overdue_notifications",
    processName: "Generate Notifikasi Keterlambatan",
    parameters: { periodId },
    result,
    processedBy: req.user?.employeeId || null
  });

  return sendSuccess(res, result, "Generate notifikasi keterlambatan selesai");
});

export const getKinerjaAutomationLogs = asyncHandler(async (req, res) => {
  await ensureAutomationSchema();
  const periodId = readOptionalPositiveId(req.query.periodeId, "Periode kinerja");

  const conditions: string[] = ["1 = 1"];
  const params: any[] = [];
  if (periodId) {
    conditions.push("l.periode_id = ?");
    params.push(periodId);
  }

  const [rows] = await pool.query<any[]>(
    `SELECT l.id,
            l.periode_id AS periodeId,
            COALESCE(p.nama_periode, '-') AS periodeName,
            l.proses_kode AS processCode,
            l.proses_nama AS processName,
            l.parameter_json AS parameterJson,
            l.hasil_json AS resultJson,
            l.diproses_oleh AS processedBy,
            COALESCE(pg.nama_lengkap, '-') AS processedByName,
            DATE_FORMAT(l.diproses_pada, '%Y-%m-%d %H:%i:%s') AS processedAt
     FROM kinerja_otomatisasi_log l
     LEFT JOIN kinerja_periode p ON p.id = l.periode_id
     LEFT JOIN pegawai pg ON pg.id = l.diproses_oleh
     WHERE ${conditions.join(" AND ")}
     ORDER BY l.diproses_pada DESC
     LIMIT 100`,
    params
  );

  return sendSuccess(res, rows.map(buildLogRecord));
});
