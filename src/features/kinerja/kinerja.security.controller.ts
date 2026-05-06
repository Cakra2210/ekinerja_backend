import { ResultSetHeader } from "mysql2/promise";
import { pool } from "../../config/database";
import { AuthenticatedRequest } from "../../middleware/auth.middleware";
import { asyncHandler, fail, sendSuccess } from "../../shared/http";
import {
  ensureOneOf,
  ensureRequired,
  readBoolean,
  readDateString,
  readPositiveId,
  readTrimmedString
} from "../../shared/validation";

let securitySchemaReady = false;

const ROLE_OPTIONS = ["super_admin", "admin_satker", "kepala_satker", "kasubbag_umum", "ketua_tim", "pejabat_penilai", "pegawai", "reviewer"] as const;
const SETTING_TYPES = ["string", "number", "boolean"] as const;
const BACKUP_TYPES = ["full", "database", "uploads", "configuration", "audit"] as const;
const BACKUP_STATUSES = ["draft", "running", "completed", "failed", "restored"] as const;

const DEFAULT_SETTINGS = [
  {
    settingKey: "session_timeout_minutes",
    settingLabel: "Batas Waktu Sesi",
    settingType: "number",
    settingValue: "120",
    note: "Batas waktu sesi pengguna dalam menit sebelum perlu login ulang."
  },
  {
    settingKey: "password_rotation_days",
    settingLabel: "Rotasi Password",
    settingType: "number",
    settingValue: "90",
    note: "Siklus wajib ganti password untuk akun internal."
  },
  {
    settingKey: "require_verified_evidence",
    settingLabel: "Wajib Verifikasi Bukti",
    settingType: "boolean",
    settingValue: "true",
    note: "Menandai bahwa bukti dukung wajib diverifikasi sebelum finalisasi evaluasi."
  },
  {
    settingKey: "allow_user_export",
    settingLabel: "Izinkan Export untuk User",
    settingType: "boolean",
    settingValue: "false",
    note: "Kontrol dasar untuk membatasi export data oleh role user."
  },
  {
    settingKey: "maintenance_mode",
    settingLabel: "Mode Pemeliharaan",
    settingType: "boolean",
    settingValue: "false",
    note: "Penanda non-teknis bila aplikasi sedang masuk jendela pemeliharaan."
  }
] as const;

