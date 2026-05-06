import { ResultSetHeader } from "mysql2/promise";
import { pool } from "../../config/database";
import { AuthenticatedRequest } from "../../middleware/auth.middleware";
import { asyncHandler, fail, sendSuccess } from "../../shared/http";
import {
  ensureOneOf,
  ensureRequired,
  readDateString,
  readNonNegativeNumber,
  readPositiveId,
  readTrimmedString
} from "../../shared/validation";

let evaluationSchemaReady = false;

const POLICY_STATUSES = ["draft", "aktif", "nonaktif"] as const;
const ARCHIVE_STATUSES = ["aktif", "arsip"] as const;
const COMPONENTS = ["iku", "iki", "penugasan", "aktivitas", "perilaku"] as const;
const ROUNDING_TYPES = ["normal", "ke_atas", "ke_bawah"] as const;
const MIDYEAR_STATUSES = ["draft", "ditinjau", "final"] as const;
const FINAL_STATUSES = ["draft", "generated", "reviewed", "calibrated", "finalized"] as const;
const CALIBRATION_STATUSES = ["draft", "closed"] as const;

const readOptionalPositiveId = (value: unknown, fieldName: string) => {
  if (value === undefined || value === null || value === "") return null;
  return readPositiveId(value, fieldName);
};

const readOptionalNonNegativeNumber = (value: unknown, fieldName: string) => {
  if (value === undefined || value === null || value === "") return null;
  return readNonNegativeNumber(value, fieldName, 0);
};

const readOptionalDateString = (value: unknown, fieldName: string) => {
  const normalized = readTrimmedString(value);
  if (!normalized) return null;
  return readDateString(normalized, fieldName);
};

const ensureColumnExists = async (tableName: string, columnName: string, definitionSql: string) => {
  const [rows] = await pool.query<any[]>(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [tableName, columnName]
  );
  if (!rows.length) {
    await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`);
  }
};

const ensureIndexExists = async (tableName: string, indexName: string, createSql: string) => {
  const [rows] = await pool.query<any[]>(
    `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [tableName, indexName]
  );
  if (!rows.length) {
    await pool.query(createSql);
  }
};

const ensureForeignKeyExists = async (tableName: string, constraintName: string, createSql: string) => {
  const [rows] = await pool.query<any[]>(
    `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? LIMIT 1`,
    [tableName, constraintName]
  );
  if (!rows.length) {
    await pool.query(createSql);
  }
};

const ensureEmployeeExists = async (employeeId: number) => {
  const [rows] = await pool.query<any[]>(`SELECT id FROM pegawai WHERE id = ? LIMIT 1`, [employeeId]);
  if (!rows.length) fail("Pegawai tidak ditemukan", 404);
};

const ensurePeriodExists = async (periodId: number) => {
  const [rows] = await pool.query<any[]>(`SELECT id FROM kinerja_periode WHERE id = ? LIMIT 1`, [periodId]);
  if (!rows.length) fail("Periode kinerja tidak ditemukan", 404);
};

const ensurePolicyExists = async (policyId: number) => {
  const [rows] = await pool.query<any[]>(`SELECT id FROM kinerja_kebijakan_penilaian WHERE id = ? LIMIT 1`, [policyId]);
  if (!rows.length) fail("Kebijakan penilaian tidak ditemukan", 404);
};

const ensureFinalEvaluationExists = async (evaluationId: number) => {
  const [rows] = await pool.query<any[]>(`SELECT id FROM kinerja_evaluasi_akhir_tahun WHERE id = ? LIMIT 1`, [evaluationId]);
  if (!rows.length) fail("Evaluasi akhir tahun tidak ditemukan", 404);
};

const ensureMidyearEvaluationExists = async (evaluationId: number) => {
  const [rows] = await pool.query<any[]>(`SELECT id FROM kinerja_evaluasi_tengah_tahun WHERE id = ? LIMIT 1`, [evaluationId]);
  if (!rows.length) fail("Evaluasi tengah tahun tidak ditemukan", 404);
};

const ensureCalibrationExists = async (calibrationId: number) => {
  const [rows] = await pool.query<any[]>(`SELECT id FROM kinerja_kalibrasi WHERE id = ? LIMIT 1`, [calibrationId]);
  if (!rows.length) fail("Sesi kalibrasi tidak ditemukan", 404);
};

const ensureCalibrationItemExists = async (itemId: number) => {
  const [rows] = await pool.query<any[]>(`SELECT id FROM kinerja_kalibrasi_item WHERE id = ? LIMIT 1`, [itemId]);
  if (!rows.length) fail("Item kalibrasi tidak ditemukan", 404);
};

