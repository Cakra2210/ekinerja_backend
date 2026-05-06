import { ResultSetHeader } from "mysql2";
import { pool } from "../../config/database";
import { asyncHandler, fail, sendSuccess } from "../../shared/http";
import {
  ensureOneOf,
  ensureRequired,
  readDateString,
  readPositiveId,
  readTrimmedString
} from "../../shared/validation";

let referenceMasterSchemaReady = false;

const performanceActivityCategories = [
  "persiapan",
  "pendataan",
  "pengolahan",
  "diseminasi",
  "laporan",
  "evaluasi"
] as const;

const referenceArchiveStatuses = ["aktif", "arsip"] as const;
const kinerjaPeriodTypes = ["tahunan", "semester", "triwulan", "bulanan"] as const;
const kinerjaPeriodStatuses = ["draft", "aktif", "ditutup", "arsip"] as const;

const readPerformanceActivityCategory = (value: unknown) => {
  const normalized = readTrimmedString(value).toLowerCase();
  const categoryValue = normalized === "pegolahan" ? "pengolahan" : normalized;
  return ensureOneOf(categoryValue, performanceActivityCategories, "Kategori");
};

const readReferenceArchiveStatus = (value: unknown, fallback: (typeof referenceArchiveStatuses)[number] = "aktif") => {
  const normalized = readTrimmedString(value).toLowerCase();

  if (!normalized) {
    return fallback;
  }

  return ensureOneOf(normalized, referenceArchiveStatuses, "Status");
};

const readKinerjaPeriodType = (value: unknown) => {
  const normalized = readTrimmedString(value).toLowerCase();
  return ensureOneOf(normalized, kinerjaPeriodTypes, "Jenis periode");
};

const readKinerjaPeriodStatus = (value: unknown, fallback: (typeof kinerjaPeriodStatuses)[number] = "draft") => {
  const normalized = readTrimmedString(value).toLowerCase();

  if (!normalized) {
    return fallback;
  }

  return ensureOneOf(normalized, kinerjaPeriodStatuses, "Status periode");
};

const ensureValidPeriodDateRange = (startDate: string, endDate: string) => {
  const startTime = new Date(startDate).getTime();
  const endTime = new Date(endDate).getTime();

  if (startTime > endTime) {
    fail("Tanggal selesai tidak boleh lebih awal dari tanggal mulai", 400);
  }
};

const ensureValidActivityDateRange = (startDate: string, endDate: string) => {
  const startTime = new Date(startDate).getTime();
  const endTime = new Date(endDate).getTime();

  if (startTime > endTime) {
    fail("Tanggal selesai tidak boleh lebih awal dari tanggal mulai", 400);
  }
};

