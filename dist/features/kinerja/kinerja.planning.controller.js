"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.approveDialogAwal = exports.updateDialogAwal = exports.createDialogAwal = exports.getDialogAwal = exports.generateTargetPeriodik = exports.updateTargetPeriodik = exports.createTargetPeriodik = exports.getTargetPeriodik = exports.lockIkiPegawai = exports.reviseIkiPegawai = exports.approveIkiPegawai = exports.submitIkiPegawai = exports.updateIkiPegawai = exports.createIkiPegawai = exports.getIkiPegawai = exports.deleteCascadingIku = exports.updateCascadingIku = exports.createCascadingIku = exports.getCascadingIku = exports.deleteIkuSatker = exports.updateIkuSatker = exports.createIkuSatker = exports.getIkuSatker = void 0;
const database_1 = require("../../config/database");
const http_1 = require("../../shared/http");
const validation_1 = require("../../shared/validation");
let planningSchemaReady = false;
const planningStatuses = ["draft", "aktif", "arsip"];
const ikiStatuses = ["draft", "diajukan", "disetujui", "revisi", "dikunci"];
const targetPeriodTypes = ["bulanan", "triwulan", "semester"];
const targetPeriodStatuses = ["draft", "aktif", "dikunci"];
const dialogStatuses = ["draft", "diajukan", "disetujui"];
const ensureColumnExists = async (tableName, columnName, columnDefinition) => {
    const [rows] = await database_1.pool.query(`SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`, [tableName, columnName]);
    if (!rows.length) {
        await database_1.pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`);
    }
};
const ensureIndexExists = async (tableName, indexName, createSql) => {
    const [rows] = await database_1.pool.query(`SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`, [tableName, indexName]);
    if (!rows.length) {
        await database_1.pool.query(createSql);
    }
};
const ensureForeignKeyExists = async (tableName, constraintName, createSql) => {
    const [rows] = await database_1.pool.query(`SELECT CONSTRAINT_NAME
     FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?
     LIMIT 1`, [tableName, constraintName]);
    if (!rows.length) {
        await database_1.pool.query(createSql);
    }
};
const ensurePlanningSchema = async () => {
    if (planningSchemaReady)
        return;
    await database_1.pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_iku_satker (
      id INT NOT NULL AUTO_INCREMENT,
      periode_id INT NOT NULL,
      sasaran_strategis VARCHAR(255) NOT NULL,
      nama_iku VARCHAR(255) NOT NULL,
      definisi TEXT NULL,
      formula TEXT NULL,
      target DECIMAL(18,2) NULL,
      satuan_id INT NULL,
      bobot DECIMAL(5,2) NULL,
      sumber_data VARCHAR(255) NULL,
      penanggung_jawab_pegawai_id INT NULL,
      status ENUM('draft','aktif','arsip') NOT NULL DEFAULT 'draft',
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
    await ensureIndexExists("kinerja_iku_satker", "idx_kinerja_iku_satker_periode", "ALTER TABLE kinerja_iku_satker ADD INDEX idx_kinerja_iku_satker_periode (periode_id)");
    await ensureIndexExists("kinerja_iku_satker", "idx_kinerja_iku_satker_satuan", "ALTER TABLE kinerja_iku_satker ADD INDEX idx_kinerja_iku_satker_satuan (satuan_id)");
    await ensureIndexExists("kinerja_iku_satker", "idx_kinerja_iku_satker_penanggung_jawab", "ALTER TABLE kinerja_iku_satker ADD INDEX idx_kinerja_iku_satker_penanggung_jawab (penanggung_jawab_pegawai_id)");
    await ensureForeignKeyExists("kinerja_iku_satker", "fk_kinerja_iku_satker_periode", `ALTER TABLE kinerja_iku_satker ADD CONSTRAINT fk_kinerja_iku_satker_periode FOREIGN KEY (periode_id) REFERENCES kinerja_periode (id) ON DELETE RESTRICT ON UPDATE CASCADE`);
    await ensureForeignKeyExists("kinerja_iku_satker", "fk_kinerja_iku_satker_satuan", `ALTER TABLE kinerja_iku_satker ADD CONSTRAINT fk_kinerja_iku_satker_satuan FOREIGN KEY (satuan_id) REFERENCES kinerja_satuan (id) ON DELETE SET NULL ON UPDATE CASCADE`);
    await ensureForeignKeyExists("kinerja_iku_satker", "fk_kinerja_iku_satker_penanggung_jawab", `ALTER TABLE kinerja_iku_satker ADD CONSTRAINT fk_kinerja_iku_satker_penanggung_jawab FOREIGN KEY (penanggung_jawab_pegawai_id) REFERENCES pegawai (id) ON DELETE SET NULL ON UPDATE CASCADE`);
    await database_1.pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_cascading_iku (
      id INT NOT NULL AUTO_INCREMENT,
      iku_satker_id INT NOT NULL,
      indikator_kinerja_id INT NOT NULL,
      tim_kerja_id INT NULL,
      pegawai_id INT NULL,
      persentase_kontribusi DECIMAL(5,2) NULL,
      catatan TEXT NULL,
      status ENUM('draft','aktif','arsip') NOT NULL DEFAULT 'draft',
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
    await ensureIndexExists("kinerja_cascading_iku", "idx_kinerja_cascading_iku_satker", "ALTER TABLE kinerja_cascading_iku ADD INDEX idx_kinerja_cascading_iku_satker (iku_satker_id)");
    await ensureIndexExists("kinerja_cascading_iku", "idx_kinerja_cascading_indikator", "ALTER TABLE kinerja_cascading_iku ADD INDEX idx_kinerja_cascading_indikator (indikator_kinerja_id)");
    await ensureIndexExists("kinerja_cascading_iku", "idx_kinerja_cascading_tim", "ALTER TABLE kinerja_cascading_iku ADD INDEX idx_kinerja_cascading_tim (tim_kerja_id)");
    await ensureIndexExists("kinerja_cascading_iku", "idx_kinerja_cascading_pegawai", "ALTER TABLE kinerja_cascading_iku ADD INDEX idx_kinerja_cascading_pegawai (pegawai_id)");
    await ensureForeignKeyExists("kinerja_cascading_iku", "fk_kinerja_cascading_iku_satker", `ALTER TABLE kinerja_cascading_iku ADD CONSTRAINT fk_kinerja_cascading_iku_satker FOREIGN KEY (iku_satker_id) REFERENCES kinerja_iku_satker (id) ON DELETE CASCADE ON UPDATE CASCADE`);
    await ensureForeignKeyExists("kinerja_cascading_iku", "fk_kinerja_cascading_indikator", `ALTER TABLE kinerja_cascading_iku ADD CONSTRAINT fk_kinerja_cascading_indikator FOREIGN KEY (indikator_kinerja_id) REFERENCES indikator_kinerja (id) ON DELETE RESTRICT ON UPDATE CASCADE`);
    await ensureForeignKeyExists("kinerja_cascading_iku", "fk_kinerja_cascading_tim", `ALTER TABLE kinerja_cascading_iku ADD CONSTRAINT fk_kinerja_cascading_tim FOREIGN KEY (tim_kerja_id) REFERENCES kinerja_tim_kerja (id) ON DELETE SET NULL ON UPDATE CASCADE`);
    await ensureForeignKeyExists("kinerja_cascading_iku", "fk_kinerja_cascading_pegawai", `ALTER TABLE kinerja_cascading_iku ADD CONSTRAINT fk_kinerja_cascading_pegawai FOREIGN KEY (pegawai_id) REFERENCES pegawai (id) ON DELETE SET NULL ON UPDATE CASCADE`);
    await database_1.pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_iki_pegawai (
      id INT NOT NULL AUTO_INCREMENT,
      periode_id INT NOT NULL,
      pegawai_id INT NOT NULL,
      tim_kerja_id INT NULL,
      indikator_kinerja_id INT NULL,
      nama_iki VARCHAR(255) NOT NULL,
      target DECIMAL(18,2) NULL,
      satuan_id INT NULL,
      bobot DECIMAL(5,2) NULL,
      metode_ukur VARCHAR(255) NULL,
      sumber_bukti VARCHAR(255) NULL,
      status ENUM('draft','diajukan','disetujui','revisi','dikunci') NOT NULL DEFAULT 'draft',
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
    await ensureIndexExists("kinerja_iki_pegawai", "idx_kinerja_iki_periode", "ALTER TABLE kinerja_iki_pegawai ADD INDEX idx_kinerja_iki_periode (periode_id)");
    await ensureIndexExists("kinerja_iki_pegawai", "idx_kinerja_iki_pegawai", "ALTER TABLE kinerja_iki_pegawai ADD INDEX idx_kinerja_iki_pegawai (pegawai_id)");
    await ensureIndexExists("kinerja_iki_pegawai", "idx_kinerja_iki_tim", "ALTER TABLE kinerja_iki_pegawai ADD INDEX idx_kinerja_iki_tim (tim_kerja_id)");
    await ensureIndexExists("kinerja_iki_pegawai", "idx_kinerja_iki_indikator", "ALTER TABLE kinerja_iki_pegawai ADD INDEX idx_kinerja_iki_indikator (indikator_kinerja_id)");
    await ensureIndexExists("kinerja_iki_pegawai", "idx_kinerja_iki_satuan", "ALTER TABLE kinerja_iki_pegawai ADD INDEX idx_kinerja_iki_satuan (satuan_id)");
    await ensureForeignKeyExists("kinerja_iki_pegawai", "fk_kinerja_iki_periode", `ALTER TABLE kinerja_iki_pegawai ADD CONSTRAINT fk_kinerja_iki_periode FOREIGN KEY (periode_id) REFERENCES kinerja_periode (id) ON DELETE RESTRICT ON UPDATE CASCADE`);
    await ensureForeignKeyExists("kinerja_iki_pegawai", "fk_kinerja_iki_pegawai", `ALTER TABLE kinerja_iki_pegawai ADD CONSTRAINT fk_kinerja_iki_pegawai FOREIGN KEY (pegawai_id) REFERENCES pegawai (id) ON DELETE CASCADE ON UPDATE CASCADE`);
    await ensureForeignKeyExists("kinerja_iki_pegawai", "fk_kinerja_iki_tim", `ALTER TABLE kinerja_iki_pegawai ADD CONSTRAINT fk_kinerja_iki_tim FOREIGN KEY (tim_kerja_id) REFERENCES kinerja_tim_kerja (id) ON DELETE SET NULL ON UPDATE CASCADE`);
    await ensureForeignKeyExists("kinerja_iki_pegawai", "fk_kinerja_iki_indikator", `ALTER TABLE kinerja_iki_pegawai ADD CONSTRAINT fk_kinerja_iki_indikator FOREIGN KEY (indikator_kinerja_id) REFERENCES indikator_kinerja (id) ON DELETE SET NULL ON UPDATE CASCADE`);
    await ensureForeignKeyExists("kinerja_iki_pegawai", "fk_kinerja_iki_satuan", `ALTER TABLE kinerja_iki_pegawai ADD CONSTRAINT fk_kinerja_iki_satuan FOREIGN KEY (satuan_id) REFERENCES kinerja_satuan (id) ON DELETE SET NULL ON UPDATE CASCADE`);
    await database_1.pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_target_periodik (
      id INT NOT NULL AUTO_INCREMENT,
      iki_pegawai_id INT NOT NULL,
      jenis_periode ENUM('bulanan','triwulan','semester') NOT NULL,
      periode_ke TINYINT NOT NULL,
      tanggal_mulai DATE NOT NULL,
      tanggal_selesai DATE NOT NULL,
      target DECIMAL(18,2) NULL,
      milestone VARCHAR(255) NULL,
      status ENUM('draft','aktif','dikunci') NOT NULL DEFAULT 'draft',
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
    await ensureIndexExists("kinerja_target_periodik", "idx_kinerja_target_periodik_iki", "ALTER TABLE kinerja_target_periodik ADD INDEX idx_kinerja_target_periodik_iki (iki_pegawai_id)");
    await ensureForeignKeyExists("kinerja_target_periodik", "fk_kinerja_target_periodik_iki", `ALTER TABLE kinerja_target_periodik ADD CONSTRAINT fk_kinerja_target_periodik_iki FOREIGN KEY (iki_pegawai_id) REFERENCES kinerja_iki_pegawai (id) ON DELETE CASCADE ON UPDATE CASCADE`);
    await database_1.pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_dialog_awal (
      id INT NOT NULL AUTO_INCREMENT,
      periode_id INT NOT NULL,
      pegawai_id INT NOT NULL,
      penilai_pegawai_id INT NOT NULL,
      ringkasan_target TEXT NULL,
      ekspektasi_hasil TEXT NULL,
      ekspektasi_perilaku TEXT NULL,
      risiko TEXT NULL,
      dukungan_dibutuhkan TEXT NULL,
      catatan_dialog TEXT NULL,
      status ENUM('draft','diajukan','disetujui') NOT NULL DEFAULT 'draft',
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
    await ensureIndexExists("kinerja_dialog_awal", "idx_kinerja_dialog_awal_periode", "ALTER TABLE kinerja_dialog_awal ADD INDEX idx_kinerja_dialog_awal_periode (periode_id)");
    await ensureIndexExists("kinerja_dialog_awal", "idx_kinerja_dialog_awal_pegawai", "ALTER TABLE kinerja_dialog_awal ADD INDEX idx_kinerja_dialog_awal_pegawai (pegawai_id)");
    await ensureIndexExists("kinerja_dialog_awal", "idx_kinerja_dialog_awal_penilai", "ALTER TABLE kinerja_dialog_awal ADD INDEX idx_kinerja_dialog_awal_penilai (penilai_pegawai_id)");
    await ensureForeignKeyExists("kinerja_dialog_awal", "fk_kinerja_dialog_awal_periode", `ALTER TABLE kinerja_dialog_awal ADD CONSTRAINT fk_kinerja_dialog_awal_periode FOREIGN KEY (periode_id) REFERENCES kinerja_periode (id) ON DELETE RESTRICT ON UPDATE CASCADE`);
    await ensureForeignKeyExists("kinerja_dialog_awal", "fk_kinerja_dialog_awal_pegawai", `ALTER TABLE kinerja_dialog_awal ADD CONSTRAINT fk_kinerja_dialog_awal_pegawai FOREIGN KEY (pegawai_id) REFERENCES pegawai (id) ON DELETE CASCADE ON UPDATE CASCADE`);
    await ensureForeignKeyExists("kinerja_dialog_awal", "fk_kinerja_dialog_awal_penilai", `ALTER TABLE kinerja_dialog_awal ADD CONSTRAINT fk_kinerja_dialog_awal_penilai FOREIGN KEY (penilai_pegawai_id) REFERENCES pegawai (id) ON DELETE RESTRICT ON UPDATE CASCADE`);
    // ensure indikator table has fields from phase1 if schema was older
    await ensureColumnExists("indikator_kinerja", "periode_id", "periode_id INT NULL AFTER id");
    await ensureColumnExists("indikator_kinerja", "satuan_id", "satuan_id INT NULL AFTER target_default");
    planningSchemaReady = true;
};
const readOptionalPositiveId = (value, fieldName) => {
    if (value === undefined || value === null || value === "")
        return null;
    return (0, validation_1.readPositiveId)(value, fieldName);
};
const readOptionalNumber = (value, fieldName) => {
    if (value === undefined || value === null || value === "")
        return null;
    return (0, validation_1.readNonNegativeNumber)(value, fieldName);
};
const ensureDateRange = (startDate, endDate) => {
    if (new Date(startDate).getTime() > new Date(endDate).getTime()) {
        (0, http_1.fail)("Tanggal selesai tidak boleh lebih awal dari tanggal mulai", 400);
    }
};
const ensureRecordExists = async (tableName, id, label) => {
    const [rows] = await database_1.pool.query(`SELECT id FROM ${tableName} WHERE id = ? LIMIT 1`, [id]);
    if (!rows.length)
        (0, http_1.fail)(`${label} tidak ditemukan`, 404);
};
const normalizeIkuPayload = (body) => ({
    periodeId: (0, validation_1.readPositiveId)(body.periodeId, "Periode kinerja"),
    sasaranStrategis: (0, validation_1.ensureRequired)((0, validation_1.readTrimmedString)(body.sasaranStrategis), "Sasaran strategis wajib diisi"),
    namaIku: (0, validation_1.ensureRequired)((0, validation_1.readTrimmedString)(body.namaIku), "Nama IKU wajib diisi"),
    definisi: (0, validation_1.readTrimmedString)(body.definisi),
    formula: (0, validation_1.readTrimmedString)(body.formula),
    target: readOptionalNumber(body.target, "Target"),
    satuanId: readOptionalPositiveId(body.satuanId, "Satuan"),
    bobot: readOptionalNumber(body.bobot, "Bobot"),
    sumberData: (0, validation_1.readTrimmedString)(body.sumberData),
    penanggungJawabPegawaiId: readOptionalPositiveId(body.penanggungJawabPegawaiId, "Penanggung jawab"),
    status: (0, validation_1.ensureOneOf)((0, validation_1.readTrimmedString)(body.status || "draft").toLowerCase(), planningStatuses, "Status")
});
const normalizeCascadingPayload = (body) => ({
    ikuSatkerId: (0, validation_1.readPositiveId)(body.ikuSatkerId, "IKU Satker"),
    indikatorKinerjaId: (0, validation_1.readPositiveId)(body.indikatorKinerjaId, "Indikator kinerja"),
    timKerjaId: readOptionalPositiveId(body.timKerjaId, "Tim kerja"),
    pegawaiId: readOptionalPositiveId(body.pegawaiId, "Pegawai"),
    persentaseKontribusi: readOptionalNumber(body.persentaseKontribusi, "Persentase kontribusi"),
    catatan: (0, validation_1.readTrimmedString)(body.catatan),
    status: (0, validation_1.ensureOneOf)((0, validation_1.readTrimmedString)(body.status || "draft").toLowerCase(), planningStatuses, "Status")
});
const normalizeIkiPayload = (body) => ({
    periodeId: (0, validation_1.readPositiveId)(body.periodeId, "Periode kinerja"),
    pegawaiId: (0, validation_1.readPositiveId)(body.pegawaiId, "Pegawai"),
    timKerjaId: readOptionalPositiveId(body.timKerjaId, "Tim kerja"),
    indikatorKinerjaId: readOptionalPositiveId(body.indikatorKinerjaId, "Indikator kinerja"),
    namaIki: (0, validation_1.ensureRequired)((0, validation_1.readTrimmedString)(body.namaIki), "Nama IKI wajib diisi"),
    target: readOptionalNumber(body.target, "Target"),
    satuanId: readOptionalPositiveId(body.satuanId, "Satuan"),
    bobot: readOptionalNumber(body.bobot, "Bobot"),
    metodeUkur: (0, validation_1.readTrimmedString)(body.metodeUkur),
    sumberBukti: (0, validation_1.readTrimmedString)(body.sumberBukti),
    status: (0, validation_1.ensureOneOf)((0, validation_1.readTrimmedString)(body.status || "draft").toLowerCase(), ["draft", "revisi"], "Status awal")
});
const normalizeTargetPeriodikPayload = (body) => {
    const startDate = (0, validation_1.readDateString)(body.tanggalMulai, "Tanggal mulai");
    const endDate = (0, validation_1.readDateString)(body.tanggalSelesai, "Tanggal selesai");
    ensureDateRange(startDate, endDate);
    return {
        ikiPegawaiId: (0, validation_1.readPositiveId)(body.ikiPegawaiId, "IKI pegawai"),
        jenisPeriode: (0, validation_1.ensureOneOf)((0, validation_1.readTrimmedString)(body.jenisPeriode || "bulanan").toLowerCase(), targetPeriodTypes, "Jenis periode"),
        periodeKe: (0, validation_1.readIntegerInRange)(body.periodeKe, 1, 12, "Periode ke"),
        tanggalMulai: startDate,
        tanggalSelesai: endDate,
        target: readOptionalNumber(body.target, "Target"),
        milestone: (0, validation_1.readTrimmedString)(body.milestone),
        status: (0, validation_1.ensureOneOf)((0, validation_1.readTrimmedString)(body.status || "draft").toLowerCase(), targetPeriodStatuses, "Status")
    };
};
const normalizeDialogPayload = (body) => ({
    periodeId: (0, validation_1.readPositiveId)(body.periodeId, "Periode kinerja"),
    pegawaiId: (0, validation_1.readPositiveId)(body.pegawaiId, "Pegawai"),
    penilaiPegawaiId: (0, validation_1.readPositiveId)(body.penilaiPegawaiId, "Penilai"),
    ringkasanTarget: (0, validation_1.readTrimmedString)(body.ringkasanTarget),
    ekspektasiHasil: (0, validation_1.readTrimmedString)(body.ekspektasiHasil),
    ekspektasiPerilaku: (0, validation_1.readTrimmedString)(body.ekspektasiPerilaku),
    risiko: (0, validation_1.readTrimmedString)(body.risiko),
    dukunganDibutuhkan: (0, validation_1.readTrimmedString)(body.dukunganDibutuhkan),
    catatanDialog: (0, validation_1.readTrimmedString)(body.catatanDialog),
    status: (0, validation_1.ensureOneOf)((0, validation_1.readTrimmedString)(body.status || "draft").toLowerCase(), ["draft", "diajukan"], "Status")
});
exports.getIkuSatker = (0, http_1.asyncHandler)(async (req, res) => {
    await ensurePlanningSchema();
    const conditions = [];
    const params = [];
    if (req.query.periodeId) {
        conditions.push("i.periode_id = ?");
        params.push((0, validation_1.readPositiveId)(req.query.periodeId, "Periode kinerja"));
    }
    if (req.query.status) {
        conditions.push("i.status = ?");
        params.push((0, validation_1.ensureOneOf)((0, validation_1.readTrimmedString)(req.query.status).toLowerCase(), planningStatuses, "Status"));
    }
    if (req.query.search) {
        conditions.push("(i.nama_iku LIKE ? OR i.sasaran_strategis LIKE ?)");
        const keyword = `%${(0, validation_1.readTrimmedString)(req.query.search)}%`;
        params.push(keyword, keyword);
    }
    const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await database_1.pool.query(`SELECT i.id,
            i.periode_id AS periodeId,
            p.nama_periode AS periodeNama,
            i.sasaran_strategis AS sasaranStrategis,
            i.nama_iku AS namaIku,
            COALESCE(i.definisi, '') AS definisi,
            COALESCE(i.formula, '') AS formula,
            i.target,
            i.satuan_id AS satuanId,
            COALESCE(s.nama_satuan, '-') AS satuanNama,
            i.bobot,
            COALESCE(i.sumber_data, '') AS sumberData,
            i.penanggung_jawab_pegawai_id AS penanggungJawabPegawaiId,
            COALESCE(pg.nama_lengkap, '-') AS penanggungJawabNama,
            i.status
     FROM kinerja_iku_satker i
     LEFT JOIN kinerja_periode p ON p.id = i.periode_id
     LEFT JOIN kinerja_satuan s ON s.id = i.satuan_id
     LEFT JOIN pegawai pg ON pg.id = i.penanggung_jawab_pegawai_id
     ${whereSql}
     ORDER BY p.tahun DESC, p.tanggal_mulai DESC, i.nama_iku ASC`, params);
    return (0, http_1.sendSuccess)(res, rows);
});
exports.createIkuSatker = (0, http_1.asyncHandler)(async (req, res) => {
    await ensurePlanningSchema();
    const payload = normalizeIkuPayload(req.body || {});
    await ensureRecordExists("kinerja_periode", payload.periodeId, "Periode kinerja");
    if (payload.satuanId)
        await ensureRecordExists("kinerja_satuan", payload.satuanId, "Satuan");
    if (payload.penanggungJawabPegawaiId)
        await ensureRecordExists("pegawai", payload.penanggungJawabPegawaiId, "Pegawai penanggung jawab");
    const [result] = await database_1.pool.query(`INSERT INTO kinerja_iku_satker (periode_id, sasaran_strategis, nama_iku, definisi, formula, target, satuan_id, bobot, sumber_data, penanggung_jawab_pegawai_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [payload.periodeId, payload.sasaranStrategis, payload.namaIku, payload.definisi || null, payload.formula || null, payload.target, payload.satuanId, payload.bobot, payload.sumberData || null, payload.penanggungJawabPegawaiId, payload.status]);
    return (0, http_1.sendSuccess)(res, { id: result.insertId }, "IKU Satker berhasil ditambahkan", 201);
});
exports.updateIkuSatker = (0, http_1.asyncHandler)(async (req, res) => {
    await ensurePlanningSchema();
    const id = (0, validation_1.readPositiveId)(req.params.id, "IKU Satker");
    const payload = normalizeIkuPayload(req.body || {});
    await ensureRecordExists("kinerja_iku_satker", id, "IKU Satker");
    await ensureRecordExists("kinerja_periode", payload.periodeId, "Periode kinerja");
    if (payload.satuanId)
        await ensureRecordExists("kinerja_satuan", payload.satuanId, "Satuan");
    if (payload.penanggungJawabPegawaiId)
        await ensureRecordExists("pegawai", payload.penanggungJawabPegawaiId, "Pegawai penanggung jawab");
    await database_1.pool.query(`UPDATE kinerja_iku_satker
     SET periode_id = ?, sasaran_strategis = ?, nama_iku = ?, definisi = ?, formula = ?, target = ?, satuan_id = ?, bobot = ?, sumber_data = ?, penanggung_jawab_pegawai_id = ?, status = ?
     WHERE id = ?`, [payload.periodeId, payload.sasaranStrategis, payload.namaIku, payload.definisi || null, payload.formula || null, payload.target, payload.satuanId, payload.bobot, payload.sumberData || null, payload.penanggungJawabPegawaiId, payload.status, id]);
    return (0, http_1.sendSuccess)(res, null, "IKU Satker berhasil diperbarui");
});
exports.deleteIkuSatker = (0, http_1.asyncHandler)(async (req, res) => {
    await ensurePlanningSchema();
    const id = (0, validation_1.readPositiveId)(req.params.id, "IKU Satker");
    const [result] = await database_1.pool.query(`DELETE FROM kinerja_iku_satker WHERE id = ?`, [id]);
    if (!result.affectedRows)
        (0, http_1.fail)("IKU Satker tidak ditemukan", 404);
    return (0, http_1.sendSuccess)(res, null, "IKU Satker berhasil dihapus");
});
exports.getCascadingIku = (0, http_1.asyncHandler)(async (req, res) => {
    await ensurePlanningSchema();
    const conditions = [];
    const params = [];
    if (req.query.ikuSatkerId) {
        conditions.push("c.iku_satker_id = ?");
        params.push((0, validation_1.readPositiveId)(req.query.ikuSatkerId, "IKU Satker"));
    }
    if (req.query.status) {
        conditions.push("c.status = ?");
        params.push((0, validation_1.ensureOneOf)((0, validation_1.readTrimmedString)(req.query.status).toLowerCase(), planningStatuses, "Status"));
    }
    const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await database_1.pool.query(`SELECT c.id,
            c.iku_satker_id AS ikuSatkerId,
            i.nama_iku AS ikuSatkerNama,
            c.indikator_kinerja_id AS indikatorKinerjaId,
            ind.nama AS indikatorKinerjaNama,
            c.tim_kerja_id AS timKerjaId,
            COALESCE(t.nama_tim, '-') AS timKerjaNama,
            c.pegawai_id AS pegawaiId,
            COALESCE(p.nama_lengkap, '-') AS pegawaiNama,
            c.persentase_kontribusi AS persentaseKontribusi,
            COALESCE(c.catatan, '') AS catatan,
            c.status
     FROM kinerja_cascading_iku c
     INNER JOIN kinerja_iku_satker i ON i.id = c.iku_satker_id
     INNER JOIN indikator_kinerja ind ON ind.id = c.indikator_kinerja_id
     LEFT JOIN kinerja_tim_kerja t ON t.id = c.tim_kerja_id
     LEFT JOIN pegawai p ON p.id = c.pegawai_id
     ${whereSql}
     ORDER BY i.nama_iku ASC, ind.nama ASC`, params);
    return (0, http_1.sendSuccess)(res, rows);
});
exports.createCascadingIku = (0, http_1.asyncHandler)(async (req, res) => {
    await ensurePlanningSchema();
    const payload = normalizeCascadingPayload(req.body || {});
    await ensureRecordExists("kinerja_iku_satker", payload.ikuSatkerId, "IKU Satker");
    await ensureRecordExists("indikator_kinerja", payload.indikatorKinerjaId, "Indikator kinerja");
    if (payload.timKerjaId)
        await ensureRecordExists("kinerja_tim_kerja", payload.timKerjaId, "Tim kerja");
    if (payload.pegawaiId)
        await ensureRecordExists("pegawai", payload.pegawaiId, "Pegawai");
    const [result] = await database_1.pool.query(`INSERT INTO kinerja_cascading_iku (iku_satker_id, indikator_kinerja_id, tim_kerja_id, pegawai_id, persentase_kontribusi, catatan, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`, [payload.ikuSatkerId, payload.indikatorKinerjaId, payload.timKerjaId, payload.pegawaiId, payload.persentaseKontribusi, payload.catatan || null, payload.status]);
    return (0, http_1.sendSuccess)(res, { id: result.insertId }, "Cascading IKU berhasil ditambahkan", 201);
});
exports.updateCascadingIku = (0, http_1.asyncHandler)(async (req, res) => {
    await ensurePlanningSchema();
    const id = (0, validation_1.readPositiveId)(req.params.id, "Cascading IKU");
    const payload = normalizeCascadingPayload(req.body || {});
    await ensureRecordExists("kinerja_cascading_iku", id, "Cascading IKU");
    await ensureRecordExists("kinerja_iku_satker", payload.ikuSatkerId, "IKU Satker");
    await ensureRecordExists("indikator_kinerja", payload.indikatorKinerjaId, "Indikator kinerja");
    if (payload.timKerjaId)
        await ensureRecordExists("kinerja_tim_kerja", payload.timKerjaId, "Tim kerja");
    if (payload.pegawaiId)
        await ensureRecordExists("pegawai", payload.pegawaiId, "Pegawai");
    await database_1.pool.query(`UPDATE kinerja_cascading_iku
     SET iku_satker_id = ?, indikator_kinerja_id = ?, tim_kerja_id = ?, pegawai_id = ?, persentase_kontribusi = ?, catatan = ?, status = ?
     WHERE id = ?`, [payload.ikuSatkerId, payload.indikatorKinerjaId, payload.timKerjaId, payload.pegawaiId, payload.persentaseKontribusi, payload.catatan || null, payload.status, id]);
    return (0, http_1.sendSuccess)(res, null, "Cascading IKU berhasil diperbarui");
});
exports.deleteCascadingIku = (0, http_1.asyncHandler)(async (req, res) => {
    await ensurePlanningSchema();
    const id = (0, validation_1.readPositiveId)(req.params.id, "Cascading IKU");
    const [result] = await database_1.pool.query(`DELETE FROM kinerja_cascading_iku WHERE id = ?`, [id]);
    if (!result.affectedRows)
        (0, http_1.fail)("Cascading IKU tidak ditemukan", 404);
    return (0, http_1.sendSuccess)(res, null, "Cascading IKU berhasil dihapus");
});
exports.getIkiPegawai = (0, http_1.asyncHandler)(async (req, res) => {
    await ensurePlanningSchema();
    const conditions = [];
    const params = [];
    if (req.query.periodeId) {
        conditions.push("i.periode_id = ?");
        params.push((0, validation_1.readPositiveId)(req.query.periodeId, "Periode kinerja"));
    }
    if (req.query.pegawaiId) {
        conditions.push("i.pegawai_id = ?");
        params.push((0, validation_1.readPositiveId)(req.query.pegawaiId, "Pegawai"));
    }
    if (req.query.status) {
        conditions.push("i.status = ?");
        params.push((0, validation_1.ensureOneOf)((0, validation_1.readTrimmedString)(req.query.status).toLowerCase(), ikiStatuses, "Status"));
    }
    const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await database_1.pool.query(`SELECT i.id,
            i.periode_id AS periodeId,
            p.nama_periode AS periodeNama,
            i.pegawai_id AS pegawaiId,
            pg.nama_lengkap AS pegawaiNama,
            i.tim_kerja_id AS timKerjaId,
            COALESCE(t.nama_tim, '-') AS timKerjaNama,
            i.indikator_kinerja_id AS indikatorKinerjaId,
            COALESCE(ind.nama, '-') AS indikatorKinerjaNama,
            i.nama_iki AS namaIki,
            i.target,
            i.satuan_id AS satuanId,
            COALESCE(s.nama_satuan, '-') AS satuanNama,
            i.bobot,
            COALESCE(i.metode_ukur, '') AS metodeUkur,
            COALESCE(i.sumber_bukti, '') AS sumberBukti,
            i.status
     FROM kinerja_iki_pegawai i
     INNER JOIN kinerja_periode p ON p.id = i.periode_id
     INNER JOIN pegawai pg ON pg.id = i.pegawai_id
     LEFT JOIN kinerja_tim_kerja t ON t.id = i.tim_kerja_id
     LEFT JOIN indikator_kinerja ind ON ind.id = i.indikator_kinerja_id
     LEFT JOIN kinerja_satuan s ON s.id = i.satuan_id
     ${whereSql}
     ORDER BY p.tahun DESC, pg.nama_lengkap ASC, i.nama_iki ASC`, params);
    return (0, http_1.sendSuccess)(res, rows);
});
exports.createIkiPegawai = (0, http_1.asyncHandler)(async (req, res) => {
    await ensurePlanningSchema();
    const payload = normalizeIkiPayload(req.body || {});
    await ensureRecordExists("kinerja_periode", payload.periodeId, "Periode kinerja");
    await ensureRecordExists("pegawai", payload.pegawaiId, "Pegawai");
    if (payload.timKerjaId)
        await ensureRecordExists("kinerja_tim_kerja", payload.timKerjaId, "Tim kerja");
    if (payload.indikatorKinerjaId)
        await ensureRecordExists("indikator_kinerja", payload.indikatorKinerjaId, "Indikator kinerja");
    if (payload.satuanId)
        await ensureRecordExists("kinerja_satuan", payload.satuanId, "Satuan");
    const [result] = await database_1.pool.query(`INSERT INTO kinerja_iki_pegawai (periode_id, pegawai_id, tim_kerja_id, indikator_kinerja_id, nama_iki, target, satuan_id, bobot, metode_ukur, sumber_bukti, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [payload.periodeId, payload.pegawaiId, payload.timKerjaId, payload.indikatorKinerjaId, payload.namaIki, payload.target, payload.satuanId, payload.bobot, payload.metodeUkur || null, payload.sumberBukti || null, payload.status]);
    return (0, http_1.sendSuccess)(res, { id: result.insertId }, "IKI pegawai berhasil ditambahkan", 201);
});
exports.updateIkiPegawai = (0, http_1.asyncHandler)(async (req, res) => {
    await ensurePlanningSchema();
    const id = (0, validation_1.readPositiveId)(req.params.id, "IKI pegawai");
    const payload = normalizeIkiPayload(req.body || {});
    await ensureRecordExists("kinerja_iki_pegawai", id, "IKI pegawai");
    await ensureRecordExists("kinerja_periode", payload.periodeId, "Periode kinerja");
    await ensureRecordExists("pegawai", payload.pegawaiId, "Pegawai");
    if (payload.timKerjaId)
        await ensureRecordExists("kinerja_tim_kerja", payload.timKerjaId, "Tim kerja");
    if (payload.indikatorKinerjaId)
        await ensureRecordExists("indikator_kinerja", payload.indikatorKinerjaId, "Indikator kinerja");
    if (payload.satuanId)
        await ensureRecordExists("kinerja_satuan", payload.satuanId, "Satuan");
    await database_1.pool.query(`UPDATE kinerja_iki_pegawai
     SET periode_id = ?, pegawai_id = ?, tim_kerja_id = ?, indikator_kinerja_id = ?, nama_iki = ?, target = ?, satuan_id = ?, bobot = ?, metode_ukur = ?, sumber_bukti = ?, status = ?
     WHERE id = ?`, [payload.periodeId, payload.pegawaiId, payload.timKerjaId, payload.indikatorKinerjaId, payload.namaIki, payload.target, payload.satuanId, payload.bobot, payload.metodeUkur || null, payload.sumberBukti || null, payload.status, id]);
    return (0, http_1.sendSuccess)(res, null, "IKI pegawai berhasil diperbarui");
});
const updateIkiStatus = async (id, nextStatus, allowedCurrent, successMessage) => {
    const [rows] = await database_1.pool.query(`SELECT id, status FROM kinerja_iki_pegawai WHERE id = ? LIMIT 1`, [id]);
    if (!rows.length)
        (0, http_1.fail)("IKI pegawai tidak ditemukan", 404);
    const currentStatus = String(rows[0].status || "draft");
    if (!allowedCurrent.includes(currentStatus)) {
        (0, http_1.fail)(`IKI pegawai tidak dapat diproses dari status ${currentStatus}`, 400);
    }
    await database_1.pool.query(`UPDATE kinerja_iki_pegawai SET status = ? WHERE id = ?`, [nextStatus, id]);
    return successMessage;
};
exports.submitIkiPegawai = (0, http_1.asyncHandler)(async (req, res) => {
    await ensurePlanningSchema();
    const id = (0, validation_1.readPositiveId)(req.params.id, "IKI pegawai");
    const message = await updateIkiStatus(id, "diajukan", ["draft", "revisi"], "IKI pegawai berhasil diajukan");
    return (0, http_1.sendSuccess)(res, null, message);
});
exports.approveIkiPegawai = (0, http_1.asyncHandler)(async (req, res) => {
    await ensurePlanningSchema();
    const id = (0, validation_1.readPositiveId)(req.params.id, "IKI pegawai");
    const message = await updateIkiStatus(id, "disetujui", ["diajukan"], "IKI pegawai berhasil disetujui");
    return (0, http_1.sendSuccess)(res, null, message);
});
exports.reviseIkiPegawai = (0, http_1.asyncHandler)(async (req, res) => {
    await ensurePlanningSchema();
    const id = (0, validation_1.readPositiveId)(req.params.id, "IKI pegawai");
    const message = await updateIkiStatus(id, "revisi", ["diajukan"], "IKI pegawai dikembalikan untuk revisi");
    return (0, http_1.sendSuccess)(res, null, message);
});
exports.lockIkiPegawai = (0, http_1.asyncHandler)(async (req, res) => {
    await ensurePlanningSchema();
    const id = (0, validation_1.readPositiveId)(req.params.id, "IKI pegawai");
    const message = await updateIkiStatus(id, "dikunci", ["disetujui"], "IKI pegawai berhasil dikunci");
    return (0, http_1.sendSuccess)(res, null, message);
});
exports.getTargetPeriodik = (0, http_1.asyncHandler)(async (req, res) => {
    await ensurePlanningSchema();
    const conditions = [];
    const params = [];
    if (req.query.ikiPegawaiId) {
        conditions.push("t.iki_pegawai_id = ?");
        params.push((0, validation_1.readPositiveId)(req.query.ikiPegawaiId, "IKI pegawai"));
    }
    const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await database_1.pool.query(`SELECT t.id,
            t.iki_pegawai_id AS ikiPegawaiId,
            i.nama_iki AS ikiNama,
            pg.nama_lengkap AS pegawaiNama,
            t.jenis_periode AS jenisPeriode,
            t.periode_ke AS periodeKe,
            DATE_FORMAT(t.tanggal_mulai, '%Y-%m-%d') AS tanggalMulai,
            DATE_FORMAT(t.tanggal_selesai, '%Y-%m-%d') AS tanggalSelesai,
            t.target,
            COALESCE(t.milestone, '') AS milestone,
            t.status
     FROM kinerja_target_periodik t
     INNER JOIN kinerja_iki_pegawai i ON i.id = t.iki_pegawai_id
     INNER JOIN pegawai pg ON pg.id = i.pegawai_id
     ${whereSql}
     ORDER BY pg.nama_lengkap ASC, i.nama_iki ASC, t.jenis_periode ASC, t.periode_ke ASC`, params);
    return (0, http_1.sendSuccess)(res, rows);
});
exports.createTargetPeriodik = (0, http_1.asyncHandler)(async (req, res) => {
    await ensurePlanningSchema();
    const payload = normalizeTargetPeriodikPayload(req.body || {});
    await ensureRecordExists("kinerja_iki_pegawai", payload.ikiPegawaiId, "IKI pegawai");
    const [result] = await database_1.pool.query(`INSERT INTO kinerja_target_periodik (iki_pegawai_id, jenis_periode, periode_ke, tanggal_mulai, tanggal_selesai, target, milestone, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [payload.ikiPegawaiId, payload.jenisPeriode, payload.periodeKe, payload.tanggalMulai, payload.tanggalSelesai, payload.target, payload.milestone || null, payload.status]);
    return (0, http_1.sendSuccess)(res, { id: result.insertId }, "Target periodik berhasil ditambahkan", 201);
});
exports.updateTargetPeriodik = (0, http_1.asyncHandler)(async (req, res) => {
    await ensurePlanningSchema();
    const id = (0, validation_1.readPositiveId)(req.params.id, "Target periodik");
    const payload = normalizeTargetPeriodikPayload(req.body || {});
    await ensureRecordExists("kinerja_target_periodik", id, "Target periodik");
    await ensureRecordExists("kinerja_iki_pegawai", payload.ikiPegawaiId, "IKI pegawai");
    await database_1.pool.query(`UPDATE kinerja_target_periodik
     SET iki_pegawai_id = ?, jenis_periode = ?, periode_ke = ?, tanggal_mulai = ?, tanggal_selesai = ?, target = ?, milestone = ?, status = ?
     WHERE id = ?`, [payload.ikiPegawaiId, payload.jenisPeriode, payload.periodeKe, payload.tanggalMulai, payload.tanggalSelesai, payload.target, payload.milestone || null, payload.status, id]);
    return (0, http_1.sendSuccess)(res, null, "Target periodik berhasil diperbarui");
});
const buildAutoPeriods = (year, jenis) => {
    if (jenis === "semester") {
        return [
            { periodeKe: 1, tanggalMulai: `${year}-01-01`, tanggalSelesai: `${year}-06-30` },
            { periodeKe: 2, tanggalMulai: `${year}-07-01`, tanggalSelesai: `${year}-12-31` }
        ];
    }
    if (jenis === "triwulan") {
        return [
            { periodeKe: 1, tanggalMulai: `${year}-01-01`, tanggalSelesai: `${year}-03-31` },
            { periodeKe: 2, tanggalMulai: `${year}-04-01`, tanggalSelesai: `${year}-06-30` },
            { periodeKe: 3, tanggalMulai: `${year}-07-01`, tanggalSelesai: `${year}-09-30` },
            { periodeKe: 4, tanggalMulai: `${year}-10-01`, tanggalSelesai: `${year}-12-31` }
        ];
    }
    return Array.from({ length: 12 }, (_, index) => {
        const month = index + 1;
        const start = new Date(Date.UTC(year, index, 1));
        const end = new Date(Date.UTC(year, month, 0));
        const pad = (value) => String(value).padStart(2, "0");
        return {
            periodeKe: month,
            tanggalMulai: `${year}-${pad(month)}-01`,
            tanggalSelesai: `${year}-${pad(month)}-${pad(end.getUTCDate())}`
        };
    });
};
exports.generateTargetPeriodik = (0, http_1.asyncHandler)(async (req, res) => {
    await ensurePlanningSchema();
    const ikiPegawaiId = (0, validation_1.readPositiveId)(req.body?.ikiPegawaiId, "IKI pegawai");
    const jenisPeriode = (0, validation_1.ensureOneOf)((0, validation_1.readTrimmedString)(req.body?.jenisPeriode || "bulanan").toLowerCase(), targetPeriodTypes, "Jenis periode");
    const [[ikiRow]] = await database_1.pool.query(`SELECT i.id, i.target, p.tahun
     FROM kinerja_iki_pegawai i
     INNER JOIN kinerja_periode p ON p.id = i.periode_id
     WHERE i.id = ? LIMIT 1`, [ikiPegawaiId]);
    if (!ikiRow)
        (0, http_1.fail)("IKI pegawai tidak ditemukan", 404);
    const [existing] = await database_1.pool.query(`SELECT id FROM kinerja_target_periodik WHERE iki_pegawai_id = ? AND jenis_periode = ? LIMIT 1`, [ikiPegawaiId, jenisPeriode]);
    if (existing.length) {
        (0, http_1.fail)("Target periodik untuk IKI dan jenis periode ini sudah ada", 400);
    }
    const totalTarget = ikiRow.target == null ? null : Number(ikiRow.target);
    const periods = buildAutoPeriods(Number(ikiRow.tahun), jenisPeriode);
    const splitTarget = totalTarget == null ? null : Number((totalTarget / periods.length).toFixed(2));
    await database_1.pool.query(`INSERT INTO kinerja_target_periodik (iki_pegawai_id, jenis_periode, periode_ke, tanggal_mulai, tanggal_selesai, target, milestone, status)
     VALUES ${periods.map(() => `(?, ?, ?, ?, ?, ?, ?, 'draft')`).join(", ")}`, periods.flatMap((period) => [ikiPegawaiId, jenisPeriode, period.periodeKe, period.tanggalMulai, period.tanggalSelesai, splitTarget, `Auto generate ${jenisPeriode} ${period.periodeKe}`]));
    return (0, http_1.sendSuccess)(res, { generated: periods.length }, "Target periodik otomatis berhasil dibuat", 201);
});
exports.getDialogAwal = (0, http_1.asyncHandler)(async (req, res) => {
    await ensurePlanningSchema();
    const conditions = [];
    const params = [];
    if (req.query.periodeId) {
        conditions.push("d.periode_id = ?");
        params.push((0, validation_1.readPositiveId)(req.query.periodeId, "Periode kinerja"));
    }
    if (req.query.pegawaiId) {
        conditions.push("d.pegawai_id = ?");
        params.push((0, validation_1.readPositiveId)(req.query.pegawaiId, "Pegawai"));
    }
    const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await database_1.pool.query(`SELECT d.id,
            d.periode_id AS periodeId,
            p.nama_periode AS periodeNama,
            d.pegawai_id AS pegawaiId,
            pg.nama_lengkap AS pegawaiNama,
            d.penilai_pegawai_id AS penilaiPegawaiId,
            pn.nama_lengkap AS penilaiNama,
            COALESCE(d.ringkasan_target, '') AS ringkasanTarget,
            COALESCE(d.ekspektasi_hasil, '') AS ekspektasiHasil,
            COALESCE(d.ekspektasi_perilaku, '') AS ekspektasiPerilaku,
            COALESCE(d.risiko, '') AS risiko,
            COALESCE(d.dukungan_dibutuhkan, '') AS dukunganDibutuhkan,
            COALESCE(d.catatan_dialog, '') AS catatanDialog,
            d.status
     FROM kinerja_dialog_awal d
     INNER JOIN kinerja_periode p ON p.id = d.periode_id
     INNER JOIN pegawai pg ON pg.id = d.pegawai_id
     INNER JOIN pegawai pn ON pn.id = d.penilai_pegawai_id
     ${whereSql}
     ORDER BY p.tahun DESC, pg.nama_lengkap ASC`, params);
    return (0, http_1.sendSuccess)(res, rows);
});
exports.createDialogAwal = (0, http_1.asyncHandler)(async (req, res) => {
    await ensurePlanningSchema();
    const payload = normalizeDialogPayload(req.body || {});
    await ensureRecordExists("kinerja_periode", payload.periodeId, "Periode kinerja");
    await ensureRecordExists("pegawai", payload.pegawaiId, "Pegawai");
    await ensureRecordExists("pegawai", payload.penilaiPegawaiId, "Penilai");
    const [result] = await database_1.pool.query(`INSERT INTO kinerja_dialog_awal (periode_id, pegawai_id, penilai_pegawai_id, ringkasan_target, ekspektasi_hasil, ekspektasi_perilaku, risiko, dukungan_dibutuhkan, catatan_dialog, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [payload.periodeId, payload.pegawaiId, payload.penilaiPegawaiId, payload.ringkasanTarget || null, payload.ekspektasiHasil || null, payload.ekspektasiPerilaku || null, payload.risiko || null, payload.dukunganDibutuhkan || null, payload.catatanDialog || null, payload.status]);
    return (0, http_1.sendSuccess)(res, { id: result.insertId }, "Dialog awal berhasil ditambahkan", 201);
});
exports.updateDialogAwal = (0, http_1.asyncHandler)(async (req, res) => {
    await ensurePlanningSchema();
    const id = (0, validation_1.readPositiveId)(req.params.id, "Dialog awal");
    const payload = normalizeDialogPayload(req.body || {});
    await ensureRecordExists("kinerja_dialog_awal", id, "Dialog awal");
    await ensureRecordExists("kinerja_periode", payload.periodeId, "Periode kinerja");
    await ensureRecordExists("pegawai", payload.pegawaiId, "Pegawai");
    await ensureRecordExists("pegawai", payload.penilaiPegawaiId, "Penilai");
    await database_1.pool.query(`UPDATE kinerja_dialog_awal
     SET periode_id = ?, pegawai_id = ?, penilai_pegawai_id = ?, ringkasan_target = ?, ekspektasi_hasil = ?, ekspektasi_perilaku = ?, risiko = ?, dukungan_dibutuhkan = ?, catatan_dialog = ?, status = ?
     WHERE id = ?`, [payload.periodeId, payload.pegawaiId, payload.penilaiPegawaiId, payload.ringkasanTarget || null, payload.ekspektasiHasil || null, payload.ekspektasiPerilaku || null, payload.risiko || null, payload.dukunganDibutuhkan || null, payload.catatanDialog || null, payload.status, id]);
    return (0, http_1.sendSuccess)(res, null, "Dialog awal berhasil diperbarui");
});
exports.approveDialogAwal = (0, http_1.asyncHandler)(async (req, res) => {
    await ensurePlanningSchema();
    const id = (0, validation_1.readPositiveId)(req.params.id, "Dialog awal");
    const [rows] = await database_1.pool.query(`SELECT id, status FROM kinerja_dialog_awal WHERE id = ? LIMIT 1`, [id]);
    if (!rows.length)
        (0, http_1.fail)("Dialog awal tidak ditemukan", 404);
    const currentStatus = String(rows[0].status || "draft");
    if (!["draft", "diajukan"].includes(currentStatus)) {
        (0, http_1.fail)(`Dialog awal tidak dapat disetujui dari status ${currentStatus}`, 400);
    }
    await database_1.pool.query(`UPDATE kinerja_dialog_awal SET status = 'disetujui' WHERE id = ?`, [id]);
    return (0, http_1.sendSuccess)(res, null, "Dialog awal berhasil disetujui");
});