const DEFAULT_MATRIX = [
  ["super_admin", "dashboard", true, true, true, true, true, true],
  ["super_admin", "planning", true, true, true, true, true, true],
  ["super_admin", "operational", true, true, true, true, true, true],
  ["super_admin", "monitoring", true, true, true, true, true, true],
  ["super_admin", "evaluation", true, true, true, true, true, true],
  ["super_admin", "bps", true, true, true, true, true, true],
  ["super_admin", "analytics", true, true, true, true, true, true],
  ["super_admin", "security", true, true, true, true, true, true],

  ["admin_satker", "dashboard", true, true, true, false, false, true],
  ["admin_satker", "planning", true, true, true, true, false, true],
  ["admin_satker", "operational", true, true, true, true, false, true],
  ["admin_satker", "monitoring", true, true, true, false, false, true],
  ["admin_satker", "evaluation", true, true, true, false, false, true],
  ["admin_satker", "bps", true, true, true, true, false, true],
  ["admin_satker", "analytics", true, false, false, false, false, true],
  ["admin_satker", "security", false, false, false, false, false, false],

  ["kepala_satker", "dashboard", true, false, false, false, true, true],
  ["kepala_satker", "planning", true, false, false, false, true, true],
  ["kepala_satker", "operational", true, false, false, false, false, true],
  ["kepala_satker", "monitoring", true, false, false, false, true, true],
  ["kepala_satker", "evaluation", true, false, false, false, true, true],
  ["kepala_satker", "bps", true, false, false, false, false, true],
  ["kepala_satker", "analytics", true, false, false, false, false, true],
  ["kepala_satker", "security", false, false, false, false, false, false],

  ["kasubbag_umum", "dashboard", true, false, false, false, false, true],
  ["kasubbag_umum", "planning", true, false, false, false, false, true],
  ["kasubbag_umum", "operational", true, true, true, false, false, true],
  ["kasubbag_umum", "monitoring", true, false, false, false, false, true],
  ["kasubbag_umum", "evaluation", true, false, false, false, false, true],
  ["kasubbag_umum", "bps", true, false, false, false, false, true],
  ["kasubbag_umum", "analytics", true, false, false, false, false, true],
  ["kasubbag_umum", "security", false, false, false, false, false, false],

  ["ketua_tim", "dashboard", true, false, false, false, false, true],
  ["ketua_tim", "planning", true, true, true, false, false, true],
  ["ketua_tim", "operational", true, true, true, false, true, true],
  ["ketua_tim", "monitoring", true, false, false, false, true, true],
  ["ketua_tim", "evaluation", true, true, false, false, false, true],
  ["ketua_tim", "bps", true, true, true, false, true, true],
  ["ketua_tim", "analytics", true, false, false, false, false, true],
  ["ketua_tim", "security", false, false, false, false, false, false],

  ["pejabat_penilai", "dashboard", true, false, false, false, false, true],
  ["pejabat_penilai", "planning", true, false, false, false, true, true],
  ["pejabat_penilai", "operational", true, false, false, false, true, true],
  ["pejabat_penilai", "monitoring", true, false, false, false, true, true],
  ["pejabat_penilai", "evaluation", true, true, true, false, true, true],
  ["pejabat_penilai", "bps", true, false, false, false, false, true],
  ["pejabat_penilai", "analytics", true, false, false, false, false, true],
  ["pejabat_penilai", "security", false, false, false, false, false, false],

  ["pegawai", "dashboard", true, false, false, false, false, false],
  ["pegawai", "planning", true, true, true, false, false, false],
  ["pegawai", "operational", true, true, true, false, false, false],
  ["pegawai", "monitoring", true, false, false, false, false, false],
  ["pegawai", "evaluation", true, false, false, false, false, false],
  ["pegawai", "bps", true, true, true, false, false, false],
  ["pegawai", "analytics", false, false, false, false, false, false],
  ["pegawai", "security", false, false, false, false, false, false],

  ["reviewer", "dashboard", true, false, false, false, false, true],
  ["reviewer", "planning", true, false, false, false, false, true],
  ["reviewer", "operational", true, false, false, false, false, true],
  ["reviewer", "monitoring", true, false, false, false, false, true],
  ["reviewer", "evaluation", true, false, false, false, true, true],
  ["reviewer", "bps", true, false, false, false, false, true],
  ["reviewer", "analytics", true, false, false, false, false, true],
  ["reviewer", "security", true, false, false, false, false, false]
] as const;