const ensureColumnExists = async (
  tableName: string,
  columnName: string,
  columnDefinition: string
) => {
  const [rows] = await pool.query<any[]>(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );

  if (!rows.length) {
    await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`);
  }
};

const ensureIndexExists = async (
  tableName: string,
  indexName: string,
  createSql: string
) => {
  const [rows] = await pool.query<any[]>(
    `SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?
     LIMIT 1`,
    [tableName, indexName]
  );

  if (!rows.length) {
    await pool.query(createSql);
  }
};

const ensureForeignKeyExists = async (
  tableName: string,
  constraintName: string,
  addSql: string
) => {
  const [rows] = await pool.query<any[]>(
    `SELECT CONSTRAINT_NAME
     FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND CONSTRAINT_NAME = ?
     LIMIT 1`,
    [tableName, constraintName]
  );

  if (!rows.length) {
    await pool.query(addSql);
  }
};

const dropIndexIfExists = async (tableName: string, indexName: string) => {
  const [rows] = await pool.query<any[]>(
    `SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?
     LIMIT 1`,
    [tableName, indexName]
  );

  if (rows.length) {
    await pool.query(`ALTER TABLE ${tableName} DROP INDEX ${indexName}`);
  }
};

const ensureReferenceMasterSchema = async () => {
  if (referenceMasterSchemaReady) {
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS indikator_kinerja (
      id INT NOT NULL AUTO_INCREMENT,
      tim_kerja_id INT NULL,
      nama VARCHAR(255) NOT NULL,
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_indikator_kinerja_tim_kerja_id (tim_kerja_id),
      UNIQUE KEY uq_indikator_kinerja_tim_nama (tim_kerja_id, nama)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await ensureColumnExists(
    "indikator_kinerja",
    "tim_kerja_id",
    "tim_kerja_id INT NULL AFTER id"
  );
  await dropIndexIfExists("indikator_kinerja", "uq_indikator_kinerja_nama");
  await ensureIndexExists(
    "indikator_kinerja",
    "idx_indikator_kinerja_tim_kerja_id",
    "ALTER TABLE indikator_kinerja ADD INDEX idx_indikator_kinerja_tim_kerja_id (tim_kerja_id)"
  );
  await ensureIndexExists(
    "indikator_kinerja",
    "uq_indikator_kinerja_tim_nama",
    "ALTER TABLE indikator_kinerja ADD UNIQUE KEY uq_indikator_kinerja_tim_nama (tim_kerja_id, nama)"
  );
  await ensureForeignKeyExists(
    "indikator_kinerja",
    "fk_indikator_kinerja_tim_kerja",
    `ALTER TABLE indikator_kinerja
     ADD CONSTRAINT fk_indikator_kinerja_tim_kerja
     FOREIGN KEY (tim_kerja_id) REFERENCES kinerja_tim_kerja (id)
     ON DELETE RESTRICT ON UPDATE CASCADE`
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kegiatan_indikator_kinerja (
      id INT NOT NULL AUTO_INCREMENT,
      indikator_kinerja_id INT NOT NULL,
      nama VARCHAR(255) NOT NULL,
      kategori VARCHAR(50) NULL,
      tanggal_mulai DATE NULL,
      tanggal_selesai DATE NULL,
      target VARCHAR(100) NULL,
      satuan VARCHAR(100) NULL,
      catatan TEXT NULL,
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_kegiatan_indikator_nama (indikator_kinerja_id, nama),
      KEY idx_kegiatan_indikator_kinerja_id (indikator_kinerja_id),
      CONSTRAINT fk_kegiatan_indikator_kinerja
        FOREIGN KEY (indikator_kinerja_id) REFERENCES indikator_kinerja (id)
        ON DELETE RESTRICT ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await ensureColumnExists(
    "kegiatan_indikator_kinerja",
    "kategori",
    "kategori VARCHAR(50) NULL AFTER nama"
  );
  await ensureColumnExists(
    "kegiatan_indikator_kinerja",
    "tanggal_mulai",
    "tanggal_mulai DATE NULL AFTER kategori"
  );
  await ensureColumnExists(
    "kegiatan_indikator_kinerja",
    "tanggal_selesai",
    "tanggal_selesai DATE NULL AFTER tanggal_mulai"
  );
  await ensureColumnExists(
    "kegiatan_indikator_kinerja",
    "target",
    "target VARCHAR(100) NULL AFTER tanggal_selesai"
  );
  await ensureColumnExists(
    "kegiatan_indikator_kinerja",
    "satuan",
    "satuan VARCHAR(100) NULL AFTER target"
  );
  await ensureColumnExists(
    "kegiatan_indikator_kinerja",
    "catatan",
    "catatan TEXT NULL AFTER satuan"
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_periode (
      id INT NOT NULL AUTO_INCREMENT,
      tahun SMALLINT NOT NULL,
      nama_periode VARCHAR(120) NOT NULL,
      jenis_periode ENUM('tahunan','semester','triwulan','bulanan') NOT NULL DEFAULT 'tahunan',
      tanggal_mulai DATE NOT NULL,
      tanggal_selesai DATE NOT NULL,
      status ENUM('draft','aktif','ditutup','arsip') NOT NULL DEFAULT 'draft',
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_kinerja_periode_tahun_nama (tahun, nama_periode)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_satuan (
      id INT NOT NULL AUTO_INCREMENT,
      nama_satuan VARCHAR(100) NOT NULL,
      keterangan VARCHAR(200) NULL,
      status ENUM('aktif','arsip') NOT NULL DEFAULT 'aktif',
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_kinerja_satuan_nama (nama_satuan)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_kategori_aktivitas (
      id INT NOT NULL AUTO_INCREMENT,
      kode VARCHAR(50) NOT NULL,
      nama_kategori VARCHAR(100) NOT NULL,
      urutan INT NOT NULL DEFAULT 0,
      status ENUM('aktif','arsip') NOT NULL DEFAULT 'aktif',
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_kinerja_kategori_aktivitas_kode (kode),
      UNIQUE KEY uq_kinerja_kategori_aktivitas_nama (nama_kategori)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(
    `INSERT INTO kinerja_kategori_aktivitas (kode, nama_kategori, urutan)
     VALUES
       ('persiapan', 'Persiapan', 1),
       ('pendataan', 'Pendataan', 2),
       ('pengolahan', 'Pengolahan', 3),
       ('diseminasi', 'Diseminasi', 4),
       ('laporan', 'Laporan', 5),
       ('evaluasi', 'Evaluasi', 6)
     ON DUPLICATE KEY UPDATE
       nama_kategori = VALUES(nama_kategori),
       urutan = VALUES(urutan)`
  );

  await pool.query(
    `INSERT INTO kinerja_satuan (nama_satuan, keterangan)
     VALUES
       ('dokumen', 'Jumlah dokumen'),
       ('kegiatan', 'Jumlah kegiatan'),
       ('laporan', 'Jumlah laporan'),
       ('publikasi', 'Jumlah publikasi'),
       ('layanan', 'Jumlah layanan'),
       ('persen', 'Persentase'),
       ('responden', 'Jumlah responden'),
       ('wilayah', 'Jumlah wilayah'),
       ('paket', 'Jumlah paket pekerjaan')
     ON DUPLICATE KEY UPDATE
       keterangan = VALUES(keterangan)`
  );

  await ensureColumnExists(
    "indikator_kinerja",
    "periode_id",
    "periode_id INT NULL AFTER id"
  );
  await ensureColumnExists(
    "indikator_kinerja",
    "jenis_indikator",
    "jenis_indikator ENUM('iku_satker','indikator_tim','iki_template') NOT NULL DEFAULT 'indikator_tim' AFTER nama"
  );
  await ensureColumnExists(
    "indikator_kinerja",
    "definisi",
    "definisi TEXT NULL AFTER jenis_indikator"
  );
  await ensureColumnExists(
    "indikator_kinerja",
    "formula",
    "formula TEXT NULL AFTER definisi"
  );
  await ensureColumnExists(
    "indikator_kinerja",
    "target_default",
    "target_default DECIMAL(18,2) NULL AFTER formula"
  );
  await ensureColumnExists(
    "indikator_kinerja",
    "satuan_id",
    "satuan_id INT NULL AFTER target_default"
  );
  await ensureColumnExists(
    "indikator_kinerja",
    "bobot_default",
    "bobot_default DECIMAL(5,2) NULL AFTER satuan_id"
  );
  await ensureColumnExists(
    "indikator_kinerja",
    "sumber_data",
    "sumber_data VARCHAR(255) NULL AFTER bobot_default"
  );
  await ensureColumnExists(
    "indikator_kinerja",
    "frekuensi_pelaporan",
    "frekuensi_pelaporan ENUM('bulanan','triwulan','semester','tahunan') NOT NULL DEFAULT 'bulanan' AFTER sumber_data"
  );
  await ensureColumnExists(
    "indikator_kinerja",
    "status",
    "status ENUM('aktif','arsip') NOT NULL DEFAULT 'aktif' AFTER frekuensi_pelaporan"
  );
  await ensureIndexExists(
    "indikator_kinerja",
    "idx_indikator_kinerja_periode",
    "ALTER TABLE indikator_kinerja ADD INDEX idx_indikator_kinerja_periode (periode_id)"
  );
  await ensureIndexExists(
    "indikator_kinerja",
    "idx_indikator_kinerja_satuan",
    "ALTER TABLE indikator_kinerja ADD INDEX idx_indikator_kinerja_satuan (satuan_id)"
  );
  await ensureForeignKeyExists(
    "indikator_kinerja",
    "fk_indikator_kinerja_periode",
    `ALTER TABLE indikator_kinerja
     ADD CONSTRAINT fk_indikator_kinerja_periode
     FOREIGN KEY (periode_id) REFERENCES kinerja_periode (id)
     ON DELETE SET NULL ON UPDATE CASCADE`
  );
  await ensureForeignKeyExists(
    "indikator_kinerja",
    "fk_indikator_kinerja_satuan",
    `ALTER TABLE indikator_kinerja
     ADD CONSTRAINT fk_indikator_kinerja_satuan
     FOREIGN KEY (satuan_id) REFERENCES kinerja_satuan (id)
     ON DELETE SET NULL ON UPDATE CASCADE`
  );

  await ensureColumnExists(
    "kegiatan_indikator_kinerja",
    "kode_kegiatan",
    "kode_kegiatan VARCHAR(60) NULL AFTER id"
  );
  await ensureColumnExists(
    "kegiatan_indikator_kinerja",
    "kategori_id",
    "kategori_id INT NULL AFTER indikator_kinerja_id"
  );
  await ensureColumnExists(
    "kegiatan_indikator_kinerja",
    "satuan_id",
    "satuan_id INT NULL AFTER target"
  );
  await ensureColumnExists(
    "kegiatan_indikator_kinerja",
    "status",
    "status ENUM('aktif','arsip') NOT NULL DEFAULT 'aktif' AFTER catatan"
  );
  await ensureIndexExists(
    "kegiatan_indikator_kinerja",
    "idx_kegiatan_indikator_kategori",
    "ALTER TABLE kegiatan_indikator_kinerja ADD INDEX idx_kegiatan_indikator_kategori (kategori_id)"
  );
  await ensureIndexExists(
    "kegiatan_indikator_kinerja",
    "idx_kegiatan_indikator_satuan",
    "ALTER TABLE kegiatan_indikator_kinerja ADD INDEX idx_kegiatan_indikator_satuan (satuan_id)"
  );
  await ensureForeignKeyExists(
    "kegiatan_indikator_kinerja",
    "fk_kegiatan_indikator_kategori",
    `ALTER TABLE kegiatan_indikator_kinerja
     ADD CONSTRAINT fk_kegiatan_indikator_kategori
     FOREIGN KEY (kategori_id) REFERENCES kinerja_kategori_aktivitas (id)
     ON DELETE SET NULL ON UPDATE CASCADE`
  );
  await ensureForeignKeyExists(
    "kegiatan_indikator_kinerja",
    "fk_kegiatan_indikator_satuan",
    `ALTER TABLE kegiatan_indikator_kinerja
     ADD CONSTRAINT fk_kegiatan_indikator_satuan
     FOREIGN KEY (satuan_id) REFERENCES kinerja_satuan (id)
     ON DELETE SET NULL ON UPDATE CASCADE`
  );

  referenceMasterSchemaReady = true;
};

const parsePositiveCount = (value: unknown) => {
  const totalValue = Number(value);

  if (!Number.isFinite(totalValue) || totalValue < 1) {
    fail("Jumlah jabatan minimal 1", 400);
  }

  return Math.floor(totalValue);
};

const ensureIndicatorExists = async (indicatorId: number) => {
  await ensureReferenceMasterSchema();

  const [rows] = await pool.query<any[]>(
    `SELECT id, nama AS name
     FROM indikator_kinerja
     WHERE id = ?
     LIMIT 1`,
    [indicatorId]
  );

  if (!rows.length) {
    fail("Indikator kinerja tidak ditemukan", 404);
  }

  return {
    id: Number(rows[0].id),
    name: String(rows[0].name || "")
  };
};

const ensureTeamExists = async (teamId: number) => {
  const [rows] = await pool.query<any[]>(
    `SELECT id, nama_tim AS teamName
     FROM kinerja_tim_kerja
     WHERE id = ?
     LIMIT 1`,
    [teamId]
  );

  if (!rows.length) {
    fail("Tim kerja tidak ditemukan", 404);
  }

  return {
    id: Number(rows[0].id),
    name: String(rows[0].teamName || "")
  };
};

export const getDepartments = asyncHandler(async (_req, res) => {
  return sendSuccess(res, []);
});

export const getCriteria = asyncHandler(async (_req, res) => {
  const [rows] = await pool.query<any[]>(
    `SELECT id, kode, nama AS name, bobot
     FROM kriteria_penilaian
     ORDER BY id ASC`
  );

  return sendSuccess(res, rows);
});

export const getPeriods = asyncHandler(async (_req, res) => {
  const [rows] = await pool.query<any[]>(
    `SELECT id, nama AS name,
            DATE_FORMAT(tanggal_mulai, '%Y-%m-%d') AS startDate,
            DATE_FORMAT(tanggal_selesai, '%Y-%m-%d') AS endDate,
            status
     FROM periode_evaluasi
     ORDER BY tanggal_mulai DESC`
  );

  return sendSuccess(res, rows);
});

export const getPositions = asyncHandler(async (_req, res) => {
  const [rows] = await pool.query<any[]>(
    `SELECT id,
            nama AS name,
            jumlah_formasi AS totalPositions,
            DATE_FORMAT(dibuat_pada, '%Y-%m-%d %H:%i:%s') AS createdAt
     FROM jabatan
     ORDER BY nama ASC`
  );

  return sendSuccess(res, rows);
});

export const createPosition = asyncHandler(async (req, res) => {
  const name = ensureRequired(readTrimmedString(req.body?.name), "Nama jabatan wajib diisi");
  const totalPositions = parsePositiveCount(req.body?.totalPositions);

  try {
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO jabatan (nama, jumlah_formasi)
       VALUES (?, ?)`,
      [name, totalPositions]
    );

    return sendSuccess(
      res,
      {
        id: result.insertId,
        name,
        totalPositions
      },
      "Data jabatan berhasil ditambahkan",
      201
    );
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") {
      fail("Nama jabatan sudah digunakan", 409);
    }

    throw error;
  }
});

