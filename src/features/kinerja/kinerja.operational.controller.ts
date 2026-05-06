import { PoolConnection, ResultSetHeader } from "mysql2/promise";
import { pool } from "../../config/database";
import { asyncHandler, fail, sendSuccess } from "../../shared/http";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware";
import {
  ensureOneOf,
  ensureRequired,
  readDateString,
  readIntegerInRange,
  readNonNegativeNumber,
  readPositiveId,
  readTrimmedString
} from "../../shared/validation";
import {
  activityStatusSql,
  getTimerDurationMinutesSql,
  getTimerDurationSecondsSql,
  normalizeActivityStatusValue
} from "./kinerja.timer.helper";

let operationalSchemaReady = false;

let kegiatanNameColumnCache: "nama" | "nama_kegiatan" | null = null;

const getKegiatanNameColumn = async (): Promise<"nama" | "nama_kegiatan"> => {
  if (kegiatanNameColumnCache) return kegiatanNameColumnCache;

  // PostgreSQL compatibility note:
  // The database compatibility layer has a special handler for INFORMATION_SCHEMA.COLUMNS.
  // It expects TABLE_NAME/COLUMN_NAME to be passed as parameters, not embedded as string
  // literals. The previous literal query returned no rows under PostgreSQL, so the code
  // incorrectly selected kg.nama_kegiatan even though the imported table uses kg.nama.
  const [rows] = await pool.query<any[]>(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?`,
    ["kegiatan_indikator_kinerja"]
  );

  const columnNames = new Set(
    rows.map((row) => String(row.COLUMN_NAME || row.column_name || row.columnName || "").toLowerCase())
  );
  kegiatanNameColumnCache = columnNames.has("nama") ? "nama" : "nama_kegiatan";
  return kegiatanNameColumnCache;
};


const TASK_TYPES = ["individu", "tim", "lintas_tim", "lapangan", "pengolahan", "pst"] as const;
const TASK_PRIORITIES = ["rendah", "sedang", "tinggi"] as const;
const TASK_STATUSES = ["draft", "berjalan", "selesai", "tertunda"] as const;
const ADMIN_LOGBOOK_STATUSES = ["draft", "berjalan", "jeda", "dijeda", "selesai", "dikirim", "disetujui", "revisi"] as const;
const ACTIVITY_STATUSES = ["berjalan", "jeda", "selesai"] as const;
const EVIDENCE_TYPES = ["foto", "pdf", "xlsx", "link", "surat_tugas", "draft_publikasi", "lainnya"] as const;
const EVIDENCE_VERIFICATION_STATUSES = ["uploaded", "verified", "invalid"] as const;
const REALIZATION_STATUSES = ["draft", "submitted", "verified", "corrected", "finalized"] as const;

const readOptionalPositiveId = (value: unknown, fieldName: string) => {
  if (value === undefined || value === null || value === "") return null;
  return readPositiveId(value, fieldName);
};

const readOptionalNumber = (value: unknown, fieldName: string) => {
  if (value === undefined || value === null || value === "") return null;
  return readNonNegativeNumber(value, fieldName);
};

const readOptionalDateString = (value: unknown, fieldName: string) => {
  const normalized = readTrimmedString(value);
  if (!normalized) return null;
  return readDateString(normalized, fieldName);
};

const readOptionalTimeString = (value: unknown) => {
  const normalized = readTrimmedString(value);
  return normalized || null;
};

const ACTIVE_TIMEKEEPER_STATUSES = ["berjalan", "jeda"] as const;

const asNullableNumber = (value: unknown) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const ensureSingleRunningActivity = async (
  employeeId: number,
  excludeActivityId: number | null = null
) => {
  const params: Array<number> = [employeeId];
  let excludeSql = "";

  if (excludeActivityId) {
    excludeSql = " AND id <> ?";
    params.push(excludeActivityId);
  }

  const [rows] = await pool.query<any[]>(
    `SELECT id
     FROM kinerja_logbook
     WHERE pegawai_id = ?
       AND COALESCE(status_aktivitas, CASE WHEN status = 'dijeda' THEN 'jeda' ELSE status END) = 'berjalan'
       ${excludeSql}
     LIMIT 1
     FOR UPDATE`,
    params
  );

  if (rows.length) {
    fail("Pegawai ini masih memiliki aktivitas berjalan. Jeda atau selesaikan aktivitas tersebut sebelum memulai aktivitas lain.", 409);
  }
};


type ActivityHistoryAction = "mulai" | "jeda" | "lanjut" | "selesai" | "ubah_uraian" | "ubah_volume" | "ubah_satuan";

type ActivityHistoryPayload = {
  activityId: number;
  employeeId: number | null;
  action: ActivityHistoryAction;
  oldStatus?: string | null;
  newStatus?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  note?: string | null;
};

const serializeHistoryValue = (value: unknown) => {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const valuesAreEqual = (left: unknown, right: unknown) => {
  if ((left === undefined || left === null || left === "") && (right === undefined || right === null || right === "")) {
    return true;
  }
  return String(left ?? "") === String(right ?? "");
};

const numbersAreEqual = (left: unknown, right: unknown) => {
  const leftNumber = left === undefined || left === null || left === "" ? null : Number(left);
  const rightNumber = right === undefined || right === null || right === "" ? null : Number(right);

  if (leftNumber === null && rightNumber === null) return true;
  if (leftNumber === null || rightNumber === null) return false;

  return Math.abs(leftNumber - rightNumber) < 0.000001;
};

const getActivityHistoryAction = (
  oldStatus: string | null | undefined,
  newStatus: string | null | undefined
): ActivityHistoryAction | null => {
  if (!newStatus || oldStatus === newStatus) return null;

  if (newStatus === "berjalan") {
    return oldStatus === "jeda" ? "lanjut" : "mulai";
  }

  if (newStatus === "jeda") return "jeda";
  if (newStatus === "selesai") return "selesai";

  return null;
};

const writeActivityHistory = async (connection: PoolConnection, payload: ActivityHistoryPayload) => {
  await connection.query(
    `INSERT INTO kinerja_activity_histories
      (activity_id, pegawai_id, action, old_status, new_status, old_value, new_value, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.activityId,
      payload.employeeId,
      payload.action,
      payload.oldStatus || null,
      payload.newStatus || null,
      serializeHistoryValue(payload.oldValue),
      serializeHistoryValue(payload.newValue),
      payload.note || null
    ]
  );
};

const writeActivityFieldHistory = async (
  connection: PoolConnection,
  payload: {
    activityId: number;
    employeeId: number | null;
    action: ActivityHistoryAction;
    field: string;
    oldValue: unknown;
    newValue: unknown;
    note: string;
  }
) => {
  await writeActivityHistory(connection, {
    activityId: payload.activityId,
    employeeId: payload.employeeId,
    action: payload.action,
    oldValue: { field: payload.field, value: payload.oldValue ?? null },
    newValue: { field: payload.field, value: payload.newValue ?? null },
    note: payload.note
  });
};

const buildActivityHistoryRecord = (row: any) => ({
  id: Number(row.id),
  activityId: Number(row.activityId),
  employeeId: row.employeeId == null ? null : Number(row.employeeId),
  action: String(row.action || ""),
  oldStatus: row.oldStatus ? String(row.oldStatus) : null,
  newStatus: row.newStatus ? String(row.newStatus) : null,
  oldValue: row.oldValue == null ? null : String(row.oldValue),
  newValue: row.newValue == null ? null : String(row.newValue),
  note: row.note == null ? null : String(row.note),
  createdAt: row.createdAt ? String(row.createdAt) : null
});

const ensureColumnExists = async (tableName: string, columnName: string, columnDefinition: string) => {
  const [rows] = await pool.query<any[]>(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );

  if (!rows.length) {
    await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`);
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

const ensureEnumColumnIncludes = async (
  tableName: string,
  columnName: string,
  requiredValues: string[],
  alterSql: string
) => {
  const [rows] = await pool.query<any[]>(
    `SELECT COLUMN_TYPE
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );

  const columnType = String(rows[0]?.COLUMN_TYPE || rows[0]?.column_type || "");
  const isComplete = requiredValues.every((value) => columnType.includes(`'${value}'`));

  if (!isComplete) {
    await pool.query(alterSql);
  }
};


const ensureTeamLeaderAccess = async (employeeId: number | null | undefined, teamId: number | null | undefined) => {
  if (!employeeId || !teamId) {
    fail("Ketua tim hanya dapat mengelola penugasan pada timnya", 403);
  }

  const [rows] = await pool.query<any[]>(
    `SELECT id
     FROM kinerja_tim_kerja
     WHERE id = ?
       AND ketua_pegawai_id = ?
     LIMIT 1`,
    [teamId, employeeId]
  );

  if (!rows.length) {
    fail("Ketua tim hanya dapat mengelola penugasan pada timnya", 403);
  }
};

const ensureRecordExists = async (tableName: string, id: number | null | undefined, label: string) => {
  const numericId = Number(id || 0);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    fail(`${label} tidak valid`, 400);
  }

  const [rows] = await pool.query<any[]>(`SELECT id FROM ${tableName} WHERE id = ? LIMIT 1`, [numericId]);
  if (!rows.length) fail(`${label} tidak ditemukan`, 404);
};

const ensureDateRange = (startDate: string, endDate: string) => {
  if (new Date(startDate).getTime() > new Date(endDate).getTime()) {
    fail("Tanggal selesai tidak boleh lebih awal dari tanggal mulai", 400);
  }
};

const toDateOnlyTime = (dateValue: string) => new Date(`${dateValue}T00:00:00`).getTime();

const getTodayDateOnly = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const calculateAutomaticAssignmentStatus = (startDate: string, endDate: string) => {
  const todayTime = toDateOnlyTime(getTodayDateOnly());
  const startTime = toDateOnlyTime(startDate);
  const endTime = toDateOnlyTime(endDate);

  if (todayTime < startTime) return "draft";
  if (todayTime >= startTime && todayTime <= endTime) return "berjalan";
  return "selesai";
};

const automaticAssignmentStatusSql = `
  CASE
    WHEN a.target_mulai IS NULL OR a.target_selesai IS NULL THEN a.status
    WHEN COALESCE(a.progres, 0) >= 100 THEN 'selesai'
    WHEN CURDATE() < a.target_mulai THEN 'draft'
    WHEN CURDATE() >= a.target_mulai THEN 'berjalan'
    ELSE a.status
  END
`;

const additionalAssignmentSql = `
  a.note LIKE '%[TIMEKEEPER_ADDITIONAL]%'
  AND (
    a.tim_kerja_id IS NULL
    OR a.indikator_kinerja_id IS NULL
    OR a.kegiatan_id IS NULL
    OR COALESCE(a.output_target, '') = ''
  )
`;

const assignmentDisplayStatusSql = `
  CASE
    WHEN ${additionalAssignmentSql} THEN 'Belum Terdaftar'
    ELSE ${automaticAssignmentStatusSql}
  END
`;

const timekeeperAvailableAssignmentSql = `
  a.target_mulai IS NOT NULL
  AND a.target_selesai IS NOT NULL
  AND CURRENT_DATE >= (a.target_mulai)::date
  AND COALESCE(a.progres, 0) < 100
`;

const refreshOperationalAssignmentStatuses = async () => {
  await pool.query(
    `UPDATE kinerja_assignment
     SET status = CASE
       WHEN target_mulai IS NULL OR target_selesai IS NULL THEN status
       WHEN COALESCE(progres, 0) >= 100 THEN 'selesai'
       WHEN CURDATE() < target_mulai THEN 'draft'
       WHEN CURDATE() >= target_mulai THEN 'berjalan'
       ELSE status
     END,
     diperbarui_pada = NOW()
     WHERE target_mulai IS NOT NULL
       AND target_selesai IS NOT NULL
       AND status <> CASE
         WHEN target_mulai IS NULL OR target_selesai IS NULL THEN status
         WHEN COALESCE(progres, 0) >= 100 THEN 'selesai'
         WHEN CURDATE() < target_mulai THEN 'draft'
         WHEN CURDATE() >= target_mulai THEN 'berjalan'
         ELSE status
       END`
  );
};


const calculateAchievement = (target: number | null, realization: number | null) => {
  const safeTarget = typeof target === "number" ? target : null;
  const safeRealization = typeof realization === "number" ? realization : null;

  if (safeTarget === null || safeRealization === null || safeTarget <= 0) {
    return 0;
  }

  return Number(((safeRealization / safeTarget) * 100).toFixed(2));
};