const ensureEvaluationSchema = async () => {
  if (evaluationSchemaReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_kebijakan_penilaian (
      id INT NOT NULL AUTO_INCREMENT,
      periode_id INT NULL,
      nama_kebijakan VARCHAR(150) NOT NULL,
      versi VARCHAR(50) NOT NULL,
      tanggal_berlaku DATE NOT NULL,
      status ENUM('draft','aktif','nonaktif') NOT NULL DEFAULT 'draft',
      catatan TEXT NULL,
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureIndexExists('kinerja_kebijakan_penilaian', 'idx_kinerja_kebijakan_periode', 'ALTER TABLE kinerja_kebijakan_penilaian ADD INDEX idx_kinerja_kebijakan_periode (periode_id)');
  await ensureForeignKeyExists('kinerja_kebijakan_penilaian', 'fk_kinerja_kebijakan_periode', 'ALTER TABLE kinerja_kebijakan_penilaian ADD CONSTRAINT fk_kinerja_kebijakan_periode FOREIGN KEY (periode_id) REFERENCES kinerja_periode (id) ON DELETE SET NULL ON UPDATE CASCADE');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_kebijakan_formula (
      id INT NOT NULL AUTO_INCREMENT,
      kebijakan_id INT NOT NULL,
      komponen ENUM('iku','iki','penugasan','aktivitas','perilaku') NOT NULL,
      jenis_jabatan VARCHAR(120) NOT NULL DEFAULT 'umum',
      bobot DECIMAL(8,2) NOT NULL DEFAULT 0,
      formula TEXT NULL,
      batas_min DECIMAL(8,2) NULL,
      batas_max DECIMAL(8,2) NULL,
      pembulatan ENUM('normal','ke_atas','ke_bawah') NOT NULL DEFAULT 'normal',
      penalti DECIMAL(8,2) NULL,
      bonus DECIMAL(8,2) NULL,
      status ENUM('aktif','arsip') NOT NULL DEFAULT 'aktif',
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureIndexExists('kinerja_kebijakan_formula', 'idx_kinerja_formula_kebijakan', 'ALTER TABLE kinerja_kebijakan_formula ADD INDEX idx_kinerja_formula_kebijakan (kebijakan_id)');
  await ensureForeignKeyExists('kinerja_kebijakan_formula', 'fk_kinerja_formula_kebijakan', 'ALTER TABLE kinerja_kebijakan_formula ADD CONSTRAINT fk_kinerja_formula_kebijakan FOREIGN KEY (kebijakan_id) REFERENCES kinerja_kebijakan_penilaian (id) ON DELETE CASCADE ON UPDATE CASCADE');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_kebijakan_predikat (
      id INT NOT NULL AUTO_INCREMENT,
      kebijakan_id INT NOT NULL,
      nilai_min DECIMAL(8,2) NOT NULL,
      nilai_max DECIMAL(8,2) NOT NULL,
      nama_predikat VARCHAR(120) NOT NULL,
      rekomendasi TEXT NULL,
      status ENUM('aktif','arsip') NOT NULL DEFAULT 'aktif',
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureIndexExists('kinerja_kebijakan_predikat', 'idx_kinerja_predikat_kebijakan', 'ALTER TABLE kinerja_kebijakan_predikat ADD INDEX idx_kinerja_predikat_kebijakan (kebijakan_id)');
  await ensureForeignKeyExists('kinerja_kebijakan_predikat', 'fk_kinerja_predikat_kebijakan', 'ALTER TABLE kinerja_kebijakan_predikat ADD CONSTRAINT fk_kinerja_predikat_kebijakan FOREIGN KEY (kebijakan_id) REFERENCES kinerja_kebijakan_penilaian (id) ON DELETE CASCADE ON UPDATE CASCADE');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_evaluasi_tengah_tahun (
      id INT NOT NULL AUTO_INCREMENT,
      periode_id INT NOT NULL,
      pegawai_id INT NOT NULL,
      penilai_id INT NOT NULL,
      kebijakan_id INT NULL,
      ringkasan_capaian TEXT NULL,
      hambatan TEXT NULL,
      rencana_perbaikan TEXT NULL,
      nilai_sementara DECIMAL(8,2) NULL,
      catatan_penilai TEXT NULL,
      tanggal_evaluasi DATE NOT NULL,
      status ENUM('draft','ditinjau','final') NOT NULL DEFAULT 'draft',
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_kinerja_midyear_periode_pegawai (periode_id, pegawai_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureIndexExists('kinerja_evaluasi_tengah_tahun', 'idx_kinerja_midyear_penilai', 'ALTER TABLE kinerja_evaluasi_tengah_tahun ADD INDEX idx_kinerja_midyear_penilai (penilai_id)');
  await ensureIndexExists('kinerja_evaluasi_tengah_tahun', 'idx_kinerja_midyear_kebijakan', 'ALTER TABLE kinerja_evaluasi_tengah_tahun ADD INDEX idx_kinerja_midyear_kebijakan (kebijakan_id)');
  await ensureForeignKeyExists('kinerja_evaluasi_tengah_tahun', 'fk_kinerja_midyear_periode', 'ALTER TABLE kinerja_evaluasi_tengah_tahun ADD CONSTRAINT fk_kinerja_midyear_periode FOREIGN KEY (periode_id) REFERENCES kinerja_periode (id) ON DELETE RESTRICT ON UPDATE CASCADE');
  await ensureForeignKeyExists('kinerja_evaluasi_tengah_tahun', 'fk_kinerja_midyear_pegawai', 'ALTER TABLE kinerja_evaluasi_tengah_tahun ADD CONSTRAINT fk_kinerja_midyear_pegawai FOREIGN KEY (pegawai_id) REFERENCES pegawai (id) ON DELETE CASCADE ON UPDATE CASCADE');
  await ensureForeignKeyExists('kinerja_evaluasi_tengah_tahun', 'fk_kinerja_midyear_penilai', 'ALTER TABLE kinerja_evaluasi_tengah_tahun ADD CONSTRAINT fk_kinerja_midyear_penilai FOREIGN KEY (penilai_id) REFERENCES pegawai (id) ON DELETE RESTRICT ON UPDATE CASCADE');
  await ensureForeignKeyExists('kinerja_evaluasi_tengah_tahun', 'fk_kinerja_midyear_kebijakan', 'ALTER TABLE kinerja_evaluasi_tengah_tahun ADD CONSTRAINT fk_kinerja_midyear_kebijakan FOREIGN KEY (kebijakan_id) REFERENCES kinerja_kebijakan_penilaian (id) ON DELETE SET NULL ON UPDATE CASCADE');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_evaluasi_akhir_tahun (
      id INT NOT NULL AUTO_INCREMENT,
      periode_id INT NOT NULL,
      pegawai_id INT NOT NULL,
      penilai_id INT NOT NULL,
      kebijakan_id INT NULL,
      nilai_iku DECIMAL(8,2) NULL,
      nilai_iki DECIMAL(8,2) NULL,
      nilai_penugasan DECIMAL(8,2) NULL,
      nilai_aktivitas DECIMAL(8,2) NULL,
      nilai_perilaku DECIMAL(8,2) NULL,
      nilai_akhir DECIMAL(8,2) NULL,
      predikat VARCHAR(120) NULL,
      catatan_penilai TEXT NULL,
      tanggal_evaluasi DATE NOT NULL,
      status ENUM('draft','generated','reviewed','calibrated','finalized') NOT NULL DEFAULT 'draft',
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_kinerja_final_periode_pegawai (periode_id, pegawai_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureIndexExists('kinerja_evaluasi_akhir_tahun', 'idx_kinerja_final_penilai', 'ALTER TABLE kinerja_evaluasi_akhir_tahun ADD INDEX idx_kinerja_final_penilai (penilai_id)');
  await ensureIndexExists('kinerja_evaluasi_akhir_tahun', 'idx_kinerja_final_kebijakan', 'ALTER TABLE kinerja_evaluasi_akhir_tahun ADD INDEX idx_kinerja_final_kebijakan (kebijakan_id)');
  await ensureForeignKeyExists('kinerja_evaluasi_akhir_tahun', 'fk_kinerja_final_periode', 'ALTER TABLE kinerja_evaluasi_akhir_tahun ADD CONSTRAINT fk_kinerja_final_periode FOREIGN KEY (periode_id) REFERENCES kinerja_periode (id) ON DELETE RESTRICT ON UPDATE CASCADE');
  await ensureForeignKeyExists('kinerja_evaluasi_akhir_tahun', 'fk_kinerja_final_pegawai', 'ALTER TABLE kinerja_evaluasi_akhir_tahun ADD CONSTRAINT fk_kinerja_final_pegawai FOREIGN KEY (pegawai_id) REFERENCES pegawai (id) ON DELETE CASCADE ON UPDATE CASCADE');
  await ensureForeignKeyExists('kinerja_evaluasi_akhir_tahun', 'fk_kinerja_final_penilai', 'ALTER TABLE kinerja_evaluasi_akhir_tahun ADD CONSTRAINT fk_kinerja_final_penilai FOREIGN KEY (penilai_id) REFERENCES pegawai (id) ON DELETE RESTRICT ON UPDATE CASCADE');
  await ensureForeignKeyExists('kinerja_evaluasi_akhir_tahun', 'fk_kinerja_final_kebijakan', 'ALTER TABLE kinerja_evaluasi_akhir_tahun ADD CONSTRAINT fk_kinerja_final_kebijakan FOREIGN KEY (kebijakan_id) REFERENCES kinerja_kebijakan_penilaian (id) ON DELETE SET NULL ON UPDATE CASCADE');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_kalibrasi (
      id INT NOT NULL AUTO_INCREMENT,
      periode_id INT NOT NULL,
      nama_sesi VARCHAR(150) NOT NULL,
      tanggal_kalibrasi DATE NOT NULL,
      ketua_sesi_id INT NOT NULL,
      catatan TEXT NULL,
      status ENUM('draft','closed') NOT NULL DEFAULT 'draft',
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureIndexExists('kinerja_kalibrasi', 'idx_kinerja_kalibrasi_periode', 'ALTER TABLE kinerja_kalibrasi ADD INDEX idx_kinerja_kalibrasi_periode (periode_id)');
  await ensureIndexExists('kinerja_kalibrasi', 'idx_kinerja_kalibrasi_ketua', 'ALTER TABLE kinerja_kalibrasi ADD INDEX idx_kinerja_kalibrasi_ketua (ketua_sesi_id)');
  await ensureForeignKeyExists('kinerja_kalibrasi', 'fk_kinerja_kalibrasi_periode', 'ALTER TABLE kinerja_kalibrasi ADD CONSTRAINT fk_kinerja_kalibrasi_periode FOREIGN KEY (periode_id) REFERENCES kinerja_periode (id) ON DELETE RESTRICT ON UPDATE CASCADE');
  await ensureForeignKeyExists('kinerja_kalibrasi', 'fk_kinerja_kalibrasi_ketua', 'ALTER TABLE kinerja_kalibrasi ADD CONSTRAINT fk_kinerja_kalibrasi_ketua FOREIGN KEY (ketua_sesi_id) REFERENCES pegawai (id) ON DELETE RESTRICT ON UPDATE CASCADE');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_kalibrasi_item (
      id INT NOT NULL AUTO_INCREMENT,
      kalibrasi_id INT NOT NULL,
      evaluasi_akhir_id INT NOT NULL,
      pegawai_id INT NOT NULL,
      nilai_sebelum DECIMAL(8,2) NULL,
      nilai_sesudah DECIMAL(8,2) NULL,
      alasan_perubahan TEXT NULL,
      reviewer_id INT NULL,
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_kinerja_kalibrasi_item_eval (kalibrasi_id, evaluasi_akhir_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureIndexExists('kinerja_kalibrasi_item', 'idx_kinerja_kalibrasi_item_pegawai', 'ALTER TABLE kinerja_kalibrasi_item ADD INDEX idx_kinerja_kalibrasi_item_pegawai (pegawai_id)');
  await ensureIndexExists('kinerja_kalibrasi_item', 'idx_kinerja_kalibrasi_item_reviewer', 'ALTER TABLE kinerja_kalibrasi_item ADD INDEX idx_kinerja_kalibrasi_item_reviewer (reviewer_id)');
  await ensureForeignKeyExists('kinerja_kalibrasi_item', 'fk_kinerja_kalibrasi_item_kalibrasi', 'ALTER TABLE kinerja_kalibrasi_item ADD CONSTRAINT fk_kinerja_kalibrasi_item_kalibrasi FOREIGN KEY (kalibrasi_id) REFERENCES kinerja_kalibrasi (id) ON DELETE CASCADE ON UPDATE CASCADE');
  await ensureForeignKeyExists('kinerja_kalibrasi_item', 'fk_kinerja_kalibrasi_item_evaluasi', 'ALTER TABLE kinerja_kalibrasi_item ADD CONSTRAINT fk_kinerja_kalibrasi_item_evaluasi FOREIGN KEY (evaluasi_akhir_id) REFERENCES kinerja_evaluasi_akhir_tahun (id) ON DELETE CASCADE ON UPDATE CASCADE');
  await ensureForeignKeyExists('kinerja_kalibrasi_item', 'fk_kinerja_kalibrasi_item_pegawai', 'ALTER TABLE kinerja_kalibrasi_item ADD CONSTRAINT fk_kinerja_kalibrasi_item_pegawai FOREIGN KEY (pegawai_id) REFERENCES pegawai (id) ON DELETE RESTRICT ON UPDATE CASCADE');
  await ensureForeignKeyExists('kinerja_kalibrasi_item', 'fk_kinerja_kalibrasi_item_reviewer', 'ALTER TABLE kinerja_kalibrasi_item ADD CONSTRAINT fk_kinerja_kalibrasi_item_reviewer FOREIGN KEY (reviewer_id) REFERENCES pegawai (id) ON DELETE SET NULL ON UPDATE CASCADE');

  evaluationSchemaReady = true;
};

const normalizePolicyPayload = (body: Record<string, unknown>) => ({
  periodeId: readOptionalPositiveId(body.periodeId, 'Periode kinerja'),
  policyName: ensureRequired(readTrimmedString(body.policyName), 'Nama kebijakan wajib diisi'),
  version: ensureRequired(readTrimmedString(body.version), 'Versi kebijakan wajib diisi'),
  effectiveDate: readDateString(body.effectiveDate, 'Tanggal berlaku'),
  status: ensureOneOf(readTrimmedString(body.status || 'draft').toLowerCase(), POLICY_STATUSES, 'Status kebijakan'),
  note: readTrimmedString(body.note)
});

const normalizeFormulaPayload = (body: Record<string, unknown>) => ({
  policyId: readPositiveId(body.policyId, 'Kebijakan penilaian'),
  component: ensureOneOf(readTrimmedString(body.component || 'iki').toLowerCase(), COMPONENTS, 'Komponen formula'),
  jobType: ensureRequired(readTrimmedString(body.jobType || 'umum'), 'Jenis jabatan wajib diisi'),
  weight: readNonNegativeNumber(body.weight, 'Bobot', 0),
  formula: readTrimmedString(body.formula),
  minScore: readOptionalNonNegativeNumber(body.minScore, 'Batas minimum'),
  maxScore: readOptionalNonNegativeNumber(body.maxScore, 'Batas maksimum'),
  roundingType: ensureOneOf(readTrimmedString(body.roundingType || 'normal').toLowerCase(), ROUNDING_TYPES, 'Jenis pembulatan'),
  penalty: readOptionalNonNegativeNumber(body.penalty, 'Penalti'),
  bonus: readOptionalNonNegativeNumber(body.bonus, 'Bonus'),
  status: ensureOneOf(readTrimmedString(body.status || 'aktif').toLowerCase(), ARCHIVE_STATUSES, 'Status formula')
});

const normalizePredicatePayload = (body: Record<string, unknown>) => {
  const minScore = readNonNegativeNumber(body.minScore, 'Nilai minimum', 0);
  const maxScore = readNonNegativeNumber(body.maxScore, 'Nilai maksimum', 0);
  if (maxScore < minScore) fail('Nilai maksimum tidak boleh lebih kecil dari nilai minimum', 400);
  return {
    policyId: readPositiveId(body.policyId, 'Kebijakan penilaian'),
    minScore,
    maxScore,
    predicateName: ensureRequired(readTrimmedString(body.predicateName), 'Nama predikat wajib diisi'),
    recommendation: readTrimmedString(body.recommendation),
    status: ensureOneOf(readTrimmedString(body.status || 'aktif').toLowerCase(), ARCHIVE_STATUSES, 'Status predikat')
  };
};

const normalizeMidyearPayload = (body: Record<string, unknown>, fallbackEvaluatorId: number | null) => ({
  periodeId: readPositiveId(body.periodeId, 'Periode kinerja'),
  employeeId: readPositiveId(body.employeeId, 'Pegawai'),
  evaluatorId: readOptionalPositiveId(body.evaluatorId, 'Penilai') || fallbackEvaluatorId || 0,
  policyId: readOptionalPositiveId(body.policyId, 'Kebijakan penilaian'),
  achievementSummary: readTrimmedString(body.achievementSummary),
  obstacles: readTrimmedString(body.obstacles),
  improvementPlan: readTrimmedString(body.improvementPlan),
  temporaryScore: readOptionalNonNegativeNumber(body.temporaryScore, 'Nilai sementara'),
  evaluatorNote: readTrimmedString(body.evaluatorNote),
  evaluationDate: readDateString(body.evaluationDate, 'Tanggal evaluasi'),
  status: ensureOneOf(readTrimmedString(body.status || 'draft').toLowerCase(), MIDYEAR_STATUSES, 'Status evaluasi tengah tahun')
});

const normalizeFinalPayload = (body: Record<string, unknown>, fallbackEvaluatorId: number | null) => ({
  periodeId: readPositiveId(body.periodeId, 'Periode kinerja'),
  employeeId: readPositiveId(body.employeeId, 'Pegawai'),
  evaluatorId: readOptionalPositiveId(body.evaluatorId, 'Penilai') || fallbackEvaluatorId || 0,
  policyId: readOptionalPositiveId(body.policyId, 'Kebijakan penilaian'),
  ikuScore: readOptionalNonNegativeNumber(body.ikuScore, 'Nilai IKU'),
  ikiScore: readOptionalNonNegativeNumber(body.ikiScore, 'Nilai IKI'),
  assignmentScore: readOptionalNonNegativeNumber(body.assignmentScore, 'Nilai penugasan'),
  activityScore: readOptionalNonNegativeNumber(body.activityScore, 'Nilai aktivitas'),
  behaviorScore: readOptionalNonNegativeNumber(body.behaviorScore, 'Nilai perilaku'),
  finalScore: readOptionalNonNegativeNumber(body.finalScore, 'Nilai akhir'),
  predicate: readTrimmedString(body.predicate),
  evaluatorNote: readTrimmedString(body.evaluatorNote),
  evaluationDate: readDateString(body.evaluationDate, 'Tanggal evaluasi'),
  status: ensureOneOf(readTrimmedString(body.status || 'draft').toLowerCase(), FINAL_STATUSES, 'Status evaluasi akhir tahun')
});

const normalizeCalibrationPayload = (body: Record<string, unknown>, fallbackChairId: number | null) => ({
  periodeId: readPositiveId(body.periodeId, 'Periode kinerja'),
  sessionName: ensureRequired(readTrimmedString(body.sessionName), 'Nama sesi wajib diisi'),
  calibrationDate: readDateString(body.calibrationDate, 'Tanggal kalibrasi'),
  chairpersonId: readOptionalPositiveId(body.chairpersonId, 'Ketua sesi') || fallbackChairId || 0,
  note: readTrimmedString(body.note),
  status: ensureOneOf(readTrimmedString(body.status || 'draft').toLowerCase(), CALIBRATION_STATUSES, 'Status kalibrasi')
});

const normalizeCalibrationItemPayload = (body: Record<string, unknown>, fallbackReviewerId: number | null) => ({
  evaluationId: readPositiveId(body.evaluationId, 'Evaluasi akhir tahun'),
  employeeId: readPositiveId(body.employeeId, 'Pegawai'),
  previousScore: readOptionalNonNegativeNumber(body.previousScore, 'Nilai sebelum'),
  adjustedScore: readOptionalNonNegativeNumber(body.adjustedScore, 'Nilai sesudah'),
  reason: readTrimmedString(body.reason),
  reviewerId: readOptionalPositiveId(body.reviewerId, 'Reviewer') || fallbackReviewerId || null
});

const buildPolicyRecord = (row: any) => ({
  id: Number(row.id),
  periodeId: row.periodeId == null ? null : Number(row.periodeId),
  periodeName: String(row.periodeName || '-'),
  policyName: String(row.policyName || ''),
  version: String(row.version || ''),
  effectiveDate: String(row.effectiveDate || ''),
  status: String(row.status || 'draft'),
  note: String(row.note || ''),
  createdAt: row.createdAt ? String(row.createdAt) : null,
  updatedAt: row.updatedAt ? String(row.updatedAt) : null
});

const buildFormulaRecord = (row: any) => ({
  id: Number(row.id),
  policyId: Number(row.policyId),
  policyName: String(row.policyName || '-'),
  component: String(row.component || 'iki'),
  jobType: String(row.jobType || 'umum'),
  weight: row.weight == null ? null : Number(row.weight),
  formula: String(row.formula || ''),
  minScore: row.minScore == null ? null : Number(row.minScore),
  maxScore: row.maxScore == null ? null : Number(row.maxScore),
  roundingType: String(row.roundingType || 'normal'),
  penalty: row.penalty == null ? null : Number(row.penalty),
  bonus: row.bonus == null ? null : Number(row.bonus),
  status: String(row.status || 'aktif')
});

const buildPredicateRecord = (row: any) => ({
  id: Number(row.id),
  policyId: Number(row.policyId),
  policyName: String(row.policyName || '-'),
  minScore: Number(row.minScore || 0),
  maxScore: Number(row.maxScore || 0),
  predicateName: String(row.predicateName || ''),
  recommendation: String(row.recommendation || ''),
  status: String(row.status || 'aktif')
});

const buildMidyearRecord = (row: any) => ({
  id: Number(row.id),
  periodeId: Number(row.periodeId),
  periodeName: String(row.periodeName || '-'),
  employeeId: Number(row.employeeId),
  employeeName: String(row.employeeName || '-'),
  evaluatorId: Number(row.evaluatorId),
  evaluatorName: String(row.evaluatorName || '-'),
  policyId: row.policyId == null ? null : Number(row.policyId),
  policyName: String(row.policyName || '-'),
  achievementSummary: String(row.achievementSummary || ''),
  obstacles: String(row.obstacles || ''),
  improvementPlan: String(row.improvementPlan || ''),
  temporaryScore: row.temporaryScore == null ? null : Number(row.temporaryScore),
  evaluatorNote: String(row.evaluatorNote || ''),
  evaluationDate: String(row.evaluationDate || ''),
  status: String(row.status || 'draft')
});

const buildFinalRecord = (row: any) => ({
  id: Number(row.id),
  periodeId: Number(row.periodeId),
  periodeName: String(row.periodeName || '-'),
  employeeId: Number(row.employeeId),
  employeeName: String(row.employeeName || '-'),
  evaluatorId: Number(row.evaluatorId),
  evaluatorName: String(row.evaluatorName || '-'),
  policyId: row.policyId == null ? null : Number(row.policyId),
  policyName: String(row.policyName || '-'),
  ikuScore: row.ikuScore == null ? null : Number(row.ikuScore),
  ikiScore: row.ikiScore == null ? null : Number(row.ikiScore),
  assignmentScore: row.assignmentScore == null ? null : Number(row.assignmentScore),
  activityScore: row.activityScore == null ? null : Number(row.activityScore),
  behaviorScore: row.behaviorScore == null ? null : Number(row.behaviorScore),
  finalScore: row.finalScore == null ? null : Number(row.finalScore),
  predicate: String(row.predicate || ''),
  evaluatorNote: String(row.evaluatorNote || ''),
  evaluationDate: String(row.evaluationDate || ''),
  status: String(row.status || 'draft')
});

const buildCalibrationItemRecord = (row: any) => ({
  id: Number(row.id),
  evaluationId: Number(row.evaluationId),
  employeeId: Number(row.employeeId),
  employeeName: String(row.employeeName || '-'),
  previousScore: row.previousScore == null ? null : Number(row.previousScore),
  adjustedScore: row.adjustedScore == null ? null : Number(row.adjustedScore),
  reason: String(row.reason || ''),
  reviewerId: row.reviewerId == null ? null : Number(row.reviewerId),
  reviewerName: String(row.reviewerName || '-'),
  predicate: String(row.predicate || '')
});

const buildCalibrationRecord = (row: any, items: any[]) => ({
  id: Number(row.id),
  periodeId: Number(row.periodeId),
  periodeName: String(row.periodeName || '-'),
  sessionName: String(row.sessionName || ''),
  calibrationDate: String(row.calibrationDate || ''),
  chairpersonId: Number(row.chairpersonId),
  chairpersonName: String(row.chairpersonName || '-'),
  note: String(row.note || ''),
  status: String(row.status || 'draft'),
  totalItems: Number(row.totalItems || 0),
  items: items.map(buildCalibrationItemRecord)
});

const resolvePredicateByPolicy = async (policyId: number | null, score: number) => {
  if (!policyId) return score >= 110 ? 'Istimewa' : score >= 90 ? 'Baik Sekali' : score >= 76 ? 'Baik' : score >= 60 ? 'Cukup' : 'Perlu Pembinaan';
  const [rows] = await pool.query<any[]>(
    `SELECT nama_predikat AS predicateName FROM kinerja_kebijakan_predikat WHERE kebijakan_id = ? AND status = 'aktif' AND ? BETWEEN nilai_min AND nilai_max ORDER BY nilai_min DESC LIMIT 1`,
    [policyId, score]
  );
  return rows.length ? String(rows[0].predicateName || '') : (score >= 90 ? 'Baik Sekali' : score >= 76 ? 'Baik' : 'Perlu Pembinaan');
};

const getPolicyWeights = async (policyId: number | null) => {
  const defaults: Record<string, number> = { iku: 10, iki: 50, penugasan: 15, aktivitas: 15, perilaku: 10 };
  if (!policyId) return defaults;
  const [rows] = await pool.query<any[]>(
    `SELECT komponen AS component, MAX(bobot) AS weight FROM kinerja_kebijakan_formula WHERE kebijakan_id = ? AND status = 'aktif' GROUP BY komponen`,
    [policyId]
  );
  for (const row of rows) {
    defaults[String(row.component)] = Number(row.weight || 0);
  }
  return defaults;
};

const applyRounding = (value: number, roundingType: string) => {
  if (roundingType === 'ke_atas') return Math.ceil(value * 100) / 100;
  if (roundingType === 'ke_bawah') return Math.floor(value * 100) / 100;
  return Math.round(value * 100) / 100;
};

const resolveComponentScore = async (policyId: number | null, component: string, rawScore: number) => {
  if (!policyId) return rawScore;
  const [rows] = await pool.query<any[]>(
    `SELECT batas_min AS minScore, batas_max AS maxScore, pembulatan AS roundingType, penalti AS penalty, bonus
     FROM kinerja_kebijakan_formula
     WHERE kebijakan_id = ? AND komponen = ? AND status = 'aktif'
     ORDER BY id DESC LIMIT 1`,
    [policyId, component]
  );
  if (!rows.length) return rawScore;
  let value = rawScore;
  const row = rows[0];
  if (row.minScore != null && value < Number(row.minScore)) value = Number(row.minScore);
  if (row.maxScore != null && value > Number(row.maxScore)) value = Number(row.maxScore);
  if (row.penalty != null) value -= Number(row.penalty);
  if (row.bonus != null) value += Number(row.bonus);
  if (value < 0) value = 0;
  return applyRounding(value, String(row.roundingType || 'normal'));
};

export const getKinerjaPolicies = asyncHandler(async (req, res) => {
  await ensureEvaluationSchema();
  const periodId = readOptionalPositiveId(req.query.periodeId, 'Periode');
  const status = readTrimmedString(req.query.status);
  const params: any[] = [];
  const where: string[] = [];
  if (periodId) { where.push('kp.periode_id = ?'); params.push(periodId); }
  if (status) { where.push('kp.status = ?'); params.push(status); }
  const [rows] = await pool.query<any[]>(
    `SELECT kp.id, kp.periode_id AS periodeId, COALESCE(p.nama_periode, '-') AS periodeName,
            kp.nama_kebijakan AS policyName, kp.versi AS version, kp.tanggal_berlaku AS effectiveDate,
            kp.status, kp.catatan AS note, kp.dibuat_pada AS createdAt, kp.diperbarui_pada AS updatedAt
     FROM kinerja_kebijakan_penilaian kp
     LEFT JOIN kinerja_periode p ON p.id = kp.periode_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY kp.tanggal_berlaku DESC, kp.id DESC`,
    params
  );
  return sendSuccess(res, rows.map(buildPolicyRecord));
});

export const createKinerjaPolicy = asyncHandler(async (req, res) => {
  await ensureEvaluationSchema();
  const payload = normalizePolicyPayload(req.body || {});
  if (payload.periodeId) await ensurePeriodExists(payload.periodeId);
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO kinerja_kebijakan_penilaian (periode_id, nama_kebijakan, versi, tanggal_berlaku, status, catatan)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [payload.periodeId, payload.policyName, payload.version, payload.effectiveDate, payload.status, payload.note || null]
  );
  return sendSuccess(res, { id: result.insertId }, 'Kebijakan penilaian berhasil ditambahkan', 201);
});

export const updateKinerjaPolicy = asyncHandler(async (req, res) => {
  await ensureEvaluationSchema();
  const id = readPositiveId(req.params.id, 'Kebijakan penilaian');
  await ensurePolicyExists(id);
  const payload = normalizePolicyPayload(req.body || {});
  if (payload.periodeId) await ensurePeriodExists(payload.periodeId);
  await pool.query(
    `UPDATE kinerja_kebijakan_penilaian SET periode_id = ?, nama_kebijakan = ?, versi = ?, tanggal_berlaku = ?, status = ?, catatan = ? WHERE id = ?`,
    [payload.periodeId, payload.policyName, payload.version, payload.effectiveDate, payload.status, payload.note || null, id]
  );
  return sendSuccess(res, null, 'Kebijakan penilaian berhasil diperbarui');
});

export const activateKinerjaPolicy = asyncHandler(async (req, res) => {
  await ensureEvaluationSchema();
  const id = readPositiveId(req.params.id, 'Kebijakan penilaian');
  await ensurePolicyExists(id);
  const [[policy]] = await pool.query<any[]>(`SELECT periode_id AS periodeId FROM kinerja_kebijakan_penilaian WHERE id = ? LIMIT 1`, [id]);
  if (policy?.periodeId) {
    await pool.query(`UPDATE kinerja_kebijakan_penilaian SET status = 'nonaktif' WHERE periode_id = ?`, [policy.periodeId]);
  } else {
    await pool.query(`UPDATE kinerja_kebijakan_penilaian SET status = 'nonaktif' WHERE periode_id IS NULL`);
  }
  await pool.query(`UPDATE kinerja_kebijakan_penilaian SET status = 'aktif' WHERE id = ?`, [id]);
  return sendSuccess(res, null, 'Kebijakan penilaian berhasil diaktifkan');
});

export const getKinerjaPolicyFormulas = asyncHandler(async (req, res) => {
  await ensureEvaluationSchema();
  const policyId = readOptionalPositiveId(req.query.policyId, 'Kebijakan penilaian');
  const params: any[] = [];
  const where: string[] = [];
  if (policyId) { where.push('f.kebijakan_id = ?'); params.push(policyId); }
  const [rows] = await pool.query<any[]>(
    `SELECT f.id, f.kebijakan_id AS policyId, kp.nama_kebijakan AS policyName, f.komponen AS component,
            f.jenis_jabatan AS jobType, f.bobot AS weight, f.formula, f.batas_min AS minScore,
            f.batas_max AS maxScore, f.pembulatan AS roundingType, f.penalti AS penalty, f.bonus,
            f.status
     FROM kinerja_kebijakan_formula f
     INNER JOIN kinerja_kebijakan_penilaian kp ON kp.id = f.kebijakan_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY kp.nama_kebijakan ASC, FIELD(f.komponen, 'iku','iki','penugasan','aktivitas','perilaku'), f.id DESC`,
    params
  );
  return sendSuccess(res, rows.map(buildFormulaRecord));
});

export const createKinerjaPolicyFormula = asyncHandler(async (req, res) => {
  await ensureEvaluationSchema();
  const payload = normalizeFormulaPayload(req.body || {});
  await ensurePolicyExists(payload.policyId);
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO kinerja_kebijakan_formula (kebijakan_id, komponen, jenis_jabatan, bobot, formula, batas_min, batas_max, pembulatan, penalti, bonus, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [payload.policyId, payload.component, payload.jobType, payload.weight, payload.formula || null, payload.minScore, payload.maxScore, payload.roundingType, payload.penalty, payload.bonus, payload.status]
  );
  return sendSuccess(res, { id: result.insertId }, 'Formula penilaian berhasil ditambahkan', 201);
});

export const updateKinerjaPolicyFormula = asyncHandler(async (req, res) => {
  await ensureEvaluationSchema();
  const id = readPositiveId(req.params.id, 'Formula penilaian');
  const payload = normalizeFormulaPayload(req.body || {});
  await ensurePolicyExists(payload.policyId);
  await pool.query(
    `UPDATE kinerja_kebijakan_formula SET kebijakan_id = ?, komponen = ?, jenis_jabatan = ?, bobot = ?, formula = ?, batas_min = ?, batas_max = ?, pembulatan = ?, penalti = ?, bonus = ?, status = ? WHERE id = ?`,
    [payload.policyId, payload.component, payload.jobType, payload.weight, payload.formula || null, payload.minScore, payload.maxScore, payload.roundingType, payload.penalty, payload.bonus, payload.status, id]
  );
  return sendSuccess(res, null, 'Formula penilaian berhasil diperbarui');
});

export const getKinerjaPredicates = asyncHandler(async (req, res) => {
  await ensureEvaluationSchema();
  const policyId = readOptionalPositiveId(req.query.policyId, 'Kebijakan penilaian');
  const params: any[] = [];
  const where: string[] = [];
  if (policyId) { where.push('p.kebijakan_id = ?'); params.push(policyId); }
  const [rows] = await pool.query<any[]>(
    `SELECT p.id, p.kebijakan_id AS policyId, kp.nama_kebijakan AS policyName, p.nilai_min AS minScore,
            p.nilai_max AS maxScore, p.nama_predikat AS predicateName, p.rekomendasi AS recommendation, p.status
     FROM kinerja_kebijakan_predikat p
     INNER JOIN kinerja_kebijakan_penilaian kp ON kp.id = p.kebijakan_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY kp.nama_kebijakan ASC, p.nilai_min DESC, p.id DESC`,
    params
  );
  return sendSuccess(res, rows.map(buildPredicateRecord));
});

export const createKinerjaPredicate = asyncHandler(async (req, res) => {
  await ensureEvaluationSchema();
  const payload = normalizePredicatePayload(req.body || {});
  await ensurePolicyExists(payload.policyId);
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO kinerja_kebijakan_predikat (kebijakan_id, nilai_min, nilai_max, nama_predikat, rekomendasi, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [payload.policyId, payload.minScore, payload.maxScore, payload.predicateName, payload.recommendation || null, payload.status]
  );
  return sendSuccess(res, { id: result.insertId }, 'Predikat kinerja berhasil ditambahkan', 201);
});

export const updateKinerjaPredicate = asyncHandler(async (req, res) => {
  await ensureEvaluationSchema();
  const id = readPositiveId(req.params.id, 'Predikat kinerja');
  const payload = normalizePredicatePayload(req.body || {});
  await ensurePolicyExists(payload.policyId);
  await pool.query(
    `UPDATE kinerja_kebijakan_predikat SET kebijakan_id = ?, nilai_min = ?, nilai_max = ?, nama_predikat = ?, rekomendasi = ?, status = ? WHERE id = ?`,
    [payload.policyId, payload.minScore, payload.maxScore, payload.predicateName, payload.recommendation || null, payload.status, id]
  );
  return sendSuccess(res, null, 'Predikat kinerja berhasil diperbarui');
});

export const getKinerjaMidyearEvaluations = asyncHandler(async (req, res) => {
  await ensureEvaluationSchema();
  const periodId = readOptionalPositiveId(req.query.periodeId, 'Periode kinerja');
  const params: any[] = [];
  const where: string[] = [];
  if (periodId) { where.push('e.periode_id = ?'); params.push(periodId); }
  const [rows] = await pool.query<any[]>(
    `SELECT e.id, e.periode_id AS periodeId, p.nama_periode AS periodeName,
            e.pegawai_id AS employeeId, emp.nama_lengkap AS employeeName,
            e.penilai_id AS evaluatorId, pen.nama_lengkap AS evaluatorName,
            e.kebijakan_id AS policyId, COALESCE(k.nama_kebijakan, '-') AS policyName,
            e.ringkasan_capaian AS achievementSummary, e.hambatan AS obstacles,
            e.rencana_perbaikan AS improvementPlan, e.nilai_sementara AS temporaryScore,
            e.catatan_penilai AS evaluatorNote, e.tanggal_evaluasi AS evaluationDate, e.status
     FROM kinerja_evaluasi_tengah_tahun e
     INNER JOIN kinerja_periode p ON p.id = e.periode_id
     INNER JOIN pegawai emp ON emp.id = e.pegawai_id
     INNER JOIN pegawai pen ON pen.id = e.penilai_id
     LEFT JOIN kinerja_kebijakan_penilaian k ON k.id = e.kebijakan_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY e.tanggal_evaluasi DESC, emp.nama_lengkap ASC`,
    params
  );
  return sendSuccess(res, rows.map(buildMidyearRecord));
});

export const createKinerjaMidyearEvaluation = asyncHandler(async (req: AuthenticatedRequest, res) => {
  await ensureEvaluationSchema();
  const payload = normalizeMidyearPayload(req.body || {}, req.user?.employeeId || null);
  await ensurePeriodExists(payload.periodeId);
  await ensureEmployeeExists(payload.employeeId);
  await ensureEmployeeExists(payload.evaluatorId);
  if (payload.policyId) await ensurePolicyExists(payload.policyId);
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO kinerja_evaluasi_tengah_tahun
      (periode_id, pegawai_id, penilai_id, kebijakan_id, ringkasan_capaian, hambatan, rencana_perbaikan, nilai_sementara, catatan_penilai, tanggal_evaluasi, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE penilai_id = VALUES(penilai_id), kebijakan_id = VALUES(kebijakan_id), ringkasan_capaian = VALUES(ringkasan_capaian), hambatan = VALUES(hambatan), rencana_perbaikan = VALUES(rencana_perbaikan), nilai_sementara = VALUES(nilai_sementara), catatan_penilai = VALUES(catatan_penilai), tanggal_evaluasi = VALUES(tanggal_evaluasi), status = VALUES(status)`,
    [payload.periodeId, payload.employeeId, payload.evaluatorId, payload.policyId, payload.achievementSummary || null, payload.obstacles || null, payload.improvementPlan || null, payload.temporaryScore, payload.evaluatorNote || null, payload.evaluationDate, payload.status]
  );
  return sendSuccess(res, { id: result.insertId || 0 }, 'Evaluasi tengah tahun berhasil disimpan', 201);
});

export const updateKinerjaMidyearEvaluation = asyncHandler(async (req: AuthenticatedRequest, res) => {
  await ensureEvaluationSchema();
  const id = readPositiveId(req.params.id, 'Evaluasi tengah tahun');
  await ensureMidyearEvaluationExists(id);
  const payload = normalizeMidyearPayload(req.body || {}, req.user?.employeeId || null);
  await ensurePeriodExists(payload.periodeId);
  await ensureEmployeeExists(payload.employeeId);
  await ensureEmployeeExists(payload.evaluatorId);
  if (payload.policyId) await ensurePolicyExists(payload.policyId);
  await pool.query(
    `UPDATE kinerja_evaluasi_tengah_tahun SET periode_id = ?, pegawai_id = ?, penilai_id = ?, kebijakan_id = ?, ringkasan_capaian = ?, hambatan = ?, rencana_perbaikan = ?, nilai_sementara = ?, catatan_penilai = ?, tanggal_evaluasi = ?, status = ? WHERE id = ?`,
    [payload.periodeId, payload.employeeId, payload.evaluatorId, payload.policyId, payload.achievementSummary || null, payload.obstacles || null, payload.improvementPlan || null, payload.temporaryScore, payload.evaluatorNote || null, payload.evaluationDate, payload.status, id]
  );
  return sendSuccess(res, null, 'Evaluasi tengah tahun berhasil diperbarui');
});

export const finalizeKinerjaMidyearEvaluation = asyncHandler(async (req, res) => {
  await ensureEvaluationSchema();
  const id = readPositiveId(req.params.id, 'Evaluasi tengah tahun');
  await ensureMidyearEvaluationExists(id);
  await pool.query(`UPDATE kinerja_evaluasi_tengah_tahun SET status = 'final' WHERE id = ?`, [id]);
  return sendSuccess(res, null, 'Evaluasi tengah tahun berhasil difinalkan');
});

export const getKinerjaFinalEvaluations = asyncHandler(async (req, res) => {
  await ensureEvaluationSchema();
  const periodId = readOptionalPositiveId(req.query.periodeId, 'Periode kinerja');
  const params: any[] = [];
  const where: string[] = [];
  if (periodId) { where.push('e.periode_id = ?'); params.push(periodId); }
  const [rows] = await pool.query<any[]>(
    `SELECT e.id, e.periode_id AS periodeId, p.nama_periode AS periodeName,
            e.pegawai_id AS employeeId, emp.nama_lengkap AS employeeName,
            e.penilai_id AS evaluatorId, pen.nama_lengkap AS evaluatorName,
            e.kebijakan_id AS policyId, COALESCE(k.nama_kebijakan, '-') AS policyName,
            e.nilai_iku AS ikuScore, e.nilai_iki AS ikiScore, e.nilai_penugasan AS assignmentScore,
            e.nilai_aktivitas AS activityScore, e.nilai_perilaku AS behaviorScore, e.nilai_akhir AS finalScore,
            e.predikat AS predicate, e.catatan_penilai AS evaluatorNote, e.tanggal_evaluasi AS evaluationDate, e.status
     FROM kinerja_evaluasi_akhir_tahun e
     INNER JOIN kinerja_periode p ON p.id = e.periode_id
     INNER JOIN pegawai emp ON emp.id = e.pegawai_id
     INNER JOIN pegawai pen ON pen.id = e.penilai_id
     LEFT JOIN kinerja_kebijakan_penilaian k ON k.id = e.kebijakan_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY e.tanggal_evaluasi DESC, emp.nama_lengkap ASC`,
    params
  );
  return sendSuccess(res, rows.map(buildFinalRecord));
});

export const generateKinerjaFinalEvaluations = asyncHandler(async (req: AuthenticatedRequest, res) => {
  await ensureEvaluationSchema();
  const periodId = readPositiveId(req.body?.periodeId, 'Periode kinerja');
  const policyId = readOptionalPositiveId(req.body?.policyId, 'Kebijakan penilaian');
  const evaluatorId = readOptionalPositiveId(req.body?.evaluatorId, 'Penilai') || req.user?.employeeId || 0;
  const evaluationDate = readDateString(req.body?.evaluationDate || new Date().toISOString().slice(0, 10), 'Tanggal evaluasi');
  await ensurePeriodExists(periodId);
  await ensureEmployeeExists(evaluatorId);
  if (policyId) await ensurePolicyExists(policyId);

  const weights = await getPolicyWeights(policyId);

  const [rows] = await pool.query<any[]>(
    `SELECT e.id AS employeeId,
            e.nama_lengkap AS employeeName,
            COALESCE(real.avgAchievement, 0) AS ikiScoreRaw,
            COALESCE(assign.avgProgress, 0) AS assignmentScoreRaw,
            COALESCE(activity.activityScoreRaw, 0) AS activityScoreRaw,
            90 AS behaviorScoreRaw
     FROM pegawai e
     INNER JOIN (
       SELECT DISTINCT pegawai_id FROM kinerja_iki_pegawai WHERE periode_id = ?
     ) iki ON iki.pegawai_id = e.id
     LEFT JOIN (
       SELECT iki.pegawai_id, AVG(COALESCE(r.persentase_capaian, 0)) AS avgAchievement
       FROM kinerja_iki_pegawai iki
       LEFT JOIN kinerja_realisasi_indikator r ON r.iki_pegawai_id = iki.id
       WHERE iki.periode_id = ?
       GROUP BY iki.pegawai_id
     ) real ON real.pegawai_id = e.id
     LEFT JOIN (
       SELECT employee_id, AVG(COALESCE(progress, 0)) AS avgProgress
       FROM kinerja_assignment
       WHERE periode_id = ?
       GROUP BY employee_id
     ) assign ON assign.employee_id = e.id
     LEFT JOIN (
       SELECT employee_id,
              LEAST(100, COUNT(*) * 10) AS activityScoreRaw
       FROM kinerja_logbook
       WHERE periode_id = ?
       GROUP BY employee_id
     ) activity ON activity.employee_id = e.id
     ORDER BY e.nama_lengkap ASC`,
    [periodId, periodId, periodId, periodId]
  );

  let processed = 0;
  for (const row of rows) {
    const ikuScore = await resolveComponentScore(policyId, 'iku', Number(row.ikiScoreRaw || 0));
    const ikiScore = await resolveComponentScore(policyId, 'iki', Number(row.ikiScoreRaw || 0));
    const assignmentScore = await resolveComponentScore(policyId, 'penugasan', Number(row.assignmentScoreRaw || 0));
    const activityScore = await resolveComponentScore(policyId, 'aktivitas', Number(row.activityScoreRaw || 0));
    const behaviorScore = await resolveComponentScore(policyId, 'perilaku', Number(row.behaviorScoreRaw || 90));
    const totalWeight = Object.values(weights).reduce((sum, item) => sum + Number(item || 0), 0) || 100;
    const finalScore = applyRounding(
      ((ikuScore * weights.iku) + (ikiScore * weights.iki) + (assignmentScore * weights.penugasan) + (activityScore * weights.aktivitas) + (behaviorScore * weights.perilaku)) / totalWeight,
      'normal'
    );
    const predicate = await resolvePredicateByPolicy(policyId, finalScore);
    await pool.query(
      `INSERT INTO kinerja_evaluasi_akhir_tahun
        (periode_id, pegawai_id, penilai_id, kebijakan_id, nilai_iku, nilai_iki, nilai_penugasan, nilai_aktivitas, nilai_perilaku, nilai_akhir, predikat, catatan_penilai, tanggal_evaluasi, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'generated')
       ON DUPLICATE KEY UPDATE penilai_id = VALUES(penilai_id), kebijakan_id = VALUES(kebijakan_id), nilai_iku = VALUES(nilai_iku), nilai_iki = VALUES(nilai_iki), nilai_penugasan = VALUES(nilai_penugasan), nilai_aktivitas = VALUES(nilai_aktivitas), nilai_perilaku = VALUES(nilai_perilaku), nilai_akhir = VALUES(nilai_akhir), predikat = VALUES(predikat), tanggal_evaluasi = VALUES(tanggal_evaluasi), status = 'generated'`,
      [periodId, Number(row.employeeId), evaluatorId, policyId, ikuScore, ikiScore, assignmentScore, activityScore, behaviorScore, finalScore, predicate, 'Dihasilkan otomatis dari data Fase 1 sampai 4', evaluationDate]
    );
    processed += 1;
  }

  return sendSuccess(res, { processed }, 'Evaluasi akhir tahun berhasil dihasilkan');
});

export const updateKinerjaFinalEvaluation = asyncHandler(async (req: AuthenticatedRequest, res) => {
  await ensureEvaluationSchema();
  const id = readPositiveId(req.params.id, 'Evaluasi akhir tahun');
  await ensureFinalEvaluationExists(id);
  const payload = normalizeFinalPayload(req.body || {}, req.user?.employeeId || null);
  await ensurePeriodExists(payload.periodeId);
  await ensureEmployeeExists(payload.employeeId);
  await ensureEmployeeExists(payload.evaluatorId);
  if (payload.policyId) await ensurePolicyExists(payload.policyId);
  const predicate = payload.predicate || await resolvePredicateByPolicy(payload.policyId, Number(payload.finalScore || 0));
  await pool.query(
    `UPDATE kinerja_evaluasi_akhir_tahun SET periode_id = ?, pegawai_id = ?, penilai_id = ?, kebijakan_id = ?, nilai_iku = ?, nilai_iki = ?, nilai_penugasan = ?, nilai_aktivitas = ?, nilai_perilaku = ?, nilai_akhir = ?, predikat = ?, catatan_penilai = ?, tanggal_evaluasi = ?, status = ? WHERE id = ?`,
    [payload.periodeId, payload.employeeId, payload.evaluatorId, payload.policyId, payload.ikuScore, payload.ikiScore, payload.assignmentScore, payload.activityScore, payload.behaviorScore, payload.finalScore, predicate, payload.evaluatorNote || null, payload.evaluationDate, payload.status, id]
  );
  return sendSuccess(res, null, 'Evaluasi akhir tahun berhasil diperbarui');
});

export const finalizeKinerjaFinalEvaluation = asyncHandler(async (req, res) => {
  await ensureEvaluationSchema();
  const id = readPositiveId(req.params.id, 'Evaluasi akhir tahun');
  await ensureFinalEvaluationExists(id);
  await pool.query(`UPDATE kinerja_evaluasi_akhir_tahun SET status = 'finalized' WHERE id = ?`, [id]);
  return sendSuccess(res, null, 'Evaluasi akhir tahun berhasil difinalkan');
});

export const getKinerjaCalibrations = asyncHandler(async (_req, res) => {
  await ensureEvaluationSchema();
  const [sessions] = await pool.query<any[]>(
    `SELECT c.id, c.periode_id AS periodeId, p.nama_periode AS periodeName, c.nama_sesi AS sessionName,
            c.tanggal_kalibrasi AS calibrationDate, c.ketua_sesi_id AS chairpersonId,
            emp.nama_lengkap AS chairpersonName, c.catatan AS note, c.status,
            COUNT(i.id) AS totalItems
     FROM kinerja_kalibrasi c
     INNER JOIN kinerja_periode p ON p.id = c.periode_id
     INNER JOIN pegawai emp ON emp.id = c.ketua_sesi_id
     LEFT JOIN kinerja_kalibrasi_item i ON i.kalibrasi_id = c.id
     GROUP BY c.id
     ORDER BY c.tanggal_kalibrasi DESC, c.id DESC`
  );
  const [items] = await pool.query<any[]>(
    `SELECT i.id, i.kalibrasi_id AS calibrationId, i.evaluasi_akhir_id AS evaluationId, i.pegawai_id AS employeeId,
            emp.nama_lengkap AS employeeName, i.nilai_sebelum AS previousScore, i.nilai_sesudah AS adjustedScore,
            i.alasan_perubahan AS reason, i.reviewer_id AS reviewerId, COALESCE(r.nama_lengkap, '-') AS reviewerName,
            COALESCE(e.predikat, '-') AS predicate
     FROM kinerja_kalibrasi_item i
     INNER JOIN pegawai emp ON emp.id = i.pegawai_id
     LEFT JOIN pegawai r ON r.id = i.reviewer_id
     LEFT JOIN kinerja_evaluasi_akhir_tahun e ON e.id = i.evaluasi_akhir_id
     ORDER BY i.id DESC`
  );
  const grouped = new Map<number, any[]>();
  for (const item of items) {
    const key = Number(item.calibrationId);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(item);
  }
  return sendSuccess(res, sessions.map((session) => buildCalibrationRecord(session, grouped.get(Number(session.id)) || [])));
});

export const createKinerjaCalibration = asyncHandler(async (req: AuthenticatedRequest, res) => {
  await ensureEvaluationSchema();
  const payload = normalizeCalibrationPayload(req.body || {}, req.user?.employeeId || null);
  await ensurePeriodExists(payload.periodeId);
  await ensureEmployeeExists(payload.chairpersonId);
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO kinerja_kalibrasi (periode_id, nama_sesi, tanggal_kalibrasi, ketua_sesi_id, catatan, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [payload.periodeId, payload.sessionName, payload.calibrationDate, payload.chairpersonId, payload.note || null, payload.status]
  );
  return sendSuccess(res, { id: result.insertId }, 'Sesi kalibrasi berhasil ditambahkan', 201);
});

export const updateKinerjaCalibration = asyncHandler(async (req: AuthenticatedRequest, res) => {
  await ensureEvaluationSchema();
  const id = readPositiveId(req.params.id, 'Sesi kalibrasi');
  await ensureCalibrationExists(id);
  const payload = normalizeCalibrationPayload(req.body || {}, req.user?.employeeId || null);
  await ensurePeriodExists(payload.periodeId);
  await ensureEmployeeExists(payload.chairpersonId);
  await pool.query(
    `UPDATE kinerja_kalibrasi SET periode_id = ?, nama_sesi = ?, tanggal_kalibrasi = ?, ketua_sesi_id = ?, catatan = ?, status = ? WHERE id = ?`,
    [payload.periodeId, payload.sessionName, payload.calibrationDate, payload.chairpersonId, payload.note || null, payload.status, id]
  );
  return sendSuccess(res, null, 'Sesi kalibrasi berhasil diperbarui');
});

export const createKinerjaCalibrationItem = asyncHandler(async (req: AuthenticatedRequest, res) => {
  await ensureEvaluationSchema();
  const calibrationId = readPositiveId(req.params.id, 'Sesi kalibrasi');
  await ensureCalibrationExists(calibrationId);
  const payload = normalizeCalibrationItemPayload(req.body || {}, req.user?.employeeId || null);
  await ensureFinalEvaluationExists(payload.evaluationId);
  await ensureEmployeeExists(payload.employeeId);
  if (payload.reviewerId) await ensureEmployeeExists(payload.reviewerId);
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO kinerja_kalibrasi_item (kalibrasi_id, evaluasi_akhir_id, pegawai_id, nilai_sebelum, nilai_sesudah, alasan_perubahan, reviewer_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE pegawai_id = VALUES(pegawai_id), nilai_sebelum = VALUES(nilai_sebelum), nilai_sesudah = VALUES(nilai_sesudah), alasan_perubahan = VALUES(alasan_perubahan), reviewer_id = VALUES(reviewer_id)`,
    [calibrationId, payload.evaluationId, payload.employeeId, payload.previousScore, payload.adjustedScore, payload.reason || null, payload.reviewerId]
  );
  return sendSuccess(res, { id: result.insertId || 0 }, 'Item kalibrasi berhasil disimpan', 201);
});

export const updateKinerjaCalibrationItem = asyncHandler(async (req: AuthenticatedRequest, res) => {
  await ensureEvaluationSchema();
  const calibrationId = readPositiveId(req.params.id, 'Sesi kalibrasi');
  const itemId = readPositiveId(req.params.itemId, 'Item kalibrasi');
  await ensureCalibrationExists(calibrationId);
  await ensureCalibrationItemExists(itemId);
  const payload = normalizeCalibrationItemPayload(req.body || {}, req.user?.employeeId || null);
  await ensureFinalEvaluationExists(payload.evaluationId);
  await ensureEmployeeExists(payload.employeeId);
  if (payload.reviewerId) await ensureEmployeeExists(payload.reviewerId);
  await pool.query(
    `UPDATE kinerja_kalibrasi_item SET evaluasi_akhir_id = ?, pegawai_id = ?, nilai_sebelum = ?, nilai_sesudah = ?, alasan_perubahan = ?, reviewer_id = ? WHERE id = ? AND kalibrasi_id = ?`,
    [payload.evaluationId, payload.employeeId, payload.previousScore, payload.adjustedScore, payload.reason || null, payload.reviewerId, itemId, calibrationId]
  );
  return sendSuccess(res, null, 'Item kalibrasi berhasil diperbarui');
});

export const closeKinerjaCalibration = asyncHandler(async (req, res) => {
  await ensureEvaluationSchema();
  const calibrationId = readPositiveId(req.params.id, 'Sesi kalibrasi');
  await ensureCalibrationExists(calibrationId);
  const [rows] = await pool.query<any[]>(
    `SELECT i.evaluasi_akhir_id AS evaluationId, i.nilai_sesudah AS adjustedScore, e.kebijakan_id AS policyId
     FROM kinerja_kalibrasi_item i
     INNER JOIN kinerja_evaluasi_akhir_tahun e ON e.id = i.evaluasi_akhir_id
     WHERE i.kalibrasi_id = ?`,
    [calibrationId]
  );
  for (const row of rows) {
    const adjustedScore = row.adjustedScore == null ? null : Number(row.adjustedScore);
    const predicate = adjustedScore == null ? null : await resolvePredicateByPolicy(row.policyId ? Number(row.policyId) : null, adjustedScore);
    await pool.query(
      `UPDATE kinerja_evaluasi_akhir_tahun SET nilai_akhir = COALESCE(?, nilai_akhir), predikat = COALESCE(?, predikat), status = 'calibrated' WHERE id = ?`,
      [adjustedScore, predicate, Number(row.evaluationId)]
    );
  }
  await pool.query(`UPDATE kinerja_kalibrasi SET status = 'closed' WHERE id = ?`, [calibrationId]);
  return sendSuccess(res, null, 'Sesi kalibrasi berhasil ditutup');
});