export const updatePosition = asyncHandler(async (req, res) => {
  const id = readPositiveId(req.params.id, "ID jabatan");
  const name = ensureRequired(readTrimmedString(req.body?.name), "Nama jabatan wajib diisi");
  const totalPositions = parsePositiveCount(req.body?.totalPositions);

  try {
    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE jabatan
       SET nama = ?, jumlah_formasi = ?
       WHERE id = ?`,
      [name, totalPositions, id]
    );

    if (result.affectedRows === 0) {
      fail("Data jabatan tidak ditemukan", 404);
    }

    return sendSuccess(res, null, "Data jabatan berhasil diperbarui");
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") {
      fail("Nama jabatan sudah digunakan", 409);
    }

    throw error;
  }
});

export const deletePosition = asyncHandler(async (req, res) => {
  const id = readPositiveId(req.params.id, "ID jabatan");
  const [result] = await pool.query<ResultSetHeader>("DELETE FROM jabatan WHERE id = ?", [id]);

  if (result.affectedRows === 0) {
    fail("Data jabatan tidak ditemukan", 404);
  }

  return sendSuccess(res, null, "Data jabatan berhasil dihapus");
});

export const getPerformanceIndicators = asyncHandler(async (_req, res) => {
  await ensureReferenceMasterSchema();

  const [rows] = await pool.query<any[]>(
    `SELECT i.id,
            i.tim_kerja_id AS teamId,
            COALESCE(tk.nama_tim, '') AS teamName,
            i.nama AS name,
            DATE_FORMAT(i.dibuat_pada, '%Y-%m-%d %H:%i:%s') AS createdAt
     FROM indikator_kinerja i
     LEFT JOIN kinerja_tim_kerja tk ON tk.id = i.tim_kerja_id
     ORDER BY COALESCE(tk.nama_tim, '') ASC, i.nama ASC`
  );

  return sendSuccess(res, rows);
});

export const createPerformanceIndicator = asyncHandler(async (req, res) => {
  await ensureReferenceMasterSchema();

  const teamId = readPositiveId(req.body?.teamId, "Tim kerja");
  const name = ensureRequired(
    readTrimmedString(req.body?.name),
    "Nama indikator kinerja wajib diisi"
  );
  const team = await ensureTeamExists(teamId);

  try {
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO indikator_kinerja (tim_kerja_id, nama)
       VALUES (?, ?)`,
      [teamId, name]
    );

    return sendSuccess(
      res,
      {
        id: result.insertId,
        teamId,
        teamName: team.name,
        name
      },
      "Indikator kinerja berhasil ditambahkan",
      201
    );
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") {
      fail("Nama indikator kinerja pada tim kerja tersebut sudah digunakan", 409);
    }

    throw error;
  }
});

