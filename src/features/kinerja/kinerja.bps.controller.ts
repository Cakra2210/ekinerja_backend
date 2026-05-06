import { ResultSetHeader } from "mysql2/promise";
import { pool } from "../../config/database";
import { AuthenticatedRequest } from "../../middleware/auth.middleware";
import { asyncHandler, fail, sendSuccess } from "../../shared/http";
import { ensureOneOf, ensureRequired, readDateString, readIntegerInRange, readNonNegativeNumber, readPositiveId, readTrimmedString } from "../../shared/validation";

let bpsSchemaReady = false;

const PST_STATUSES = ["draft", "selesai", "ditutup"] as const;
const PUBLICATION_TYPES = ["publikasi", "brs", "infografis"] as const;
const PUBLICATION_STATUSES = ["draft", "proses", "terbit", "arsip"] as const;
const COACHING_STATUSES = ["draft", "selesai", "tindak_lanjut"] as const;
const MONITORING_STATUSES = ["aktif", "selesai", "arsip"] as const;

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

const ensureIndexExists = async (tableName: string, indexName: string, createSql: string) => {
  const [rows] = await pool.query<any[]>(
    `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [tableName, indexName]
  );
  if (!rows.length) await pool.query(createSql);
};

const ensureForeignKeyExists = async (tableName: string, constraintName: string, createSql: string) => {
  const [rows] = await pool.query<any[]>(
    `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? LIMIT 1`,
    [tableName, constraintName]
  );
  if (!rows.length) await pool.query(createSql);
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

const ensureActivityExists = async (activityId: number) => {
  const [rows] = await pool.query<any[]>(`SELECT id FROM kegiatan_indikator_kinerja WHERE id = ? LIMIT 1`, [activityId]);
  if (!rows.length) fail("Kegiatan tidak ditemukan", 404);
};

const ensurePstExists = async (id: number) => {
  const [rows] = await pool.query<any[]>(`SELECT id FROM kinerja_layanan_pst WHERE id = ? LIMIT 1`, [id]);
  if (!rows.length) fail("Layanan PST tidak ditemukan", 404);
};

const ensurePublicationExists = async (id: number) => {
  const [rows] = await pool.query<any[]>(`SELECT id FROM kinerja_publikasi_brs WHERE id = ? LIMIT 1`, [id]);
  if (!rows.length) fail("Publikasi atau BRS tidak ditemukan", 404);
};

const ensureCoachingExists = async (id: number) => {
  const [rows] = await pool.query<any[]>(`SELECT id FROM kinerja_pembinaan_sektoral WHERE id = ? LIMIT 1`, [id]);
  if (!rows.length) fail("Pembinaan statistik sektoral tidak ditemukan", 404);
};

const ensureFieldMonitoringExists = async (id: number) => {
  const [rows] = await pool.query<any[]>(`SELECT id FROM kinerja_monitoring_pendataan WHERE id = ? LIMIT 1`, [id]);
  if (!rows.length) fail("Monitoring pendataan tidak ditemukan", 404);
};

const ensureProcessingMonitoringExists = async (id: number) => {
  const [rows] = await pool.query<any[]>(`SELECT id FROM kinerja_monitoring_pengolahan WHERE id = ? LIMIT 1`, [id]);
  if (!rows.length) fail("Monitoring pengolahan tidak ditemukan", 404);
};

const ensureBpsSchema = async () => {
  if (bpsSchemaReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_layanan_pst (
      id INT NOT NULL AUTO_INCREMENT,
      periode_id INT NULL,
      tanggal_layanan DATE NOT NULL,
      pegawai_id INT NULL,
      jenis_layanan VARCHAR(120) NOT NULL,
      nama_pengguna VARCHAR(150) NOT NULL,
      instansi VARCHAR(150) NULL,
      topik_data VARCHAR(255) NULL,
      kanal_layanan VARCHAR(100) NULL,
      durasi_menit INT NULL,
      status_selesai ENUM('draft','selesai','ditutup') NOT NULL DEFAULT 'draft',
      catatan TEXT NULL,
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureIndexExists('kinerja_layanan_pst', 'idx_kinerja_pst_periode', 'ALTER TABLE kinerja_layanan_pst ADD INDEX idx_kinerja_pst_periode (periode_id)');
  await ensureIndexExists('kinerja_layanan_pst', 'idx_kinerja_pst_pegawai', 'ALTER TABLE kinerja_layanan_pst ADD INDEX idx_kinerja_pst_pegawai (pegawai_id)');
  await ensureForeignKeyExists('kinerja_layanan_pst', 'fk_kinerja_pst_periode', 'ALTER TABLE kinerja_layanan_pst ADD CONSTRAINT fk_kinerja_pst_periode FOREIGN KEY (periode_id) REFERENCES kinerja_periode (id) ON DELETE SET NULL ON UPDATE CASCADE');
  await ensureForeignKeyExists('kinerja_layanan_pst', 'fk_kinerja_pst_pegawai', 'ALTER TABLE kinerja_layanan_pst ADD CONSTRAINT fk_kinerja_pst_pegawai FOREIGN KEY (pegawai_id) REFERENCES pegawai (id) ON DELETE SET NULL ON UPDATE CASCADE');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_publikasi_brs (
      id INT NOT NULL AUTO_INCREMENT,
      periode_id INT NULL,
      jenis_output ENUM('publikasi','brs','infografis') NOT NULL DEFAULT 'publikasi',
      nama_output VARCHAR(255) NOT NULL,
      tanggal_target DATE NULL,
      tanggal_terbit DATE NULL,
      tim_kerja_id INT NULL,
      ketua_tim_id INT NULL,
      status ENUM('draft','proses','terbit','arsip') NOT NULL DEFAULT 'draft',
      tautan_file VARCHAR(255) NULL,
      catatan TEXT NULL,
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureIndexExists('kinerja_publikasi_brs', 'idx_kinerja_publikasi_periode', 'ALTER TABLE kinerja_publikasi_brs ADD INDEX idx_kinerja_publikasi_periode (periode_id)');
  await ensureIndexExists('kinerja_publikasi_brs', 'idx_kinerja_publikasi_tim', 'ALTER TABLE kinerja_publikasi_brs ADD INDEX idx_kinerja_publikasi_tim (tim_kerja_id)');
  await ensureIndexExists('kinerja_publikasi_brs', 'idx_kinerja_publikasi_ketua', 'ALTER TABLE kinerja_publikasi_brs ADD INDEX idx_kinerja_publikasi_ketua (ketua_tim_id)');
  await ensureForeignKeyExists('kinerja_publikasi_brs', 'fk_kinerja_publikasi_periode', 'ALTER TABLE kinerja_publikasi_brs ADD CONSTRAINT fk_kinerja_publikasi_periode FOREIGN KEY (periode_id) REFERENCES kinerja_periode (id) ON DELETE SET NULL ON UPDATE CASCADE');
  await ensureForeignKeyExists('kinerja_publikasi_brs', 'fk_kinerja_publikasi_tim', 'ALTER TABLE kinerja_publikasi_brs ADD CONSTRAINT fk_kinerja_publikasi_tim FOREIGN KEY (tim_kerja_id) REFERENCES kinerja_tim_kerja (id) ON DELETE SET NULL ON UPDATE CASCADE');
  await ensureForeignKeyExists('kinerja_publikasi_brs', 'fk_kinerja_publikasi_ketua', 'ALTER TABLE kinerja_publikasi_brs ADD CONSTRAINT fk_kinerja_publikasi_ketua FOREIGN KEY (ketua_tim_id) REFERENCES pegawai (id) ON DELETE SET NULL ON UPDATE CASCADE');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_pembinaan_sektoral (
      id INT NOT NULL AUTO_INCREMENT,
      periode_id INT NULL,
      tanggal_kegiatan DATE NOT NULL,
      opd_binaan VARCHAR(200) NOT NULL,
      jenis_pembinaan VARCHAR(150) NOT NULL,
      materi TEXT NULL,
      output TEXT NULL,
      pegawai_id INT NULL,
      tindak_lanjut TEXT NULL,
      status ENUM('draft','selesai','tindak_lanjut') NOT NULL DEFAULT 'draft',
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureIndexExists('kinerja_pembinaan_sektoral', 'idx_kinerja_pembinaan_periode', 'ALTER TABLE kinerja_pembinaan_sektoral ADD INDEX idx_kinerja_pembinaan_periode (periode_id)');
  await ensureIndexExists('kinerja_pembinaan_sektoral', 'idx_kinerja_pembinaan_pegawai', 'ALTER TABLE kinerja_pembinaan_sektoral ADD INDEX idx_kinerja_pembinaan_pegawai (pegawai_id)');
  await ensureForeignKeyExists('kinerja_pembinaan_sektoral', 'fk_kinerja_pembinaan_periode', 'ALTER TABLE kinerja_pembinaan_sektoral ADD CONSTRAINT fk_kinerja_pembinaan_periode FOREIGN KEY (periode_id) REFERENCES kinerja_periode (id) ON DELETE SET NULL ON UPDATE CASCADE');
  await ensureForeignKeyExists('kinerja_pembinaan_sektoral', 'fk_kinerja_pembinaan_pegawai', 'ALTER TABLE kinerja_pembinaan_sektoral ADD CONSTRAINT fk_kinerja_pembinaan_pegawai FOREIGN KEY (pegawai_id) REFERENCES pegawai (id) ON DELETE SET NULL ON UPDATE CASCADE');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_monitoring_pendataan (
      id INT NOT NULL AUTO_INCREMENT,
      periode_id INT NULL,
      kegiatan_id INT NULL,
      wilayah VARCHAR(200) NOT NULL,
      jumlah_target DECIMAL(18,2) NULL,
      jumlah_selesai DECIMAL(18,2) NULL,
      jumlah_error DECIMAL(18,2) NULL,
      jumlah_revisit DECIMAL(18,2) NULL,
      catatan TEXT NULL,
      tanggal_update DATE NOT NULL,
      status ENUM('aktif','selesai','arsip') NOT NULL DEFAULT 'aktif',
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureIndexExists('kinerja_monitoring_pendataan', 'idx_kinerja_monitoring_pendataan_periode', 'ALTER TABLE kinerja_monitoring_pendataan ADD INDEX idx_kinerja_monitoring_pendataan_periode (periode_id)');
  await ensureIndexExists('kinerja_monitoring_pendataan', 'idx_kinerja_monitoring_pendataan_kegiatan', 'ALTER TABLE kinerja_monitoring_pendataan ADD INDEX idx_kinerja_monitoring_pendataan_kegiatan (kegiatan_id)');
  await ensureForeignKeyExists('kinerja_monitoring_pendataan', 'fk_kinerja_monitoring_pendataan_periode', 'ALTER TABLE kinerja_monitoring_pendataan ADD CONSTRAINT fk_kinerja_monitoring_pendataan_periode FOREIGN KEY (periode_id) REFERENCES kinerja_periode (id) ON DELETE SET NULL ON UPDATE CASCADE');
  await ensureForeignKeyExists('kinerja_monitoring_pendataan', 'fk_kinerja_monitoring_pendataan_kegiatan', 'ALTER TABLE kinerja_monitoring_pendataan ADD CONSTRAINT fk_kinerja_monitoring_pendataan_kegiatan FOREIGN KEY (kegiatan_id) REFERENCES kegiatan_indikator_kinerja (id) ON DELETE SET NULL ON UPDATE CASCADE');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_monitoring_pengolahan (
      id INT NOT NULL AUTO_INCREMENT,
      periode_id INT NULL,
      kegiatan_id INT NULL,
      dokumen_masuk DECIMAL(18,2) NULL,
      dokumen_selesai DECIMAL(18,2) NULL,
      backlog DECIMAL(18,2) NULL,
      status_editing VARCHAR(120) NULL,
      status_coding VARCHAR(120) NULL,
      status_cleaning VARCHAR(120) NULL,
      tanggal_update DATE NOT NULL,
      catatan TEXT NULL,
      status ENUM('aktif','selesai','arsip') NOT NULL DEFAULT 'aktif',
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureIndexExists('kinerja_monitoring_pengolahan', 'idx_kinerja_monitoring_pengolahan_periode', 'ALTER TABLE kinerja_monitoring_pengolahan ADD INDEX idx_kinerja_monitoring_pengolahan_periode (periode_id)');
  await ensureIndexExists('kinerja_monitoring_pengolahan', 'idx_kinerja_monitoring_pengolahan_kegiatan', 'ALTER TABLE kinerja_monitoring_pengolahan ADD INDEX idx_kinerja_monitoring_pengolahan_kegiatan (kegiatan_id)');
  await ensureForeignKeyExists('kinerja_monitoring_pengolahan', 'fk_kinerja_monitoring_pengolahan_periode', 'ALTER TABLE kinerja_monitoring_pengolahan ADD CONSTRAINT fk_kinerja_monitoring_pengolahan_periode FOREIGN KEY (periode_id) REFERENCES kinerja_periode (id) ON DELETE SET NULL ON UPDATE CASCADE');
  await ensureForeignKeyExists('kinerja_monitoring_pengolahan', 'fk_kinerja_monitoring_pengolahan_kegiatan', 'ALTER TABLE kinerja_monitoring_pengolahan ADD CONSTRAINT fk_kinerja_monitoring_pengolahan_kegiatan FOREIGN KEY (kegiatan_id) REFERENCES kegiatan_indikator_kinerja (id) ON DELETE SET NULL ON UPDATE CASCADE');

  bpsSchemaReady = true;
};

const readPstPayload = async (body: any) => {
  const periodeId = readOptionalPositiveId(body.periodeId, 'Periode kinerja');
  const pegawaiId = readOptionalPositiveId(body.pegawaiId, 'Pegawai');
  const tanggalLayanan = readDateString(body.tanggalLayanan, 'Tanggal layanan');
  const jenisLayanan = ensureRequired(readTrimmedString(body.jenisLayanan), 'Jenis layanan wajib diisi');
  const namaPengguna = ensureRequired(readTrimmedString(body.namaPengguna), 'Nama pengguna wajib diisi');
  const statusSelesai = ensureOneOf(readTrimmedString(body.statusSelesai) || 'draft', PST_STATUSES, 'Status layanan');
  const instansi = readTrimmedString(body.instansi);
  const topikData = readTrimmedString(body.topikData);
  const kanalLayanan = readTrimmedString(body.kanalLayanan);
  const durasiMenit = readOptionalNonNegativeNumber(body.durasiMenit, 'Durasi');
  const catatan = readTrimmedString(body.catatan);
  if (periodeId) await ensurePeriodExists(periodeId);
  if (pegawaiId) await ensureEmployeeExists(pegawaiId);
  return { periodeId, pegawaiId, tanggalLayanan, jenisLayanan, namaPengguna, instansi, topikData, kanalLayanan, durasiMenit, statusSelesai, catatan };
};

const readPublicationPayload = async (body: any) => {
  const periodeId = readOptionalPositiveId(body.periodeId, 'Periode kinerja');
  const timKerjaId = readOptionalPositiveId(body.timKerjaId, 'Tim kerja');
  const ketuaTimId = readOptionalPositiveId(body.ketuaTimId, 'Ketua tim');
  const jenisOutput = ensureOneOf(readTrimmedString(body.jenisOutput) || 'publikasi', PUBLICATION_TYPES, 'Jenis output');
  const namaOutput = ensureRequired(readTrimmedString(body.namaOutput), 'Nama output wajib diisi');
  const tanggalTarget = readOptionalDateString(body.tanggalTarget, 'Tanggal target');
  const tanggalTerbit = readOptionalDateString(body.tanggalTerbit, 'Tanggal terbit');
  const status = ensureOneOf(readTrimmedString(body.status) || 'draft', PUBLICATION_STATUSES, 'Status publikasi');
  const tautanFile = readTrimmedString(body.tautanFile);
  const catatan = readTrimmedString(body.catatan);
  if (periodeId) await ensurePeriodExists(periodeId);
  if (timKerjaId) await ensureTeamExists(timKerjaId);
  if (ketuaTimId) await ensureEmployeeExists(ketuaTimId);
  return { periodeId, timKerjaId, ketuaTimId, jenisOutput, namaOutput, tanggalTarget, tanggalTerbit, status, tautanFile, catatan };
};

const readCoachingPayload = async (body: any) => {
  const periodeId = readOptionalPositiveId(body.periodeId, 'Periode kinerja');
  const pegawaiId = readOptionalPositiveId(body.pegawaiId, 'Pegawai');
  const tanggalKegiatan = readDateString(body.tanggalKegiatan, 'Tanggal kegiatan');
  const opdBinaan = ensureRequired(readTrimmedString(body.opdBinaan), 'OPD binaan wajib diisi');
  const jenisPembinaan = ensureRequired(readTrimmedString(body.jenisPembinaan), 'Jenis pembinaan wajib diisi');
  const materi = readTrimmedString(body.materi);
  const output = readTrimmedString(body.output);
  const tindakLanjut = readTrimmedString(body.tindakLanjut);
  const status = ensureOneOf(readTrimmedString(body.status) || 'draft', COACHING_STATUSES, 'Status pembinaan');
  if (periodeId) await ensurePeriodExists(periodeId);
  if (pegawaiId) await ensureEmployeeExists(pegawaiId);
  return { periodeId, pegawaiId, tanggalKegiatan, opdBinaan, jenisPembinaan, materi, output, tindakLanjut, status };
};

const readFieldMonitoringPayload = async (body: any) => {
  const periodeId = readOptionalPositiveId(body.periodeId, 'Periode kinerja');
  const kegiatanId = readOptionalPositiveId(body.kegiatanId, 'Kegiatan');
  const wilayah = ensureRequired(readTrimmedString(body.wilayah), 'Wilayah wajib diisi');
  const jumlahTarget = readOptionalNonNegativeNumber(body.jumlahTarget, 'Jumlah target');
  const jumlahSelesai = readOptionalNonNegativeNumber(body.jumlahSelesai, 'Jumlah selesai');
  const jumlahError = readOptionalNonNegativeNumber(body.jumlahError, 'Jumlah error');
  const jumlahRevisit = readOptionalNonNegativeNumber(body.jumlahRevisit, 'Jumlah revisit');
  const tanggalUpdate = readDateString(body.tanggalUpdate, 'Tanggal update');
  const catatan = readTrimmedString(body.catatan);
  const status = ensureOneOf(readTrimmedString(body.status) || 'aktif', MONITORING_STATUSES, 'Status monitoring');
  if (periodeId) await ensurePeriodExists(periodeId);
  if (kegiatanId) await ensureActivityExists(kegiatanId);
  return { periodeId, kegiatanId, wilayah, jumlahTarget, jumlahSelesai, jumlahError, jumlahRevisit, tanggalUpdate, catatan, status };
};

const readProcessingMonitoringPayload = async (body: any) => {
  const periodeId = readOptionalPositiveId(body.periodeId, 'Periode kinerja');
  const kegiatanId = readOptionalPositiveId(body.kegiatanId, 'Kegiatan');
  const dokumenMasuk = readOptionalNonNegativeNumber(body.dokumenMasuk, 'Dokumen masuk');
  const dokumenSelesai = readOptionalNonNegativeNumber(body.dokumenSelesai, 'Dokumen selesai');
  const backlog = readOptionalNonNegativeNumber(body.backlog, 'Backlog');
  const statusEditing = readTrimmedString(body.statusEditing);
  const statusCoding = readTrimmedString(body.statusCoding);
  const statusCleaning = readTrimmedString(body.statusCleaning);
  const tanggalUpdate = readDateString(body.tanggalUpdate, 'Tanggal update');
  const catatan = readTrimmedString(body.catatan);
  const status = ensureOneOf(readTrimmedString(body.status) || 'aktif', MONITORING_STATUSES, 'Status monitoring');
  if (periodeId) await ensurePeriodExists(periodeId);
  if (kegiatanId) await ensureActivityExists(kegiatanId);
  return { periodeId, kegiatanId, dokumenMasuk, dokumenSelesai, backlog, statusEditing, statusCoding, statusCleaning, tanggalUpdate, catatan, status };
};

export const getKinerjaPstServices = asyncHandler(async (req, res) => {
  await ensureBpsSchema();
  const periodeId = readOptionalPositiveId(req.query.periodeId, 'Periode kinerja');
  const conditions: string[] = [];
  const params: any[] = [];
  if (periodeId) { conditions.push('pst.periode_id = ?'); params.push(periodeId); }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [rows] = await pool.query<any[]>(
    `SELECT pst.id, pst.periode_id AS periodeId, COALESCE(pr.nama_periode, '-') AS periodeName,
            pst.tanggal_layanan AS tanggalLayanan, pst.pegawai_id AS pegawaiId, COALESCE(pg.nama_lengkap, '-') AS pegawaiName,
            pst.jenis_layanan AS jenisLayanan, pst.nama_pengguna AS namaPengguna, COALESCE(pst.instansi, '') AS instansi,
            COALESCE(pst.topik_data, '') AS topikData, COALESCE(pst.kanal_layanan, '') AS kanalLayanan,
            pst.durasi_menit AS durasiMenit, pst.status_selesai AS statusSelesai, COALESCE(pst.catatan, '') AS catatan,
            pst.dibuat_pada AS createdAt, pst.diperbarui_pada AS updatedAt
     FROM kinerja_layanan_pst pst
     LEFT JOIN kinerja_periode pr ON pr.id = pst.periode_id
     LEFT JOIN pegawai pg ON pg.id = pst.pegawai_id
     ${whereClause}
     ORDER BY pst.tanggal_layanan DESC, pst.id DESC`,
    params
  );
  return sendSuccess(res, rows);
});

export const createKinerjaPstService = asyncHandler(async (req: AuthenticatedRequest, res) => {
  await ensureBpsSchema();
  const payload = await readPstPayload(req.body);
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO kinerja_layanan_pst
     (periode_id, tanggal_layanan, pegawai_id, jenis_layanan, nama_pengguna, instansi, topik_data, kanal_layanan, durasi_menit, status_selesai, catatan)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [payload.periodeId, payload.tanggalLayanan, payload.pegawaiId, payload.jenisLayanan, payload.namaPengguna, payload.instansi || null, payload.topikData || null, payload.kanalLayanan || null, payload.durasiMenit, payload.statusSelesai, payload.catatan || null]
  );
  return sendSuccess(res, { id: result.insertId }, 'Layanan PST berhasil ditambahkan', 201);
});

export const updateKinerjaPstService = asyncHandler(async (req, res) => {
  await ensureBpsSchema();
  const id = readPositiveId(req.params.id, 'ID layanan PST');
  await ensurePstExists(id);
  const payload = await readPstPayload(req.body);
  await pool.query(
    `UPDATE kinerja_layanan_pst
     SET periode_id = ?, tanggal_layanan = ?, pegawai_id = ?, jenis_layanan = ?, nama_pengguna = ?, instansi = ?, topik_data = ?, kanal_layanan = ?, durasi_menit = ?, status_selesai = ?, catatan = ?
     WHERE id = ?`,
    [payload.periodeId, payload.tanggalLayanan, payload.pegawaiId, payload.jenisLayanan, payload.namaPengguna, payload.instansi || null, payload.topikData || null, payload.kanalLayanan || null, payload.durasiMenit, payload.statusSelesai, payload.catatan || null, id]
  );
  return sendSuccess(res, null, 'Layanan PST berhasil diperbarui');
});

export const deleteKinerjaPstService = asyncHandler(async (req, res) => {
  await ensureBpsSchema();
  const id = readPositiveId(req.params.id, 'ID layanan PST');
  await ensurePstExists(id);
  await pool.query(`DELETE FROM kinerja_layanan_pst WHERE id = ?`, [id]);
  return sendSuccess(res, null, 'Layanan PST berhasil dihapus');
});

export const getKinerjaPublications = asyncHandler(async (req, res) => {
  await ensureBpsSchema();
  const periodeId = readOptionalPositiveId(req.query.periodeId, 'Periode kinerja');
  const conditions: string[] = [];
  const params: any[] = [];
  if (periodeId) { conditions.push('pb.periode_id = ?'); params.push(periodeId); }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [rows] = await pool.query<any[]>(
    `SELECT pb.id, pb.periode_id AS periodeId, COALESCE(pr.nama_periode, '-') AS periodeName,
            pb.jenis_output AS jenisOutput, pb.nama_output AS namaOutput, pb.tanggal_target AS tanggalTarget,
            pb.tanggal_terbit AS tanggalTerbit, pb.tim_kerja_id AS timKerjaId, COALESCE(tk.nama_tim, '-') AS timKerjaName,
            pb.ketua_tim_id AS ketuaTimId, COALESCE(pg.nama_lengkap, '-') AS ketuaTimName,
            pb.status, COALESCE(pb.tautan_file, '') AS tautanFile, COALESCE(pb.catatan, '') AS catatan,
            pb.dibuat_pada AS createdAt, pb.diperbarui_pada AS updatedAt
     FROM kinerja_publikasi_brs pb
     LEFT JOIN kinerja_periode pr ON pr.id = pb.periode_id
     LEFT JOIN kinerja_tim_kerja tk ON tk.id = pb.tim_kerja_id
     LEFT JOIN pegawai pg ON pg.id = pb.ketua_tim_id
     ${whereClause}
     ORDER BY COALESCE(pb.tanggal_target, pb.tanggal_terbit) DESC, pb.id DESC`,
    params
  );
  return sendSuccess(res, rows);
});

export const createKinerjaPublication = asyncHandler(async (req, res) => {
  await ensureBpsSchema();
  const payload = await readPublicationPayload(req.body);
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO kinerja_publikasi_brs
     (periode_id, jenis_output, nama_output, tanggal_target, tanggal_terbit, tim_kerja_id, ketua_tim_id, status, tautan_file, catatan)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [payload.periodeId, payload.jenisOutput, payload.namaOutput, payload.tanggalTarget, payload.tanggalTerbit, payload.timKerjaId, payload.ketuaTimId, payload.status, payload.tautanFile || null, payload.catatan || null]
  );
  return sendSuccess(res, { id: result.insertId }, 'Publikasi atau BRS berhasil ditambahkan', 201);
});

export const updateKinerjaPublication = asyncHandler(async (req, res) => {
  await ensureBpsSchema();
  const id = readPositiveId(req.params.id, 'ID publikasi');
  await ensurePublicationExists(id);
  const payload = await readPublicationPayload(req.body);
  await pool.query(
    `UPDATE kinerja_publikasi_brs
     SET periode_id = ?, jenis_output = ?, nama_output = ?, tanggal_target = ?, tanggal_terbit = ?, tim_kerja_id = ?, ketua_tim_id = ?, status = ?, tautan_file = ?, catatan = ?
     WHERE id = ?`,
    [payload.periodeId, payload.jenisOutput, payload.namaOutput, payload.tanggalTarget, payload.tanggalTerbit, payload.timKerjaId, payload.ketuaTimId, payload.status, payload.tautanFile || null, payload.catatan || null, id]
  );
  return sendSuccess(res, null, 'Publikasi atau BRS berhasil diperbarui');
});

export const deleteKinerjaPublication = asyncHandler(async (req, res) => {
  await ensureBpsSchema();
  const id = readPositiveId(req.params.id, 'ID publikasi');
  await ensurePublicationExists(id);
  await pool.query(`DELETE FROM kinerja_publikasi_brs WHERE id = ?`, [id]);
  return sendSuccess(res, null, 'Publikasi atau BRS berhasil dihapus');
});

export const getKinerjaSectoralCoachings = asyncHandler(async (req, res) => {
  await ensureBpsSchema();
  const periodeId = readOptionalPositiveId(req.query.periodeId, 'Periode kinerja');
  const conditions: string[] = [];
  const params: any[] = [];
  if (periodeId) { conditions.push('ps.periode_id = ?'); params.push(periodeId); }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [rows] = await pool.query<any[]>(
    `SELECT ps.id, ps.periode_id AS periodeId, COALESCE(pr.nama_periode, '-') AS periodeName,
            ps.tanggal_kegiatan AS tanggalKegiatan, ps.opd_binaan AS opdBinaan, ps.jenis_pembinaan AS jenisPembinaan,
            COALESCE(ps.materi, '') AS materi, COALESCE(ps.output, '') AS output, ps.pegawai_id AS pegawaiId,
            COALESCE(pg.nama_lengkap, '-') AS pegawaiName, COALESCE(ps.tindak_lanjut, '') AS tindakLanjut,
            ps.status, ps.dibuat_pada AS createdAt, ps.diperbarui_pada AS updatedAt
     FROM kinerja_pembinaan_sektoral ps
     LEFT JOIN kinerja_periode pr ON pr.id = ps.periode_id
     LEFT JOIN pegawai pg ON pg.id = ps.pegawai_id
     ${whereClause}
     ORDER BY ps.tanggal_kegiatan DESC, ps.id DESC`,
    params
  );
  return sendSuccess(res, rows);
});

export const createKinerjaSectoralCoaching = asyncHandler(async (req, res) => {
  await ensureBpsSchema();
  const payload = await readCoachingPayload(req.body);
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO kinerja_pembinaan_sektoral
     (periode_id, tanggal_kegiatan, opd_binaan, jenis_pembinaan, materi, output, pegawai_id, tindak_lanjut, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [payload.periodeId, payload.tanggalKegiatan, payload.opdBinaan, payload.jenisPembinaan, payload.materi || null, payload.output || null, payload.pegawaiId, payload.tindakLanjut || null, payload.status]
  );
  return sendSuccess(res, { id: result.insertId }, 'Pembinaan statistik sektoral berhasil ditambahkan', 201);
});

export const updateKinerjaSectoralCoaching = asyncHandler(async (req, res) => {
  await ensureBpsSchema();
  const id = readPositiveId(req.params.id, 'ID pembinaan sektoral');
  await ensureCoachingExists(id);
  const payload = await readCoachingPayload(req.body);
  await pool.query(
    `UPDATE kinerja_pembinaan_sektoral
     SET periode_id = ?, tanggal_kegiatan = ?, opd_binaan = ?, jenis_pembinaan = ?, materi = ?, output = ?, pegawai_id = ?, tindak_lanjut = ?, status = ?
     WHERE id = ?`,
    [payload.periodeId, payload.tanggalKegiatan, payload.opdBinaan, payload.jenisPembinaan, payload.materi || null, payload.output || null, payload.pegawaiId, payload.tindakLanjut || null, payload.status, id]
  );
  return sendSuccess(res, null, 'Pembinaan statistik sektoral berhasil diperbarui');
});

export const deleteKinerjaSectoralCoaching = asyncHandler(async (req, res) => {
  await ensureBpsSchema();
  const id = readPositiveId(req.params.id, 'ID pembinaan sektoral');
  await ensureCoachingExists(id);
  await pool.query(`DELETE FROM kinerja_pembinaan_sektoral WHERE id = ?`, [id]);
  return sendSuccess(res, null, 'Pembinaan statistik sektoral berhasil dihapus');
});

export const getKinerjaFieldMonitorings = asyncHandler(async (req, res) => {
  await ensureBpsSchema();
  const periodeId = readOptionalPositiveId(req.query.periodeId, 'Periode kinerja');
  const year = req.query.year ? readIntegerInRange(req.query.year, 2020, 2100, 'Tahun') : null;
  const month = req.query.month ? readIntegerInRange(req.query.month, 1, 12, 'Bulan') : null;
  const teamId = req.query.teamId ? readPositiveId(req.query.teamId, 'Tim kerja') : null;
  const employeeId = req.query.employeeId ? readPositiveId(req.query.employeeId, 'Pegawai') : null;
  const conditions: string[] = [];
  const params: any[] = [];

  if (periodeId) { conditions.push('mp.periode_id = ?'); params.push(periodeId); }
  if (month) { conditions.push('MONTH(mp.tanggal_update) = ?'); params.push(month); }
  if (year) { conditions.push('YEAR(mp.tanggal_update) = ?'); params.push(year); }
  if (teamId) {
    conditions.push(`EXISTS (
      SELECT 1
      FROM kinerja_assignment ka
      WHERE ka.kegiatan_id = mp.kegiatan_id
        AND ka.tim_kerja_id = ?
    )`);
    params.push(teamId);
  }
  if (employeeId) {
    conditions.push(`EXISTS (
      SELECT 1
      FROM kinerja_assignment ka
      WHERE ka.kegiatan_id = mp.kegiatan_id
        AND ka.pegawai_id = ?
    )`);
    params.push(employeeId);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [rows] = await pool.query<any[]>(
    `SELECT mp.id, mp.periode_id AS periodeId, COALESCE(pr.nama_periode, '-') AS periodeName,
            mp.kegiatan_id AS kegiatanId, COALESCE(kg.nama, '-') AS kegiatanName, mp.wilayah,
            mp.jumlah_target AS jumlahTarget, mp.jumlah_selesai AS jumlahSelesai, mp.jumlah_error AS jumlahError,
            mp.jumlah_revisit AS jumlahRevisit, COALESCE(mp.catatan, '') AS catatan, mp.tanggal_update AS tanggalUpdate,
            mp.status, mp.dibuat_pada AS createdAt, mp.diperbarui_pada AS updatedAt
     FROM kinerja_monitoring_pendataan mp
     LEFT JOIN kinerja_periode pr ON pr.id = mp.periode_id
     LEFT JOIN kegiatan_indikator_kinerja kg ON kg.id = mp.kegiatan_id
     ${whereClause}
     ORDER BY mp.tanggal_update DESC, mp.id DESC`,
    params
  );
  return sendSuccess(res, rows);
});

export const createKinerjaFieldMonitoring = asyncHandler(async (req, res) => {
  await ensureBpsSchema();
  const payload = await readFieldMonitoringPayload(req.body);
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO kinerja_monitoring_pendataan
     (periode_id, kegiatan_id, wilayah, jumlah_target, jumlah_selesai, jumlah_error, jumlah_revisit, catatan, tanggal_update, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [payload.periodeId, payload.kegiatanId, payload.wilayah, payload.jumlahTarget, payload.jumlahSelesai, payload.jumlahError, payload.jumlahRevisit, payload.catatan || null, payload.tanggalUpdate, payload.status]
  );
  return sendSuccess(res, { id: result.insertId }, 'Monitoring pendataan berhasil ditambahkan', 201);
});

export const updateKinerjaFieldMonitoring = asyncHandler(async (req, res) => {
  await ensureBpsSchema();
  const id = readPositiveId(req.params.id, 'ID monitoring pendataan');
  await ensureFieldMonitoringExists(id);
  const payload = await readFieldMonitoringPayload(req.body);
  await pool.query(
    `UPDATE kinerja_monitoring_pendataan
     SET periode_id = ?, kegiatan_id = ?, wilayah = ?, jumlah_target = ?, jumlah_selesai = ?, jumlah_error = ?, jumlah_revisit = ?, catatan = ?, tanggal_update = ?, status = ?
     WHERE id = ?`,
    [payload.periodeId, payload.kegiatanId, payload.wilayah, payload.jumlahTarget, payload.jumlahSelesai, payload.jumlahError, payload.jumlahRevisit, payload.catatan || null, payload.tanggalUpdate, payload.status, id]
  );
  return sendSuccess(res, null, 'Monitoring pendataan berhasil diperbarui');
});

export const deleteKinerjaFieldMonitoring = asyncHandler(async (req, res) => {
  await ensureBpsSchema();
  const id = readPositiveId(req.params.id, 'ID monitoring pendataan');
  await ensureFieldMonitoringExists(id);
  await pool.query(`DELETE FROM kinerja_monitoring_pendataan WHERE id = ?`, [id]);
  return sendSuccess(res, null, 'Monitoring pendataan berhasil dihapus');
});

export const getKinerjaProcessingMonitorings = asyncHandler(async (req, res) => {
  await ensureBpsSchema();
  const periodeId = readOptionalPositiveId(req.query.periodeId, 'Periode kinerja');
  const year = req.query.year ? readIntegerInRange(req.query.year, 2020, 2100, 'Tahun') : null;
  const month = req.query.month ? readIntegerInRange(req.query.month, 1, 12, 'Bulan') : null;
  const teamId = req.query.teamId ? readPositiveId(req.query.teamId, 'Tim kerja') : null;
  const employeeId = req.query.employeeId ? readPositiveId(req.query.employeeId, 'Pegawai') : null;
  const conditions: string[] = [];
  const params: any[] = [];

  if (periodeId) { conditions.push('mp.periode_id = ?'); params.push(periodeId); }
  if (month) { conditions.push('MONTH(mp.tanggal_update) = ?'); params.push(month); }
  if (year) { conditions.push('YEAR(mp.tanggal_update) = ?'); params.push(year); }
  if (teamId) {
    conditions.push(`EXISTS (
      SELECT 1
      FROM kinerja_assignment ka
      WHERE ka.kegiatan_id = mp.kegiatan_id
        AND ka.tim_kerja_id = ?
    )`);
    params.push(teamId);
  }
  if (employeeId) {
    conditions.push(`EXISTS (
      SELECT 1
      FROM kinerja_assignment ka
      WHERE ka.kegiatan_id = mp.kegiatan_id
        AND ka.pegawai_id = ?
    )`);
    params.push(employeeId);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [rows] = await pool.query<any[]>(
    `SELECT mp.id, mp.periode_id AS periodeId, COALESCE(pr.nama_periode, '-') AS periodeName,
            mp.kegiatan_id AS kegiatanId, COALESCE(kg.nama, '-') AS kegiatanName,
            mp.dokumen_masuk AS dokumenMasuk, mp.dokumen_selesai AS dokumenSelesai, mp.backlog,
            COALESCE(mp.status_editing, '') AS statusEditing, COALESCE(mp.status_coding, '') AS statusCoding,
            COALESCE(mp.status_cleaning, '') AS statusCleaning, mp.tanggal_update AS tanggalUpdate,
            COALESCE(mp.catatan, '') AS catatan, mp.status, mp.dibuat_pada AS createdAt, mp.diperbarui_pada AS updatedAt
     FROM kinerja_monitoring_pengolahan mp
     LEFT JOIN kinerja_periode pr ON pr.id = mp.periode_id
     LEFT JOIN kegiatan_indikator_kinerja kg ON kg.id = mp.kegiatan_id
     ${whereClause}
     ORDER BY mp.tanggal_update DESC, mp.id DESC`,
    params
  );
  return sendSuccess(res, rows);
});

export const createKinerjaProcessingMonitoring = asyncHandler(async (req, res) => {
  await ensureBpsSchema();
  const payload = await readProcessingMonitoringPayload(req.body);
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO kinerja_monitoring_pengolahan
     (periode_id, kegiatan_id, dokumen_masuk, dokumen_selesai, backlog, status_editing, status_coding, status_cleaning, tanggal_update, catatan, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [payload.periodeId, payload.kegiatanId, payload.dokumenMasuk, payload.dokumenSelesai, payload.backlog, payload.statusEditing || null, payload.statusCoding || null, payload.statusCleaning || null, payload.tanggalUpdate, payload.catatan || null, payload.status]
  );
  return sendSuccess(res, { id: result.insertId }, 'Monitoring pengolahan berhasil ditambahkan', 201);
});

export const updateKinerjaProcessingMonitoring = asyncHandler(async (req, res) => {
  await ensureBpsSchema();
  const id = readPositiveId(req.params.id, 'ID monitoring pengolahan');
  await ensureProcessingMonitoringExists(id);
  const payload = await readProcessingMonitoringPayload(req.body);
  await pool.query(
    `UPDATE kinerja_monitoring_pengolahan
     SET periode_id = ?, kegiatan_id = ?, dokumen_masuk = ?, dokumen_selesai = ?, backlog = ?, status_editing = ?, status_coding = ?, status_cleaning = ?, tanggal_update = ?, catatan = ?, status = ?
     WHERE id = ?`,
    [payload.periodeId, payload.kegiatanId, payload.dokumenMasuk, payload.dokumenSelesai, payload.backlog, payload.statusEditing || null, payload.statusCoding || null, payload.statusCleaning || null, payload.tanggalUpdate, payload.catatan || null, payload.status, id]
  );
  return sendSuccess(res, null, 'Monitoring pengolahan berhasil diperbarui');
});

export const deleteKinerjaProcessingMonitoring = asyncHandler(async (req, res) => {
  await ensureBpsSchema();
  const id = readPositiveId(req.params.id, 'ID monitoring pengolahan');
  await ensureProcessingMonitoringExists(id);
  await pool.query(`DELETE FROM kinerja_monitoring_pengolahan WHERE id = ?`, [id]);
  return sendSuccess(res, null, 'Monitoring pengolahan berhasil dihapus');
});
