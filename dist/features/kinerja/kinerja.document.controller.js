"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.restoreKinerjaEvidence = exports.archiveKinerjaEvidence = exports.getKinerjaEvidenceVersions = exports.createKinerjaEvidenceVersion = exports.uploadNewKinerjaEvidence = void 0;
const database_1 = require("../../config/database");
const http_1 = require("../../shared/http");
const validation_1 = require("../../shared/validation");
const EVIDENCE_TYPES = ["foto", "pdf", "xlsx", "link", "surat_tugas", "draft_publikasi", "lainnya"];
const EVIDENCE_VERIFICATION_STATUSES = ["uploaded", "verified", "invalid"];
let documentSchemaReady = false;
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
const ensureDocumentSchema = async () => {
    if (documentSchemaReady)
        return;
    await ensureColumnExists("kinerja_logbook_bukti", "file_path", "file_path VARCHAR(255) NULL AFTER tautan_bukti");
    await ensureColumnExists("kinerja_logbook_bukti", "mime_type", "mime_type VARCHAR(120) NULL AFTER file_path");
    await ensureColumnExists("kinerja_logbook_bukti", "file_size", "file_size BIGINT NULL AFTER mime_type");
    await ensureColumnExists("kinerja_logbook_bukti", "original_file_name", "original_file_name VARCHAR(255) NULL AFTER file_size");
    await ensureColumnExists("kinerja_logbook_bukti", "current_version", "current_version INT NOT NULL DEFAULT 1 AFTER original_file_name");
    await ensureColumnExists("kinerja_logbook_bukti", "is_upload", "is_upload TINYINT(1) NOT NULL DEFAULT 0 AFTER current_version");
    await ensureColumnExists("kinerja_logbook_bukti", "is_archived", "is_archived TINYINT(1) NOT NULL DEFAULT 0 AFTER is_upload");
    await ensureColumnExists("kinerja_logbook_bukti", "archived_at", "archived_at TIMESTAMP NULL DEFAULT NULL AFTER is_archived");
    await ensureColumnExists("kinerja_logbook_bukti", "archived_by", "archived_by INT NULL AFTER archived_at");
    await ensureColumnExists("kinerja_logbook_bukti", "uploaded_by", "uploaded_by INT NULL AFTER archived_by");
    await ensureIndexExists("kinerja_logbook_bukti", "idx_kinerja_logbook_bukti_archived", "ALTER TABLE kinerja_logbook_bukti ADD INDEX idx_kinerja_logbook_bukti_archived (is_archived)");
    await ensureIndexExists("kinerja_logbook_bukti", "idx_kinerja_logbook_bukti_uploaded_by", "ALTER TABLE kinerja_logbook_bukti ADD INDEX idx_kinerja_logbook_bukti_uploaded_by (uploaded_by)");
    await ensureIndexExists("kinerja_logbook_bukti", "idx_kinerja_logbook_bukti_archived_by", "ALTER TABLE kinerja_logbook_bukti ADD INDEX idx_kinerja_logbook_bukti_archived_by (archived_by)");
    await ensureForeignKeyExists("kinerja_logbook_bukti", "fk_kinerja_logbook_bukti_uploaded_by", "ALTER TABLE kinerja_logbook_bukti ADD CONSTRAINT fk_kinerja_logbook_bukti_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES pegawai (id) ON DELETE SET NULL ON UPDATE CASCADE");
    await ensureForeignKeyExists("kinerja_logbook_bukti", "fk_kinerja_logbook_bukti_archived_by", "ALTER TABLE kinerja_logbook_bukti ADD CONSTRAINT fk_kinerja_logbook_bukti_archived_by FOREIGN KEY (archived_by) REFERENCES pegawai (id) ON DELETE SET NULL ON UPDATE CASCADE");
    await database_1.pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_logbook_bukti_versi (
      id INT NOT NULL AUTO_INCREMENT,
      bukti_id INT NOT NULL,
      versi_ke INT NOT NULL,
      jenis_bukti ENUM('foto','pdf','xlsx','link','surat_tugas','draft_publikasi','lainnya') NOT NULL DEFAULT 'link',
      nama_file VARCHAR(255) NOT NULL,
      original_file_name VARCHAR(255) NULL,
      tautan_bukti VARCHAR(255) NULL,
      file_path VARCHAR(255) NULL,
      mime_type VARCHAR(120) NULL,
      file_size BIGINT NULL,
      keterangan TEXT NULL,
      status_verifikasi ENUM('uploaded','verified','invalid') NOT NULL DEFAULT 'uploaded',
      uploaded_by INT NULL,
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
    await ensureIndexExists("kinerja_logbook_bukti_versi", "idx_kinerja_logbook_bukti_versi_bukti", "ALTER TABLE kinerja_logbook_bukti_versi ADD INDEX idx_kinerja_logbook_bukti_versi_bukti (bukti_id)");
    await ensureForeignKeyExists("kinerja_logbook_bukti_versi", "fk_kinerja_logbook_bukti_versi_bukti", "ALTER TABLE kinerja_logbook_bukti_versi ADD CONSTRAINT fk_kinerja_logbook_bukti_versi_bukti FOREIGN KEY (bukti_id) REFERENCES kinerja_logbook_bukti (id) ON DELETE CASCADE ON UPDATE CASCADE");
    await ensureForeignKeyExists("kinerja_logbook_bukti_versi", "fk_kinerja_logbook_bukti_versi_uploaded_by", "ALTER TABLE kinerja_logbook_bukti_versi ADD CONSTRAINT fk_kinerja_logbook_bukti_versi_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES pegawai (id) ON DELETE SET NULL ON UPDATE CASCADE");
    documentSchemaReady = true;
};
const buildAbsoluteUploadUrl = (req, value) => {
    if (!value)
        return "";
    if (/^https?:\/\//i.test(value))
        return value;
    return `${req.protocol}://${req.get("host")}${value.startsWith("/") ? value : `/${value}`}`;
};
const readOptionalPositiveId = (value, fieldName) => {
    if (value === undefined || value === null || value === "")
        return null;
    return (0, validation_1.readPositiveId)(value, fieldName);
};
const readEvidenceBody = (req) => {
    const body = (req.body || {});
    const evidenceType = (0, validation_1.ensureOneOf)((0, validation_1.readTrimmedString)(body.evidenceType || "link").toLowerCase(), EVIDENCE_TYPES, "Jenis bukti");
    const verificationStatus = (0, validation_1.ensureOneOf)((0, validation_1.readTrimmedString)(body.verificationStatus || "uploaded").toLowerCase(), EVIDENCE_VERIFICATION_STATUSES, "Status verifikasi");
    return {
        activityId: (0, validation_1.readPositiveId)(body.activityId, "Aktivitas"),
        evidenceType,
        fileName: (0, validation_1.readTrimmedString)(body.fileName),
        evidenceUrl: (0, validation_1.readTrimmedString)(body.evidenceUrl),
        note: (0, validation_1.readTrimmedString)(body.note),
        verificationStatus,
        uploadedBy: req.user?.employeeId ?? null
    };
};
const ensureEvidenceActivity = async (activityId) => {
    const [rows] = await database_1.pool.query(`SELECT id FROM kinerja_logbook WHERE id = ? LIMIT 1`, [activityId]);
    if (!rows.length)
        (0, http_1.fail)("Aktivitas tidak ditemukan", 404);
};
const getEvidenceRow = async (id) => {
    const [rows] = await database_1.pool.query(`SELECT b.*, l.tanggal_kegiatan AS activityDate, l.uraian_kegiatan AS activityName, p.nama_lengkap AS employeeName
     FROM kinerja_logbook_bukti b
     INNER JOIN kinerja_logbook l ON l.id = b.logbook_id
     LEFT JOIN pegawai p ON p.id = l.pegawai_id
     WHERE b.id = ?
     LIMIT 1`, [id]);
    if (!rows.length)
        (0, http_1.fail)("Bukti dukung tidak ditemukan", 404);
    return rows[0];
};
const buildEvidenceOutput = (req, row) => ({
    id: Number(row.id),
    activityId: Number(row.logbook_id || row.activityId),
    activityDate: row.activityDate ? String(row.activityDate).slice(0, 10) : "",
    employeeName: String(row.employeeName || "-"),
    activityName: String(row.activityName || "-"),
    evidenceType: String(row.jenis_bukti || row.evidenceType || "link"),
    fileName: String(row.nama_file || row.fileName || ""),
    originalFileName: row.original_file_name ? String(row.original_file_name) : "",
    evidenceUrl: String(row.tautan_bukti || row.evidenceUrl || ""),
    filePath: row.file_path ? String(row.file_path) : "",
    fileUrl: buildAbsoluteUploadUrl(req, row.file_path ? String(row.file_path) : null),
    note: String(row.keterangan || row.note || ""),
    verificationStatus: String(row.status_verifikasi || row.verificationStatus || "uploaded"),
    fileSize: row.file_size == null ? null : Number(row.file_size),
    mimeType: row.mime_type ? String(row.mime_type) : "",
    currentVersion: row.current_version == null ? 1 : Number(row.current_version),
    isUpload: Boolean(row.is_upload),
    isArchived: Boolean(row.is_archived),
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    createdAt: row.dibuat_pada ? String(row.dibuat_pada) : row.createdAt ? String(row.createdAt) : null,
    updatedAt: row.diperbarui_pada ? String(row.diperbarui_pada) : row.updatedAt ? String(row.updatedAt) : null
});
exports.uploadNewKinerjaEvidence = (0, http_1.asyncHandler)(async (req, res) => {
    await ensureDocumentSchema();
    const payload = readEvidenceBody(req);
    await ensureEvidenceActivity(payload.activityId);
    const uploadedFile = req.file;
    if (!uploadedFile && !payload.evidenceUrl) {
        (0, http_1.fail)("Unggah file atau isi tautan bukti", 400);
    }
    const displayName = payload.fileName || uploadedFile?.originalname || payload.evidenceUrl;
    const [result] = await database_1.pool.query(`INSERT INTO kinerja_logbook_bukti
      (logbook_id, jenis_bukti, nama_file, original_file_name, tautan_bukti, file_path, mime_type, file_size, keterangan, status_verifikasi, current_version, is_upload, is_archived, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, ?)`, [
        payload.activityId,
        payload.evidenceType,
        displayName,
        uploadedFile?.originalname || null,
        payload.evidenceUrl || null,
        uploadedFile ? `/uploads/kinerja-evidence/${uploadedFile.filename}` : null,
        uploadedFile?.mimetype || null,
        uploadedFile?.size || null,
        payload.note || null,
        payload.verificationStatus,
        uploadedFile ? 1 : 0,
        payload.uploadedBy
    ]);
    return (0, http_1.sendSuccess)(res, { id: result.insertId }, "Bukti dukung berhasil diunggah", 201);
});
exports.createKinerjaEvidenceVersion = (0, http_1.asyncHandler)(async (req, res) => {
    await ensureDocumentSchema();
    const id = (0, validation_1.readPositiveId)(req.params.id, "Bukti dukung");
    const current = await getEvidenceRow(id);
    const payload = readEvidenceBody(req);
    await ensureEvidenceActivity(payload.activityId);
    const uploadedFile = req.file;
    if (!uploadedFile && !payload.evidenceUrl) {
        (0, http_1.fail)("Unggah file atau isi tautan bukti versi baru", 400);
    }
    await database_1.pool.query(`INSERT INTO kinerja_logbook_bukti_versi
      (bukti_id, versi_ke, jenis_bukti, nama_file, original_file_name, tautan_bukti, file_path, mime_type, file_size, keterangan, status_verifikasi, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        id,
        Number(current.current_version || 1),
        current.jenis_bukti,
        current.nama_file,
        current.original_file_name,
        current.tautan_bukti,
        current.file_path,
        current.mime_type,
        current.file_size,
        current.keterangan,
        current.status_verifikasi,
        current.uploaded_by
    ]);
    const nextVersion = Number(current.current_version || 1) + 1;
    const displayName = payload.fileName || uploadedFile?.originalname || payload.evidenceUrl;
    await database_1.pool.query(`UPDATE kinerja_logbook_bukti
     SET logbook_id = ?,
         jenis_bukti = ?,
         nama_file = ?,
         original_file_name = ?,
         tautan_bukti = ?,
         file_path = ?,
         mime_type = ?,
         file_size = ?,
         keterangan = ?,
         status_verifikasi = ?,
         current_version = ?,
         is_upload = ?,
         is_archived = 0,
         archived_at = NULL,
         archived_by = NULL,
         uploaded_by = ?,
         diperbarui_pada = NOW()
     WHERE id = ?`, [
        payload.activityId,
        payload.evidenceType,
        displayName,
        uploadedFile?.originalname || null,
        payload.evidenceUrl || null,
        uploadedFile ? `/uploads/kinerja-evidence/${uploadedFile.filename}` : null,
        uploadedFile?.mimetype || null,
        uploadedFile?.size || null,
        payload.note || null,
        payload.verificationStatus,
        nextVersion,
        uploadedFile ? 1 : 0,
        payload.uploadedBy,
        id
    ]);
    return (0, http_1.sendSuccess)(res, null, "Versi baru bukti dukung berhasil disimpan");
});
exports.getKinerjaEvidenceVersions = (0, http_1.asyncHandler)(async (req, res) => {
    await ensureDocumentSchema();
    const id = (0, validation_1.readPositiveId)(req.params.id, "Bukti dukung");
    const current = await getEvidenceRow(id);
    const [rows] = await database_1.pool.query(`SELECT id,
            bukti_id AS evidenceId,
            versi_ke AS versionNumber,
            jenis_bukti AS evidenceType,
            nama_file AS fileName,
            original_file_name AS originalFileName,
            tautan_bukti AS evidenceUrl,
            file_path AS filePath,
            mime_type AS mimeType,
            file_size AS fileSize,
            keterangan AS note,
            status_verifikasi AS verificationStatus,
            dibuat_pada AS createdAt
     FROM kinerja_logbook_bukti_versi
     WHERE bukti_id = ?
     ORDER BY versi_ke DESC, id DESC`, [id]);
    const history = [
        {
            id: Number(current.id),
            evidenceId: Number(current.id),
            versionNumber: Number(current.current_version || 1),
            evidenceType: String(current.jenis_bukti || "link"),
            fileName: String(current.nama_file || ""),
            originalFileName: current.original_file_name ? String(current.original_file_name) : "",
            evidenceUrl: String(current.tautan_bukti || ""),
            filePath: current.file_path ? String(current.file_path) : "",
            fileUrl: buildAbsoluteUploadUrl(req, current.file_path ? String(current.file_path) : null),
            mimeType: current.mime_type ? String(current.mime_type) : "",
            fileSize: current.file_size == null ? null : Number(current.file_size),
            note: String(current.keterangan || ""),
            verificationStatus: String(current.status_verifikasi || "uploaded"),
            createdAt: current.diperbarui_pada ? String(current.diperbarui_pada) : null,
            isCurrent: true
        },
        ...rows.map((row) => ({
            id: Number(row.id),
            evidenceId: Number(row.evidenceId),
            versionNumber: Number(row.versionNumber),
            evidenceType: String(row.evidenceType || "link"),
            fileName: String(row.fileName || ""),
            originalFileName: String(row.originalFileName || ""),
            evidenceUrl: String(row.evidenceUrl || ""),
            filePath: String(row.filePath || ""),
            fileUrl: buildAbsoluteUploadUrl(req, row.filePath ? String(row.filePath) : null),
            mimeType: String(row.mimeType || ""),
            fileSize: row.fileSize == null ? null : Number(row.fileSize),
            note: String(row.note || ""),
            verificationStatus: String(row.verificationStatus || "uploaded"),
            createdAt: row.createdAt ? String(row.createdAt) : null,
            isCurrent: false
        }))
    ];
    return (0, http_1.sendSuccess)(res, history);
});
exports.archiveKinerjaEvidence = (0, http_1.asyncHandler)(async (req, res) => {
    await ensureDocumentSchema();
    const id = (0, validation_1.readPositiveId)(req.params.id, "Bukti dukung");
    const [result] = await database_1.pool.query(`UPDATE kinerja_logbook_bukti
     SET is_archived = 1,
         archived_at = NOW(),
         archived_by = ?,
         diperbarui_pada = NOW()
     WHERE id = ?`, [req.user?.employeeId ?? null, id]);
    if (!result.affectedRows)
        (0, http_1.fail)("Bukti dukung tidak ditemukan", 404);
    return (0, http_1.sendSuccess)(res, null, "Bukti dukung berhasil diarsipkan");
});
exports.restoreKinerjaEvidence = (0, http_1.asyncHandler)(async (req, res) => {
    await ensureDocumentSchema();
    const id = (0, validation_1.readPositiveId)(req.params.id, "Bukti dukung");
    const [result] = await database_1.pool.query(`UPDATE kinerja_logbook_bukti
     SET is_archived = 0,
         archived_at = NULL,
         archived_by = NULL,
         diperbarui_pada = NOW()
     WHERE id = ?`, [id]);
    if (!result.affectedRows)
        (0, http_1.fail)("Bukti dukung tidak ditemukan", 404);
    return (0, http_1.sendSuccess)(res, null, "Bukti dukung berhasil dipulihkan dari arsip");
});