export const updatePerformanceIndicator = asyncHandler(async (req, res) => {
  await ensureReferenceMasterSchema();

  const id = readPositiveId(req.params.id, "ID indikator kinerja");
  const teamId = readPositiveId(req.body?.teamId, "Tim kerja");
  const name = ensureRequired(
    readTrimmedString(req.body?.name),
    "Nama indikator kinerja wajib diisi"
  );
  await ensureTeamExists(teamId);

  try {
    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE indikator_kinerja
       SET tim_kerja_id = ?, nama = ?
       WHERE id = ?`,
      [teamId, name, id]
    );

    if (result.affectedRows === 0) {
      fail("Data indikator kinerja tidak ditemukan", 404);
    }

    return sendSuccess(res, null, "Indikator kinerja berhasil diperbarui");
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") {
      fail("Nama indikator kinerja pada tim kerja tersebut sudah digunakan", 409);
    }

    throw error;
  }
});

export const deletePerformanceIndicator = asyncHandler(async (req, res) => {
  await ensureReferenceMasterSchema();

  const id = readPositiveId(req.params.id, "ID indikator kinerja");
  const [activityRows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total
     FROM kegiatan_indikator_kinerja
     WHERE indikator_kinerja_id = ?`,
    [id]
  );

  if (Number(activityRows[0]?.total || 0) > 0) {
    fail(
      "Indikator kinerja tidak dapat dihapus karena masih memiliki kegiatan terkait",
      409
    );
  }

  const [result] = await pool.query<ResultSetHeader>(
    "DELETE FROM indikator_kinerja WHERE id = ?",
    [id]
  );

  if (result.affectedRows === 0) {
    fail("Data indikator kinerja tidak ditemukan", 404);
  }

  return sendSuccess(res, null, "Indikator kinerja berhasil dihapus");
});