const ensureSecuritySchema = async () => {
  if (securitySchemaReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_audit_trail (
      id INT NOT NULL AUTO_INCREMENT,
      modul VARCHAR(60) NOT NULL,
      aksi VARCHAR(60) NOT NULL,
      referensi_tipe VARCHAR(60) NULL,
      referensi_id INT NULL,
      before_json LONGTEXT NULL,
      after_json LONGTEXT NULL,
      actor_pegawai_id INT NULL,
      actor_name VARCHAR(150) NULL,
      ip_address VARCHAR(60) NULL,
      user_agent VARCHAR(255) NULL,
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_kinerja_audit_modul (modul),
      KEY idx_kinerja_audit_aksi (aksi),
      KEY idx_kinerja_audit_actor (actor_pegawai_id),
      CONSTRAINT fk_kinerja_audit_actor FOREIGN KEY (actor_pegawai_id) REFERENCES pegawai (id) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_access_matrix (
      id INT NOT NULL AUTO_INCREMENT,
      role_name VARCHAR(40) NOT NULL,
      module_name VARCHAR(60) NOT NULL,
      can_view TINYINT(1) NOT NULL DEFAULT 1,
      can_create TINYINT(1) NOT NULL DEFAULT 0,
      can_update TINYINT(1) NOT NULL DEFAULT 0,
      can_delete TINYINT(1) NOT NULL DEFAULT 0,
      can_approve TINYINT(1) NOT NULL DEFAULT 0,
      can_export TINYINT(1) NOT NULL DEFAULT 0,
      note TEXT NULL,
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_kinerja_access_role_module (role_name, module_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_security_setting (
      id INT NOT NULL AUTO_INCREMENT,
      setting_key VARCHAR(80) NOT NULL,
      setting_label VARCHAR(150) NOT NULL,
      setting_type ENUM('string','number','boolean') NOT NULL DEFAULT 'string',
      setting_value TEXT NOT NULL,
      note TEXT NULL,
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_kinerja_security_setting_key (setting_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_backup_log (
      id INT NOT NULL AUTO_INCREMENT,
      backup_type ENUM('full','database','uploads','configuration','audit') NOT NULL DEFAULT 'database',
      backup_label VARCHAR(150) NOT NULL,
      backup_date DATETIME NOT NULL,
      file_name VARCHAR(255) NULL,
      file_path VARCHAR(255) NULL,
      file_size_bytes BIGINT NULL,
      status ENUM('draft','running','completed','failed','restored') NOT NULL DEFAULT 'draft',
      note TEXT NULL,
      dibuat_oleh INT NULL,
      dipulihkan_oleh INT NULL,
      dipulihkan_pada DATETIME NULL,
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_kinerja_backup_status (status),
      KEY idx_kinerja_backup_date (backup_date),
      CONSTRAINT fk_kinerja_backup_created_by FOREIGN KEY (dibuat_oleh) REFERENCES pegawai (id) ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT fk_kinerja_backup_restored_by FOREIGN KEY (dipulihkan_oleh) REFERENCES pegawai (id) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_session_log (
      id INT NOT NULL AUTO_INCREMENT,
      account_id INT NULL,
      pegawai_id INT NULL,
      actor_name VARCHAR(150) NULL,
      role_name VARCHAR(40) NULL,
      event_type VARCHAR(60) NOT NULL,
      target_module VARCHAR(60) NULL,
      ip_address VARCHAR(60) NULL,
      user_agent VARCHAR(255) NULL,
      metadata_json LONGTEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_kinerja_session_log_account (account_id),
      KEY idx_kinerja_session_log_pegawai (pegawai_id),
      KEY idx_kinerja_session_log_event (event_type),
      KEY idx_kinerja_session_log_module (target_module),
      CONSTRAINT fk_kinerja_session_log_account FOREIGN KEY (account_id) REFERENCES akun_pengguna (id) ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT fk_kinerja_session_log_employee FOREIGN KEY (pegawai_id) REFERENCES pegawai (id) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  for (const setting of DEFAULT_SETTINGS) {
    await pool.query(
      `INSERT IGNORE INTO kinerja_security_setting (setting_key, setting_label, setting_type, setting_value, note)
       VALUES (?, ?, ?, ?, ?)`,
      [setting.settingKey, setting.settingLabel, setting.settingType, setting.settingValue, setting.note]
    );
  }

  for (const [roleName, moduleName, canView, canCreate, canUpdate, canDelete, canApprove, canExport] of DEFAULT_MATRIX) {
    await pool.query(
      `INSERT IGNORE INTO kinerja_access_matrix
        (role_name, module_name, can_view, can_create, can_update, can_delete, can_approve, can_export)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [roleName, moduleName, canView ? 1 : 0, canCreate ? 1 : 0, canUpdate ? 1 : 0, canDelete ? 1 : 0, canApprove ? 1 : 0, canExport ? 1 : 0]
    );
  }

  securitySchemaReady = true;
};

const readOptionalPositiveId = (value: unknown, fieldName: string) => {
  if (value === undefined || value === null || value === "") return null;
  return readPositiveId(value, fieldName);
};

const readOptionalDate = (value: unknown, fieldName: string) => {
  const normalized = readTrimmedString(value);
  if (!normalized) return null;
  return readDateString(normalized, fieldName);
};

const recordAuditTrail = async (
  req: AuthenticatedRequest,
  payload: {
    moduleName: string;
    actionName: string;
    referenceType?: string | null;
    referenceId?: number | null;
    beforeJson?: unknown;
    afterJson?: unknown;
  }
) => {
  await pool.query(
    `INSERT INTO kinerja_audit_trail
      (modul, aksi, referensi_tipe, referensi_id, before_json, after_json, actor_pegawai_id, actor_name, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.moduleName,
      payload.actionName,
      payload.referenceType || null,
      payload.referenceId || null,
      payload.beforeJson == null ? null : JSON.stringify(payload.beforeJson),
      payload.afterJson == null ? null : JSON.stringify(payload.afterJson),
      req.user?.employeeId || null,
      req.user?.fullName || null,
      req.ip || null,
      req.get("user-agent") || null
    ]
  );
};

const recordSessionLog = async (
  req: AuthenticatedRequest,
  payload: {
    eventType: string;
    targetModule?: string | null;
    metadata?: unknown;
  }
) => {
  await pool.query(
    `INSERT INTO kinerja_session_log
      (account_id, pegawai_id, actor_name, role_name, event_type, target_module, ip_address, user_agent, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.user?.accountId || null,
      req.user?.employeeId || null,
      req.user?.fullName || null,
      req.user?.role || null,
      payload.eventType,
      payload.targetModule || null,
      req.ip || null,
      req.get("user-agent") || null,
      payload.metadata == null ? null : JSON.stringify(payload.metadata)
    ]
  );
};

const buildAccessMatrixRecord = (row: any) => ({
  id: Number(row.id),
  roleName: row.roleName == null ? "pegawai" : String(row.roleName),
  moduleName: String(row.moduleName || "dashboard"),
  canView: Boolean(row.canView),
  canCreate: Boolean(row.canCreate),
  canUpdate: Boolean(row.canUpdate),
  canDelete: Boolean(row.canDelete),
  canApprove: Boolean(row.canApprove),
  canExport: Boolean(row.canExport),
  note: row.note == null ? "" : String(row.note),
  createdAt: row.createdAt ? String(row.createdAt) : null,
  updatedAt: row.updatedAt ? String(row.updatedAt) : null
});

const buildSettingRecord = (row: any) => ({
  id: Number(row.id),
  settingKey: String(row.settingKey || ""),
  settingLabel: String(row.settingLabel || ""),
  settingType: String(row.settingType || "string"),
  settingValue: String(row.settingValue || ""),
  note: row.note == null ? "" : String(row.note),
  createdAt: row.createdAt ? String(row.createdAt) : null,
  updatedAt: row.updatedAt ? String(row.updatedAt) : null
});

const buildBackupRecord = (row: any) => ({
  id: Number(row.id),
  backupType: String(row.backupType || "database"),
  backupLabel: String(row.backupLabel || ""),
  backupDate: String(row.backupDate || ""),
  fileName: row.fileName == null ? "" : String(row.fileName),
  filePath: row.filePath == null ? "" : String(row.filePath),
  fileSizeBytes: row.fileSizeBytes == null ? null : Number(row.fileSizeBytes),
  status: String(row.status || "draft"),
  note: row.note == null ? "" : String(row.note),
  createdById: row.createdById == null ? null : Number(row.createdById),
  createdByName: row.createdByName == null ? "-" : String(row.createdByName),
  restoredById: row.restoredById == null ? null : Number(row.restoredById),
  restoredByName: row.restoredByName == null ? "-" : String(row.restoredByName),
  restoredAt: row.restoredAt == null ? null : String(row.restoredAt),
  createdAt: row.createdAt ? String(row.createdAt) : null,
  updatedAt: row.updatedAt ? String(row.updatedAt) : null
});

const buildAuditRecord = (row: any) => ({
  id: Number(row.id),
  moduleName: String(row.moduleName || "-"),
  actionName: String(row.actionName || "-"),
  referenceType: row.referenceType == null ? "" : String(row.referenceType),
  referenceId: row.referenceId == null ? null : Number(row.referenceId),
  beforeJson: row.beforeJson == null ? null : String(row.beforeJson),
  afterJson: row.afterJson == null ? null : String(row.afterJson),
  actorEmployeeId: row.actorEmployeeId == null ? null : Number(row.actorEmployeeId),
  actorName: row.actorName == null ? "-" : String(row.actorName),
  ipAddress: row.ipAddress == null ? "-" : String(row.ipAddress),
  userAgent: row.userAgent == null ? "-" : String(row.userAgent),
  createdAt: row.createdAt ? String(row.createdAt) : null
});

const buildSessionRecord = (row: any) => ({
  id: Number(row.id),
  accountId: row.accountId == null ? null : Number(row.accountId),
  employeeId: row.employeeId == null ? null : Number(row.employeeId),
  actorName: row.actorName == null ? "-" : String(row.actorName),
  roleName: row.roleName == null ? "-" : String(row.roleName),
  eventType: String(row.eventType || "-"),
  targetModule: row.targetModule == null ? "-" : String(row.targetModule),
  ipAddress: row.ipAddress == null ? "-" : String(row.ipAddress),
  userAgent: row.userAgent == null ? "-" : String(row.userAgent),
  metadataJson: row.metadataJson == null ? null : String(row.metadataJson),
  createdAt: row.createdAt ? String(row.createdAt) : null
});

const ensureAccessMatrixExists = async (id: number) => {
  const [rows] = await pool.query<any[]>(`SELECT * FROM kinerja_access_matrix WHERE id = ? LIMIT 1`, [id]);
  if (!rows.length) fail("Matriks akses tidak ditemukan", 404);
  return rows[0];
};

const ensureSecuritySettingExists = async (settingKey: string) => {
  const [rows] = await pool.query<any[]>(`SELECT * FROM kinerja_security_setting WHERE setting_key = ? LIMIT 1`, [settingKey]);
  if (!rows.length) fail("Pengaturan keamanan tidak ditemukan", 404);
  return rows[0];
};

const ensureBackupLogExists = async (id: number) => {
  const [rows] = await pool.query<any[]>(`SELECT * FROM kinerja_backup_log WHERE id = ? LIMIT 1`, [id]);
  if (!rows.length) fail("Log backup tidak ditemukan", 404);
  return rows[0];
};

export const getKinerjaAuditTrails = asyncHandler(async (req, res) => {
  await ensureSecuritySchema();
  const moduleName = readTrimmedString(req.query.moduleName).toLowerCase();
  const actionName = readTrimmedString(req.query.actionName).toLowerCase();
  const actorEmployeeId = readOptionalPositiveId(req.query.actorEmployeeId, "Pelaku");
  const limitRaw = Number(req.query.limit || 200);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (moduleName) {
    conditions.push("at.modul = ?");
    params.push(moduleName);
  }
  if (actionName) {
    conditions.push("at.aksi LIKE ?");
    params.push(`%${actionName}%`);
  }
  if (actorEmployeeId) {
    conditions.push("at.actor_pegawai_id = ?");
    params.push(actorEmployeeId);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [rows] = await pool.query<any[]>(
    `SELECT at.id,
            at.modul AS moduleName,
            at.aksi AS actionName,
            at.referensi_tipe AS referenceType,
            at.referensi_id AS referenceId,
            at.before_json AS beforeJson,
            at.after_json AS afterJson,
            at.actor_pegawai_id AS actorEmployeeId,
            at.actor_name AS actorName,
            at.ip_address AS ipAddress,
            at.user_agent AS userAgent,
            at.dibuat_pada AS createdAt
     FROM kinerja_audit_trail at
     ${whereClause}
     ORDER BY at.id DESC
     LIMIT ?`,
    [...params, limit]
  );

  await recordSessionLog(req as AuthenticatedRequest, {
    eventType: "security_view",
    targetModule: "audit_trail",
    metadata: { limit, moduleName, actionName }
  });

  sendSuccess(res, rows.map(buildAuditRecord));
});

export const getKinerjaAccessMatrix = asyncHandler(async (req, res) => {
  await ensureSecuritySchema();
  const roleName = readTrimmedString(req.query.roleName).toLowerCase();
  const moduleName = readTrimmedString(req.query.moduleName).toLowerCase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (roleName) {
    conditions.push("role_name = ?");
    params.push(roleName);
  }
  if (moduleName) {
    conditions.push("module_name = ?");
    params.push(moduleName);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [rows] = await pool.query<any[]>(
    `SELECT id,
            role_name AS roleName,
            module_name AS moduleName,
            can_view AS canView,
            can_create AS canCreate,
            can_update AS canUpdate,
            can_delete AS canDelete,
            can_approve AS canApprove,
            can_export AS canExport,
            note,
            dibuat_pada AS createdAt,
            diperbarui_pada AS updatedAt
     FROM kinerja_access_matrix
     ${whereClause}
     ORDER BY role_name ASC, module_name ASC`,
    params
  );

  sendSuccess(res, rows.map(buildAccessMatrixRecord));
});

export const createKinerjaAccessMatrix = asyncHandler(async (req, res) => {
  await ensureSecuritySchema();
  const roleName = ensureOneOf(readTrimmedString(req.body.roleName).toLowerCase(), ROLE_OPTIONS, "Role");
  const moduleName = ensureRequired(readTrimmedString(req.body.moduleName).toLowerCase(), "Nama modul wajib diisi");
  const canView = readBoolean(req.body.canView, true);
  const canCreate = readBoolean(req.body.canCreate, false);
  const canUpdate = readBoolean(req.body.canUpdate, false);
  const canDelete = readBoolean(req.body.canDelete, false);
  const canApprove = readBoolean(req.body.canApprove, false);
  const canExport = readBoolean(req.body.canExport, false);
  const note = readTrimmedString(req.body.note);

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO kinerja_access_matrix
      (role_name, module_name, can_view, can_create, can_update, can_delete, can_approve, can_export, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       can_view = VALUES(can_view),
       can_create = VALUES(can_create),
       can_update = VALUES(can_update),
       can_delete = VALUES(can_delete),
       can_approve = VALUES(can_approve),
       can_export = VALUES(can_export),
       note = VALUES(note)`,
    [roleName, moduleName, canView ? 1 : 0, canCreate ? 1 : 0, canUpdate ? 1 : 0, canDelete ? 1 : 0, canApprove ? 1 : 0, canExport ? 1 : 0, note || null]
  );

  await recordAuditTrail(req as AuthenticatedRequest, {
    moduleName: "security",
    actionName: "create_access_matrix",
    referenceType: "kinerja_access_matrix",
    referenceId: Number(result.insertId || 0) || null,
    afterJson: { roleName, moduleName, canView, canCreate, canUpdate, canDelete, canApprove, canExport, note }
  });

  await recordSessionLog(req as AuthenticatedRequest, {
    eventType: "security_update",
    targetModule: "access_matrix",
    metadata: { roleName, moduleName }
  });

  sendSuccess(res, { id: Number(result.insertId || 0) }, "Matriks akses berhasil disimpan", 201);
});

export const updateKinerjaAccessMatrix = asyncHandler(async (req, res) => {
  await ensureSecuritySchema();
  const id = readPositiveId(req.params.id, "Matriks akses");
  const current = await ensureAccessMatrixExists(id);

  const roleName = ensureOneOf(readTrimmedString(req.body.roleName || current.role_name).toLowerCase(), ROLE_OPTIONS, "Role");
  const moduleName = ensureRequired(readTrimmedString(req.body.moduleName || current.module_name).toLowerCase(), "Nama modul wajib diisi");
  const canView = readBoolean(req.body.canView, Boolean(current.can_view));
  const canCreate = readBoolean(req.body.canCreate, Boolean(current.can_create));
  const canUpdate = readBoolean(req.body.canUpdate, Boolean(current.can_update));
  const canDelete = readBoolean(req.body.canDelete, Boolean(current.can_delete));
  const canApprove = readBoolean(req.body.canApprove, Boolean(current.can_approve));
  const canExport = readBoolean(req.body.canExport, Boolean(current.can_export));
  const note = readTrimmedString(req.body.note || current.note);

  await pool.query(
    `UPDATE kinerja_access_matrix
     SET role_name = ?, module_name = ?, can_view = ?, can_create = ?, can_update = ?, can_delete = ?, can_approve = ?, can_export = ?, note = ?
     WHERE id = ?`,
    [roleName, moduleName, canView ? 1 : 0, canCreate ? 1 : 0, canUpdate ? 1 : 0, canDelete ? 1 : 0, canApprove ? 1 : 0, canExport ? 1 : 0, note || null, id]
  );

  await recordAuditTrail(req as AuthenticatedRequest, {
    moduleName: "security",
    actionName: "update_access_matrix",
    referenceType: "kinerja_access_matrix",
    referenceId: id,
    beforeJson: current,
    afterJson: { id, roleName, moduleName, canView, canCreate, canUpdate, canDelete, canApprove, canExport, note }
  });

  await recordSessionLog(req as AuthenticatedRequest, {
    eventType: "security_update",
    targetModule: "access_matrix",
    metadata: { id, roleName, moduleName }
  });

  sendSuccess(res, null, "Matriks akses berhasil diperbarui");
});

export const getKinerjaSecuritySettings = asyncHandler(async (req, res) => {
  await ensureSecuritySchema();
  const [rows] = await pool.query<any[]>(
    `SELECT id,
            setting_key AS settingKey,
            setting_label AS settingLabel,
            setting_type AS settingType,
            setting_value AS settingValue,
            note,
            dibuat_pada AS createdAt,
            diperbarui_pada AS updatedAt
     FROM kinerja_security_setting
     ORDER BY setting_label ASC`
  );
  sendSuccess(res, rows.map(buildSettingRecord));
});

export const updateKinerjaSecuritySetting = asyncHandler(async (req, res) => {
  await ensureSecuritySchema();
  const settingKey = ensureRequired(readTrimmedString(req.params.key), "Pengaturan keamanan wajib dipilih");
  const current = await ensureSecuritySettingExists(settingKey);

  const settingLabel = ensureRequired(readTrimmedString(req.body.settingLabel || current.setting_label), "Label pengaturan wajib diisi");
  const settingType = ensureOneOf(readTrimmedString(req.body.settingType || current.setting_type).toLowerCase(), SETTING_TYPES, "Tipe pengaturan");
  const settingValue = ensureRequired(readTrimmedString(req.body.settingValue ?? current.setting_value), "Nilai pengaturan wajib diisi");
  const note = readTrimmedString(req.body.note ?? current.note);

  await pool.query(
    `UPDATE kinerja_security_setting
     SET setting_label = ?, setting_type = ?, setting_value = ?, note = ?
     WHERE setting_key = ?`,
    [settingLabel, settingType, settingValue, note || null, settingKey]
  );

  await recordAuditTrail(req as AuthenticatedRequest, {
    moduleName: "security",
    actionName: "update_setting",
    referenceType: "kinerja_security_setting",
    referenceId: Number(current.id),
    beforeJson: current,
    afterJson: { settingKey, settingLabel, settingType, settingValue, note }
  });

  await recordSessionLog(req as AuthenticatedRequest, {
    eventType: "security_update",
    targetModule: "security_setting",
    metadata: { settingKey }
  });

  sendSuccess(res, null, "Pengaturan keamanan berhasil diperbarui");
});

export const getKinerjaBackupLogs = asyncHandler(async (req, res) => {
  await ensureSecuritySchema();
  const status = readTrimmedString(req.query.status).toLowerCase();
  const backupType = readTrimmedString(req.query.backupType).toLowerCase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (status) {
    conditions.push("b.status = ?");
    params.push(status);
  }
  if (backupType) {
    conditions.push("b.backup_type = ?");
    params.push(backupType);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [rows] = await pool.query<any[]>(
    `SELECT b.id,
            b.backup_type AS backupType,
            b.backup_label AS backupLabel,
            DATE_FORMAT(b.backup_date, '%Y-%m-%d %H:%i:%s') AS backupDate,
            b.file_name AS fileName,
            b.file_path AS filePath,
            b.file_size_bytes AS fileSizeBytes,
            b.status,
            b.note,
            b.dibuat_oleh AS createdById,
            p1.nama_lengkap AS createdByName,
            b.dipulihkan_oleh AS restoredById,
            p2.nama_lengkap AS restoredByName,
            DATE_FORMAT(b.dipulihkan_pada, '%Y-%m-%d %H:%i:%s') AS restoredAt,
            b.dibuat_pada AS createdAt,
            b.diperbarui_pada AS updatedAt
     FROM kinerja_backup_log b
     LEFT JOIN pegawai p1 ON p1.id = b.dibuat_oleh
     LEFT JOIN pegawai p2 ON p2.id = b.dipulihkan_oleh
     ${whereClause}
     ORDER BY b.backup_date DESC, b.id DESC`,
    params
  );
  sendSuccess(res, rows.map(buildBackupRecord));
});

export const createKinerjaBackupLog = asyncHandler(async (req, res) => {
  await ensureSecuritySchema();
  const backupType = ensureOneOf(readTrimmedString(req.body.backupType || "database").toLowerCase(), BACKUP_TYPES, "Jenis backup");
  const backupLabel = ensureRequired(readTrimmedString(req.body.backupLabel), "Label backup wajib diisi");
  const backupDate = readOptionalDate(req.body.backupDate, "Tanggal backup") || new Date().toISOString().slice(0, 19).replace("T", " ");
  const status = ensureOneOf(readTrimmedString(req.body.status || "draft").toLowerCase(), BACKUP_STATUSES, "Status backup");
  const fileName = readTrimmedString(req.body.fileName);
  const filePath = readTrimmedString(req.body.filePath);
  const note = readTrimmedString(req.body.note);

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO kinerja_backup_log
      (backup_type, backup_label, backup_date, file_name, file_path, status, note, dibuat_oleh)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [backupType, backupLabel, backupDate, fileName || null, filePath || null, status, note || null, (req as AuthenticatedRequest).user?.employeeId || null]
  );

  await recordAuditTrail(req as AuthenticatedRequest, {
    moduleName: "security",
    actionName: "create_backup_log",
    referenceType: "kinerja_backup_log",
    referenceId: Number(result.insertId),
    afterJson: { backupType, backupLabel, backupDate, status, fileName, filePath, note }
  });

  await recordSessionLog(req as AuthenticatedRequest, {
    eventType: "backup_create",
    targetModule: "backup_center",
    metadata: { backupType, backupLabel, status }
  });

  sendSuccess(res, { id: Number(result.insertId) }, "Log backup berhasil dibuat", 201);
});

export const completeKinerjaBackupLog = asyncHandler(async (req, res) => {
  await ensureSecuritySchema();
  const id = readPositiveId(req.params.id, "Log backup");
  const current = await ensureBackupLogExists(id);
  const status = ensureOneOf(readTrimmedString(req.body.status || "completed").toLowerCase(), BACKUP_STATUSES, "Status backup");
  const fileName = readTrimmedString(req.body.fileName || current.file_name);
  const filePath = readTrimmedString(req.body.filePath || current.file_path);
  const note = readTrimmedString(req.body.note || current.note);

  await pool.query(
    `UPDATE kinerja_backup_log
     SET status = ?, file_name = ?, file_path = ?, note = ?
     WHERE id = ?`,
    [status, fileName || null, filePath || null, note || null, id]
  );

  await recordAuditTrail(req as AuthenticatedRequest, {
    moduleName: "security",
    actionName: "complete_backup_log",
    referenceType: "kinerja_backup_log",
    referenceId: id,
    beforeJson: current,
    afterJson: { id, status, fileName, filePath, note }
  });

  await recordSessionLog(req as AuthenticatedRequest, {
    eventType: "backup_complete",
    targetModule: "backup_center",
    metadata: { id, status }
  });

  sendSuccess(res, null, "Status backup berhasil diperbarui");
});

export const restoreKinerjaBackupLog = asyncHandler(async (req, res) => {
  await ensureSecuritySchema();
  const id = readPositiveId(req.params.id, "Log backup");
  const current = await ensureBackupLogExists(id);
  const note = readTrimmedString(req.body.note || current.note);

  await pool.query(
    `UPDATE kinerja_backup_log
     SET status = 'restored', dipulihkan_oleh = ?, dipulihkan_pada = NOW(), note = ?
     WHERE id = ?`,
    [(req as AuthenticatedRequest).user?.employeeId || null, note || null, id]
  );

  await recordAuditTrail(req as AuthenticatedRequest, {
    moduleName: "security",
    actionName: "restore_backup_log",
    referenceType: "kinerja_backup_log",
    referenceId: id,
    beforeJson: current,
    afterJson: { id, status: "restored", note }
  });

  await recordSessionLog(req as AuthenticatedRequest, {
    eventType: "backup_restore",
    targetModule: "backup_center",
    metadata: { id }
  });

  sendSuccess(res, null, "Log backup ditandai sebagai dipulihkan");
});

export const getKinerjaSessionLogs = asyncHandler(async (req, res) => {
  await ensureSecuritySchema();
  const eventType = readTrimmedString(req.query.eventType).toLowerCase();
  const targetModule = readTrimmedString(req.query.targetModule).toLowerCase();
  const employeeId = readOptionalPositiveId(req.query.employeeId, "Pegawai");
  const limitRaw = Number(req.query.limit || 200);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (eventType) {
    conditions.push("sl.event_type = ?");
    params.push(eventType);
  }
  if (targetModule) {
    conditions.push("sl.target_module = ?");
    params.push(targetModule);
  }
  if (employeeId) {
    conditions.push("sl.pegawai_id = ?");
    params.push(employeeId);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [rows] = await pool.query<any[]>(
    `SELECT sl.id,
            sl.account_id AS accountId,
            sl.pegawai_id AS employeeId,
            sl.actor_name AS actorName,
            sl.role_name AS roleName,
            sl.event_type AS eventType,
            sl.target_module AS targetModule,
            sl.ip_address AS ipAddress,
            sl.user_agent AS userAgent,
            sl.metadata_json AS metadataJson,
            sl.created_at AS createdAt
     FROM kinerja_session_log sl
     ${whereClause}
     ORDER BY sl.id DESC
     LIMIT ?`,
    [...params, limit]
  );

  await recordSessionLog(req as AuthenticatedRequest, {
    eventType: "security_view",
    targetModule: "session_log",
    metadata: { limit, eventType, targetModule }
  });

  sendSuccess(res, rows.map(buildSessionRecord));
});