const parseLocalizedNumber = (value: unknown) => {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;

  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw.replace(/[^0-9.-]/g, "");

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const syncAssignmentProgressByRealization = async (assignmentId: number | null | undefined) => {
  if (!assignmentId) return;

  const [assignmentRows] = await pool.query<any[]>(
    `SELECT output_target AS outputTarget
     FROM kinerja_assignment
     WHERE id = ?
     LIMIT 1`,
    [assignmentId]
  );

  if (!assignmentRows.length) return;

  const target = parseLocalizedNumber(assignmentRows[0].outputTarget);
  if (target <= 0) {
    await pool.query(
      `UPDATE kinerja_assignment
       SET progres = 0,
           diperbarui_pada = NOW()
       WHERE id = ?`,
      [assignmentId]
    );
    return;
  }

  const [realizationRows] = await pool.query<any[]>(
    `SELECT COALESCE(SUM(COALESCE(l.volume, 0)), 0) AS totalRealization
     FROM kinerja_logbook l
     WHERE l.assignment_id = ?
       AND (
         ${activityStatusSql('l')} IN ('berjalan', 'jeda', 'selesai')
         OR l.status IN ('dikirim', 'disetujui', 'revisi')
       )`,
    [assignmentId]
  );

  const totalRealization = Number(realizationRows[0]?.totalRealization || 0);
  const progress = Math.min(100, Math.max(0, Math.round((totalRealization / target) * 100)));

  await pool.query(
    `UPDATE kinerja_assignment
     SET progres = ?,
         diperbarui_pada = NOW()
     WHERE id = ?`,
    [progress, assignmentId]
  );
};

export const ensureOperationalSchema = async () => {
  if (operationalSchemaReady) return;

  await ensureColumnExists("kinerja_assignment", "periode_id", "periode_id INT NULL AFTER pegawai_id");
  await ensureColumnExists("kinerja_assignment", "indikator_kinerja_id", "indikator_kinerja_id INT NULL AFTER tim_kerja_id");
  await ensureColumnExists("kinerja_assignment", "kegiatan_id", "kegiatan_id INT NULL AFTER indikator_kinerja_id");
  await ensureColumnExists("kinerja_assignment", "jenis_penugasan", "jenis_penugasan ENUM('individu','tim','lintas_tim','lapangan','pengolahan','pst') NOT NULL DEFAULT 'individu' AFTER judul");
  await ensureColumnExists("kinerja_assignment", "prioritas", "prioritas ENUM('rendah','sedang','tinggi') NOT NULL DEFAULT 'sedang' AFTER target_selesai");
  await ensureColumnExists("kinerja_assignment", "output_target", "output_target VARCHAR(255) NULL AFTER prioritas");
  await ensureColumnExists("kinerja_assignment", "wilayah_kerja", "wilayah_kerja VARCHAR(255) NULL AFTER output_target");
  await ensureIndexExists("kinerja_assignment", "idx_kinerja_assignment_periode", "ALTER TABLE kinerja_assignment ADD INDEX idx_kinerja_assignment_periode (periode_id)");
  await ensureIndexExists("kinerja_assignment", "idx_kinerja_assignment_indikator", "ALTER TABLE kinerja_assignment ADD INDEX idx_kinerja_assignment_indikator (indikator_kinerja_id)");
  await ensureIndexExists("kinerja_assignment", "idx_kinerja_assignment_kegiatan", "ALTER TABLE kinerja_assignment ADD INDEX idx_kinerja_assignment_kegiatan (kegiatan_id)");
  await ensureForeignKeyExists("kinerja_assignment", "fk_kinerja_assignment_periode", "ALTER TABLE kinerja_assignment ADD CONSTRAINT fk_kinerja_assignment_periode FOREIGN KEY (periode_id) REFERENCES kinerja_periode (id) ON DELETE SET NULL ON UPDATE CASCADE");
  await ensureForeignKeyExists("kinerja_assignment", "fk_kinerja_assignment_indikator", "ALTER TABLE kinerja_assignment ADD CONSTRAINT fk_kinerja_assignment_indikator FOREIGN KEY (indikator_kinerja_id) REFERENCES indikator_kinerja (id) ON DELETE SET NULL ON UPDATE CASCADE");
  await ensureForeignKeyExists("kinerja_assignment", "fk_kinerja_assignment_kegiatan", "ALTER TABLE kinerja_assignment ADD CONSTRAINT fk_kinerja_assignment_kegiatan FOREIGN KEY (kegiatan_id) REFERENCES kegiatan_indikator_kinerja (id) ON DELETE SET NULL ON UPDATE CASCADE");

  await ensureColumnExists("kinerja_logbook", "periode_id", "periode_id INT NULL AFTER pegawai_id");
  await ensureColumnExists("kinerja_logbook", "tim_kerja_id", "tim_kerja_id INT NULL AFTER assignment_id");
  await ensureColumnExists("kinerja_logbook", "indikator_kinerja_id", "indikator_kinerja_id INT NULL AFTER tim_kerja_id");
  await ensureColumnExists("kinerja_logbook", "kegiatan_id", "kegiatan_id INT NULL AFTER indikator_kinerja_id");
  await ensureColumnExists("kinerja_logbook", "kategori_id", "kategori_id INT NULL AFTER kegiatan_id");
  await ensureColumnExists("kinerja_logbook", "volume", "volume DECIMAL(18,2) NULL AFTER uraian_kegiatan");
  await ensureColumnExists("kinerja_logbook", "satuan_id", "satuan_id INT NULL AFTER volume");
  await ensureColumnExists("kinerja_logbook", "durasi_menit", "durasi_menit INT NULL AFTER satuan_id");
  await ensureColumnExists("kinerja_logbook", "started_at", "started_at DATETIME NULL AFTER durasi_menit");
  await ensureColumnExists("kinerja_logbook", "paused_at", "paused_at DATETIME NULL AFTER started_at");
  await ensureColumnExists("kinerja_logbook", "resumed_at", "resumed_at DATETIME NULL AFTER paused_at");
  await ensureColumnExists("kinerja_logbook", "finished_at", "finished_at DATETIME NULL AFTER resumed_at");
  await ensureColumnExists("kinerja_logbook", "total_paused_seconds", "total_paused_seconds INT NOT NULL DEFAULT 0 AFTER finished_at");
  await ensureColumnExists("kinerja_logbook", "status_aktivitas", "status_aktivitas ENUM('berjalan','jeda','selesai') NULL AFTER status");
  await ensureColumnExists("kinerja_logbook", "last_activity_at", "last_activity_at DATETIME NULL AFTER total_paused_seconds");
  await ensureEnumColumnIncludes(
    "kinerja_logbook",
    "status",
    ["draft", "berjalan", "jeda", "dijeda", "selesai", "dikirim", "disetujui", "revisi"],
    "ALTER TABLE kinerja_logbook MODIFY status ENUM('draft','berjalan','jeda','dijeda','selesai','dikirim','disetujui','revisi') NOT NULL DEFAULT 'draft'"
  );
  await pool.query(`
    UPDATE kinerja_logbook
    SET status_aktivitas = CASE
          WHEN status = 'dijeda' THEN 'jeda'
          WHEN status IN ('berjalan', 'jeda', 'selesai') THEN status
          ELSE status_aktivitas
        END,
        last_activity_at = COALESCE(last_activity_at, diperbarui_pada, dibuat_pada)
    WHERE status_aktivitas IS NULL
       OR last_activity_at IS NULL
  `);
  await ensureIndexExists("kinerja_logbook", "idx_kinerja_logbook_periode", "ALTER TABLE kinerja_logbook ADD INDEX idx_kinerja_logbook_periode (periode_id)");
  await ensureIndexExists("kinerja_logbook", "idx_kinerja_logbook_tim", "ALTER TABLE kinerja_logbook ADD INDEX idx_kinerja_logbook_tim (tim_kerja_id)");
  await ensureIndexExists("kinerja_logbook", "idx_kinerja_logbook_indikator", "ALTER TABLE kinerja_logbook ADD INDEX idx_kinerja_logbook_indikator (indikator_kinerja_id)");
  await ensureIndexExists("kinerja_logbook", "idx_kinerja_logbook_kegiatan", "ALTER TABLE kinerja_logbook ADD INDEX idx_kinerja_logbook_kegiatan (kegiatan_id)");
  await ensureIndexExists("kinerja_logbook", "idx_kinerja_logbook_kategori", "ALTER TABLE kinerja_logbook ADD INDEX idx_kinerja_logbook_kategori (kategori_id)");
  await ensureIndexExists("kinerja_logbook", "idx_kinerja_logbook_satuan", "ALTER TABLE kinerja_logbook ADD INDEX idx_kinerja_logbook_satuan (satuan_id)");
  await ensureIndexExists("kinerja_logbook", "idx_kinerja_logbook_timer_status", "ALTER TABLE kinerja_logbook ADD INDEX idx_kinerja_logbook_timer_status (pegawai_id, status, assignment_id)");
  await ensureIndexExists("kinerja_logbook", "idx_kinerja_logbook_activity_status", "ALTER TABLE kinerja_logbook ADD INDEX idx_kinerja_logbook_activity_status (pegawai_id, status_aktivitas, assignment_id, last_activity_at)");
  await ensureForeignKeyExists("kinerja_logbook", "fk_kinerja_logbook_periode", "ALTER TABLE kinerja_logbook ADD CONSTRAINT fk_kinerja_logbook_periode FOREIGN KEY (periode_id) REFERENCES kinerja_periode (id) ON DELETE SET NULL ON UPDATE CASCADE");
  await ensureForeignKeyExists("kinerja_logbook", "fk_kinerja_logbook_tim", "ALTER TABLE kinerja_logbook ADD CONSTRAINT fk_kinerja_logbook_tim FOREIGN KEY (tim_kerja_id) REFERENCES kinerja_tim_kerja (id) ON DELETE SET NULL ON UPDATE CASCADE");
  await ensureForeignKeyExists("kinerja_logbook", "fk_kinerja_logbook_indikator", "ALTER TABLE kinerja_logbook ADD CONSTRAINT fk_kinerja_logbook_indikator FOREIGN KEY (indikator_kinerja_id) REFERENCES indikator_kinerja (id) ON DELETE SET NULL ON UPDATE CASCADE");
  await ensureForeignKeyExists("kinerja_logbook", "fk_kinerja_logbook_kegiatan", "ALTER TABLE kinerja_logbook ADD CONSTRAINT fk_kinerja_logbook_kegiatan FOREIGN KEY (kegiatan_id) REFERENCES kegiatan_indikator_kinerja (id) ON DELETE SET NULL ON UPDATE CASCADE");
  await ensureForeignKeyExists("kinerja_logbook", "fk_kinerja_logbook_kategori", "ALTER TABLE kinerja_logbook ADD CONSTRAINT fk_kinerja_logbook_kategori FOREIGN KEY (kategori_id) REFERENCES kinerja_kategori_aktivitas (id) ON DELETE SET NULL ON UPDATE CASCADE");
  await ensureForeignKeyExists("kinerja_logbook", "fk_kinerja_logbook_satuan", "ALTER TABLE kinerja_logbook ADD CONSTRAINT fk_kinerja_logbook_satuan FOREIGN KEY (satuan_id) REFERENCES kinerja_satuan (id) ON DELETE SET NULL ON UPDATE CASCADE");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_activity_histories (
      id INT NOT NULL AUTO_INCREMENT,
      activity_id INT NOT NULL,
      pegawai_id INT NULL,
      action VARCHAR(40) NOT NULL,
      old_status VARCHAR(32) NULL,
      new_status VARCHAR(32) NULL,
      old_value TEXT NULL,
      new_value TEXT NULL,
      note TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureIndexExists("kinerja_activity_histories", "idx_kinerja_activity_histories_activity", "ALTER TABLE kinerja_activity_histories ADD INDEX idx_kinerja_activity_histories_activity (activity_id, created_at)");
  await ensureIndexExists("kinerja_activity_histories", "idx_kinerja_activity_histories_pegawai", "ALTER TABLE kinerja_activity_histories ADD INDEX idx_kinerja_activity_histories_pegawai (pegawai_id, created_at)");
  await ensureForeignKeyExists("kinerja_activity_histories", "fk_kinerja_activity_histories_activity", "ALTER TABLE kinerja_activity_histories ADD CONSTRAINT fk_kinerja_activity_histories_activity FOREIGN KEY (activity_id) REFERENCES kinerja_logbook (id) ON DELETE CASCADE ON UPDATE CASCADE");
  await ensureForeignKeyExists("kinerja_activity_histories", "fk_kinerja_activity_histories_pegawai", "ALTER TABLE kinerja_activity_histories ADD CONSTRAINT fk_kinerja_activity_histories_pegawai FOREIGN KEY (pegawai_id) REFERENCES pegawai (id) ON DELETE SET NULL ON UPDATE CASCADE");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_logbook_bukti (
      id INT NOT NULL AUTO_INCREMENT,
      logbook_id INT NOT NULL,
      jenis_bukti ENUM('foto','pdf','xlsx','link','surat_tugas','draft_publikasi','lainnya') NOT NULL DEFAULT 'link',
      nama_file VARCHAR(255) NOT NULL,
      tautan_bukti VARCHAR(255) NULL,
      keterangan TEXT NULL,
      status_verifikasi ENUM('uploaded','verified','invalid') NOT NULL DEFAULT 'uploaded',
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureIndexExists("kinerja_logbook_bukti", "idx_kinerja_logbook_bukti_logbook", "ALTER TABLE kinerja_logbook_bukti ADD INDEX idx_kinerja_logbook_bukti_logbook (logbook_id)");
  await ensureForeignKeyExists("kinerja_logbook_bukti", "fk_kinerja_logbook_bukti_logbook", "ALTER TABLE kinerja_logbook_bukti ADD CONSTRAINT fk_kinerja_logbook_bukti_logbook FOREIGN KEY (logbook_id) REFERENCES kinerja_logbook (id) ON DELETE CASCADE ON UPDATE CASCADE");
  await ensureColumnExists("kinerja_logbook_bukti", "file_path", "file_path VARCHAR(255) NULL AFTER tautan_bukti");
  await ensureColumnExists("kinerja_logbook_bukti", "mime_type", "mime_type VARCHAR(120) NULL AFTER file_path");
  await ensureColumnExists("kinerja_logbook_bukti", "file_size", "file_size BIGINT NULL AFTER mime_type");
  await ensureColumnExists("kinerja_logbook_bukti", "original_file_name", "original_file_name VARCHAR(255) NULL AFTER file_size");
  await ensureColumnExists("kinerja_logbook_bukti", "current_version", "current_version INT NOT NULL DEFAULT 1 AFTER original_file_name");
  await ensureColumnExists("kinerja_logbook_bukti", "is_upload", "is_upload TINYINT(1) NOT NULL DEFAULT 0 AFTER current_version");
  await ensureColumnExists("kinerja_logbook_bukti", "is_archived", "is_archived TINYINT(1) NOT NULL DEFAULT 0 AFTER is_upload");
  await ensureColumnExists("kinerja_logbook_bukti", "archived_at", "archived_at TIMESTAMP NULL DEFAULT NULL AFTER is_archived");
  await ensureIndexExists("kinerja_logbook_bukti", "idx_kinerja_logbook_bukti_archived", "ALTER TABLE kinerja_logbook_bukti ADD INDEX idx_kinerja_logbook_bukti_archived (is_archived)");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_realisasi_indikator (
      id INT NOT NULL AUTO_INCREMENT,
      iki_pegawai_id INT NOT NULL,
      target_periodik_id INT NULL,
      periode_lapor VARCHAR(50) NULL,
      target DECIMAL(18,2) NULL,
      realisasi DECIMAL(18,2) NULL,
      persentase_capaian DECIMAL(8,2) NOT NULL DEFAULT 0,
      nilai_awal DECIMAL(8,2) NOT NULL DEFAULT 0,
      nilai_verifikasi DECIMAL(8,2) NULL,
      tanggal_lapor DATE NOT NULL,
      catatan_pegawai TEXT NULL,
      catatan_verifikator TEXT NULL,
      status ENUM('draft','submitted','verified','corrected','finalized') NOT NULL DEFAULT 'draft',
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureIndexExists("kinerja_realisasi_indikator", "idx_kinerja_realisasi_iki", "ALTER TABLE kinerja_realisasi_indikator ADD INDEX idx_kinerja_realisasi_iki (iki_pegawai_id)");
  await ensureIndexExists("kinerja_realisasi_indikator", "idx_kinerja_realisasi_target_periodik", "ALTER TABLE kinerja_realisasi_indikator ADD INDEX idx_kinerja_realisasi_target_periodik (target_periodik_id)");
  await ensureForeignKeyExists("kinerja_realisasi_indikator", "fk_kinerja_realisasi_iki", "ALTER TABLE kinerja_realisasi_indikator ADD CONSTRAINT fk_kinerja_realisasi_iki FOREIGN KEY (iki_pegawai_id) REFERENCES kinerja_iki_pegawai (id) ON DELETE CASCADE ON UPDATE CASCADE");
  await ensureForeignKeyExists("kinerja_realisasi_indikator", "fk_kinerja_realisasi_target_periodik", "ALTER TABLE kinerja_realisasi_indikator ADD CONSTRAINT fk_kinerja_realisasi_target_periodik FOREIGN KEY (target_periodik_id) REFERENCES kinerja_target_periodik (id) ON DELETE SET NULL ON UPDATE CASCADE");

  operationalSchemaReady = true;
};

const normalizeTaskPayload = (body: Record<string, unknown>) => {
  const startDate = readDateString(body.startDate, "Tanggal mulai");
  const endDate = readDateString(body.endDate, "Tanggal selesai");
  ensureDateRange(startDate, endDate);

  return {
    employeeId: readPositiveId(body.employeeId, "Pegawai"),
    periodeId: readOptionalPositiveId(body.periodeId, "Periode kinerja"),
    teamId: readOptionalPositiveId(body.teamId, "Tim kerja"),
    indicatorId: readOptionalPositiveId(body.indicatorId, "Indikator kinerja"),
    activityId: readOptionalPositiveId(body.activityId, "Kegiatan"),
    taskType: ensureOneOf(readTrimmedString(body.taskType || "individu").toLowerCase(), TASK_TYPES, "Jenis penugasan"),
    title: ensureRequired(readTrimmedString(body.title), "Judul penugasan wajib diisi"),
    startDate,
    endDate,
    priority: ensureOneOf(readTrimmedString(body.priority || "sedang").toLowerCase(), TASK_PRIORITIES, "Prioritas"),
    outputTarget: readTrimmedString(body.outputTarget),
    workRegion: readTrimmedString(body.workRegion),
    status: calculateAutomaticAssignmentStatus(startDate, endDate),
    progress: readIntegerInRange(body.progress ?? 0, 0, 100, "Progres"),
    note: readTrimmedString(body.note)
  };
};

const resolveAssignmentActivityDefaults = async (activityId: number | null) => {
  if (!activityId) {
    return { indicatorId: null as number | null, teamId: null as number | null };
  }

  const [rows] = await pool.query<any[]>(
    `SELECT kg.indikator_kinerja_id AS indicatorId,
            ik.tim_kerja_id AS teamId
     FROM kegiatan_indikator_kinerja kg
     LEFT JOIN indikator_kinerja ik ON ik.id = kg.indikator_kinerja_id
     WHERE kg.id = ?
     LIMIT 1`,
    [activityId]
  );

  if (!rows.length) {
    return { indicatorId: null as number | null, teamId: null as number | null };
  }

  return {
    indicatorId: rows[0].indicatorId ? Number(rows[0].indicatorId) : null,
    teamId: rows[0].teamId ? Number(rows[0].teamId) : null
  };
};


const resolveLogbookAssignmentDefaults = async (assignmentId: number | null) => {
  if (!assignmentId) {
    return {
      employeeId: null as number | null,
      periodeId: null as number | null,
      teamId: null as number | null,
      indicatorId: null as number | null,
      activityId: null as number | null
    };
  }

  const [rows] = await pool.query<any[]>(
    `SELECT pegawai_id AS employeeId,
            periode_id AS periodeId,
            tim_kerja_id AS teamId,
            indikator_kinerja_id AS indicatorId,
            kegiatan_id AS activityId
     FROM kinerja_assignment
     WHERE id = ?
     LIMIT 1`,
    [assignmentId]
  );

  if (!rows.length) {
    fail("Penugasan tidak ditemukan", 404);
  }

  return {
    employeeId: rows[0].employeeId ? Number(rows[0].employeeId) : null,
    periodeId: rows[0].periodeId ? Number(rows[0].periodeId) : null,
    teamId: rows[0].teamId ? Number(rows[0].teamId) : null,
    indicatorId: rows[0].indicatorId ? Number(rows[0].indicatorId) : null,
    activityId: rows[0].activityId ? Number(rows[0].activityId) : null
  };
};

const normalizeActivityPayload = (body: Record<string, unknown>) => {
  const rawStatus = normalizeActivityStatusValue(
    body.activityStatus ?? body.statusAktivitas ?? body.status ?? "draft"
  );
  const isRealtimeStatus = (ACTIVITY_STATUSES as readonly string[]).includes(rawStatus);
  const adminStatus = ensureOneOf(rawStatus, ADMIN_LOGBOOK_STATUSES, "Status logbook");
  const activityStatus = isRealtimeStatus
    ? ensureOneOf(rawStatus, ACTIVITY_STATUSES, "Status aktivitas")
    : null;

  return {
    employeeId: readOptionalPositiveId(body.employeeId, "Pegawai"),
    periodeId: readOptionalPositiveId(body.periodeId, "Periode kinerja"),
    assignmentId: readOptionalPositiveId(body.assignmentId, "Penugasan"),
    teamId: readOptionalPositiveId(body.teamId, "Tim kerja"),
    indicatorId: readOptionalPositiveId(body.indicatorId, "Indikator kinerja"),
    activityId: readOptionalPositiveId(body.activityId, "Kegiatan"),
    categoryId: readOptionalPositiveId(body.categoryId, "Kategori aktivitas"),
    unitId: readOptionalPositiveId(body.unitId, "Satuan"),
    activityDate: body.activityDate ? readDateString(body.activityDate, "Tanggal aktivitas") : getTodayDateOnly(),
    startTime: readOptionalTimeString(body.startTime),
    endTime: readOptionalTimeString(body.endTime),
    activity: ensureRequired(readTrimmedString(body.activity), "Uraian aktivitas wajib diisi"),
    volume: readOptionalNumber(body.volume, "Volume"),
    durationMinutes: body.durationMinutes === undefined || body.durationMinutes === null || body.durationMinutes === ""
      ? null
      : readIntegerInRange(body.durationMinutes, 0, 1000000, "Durasi"),
    output: readTrimmedString(body.output),
    status: adminStatus,
    activityStatus
  };
};

const normalizeEvidencePayload = (body: Record<string, unknown>) => ({
  activityId: readPositiveId(body.activityId, "Aktivitas"),
  evidenceType: ensureOneOf(readTrimmedString(body.evidenceType || "link").toLowerCase(), EVIDENCE_TYPES, "Jenis bukti"),
  fileName: ensureRequired(readTrimmedString(body.fileName), "Nama bukti wajib diisi"),
  evidenceUrl: readTrimmedString(body.evidenceUrl),
  note: readTrimmedString(body.note),
  verificationStatus: ensureOneOf(readTrimmedString(body.verificationStatus || "uploaded").toLowerCase(), EVIDENCE_VERIFICATION_STATUSES, "Status verifikasi")
});

const normalizeRealizationPayload = (body: Record<string, unknown>) => {
  const target = readOptionalNumber(body.target, "Target");
  const realization = readOptionalNumber(body.realization, "Realisasi");
  const achievement = calculateAchievement(target, realization);

  return {
    ikiPegawaiId: readPositiveId(body.ikiPegawaiId, "IKI Pegawai"),
    targetPeriodikId: readOptionalPositiveId(body.targetPeriodikId, "Target periodik"),
    periodLabel: readTrimmedString(body.periodLabel),
    target,
    realization,
    achievement,
    verificationScore: readOptionalNumber(body.verificationScore, "Nilai verifikasi"),
    reportDate: readDateString(body.reportDate, "Tanggal lapor"),
    employeeNote: readTrimmedString(body.employeeNote),
    verifierNote: readTrimmedString(body.verifierNote),
    status: ensureOneOf(readTrimmedString(body.status || "draft").toLowerCase(), REALIZATION_STATUSES, "Status realisasi")
  };
};

const buildTaskRecord = (row: any) => ({
  id: Number(row.id),
  employeeId: Number(row.employeeId),
  employeeName: String(row.employeeName || "-"),
  periodeId: row.periodeId == null ? null : Number(row.periodeId),
  periodeName: String(row.periodeName || "-"),
  teamId: row.teamId == null ? null : Number(row.teamId),
  teamName: String(row.teamName || "-"),
  indicatorId: row.indicatorId == null ? null : Number(row.indicatorId),
  indicatorName: String(row.indicatorName || "-"),
  activityId: row.activityId == null ? null : Number(row.activityId),
  activityName: String(row.activityName || "-"),
  taskType: String(row.taskType || "individu"),
  title: String(row.title || ""),
  startDate: row.startDate ? String(row.startDate) : null,
  endDate: row.endDate ? String(row.endDate) : null,
  priority: String(row.priority || "sedang"),
  outputTarget: String(row.outputTarget || ""),
  workRegion: String(row.workRegion || ""),
  status: String(row.status || "draft"),
  progress: Number(row.progress || 0),
  note: String(row.note || ""),
  createdAt: row.createdAt ? String(row.createdAt) : null,
  updatedAt: row.updatedAt ? String(row.updatedAt) : null
});

const buildActivityRecord = (row: any) => ({
  id: Number(row.id),
  employeeId: Number(row.employeeId),
  employeeName: String(row.employeeName || "-"),
  periodeId: row.periodeId == null ? null : Number(row.periodeId),
  periodeName: String(row.periodeName || "-"),
  assignmentId: row.assignmentId == null ? null : Number(row.assignmentId),
  assignmentTitle: String(row.assignmentTitle || "-"),
  teamId: row.teamId == null ? null : Number(row.teamId),
  teamName: String(row.teamName || "-"),
  indicatorId: row.indicatorId == null ? null : Number(row.indicatorId),
  indicatorName: String(row.indicatorName || "-"),
  activityId: row.activityId == null ? null : Number(row.activityId),
  activityName: String(row.activityName || "-"),
  categoryId: row.categoryId == null ? null : Number(row.categoryId),
  categoryName: String(row.categoryName || "-"),
  unitId: row.unitId == null ? null : Number(row.unitId),
  unitName: String(row.unitName || "-"),
  activityDate: String(row.activityDate || ""),
  startTime: row.startTime ? String(row.startTime) : null,
  endTime: row.endTime ? String(row.endTime) : null,
  activity: String(row.activity || ""),
  volume: row.volume == null ? null : Number(row.volume),
  durationMinutes: row.durationMinutes == null ? null : Number(row.durationMinutes),
  startedAt: row.startedAt ? String(row.startedAt) : null,
  pausedAt: row.pausedAt ? String(row.pausedAt) : null,
  resumedAt: row.resumedAt ? String(row.resumedAt) : null,
  finishedAt: row.finishedAt ? String(row.finishedAt) : null,
  totalPausedSeconds: Number(row.totalPausedSeconds || 0),
  activeDurationSeconds: asNullableNumber(row.activeDurationSeconds),
  serverNow: row.serverNow ? String(row.serverNow) : null,
  output: String(row.output || ""),
  activityStatus: row.activityStatus ? String(row.activityStatus) : null,
  status: String(row.activityStatus || row.status || "draft"),
  administrativeStatus: String(row.status || "draft"),
  evidenceCount: Number(row.evidenceCount || 0),
  createdAt: row.createdAt ? String(row.createdAt) : null,
  updatedAt: row.updatedAt ? String(row.updatedAt) : null
});

const buildEvidenceRecord = (row: any) => ({
  id: Number(row.id),
  activityId: Number(row.activityId),
  activityDate: String(row.activityDate || ""),
  employeeName: String(row.employeeName || "-"),
  activityName: String(row.activityName || "-"),
  evidenceType: String(row.evidenceType || "link"),
  fileName: String(row.fileName || ""),
  originalFileName: String(row.originalFileName || ""),
  evidenceUrl: String(row.evidenceUrl || ""),
  filePath: String(row.filePath || ""),
  fileUrl: String(row.fileUrl || ""),
  note: String(row.note || ""),
  verificationStatus: String(row.verificationStatus || "uploaded"),
  fileSize: row.fileSize == null ? null : Number(row.fileSize),
  mimeType: String(row.mimeType || ""),
  currentVersion: Number(row.currentVersion || 1),
  isUpload: Boolean(row.isUpload),
  isArchived: Boolean(row.isArchived),
  archivedAt: row.archivedAt ? String(row.archivedAt) : null,
  createdAt: row.createdAt ? String(row.createdAt) : null,
  updatedAt: row.updatedAt ? String(row.updatedAt) : null
});

const buildRealizationRecord = (row: any) => ({
  id: Number(row.id),
  ikiPegawaiId: Number(row.ikiPegawaiId),
  ikiName: String(row.ikiName || "-"),
  pegawaiId: Number(row.pegawaiId),
  pegawaiName: String(row.pegawaiName || "-"),
  targetPeriodikId: row.targetPeriodikId == null ? null : Number(row.targetPeriodikId),
  targetPeriodikLabel: String(row.targetPeriodikLabel || "-"),
  target: row.target == null ? null : Number(row.target),
  realization: row.realization == null ? null : Number(row.realization),
  achievementPercentage: Number(row.achievementPercentage || 0),
  initialScore: Number(row.initialScore || 0),
  verificationScore: row.verificationScore == null ? null : Number(row.verificationScore),
  reportDate: String(row.reportDate || ""),
  periodLabel: String(row.periodLabel || ""),
  employeeNote: String(row.employeeNote || ""),
  verifierNote: String(row.verifierNote || ""),
  status: String(row.status || "draft"),
  createdAt: row.createdAt ? String(row.createdAt) : null,
  updatedAt: row.updatedAt ? String(row.updatedAt) : null
});

export const getOperationalAssignments = asyncHandler(async (req: AuthenticatedRequest, res) => {
  await ensureOperationalSchema();
  await refreshOperationalAssignmentStatuses();
  const kegiatanNameColumn = await getKegiatanNameColumn();
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  const currentUser = req.user;
  const restrictToCurrentEmployee = currentUser?.role === "pegawai" && Number(currentUser?.employeeId || 0) > 0;
  const restrictToLeaderTeams = currentUser?.role === "ketua_tim" && Number(currentUser?.employeeId || 0) > 0;

  if (restrictToCurrentEmployee) {
    conditions.push(`a.pegawai_id = ?`);
    params.push(Number(currentUser?.employeeId));
  } else if (req.query.employeeId) {
    conditions.push(`a.pegawai_id = ?`);
    params.push(readPositiveId(req.query.employeeId, "Pegawai"));
  }

  if (restrictToLeaderTeams) {
    conditions.push(`a.tim_kerja_id IN (SELECT id FROM kinerja_tim_kerja WHERE ketua_pegawai_id = ?)`);
    params.push(Number(currentUser?.employeeId));
  }
  if (req.query.teamId) {
    conditions.push(`a.tim_kerja_id = ?`);
    params.push(readPositiveId(req.query.teamId, "Tim kerja"));
  }
  if (req.query.periodId) {
    conditions.push(`a.periode_id = ?`);
    params.push(readPositiveId(req.query.periodId, "Periode kinerja"));
  }
  if (req.query.indicatorId) {
    conditions.push(`a.indikator_kinerja_id = ?`);
    params.push(readPositiveId(req.query.indicatorId, "Indikator kinerja"));
  }
  if (req.query.activityId) {
    conditions.push(`a.kegiatan_id = ?`);
    params.push(readPositiveId(req.query.activityId, "Kegiatan"));
  }
  if (req.query.status) {
    conditions.push(`(${automaticAssignmentStatusSql}) = ?`);
    params.push(ensureOneOf(readTrimmedString(req.query.status).toLowerCase(), TASK_STATUSES, "Status penugasan"));
  }
  if (req.query.timekeeperActive) {
    const activeOnly = ["1", "true", "ya", "aktif", "active"].includes(readTrimmedString(req.query.timekeeperActive).toLowerCase());
    if (activeOnly) {
      conditions.push(`(${timekeeperAvailableAssignmentSql})`);
    }
  }
  if (req.query.month) {
    conditions.push(`MONTH(a.target_mulai) = ?`);
    params.push(readIntegerInRange(req.query.month, 1, 12, "Bulan"));
  }
  if (req.query.year) {
    conditions.push(`YEAR(a.target_mulai) = ?`);
    params.push(readIntegerInRange(req.query.year, 2020, 2100, "Tahun"));
  }
  if (req.query.search) {
    const keyword = `%${readTrimmedString(req.query.search)}%`;
    conditions.push(`(a.judul LIKE ? OR p.nama_lengkap LIKE ? OR ik.nama LIKE ? OR kg.${kegiatanNameColumn} LIKE ?)`);
    params.push(keyword, keyword, keyword, keyword);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [rows] = await pool.query<any[]>(
    `SELECT a.id,
            a.pegawai_id AS employeeId,
            COALESCE(p.nama_lengkap, '-') AS employeeName,
            a.periode_id AS periodeId,
            COALESCE(pr.nama_periode, '-') AS periodeName,
            a.tim_kerja_id AS teamId,
            COALESCE(tk.nama_tim, '-') AS teamName,
            a.indikator_kinerja_id AS indicatorId,
            COALESCE(ik.nama, '-') AS indicatorName,
            a.kegiatan_id AS activityId,
            COALESCE(kg.${kegiatanNameColumn}, '-') AS activityName,
            a.jenis_penugasan AS taskType,
            a.judul AS title,
            DATE_FORMAT(a.target_mulai, '%Y-%m-%d') AS startDate,
            DATE_FORMAT(a.target_selesai, '%Y-%m-%d') AS endDate,
            a.prioritas AS priority,
            COALESCE(a.output_target, '') AS outputTarget,
            COALESCE(a.wilayah_kerja, '') AS workRegion,
            ${assignmentDisplayStatusSql} AS status,
            CASE WHEN ${additionalAssignmentSql} THEN 1 ELSE 0 END AS isAdditionalAssignment,
            a.progres AS progress,
            COALESCE(a.note, '') AS note,
            a.dibuat_pada AS createdAt,
            a.diperbarui_pada AS updatedAt
     FROM kinerja_assignment a
     LEFT JOIN pegawai p ON p.id = a.pegawai_id
     LEFT JOIN kinerja_periode pr ON pr.id = a.periode_id
     LEFT JOIN kinerja_tim_kerja tk ON tk.id = a.tim_kerja_id
     LEFT JOIN indikator_kinerja ik ON ik.id = a.indikator_kinerja_id
     LEFT JOIN kegiatan_indikator_kinerja kg ON kg.id = a.kegiatan_id
     ${whereSql}
     ORDER BY a.target_mulai DESC, a.dibuat_pada DESC, a.id DESC`,
    params
  );

  return sendSuccess(res, rows.map(buildTaskRecord));
});

const ensureAssignmentMutationAllowed = (req: AuthenticatedRequest) => {
  if (req.user?.role === "pegawai") {
    fail("Role pegawai hanya dapat melihat daftar penugasan yang ditugaskan kepadanya", 403);
  }
};

export const createTimekeeperAdditionalAssignment = asyncHandler(async (req: AuthenticatedRequest, res) => {
  await ensureOperationalSchema();

  const currentUser = req.user;
  const employeeId = Number(currentUser?.employeeId || 0);
  if (!employeeId) {
    fail("Akun login belum terhubung ke data pegawai", 403);
  }

  const activity = ensureRequired(readTrimmedString((req.body || {}).activity), "Uraian kegiatan wajib diisi");
  const targetVolume = readOptionalNumber((req.body || {}).targetVolume, "Volume target");

  if (targetVolume === null || targetVolume <= 0) {
    fail("Volume target wajib diisi dan harus lebih dari 0", 400);
  }

  const [duplicateRows] = await pool.query<any[]>(
    `SELECT id
     FROM kinerja_assignment
     WHERE pegawai_id = ?
       AND note LIKE '%[TIMEKEEPER_ADDITIONAL]%'
       AND DATE(NOW()) BETWEEN DATE(target_mulai) AND DATE(target_selesai)
       AND LOWER(TRIM(judul)) = LOWER(TRIM(?))
     LIMIT 1`,
    [employeeId, activity]
  );

  if (duplicateRows.length) {
    fail("Uraian kegiatan Penugasan Tambahan sudah ada pada hari ini. Gunakan uraian kegiatan yang berbeda.", 409);
  }

  const targetText = Number(targetVolume).toLocaleString("id-ID", {
    minimumFractionDigits: Number(targetVolume) % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  });

  const note = `[TIMEKEEPER_ADDITIONAL] Penugasan tambahan dari Floating Activity Time Keeper. Uraian kegiatan: ${activity}. Volume target: ${targetText}. Lengkapi tim kerja, indikator, dan kegiatan melalui menu Kinerja -> Operasional -> Penugasan.`;

  const [periodRows] = await pool.query<any[]>(
    `SELECT id
     FROM kinerja_periode
     WHERE DATE(NOW()) BETWEEN tanggal_mulai AND tanggal_selesai
     ORDER BY CASE WHEN status = 'aktif' THEN 0 ELSE 1 END, tanggal_mulai DESC
     LIMIT 1`
  );

  const periodeId = periodRows[0]?.id ? Number(periodRows[0].id) : null;

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO kinerja_assignment
      (pegawai_id, periode_id, tim_kerja_id, indikator_kinerja_id, kegiatan_id, judul, jenis_penugasan, target_mulai, target_selesai, prioritas, output_target, wilayah_kerja, status, progres, note)
     VALUES (?, ?, NULL, NULL, NULL, ?, 'individu', CURDATE(), CURDATE(), 'sedang', ?, '', 'draft', 0, ?)`,
    [
      employeeId,
      periodeId,
      activity,
      targetText,
      note
    ]
  );

  return sendSuccess(res, { id: result.insertId, reused: false }, "Penugasan Tambahan berhasil dibuat", 201);
});

export const createOperationalAssignment = asyncHandler(async (req: AuthenticatedRequest, res) => {
  ensureAssignmentMutationAllowed(req);
  await ensureOperationalSchema();
  const payload = normalizeTaskPayload(req.body || {});
  await ensureRecordExists("pegawai", payload.employeeId, "Pegawai");
  if (payload.periodeId) await ensureRecordExists("kinerja_periode", payload.periodeId, "Periode kinerja");
  if (payload.activityId) await ensureRecordExists("kegiatan_indikator_kinerja", payload.activityId, "Kegiatan");

  const activityDefaults = await resolveAssignmentActivityDefaults(payload.activityId);
  const resolvedIndicatorId = payload.indicatorId || activityDefaults.indicatorId;
  const resolvedTeamId = payload.teamId || activityDefaults.teamId;

  if (resolvedTeamId) await ensureRecordExists("kinerja_tim_kerja", resolvedTeamId, "Tim kerja");
  if (resolvedIndicatorId) await ensureRecordExists("indikator_kinerja", resolvedIndicatorId, "Indikator kinerja");
  if (req.user?.role === "ketua_tim") {
    await ensureTeamLeaderAccess(Number(req.user?.employeeId || 0), resolvedTeamId);
  }

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO kinerja_assignment
      (pegawai_id, periode_id, tim_kerja_id, indikator_kinerja_id, kegiatan_id, judul, jenis_penugasan, target_mulai, target_selesai, prioritas, output_target, wilayah_kerja, status, progres, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.employeeId,
      payload.periodeId,
      resolvedTeamId,
      resolvedIndicatorId,
      payload.activityId,
      payload.title,
      payload.taskType,
      payload.startDate,
      payload.endDate,
      payload.priority,
      payload.outputTarget || null,
      payload.workRegion || null,
      payload.status,
      payload.progress,
      payload.note || null
    ]
  );

  return sendSuccess(res, { id: result.insertId }, "Penugasan berhasil ditambahkan", 201);
});

export const updateOperationalAssignment = asyncHandler(async (req: AuthenticatedRequest, res) => {
  ensureAssignmentMutationAllowed(req);
  await ensureOperationalSchema();
  const id = readPositiveId(req.params.id, "Penugasan");
  await ensureRecordExists("kinerja_assignment", id, "Penugasan");
  const payload = normalizeTaskPayload(req.body || {});
  await ensureRecordExists("pegawai", payload.employeeId, "Pegawai");
  if (payload.periodeId) await ensureRecordExists("kinerja_periode", payload.periodeId, "Periode kinerja");
  if (payload.activityId) await ensureRecordExists("kegiatan_indikator_kinerja", payload.activityId, "Kegiatan");

  const activityDefaults = await resolveAssignmentActivityDefaults(payload.activityId);
  const resolvedIndicatorId = payload.indicatorId || activityDefaults.indicatorId;
  const resolvedTeamId = payload.teamId || activityDefaults.teamId;

  if (resolvedTeamId) await ensureRecordExists("kinerja_tim_kerja", resolvedTeamId, "Tim kerja");
  if (resolvedIndicatorId) await ensureRecordExists("indikator_kinerja", resolvedIndicatorId, "Indikator kinerja");
  if (req.user?.role === "ketua_tim") {
    await ensureTeamLeaderAccess(Number(req.user?.employeeId || 0), resolvedTeamId);
  }

  await pool.query(
    `UPDATE kinerja_assignment
     SET pegawai_id = ?,
         periode_id = ?,
         tim_kerja_id = ?,
         indikator_kinerja_id = ?,
         kegiatan_id = ?,
         judul = ?,
         jenis_penugasan = ?,
         target_mulai = ?,
         target_selesai = ?,
         prioritas = ?,
         output_target = ?,
         wilayah_kerja = ?,
         status = ?,
         progres = ?,
         note = ?,
         diperbarui_pada = NOW()
     WHERE id = ?`,
    [
      payload.employeeId,
      payload.periodeId,
      resolvedTeamId,
      resolvedIndicatorId,
      payload.activityId,
      payload.title,
      payload.taskType,
      payload.startDate,
      payload.endDate,
      payload.priority,
      payload.outputTarget || null,
      payload.workRegion || null,
      payload.status,
      payload.progress,
      payload.note || null,
      id
    ]
  );

  return sendSuccess(res, null, "Penugasan berhasil diperbarui");
});

export const deleteOperationalAssignment = asyncHandler(async (req: AuthenticatedRequest, res) => {
  ensureAssignmentMutationAllowed(req);
  await ensureOperationalSchema();
  const id = readPositiveId(req.params.id, "Penugasan");
  const [result] = await pool.query<ResultSetHeader>(`DELETE FROM kinerja_assignment WHERE id = ?`, [id]);
  if (!result.affectedRows) fail("Penugasan tidak ditemukan", 404);
  return sendSuccess(res, null, "Penugasan berhasil dihapus");
});

export const getOperationalActivities = asyncHandler(async (req: AuthenticatedRequest, res) => {
  await ensureOperationalSchema();
  const kegiatanNameColumn = await getKegiatanNameColumn();
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  const currentUser = req.user;
  const restrictToCurrentEmployee = currentUser?.role === "pegawai" && Number(currentUser?.employeeId || 0) > 0;

  if (restrictToCurrentEmployee) {
    conditions.push(`l.pegawai_id = ?`);
    params.push(Number(currentUser?.employeeId));
  } else if (req.query.employeeId) {
    conditions.push(`l.pegawai_id = ?`);
    params.push(readPositiveId(req.query.employeeId, "Pegawai"));
  }
  if (req.query.id) {
    conditions.push(`l.id = ?`);
    params.push(readPositiveId(req.query.id, "Aktivitas"));
  }
  if (req.query.activeTimekeeper) {
    const activeOnly = ["1", "true", "ya", "aktif", "active"].includes(readTrimmedString(req.query.activeTimekeeper).toLowerCase());
    if (activeOnly) {
      conditions.push(`${activityStatusSql('l')} IN ('berjalan', 'jeda')`);
    }
  }
  if (req.query.assignmentId) {
    conditions.push(`l.assignment_id = ?`);
    params.push(readPositiveId(req.query.assignmentId, "Penugasan"));
  }
  if (req.query.periodId) {
    conditions.push(`l.periode_id = ?`);
    params.push(readPositiveId(req.query.periodId, "Periode kinerja"));
  }
  if (req.query.indicatorId) {
    conditions.push(`l.indikator_kinerja_id = ?`);
    params.push(readPositiveId(req.query.indicatorId, "Indikator kinerja"));
  }
  if (req.query.activityId) {
    conditions.push(`l.kegiatan_id = ?`);
    params.push(readPositiveId(req.query.activityId, "Kegiatan"));
  }
  if (req.query.status) {
    conditions.push(`${activityStatusSql('l')} = ?`);
    params.push(ensureOneOf(normalizeActivityStatusValue(req.query.status), ACTIVITY_STATUSES, "Status aktivitas"));
  }
  if (req.query.month) {
    conditions.push(`MONTH(l.tanggal_kegiatan) = ?`);
    params.push(readIntegerInRange(req.query.month, 1, 12, "Bulan"));
  }
  if (req.query.year) {
    conditions.push(`YEAR(l.tanggal_kegiatan) = ?`);
    params.push(readIntegerInRange(req.query.year, 2020, 2100, "Tahun"));
  }
  if (req.query.search) {
    const keyword = `%${readTrimmedString(req.query.search)}%`;
    conditions.push(`(l.uraian_kegiatan LIKE ? OR p.nama_lengkap LIKE ? OR kg.${kegiatanNameColumn} LIKE ? OR ik.nama LIKE ?)`);
    params.push(keyword, keyword, keyword, keyword);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [rows] = await pool.query<any[]>(
    `SELECT l.id,
            l.pegawai_id AS employeeId,
            COALESCE(p.nama_lengkap, '-') AS employeeName,
            l.periode_id AS periodeId,
            COALESCE(pr.nama_periode, '-') AS periodeName,
            l.assignment_id AS assignmentId,
            COALESCE(a.judul, '-') AS assignmentTitle,
            l.tim_kerja_id AS teamId,
            COALESCE(tk.nama_tim, '-') AS teamName,
            l.indikator_kinerja_id AS indicatorId,
            COALESCE(ik.nama, '-') AS indicatorName,
            l.kegiatan_id AS activityId,
            COALESCE(kg.${kegiatanNameColumn}, '-') AS activityName,
            l.kategori_id AS categoryId,
            COALESCE(ka.nama_kategori, '-') AS categoryName,
            l.satuan_id AS unitId,
            COALESCE(ku.nama_satuan, '-') AS unitName,
            DATE_FORMAT(l.tanggal_kegiatan, '%Y-%m-%d') AS activityDate,
            TIME_FORMAT(l.jam_mulai, '%H:%i') AS startTime,
            TIME_FORMAT(l.jam_selesai, '%H:%i') AS endTime,
            l.uraian_kegiatan AS activity,
            l.volume,
            ${getTimerDurationMinutesSql('l')} AS durationMinutes,
            DATE_FORMAT(l.started_at, '%Y-%m-%dT%H:%i:%s') AS startedAt,
            DATE_FORMAT(l.paused_at, '%Y-%m-%dT%H:%i:%s') AS pausedAt,
            DATE_FORMAT(l.resumed_at, '%Y-%m-%dT%H:%i:%s') AS resumedAt,
            DATE_FORMAT(l.finished_at, '%Y-%m-%dT%H:%i:%s') AS finishedAt,
            COALESCE(l.total_paused_seconds, 0) AS totalPausedSeconds,
            ${getTimerDurationSecondsSql('l')} AS activeDurationSeconds,
            DATE_FORMAT(NOW(), '%Y-%m-%dT%H:%i:%s') AS serverNow,
            COALESCE(l.output_kegiatan, '') AS output,
            ${activityStatusSql('l')} AS activityStatus,
            l.status,
            (
              SELECT COUNT(*)
              FROM kinerja_logbook_bukti lb
              WHERE lb.logbook_id = l.id
            ) AS evidenceCount,
            l.dibuat_pada AS createdAt,
            l.diperbarui_pada AS updatedAt
     FROM kinerja_logbook l
     LEFT JOIN pegawai p ON p.id = l.pegawai_id
     LEFT JOIN kinerja_periode pr ON pr.id = l.periode_id
     LEFT JOIN kinerja_assignment a ON a.id = l.assignment_id
     LEFT JOIN kinerja_tim_kerja tk ON tk.id = l.tim_kerja_id
     LEFT JOIN indikator_kinerja ik ON ik.id = l.indikator_kinerja_id
     LEFT JOIN kegiatan_indikator_kinerja kg ON kg.id = l.kegiatan_id
     LEFT JOIN kinerja_kategori_aktivitas ka ON ka.id = l.kategori_id
     LEFT JOIN kinerja_satuan ku ON ku.id = l.satuan_id
     ${whereSql}
     ORDER BY l.tanggal_kegiatan DESC, l.dibuat_pada DESC, l.id DESC`,
    params
  );

  return sendSuccess(res, rows.map(buildActivityRecord));
});

export const createOperationalActivity = asyncHandler(async (req: AuthenticatedRequest, res) => {
  await ensureOperationalSchema();
  const payload = normalizeActivityPayload(req.body || {});
  const currentUser = req.user;
  const assignmentDefaults = await resolveLogbookAssignmentDefaults(payload.assignmentId);

  const loginEmployeeId = Number(currentUser?.employeeId || 0);
  const resolvedEmployeeId = currentUser?.role === "pegawai"
    ? loginEmployeeId
    : assignmentDefaults.employeeId || payload.employeeId || loginEmployeeId;
  const resolvedPeriodeId = assignmentDefaults.periodeId || payload.periodeId;
  const resolvedTeamId = assignmentDefaults.teamId || payload.teamId;
  const resolvedIndicatorId = assignmentDefaults.indicatorId || payload.indicatorId;
  const resolvedActivityId = assignmentDefaults.activityId || payload.activityId;

  if (currentUser?.role === "pegawai" && assignmentDefaults.employeeId && assignmentDefaults.employeeId !== resolvedEmployeeId) {
    fail("Pegawai hanya dapat mencatat aktivitas dari penugasan miliknya sendiri", 403);
  }

  await ensureRecordExists("pegawai", resolvedEmployeeId, "Pegawai");
  if (resolvedPeriodeId) await ensureRecordExists("kinerja_periode", resolvedPeriodeId, "Periode kinerja");
  if (payload.assignmentId) await ensureRecordExists("kinerja_assignment", payload.assignmentId, "Penugasan");
  if (resolvedTeamId) await ensureRecordExists("kinerja_tim_kerja", resolvedTeamId, "Tim kerja");
  if (resolvedIndicatorId) await ensureRecordExists("indikator_kinerja", resolvedIndicatorId, "Indikator kinerja");
  if (resolvedActivityId) await ensureRecordExists("kegiatan_indikator_kinerja", resolvedActivityId, "Kegiatan");
  if (payload.categoryId) await ensureRecordExists("kinerja_kategori_aktivitas", payload.categoryId, "Kategori aktivitas");
  if (payload.unitId) await ensureRecordExists("kinerja_satuan", payload.unitId, "Satuan");

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    if (payload.activityStatus === "berjalan") {
      const [runningRows] = await connection.query<any[]>(
        `SELECT id
         FROM kinerja_logbook
         WHERE pegawai_id = ?
           AND COALESCE(status_aktivitas, CASE WHEN status = 'dijeda' THEN 'jeda' ELSE status END) = 'berjalan'
         LIMIT 1
         FOR UPDATE`,
        [resolvedEmployeeId]
      );

      if (runningRows.length) {
        fail("Pegawai ini masih memiliki aktivitas berjalan. Jeda atau selesaikan aktivitas tersebut sebelum memulai aktivitas lain.", 409);
      }
    }

    const [result] = await connection.query<ResultSetHeader>(
      `INSERT INTO kinerja_logbook
        (pegawai_id, periode_id, assignment_id, tim_kerja_id, indikator_kinerja_id, kegiatan_id, kategori_id, tanggal_kegiatan, jam_mulai, jam_selesai, uraian_kegiatan, volume, satuan_id, durasi_menit, started_at, paused_at, resumed_at, finished_at, total_paused_seconds, last_activity_at, output_kegiatan, status, status_aktivitas)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         CASE WHEN CAST(? AS TEXT) IS NOT NULL THEN NOW() ELSE NULL END,
         CASE WHEN ? = 'jeda' THEN NOW() ELSE NULL END,
         CASE WHEN ? = 'berjalan' THEN NOW() ELSE NULL END,
         CASE WHEN ? = 'selesai' THEN NOW() ELSE NULL END,
         0,
         CASE WHEN CAST(? AS TEXT) IS NOT NULL THEN NOW() ELSE NULL END,
         ?, ?, ?)`,
      [
        resolvedEmployeeId,
        resolvedPeriodeId,
        payload.assignmentId,
        resolvedTeamId,
        resolvedIndicatorId,
        resolvedActivityId,
        payload.categoryId,
        payload.activityDate,
        payload.startTime,
        payload.activityStatus === "berjalan" ? null : payload.endTime,
        payload.activity,
        payload.volume,
        payload.unitId,
        payload.activityStatus === "selesai" ? Math.max(1, Number(payload.durationMinutes || 1)) : 0,
        payload.activityStatus,
        payload.activityStatus,
        payload.activityStatus,
        payload.activityStatus,
        payload.activityStatus,
        payload.output || null,
        payload.status,
        payload.activityStatus
      ]
    );

    const createdActivityStatus = payload.activityStatus || null;
    const createdAction = getActivityHistoryAction(null, createdActivityStatus);
    if (createdAction && createdActivityStatus) {
      await writeActivityHistory(connection, {
        activityId: result.insertId,
        employeeId: resolvedEmployeeId,
        action: createdAction,
        oldStatus: null,
        newStatus: createdActivityStatus,
        newValue: {
          uraian_aktivitas: payload.activity,
          volume_realisasi: payload.volume,
          satuan_id: payload.unitId
        },
        note: "Aktivitas dibuat dan status awal tersimpan dari Time Keeper"
      });
    }

    await connection.query(
      `UPDATE kinerja_logbook
       SET durasi_menit = ${getTimerDurationMinutesSql('kinerja_logbook')}
       WHERE id = ?`,
      [result.insertId]
    );

    await connection.commit();
    await syncAssignmentProgressByRealization(payload.assignmentId);

    return sendSuccess(res, { id: result.insertId }, "Aktivitas berhasil ditambahkan", 201);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

export const updateOperationalActivity = asyncHandler(async (req: AuthenticatedRequest, res) => {
  await ensureOperationalSchema();
  const id = readPositiveId(req.params.id, "Aktivitas");
  const payload = normalizeActivityPayload(req.body || {});
  const currentUser = req.user;
  const assignmentDefaults = await resolveLogbookAssignmentDefaults(payload.assignmentId);

  const loginEmployeeId = Number(currentUser?.employeeId || 0);
  const resolvedEmployeeId = currentUser?.role === "pegawai"
    ? loginEmployeeId
    : assignmentDefaults.employeeId || payload.employeeId || loginEmployeeId;
  const resolvedPeriodeId = assignmentDefaults.periodeId || payload.periodeId;
  const resolvedTeamId = assignmentDefaults.teamId || payload.teamId;
  const resolvedIndicatorId = assignmentDefaults.indicatorId || payload.indicatorId;
  const resolvedActivityId = assignmentDefaults.activityId || payload.activityId;

  if (currentUser?.role === "pegawai" && assignmentDefaults.employeeId && assignmentDefaults.employeeId !== resolvedEmployeeId) {
    fail("Pegawai hanya dapat memperbarui aktivitas dari penugasan miliknya sendiri", 403);
  }

  await ensureRecordExists("pegawai", resolvedEmployeeId, "Pegawai");
  if (resolvedPeriodeId) await ensureRecordExists("kinerja_periode", resolvedPeriodeId, "Periode kinerja");
  if (payload.assignmentId) await ensureRecordExists("kinerja_assignment", payload.assignmentId, "Penugasan");
  if (resolvedTeamId) await ensureRecordExists("kinerja_tim_kerja", resolvedTeamId, "Tim kerja");
  if (resolvedIndicatorId) await ensureRecordExists("indikator_kinerja", resolvedIndicatorId, "Indikator kinerja");
  if (resolvedActivityId) await ensureRecordExists("kegiatan_indikator_kinerja", resolvedActivityId, "Kegiatan");
  if (payload.categoryId) await ensureRecordExists("kinerja_kategori_aktivitas", payload.categoryId, "Kategori aktivitas");
  if (payload.unitId) await ensureRecordExists("kinerja_satuan", payload.unitId, "Satuan");

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [existingRows] = await connection.query<any[]>(
      `SELECT id,
              assignment_id AS assignmentId,
              status,
              status_aktivitas AS activityStatus,
              uraian_kegiatan AS activity,
              volume,
              satuan_id AS unitId,
              started_at AS startedAt,
              paused_at AS pausedAt,
              resumed_at AS resumedAt,
              finished_at AS finishedAt,
              COALESCE(total_paused_seconds, 0) AS totalPausedSeconds
       FROM kinerja_logbook
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [id]
    );

    if (!existingRows.length) {
      fail("Aktivitas tidak ditemukan", 404);
    }

    const previousAssignmentId = existingRows[0]?.assignmentId ? Number(existingRows[0].assignmentId) : null;
    const previousActivityStatus = normalizeActivityStatusValue(existingRows[0]?.activityStatus || existingRows[0]?.status || "");

    if (previousActivityStatus === "selesai" && payload.activityStatus && payload.activityStatus !== "selesai") {
      fail("Aktivitas yang sudah selesai tidak dapat dijalankan atau dijeda kembali. Gunakan fitur edit data selesai bila perubahan administratif memang diperlukan.", 409);
    }

    if (payload.activityStatus === "berjalan") {
      const [runningRows] = await connection.query<any[]>(
        `SELECT id
         FROM kinerja_logbook
         WHERE pegawai_id = ?
           AND COALESCE(status_aktivitas, CASE WHEN status = 'dijeda' THEN 'jeda' ELSE status END) = 'berjalan'
           AND id <> ?
         LIMIT 1
         FOR UPDATE`,
        [resolvedEmployeeId, id]
      );

      if (runningRows.length) {
        fail("Pegawai ini masih memiliki aktivitas berjalan. Jeda atau selesaikan aktivitas tersebut sebelum memulai aktivitas lain.", 409);
      }
    }

    await connection.query(
      `UPDATE kinerja_logbook
       SET pegawai_id = ?,
           periode_id = ?,
           assignment_id = ?,
           tim_kerja_id = ?,
           indikator_kinerja_id = ?,
           kegiatan_id = ?,
           kategori_id = ?,
           tanggal_kegiatan = ?,
           jam_mulai = COALESCE(jam_mulai, ?),
           jam_selesai = CASE
             WHEN ? = 'berjalan' THEN NULL
             WHEN ? = 'jeda' THEN (COALESCE(paused_at, NOW()))::time
             WHEN ? = 'selesai' THEN (COALESCE(finished_at, paused_at, NOW()))::time
             ELSE COALESCE(?, jam_selesai)
           END,
           uraian_kegiatan = ?,
           volume = ?,
           satuan_id = ?,
           started_at = CASE
             WHEN CAST(? AS TEXT) IS NOT NULL THEN COALESCE(started_at, NOW())
             ELSE started_at
           END,
           total_paused_seconds = CASE
             WHEN ${activityStatusSql('kinerja_logbook')} = 'jeda' AND ? = 'berjalan' AND paused_at IS NOT NULL THEN COALESCE(total_paused_seconds, 0) + GREATEST(0, TIMESTAMPDIFF(SECOND, paused_at, NOW()))
             ELSE COALESCE(total_paused_seconds, 0)
           END,
           paused_at = CASE
             WHEN ? = 'berjalan' THEN NULL
             WHEN ? = 'jeda' THEN COALESCE(paused_at, NOW())
             WHEN ? = 'selesai' THEN paused_at
             ELSE paused_at
           END,
           resumed_at = CASE
             WHEN ? = 'berjalan' THEN NOW()
             ELSE resumed_at
           END,
           finished_at = CASE
             WHEN ? = 'selesai' THEN CASE WHEN ${activityStatusSql('kinerja_logbook')} = 'jeda' THEN COALESCE(paused_at, NOW()) ELSE NOW() END
             WHEN ? IN ('berjalan', 'jeda') THEN NULL
             ELSE finished_at
           END,
           status_aktivitas = COALESCE(?, status_aktivitas),
           last_activity_at = CASE
             WHEN CAST(? AS TEXT) IS NOT NULL THEN NOW()
             ELSE last_activity_at
           END,
           output_kegiatan = ?,
           status = ?,
           diperbarui_pada = NOW()
       WHERE id = ?`,
      [
        resolvedEmployeeId,
        resolvedPeriodeId,
        payload.assignmentId,
        resolvedTeamId,
        resolvedIndicatorId,
        resolvedActivityId,
        payload.categoryId,
        payload.activityDate,
        payload.startTime,
        payload.activityStatus,
        payload.activityStatus,
        payload.activityStatus,
        payload.endTime,
        payload.activity,
        payload.volume,
        payload.unitId,
        payload.activityStatus,
        payload.activityStatus,
        payload.activityStatus,
        payload.activityStatus,
        payload.activityStatus,
        payload.activityStatus,
        payload.activityStatus,
        payload.activityStatus,
        payload.activityStatus,
        payload.activityStatus,
        payload.output || null,
        payload.status,
        id
      ]
    );

    await connection.query(
      `UPDATE kinerja_logbook
       SET durasi_menit = ${getTimerDurationMinutesSql('kinerja_logbook')}
       WHERE id = ?`,
      [id]
    );

    const nextActivityStatus = payload.activityStatus || previousActivityStatus || null;
    const statusAction = getActivityHistoryAction(previousActivityStatus || null, payload.activityStatus || null);
    if (statusAction && payload.activityStatus) {
      await writeActivityHistory(connection, {
        activityId: id,
        employeeId: resolvedEmployeeId,
        action: statusAction,
        oldStatus: previousActivityStatus || null,
        newStatus: nextActivityStatus,
        note: "Perubahan status aktivitas tersimpan otomatis dari Time Keeper"
      });
    }

    const existingActivity = String(existingRows[0]?.activity || "");
    const existingVolume = existingRows[0]?.volume == null ? null : Number(existingRows[0].volume);
    const existingUnitId = existingRows[0]?.unitId == null ? null : Number(existingRows[0].unitId);

    if (!valuesAreEqual(existingActivity, payload.activity)) {
      await writeActivityFieldHistory(connection, {
        activityId: id,
        employeeId: resolvedEmployeeId,
        action: "ubah_uraian",
        field: "uraian_aktivitas",
        oldValue: existingActivity,
        newValue: payload.activity,
        note: "Uraian aktivitas berubah"
      });
    }

    if (!numbersAreEqual(existingVolume, payload.volume)) {
      await writeActivityFieldHistory(connection, {
        activityId: id,
        employeeId: resolvedEmployeeId,
        action: "ubah_volume",
        field: "volume_realisasi",
        oldValue: existingVolume,
        newValue: payload.volume,
        note: "Volume realisasi berubah"
      });
    }

    if (!valuesAreEqual(existingUnitId, payload.unitId)) {
      await writeActivityFieldHistory(connection, {
        activityId: id,
        employeeId: resolvedEmployeeId,
        action: "ubah_satuan",
        field: "satuan_id",
        oldValue: existingUnitId,
        newValue: payload.unitId,
        note: "Satuan realisasi berubah"
      });
    }

    await connection.commit();

    await syncAssignmentProgressByRealization(previousAssignmentId);
    if (previousAssignmentId !== payload.assignmentId) {
      await syncAssignmentProgressByRealization(payload.assignmentId);
    }

    return sendSuccess(res, { id }, "Aktivitas berhasil diperbarui");
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});


export const getOperationalActivityHistory = asyncHandler(async (req: AuthenticatedRequest, res) => {
  await ensureOperationalSchema();

  const id = readPositiveId(req.params.id, "Aktivitas");
  const kegiatanNameColumn = await getKegiatanNameColumn();
  const currentUser = req.user;
  const conditions = ["l.id = ?"];
  const params: Array<number | string> = [id];

  if (currentUser?.role === "pegawai" && Number(currentUser?.employeeId || 0) > 0) {
    conditions.push("l.pegawai_id = ?");
    params.push(Number(currentUser.employeeId));
  }

  const [rows] = await pool.query<any[]>(
    `SELECT l.id,
            l.pegawai_id AS employeeId,
            COALESCE(p.nama_lengkap, '-') AS employeeName,
            COALESCE(d.nama, '-') AS departmentName,
            l.periode_id AS periodeId,
            COALESCE(per.nama_periode, '') AS periodeName,
            l.assignment_id AS assignmentId,
            COALESCE(a.judul, '-') AS assignmentTitle,
            COALESCE(l.tim_kerja_id, a.tim_kerja_id) AS teamId,
            COALESCE(tk.nama_tim, atk.nama_tim, '-') AS teamName,
            l.indikator_kinerja_id AS indicatorId,
            COALESCE(ik.nama, '') AS indicatorName,
            l.kegiatan_id AS activityId,
            COALESCE(kg.${kegiatanNameColumn}, '') AS activityName,
            l.kategori_id AS categoryId,
            COALESCE(ka.nama_kategori, '') AS categoryName,
            l.satuan_id AS unitId,
            COALESCE(s.nama_satuan, '-') AS unitName,
            DATE_FORMAT(l.tanggal_kegiatan, '%Y-%m-%d') AS activityDate,
            l.jam_mulai AS startTime,
            l.jam_selesai AS endTime,
            l.volume,
            ${getTimerDurationMinutesSql('l')} AS durationMinutes,
            DATE_FORMAT(l.started_at, '%Y-%m-%dT%H:%i:%s') AS startedAt,
            DATE_FORMAT(l.paused_at, '%Y-%m-%dT%H:%i:%s') AS pausedAt,
            DATE_FORMAT(l.resumed_at, '%Y-%m-%dT%H:%i:%s') AS resumedAt,
            DATE_FORMAT(l.finished_at, '%Y-%m-%dT%H:%i:%s') AS finishedAt,
            COALESCE(l.total_paused_seconds, 0) AS totalPausedSeconds,
            ${getTimerDurationSecondsSql('l')} AS activeDurationSeconds,
            DATE_FORMAT(NOW(), '%Y-%m-%dT%H:%i:%s') AS serverNow,
            l.uraian_kegiatan AS activity,
            COALESCE(l.output_kegiatan, '') AS output,
            0 AS evidenceCount,
            ${activityStatusSql('l')} AS activityStatus,
            l.status,
            DATE_FORMAT(l.dibuat_pada, '%Y-%m-%dT%H:%i:%s') AS createdAt,
            DATE_FORMAT(l.diperbarui_pada, '%Y-%m-%dT%H:%i:%s') AS updatedAt
     FROM kinerja_logbook l
     LEFT JOIN pegawai p ON p.id = l.pegawai_id
     LEFT JOIN departemen d ON d.id = p.departemen_id
     LEFT JOIN kinerja_periode per ON per.id = l.periode_id
     LEFT JOIN kinerja_assignment a ON a.id = l.assignment_id
     LEFT JOIN kinerja_tim_kerja tk ON tk.id = l.tim_kerja_id
     LEFT JOIN kinerja_tim_kerja atk ON atk.id = a.tim_kerja_id
     LEFT JOIN indikator_kinerja ik ON ik.id = l.indikator_kinerja_id
     LEFT JOIN kegiatan_indikator_kinerja kg ON kg.id = l.kegiatan_id
     LEFT JOIN kinerja_kategori_aktivitas ka ON ka.id = l.kategori_id
     LEFT JOIN kinerja_satuan s ON s.id = l.satuan_id
     WHERE ${conditions.join(" AND ")}
     LIMIT 1`,
    params
  );

  if (!rows.length) {
    fail("Aktivitas tidak ditemukan atau tidak dapat diakses", 404);
  }

  const [historyRows] = await pool.query<any[]>(
    `SELECT id,
            activity_id AS activityId,
            pegawai_id AS employeeId,
            action,
            old_status AS oldStatus,
            new_status AS newStatus,
            old_value AS oldValue,
            new_value AS newValue,
            note,
            DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s') AS createdAt
     FROM kinerja_activity_histories
     WHERE activity_id = ?
     ORDER BY created_at ASC, id ASC`,
    [id]
  );

  return sendSuccess(res, {
    record: {
      ...buildActivityRecord(rows[0]),
      departmentName: String(rows[0]?.departmentName || "-")
    },
    histories: historyRows.map(buildActivityHistoryRecord)
  });
});


export const pauseActiveTimekeeperActivity = asyncHandler(async (req: AuthenticatedRequest, res) => {
  await ensureOperationalSchema();

  const employeeId = Number(req.user?.employeeId || 0);
  if (!employeeId) {
    fail("Akun login belum terhubung ke data pegawai", 403);
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [runningRows] = await connection.query<any[]>(
      `SELECT id
       FROM kinerja_logbook
       WHERE pegawai_id = ?
         AND ${activityStatusSql('kinerja_logbook')} = 'berjalan'
       FOR UPDATE`,
      [employeeId]
    );

    if (!runningRows.length) {
      await connection.commit();
      return sendSuccess(res, { pausedCount: 0 }, "Tidak ada aktivitas berjalan yang perlu dijeda");
    }

    await connection.query(
      `UPDATE kinerja_logbook
       SET paused_at = COALESCE(paused_at, NOW()),
           jam_selesai = (COALESCE(paused_at, NOW()))::time,
           status_aktivitas = 'jeda',
           status = CASE WHEN status IN ('berjalan', 'jeda', 'dijeda', 'selesai') THEN 'jeda' ELSE status END,
           last_activity_at = NOW(),
           diperbarui_pada = NOW()
       WHERE pegawai_id = ?
         AND ${activityStatusSql('kinerja_logbook')} = 'berjalan'`,
      [employeeId]
    );

    await connection.query(
      `UPDATE kinerja_logbook
       SET durasi_menit = ${getTimerDurationMinutesSql('kinerja_logbook')}
       WHERE id IN (${runningRows.map(() => "?").join(",")})`,
      runningRows.map((row) => Number(row.id))
    );

    for (const row of runningRows) {
      await writeActivityHistory(connection, {
        activityId: Number(row.id),
        employeeId,
        action: "jeda",
        oldStatus: "berjalan",
        newStatus: "jeda",
        note: "Aktivitas dijeda otomatis saat logout atau browser ditutup"
      });
    }

    await connection.commit();
    return sendSuccess(res, { pausedCount: runningRows.length }, "Aktivitas berjalan berhasil dijeda");
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

export const deleteOperationalActivity = asyncHandler(async (req, res) => {
  await ensureOperationalSchema();
  const id = readPositiveId(req.params.id, "Aktivitas");
  const [existingRows] = await pool.query<any[]>(`SELECT assignment_id AS assignmentId FROM kinerja_logbook WHERE id = ? LIMIT 1`, [id]);
  const assignmentId = existingRows[0]?.assignmentId ? Number(existingRows[0].assignmentId) : null;
  const [result] = await pool.query<ResultSetHeader>(`DELETE FROM kinerja_logbook WHERE id = ?`, [id]);
  if (!result.affectedRows) fail("Aktivitas tidak ditemukan", 404);
  await syncAssignmentProgressByRealization(assignmentId);
  return sendSuccess(res, null, "Aktivitas berhasil dihapus");
});

export const getActivityEvidences = asyncHandler(async (req, res) => {
  await ensureOperationalSchema();
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  const includeArchived = ["1", "true", "ya"].includes(String(req.query.archived || "").toLowerCase());

  conditions.push(`b.is_archived = ?`);
  params.push(includeArchived ? 1 : 0);

  if (req.query.activityId) {
    conditions.push(`b.logbook_id = ?`);
    params.push(readPositiveId(req.query.activityId, "Aktivitas"));
  }
  if (req.query.status) {
    conditions.push(`b.status_verifikasi = ?`);
    params.push(ensureOneOf(readTrimmedString(req.query.status).toLowerCase(), EVIDENCE_VERIFICATION_STATUSES, "Status verifikasi"));
  }
  if (req.query.search) {
    const keyword = `%${readTrimmedString(req.query.search)}%`;
    conditions.push(`(b.nama_file LIKE ? OR l.uraian_kegiatan LIKE ? OR p.nama_lengkap LIKE ? OR b.original_file_name LIKE ?)`);
    params.push(keyword, keyword, keyword, keyword);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [rows] = await pool.query<any[]>(
    `SELECT b.id,
            b.logbook_id AS activityId,
            DATE_FORMAT(l.tanggal_kegiatan, '%Y-%m-%d') AS activityDate,
            COALESCE(p.nama_lengkap, '-') AS employeeName,
            l.uraian_kegiatan AS activityName,
            b.jenis_bukti AS evidenceType,
            b.nama_file AS fileName,
            COALESCE(b.original_file_name, '') AS originalFileName,
            COALESCE(b.tautan_bukti, '') AS evidenceUrl,
            COALESCE(b.file_path, '') AS filePath,
            COALESCE(b.file_path, '') AS fileUrl,
            COALESCE(b.keterangan, '') AS note,
            b.status_verifikasi AS verificationStatus,
            b.file_size AS fileSize,
            COALESCE(b.mime_type, '') AS mimeType,
            b.current_version AS currentVersion,
            b.is_upload AS isUpload,
            b.is_archived AS isArchived,
            b.archived_at AS archivedAt,
            b.dibuat_pada AS createdAt,
            b.diperbarui_pada AS updatedAt
     FROM kinerja_logbook_bukti b
     INNER JOIN kinerja_logbook l ON l.id = b.logbook_id
     LEFT JOIN pegawai p ON p.id = l.pegawai_id
     ${whereSql}
     ORDER BY b.dibuat_pada DESC, b.id DESC`,
    params
  );

  const origin = `${req.protocol}://${req.get("host")}`;
  const data = rows.map((row) =>
    buildEvidenceRecord({
      ...row,
      fileUrl: row.filePath ? `${origin}${String(row.filePath).startsWith('/') ? row.filePath : `/${row.filePath}`}` : ""
    })
  );

  return sendSuccess(res, data);
});

export const createActivityEvidence = asyncHandler(async (req, res) => {
  await ensureOperationalSchema();
  const payload = normalizeEvidencePayload(req.body || {});
  await ensureRecordExists("kinerja_logbook", payload.activityId, "Aktivitas");

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO kinerja_logbook_bukti
      (logbook_id, jenis_bukti, nama_file, tautan_bukti, keterangan, status_verifikasi, current_version, is_upload, is_archived)
     VALUES (?, ?, ?, ?, ?, ?, 1, 0, 0)`,
    [payload.activityId, payload.evidenceType, payload.fileName, payload.evidenceUrl || null, payload.note || null, payload.verificationStatus]
  );

  return sendSuccess(res, { id: result.insertId }, "Bukti dukung berhasil ditambahkan", 201);
});

export const updateActivityEvidence = asyncHandler(async (req, res) => {
  await ensureOperationalSchema();
  const id = readPositiveId(req.params.id, "Bukti dukung");
  const payload = normalizeEvidencePayload(req.body || {});
  await ensureRecordExists("kinerja_logbook", payload.activityId, "Aktivitas");
  await ensureRecordExists("kinerja_logbook_bukti", id, "Bukti dukung");

  await pool.query(
    `UPDATE kinerja_logbook_bukti
     SET logbook_id = ?,
         jenis_bukti = ?,
         nama_file = ?,
         tautan_bukti = ?,
         keterangan = ?,
         status_verifikasi = ?,
         diperbarui_pada = NOW()
     WHERE id = ?`,
    [payload.activityId, payload.evidenceType, payload.fileName, payload.evidenceUrl || null, payload.note || null, payload.verificationStatus, id]
  );

  return sendSuccess(res, null, "Bukti dukung berhasil diperbarui");
});

export const deleteActivityEvidence = asyncHandler(async (req, res) => {
  await ensureOperationalSchema();
  const id = readPositiveId(req.params.id, "Bukti dukung");
  const [result] = await pool.query<ResultSetHeader>(`DELETE FROM kinerja_logbook_bukti WHERE id = ?`, [id]);
  if (!result.affectedRows) fail("Bukti dukung tidak ditemukan", 404);
  return sendSuccess(res, null, "Bukti dukung berhasil dihapus");
});

export const verifyActivityEvidence = asyncHandler(async (req, res) => {
  await ensureOperationalSchema();
  const id = readPositiveId(req.params.id, "Bukti dukung");
  const status = ensureOneOf(
    readTrimmedString((req.body || {}).verificationStatus || "verified").toLowerCase(),
    EVIDENCE_VERIFICATION_STATUSES,
    "Status verifikasi"
  );
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE kinerja_logbook_bukti SET status_verifikasi = ?, diperbarui_pada = NOW() WHERE id = ?`,
    [status, id]
  );
  if (!result.affectedRows) fail("Bukti dukung tidak ditemukan", 404);
  return sendSuccess(res, null, "Status verifikasi bukti diperbarui");
});

export const getIndicatorRealizations = asyncHandler(async (req, res) => {
  await ensureOperationalSchema();
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (req.query.ikiPegawaiId) {
    conditions.push(`r.iki_pegawai_id = ?`);
    params.push(readPositiveId(req.query.ikiPegawaiId, "IKI Pegawai"));
  }
  if (req.query.pegawaiId) {
    conditions.push(`i.pegawai_id = ?`);
    params.push(readPositiveId(req.query.pegawaiId, "Pegawai"));
  }
  if (req.query.periodId) {
    conditions.push(`i.periode_id = ?`);
    params.push(readPositiveId(req.query.periodId, "Periode kinerja"));
  }
  if (req.query.status) {
    conditions.push(`r.status = ?`);
    params.push(ensureOneOf(readTrimmedString(req.query.status).toLowerCase(), REALIZATION_STATUSES, "Status realisasi"));
  }
  if (req.query.search) {
    const keyword = `%${readTrimmedString(req.query.search)}%`;
    conditions.push(`(i.nama_iki LIKE ? OR p.nama_lengkap LIKE ? OR r.periode_lapor LIKE ?)`);
    params.push(keyword, keyword, keyword);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [rows] = await pool.query<any[]>(
    `SELECT r.id,
            r.iki_pegawai_id AS ikiPegawaiId,
            i.nama_iki AS ikiName,
            i.pegawai_id AS pegawaiId,
            COALESCE(p.nama_lengkap, '-') AS pegawaiName,
            r.target_periodik_id AS targetPeriodikId,
            CASE
              WHEN tp.id IS NULL THEN '-'
              ELSE CONCAT(tp.jenis_periode, ' ', tp.periode_ke)
            END AS targetPeriodikLabel,
            r.target,
            r.realisasi AS realization,
            r.persentase_capaian AS achievementPercentage,
            r.nilai_awal AS initialScore,
            r.nilai_verifikasi AS verificationScore,
            DATE_FORMAT(r.tanggal_lapor, '%Y-%m-%d') AS reportDate,
            COALESCE(r.periode_lapor, '') AS periodLabel,
            COALESCE(r.catatan_pegawai, '') AS employeeNote,
            COALESCE(r.catatan_verifikator, '') AS verifierNote,
            r.status,
            r.dibuat_pada AS createdAt,
            r.diperbarui_pada AS updatedAt
     FROM kinerja_realisasi_indikator r
     INNER JOIN kinerja_iki_pegawai i ON i.id = r.iki_pegawai_id
     INNER JOIN pegawai p ON p.id = i.pegawai_id
     LEFT JOIN kinerja_target_periodik tp ON tp.id = r.target_periodik_id
     ${whereSql}
     ORDER BY r.tanggal_lapor DESC, r.dibuat_pada DESC, r.id DESC`,
    params
  );

  return sendSuccess(res, rows.map(buildRealizationRecord));
});

export const createIndicatorRealization = asyncHandler(async (req, res) => {
  await ensureOperationalSchema();
  const payload = normalizeRealizationPayload(req.body || {});
  await ensureRecordExists("kinerja_iki_pegawai", payload.ikiPegawaiId, "IKI Pegawai");
  if (payload.targetPeriodikId) await ensureRecordExists("kinerja_target_periodik", payload.targetPeriodikId, "Target periodik");

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO kinerja_realisasi_indikator
      (iki_pegawai_id, target_periodik_id, periode_lapor, target, realisasi, persentase_capaian, nilai_awal, nilai_verifikasi, tanggal_lapor, catatan_pegawai, catatan_verifikator, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.ikiPegawaiId,
      payload.targetPeriodikId,
      payload.periodLabel || null,
      payload.target,
      payload.realization,
      payload.achievement,
      payload.achievement,
      payload.verificationScore,
      payload.reportDate,
      payload.employeeNote || null,
      payload.verifierNote || null,
      payload.status
    ]
  );

  return sendSuccess(res, { id: result.insertId }, "Realisasi indikator berhasil ditambahkan", 201);
});

export const updateIndicatorRealization = asyncHandler(async (req, res) => {
  await ensureOperationalSchema();
  const id = readPositiveId(req.params.id, "Realisasi indikator");
  await ensureRecordExists("kinerja_realisasi_indikator", id, "Realisasi indikator");
  const payload = normalizeRealizationPayload(req.body || {});
  await ensureRecordExists("kinerja_iki_pegawai", payload.ikiPegawaiId, "IKI Pegawai");
  if (payload.targetPeriodikId) await ensureRecordExists("kinerja_target_periodik", payload.targetPeriodikId, "Target periodik");

  await pool.query(
    `UPDATE kinerja_realisasi_indikator
     SET iki_pegawai_id = ?,
         target_periodik_id = ?,
         periode_lapor = ?,
         target = ?,
         realisasi = ?,
         persentase_capaian = ?,
         nilai_awal = ?,
         nilai_verifikasi = ?,
         tanggal_lapor = ?,
         catatan_pegawai = ?,
         catatan_verifikator = ?,
         status = ?,
         diperbarui_pada = NOW()
     WHERE id = ?`,
    [
      payload.ikiPegawaiId,
      payload.targetPeriodikId,
      payload.periodLabel || null,
      payload.target,
      payload.realization,
      payload.achievement,
      payload.achievement,
      payload.verificationScore,
      payload.reportDate,
      payload.employeeNote || null,
      payload.verifierNote || null,
      payload.status,
      id
    ]
  );

  return sendSuccess(res, null, "Realisasi indikator berhasil diperbarui");
});

export const deleteIndicatorRealization = asyncHandler(async (req, res) => {
  await ensureOperationalSchema();
  const id = readPositiveId(req.params.id, "Realisasi indikator");
  const [result] = await pool.query<ResultSetHeader>(`DELETE FROM kinerja_realisasi_indikator WHERE id = ?`, [id]);
  if (!result.affectedRows) fail("Realisasi indikator tidak ditemukan", 404);
  return sendSuccess(res, null, "Realisasi indikator berhasil dihapus");
});

const updateRealizationStatus = async (id: number, status: typeof REALIZATION_STATUSES[number], verificationScore?: number | null, verifierNote?: string) => {
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE kinerja_realisasi_indikator
     SET status = ?,
         nilai_verifikasi = COALESCE(?, nilai_verifikasi),
         catatan_verifikator = COALESCE(?, catatan_verifikator),
         diperbarui_pada = NOW()
     WHERE id = ?`,
    [status, verificationScore ?? null, verifierNote || null, id]
  );
  if (!result.affectedRows) fail("Realisasi indikator tidak ditemukan", 404);
};

export const submitIndicatorRealization = asyncHandler(async (req, res) => {
  await ensureOperationalSchema();
  await updateRealizationStatus(readPositiveId(req.params.id, "Realisasi indikator"), "submitted");
  return sendSuccess(res, null, "Realisasi indikator berhasil dikirim");
});

export const verifyIndicatorRealization = asyncHandler(async (req, res) => {
  await ensureOperationalSchema();
  const id = readPositiveId(req.params.id, "Realisasi indikator");
  const verificationScore = readOptionalNumber((req.body || {}).verificationScore, "Nilai verifikasi");
  const verifierNote = readTrimmedString((req.body || {}).verifierNote);
  await updateRealizationStatus(id, "verified", verificationScore, verifierNote);
  return sendSuccess(res, null, "Realisasi indikator berhasil diverifikasi");
});

export const finalizeIndicatorRealization = asyncHandler(async (req, res) => {
  await ensureOperationalSchema();
  await updateRealizationStatus(readPositiveId(req.params.id, "Realisasi indikator"), "finalized");
  return sendSuccess(res, null, "Realisasi indikator berhasil difinalkan");
});