export const getPerformanceActivities = asyncHandler(async (_req, res) => {
  await ensureReferenceMasterSchema();

  const [rows] = await pool.query<any[]>(
    `SELECT k.id,
            k.indikator_kinerja_id AS indicatorId,
            i.nama AS indicatorName,
            i.tim_kerja_id AS teamId,
            COALESCE(tk.nama_tim, '') AS teamName,
            k.nama AS name,
            k.kategori AS category,
            DATE_FORMAT(k.tanggal_mulai, '%Y-%m-%d') AS startDate,
            DATE_FORMAT(k.tanggal_selesai, '%Y-%m-%d') AS endDate,
            k.target AS target,
            k.satuan AS unit,
            k.catatan AS note,
            DATE_FORMAT(k.dibuat_pada, '%Y-%m-%d %H:%i:%s') AS createdAt
     FROM kegiatan_indikator_kinerja k
     INNER JOIN indikator_kinerja i ON i.id = k.indikator_kinerja_id
     LEFT JOIN kinerja_tim_kerja tk ON tk.id = i.tim_kerja_id
     ORDER BY COALESCE(tk.nama_tim, '') ASC, i.nama ASC, k.nama ASC`
  );

  return sendSuccess(res, rows);
});

export const createPerformanceActivity = asyncHandler(async (req, res) => {
  await ensureReferenceMasterSchema();

  const indicatorId = readPositiveId(req.body?.indicatorId, "Indikator kinerja");
  const name = ensureRequired(readTrimmedString(req.body?.name), "Nama kegiatan wajib diisi");
  const category = readPerformanceActivityCategory(req.body?.category);
  const startDate = readDateString(req.body?.startDate, "Tanggal mulai");
  const endDate = readDateString(req.body?.endDate, "Tanggal selesai");
  const target = ensureRequired(readTrimmedString(req.body?.target), "Target wajib diisi");
  const unit = ensureRequired(readTrimmedString(req.body?.unit), "Satuan wajib diisi");
  const note = readTrimmedString(req.body?.note);
  const indicator = await ensureIndicatorExists(indicatorId);

  ensureValidActivityDateRange(startDate, endDate);

  const [indicatorRows] = await pool.query<any[]>(
    `SELECT i.tim_kerja_id AS teamId,
            COALESCE(tk.nama_tim, '') AS teamName
     FROM indikator_kinerja i
     LEFT JOIN kinerja_tim_kerja tk ON tk.id = i.tim_kerja_id
     WHERE i.id = ?
     LIMIT 1`,
    [indicatorId]
  );

  try {
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO kegiatan_indikator_kinerja (
         indikator_kinerja_id,
         nama,
         kategori,
         tanggal_mulai,
         tanggal_selesai,
         target,
         satuan,
         catatan
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [indicatorId, name, category, startDate, endDate, target, unit, note || null]
    );

    return sendSuccess(
      res,
      {
        id: result.insertId,
        indicatorId,
        indicatorName: indicator.name,
        teamId: indicatorRows[0]?.teamId ? Number(indicatorRows[0].teamId) : null,
        teamName: String(indicatorRows[0]?.teamName || ""),
        name,
        category,
        startDate,
        endDate,
        target,
        unit,
        note
      },
      "Kegiatan berhasil ditambahkan",
      201
    );
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") {
      fail("Nama kegiatan pada indikator kinerja tersebut sudah digunakan", 409);
    }

    throw error;
  }
});

export const updatePerformanceActivity = asyncHandler(async (req, res) => {
  await ensureReferenceMasterSchema();

  const id = readPositiveId(req.params.id, "ID kegiatan");
  const indicatorId = readPositiveId(req.body?.indicatorId, "Indikator kinerja");
  const name = ensureRequired(readTrimmedString(req.body?.name), "Nama kegiatan wajib diisi");
  const category = readPerformanceActivityCategory(req.body?.category);
  const startDate = readDateString(req.body?.startDate, "Tanggal mulai");
  const endDate = readDateString(req.body?.endDate, "Tanggal selesai");
  const target = ensureRequired(readTrimmedString(req.body?.target), "Target wajib diisi");
  const unit = ensureRequired(readTrimmedString(req.body?.unit), "Satuan wajib diisi");
  const note = readTrimmedString(req.body?.note);
  await ensureIndicatorExists(indicatorId);

  ensureValidActivityDateRange(startDate, endDate);

  try {
    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE kegiatan_indikator_kinerja
       SET indikator_kinerja_id = ?,
           nama = ?,
           kategori = ?,
           tanggal_mulai = ?,
           tanggal_selesai = ?,
           target = ?,
           satuan = ?,
           catatan = ?
       WHERE id = ?`,
      [indicatorId, name, category, startDate, endDate, target, unit, note || null, id]
    );

    if (result.affectedRows === 0) {
      fail("Data kegiatan tidak ditemukan", 404);
    }

    return sendSuccess(res, null, "Kegiatan berhasil diperbarui");
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") {
      fail("Nama kegiatan pada indikator kinerja tersebut sudah digunakan", 409);
    }

    throw error;
  }
});

export const deletePerformanceActivity = asyncHandler(async (req, res) => {
  await ensureReferenceMasterSchema();

  const id = readPositiveId(req.params.id, "ID kegiatan");
  const [result] = await pool.query<ResultSetHeader>(
    "DELETE FROM kegiatan_indikator_kinerja WHERE id = ?",
    [id]
  );

  if (result.affectedRows === 0) {
    fail("Data kegiatan tidak ditemukan", 404);
  }

  return sendSuccess(res, null, "Kegiatan berhasil dihapus");
});



export const getKinerjaPeriods = asyncHandler(async (_req, res) => {
  await ensureReferenceMasterSchema();

  const [rows] = await pool.query<any[]>(
    `SELECT id,
            tahun,
            nama_periode AS namaPeriode,
            jenis_periode AS jenisPeriode,
            DATE_FORMAT(tanggal_mulai, '%Y-%m-%d') AS tanggalMulai,
            DATE_FORMAT(tanggal_selesai, '%Y-%m-%d') AS tanggalSelesai,
            status
     FROM kinerja_periode
     ORDER BY tahun DESC, tanggal_mulai DESC, nama_periode ASC`
  );

  return sendSuccess(res, rows);
});

export const createKinerjaPeriod = asyncHandler(async (req, res) => {
  await ensureReferenceMasterSchema();

  const year = Number(req.body?.tahun);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    fail("Tahun periode tidak valid", 400);
  }

  const namaPeriode = ensureRequired(
    readTrimmedString(req.body?.namaPeriode),
    "Nama periode wajib diisi"
  );
  const jenisPeriode = readKinerjaPeriodType(req.body?.jenisPeriode);
  const tanggalMulai = readDateString(req.body?.tanggalMulai, "Tanggal mulai");
  const tanggalSelesai = readDateString(req.body?.tanggalSelesai, "Tanggal selesai");
  const status = readKinerjaPeriodStatus(req.body?.status, "draft");

  ensureValidPeriodDateRange(tanggalMulai, tanggalSelesai);

  try {
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO kinerja_periode (
         tahun, nama_periode, jenis_periode, tanggal_mulai, tanggal_selesai, status
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [year, namaPeriode, jenisPeriode, tanggalMulai, tanggalSelesai, status]
    );

    return sendSuccess(
      res,
      {
        id: result.insertId,
        tahun: year,
        namaPeriode,
        jenisPeriode,
        tanggalMulai,
        tanggalSelesai,
        status
      },
      "Periode kinerja berhasil ditambahkan",
      201
    );
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") {
      fail("Nama periode pada tahun tersebut sudah digunakan", 409);
    }
    throw error;
  }
});

export const updateKinerjaPeriod = asyncHandler(async (req, res) => {
  await ensureReferenceMasterSchema();

  const id = readPositiveId(req.params.id, "ID periode kinerja");
  const year = Number(req.body?.tahun);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    fail("Tahun periode tidak valid", 400);
  }

  const namaPeriode = ensureRequired(
    readTrimmedString(req.body?.namaPeriode),
    "Nama periode wajib diisi"
  );
  const jenisPeriode = readKinerjaPeriodType(req.body?.jenisPeriode);
  const tanggalMulai = readDateString(req.body?.tanggalMulai, "Tanggal mulai");
  const tanggalSelesai = readDateString(req.body?.tanggalSelesai, "Tanggal selesai");
  const status = readKinerjaPeriodStatus(req.body?.status, "draft");

  ensureValidPeriodDateRange(tanggalMulai, tanggalSelesai);

  try {
    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE kinerja_periode
       SET tahun = ?,
           nama_periode = ?,
           jenis_periode = ?,
           tanggal_mulai = ?,
           tanggal_selesai = ?,
           status = ?
       WHERE id = ?`,
      [year, namaPeriode, jenisPeriode, tanggalMulai, tanggalSelesai, status, id]
    );

    if (result.affectedRows === 0) {
      fail("Data periode kinerja tidak ditemukan", 404);
    }

    return sendSuccess(res, null, "Periode kinerja berhasil diperbarui");
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") {
      fail("Nama periode pada tahun tersebut sudah digunakan", 409);
    }
    throw error;
  }
});

export const deleteKinerjaPeriod = asyncHandler(async (req, res) => {
  await ensureReferenceMasterSchema();

  const id = readPositiveId(req.params.id, "ID periode kinerja");
  const [referenceRows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total
     FROM indikator_kinerja
     WHERE periode_id = ?`,
    [id]
  );

  if (Number(referenceRows[0]?.total || 0) > 0) {
    fail("Periode kinerja tidak dapat dihapus karena sudah dipakai indikator kinerja", 409);
  }

  const [result] = await pool.query<ResultSetHeader>(
    "DELETE FROM kinerja_periode WHERE id = ?",
    [id]
  );

  if (result.affectedRows === 0) {
    fail("Data periode kinerja tidak ditemukan", 404);
  }

  return sendSuccess(res, null, "Periode kinerja berhasil dihapus");
});

export const getKinerjaUnits = asyncHandler(async (_req, res) => {
  await ensureReferenceMasterSchema();

  const [rows] = await pool.query<any[]>(
    `SELECT id,
            nama_satuan AS namaSatuan,
            keterangan,
            status
     FROM kinerja_satuan
     ORDER BY nama_satuan ASC`
  );

  return sendSuccess(res, rows);
});

export const createKinerjaUnit = asyncHandler(async (req, res) => {
  await ensureReferenceMasterSchema();

  const namaSatuan = ensureRequired(
    readTrimmedString(req.body?.namaSatuan),
    "Nama satuan wajib diisi"
  );
  const keterangan = readTrimmedString(req.body?.keterangan);
  const status = readReferenceArchiveStatus(req.body?.status, "aktif");

  try {
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO kinerja_satuan (nama_satuan, keterangan, status)
       VALUES (?, ?, ?)`,
      [namaSatuan, keterangan || null, status]
    );

    return sendSuccess(
      res,
      {
        id: result.insertId,
        namaSatuan,
        keterangan,
        status
      },
      "Satuan berhasil ditambahkan",
      201
    );
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") {
      fail("Nama satuan sudah digunakan", 409);
    }
    throw error;
  }
});

export const updateKinerjaUnit = asyncHandler(async (req, res) => {
  await ensureReferenceMasterSchema();

  const id = readPositiveId(req.params.id, "ID satuan");
  const namaSatuan = ensureRequired(
    readTrimmedString(req.body?.namaSatuan),
    "Nama satuan wajib diisi"
  );
  const keterangan = readTrimmedString(req.body?.keterangan);
  const status = readReferenceArchiveStatus(req.body?.status, "aktif");

  try {
    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE kinerja_satuan
       SET nama_satuan = ?, keterangan = ?, status = ?
       WHERE id = ?`,
      [namaSatuan, keterangan || null, status, id]
    );

    if (result.affectedRows === 0) {
      fail("Data satuan tidak ditemukan", 404);
    }

    return sendSuccess(res, null, "Satuan berhasil diperbarui");
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") {
      fail("Nama satuan sudah digunakan", 409);
    }
    throw error;
  }
});

export const deleteKinerjaUnit = asyncHandler(async (req, res) => {
  await ensureReferenceMasterSchema();

  const id = readPositiveId(req.params.id, "ID satuan");
  const [indicatorRows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total
     FROM indikator_kinerja
     WHERE satuan_id = ?`,
    [id]
  );
  const [activityRows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total
     FROM kegiatan_indikator_kinerja
     WHERE satuan_id = ?`,
    [id]
  );

  if (Number(indicatorRows[0]?.total || 0) > 0 || Number(activityRows[0]?.total || 0) > 0) {
    fail("Satuan tidak dapat dihapus karena masih dipakai data kinerja", 409);
  }

  const [result] = await pool.query<ResultSetHeader>(
    "DELETE FROM kinerja_satuan WHERE id = ?",
    [id]
  );

  if (result.affectedRows === 0) {
    fail("Data satuan tidak ditemukan", 404);
  }

  return sendSuccess(res, null, "Satuan berhasil dihapus");
});

export const getActivityCategories = asyncHandler(async (_req, res) => {
  await ensureReferenceMasterSchema();

  const [rows] = await pool.query<any[]>(
    `SELECT id,
            kode,
            nama_kategori AS namaKategori,
            urutan,
            status
     FROM kinerja_kategori_aktivitas
     ORDER BY urutan ASC, nama_kategori ASC`
  );

  return sendSuccess(res, rows);
});

export const createActivityCategory = asyncHandler(async (req, res) => {
  await ensureReferenceMasterSchema();

  const kode = ensureRequired(readTrimmedString(req.body?.kode).toLowerCase(), "Kode kategori wajib diisi");
  const namaKategori = ensureRequired(
    readTrimmedString(req.body?.namaKategori),
    "Nama kategori aktivitas wajib diisi"
  );
  const urutanValue = req.body?.urutan;
  const urutan = urutanValue === undefined || urutanValue === null || urutanValue === "" ? 0 : Number(urutanValue);
  if (!Number.isInteger(urutan) || urutan < 0) {
    fail("Urutan kategori tidak valid", 400);
  }
  const status = readReferenceArchiveStatus(req.body?.status, "aktif");

  try {
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO kinerja_kategori_aktivitas (kode, nama_kategori, urutan, status)
       VALUES (?, ?, ?, ?)`,
      [kode, namaKategori, urutan, status]
    );

    return sendSuccess(
      res,
      {
        id: result.insertId,
        kode,
        namaKategori,
        urutan,
        status
      },
      "Kategori aktivitas berhasil ditambahkan",
      201
    );
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") {
      fail("Kode atau nama kategori aktivitas sudah digunakan", 409);
    }
    throw error;
  }
});

export const updateActivityCategory = asyncHandler(async (req, res) => {
  await ensureReferenceMasterSchema();

  const id = readPositiveId(req.params.id, "ID kategori aktivitas");
  const kode = ensureRequired(readTrimmedString(req.body?.kode).toLowerCase(), "Kode kategori wajib diisi");
  const namaKategori = ensureRequired(
    readTrimmedString(req.body?.namaKategori),
    "Nama kategori aktivitas wajib diisi"
  );
  const urutanValue = req.body?.urutan;
  const urutan = urutanValue === undefined || urutanValue === null || urutanValue === "" ? 0 : Number(urutanValue);
  if (!Number.isInteger(urutan) || urutan < 0) {
    fail("Urutan kategori tidak valid", 400);
  }
  const status = readReferenceArchiveStatus(req.body?.status, "aktif");

  try {
    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE kinerja_kategori_aktivitas
       SET kode = ?, nama_kategori = ?, urutan = ?, status = ?
       WHERE id = ?`,
      [kode, namaKategori, urutan, status, id]
    );

    if (result.affectedRows === 0) {
      fail("Data kategori aktivitas tidak ditemukan", 404);
    }

    return sendSuccess(res, null, "Kategori aktivitas berhasil diperbarui");
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") {
      fail("Kode atau nama kategori aktivitas sudah digunakan", 409);
    }
    throw error;
  }
});

export const deleteActivityCategory = asyncHandler(async (req, res) => {
  await ensureReferenceMasterSchema();

  const id = readPositiveId(req.params.id, "ID kategori aktivitas");
  const [activityRows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total
     FROM kegiatan_indikator_kinerja
     WHERE kategori_id = ?`,
    [id]
  );

  if (Number(activityRows[0]?.total || 0) > 0) {
    fail("Kategori aktivitas tidak dapat dihapus karena masih dipakai kegiatan", 409);
  }

  const [result] = await pool.query<ResultSetHeader>(
    "DELETE FROM kinerja_kategori_aktivitas WHERE id = ?",
    [id]
  );

  if (result.affectedRows === 0) {
    fail("Data kategori aktivitas tidak ditemukan", 404);
  }

  return sendSuccess(res, null, "Kategori aktivitas berhasil dihapus");
});
