"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getKinerjaDailyWorkDashboard = exports.markAllKinerjaNotificationsAsRead = exports.markKinerjaNotificationAsRead = exports.getKinerjaNotifications = exports.rejectKinerjaTargetChange = exports.approveKinerjaTargetChange = exports.createKinerjaTargetChange = exports.getKinerjaTargetChanges = exports.markKinerjaFeedbackAsRead = exports.updateKinerjaFeedback = exports.createKinerjaFeedback = exports.getKinerjaFeedbacks = exports.getKinerjaRiskMonitoring = exports.getKinerjaRiskMonitoringDirect = exports.getKinerjaDashboardDiagnostics = exports.getKinerjaDashboardOverview = exports.getKinerjaBerandaDashboard = exports.getKinerjaAnalyticsFollowUpDirect = void 0;
const database_1 = require("../../config/database");
const http_1 = require("../../shared/http");
const kinerja_operational_controller_1 = require("./kinerja.operational.controller");
const kinerja_timer_helper_1 = require("./kinerja.timer.helper");
const validation_1 = require("../../shared/validation");
let managementSchemaReady = false;
const FEEDBACK_TYPES = ["apresiasi", "koreksi", "pembinaan"];
const READ_STATUSES = ["baru", "dibaca"];
const TARGET_CHANGE_STATUSES = ["diajukan", "disetujui", "ditolak"];
const RISK_LEVELS = ["rendah", "sedang", "tinggi"];
const readOptionalPositiveId = (value, fieldName) => {
    if (value === undefined || value === null || value === "")
        return null;
    return (0, validation_1.readPositiveId)(value, fieldName);
};
const readOptionalDateString = (value, fieldName) => {
    const normalized = (0, validation_1.readTrimmedString)(value);
    if (!normalized)
        return null;
    return (0, validation_1.readDateString)(normalized, fieldName);
};
const readOptionalMonth = (value) => {
    if (value === undefined || value === null || value === "")
        return null;
    return (0, validation_1.readIntegerInRange)(value, 1, 12, "Bulan");
};
const readOptionalYear = (value) => {
    if (value === undefined || value === null || value === "")
        return null;
    return (0, validation_1.readIntegerInRange)(value, 2020, 2100, "Tahun");
};
const ensureEmployeeExists = async (employeeId) => {
    const [rows] = await database_1.pool.query(`SELECT id FROM pegawai WHERE id = ? LIMIT 1`, [employeeId]);
    if (!rows.length)
        (0, http_1.fail)("Pegawai tidak ditemukan", 404);
};
const ensureIkiExists = async (ikiId) => {
    const [rows] = await database_1.pool.query(`SELECT id FROM kinerja_iki_pegawai WHERE id = ? LIMIT 1`, [ikiId]);
    if (!rows.length)
        (0, http_1.fail)("IKI pegawai tidak ditemukan", 404);
};
const ensureFeedbackExists = async (feedbackId) => {
    const [rows] = await database_1.pool.query(`SELECT id FROM kinerja_umpan_balik WHERE id = ? LIMIT 1`, [feedbackId]);
    if (!rows.length)
        (0, http_1.fail)("Umpan balik tidak ditemukan", 404);
};
const ensureTargetChangeExists = async (changeId) => {
    const [rows] = await database_1.pool.query(`SELECT id FROM kinerja_perubahan_target WHERE id = ? LIMIT 1`, [changeId]);
    if (!rows.length)
        (0, http_1.fail)("Perubahan target tidak ditemukan", 404);
};
const ensureNotificationExists = async (notificationId) => {
    const [rows] = await database_1.pool.query(`SELECT id FROM kinerja_notifikasi WHERE id = ? LIMIT 1`, [notificationId]);
    if (!rows.length)
        (0, http_1.fail)("Notifikasi tidak ditemukan", 404);
};
const createNotification = async (payload) => {
    if (!payload.employeeId)
        return;
    await database_1.pool.query(`INSERT INTO kinerja_notifikasi
      (pegawai_id, jenis_notifikasi, judul, isi, link_tujuan, referensi_tipe, referensi_id, status_baca)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'baru')`, [
        payload.employeeId,
        payload.type,
        payload.title,
        payload.content,
        payload.link,
        payload.referenceType || null,
        payload.referenceId || null
    ]);
};
const ensureManagementSchema = async () => {
    if (managementSchemaReady)
        return;
    await database_1.pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_umpan_balik (
      id INT NOT NULL AUTO_INCREMENT,
      periode_id INT NULL,
      pegawai_id INT NOT NULL,
      pemberi_feedback_id INT NOT NULL,
      indikator_kinerja_id INT NULL,
      assignment_id INT NULL,
      jenis_feedback ENUM('apresiasi','koreksi','pembinaan') NOT NULL DEFAULT 'koreksi',
      isi_feedback TEXT NOT NULL,
      tanggal_feedback DATE NOT NULL,
      status_baca ENUM('baru','dibaca') NOT NULL DEFAULT 'baru',
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_kinerja_umpan_balik_pegawai (pegawai_id),
      KEY idx_kinerja_umpan_balik_pemberi (pemberi_feedback_id),
      KEY idx_kinerja_umpan_balik_periode (periode_id),
      KEY idx_kinerja_umpan_balik_assignment (assignment_id),
      KEY idx_kinerja_umpan_balik_indikator (indikator_kinerja_id),
      CONSTRAINT fk_kinerja_umpan_balik_pegawai FOREIGN KEY (pegawai_id) REFERENCES pegawai (id) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT fk_kinerja_umpan_balik_pemberi FOREIGN KEY (pemberi_feedback_id) REFERENCES pegawai (id) ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT fk_kinerja_umpan_balik_periode FOREIGN KEY (periode_id) REFERENCES kinerja_periode (id) ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT fk_kinerja_umpan_balik_assignment FOREIGN KEY (assignment_id) REFERENCES kinerja_assignment (id) ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT fk_kinerja_umpan_balik_indikator FOREIGN KEY (indikator_kinerja_id) REFERENCES indikator_kinerja (id) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
    await database_1.pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_perubahan_target (
      id INT NOT NULL AUTO_INCREMENT,
      iki_pegawai_id INT NOT NULL,
      target_lama DECIMAL(18,2) NULL,
      target_baru DECIMAL(18,2) NULL,
      alasan TEXT NOT NULL,
      dampak_ke_nilai TEXT NULL,
      diajukan_oleh INT NOT NULL,
      diajukan_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diproses_oleh INT NULL,
      diproses_pada TIMESTAMP NULL DEFAULT NULL,
      catatan_persetujuan TEXT NULL,
      status ENUM('diajukan','disetujui','ditolak') NOT NULL DEFAULT 'diajukan',
      PRIMARY KEY (id),
      KEY idx_kinerja_perubahan_target_iki (iki_pegawai_id),
      KEY idx_kinerja_perubahan_target_pengaju (diajukan_oleh),
      KEY idx_kinerja_perubahan_target_pemroses (diproses_oleh),
      CONSTRAINT fk_kinerja_perubahan_target_iki FOREIGN KEY (iki_pegawai_id) REFERENCES kinerja_iki_pegawai (id) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT fk_kinerja_perubahan_target_pengaju FOREIGN KEY (diajukan_oleh) REFERENCES pegawai (id) ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT fk_kinerja_perubahan_target_pemroses FOREIGN KEY (diproses_oleh) REFERENCES pegawai (id) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
    await database_1.pool.query(`
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
      PRIMARY KEY (id),
      KEY idx_kinerja_notifikasi_pegawai (pegawai_id),
      KEY idx_kinerja_notifikasi_status (status_baca),
      CONSTRAINT fk_kinerja_notifikasi_pegawai FOREIGN KEY (pegawai_id) REFERENCES pegawai (id) ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
    managementSchemaReady = true;
};
const normalizeFeedbackPayload = (body) => ({
    periodeId: readOptionalPositiveId(body.periodeId, "Periode kinerja"),
    pegawaiId: (0, validation_1.readPositiveId)(body.pegawaiId, "Pegawai penerima"),
    pemberiFeedbackId: (0, validation_1.readPositiveId)(body.pemberiFeedbackId, "Pemberi umpan balik"),
    indikatorKinerjaId: readOptionalPositiveId(body.indikatorKinerjaId, "Indikator kinerja"),
    assignmentId: readOptionalPositiveId(body.assignmentId, "Penugasan"),
    feedbackType: (0, validation_1.ensureOneOf)((0, validation_1.readTrimmedString)(body.feedbackType || "koreksi").toLowerCase(), FEEDBACK_TYPES, "Jenis umpan balik"),
    content: (0, validation_1.ensureRequired)((0, validation_1.readTrimmedString)(body.content), "Isi umpan balik wajib diisi"),
    feedbackDate: (0, validation_1.readDateString)(body.feedbackDate, "Tanggal umpan balik"),
    readStatus: (0, validation_1.ensureOneOf)((0, validation_1.readTrimmedString)(body.readStatus || "baru").toLowerCase(), READ_STATUSES, "Status baca")
});
const normalizeTargetChangePayload = (body, fallbackEmployeeId) => ({
    ikiPegawaiId: (0, validation_1.readPositiveId)(body.ikiPegawaiId, "IKI pegawai"),
    oldTarget: (0, validation_1.readNonNegativeNumber)(body.oldTarget, "Target lama", 0),
    newTarget: (0, validation_1.readNonNegativeNumber)(body.newTarget, "Target baru", 0),
    reason: (0, validation_1.ensureRequired)((0, validation_1.readTrimmedString)(body.reason), "Alasan perubahan target wajib diisi"),
    impactNote: (0, validation_1.readTrimmedString)(body.impactNote),
    requestedBy: readOptionalPositiveId(body.requestedBy, "Pengaju") || fallbackEmployeeId || 0,
    approvalNote: (0, validation_1.readTrimmedString)(body.approvalNote)
});
const buildFeedbackRecord = (row) => ({
    id: Number(row.id),
    periodeId: row.periodeId ? Number(row.periodeId) : null,
    periodeName: String(row.periodeName || "-"),
    pegawaiId: Number(row.pegawaiId),
    pegawaiName: String(row.pegawaiName || "-"),
    pemberiFeedbackId: Number(row.pemberiFeedbackId),
    pemberiFeedbackName: String(row.pemberiFeedbackName || "-"),
    indikatorKinerjaId: row.indikatorKinerjaId ? Number(row.indikatorKinerjaId) : null,
    indikatorKinerjaName: String(row.indikatorKinerjaName || "-"),
    assignmentId: row.assignmentId ? Number(row.assignmentId) : null,
    assignmentTitle: String(row.assignmentTitle || "-"),
    feedbackType: String(row.feedbackType || "koreksi"),
    content: String(row.content || ""),
    feedbackDate: String(row.feedbackDate || ""),
    readStatus: String(row.readStatus || "baru"),
    createdAt: row.createdAt ? String(row.createdAt) : null,
    updatedAt: row.updatedAt ? String(row.updatedAt) : null
});
const buildTargetChangeRecord = (row) => ({
    id: Number(row.id),
    ikiPegawaiId: Number(row.ikiPegawaiId),
    ikiName: String(row.ikiName || "-"),
    pegawaiId: Number(row.pegawaiId),
    pegawaiName: String(row.pegawaiName || "-"),
    periodeId: row.periodeId ? Number(row.periodeId) : null,
    periodeName: String(row.periodeName || "-"),
    oldTarget: row.oldTarget == null ? null : Number(row.oldTarget),
    newTarget: row.newTarget == null ? null : Number(row.newTarget),
    reason: String(row.reason || ""),
    impactNote: String(row.impactNote || ""),
    requestedBy: Number(row.requestedBy),
    requestedByName: String(row.requestedByName || "-"),
    requestedAt: String(row.requestedAt || ""),
    processedBy: row.processedBy ? Number(row.processedBy) : null,
    processedByName: String(row.processedByName || "-"),
    processedAt: row.processedAt ? String(row.processedAt) : null,
    approvalNote: String(row.approvalNote || ""),
    status: String(row.status || "diajukan")
});
const buildNotificationRecord = (row) => ({
    id: Number(row.id),
    pegawaiId: Number(row.pegawaiId),
    pegawaiName: String(row.pegawaiName || "-"),
    notificationType: String(row.notificationType || "informasi"),
    title: String(row.title || ""),
    content: String(row.content || ""),
    targetLink: String(row.targetLink || ""),
    referenceType: String(row.referenceType || ""),
    referenceId: row.referenceId ? Number(row.referenceId) : null,
    readStatus: String(row.readStatus || "baru"),
    createdAt: row.createdAt ? String(row.createdAt) : null,
    updatedAt: row.updatedAt ? String(row.updatedAt) : null
});
const buildRiskQuery = (filters) => {
    const conditions = ["1 = 1"];
    const params = [];
    if (filters.periodId) {
        conditions.push("iki.periode_id = ?");
        params.push(filters.periodId);
    }
    if (filters.year) {
        conditions.push("kp.tahun = ?");
        params.push(filters.year);
    }
    if (filters.teamId) {
        conditions.push("iki.tim_kerja_id = ?");
        params.push(filters.teamId);
    }
    if (filters.employeeId) {
        conditions.push("iki.pegawai_id = ?");
        params.push(filters.employeeId);
    }
    if (filters.search) {
        conditions.push("(p.nama_lengkap LIKE ? OR iki.nama_iki LIKE ? OR COALESCE(tk.nama_tim,'') LIKE ?)");
        params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
    }
    const realizationConditions = ["1 = 1"];
    const realizationParams = [];
    if (filters.month) {
        realizationConditions.push("MONTH(tanggal_lapor) = ?");
        realizationParams.push(filters.month);
    }
    if (filters.year) {
        realizationConditions.push("YEAR(tanggal_lapor) = ?");
        realizationParams.push(filters.year);
    }
    const feedbackConditions = ["1 = 1"];
    const feedbackParams = [];
    if (filters.month) {
        feedbackConditions.push("MONTH(tanggal_feedback) = ?");
        feedbackParams.push(filters.month);
    }
    if (filters.year) {
        feedbackConditions.push("YEAR(tanggal_feedback) = ?");
        feedbackParams.push(filters.year);
    }
    const changeConditions = ["1 = 1"];
    const changeParams = [];
    if (filters.month) {
        changeConditions.push("MONTH(diajukan_pada) = ?");
        changeParams.push(filters.month);
    }
    if (filters.year) {
        changeConditions.push("YEAR(diajukan_pada) = ?");
        changeParams.push(filters.year);
    }
    const achievementExpression = `
    CASE
      WHEN COALESCE(iki.target, 0) > 0
      THEN (COALESCE(real_data.total_realisasi, 0) / iki.target) * 100
      ELSE 0
    END
  `;
    const totalFeedbackExpression = `
    COALESCE(feed_specific.total_feedback, 0) + COALESCE(feed_general.total_feedback, 0)
  `;
    const unreadFeedbackExpression = `
    COALESCE(feed_specific.unread_feedback, 0) + COALESCE(feed_general.unread_feedback, 0)
  `;
    const riskLevelExpression = `
    CASE
      WHEN (${achievementExpression}) < 50
        OR COALESCE(ch.pending_changes, 0) > 0
        OR (${unreadFeedbackExpression}) >= 2
      THEN 'tinggi'
      WHEN (${achievementExpression}) < 80
        OR (${unreadFeedbackExpression}) > 0
      THEN 'sedang'
      ELSE 'rendah'
    END
  `;
    const riskLevelCondition = filters.riskLevel ? `HAVING riskLevel = ?` : "";
    const riskLevelParams = filters.riskLevel ? [filters.riskLevel] : [];
    const sql = `
    SELECT
      iki.id,
      iki.pegawai_id AS pegawaiId,
      p.nama_lengkap AS pegawaiName,
      iki.tim_kerja_id AS timKerjaId,
      COALESCE(tk.nama_tim, '-') AS timKerjaName,
      iki.periode_id AS periodeId,
      COALESCE(kp.nama_periode, '-') AS periodeName,
      iki.nama_iki AS ikiName,
      iki.target,
      COALESCE(real_data.total_realisasi, 0) AS realization,
      ROUND(${achievementExpression}, 2) AS achievementPercentage,
      DATE_FORMAT(real_data.latest_report_date, '%Y-%m-%d') AS latestReportDate,
      ${totalFeedbackExpression} AS totalFeedback,
      ${unreadFeedbackExpression} AS unreadFeedback,
      COALESCE(ch.total_changes, 0) AS totalTargetChanges,
      COALESCE(ch.pending_changes, 0) AS pendingTargetChanges,
      ${riskLevelExpression} AS riskLevel,
      CASE
        WHEN COALESCE(ch.pending_changes, 0) > 0
          THEN 'Selesaikan usulan perubahan target sebelum evaluasi berikutnya.'
        WHEN (${achievementExpression}) < 50
          THEN 'Segera lakukan dialog kinerja dan koreksi rencana kerja.'
        WHEN (${unreadFeedbackExpression}) >= 2
          THEN 'Tindak lanjuti seluruh umpan balik yang belum dibaca.'
        WHEN (${achievementExpression}) < 80
          THEN 'Perkuat monitoring mingguan sampai capaian minimal 80%.'
        WHEN (${unreadFeedbackExpression}) > 0
          THEN 'Pastikan umpan balik atasan dibaca dan ditindaklanjuti.'
        ELSE 'Lanjutkan ritme kerja dan jaga konsistensi realisasi.'
      END AS recommendation
    FROM kinerja_iki_pegawai iki
    INNER JOIN pegawai p ON p.id = iki.pegawai_id
    LEFT JOIN kinerja_tim_kerja tk ON tk.id = iki.tim_kerja_id
    LEFT JOIN kinerja_periode kp ON kp.id = iki.periode_id
    LEFT JOIN (
      SELECT iki_pegawai_id,
             SUM(CASE WHEN status IN ('submitted','verified','corrected','finalized') THEN COALESCE(realisasi, 0) ELSE 0 END) AS total_realisasi,
             MAX(tanggal_lapor) AS latest_report_date
      FROM kinerja_realisasi_indikator
      WHERE ${realizationConditions.join(" AND ")}
      GROUP BY iki_pegawai_id
    ) real_data ON real_data.iki_pegawai_id = iki.id
    LEFT JOIN (
      SELECT pegawai_id,
             indikator_kinerja_id,
             COUNT(*) AS total_feedback,
             SUM(CASE WHEN status_baca = 'baru' THEN 1 ELSE 0 END) AS unread_feedback
      FROM kinerja_umpan_balik
      WHERE ${feedbackConditions.join(" AND ")}
        AND indikator_kinerja_id IS NOT NULL
      GROUP BY pegawai_id, indikator_kinerja_id
    ) feed_specific
      ON feed_specific.pegawai_id = iki.pegawai_id
      AND feed_specific.indikator_kinerja_id = iki.indikator_kinerja_id
    LEFT JOIN (
      SELECT pegawai_id,
             COUNT(*) AS total_feedback,
             SUM(CASE WHEN status_baca = 'baru' THEN 1 ELSE 0 END) AS unread_feedback
      FROM kinerja_umpan_balik
      WHERE ${feedbackConditions.join(" AND ")}
        AND indikator_kinerja_id IS NULL
      GROUP BY pegawai_id
    ) feed_general ON feed_general.pegawai_id = iki.pegawai_id
    LEFT JOIN (
      SELECT iki_pegawai_id,
             COUNT(*) AS total_changes,
             SUM(CASE WHEN pt.status = 'diajukan' THEN 1 ELSE 0 END) AS pending_changes
      FROM kinerja_perubahan_target
      WHERE ${changeConditions.join(" AND ")}
      GROUP BY iki_pegawai_id
    ) ch ON ch.iki_pegawai_id = iki.id
    WHERE ${conditions.join(" AND ")}
    ${riskLevelCondition}
    ORDER BY FIELD(riskLevel, 'tinggi', 'sedang', 'rendah'), achievementPercentage ASC, p.nama_lengkap ASC
  `;
    return {
        sql,
        params: [
            ...realizationParams,
            ...feedbackParams,
            ...feedbackParams,
            ...changeParams,
            ...params,
            ...riskLevelParams
        ]
    };
};
exports.getKinerjaAnalyticsFollowUpDirect = (0, http_1.asyncHandler)(async (req, res) => {
    await ensureManagementSchema();
    const year = readOptionalYear(req.query.year);
    const month = readOptionalMonth(req.query.month);
    const teamId = req.query.teamId ? (0, validation_1.readPositiveId)(req.query.teamId, "Tim kerja") : null;
    const employeeId = req.query.employeeId ? (0, validation_1.readPositiveId)(req.query.employeeId, "Pegawai") : null;
    const search = (0, validation_1.readTrimmedString)(req.query.search);
    const conditions = ["1 = 1"];
    const params = [];
    if (year) {
        conditions.push("kp.tahun = ?");
        params.push(year);
    }
    if (teamId) {
        conditions.push("iki.tim_kerja_id = ?");
        params.push(teamId);
    }
    if (employeeId) {
        conditions.push("iki.pegawai_id = ?");
        params.push(employeeId);
    }
    if (search) {
        conditions.push("(p.nama_lengkap LIKE ? OR iki.nama_iki LIKE ? OR COALESCE(tk.nama_tim, '') LIKE ?)");
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const realizationConditions = ["1 = 1"];
    const realizationParams = [];
    if (year) {
        realizationConditions.push("YEAR(tanggal_lapor) = ?");
        realizationParams.push(year);
    }
    if (month) {
        realizationConditions.push("MONTH(tanggal_lapor) = ?");
        realizationParams.push(month);
    }
    const feedbackConditions = ["1 = 1"];
    const feedbackParams = [];
    if (year) {
        feedbackConditions.push("YEAR(tanggal_feedback) = ?");
        feedbackParams.push(year);
    }
    if (month) {
        feedbackConditions.push("MONTH(tanggal_feedback) = ?");
        feedbackParams.push(month);
    }
    const changeConditions = ["1 = 1"];
    const changeParams = [];
    if (year) {
        changeConditions.push("YEAR(diajukan_pada) = ?");
        changeParams.push(year);
    }
    if (month) {
        changeConditions.push("MONTH(diajukan_pada) = ?");
        changeParams.push(month);
    }
    const achievementExpression = `
    CASE
      WHEN COALESCE(iki.target, 0) > 0
      THEN (COALESCE(real_data.total_realisasi, 0) / iki.target) * 100
      ELSE 0
    END
  `;
    const totalFeedbackExpression = `
    COALESCE(feed_specific.total_feedback, 0) + COALESCE(feed_general.total_feedback, 0)
  `;
    const unreadFeedbackExpression = `
    COALESCE(feed_specific.unread_feedback, 0) + COALESCE(feed_general.unread_feedback, 0)
  `;
    const [rows] = await database_1.pool.query(`SELECT
        iki.id,
        iki.pegawai_id AS employeeId,
        p.nama_lengkap AS employeeName,
        COALESCE(p.nip, '') AS nip,
        COALESCE(p.nama_jabatan, '') AS positionName,
        iki.tim_kerja_id AS teamId,
        COALESCE(tk.nama_tim, '-') AS teamName,
        iki.periode_id AS periodId,
        COALESCE(kp.nama_periode, '-') AS periodName,
        kp.tahun AS year,
        iki.indikator_kinerja_id AS indicatorId,
        iki.nama_iki AS indicatorName,
        COALESCE(iki.target, 0) AS target,
        COALESCE(real_data.total_realisasi, 0) AS realization,
        ROUND(${achievementExpression}, 2) AS achievementPercentage,
        DATE_FORMAT(real_data.latest_report_date, '%Y-%m-%d') AS latestReportDate,
        ${totalFeedbackExpression} AS totalFeedback,
        ${unreadFeedbackExpression} AS unreadFeedback,
        COALESCE(ch.total_changes, 0) AS totalTargetChanges,
        COALESCE(ch.pending_changes, 0) AS pendingTargetChanges,
        CASE
          WHEN COALESCE(ch.pending_changes, 0) > 0
            OR (${achievementExpression}) < 50
            OR (${unreadFeedbackExpression}) >= 2
          THEN 'tinggi'
          WHEN (${achievementExpression}) < 80
            OR (${unreadFeedbackExpression}) > 0
          THEN 'sedang'
          ELSE 'rendah'
        END AS riskLevel
     FROM kinerja_iki_pegawai iki
     INNER JOIN pegawai p ON p.id = iki.pegawai_id
     LEFT JOIN kinerja_tim_kerja tk ON tk.id = iki.tim_kerja_id
     LEFT JOIN kinerja_periode kp ON kp.id = iki.periode_id
     LEFT JOIN (
       SELECT
          iki_pegawai_id,
          SUM(CASE WHEN status IN ('submitted','verified','corrected','finalized') THEN COALESCE(realisasi, 0) ELSE 0 END) AS total_realisasi,
          MAX(tanggal_lapor) AS latest_report_date
       FROM kinerja_realisasi_indikator
       WHERE ${realizationConditions.join(" AND ")}
       GROUP BY iki_pegawai_id
     ) real_data ON real_data.iki_pegawai_id = iki.id
     LEFT JOIN (
       SELECT
          pegawai_id,
          indikator_kinerja_id,
          COUNT(*) AS total_feedback,
          SUM(CASE WHEN status_baca = 'baru' THEN 1 ELSE 0 END) AS unread_feedback
       FROM kinerja_umpan_balik
       WHERE ${feedbackConditions.join(" AND ")}
         AND indikator_kinerja_id IS NOT NULL
       GROUP BY pegawai_id, indikator_kinerja_id
     ) feed_specific
       ON feed_specific.pegawai_id = iki.pegawai_id
       AND feed_specific.indikator_kinerja_id = iki.indikator_kinerja_id
     LEFT JOIN (
       SELECT
          pegawai_id,
          COUNT(*) AS total_feedback,
          SUM(CASE WHEN status_baca = 'baru' THEN 1 ELSE 0 END) AS unread_feedback
       FROM kinerja_umpan_balik
       WHERE ${feedbackConditions.join(" AND ")}
         AND indikator_kinerja_id IS NULL
       GROUP BY pegawai_id
     ) feed_general ON feed_general.pegawai_id = iki.pegawai_id
     LEFT JOIN (
       SELECT
          iki_pegawai_id,
          COUNT(*) AS total_changes,
          SUM(CASE WHEN pt.status = 'diajukan' THEN 1 ELSE 0 END) AS pending_changes
       FROM kinerja_perubahan_target pt
       WHERE ${changeConditions.join(" AND ")}
       GROUP BY iki_pegawai_id
     ) ch ON ch.iki_pegawai_id = iki.id
     WHERE ${conditions.join(" AND ")}
     ORDER BY achievementPercentage DESC, p.nama_lengkap ASC, iki.nama_iki ASC
     LIMIT 1000`, [
        ...realizationParams,
        ...feedbackParams,
        ...feedbackParams,
        ...changeParams,
        ...params
    ]);
    const records = rows.map((row) => ({
        id: Number(row.id),
        employeeId: Number(row.employeeId),
        employeeName: String(row.employeeName || "-"),
        nip: String(row.nip || "-"),
        positionName: String(row.positionName || "-"),
        teamId: row.teamId ? Number(row.teamId) : null,
        teamName: String(row.teamName || "-"),
        periodId: row.periodId ? Number(row.periodId) : null,
        periodName: String(row.periodName || "-"),
        year: row.year ? Number(row.year) : null,
        indicatorId: row.indicatorId ? Number(row.indicatorId) : null,
        indicatorName: String(row.indicatorName || "-"),
        target: Number(row.target || 0),
        realization: Number(row.realization || 0),
        achievementPercentage: Number(row.achievementPercentage || 0),
        latestReportDate: row.latestReportDate ? String(row.latestReportDate) : null,
        totalFeedback: Number(row.totalFeedback || 0),
        unreadFeedback: Number(row.unreadFeedback || 0),
        totalTargetChanges: Number(row.totalTargetChanges || 0),
        pendingTargetChanges: Number(row.pendingTargetChanges || 0),
        riskLevel: String(row.riskLevel || "rendah")
    }));
    const totalIki = records.length;
    const totalRealization = records.reduce((sum, item) => sum + item.realization, 0);
    const averageAchievement = totalIki
        ? Number((records.reduce((sum, item) => sum + item.achievementPercentage, 0) / totalIki).toFixed(2))
        : 0;
    const highRisk = records.filter((item) => item.riskLevel === "tinggi").length;
    const mediumRisk = records.filter((item) => item.riskLevel === "sedang").length;
    const lowRisk = records.filter((item) => item.riskLevel === "rendah").length;
    const teamMap = new Map();
    const employeeMap = new Map();
    const indicatorMap = new Map();
    for (const item of records) {
        const teamKey = item.teamId || 0;
        const currentTeam = teamMap.get(teamKey) || {
            id: teamKey,
            teamName: item.teamName,
            totalIndicators: 0,
            totalRealization: 0,
            totalAchievement: 0,
            highRisk: 0,
            mediumRisk: 0,
            lowRisk: 0,
            employees: new Set()
        };
        currentTeam.totalIndicators += 1;
        currentTeam.totalRealization += item.realization;
        currentTeam.totalAchievement += item.achievementPercentage;
        currentTeam.highRisk += item.riskLevel === "tinggi" ? 1 : 0;
        currentTeam.mediumRisk += item.riskLevel === "sedang" ? 1 : 0;
        currentTeam.lowRisk += item.riskLevel === "rendah" ? 1 : 0;
        currentTeam.employees.add(item.employeeId);
        teamMap.set(teamKey, currentTeam);
        const currentEmployee = employeeMap.get(item.employeeId) || {
            employeeId: item.employeeId,
            employeeName: item.employeeName,
            nip: item.nip,
            positionName: item.positionName,
            teamName: item.teamName,
            totalIndicators: 0,
            totalRealization: 0,
            totalAchievement: 0,
            highRisk: 0,
            mediumRisk: 0,
            lowRisk: 0,
            unreadFeedback: 0,
            pendingTargetChanges: 0
        };
        currentEmployee.totalIndicators += 1;
        currentEmployee.totalRealization += item.realization;
        currentEmployee.totalAchievement += item.achievementPercentage;
        currentEmployee.highRisk += item.riskLevel === "tinggi" ? 1 : 0;
        currentEmployee.mediumRisk += item.riskLevel === "sedang" ? 1 : 0;
        currentEmployee.lowRisk += item.riskLevel === "rendah" ? 1 : 0;
        currentEmployee.unreadFeedback += item.unreadFeedback;
        currentEmployee.pendingTargetChanges += item.pendingTargetChanges;
        employeeMap.set(item.employeeId, currentEmployee);
        const indicatorKey = item.indicatorId || item.id;
        const currentIndicator = indicatorMap.get(indicatorKey) || {
            indicatorId: indicatorKey,
            indicatorName: item.indicatorName,
            teamName: item.teamName,
            totalEmployees: new Set(),
            target: 0,
            realization: 0,
            totalAchievement: 0,
            count: 0,
            highRisk: 0
        };
        currentIndicator.totalEmployees.add(item.employeeId);
        currentIndicator.target += item.target;
        currentIndicator.realization += item.realization;
        currentIndicator.totalAchievement += item.achievementPercentage;
        currentIndicator.count += 1;
        currentIndicator.highRisk += item.riskLevel === "tinggi" ? 1 : 0;
        indicatorMap.set(indicatorKey, currentIndicator);
    }
    const topTeams = Array.from(teamMap.values())
        .map((team) => ({
        id: Number(team.id),
        teamName: String(team.teamName || "-"),
        memberCount: team.employees.size,
        totalIndicators: Number(team.totalIndicators || 0),
        averageAchievement: team.totalIndicators ? Number((team.totalAchievement / team.totalIndicators).toFixed(2)) : 0,
        totalRealization: Number(team.totalRealization.toFixed(2)),
        highRisk: Number(team.highRisk || 0),
        mediumRisk: Number(team.mediumRisk || 0),
        lowRisk: Number(team.lowRisk || 0)
    }))
        .sort((a, b) => b.averageAchievement - a.averageAchievement);
    const employees = Array.from(employeeMap.values())
        .map((employee) => ({
        employeeId: Number(employee.employeeId),
        employeeName: String(employee.employeeName || "-"),
        nip: String(employee.nip || "-"),
        positionName: String(employee.positionName || "-"),
        teamName: String(employee.teamName || "-"),
        totalIndicators: Number(employee.totalIndicators || 0),
        averageAchievement: employee.totalIndicators ? Number((employee.totalAchievement / employee.totalIndicators).toFixed(2)) : 0,
        totalRealization: Number(employee.totalRealization.toFixed(2)),
        highRisk: Number(employee.highRisk || 0),
        mediumRisk: Number(employee.mediumRisk || 0),
        lowRisk: Number(employee.lowRisk || 0),
        unreadFeedback: Number(employee.unreadFeedback || 0),
        pendingTargetChanges: Number(employee.pendingTargetChanges || 0)
    }))
        .sort((a, b) => b.averageAchievement - a.averageAchievement);
    const scoreDistribution = [
        { label: "Sangat Baik (≥100%)", minimum: 100, maximum: null, total: records.filter((item) => item.achievementPercentage >= 100).length },
        { label: "Baik (80–99,99%)", minimum: 80, maximum: 99.99, total: records.filter((item) => item.achievementPercentage >= 80 && item.achievementPercentage < 100).length },
        { label: "Perlu Monitoring (50–79,99%)", minimum: 50, maximum: 79.99, total: records.filter((item) => item.achievementPercentage >= 50 && item.achievementPercentage < 80).length },
        { label: "Risiko Tinggi (<50%)", minimum: null, maximum: 49.99, total: records.filter((item) => item.achievementPercentage < 50).length }
    ].map((bucket) => ({
        ...bucket,
        percentage: totalIki ? Number(((bucket.total / totalIki) * 100).toFixed(2)) : 0
    }));
    const workloads = employees
        .map((employee) => ({
        ...employee,
        workloadIndex: Number((employee.totalIndicators * 10 + employee.highRisk * 15 + employee.unreadFeedback * 2 + employee.pendingTargetChanges * 8).toFixed(2)),
        workloadLabel: employee.highRisk > 0 || employee.pendingTargetChanges > 0
            ? "Prioritas tinggi"
            : employee.totalIndicators >= 4
                ? "Padat"
                : "Normal"
    }))
        .sort((a, b) => b.workloadIndex - a.workloadIndex);
    const contributions = Array.from(indicatorMap.values())
        .map((item) => ({
        indicatorId: Number(item.indicatorId),
        indicatorName: String(item.indicatorName || "-"),
        teamName: String(item.teamName || "-"),
        totalEmployees: item.totalEmployees.size,
        target: Number(item.target.toFixed(2)),
        realization: Number(item.realization.toFixed(2)),
        averageAchievement: item.count ? Number((item.totalAchievement / item.count).toFixed(2)) : 0,
        contributionShare: totalRealization ? Number(((item.realization / totalRealization) * 100).toFixed(2)) : 0,
        highRisk: Number(item.highRisk || 0)
    }))
        .sort((a, b) => b.contributionShare - a.contributionShare);
    const rewardRecommendations = employees
        .filter((employee) => employee.averageAchievement >= 95 && employee.highRisk === 0)
        .slice(0, 12)
        .map((employee, index) => ({
        id: index + 1,
        employeeId: employee.employeeId,
        employeeName: employee.employeeName,
        teamName: employee.teamName,
        recommendationType: employee.averageAchievement >= 110 ? "Penghargaan Kinerja Utama" : "Apresiasi Capaian Kinerja",
        reason: `Rata-rata capaian ${employee.averageAchievement}% dengan ${employee.totalIndicators} IKI dipantau.`,
        priority: employee.averageAchievement >= 110 ? "tinggi" : "sedang",
        status: "direkomendasikan",
        score: employee.averageAchievement
    }));
    const coachingRecommendations = employees
        .filter((employee) => employee.highRisk > 0 || employee.pendingTargetChanges > 0 || employee.averageAchievement < 80)
        .sort((a, b) => b.highRisk - a.highRisk || a.averageAchievement - b.averageAchievement)
        .slice(0, 12)
        .map((employee, index) => ({
        id: index + 1,
        employeeId: employee.employeeId,
        employeeName: employee.employeeName,
        teamName: employee.teamName,
        focus: employee.pendingTargetChanges > 0 ? "Penyelesaian perubahan target" : employee.highRisk > 0 ? "Pemulihan capaian IKI berisiko" : "Penguatan ritme realisasi",
        reason: `Capaian rata-rata ${employee.averageAchievement}%, risiko tinggi ${employee.highRisk}, perubahan target diajukan ${employee.pendingTargetChanges}.`,
        priority: employee.highRisk > 0 || employee.pendingTargetChanges > 0 ? "tinggi" : "sedang",
        status: "perlu_tindak_lanjut"
    }));
    const trainingRecommendations = employees
        .filter((employee) => employee.averageAchievement < 90 || employee.unreadFeedback > 0 || employee.mediumRisk > 0)
        .sort((a, b) => a.averageAchievement - b.averageAchievement)
        .slice(0, 12)
        .map((employee, index) => ({
        id: index + 1,
        employeeId: employee.employeeId,
        employeeName: employee.employeeName,
        teamName: employee.teamName,
        theme: employee.mediumRisk > 0 ? "Manajemen capaian dan mitigasi risiko" : "Penguatan penyusunan bukti dukung",
        competency: employee.unreadFeedback > 0 ? "Tindak lanjut umpan balik dan komunikasi kinerja" : "Perencanaan realisasi indikator",
        reason: `Capaian rata-rata ${employee.averageAchievement}% dengan ${employee.mediumRisk} risiko sedang dan ${employee.unreadFeedback} umpan balik belum dibaca.`,
        priority: employee.averageAchievement < 80 ? "tinggi" : "sedang",
        status: "direkomendasikan"
    }));
    const talentPool = employees
        .filter((employee) => employee.averageAchievement >= 85)
        .slice(0, 12)
        .map((employee, index) => ({
        id: index + 1,
        employeeId: employee.employeeId,
        employeeName: employee.employeeName,
        teamName: employee.teamName,
        category: employee.averageAchievement >= 105 ? "unggul" : employee.averageAchievement >= 95 ? "potensial" : "berkembang",
        readiness: employee.averageAchievement >= 100 && employee.highRisk === 0 ? "tinggi" : employee.averageAchievement >= 90 ? "menengah" : "dasar",
        reason: `Rata-rata capaian ${employee.averageAchievement}% dari ${employee.totalIndicators} IKI.`,
        score: employee.averageAchievement,
        status: "teridentifikasi"
    }));
    return (0, http_1.sendSuccess)(res, {
        summary: {
            totalIki,
            totalEmployees: employees.length,
            totalTeams: topTeams.length,
            totalRealization: Number(totalRealization.toFixed(2)),
            averageAchievement,
            highRisk,
            mediumRisk,
            lowRisk,
            totalRewardRecommendations: rewardRecommendations.length,
            totalCoachingRecommendations: coachingRecommendations.length,
            totalTrainingRecommendations: trainingRecommendations.length,
            totalTalentPool: talentPool.length
        },
        records,
        topTeams,
        topEmployees: employees.slice(0, 12),
        scoreDistribution,
        workloads,
        contributions,
        rewardRecommendations,
        coachingRecommendations,
        trainingRecommendations,
        talentPool
    });
});
exports.getKinerjaBerandaDashboard = (0, http_1.asyncHandler)(async (req, res) => {
    await ensureManagementSchema();
    const year = readOptionalYear(req.query.year);
    const month = readOptionalMonth(req.query.month);
    const teamId = req.query.teamId ? (0, validation_1.readPositiveId)(req.query.teamId, "Tim kerja") : null;
    const employeeId = req.query.employeeId ? (0, validation_1.readPositiveId)(req.query.employeeId, "Pegawai") : null;
    const ikiConditions = ["1 = 1"];
    const ikiParams = [];
    if (year) {
        ikiConditions.push("(kp.tahun = ? OR kp.tahun IS NULL)");
        ikiParams.push(year);
    }
    if (teamId) {
        ikiConditions.push("iki.tim_kerja_id = ?");
        ikiParams.push(teamId);
    }
    if (employeeId) {
        ikiConditions.push("iki.pegawai_id = ?");
        ikiParams.push(employeeId);
    }
    const realizationConditions = ["1 = 1"];
    const realizationParams = [];
    if (year) {
        realizationConditions.push("YEAR(tanggal_lapor) = ?");
        realizationParams.push(year);
    }
    if (month) {
        realizationConditions.push("MONTH(tanggal_lapor) = ?");
        realizationParams.push(month);
    }
    const [summaryRows] = await database_1.pool.query(`SELECT
        COUNT(DISTINCT iki.id) AS totalIki,
        COUNT(DISTINCT CASE WHEN iki.status IN ('disetujui','dikunci') THEN iki.id END) AS approvedIki,
        COUNT(DISTINCT iki.pegawai_id) AS totalEmployees,
        COUNT(DISTINCT iki.tim_kerja_id) AS totalTeams,
        COALESCE(SUM(COALESCE(real_data.total_realisasi, 0)), 0) AS totalRealization,
        ROUND(AVG(
          CASE
            WHEN COALESCE(iki.target, 0) > 0
            THEN (COALESCE(real_data.total_realisasi, 0) / iki.target) * 100
            ELSE 0
          END
        ), 2) AS averageAchievement
     FROM kinerja_iki_pegawai iki
     LEFT JOIN kinerja_periode kp ON kp.id = iki.periode_id
     LEFT JOIN (
       SELECT
         iki_pegawai_id,
         SUM(
           CASE
             WHEN status IN ('submitted','verified','corrected','finalized')
             THEN COALESCE(realisasi, 0)
             ELSE 0
           END
         ) AS total_realisasi
       FROM kinerja_realisasi_indikator
       WHERE ${realizationConditions.join(" AND ")}
       GROUP BY iki_pegawai_id
     ) real_data ON real_data.iki_pegawai_id = iki.id
     WHERE ${ikiConditions.join(" AND ")}`, [...realizationParams, ...ikiParams]);
    const feedbackConditions = ["1 = 1"];
    const feedbackParams = [];
    if (year) {
        feedbackConditions.push("YEAR(f.tanggal_feedback) = ?");
        feedbackParams.push(year);
    }
    if (month) {
        feedbackConditions.push("MONTH(f.tanggal_feedback) = ?");
        feedbackParams.push(month);
    }
    if (employeeId) {
        feedbackConditions.push("f.pegawai_id = ?");
        feedbackParams.push(employeeId);
    }
    if (teamId) {
        feedbackConditions.push("EXISTS (SELECT 1 FROM kinerja_tim_anggota ta WHERE ta.tim_kerja_id = ? AND ta.pegawai_id = f.pegawai_id)");
        feedbackParams.push(teamId);
    }
    const [[feedbackSummary]] = await database_1.pool.query(`SELECT
        COUNT(*) AS totalFeedback,
        COALESCE(SUM(CASE WHEN f.status_baca = 'baru' THEN 1 ELSE 0 END), 0) AS unreadFeedback
     FROM kinerja_umpan_balik f
     WHERE ${feedbackConditions.join(" AND ")}`, feedbackParams);
    const targetChangeConditions = ["1 = 1"];
    const targetChangeParams = [];
    if (year) {
        targetChangeConditions.push("YEAR(pt.diajukan_pada) = ?");
        targetChangeParams.push(year);
    }
    if (month) {
        targetChangeConditions.push("MONTH(pt.diajukan_pada) = ?");
        targetChangeParams.push(month);
    }
    if (employeeId) {
        targetChangeConditions.push("iki.pegawai_id = ?");
        targetChangeParams.push(employeeId);
    }
    if (teamId) {
        targetChangeConditions.push("iki.tim_kerja_id = ?");
        targetChangeParams.push(teamId);
    }
    const [[targetChangeSummary]] = await database_1.pool.query(`SELECT
        COUNT(*) AS totalTargetChanges,
        COALESCE(SUM(CASE WHEN pt.status = 'diajukan' THEN 1 ELSE 0 END), 0) AS pendingTargetChanges
     FROM kinerja_perubahan_target pt
     INNER JOIN kinerja_iki_pegawai iki ON iki.id = pt.iki_pegawai_id
     WHERE ${targetChangeConditions.join(" AND ")}`, targetChangeParams);
    const notificationConditions = ["1 = 1"];
    const notificationParams = [];
    if (year) {
        notificationConditions.push("YEAR(n.dibuat_pada) = ?");
        notificationParams.push(year);
    }
    if (month) {
        notificationConditions.push("MONTH(n.dibuat_pada) = ?");
        notificationParams.push(month);
    }
    if (employeeId) {
        notificationConditions.push("n.pegawai_id = ?");
        notificationParams.push(employeeId);
    }
    if (teamId) {
        notificationConditions.push("EXISTS (SELECT 1 FROM kinerja_tim_anggota ta WHERE ta.tim_kerja_id = ? AND ta.pegawai_id = n.pegawai_id)");
        notificationParams.push(teamId);
    }
    const [[notificationSummary]] = await database_1.pool.query(`SELECT
        COUNT(*) AS totalNotifications,
        COALESCE(SUM(CASE WHEN n.status_baca = 'baru' THEN 1 ELSE 0 END), 0) AS unreadNotifications
     FROM kinerja_notifikasi n
     WHERE ${notificationConditions.join(" AND ")}`, notificationParams);
    const [riskRows] = await database_1.pool.query(`SELECT
        iki.id,
        CASE
          WHEN COALESCE(ch.pending_changes, 0) > 0
            OR COALESCE(feed.unread_feedback, 0) >= 2
            OR (CASE WHEN COALESCE(iki.target, 0) > 0 THEN (COALESCE(real_data.total_realisasi, 0) / iki.target) * 100 ELSE 0 END) < 50
          THEN 'tinggi'
          WHEN COALESCE(feed.unread_feedback, 0) > 0
            OR (CASE WHEN COALESCE(iki.target, 0) > 0 THEN (COALESCE(real_data.total_realisasi, 0) / iki.target) * 100 ELSE 0 END) < 80
          THEN 'sedang'
          ELSE 'rendah'
        END AS riskLevel
     FROM kinerja_iki_pegawai iki
     LEFT JOIN kinerja_periode kp ON kp.id = iki.periode_id
     LEFT JOIN (
       SELECT
         iki_pegawai_id,
         SUM(CASE WHEN status IN ('submitted','verified','corrected','finalized') THEN COALESCE(realisasi, 0) ELSE 0 END) AS total_realisasi
       FROM kinerja_realisasi_indikator
       WHERE ${realizationConditions.join(" AND ")}
       GROUP BY iki_pegawai_id
     ) real_data ON real_data.iki_pegawai_id = iki.id
     LEFT JOIN (
       SELECT
         pegawai_id,
         indikator_kinerja_id,
         SUM(CASE WHEN status_baca = 'baru' THEN 1 ELSE 0 END) AS unread_feedback
       FROM kinerja_umpan_balik
       GROUP BY pegawai_id, indikator_kinerja_id
     ) feed
       ON feed.pegawai_id = iki.pegawai_id
       AND (feed.indikator_kinerja_id = iki.indikator_kinerja_id OR feed.indikator_kinerja_id IS NULL)
     LEFT JOIN (
       SELECT
         iki_pegawai_id,
         SUM(CASE WHEN pt.status = 'diajukan' THEN 1 ELSE 0 END) AS pending_changes
       FROM kinerja_perubahan_target pt
       GROUP BY iki_pegawai_id
     ) ch ON ch.iki_pegawai_id = iki.id
     WHERE ${ikiConditions.join(" AND ")}`, [...realizationParams, ...ikiParams]);
    const [teamRows] = await database_1.pool.query(`SELECT
        tk.id,
        tk.nama_tim AS teamName,
        COUNT(iki.id) AS totalIndicators,
        ROUND(AVG(
          CASE
            WHEN COALESCE(iki.target, 0) > 0
            THEN (COALESCE(real_data.total_realisasi, 0) / iki.target) * 100
            ELSE 0
          END
        ), 2) AS averageAchievement,
        SUM(
          CASE
            WHEN (CASE WHEN COALESCE(iki.target, 0) > 0 THEN (COALESCE(real_data.total_realisasi, 0) / iki.target) * 100 ELSE 0 END) < 50
            THEN 1
            ELSE 0
          END
        ) AS highRiskCount
     FROM kinerja_tim_kerja tk
     LEFT JOIN kinerja_iki_pegawai iki ON iki.tim_kerja_id = tk.id
     LEFT JOIN kinerja_periode kp ON kp.id = iki.periode_id
     LEFT JOIN (
       SELECT
         iki_pegawai_id,
         SUM(CASE WHEN status IN ('submitted','verified','corrected','finalized') THEN COALESCE(realisasi, 0) ELSE 0 END) AS total_realisasi
       FROM kinerja_realisasi_indikator
       WHERE ${realizationConditions.join(" AND ")}
       GROUP BY iki_pegawai_id
     ) real_data ON real_data.iki_pegawai_id = iki.id
     WHERE ${[
        year ? "(kp.tahun = ? OR kp.tahun IS NULL)" : null,
        teamId ? "tk.id = ?" : null,
        employeeId ? "iki.pegawai_id = ?" : null
    ].filter(Boolean).join(" AND ") || "1 = 1"}
     GROUP BY tk.id, tk.nama_tim
     ORDER BY averageAchievement DESC, tk.nama_tim ASC
     LIMIT 8`, [
        ...realizationParams,
        ...(year ? [year] : []),
        ...(teamId ? [teamId] : []),
        ...(employeeId ? [employeeId] : [])
    ]);
    const [notificationRows] = await database_1.pool.query(`SELECT
        n.id,
        n.pegawai_id AS pegawaiId,
        p.nama_lengkap AS pegawaiName,
        n.jenis_notifikasi AS notificationType,
        n.judul AS title,
        n.isi AS content,
        COALESCE(n.link_tujuan, '') AS targetLink,
        COALESCE(n.referensi_tipe, '') AS referenceType,
        n.referensi_id AS referenceId,
        n.status_baca AS readStatus,
        DATE_FORMAT(n.dibuat_pada, '%Y-%m-%d %H:%i:%s') AS createdAt,
        DATE_FORMAT(n.diperbarui_pada, '%Y-%m-%d %H:%i:%s') AS updatedAt
     FROM kinerja_notifikasi n
     INNER JOIN pegawai p ON p.id = n.pegawai_id
     WHERE ${notificationConditions.join(" AND ")}
     ORDER BY n.dibuat_pada DESC
     LIMIT 8`, notificationParams);
    const [yearRows] = await database_1.pool.query(`SELECT DISTINCT tahun AS value FROM kinerja_periode WHERE tahun IS NOT NULL
     UNION
     SELECT DISTINCT YEAR(tanggal_lapor) AS value FROM kinerja_realisasi_indikator WHERE tanggal_lapor IS NOT NULL
     ORDER BY value DESC`);
    const [teamLookupRows] = await database_1.pool.query(`SELECT id, nama_tim AS name FROM kinerja_tim_kerja ORDER BY nama_tim ASC`);
    const [employeeLookupRows] = await database_1.pool.query(`SELECT DISTINCT p.id, p.nama_lengkap AS name
     FROM pegawai p
     INNER JOIN kinerja_iki_pegawai iki ON iki.pegawai_id = p.id
     ORDER BY p.nama_lengkap ASC`);
    const [[employeeProfileRow]] = await database_1.pool.query(`SELECT
        COUNT(*) AS totalEmployees,
        COALESCE(SUM(CASE WHEN LOWER(COALESCE(jenis_kelamin, '')) IN ('laki-laki', 'laki laki', 'pria', 'l') THEN 1 ELSE 0 END), 0) AS maleEmployees,
        COALESCE(SUM(CASE WHEN LOWER(COALESCE(jenis_kelamin, '')) IN ('perempuan', 'wanita', 'p') THEN 1 ELSE 0 END), 0) AS femaleEmployees,
        ROUND(AVG(CASE WHEN tanggal_lahir IS NOT NULL THEN DATEDIFF(CURDATE(), tanggal_lahir) ELSE NULL END), 0) AS averageAgeDays,
        ROUND(AVG(CASE
          WHEN UPPER(COALESCE(pendidikan_terakhir, '')) IN ('SD') THEN 1
          WHEN UPPER(COALESCE(pendidikan_terakhir, '')) IN ('SMP') THEN 2
          WHEN UPPER(COALESCE(pendidikan_terakhir, '')) IN ('SMA','SMK','SLTA') THEN 3
          WHEN UPPER(COALESCE(pendidikan_terakhir, '')) IN ('D1') THEN 4
          WHEN UPPER(COALESCE(pendidikan_terakhir, '')) IN ('D2') THEN 5
          WHEN UPPER(COALESCE(pendidikan_terakhir, '')) IN ('D3') THEN 6
          WHEN UPPER(COALESCE(pendidikan_terakhir, '')) IN ('D4','S1') THEN 7
          WHEN UPPER(COALESCE(pendidikan_terakhir, '')) IN ('S2') THEN 8
          WHEN UPPER(COALESCE(pendidikan_terakhir, '')) IN ('S3') THEN 9
          ELSE NULL
        END), 2) AS averageEducationScore,
        MAX(tanggal_lahir) AS youngestBirthDate,
        MIN(tanggal_lahir) AS oldestBirthDate,
        TIMESTAMPDIFF(YEAR, MAX(tanggal_lahir), CURDATE()) AS youngestAgeYears,
        DATEDIFF(CURDATE(), MAX(tanggal_lahir)) AS youngestAgeDays,
        TIMESTAMPDIFF(YEAR, MIN(tanggal_lahir), CURDATE()) AS oldestAgeYears,
        DATEDIFF(CURDATE(), MIN(tanggal_lahir)) AS oldestAgeDays
     FROM pegawai
     WHERE status_aktif = 'aktif'`);
    const [[positionFulfillmentRow]] = await database_1.pool.query(`SELECT
        COALESCE(SUM(jumlah_formasi), 0) AS totalPositionFormation,
        COUNT(*) AS totalPositionTypes
     FROM jabatan`);
    const averageEducationScore = Number(employeeProfileRow?.averageEducationScore || 0);
    const educationLevels = [
        { score: 1, label: "SD" },
        { score: 2, label: "SMP" },
        { score: 3, label: "SMA/SMK" },
        { score: 4, label: "D1" },
        { score: 5, label: "D2" },
        { score: 6, label: "D3" },
        { score: 7, label: "D4/S1" },
        { score: 8, label: "S2" },
        { score: 9, label: "S3" }
    ];
    const averageEducationLabel = educationLevels.reduce((closest, item) => Math.abs(item.score - averageEducationScore) < Math.abs(closest.score - averageEducationScore) ? item : closest, educationLevels[0]).label;
    const totalActiveEmployees = Number(employeeProfileRow?.totalEmployees || 0);
    const totalPositionFormation = Number(positionFulfillmentRow?.totalPositionFormation || 0);
    return (0, http_1.sendSuccess)(res, {
        source: "kinerja-beranda-dashboard-v2",
        lookups: {
            years: yearRows.map((row) => Number(row.value)).filter(Boolean),
            months: [
                { value: 1, label: "Januari" },
                { value: 2, label: "Februari" },
                { value: 3, label: "Maret" },
                { value: 4, label: "April" },
                { value: 5, label: "Mei" },
                { value: 6, label: "Juni" },
                { value: 7, label: "Juli" },
                { value: 8, label: "Agustus" },
                { value: 9, label: "September" },
                { value: 10, label: "Oktober" },
                { value: 11, label: "November" },
                { value: 12, label: "Desember" }
            ],
            teams: teamLookupRows.map((row) => ({ id: Number(row.id), name: String(row.name || "-") })),
            employees: employeeLookupRows.map((row) => ({ id: Number(row.id), name: String(row.name || "-") }))
        },
        summary: {
            totalIki: Number(summaryRows[0]?.totalIki || 0),
            approvedIki: Number(summaryRows[0]?.approvedIki || 0),
            totalEmployees: Number(summaryRows[0]?.totalEmployees || 0),
            totalTeams: Number(summaryRows[0]?.totalTeams || 0),
            totalRealization: Number(summaryRows[0]?.totalRealization || 0),
            averageAchievement: Number(summaryRows[0]?.averageAchievement || 0),
            totalFeedback: Number(feedbackSummary?.totalFeedback || 0),
            unreadFeedback: Number(feedbackSummary?.unreadFeedback || 0),
            totalTargetChanges: Number(targetChangeSummary?.totalTargetChanges || 0),
            pendingTargetChanges: Number(targetChangeSummary?.pendingTargetChanges || 0),
            totalNotifications: Number(notificationSummary?.totalNotifications || 0),
            unreadNotifications: Number(notificationSummary?.unreadNotifications || 0)
        },
        employeeProfile: {
            totalEmployees: totalActiveEmployees,
            totalPositionFormation,
            totalPositionTypes: Number(positionFulfillmentRow?.totalPositionTypes || 0),
            fulfillmentPercentage: totalPositionFormation > 0 ? Number(((totalActiveEmployees / totalPositionFormation) * 100).toFixed(2)) : 0,
            averageAgeDays: Number(employeeProfileRow?.averageAgeDays || 0),
            averageAgeYears: Number(employeeProfileRow?.averageAgeDays || 0) > 0 ? Math.floor(Number(employeeProfileRow?.averageAgeDays || 0) / 365.2425) : 0,
            youngestAgeYears: Number(employeeProfileRow?.youngestAgeYears || 0),
            youngestAgeDays: Number(employeeProfileRow?.youngestAgeDays || 0),
            oldestAgeYears: Number(employeeProfileRow?.oldestAgeYears || 0),
            oldestAgeDays: Number(employeeProfileRow?.oldestAgeDays || 0),
            averageEducationScore,
            averageEducationLabel: averageEducationScore > 0 ? averageEducationLabel : "-",
            maleEmployees: Number(employeeProfileRow?.maleEmployees || 0),
            femaleEmployees: Number(employeeProfileRow?.femaleEmployees || 0)
        },
        riskSummary: {
            total: riskRows.length,
            high: riskRows.filter((item) => item.riskLevel === "tinggi").length,
            medium: riskRows.filter((item) => item.riskLevel === "sedang").length,
            low: riskRows.filter((item) => item.riskLevel === "rendah").length
        },
        topTeams: teamRows.map((row) => ({
            id: Number(row.id),
            teamName: String(row.teamName || "-"),
            totalIndicators: Number(row.totalIndicators || 0),
            averageAchievement: Number(row.averageAchievement || 0),
            highRiskCount: Number(row.highRiskCount || 0)
        })),
        latestNotifications: notificationRows.map(buildNotificationRecord)
    });
});
exports.getKinerjaDashboardOverview = (0, http_1.asyncHandler)(async (req, res) => {
    await ensureManagementSchema();
    const periodId = req.query.periodId ? (0, validation_1.readPositiveId)(req.query.periodId, "Periode kinerja") : null;
    const year = readOptionalYear(req.query.year);
    const month = readOptionalMonth(req.query.month);
    const teamId = req.query.teamId ? (0, validation_1.readPositiveId)(req.query.teamId, "Tim kerja") : null;
    const employeeId = req.query.employeeId ? (0, validation_1.readPositiveId)(req.query.employeeId, "Pegawai") : null;
    const currentEmployeeId = req.user?.employeeId || null;
    const isPrivileged = ["super_admin", "admin_satker", "kepala_satker", "kasubbag_umum", "ketua_tim", "pejabat_penilai", "reviewer"].includes(String(req.user?.role || ""));
    const ikiConditions = ["1 = 1"];
    const ikiParams = [];
    if (periodId) {
        ikiConditions.push("iki.periode_id = ?");
        ikiParams.push(periodId);
    }
    if (year) {
        ikiConditions.push("kp.tahun = ?");
        ikiParams.push(year);
    }
    if (teamId) {
        ikiConditions.push("iki.tim_kerja_id = ?");
        ikiParams.push(teamId);
    }
    if (employeeId) {
        ikiConditions.push("iki.pegawai_id = ?");
        ikiParams.push(employeeId);
    }
    const realizationConditions = ["1 = 1"];
    const realizationParams = [];
    if (month) {
        realizationConditions.push("MONTH(tanggal_lapor) = ?");
        realizationParams.push(month);
    }
    if (year) {
        realizationConditions.push("YEAR(tanggal_lapor) = ?");
        realizationParams.push(year);
    }
    const [summaryRows] = await database_1.pool.query(`SELECT
        COUNT(DISTINCT iki.id) AS totalIki,
        COUNT(DISTINCT CASE WHEN iki.status IN ('disetujui','dikunci') THEN iki.id END) AS approvedIki,
        COUNT(DISTINCT iki.pegawai_id) AS totalEmployees,
        COUNT(DISTINCT iki.tim_kerja_id) AS totalTeams,
        COALESCE(SUM(COALESCE(real_data.total_realisasi, 0)), 0) AS totalRealization,
        ROUND(AVG(
          CASE WHEN COALESCE(iki.target, 0) > 0
            THEN (COALESCE(real_data.total_realisasi, 0) / iki.target) * 100
            ELSE 0 END
        ), 2) AS averageAchievement
     FROM kinerja_iki_pegawai iki
     LEFT JOIN kinerja_periode kp ON kp.id = iki.periode_id
     LEFT JOIN (
       SELECT iki_pegawai_id,
              SUM(CASE WHEN status IN ('submitted','verified','corrected','finalized') THEN COALESCE(realisasi, 0) ELSE 0 END) AS total_realisasi
       FROM kinerja_realisasi_indikator
       WHERE ${realizationConditions.join(" AND ")}
       GROUP BY iki_pegawai_id
     ) real_data ON real_data.iki_pegawai_id = iki.id
     WHERE ${ikiConditions.join(" AND ")}`, [...realizationParams, ...ikiParams]);
    const feedbackConditions = ["1 = 1"];
    const feedbackParams = [];
    if (periodId) {
        feedbackConditions.push("f.periode_id = ?");
        feedbackParams.push(periodId);
    }
    if (employeeId) {
        feedbackConditions.push("f.pegawai_id = ?");
        feedbackParams.push(employeeId);
    }
    if (teamId) {
        feedbackConditions.push("EXISTS (SELECT 1 FROM kinerja_tim_anggota ta WHERE ta.pegawai_id = f.pegawai_id AND ta.tim_kerja_id = ?)");
        feedbackParams.push(teamId);
    }
    if (month) {
        feedbackConditions.push("MONTH(f.tanggal_feedback) = ?");
        feedbackParams.push(month);
    }
    if (year) {
        feedbackConditions.push("COALESCE(kp.tahun, YEAR(f.tanggal_feedback)) = ?");
        feedbackParams.push(year);
    }
    const [[feedbackSummary]] = await database_1.pool.query(`SELECT COUNT(*) AS totalFeedback,
            SUM(CASE WHEN status_baca = 'baru' THEN 1 ELSE 0 END) AS unreadFeedback
     FROM kinerja_umpan_balik f
     LEFT JOIN kinerja_periode kp ON kp.id = f.periode_id
     WHERE ${feedbackConditions.join(" AND ")}`, feedbackParams);
    const targetChangeConditions = ["1 = 1"];
    const targetChangeParams = [];
    if (periodId) {
        targetChangeConditions.push("iki.periode_id = ?");
        targetChangeParams.push(periodId);
    }
    if (employeeId) {
        targetChangeConditions.push("iki.pegawai_id = ?");
        targetChangeParams.push(employeeId);
    }
    if (teamId) {
        targetChangeConditions.push("iki.tim_kerja_id = ?");
        targetChangeParams.push(teamId);
    }
    if (month) {
        targetChangeConditions.push("MONTH(pt.diajukan_pada) = ?");
        targetChangeParams.push(month);
    }
    if (year) {
        targetChangeConditions.push("COALESCE(kp.tahun, YEAR(pt.diajukan_pada)) = ?");
        targetChangeParams.push(year);
    }
    const [[targetChangeSummary]] = await database_1.pool.query(`SELECT COUNT(*) AS totalTargetChanges,
            SUM(CASE WHEN pt.status = 'diajukan' THEN 1 ELSE 0 END) AS pendingTargetChanges
     FROM kinerja_perubahan_target pt
     INNER JOIN kinerja_iki_pegawai iki ON iki.id = pt.iki_pegawai_id
     LEFT JOIN kinerja_periode kp ON kp.id = iki.periode_id
     WHERE ${targetChangeConditions.join(" AND ")}`, targetChangeParams);
    const riskQuery = buildRiskQuery({ periodId, year, month, teamId, employeeId });
    const [riskRows] = await database_1.pool.query(riskQuery.sql, riskQuery.params);
    const teamConditions = [
        "1 = 1",
        periodId ? "(iki.periode_id = ? OR iki.periode_id IS NULL)" : null,
        year ? "(kp.tahun = ? OR iki.periode_id IS NULL)" : null,
        teamId ? "tk.id = ?" : null,
        employeeId ? "iki.pegawai_id = ?" : null
    ].filter(Boolean).join(" AND ");
    const [teamRows] = await database_1.pool.query(`SELECT
        tk.id,
        tk.nama_tim AS teamName,
        COUNT(iki.id) AS totalIndicators,
        ROUND(AVG(
          CASE WHEN COALESCE(iki.target, 0) > 0
            THEN (COALESCE(real_data.total_realisasi, 0) / iki.target) * 100
            ELSE 0 END
        ), 2) AS averageAchievement,
        SUM(
          CASE
            WHEN (CASE WHEN COALESCE(iki.target, 0) > 0 THEN (COALESCE(real_data.total_realisasi, 0) / iki.target) * 100 ELSE 0 END) < 50 THEN 1
            ELSE 0
          END
        ) AS highRiskCount
     FROM kinerja_tim_kerja tk
     LEFT JOIN kinerja_iki_pegawai iki ON iki.tim_kerja_id = tk.id
     LEFT JOIN kinerja_periode kp ON kp.id = iki.periode_id
     LEFT JOIN (
       SELECT iki_pegawai_id,
              SUM(CASE WHEN status IN ('submitted','verified','corrected','finalized') THEN COALESCE(realisasi, 0) ELSE 0 END) AS total_realisasi
       FROM kinerja_realisasi_indikator
       WHERE ${realizationConditions.join(" AND ")}
       GROUP BY iki_pegawai_id
     ) real_data ON real_data.iki_pegawai_id = iki.id
     WHERE ${teamConditions}
     GROUP BY tk.id, tk.nama_tim
     ORDER BY averageAchievement DESC, tk.nama_tim ASC
     LIMIT 6`, [
        ...realizationParams,
        ...(periodId ? [periodId] : []),
        ...(year ? [year] : []),
        ...(teamId ? [teamId] : []),
        ...(employeeId ? [employeeId] : [])
    ]);
    const notificationConditions = ["(? = 1 OR n.pegawai_id = ?)"];
    const notificationParams = [isPrivileged ? 1 : 0, currentEmployeeId || 0];
    if (employeeId) {
        notificationConditions.push("n.pegawai_id = ?");
        notificationParams.push(employeeId);
    }
    if (teamId) {
        notificationConditions.push("EXISTS (SELECT 1 FROM kinerja_tim_anggota ta WHERE ta.pegawai_id = n.pegawai_id AND ta.tim_kerja_id = ?)");
        notificationParams.push(teamId);
    }
    if (month) {
        notificationConditions.push("MONTH(n.dibuat_pada) = ?");
        notificationParams.push(month);
    }
    if (year) {
        notificationConditions.push("YEAR(n.dibuat_pada) = ?");
        notificationParams.push(year);
    }
    const [[notificationSummary]] = await database_1.pool.query(`SELECT COUNT(*) AS totalNotifications,
            SUM(CASE WHEN n.status_baca = 'baru' THEN 1 ELSE 0 END) AS unreadNotifications
     FROM kinerja_notifikasi n
     INNER JOIN pegawai p ON p.id = n.pegawai_id
     WHERE ${notificationConditions.join(" AND ")}`, notificationParams);
    const [notificationRows] = await database_1.pool.query(`SELECT n.id,
            n.pegawai_id AS pegawaiId,
            p.nama_lengkap AS pegawaiName,
            n.jenis_notifikasi AS notificationType,
            n.judul AS title,
            n.isi AS content,
            COALESCE(n.link_tujuan, '') AS targetLink,
            COALESCE(n.referensi_tipe, '') AS referenceType,
            n.referensi_id AS referenceId,
            n.status_baca AS readStatus,
            DATE_FORMAT(n.dibuat_pada, '%Y-%m-%d %H:%i:%s') AS createdAt,
            DATE_FORMAT(n.diperbarui_pada, '%Y-%m-%d %H:%i:%s') AS updatedAt
     FROM kinerja_notifikasi n
     INNER JOIN pegawai p ON p.id = n.pegawai_id
     WHERE ${notificationConditions.join(" AND ")}
     ORDER BY n.dibuat_pada DESC
     LIMIT 6`, notificationParams);
    const unreadNotifications = Number(notificationSummary?.unreadNotifications || 0);
    let dashboardSummary = {
        totalIki: Number(summaryRows[0]?.totalIki || 0),
        approvedIki: Number(summaryRows[0]?.approvedIki || 0),
        totalEmployees: Number(summaryRows[0]?.totalEmployees || 0),
        totalTeams: Number(summaryRows[0]?.totalTeams || 0),
        totalRealization: Number(summaryRows[0]?.totalRealization || 0),
        averageAchievement: Number(summaryRows[0]?.averageAchievement || 0),
        totalFeedback: Number(feedbackSummary?.totalFeedback || 0),
        unreadFeedback: Number(feedbackSummary?.unreadFeedback || 0),
        totalTargetChanges: Number(targetChangeSummary?.totalTargetChanges || 0),
        pendingTargetChanges: Number(targetChangeSummary?.pendingTargetChanges || 0),
        unreadNotifications
    };
    let dashboardRiskSummary = {
        total: riskRows.length,
        high: riskRows.filter((item) => item.riskLevel === "tinggi").length,
        medium: riskRows.filter((item) => item.riskLevel === "sedang").length,
        low: riskRows.filter((item) => item.riskLevel === "rendah").length
    };
    let dashboardTopTeams = teamRows.map((row) => ({
        id: Number(row.id),
        teamName: String(row.teamName || "-"),
        totalIndicators: Number(row.totalIndicators || 0),
        averageAchievement: Number(row.averageAchievement || 0),
        highRiskCount: Number(row.highRiskCount || 0)
    }));
    let dashboardLatestNotifications = notificationRows.map(buildNotificationRecord);
    let fallbackApplied = false;
    const dashboardLooksEmpty = dashboardSummary.totalIki === 0 &&
        dashboardSummary.totalEmployees === 0 &&
        dashboardSummary.totalRealization === 0;
    if (dashboardLooksEmpty) {
        const [[rawSummary]] = await database_1.pool.query(`SELECT
          COUNT(DISTINCT iki.id) AS totalIki,
          COUNT(DISTINCT CASE WHEN iki.status IN ('disetujui','dikunci') THEN iki.id END) AS approvedIki,
          COUNT(DISTINCT iki.pegawai_id) AS totalEmployees,
          COUNT(DISTINCT iki.tim_kerja_id) AS totalTeams,
          COALESCE(SUM(COALESCE(real_data.total_realisasi, 0)), 0) AS totalRealization,
          ROUND(AVG(
            CASE WHEN COALESCE(iki.target, 0) > 0
              THEN (COALESCE(real_data.total_realisasi, 0) / iki.target) * 100
              ELSE 0 END
          ), 2) AS averageAchievement
       FROM kinerja_iki_pegawai iki
       LEFT JOIN (
         SELECT iki_pegawai_id,
                SUM(CASE WHEN status IN ('submitted','verified','corrected','finalized') THEN COALESCE(realisasi, 0) ELSE 0 END) AS total_realisasi
         FROM kinerja_realisasi_indikator
         GROUP BY iki_pegawai_id
       ) real_data ON real_data.iki_pegawai_id = iki.id`);
        if (Number(rawSummary?.totalIki || 0) > 0) {
            const [[rawFeedbackSummary]] = await database_1.pool.query(`SELECT COUNT(*) AS totalFeedback,
                SUM(CASE WHEN status_baca = 'baru' THEN 1 ELSE 0 END) AS unreadFeedback
         FROM kinerja_umpan_balik`);
            const [[rawTargetChangeSummary]] = await database_1.pool.query(`SELECT COUNT(*) AS totalTargetChanges,
                SUM(CASE WHEN pt.status = 'diajukan' THEN 1 ELSE 0 END) AS pendingTargetChanges
         FROM kinerja_perubahan_target pt`);
            const [[rawNotificationSummary]] = await database_1.pool.query(`SELECT COUNT(*) AS totalNotifications,
                SUM(CASE WHEN status_baca = 'baru' THEN 1 ELSE 0 END) AS unreadNotifications
         FROM kinerja_notifikasi`);
            const [rawRiskRows] = await database_1.pool.query(`SELECT
            CASE
              WHEN COALESCE(ch.pending_changes, 0) > 0
                OR (CASE WHEN COALESCE(iki.target, 0) > 0 THEN (COALESCE(real_data.total_realisasi, 0) / iki.target) * 100 ELSE 0 END) < 50
                OR COALESCE(feed.unread_feedback, 0) >= 2
              THEN 'tinggi'
              WHEN (CASE WHEN COALESCE(iki.target, 0) > 0 THEN (COALESCE(real_data.total_realisasi, 0) / iki.target) * 100 ELSE 0 END) < 80
                OR COALESCE(feed.unread_feedback, 0) > 0
              THEN 'sedang'
              ELSE 'rendah'
            END AS riskLevel
         FROM kinerja_iki_pegawai iki
         LEFT JOIN (
           SELECT iki_pegawai_id,
                  SUM(CASE WHEN status IN ('submitted','verified','corrected','finalized') THEN COALESCE(realisasi, 0) ELSE 0 END) AS total_realisasi
           FROM kinerja_realisasi_indikator
           GROUP BY iki_pegawai_id
         ) real_data ON real_data.iki_pegawai_id = iki.id
         LEFT JOIN (
           SELECT pegawai_id,
                  indikator_kinerja_id,
                  SUM(CASE WHEN status_baca = 'baru' THEN 1 ELSE 0 END) AS unread_feedback
           FROM kinerja_umpan_balik
           GROUP BY pegawai_id, indikator_kinerja_id
         ) feed
           ON feed.pegawai_id = iki.pegawai_id
           AND (feed.indikator_kinerja_id = iki.indikator_kinerja_id OR feed.indikator_kinerja_id IS NULL)
         LEFT JOIN (
           SELECT iki_pegawai_id,
                  SUM(CASE WHEN pt.status = 'diajukan' THEN 1 ELSE 0 END) AS pending_changes
           FROM kinerja_perubahan_target pt
           GROUP BY iki_pegawai_id
         ) ch ON ch.iki_pegawai_id = iki.id`);
            const [rawTeamRows] = await database_1.pool.query(`SELECT
            tk.id,
            tk.nama_tim AS teamName,
            COUNT(iki.id) AS totalIndicators,
            ROUND(AVG(
              CASE WHEN COALESCE(iki.target, 0) > 0
                THEN (COALESCE(real_data.total_realisasi, 0) / iki.target) * 100
                ELSE 0 END
            ), 2) AS averageAchievement,
            SUM(
              CASE
                WHEN (CASE WHEN COALESCE(iki.target, 0) > 0 THEN (COALESCE(real_data.total_realisasi, 0) / iki.target) * 100 ELSE 0 END) < 50 THEN 1
                ELSE 0
              END
            ) AS highRiskCount
         FROM kinerja_tim_kerja tk
         LEFT JOIN kinerja_iki_pegawai iki ON iki.tim_kerja_id = tk.id
         LEFT JOIN (
           SELECT iki_pegawai_id,
                  SUM(CASE WHEN status IN ('submitted','verified','corrected','finalized') THEN COALESCE(realisasi, 0) ELSE 0 END) AS total_realisasi
           FROM kinerja_realisasi_indikator
           GROUP BY iki_pegawai_id
         ) real_data ON real_data.iki_pegawai_id = iki.id
         GROUP BY tk.id, tk.nama_tim
         ORDER BY averageAchievement DESC, tk.nama_tim ASC
         LIMIT 6`);
            const [rawNotificationRows] = await database_1.pool.query(`SELECT n.id,
                n.pegawai_id AS pegawaiId,
                p.nama_lengkap AS pegawaiName,
                n.jenis_notifikasi AS notificationType,
                n.judul AS title,
                n.isi AS content,
                COALESCE(n.link_tujuan, '') AS targetLink,
                COALESCE(n.referensi_tipe, '') AS referenceType,
                n.referensi_id AS referenceId,
                n.status_baca AS readStatus,
                DATE_FORMAT(n.dibuat_pada, '%Y-%m-%d %H:%i:%s') AS createdAt,
                DATE_FORMAT(n.diperbarui_pada, '%Y-%m-%d %H:%i:%s') AS updatedAt
         FROM kinerja_notifikasi n
         INNER JOIN pegawai p ON p.id = n.pegawai_id
         ORDER BY n.dibuat_pada DESC
         LIMIT 6`);
            dashboardSummary = {
                totalIki: Number(rawSummary?.totalIki || 0),
                approvedIki: Number(rawSummary?.approvedIki || 0),
                totalEmployees: Number(rawSummary?.totalEmployees || 0),
                totalTeams: Number(rawSummary?.totalTeams || 0),
                totalRealization: Number(rawSummary?.totalRealization || 0),
                averageAchievement: Number(rawSummary?.averageAchievement || 0),
                totalFeedback: Number(rawFeedbackSummary?.totalFeedback || 0),
                unreadFeedback: Number(rawFeedbackSummary?.unreadFeedback || 0),
                totalTargetChanges: Number(rawTargetChangeSummary?.totalTargetChanges || 0),
                pendingTargetChanges: Number(rawTargetChangeSummary?.pendingTargetChanges || 0),
                unreadNotifications: Number(rawNotificationSummary?.unreadNotifications || 0)
            };
            dashboardRiskSummary = {
                total: rawRiskRows.length,
                high: rawRiskRows.filter((item) => item.riskLevel === "tinggi").length,
                medium: rawRiskRows.filter((item) => item.riskLevel === "sedang").length,
                low: rawRiskRows.filter((item) => item.riskLevel === "rendah").length
            };
            dashboardTopTeams = rawTeamRows.map((row) => ({
                id: Number(row.id),
                teamName: String(row.teamName || "-"),
                totalIndicators: Number(row.totalIndicators || 0),
                averageAchievement: Number(row.averageAchievement || 0),
                highRiskCount: Number(row.highRiskCount || 0)
            }));
            dashboardLatestNotifications = rawNotificationRows.map(buildNotificationRecord);
            fallbackApplied = true;
        }
    }
    return (0, http_1.sendSuccess)(res, {
        summary: dashboardSummary,
        riskSummary: dashboardRiskSummary,
        topTeams: dashboardTopTeams,
        latestNotifications: dashboardLatestNotifications,
        meta: { fallbackApplied }
    });
});
exports.getKinerjaDashboardDiagnostics = (0, http_1.asyncHandler)(async (_req, res) => {
    const tables = [
        "pegawai",
        "kinerja_periode",
        "kinerja_tim_kerja",
        "kinerja_iki_pegawai",
        "kinerja_realisasi_indikator",
        "kinerja_umpan_balik",
        "kinerja_perubahan_target",
        "kinerja_notifikasi"
    ];
    const [[databaseRow]] = await database_1.pool.query(`SELECT DATABASE() AS databaseName, @@hostname AS databaseHost, @@port AS databasePort`);
    const counts = {};
    for (const table of tables) {
        try {
            const [[row]] = await database_1.pool.query(`SELECT COUNT(*) AS total FROM \`${table}\``);
            counts[table] = Number(row?.total || 0);
        }
        catch {
            counts[table] = -1;
        }
    }
    const [[summary]] = await database_1.pool.query(`SELECT
        COUNT(DISTINCT iki.id) AS totalIki,
        COUNT(DISTINCT CASE WHEN iki.status IN ('disetujui','dikunci') THEN iki.id END) AS approvedIki,
        COUNT(DISTINCT iki.pegawai_id) AS totalEmployees,
        COUNT(DISTINCT iki.tim_kerja_id) AS totalTeams,
        COALESCE(SUM(COALESCE(real_data.total_realisasi, 0)), 0) AS totalRealization,
        ROUND(AVG(
          CASE WHEN COALESCE(iki.target, 0) > 0
            THEN (COALESCE(real_data.total_realisasi, 0) / iki.target) * 100
            ELSE 0 END
        ), 2) AS averageAchievement
     FROM kinerja_iki_pegawai iki
     LEFT JOIN (
       SELECT iki_pegawai_id,
              SUM(CASE WHEN status IN ('submitted','verified','corrected','finalized') THEN COALESCE(realisasi, 0) ELSE 0 END) AS total_realisasi
       FROM kinerja_realisasi_indikator
       GROUP BY iki_pegawai_id
     ) real_data ON real_data.iki_pegawai_id = iki.id`);
    const [sampleIki] = await database_1.pool.query(`SELECT iki.id,
            p.nama_lengkap AS pegawaiName,
            COALESCE(tk.nama_tim, '-') AS teamName,
            iki.nama_iki AS ikiName,
            iki.target,
            COALESCE(real_data.total_realisasi, 0) AS realization,
            ROUND(CASE WHEN COALESCE(iki.target, 0) > 0 THEN (COALESCE(real_data.total_realisasi, 0) / iki.target) * 100 ELSE 0 END, 2) AS achievementPercentage
     FROM kinerja_iki_pegawai iki
     INNER JOIN pegawai p ON p.id = iki.pegawai_id
     LEFT JOIN kinerja_tim_kerja tk ON tk.id = iki.tim_kerja_id
     LEFT JOIN (
       SELECT iki_pegawai_id,
              SUM(CASE WHEN status IN ('submitted','verified','corrected','finalized') THEN COALESCE(realisasi, 0) ELSE 0 END) AS total_realisasi
       FROM kinerja_realisasi_indikator
       GROUP BY iki_pegawai_id
     ) real_data ON real_data.iki_pegawai_id = iki.id
     ORDER BY iki.id ASC
     LIMIT 5`);
    return (0, http_1.sendSuccess)(res, {
        database: {
            configuredName: process.env.DB_NAME || "",
            currentName: String(databaseRow?.databaseName || ""),
            host: process.env.DB_HOST || "",
            port: process.env.DB_PORT || "",
            user: process.env.DB_USER || "",
            serverHost: String(databaseRow?.databaseHost || ""),
            serverPort: String(databaseRow?.databasePort || "")
        },
        counts,
        dashboardSummary: {
            totalIki: Number(summary?.totalIki || 0),
            approvedIki: Number(summary?.approvedIki || 0),
            totalEmployees: Number(summary?.totalEmployees || 0),
            totalTeams: Number(summary?.totalTeams || 0),
            totalRealization: Number(summary?.totalRealization || 0),
            averageAchievement: Number(summary?.averageAchievement || 0)
        },
        sampleIki: sampleIki.map((row) => ({
            id: Number(row.id),
            pegawaiName: String(row.pegawaiName || ""),
            teamName: String(row.teamName || ""),
            ikiName: String(row.ikiName || ""),
            target: Number(row.target || 0),
            realization: Number(row.realization || 0),
            achievementPercentage: Number(row.achievementPercentage || 0)
        }))
    });
});
exports.getKinerjaRiskMonitoringDirect = (0, http_1.asyncHandler)(async (req, res) => {
    await ensureManagementSchema();
    const year = readOptionalYear(req.query.year);
    const month = readOptionalMonth(req.query.month);
    const teamId = req.query.teamId ? (0, validation_1.readPositiveId)(req.query.teamId, "Tim kerja") : null;
    const employeeId = req.query.employeeId ? (0, validation_1.readPositiveId)(req.query.employeeId, "Pegawai") : null;
    const search = (0, validation_1.readTrimmedString)(req.query.search);
    const riskLevel = req.query.riskLevel
        ? (0, validation_1.ensureOneOf)((0, validation_1.readTrimmedString)(req.query.riskLevel).toLowerCase(), RISK_LEVELS, "Level risiko")
        : null;
    const conditions = ["1 = 1"];
    const params = [];
    if (year) {
        conditions.push("kp.tahun = ?");
        params.push(year);
    }
    if (teamId) {
        conditions.push("iki.tim_kerja_id = ?");
        params.push(teamId);
    }
    if (employeeId) {
        conditions.push("iki.pegawai_id = ?");
        params.push(employeeId);
    }
    if (search) {
        conditions.push("(p.nama_lengkap LIKE ? OR iki.nama_iki LIKE ? OR COALESCE(tk.nama_tim, '') LIKE ?)");
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const realizationConditions = ["1 = 1"];
    const realizationParams = [];
    if (year) {
        realizationConditions.push("YEAR(tanggal_lapor) = ?");
        realizationParams.push(year);
    }
    if (month) {
        realizationConditions.push("MONTH(tanggal_lapor) = ?");
        realizationParams.push(month);
    }
    const feedbackConditions = ["1 = 1"];
    const feedbackParams = [];
    if (year) {
        feedbackConditions.push("YEAR(tanggal_feedback) = ?");
        feedbackParams.push(year);
    }
    if (month) {
        feedbackConditions.push("MONTH(tanggal_feedback) = ?");
        feedbackParams.push(month);
    }
    const changeConditions = ["1 = 1"];
    const changeParams = [];
    if (year) {
        changeConditions.push("YEAR(diajukan_pada) = ?");
        changeParams.push(year);
    }
    if (month) {
        changeConditions.push("MONTH(diajukan_pada) = ?");
        changeParams.push(month);
    }
    const achievementExpression = `
    CASE
      WHEN COALESCE(iki.target, 0) > 0
      THEN (COALESCE(real_data.total_realisasi, 0) / iki.target) * 100
      ELSE 0
    END
  `;
    const unreadFeedbackExpression = `
    COALESCE(feed_specific.unread_feedback, 0) + COALESCE(feed_general.unread_feedback, 0)
  `;
    const totalFeedbackExpression = `
    COALESCE(feed_specific.total_feedback, 0) + COALESCE(feed_general.total_feedback, 0)
  `;
    const riskLevelExpression = `
    CASE
      WHEN COALESCE(ch.pending_changes, 0) > 0
        OR (${achievementExpression}) < 50
        OR (${unreadFeedbackExpression}) >= 2
      THEN 'tinggi'
      WHEN (${achievementExpression}) < 80
        OR (${unreadFeedbackExpression}) > 0
      THEN 'sedang'
      ELSE 'rendah'
    END
  `;
    const [rows] = await database_1.pool.query(`SELECT *
     FROM (
       SELECT
          iki.id,
          iki.pegawai_id AS pegawaiId,
          p.nama_lengkap AS pegawaiName,
          iki.tim_kerja_id AS timKerjaId,
          COALESCE(tk.nama_tim, '-') AS timKerjaName,
          iki.periode_id AS periodeId,
          COALESCE(kp.nama_periode, '-') AS periodeName,
          iki.nama_iki AS ikiName,
          iki.target,
          COALESCE(real_data.total_realisasi, 0) AS realization,
          ROUND(${achievementExpression}, 2) AS achievementPercentage,
          DATE_FORMAT(real_data.latest_report_date, '%Y-%m-%d') AS latestReportDate,
          ${totalFeedbackExpression} AS totalFeedback,
          ${unreadFeedbackExpression} AS unreadFeedback,
          COALESCE(ch.total_changes, 0) AS totalTargetChanges,
          COALESCE(ch.pending_changes, 0) AS pendingTargetChanges,
          ${riskLevelExpression} AS riskLevel,
          CASE
            WHEN COALESCE(ch.pending_changes, 0) > 0
              THEN 'Selesaikan usulan perubahan target sebelum evaluasi berikutnya.'
            WHEN (${achievementExpression}) < 50
              THEN 'Segera lakukan dialog kinerja dan koreksi rencana kerja.'
            WHEN (${unreadFeedbackExpression}) >= 2
              THEN 'Tindak lanjuti seluruh umpan balik yang belum dibaca.'
            WHEN (${achievementExpression}) < 80
              THEN 'Perkuat monitoring mingguan sampai capaian minimal 80%.'
            WHEN (${unreadFeedbackExpression}) > 0
              THEN 'Pastikan umpan balik atasan dibaca dan ditindaklanjuti.'
            ELSE 'Lanjutkan ritme kerja dan jaga konsistensi realisasi.'
          END AS recommendation
       FROM kinerja_iki_pegawai iki
       INNER JOIN pegawai p ON p.id = iki.pegawai_id
       LEFT JOIN kinerja_tim_kerja tk ON tk.id = iki.tim_kerja_id
       LEFT JOIN kinerja_periode kp ON kp.id = iki.periode_id
       LEFT JOIN (
         SELECT
            iki_pegawai_id,
            SUM(CASE WHEN status IN ('submitted','verified','corrected','finalized') THEN COALESCE(realisasi, 0) ELSE 0 END) AS total_realisasi,
            MAX(tanggal_lapor) AS latest_report_date
         FROM kinerja_realisasi_indikator
         WHERE ${realizationConditions.join(" AND ")}
         GROUP BY iki_pegawai_id
       ) real_data ON real_data.iki_pegawai_id = iki.id
       LEFT JOIN (
         SELECT
            pegawai_id,
            indikator_kinerja_id,
            COUNT(*) AS total_feedback,
            SUM(CASE WHEN status_baca = 'baru' THEN 1 ELSE 0 END) AS unread_feedback
         FROM kinerja_umpan_balik
         WHERE ${feedbackConditions.join(" AND ")}
           AND indikator_kinerja_id IS NOT NULL
         GROUP BY pegawai_id, indikator_kinerja_id
       ) feed_specific
         ON feed_specific.pegawai_id = iki.pegawai_id
         AND feed_specific.indikator_kinerja_id = iki.indikator_kinerja_id
       LEFT JOIN (
         SELECT
            pegawai_id,
            COUNT(*) AS total_feedback,
            SUM(CASE WHEN status_baca = 'baru' THEN 1 ELSE 0 END) AS unread_feedback
         FROM kinerja_umpan_balik
         WHERE ${feedbackConditions.join(" AND ")}
           AND indikator_kinerja_id IS NULL
         GROUP BY pegawai_id
       ) feed_general ON feed_general.pegawai_id = iki.pegawai_id
       LEFT JOIN (
         SELECT
            iki_pegawai_id,
            COUNT(*) AS total_changes,
            SUM(CASE WHEN pt.status = 'diajukan' THEN 1 ELSE 0 END) AS pending_changes
         FROM kinerja_perubahan_target pt
         WHERE ${changeConditions.join(" AND ")}
         GROUP BY iki_pegawai_id
       ) ch ON ch.iki_pegawai_id = iki.id
       WHERE ${conditions.join(" AND ")}
     ) risk_data
     ${riskLevel ? "WHERE risk_data.riskLevel = ?" : ""}
     ORDER BY FIELD(risk_data.riskLevel, 'tinggi', 'sedang', 'rendah'), risk_data.achievementPercentage ASC, risk_data.pegawaiName ASC
     LIMIT 500`, [
        ...realizationParams,
        ...feedbackParams,
        ...feedbackParams,
        ...changeParams,
        ...params,
        ...(riskLevel ? [riskLevel] : [])
    ]);
    const records = rows.map((row) => ({
        id: Number(row.id),
        pegawaiId: Number(row.pegawaiId),
        pegawaiName: String(row.pegawaiName || "-"),
        timKerjaId: row.timKerjaId ? Number(row.timKerjaId) : null,
        timKerjaName: String(row.timKerjaName || "-"),
        periodeId: row.periodeId ? Number(row.periodeId) : null,
        periodeName: String(row.periodeName || "-"),
        ikiName: String(row.ikiName || "-"),
        target: row.target == null ? null : Number(row.target),
        realization: row.realization == null ? null : Number(row.realization),
        achievementPercentage: Number(row.achievementPercentage || 0),
        latestReportDate: row.latestReportDate ? String(row.latestReportDate) : null,
        totalFeedback: Number(row.totalFeedback || 0),
        unreadFeedback: Number(row.unreadFeedback || 0),
        totalTargetChanges: Number(row.totalTargetChanges || 0),
        pendingTargetChanges: Number(row.pendingTargetChanges || 0),
        riskLevel: String(row.riskLevel || "rendah"),
        recommendation: String(row.recommendation || "Lanjutkan ritme kerja dan jaga konsistensi realisasi.")
    }));
    return (0, http_1.sendSuccess)(res, {
        summary: {
            totalRecords: records.length,
            highRisk: records.filter((item) => item.riskLevel === "tinggi").length,
            mediumRisk: records.filter((item) => item.riskLevel === "sedang").length,
            lowRisk: records.filter((item) => item.riskLevel === "rendah").length
        },
        records
    });
});
exports.getKinerjaRiskMonitoring = (0, http_1.asyncHandler)(async (req, res) => {
    await ensureManagementSchema();
    const periodId = req.query.periodId ? (0, validation_1.readPositiveId)(req.query.periodId, "Periode kinerja") : null;
    const year = readOptionalYear(req.query.year);
    const month = readOptionalMonth(req.query.month);
    const teamId = req.query.teamId ? (0, validation_1.readPositiveId)(req.query.teamId, "Tim kerja") : null;
    const employeeId = req.query.employeeId ? (0, validation_1.readPositiveId)(req.query.employeeId, "Pegawai") : null;
    const riskLevel = req.query.riskLevel
        ? (0, validation_1.ensureOneOf)((0, validation_1.readTrimmedString)(req.query.riskLevel).toLowerCase(), RISK_LEVELS, "Level risiko")
        : null;
    const search = (0, validation_1.readTrimmedString)(req.query.search);
    const { sql, params } = buildRiskQuery({ periodId, year, month, teamId, employeeId, search, riskLevel });
    const [rows] = await database_1.pool.query(sql, params);
    const records = rows.map((row) => ({
        id: Number(row.id),
        pegawaiId: Number(row.pegawaiId),
        pegawaiName: String(row.pegawaiName || "-"),
        timKerjaId: row.timKerjaId ? Number(row.timKerjaId) : null,
        timKerjaName: String(row.timKerjaName || "-"),
        periodeId: row.periodeId ? Number(row.periodeId) : null,
        periodeName: String(row.periodeName || "-"),
        ikiName: String(row.ikiName || "-"),
        target: row.target == null ? null : Number(row.target),
        realization: row.realization == null ? null : Number(row.realization),
        achievementPercentage: Number(row.achievementPercentage || 0),
        latestReportDate: row.latestReportDate ? String(row.latestReportDate) : null,
        totalFeedback: Number(row.totalFeedback || 0),
        unreadFeedback: Number(row.unreadFeedback || 0),
        totalTargetChanges: Number(row.totalTargetChanges || 0),
        pendingTargetChanges: Number(row.pendingTargetChanges || 0),
        riskLevel: String(row.riskLevel || "rendah"),
        recommendation: String(row.recommendation || "")
    }));
    return (0, http_1.sendSuccess)(res, {
        summary: {
            totalRecords: records.length,
            highRisk: records.filter((item) => item.riskLevel === "tinggi").length,
            mediumRisk: records.filter((item) => item.riskLevel === "sedang").length,
            lowRisk: records.filter((item) => item.riskLevel === "rendah").length
        },
        records
    });
});
exports.getKinerjaFeedbacks = (0, http_1.asyncHandler)(async (req, res) => {
    await ensureManagementSchema();
    const employeeId = req.query.employeeId ? (0, validation_1.readPositiveId)(req.query.employeeId, "Pegawai") : null;
    const feedbackType = req.query.feedbackType
        ? (0, validation_1.ensureOneOf)((0, validation_1.readTrimmedString)(req.query.feedbackType).toLowerCase(), FEEDBACK_TYPES, "Jenis umpan balik")
        : null;
    const readStatus = req.query.readStatus
        ? (0, validation_1.ensureOneOf)((0, validation_1.readTrimmedString)(req.query.readStatus).toLowerCase(), READ_STATUSES, "Status baca")
        : null;
    const search = (0, validation_1.readTrimmedString)(req.query.search);
    const conditions = ["1 = 1"];
    const params = [];
    if (employeeId) {
        conditions.push("f.pegawai_id = ?");
        params.push(employeeId);
    }
    if (feedbackType) {
        conditions.push("f.jenis_feedback = ?");
        params.push(feedbackType);
    }
    if (readStatus) {
        conditions.push("f.status_baca = ?");
        params.push(readStatus);
    }
    if (search) {
        conditions.push("(pegawai.nama_lengkap LIKE ? OR pemberi.nama_lengkap LIKE ? OR f.isi_feedback LIKE ?)");
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const [rows] = await database_1.pool.query(`SELECT f.id,
            f.periode_id AS periodeId,
            COALESCE(kp.nama_periode, '-') AS periodeName,
            f.pegawai_id AS pegawaiId,
            pegawai.nama_lengkap AS pegawaiName,
            f.pemberi_feedback_id AS pemberiFeedbackId,
            pemberi.nama_lengkap AS pemberiFeedbackName,
            f.indikator_kinerja_id AS indikatorKinerjaId,
            COALESCE(ik.nama, '-') AS indikatorKinerjaName,
            f.assignment_id AS assignmentId,
            COALESCE(a.judul, '-') AS assignmentTitle,
            f.jenis_feedback AS feedbackType,
            f.isi_feedback AS content,
            DATE_FORMAT(f.tanggal_feedback, '%Y-%m-%d') AS feedbackDate,
            f.status_baca AS readStatus,
            DATE_FORMAT(f.dibuat_pada, '%Y-%m-%d %H:%i:%s') AS createdAt,
            DATE_FORMAT(f.diperbarui_pada, '%Y-%m-%d %H:%i:%s') AS updatedAt
     FROM kinerja_umpan_balik f
     INNER JOIN pegawai pegawai ON pegawai.id = f.pegawai_id
     INNER JOIN pegawai pemberi ON pemberi.id = f.pemberi_feedback_id
     LEFT JOIN kinerja_periode kp ON kp.id = f.periode_id
     LEFT JOIN indikator_kinerja ik ON ik.id = f.indikator_kinerja_id
     LEFT JOIN kinerja_assignment a ON a.id = f.assignment_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY f.tanggal_feedback DESC, f.dibuat_pada DESC`, params);
    return (0, http_1.sendSuccess)(res, rows.map(buildFeedbackRecord));
});
exports.createKinerjaFeedback = (0, http_1.asyncHandler)(async (req, res) => {
    await ensureManagementSchema();
    const payload = normalizeFeedbackPayload(req.body || {});
    await ensureEmployeeExists(payload.pegawaiId);
    await ensureEmployeeExists(payload.pemberiFeedbackId);
    const [result] = await database_1.pool.query(`INSERT INTO kinerja_umpan_balik
      (periode_id, pegawai_id, pemberi_feedback_id, indikator_kinerja_id, assignment_id, jenis_feedback, isi_feedback, tanggal_feedback, status_baca)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        payload.periodeId,
        payload.pegawaiId,
        payload.pemberiFeedbackId,
        payload.indikatorKinerjaId,
        payload.assignmentId,
        payload.feedbackType,
        payload.content,
        payload.feedbackDate,
        payload.readStatus
    ]);
    await createNotification({
        employeeId: payload.pegawaiId,
        type: "feedback",
        title: `Umpan balik ${payload.feedbackType}`,
        content: payload.content,
        link: "/kinerja/feedback",
        referenceType: "feedback",
        referenceId: result.insertId
    });
    return (0, http_1.sendSuccess)(res, { id: result.insertId }, "Umpan balik berhasil ditambahkan", 201);
});
exports.updateKinerjaFeedback = (0, http_1.asyncHandler)(async (_req, res) => {
    await ensureManagementSchema();
    const id = (0, validation_1.readPositiveId)(_req.params.id, "Umpan balik");
    const payload = normalizeFeedbackPayload(_req.body || {});
    await ensureFeedbackExists(id);
    await ensureEmployeeExists(payload.pegawaiId);
    await ensureEmployeeExists(payload.pemberiFeedbackId);
    await database_1.pool.query(`UPDATE kinerja_umpan_balik
     SET periode_id = ?,
         pegawai_id = ?,
         pemberi_feedback_id = ?,
         indikator_kinerja_id = ?,
         assignment_id = ?,
         jenis_feedback = ?,
         isi_feedback = ?,
         tanggal_feedback = ?,
         status_baca = ?
     WHERE id = ?`, [
        payload.periodeId,
        payload.pegawaiId,
        payload.pemberiFeedbackId,
        payload.indikatorKinerjaId,
        payload.assignmentId,
        payload.feedbackType,
        payload.content,
        payload.feedbackDate,
        payload.readStatus,
        id
    ]);
    return (0, http_1.sendSuccess)(res, null, "Umpan balik berhasil diperbarui");
});
exports.markKinerjaFeedbackAsRead = (0, http_1.asyncHandler)(async (req, res) => {
    await ensureManagementSchema();
    const id = (0, validation_1.readPositiveId)(req.params.id, "Umpan balik");
    await ensureFeedbackExists(id);
    await database_1.pool.query(`UPDATE kinerja_umpan_balik SET status_baca = 'dibaca' WHERE id = ?`, [id]);
    return (0, http_1.sendSuccess)(res, null, "Umpan balik ditandai sudah dibaca");
});
exports.getKinerjaTargetChanges = (0, http_1.asyncHandler)(async (req, res) => {
    await ensureManagementSchema();
    const status = req.query.status
        ? (0, validation_1.ensureOneOf)((0, validation_1.readTrimmedString)(req.query.status).toLowerCase(), TARGET_CHANGE_STATUSES, "Status perubahan target")
        : null;
    const employeeId = req.query.employeeId ? (0, validation_1.readPositiveId)(req.query.employeeId, "Pegawai") : null;
    const search = (0, validation_1.readTrimmedString)(req.query.search);
    const conditions = ["1 = 1"];
    const params = [];
    if (status) {
        conditions.push("pt.status = ?");
        params.push(status);
    }
    if (employeeId) {
        conditions.push("iki.pegawai_id = ?");
        params.push(employeeId);
    }
    if (search) {
        conditions.push("(pegawai.nama_lengkap LIKE ? OR iki.nama_iki LIKE ? OR pt.alasan LIKE ?)");
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const [rows] = await database_1.pool.query(`SELECT pt.id,
            pt.iki_pegawai_id AS ikiPegawaiId,
            iki.nama_iki AS ikiName,
            iki.pegawai_id AS pegawaiId,
            pegawai.nama_lengkap AS pegawaiName,
            iki.periode_id AS periodeId,
            COALESCE(kp.nama_periode, '-') AS periodeName,
            pt.target_lama AS oldTarget,
            pt.target_baru AS newTarget,
            pt.alasan AS reason,
            COALESCE(pt.dampak_ke_nilai, '') AS impactNote,
            pt.diajukan_oleh AS requestedBy,
            pengaju.nama_lengkap AS requestedByName,
            DATE_FORMAT(pt.diajukan_pada, '%Y-%m-%d %H:%i:%s') AS requestedAt,
            pt.diproses_oleh AS processedBy,
            COALESCE(pemroses.nama_lengkap, '-') AS processedByName,
            DATE_FORMAT(pt.diproses_pada, '%Y-%m-%d %H:%i:%s') AS processedAt,
            COALESCE(pt.catatan_persetujuan, '') AS approvalNote,
            pt.status
     FROM kinerja_perubahan_target pt
     INNER JOIN kinerja_iki_pegawai iki ON iki.id = pt.iki_pegawai_id
     INNER JOIN pegawai pegawai ON pegawai.id = iki.pegawai_id
     INNER JOIN pegawai pengaju ON pengaju.id = pt.diajukan_oleh
     LEFT JOIN pegawai pemroses ON pemroses.id = pt.diproses_oleh
     LEFT JOIN kinerja_periode kp ON kp.id = iki.periode_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY pt.diajukan_pada DESC`, params);
    return (0, http_1.sendSuccess)(res, rows.map(buildTargetChangeRecord));
});
exports.createKinerjaTargetChange = (0, http_1.asyncHandler)(async (req, res) => {
    await ensureManagementSchema();
    const currentEmployeeId = req.user?.employeeId || null;
    const payload = normalizeTargetChangePayload(req.body || {}, currentEmployeeId);
    if (!payload.requestedBy)
        (0, http_1.fail)("Pengaju perubahan target tidak ditemukan", 400);
    await ensureIkiExists(payload.ikiPegawaiId);
    await ensureEmployeeExists(payload.requestedBy);
    const [[ikiRow]] = await database_1.pool.query(`SELECT iki.pegawai_id AS pegawaiId,
            iki.nama_iki AS ikiName
     FROM kinerja_iki_pegawai iki
     WHERE iki.id = ? LIMIT 1`, [payload.ikiPegawaiId]);
    const [result] = await database_1.pool.query(`INSERT INTO kinerja_perubahan_target
      (iki_pegawai_id, target_lama, target_baru, alasan, dampak_ke_nilai, diajukan_oleh, catatan_persetujuan, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'diajukan')`, [
        payload.ikiPegawaiId,
        payload.oldTarget,
        payload.newTarget,
        payload.reason,
        payload.impactNote || null,
        payload.requestedBy,
        payload.approvalNote || null
    ]);
    await createNotification({
        employeeId: Number(ikiRow?.pegawaiId || 0),
        type: "target_change",
        title: "Usulan perubahan target dibuat",
        content: `Usulan perubahan target untuk ${String(ikiRow?.ikiName || 'IKI')} telah dicatat.`,
        link: "/kinerja/target-changes",
        referenceType: "target_change",
        referenceId: result.insertId
    });
    return (0, http_1.sendSuccess)(res, { id: result.insertId }, "Usulan perubahan target berhasil ditambahkan", 201);
});
exports.approveKinerjaTargetChange = (0, http_1.asyncHandler)(async (req, res) => {
    await ensureManagementSchema();
    const id = (0, validation_1.readPositiveId)(req.params.id, "Perubahan target");
    await ensureTargetChangeExists(id);
    const approverId = req.user?.employeeId || null;
    const approvalNote = (0, validation_1.readTrimmedString)(req.body?.approvalNote);
    const [[changeRow]] = await database_1.pool.query(`SELECT pt.iki_pegawai_id AS ikiPegawaiId,
            pt.target_baru AS newTarget,
            iki.pegawai_id AS pegawaiId,
            iki.nama_iki AS ikiName
     FROM kinerja_perubahan_target pt
     INNER JOIN kinerja_iki_pegawai iki ON iki.id = pt.iki_pegawai_id
     WHERE pt.id = ? LIMIT 1`, [id]);
    if (!changeRow)
        (0, http_1.fail)("Perubahan target tidak ditemukan", 404);
    await database_1.pool.query(`UPDATE kinerja_perubahan_target
     SET status = 'disetujui', diproses_oleh = ?, diproses_pada = NOW(), catatan_persetujuan = ?
     WHERE id = ?`, [approverId, approvalNote || null, id]);
    await database_1.pool.query(`UPDATE kinerja_iki_pegawai
     SET target = ?
     WHERE id = ?`, [changeRow.newTarget, changeRow.ikiPegawaiId]);
    await createNotification({
        employeeId: Number(changeRow.pegawaiId || 0),
        type: "target_change",
        title: "Usulan perubahan target disetujui",
        content: `Usulan perubahan target untuk ${String(changeRow.ikiName || 'IKI')} telah disetujui.`,
        link: "/kinerja/target-changes",
        referenceType: "target_change",
        referenceId: id
    });
    return (0, http_1.sendSuccess)(res, null, "Usulan perubahan target disetujui");
});
exports.rejectKinerjaTargetChange = (0, http_1.asyncHandler)(async (req, res) => {
    await ensureManagementSchema();
    const id = (0, validation_1.readPositiveId)(req.params.id, "Perubahan target");
    await ensureTargetChangeExists(id);
    const approverId = req.user?.employeeId || null;
    const approvalNote = (0, validation_1.readTrimmedString)(req.body?.approvalNote);
    const [[changeRow]] = await database_1.pool.query(`SELECT iki.pegawai_id AS pegawaiId,
            iki.nama_iki AS ikiName
     FROM kinerja_perubahan_target pt
     INNER JOIN kinerja_iki_pegawai iki ON iki.id = pt.iki_pegawai_id
     WHERE pt.id = ? LIMIT 1`, [id]);
    await database_1.pool.query(`UPDATE kinerja_perubahan_target
     SET status = 'ditolak', diproses_oleh = ?, diproses_pada = NOW(), catatan_persetujuan = ?
     WHERE id = ?`, [approverId, approvalNote || null, id]);
    await createNotification({
        employeeId: Number(changeRow?.pegawaiId || 0),
        type: "target_change",
        title: "Usulan perubahan target ditolak",
        content: `Usulan perubahan target untuk ${String(changeRow?.ikiName || 'IKI')} ditolak.`,
        link: "/kinerja/target-changes",
        referenceType: "target_change",
        referenceId: id
    });
    return (0, http_1.sendSuccess)(res, null, "Usulan perubahan target ditolak");
});
exports.getKinerjaNotifications = (0, http_1.asyncHandler)(async (req, res) => {
    await ensureManagementSchema();
    const currentEmployeeId = req.user?.employeeId || null;
    const isPrivileged = ["super_admin", "admin_satker", "kepala_satker", "kasubbag_umum", "ketua_tim", "pejabat_penilai", "reviewer"].includes(String(req.user?.role || ""));
    const employeeId = req.query.employeeId ? (0, validation_1.readPositiveId)(req.query.employeeId, "Pegawai") : null;
    const readStatus = req.query.readStatus
        ? (0, validation_1.ensureOneOf)((0, validation_1.readTrimmedString)(req.query.readStatus).toLowerCase(), READ_STATUSES, "Status baca")
        : null;
    const search = (0, validation_1.readTrimmedString)(req.query.search);
    const conditions = [isPrivileged ? "1 = 1" : "n.pegawai_id = ?"];
    const params = [];
    if (!isPrivileged) {
        params.push(currentEmployeeId || 0);
    }
    if (employeeId) {
        conditions.push("n.pegawai_id = ?");
        params.push(employeeId);
    }
    if (readStatus) {
        conditions.push("n.status_baca = ?");
        params.push(readStatus);
    }
    if (search) {
        conditions.push("(p.nama_lengkap LIKE ? OR n.judul LIKE ? OR n.isi LIKE ?)");
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const [rows] = await database_1.pool.query(`SELECT n.id,
            n.pegawai_id AS pegawaiId,
            p.nama_lengkap AS pegawaiName,
            n.jenis_notifikasi AS notificationType,
            n.judul AS title,
            n.isi AS content,
            COALESCE(n.link_tujuan, '') AS targetLink,
            COALESCE(n.referensi_tipe, '') AS referenceType,
            n.referensi_id AS referenceId,
            n.status_baca AS readStatus,
            DATE_FORMAT(n.dibuat_pada, '%Y-%m-%d %H:%i:%s') AS createdAt,
            DATE_FORMAT(n.diperbarui_pada, '%Y-%m-%d %H:%i:%s') AS updatedAt
     FROM kinerja_notifikasi n
     INNER JOIN pegawai p ON p.id = n.pegawai_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY n.dibuat_pada DESC`, params);
    return (0, http_1.sendSuccess)(res, rows.map(buildNotificationRecord));
});
exports.markKinerjaNotificationAsRead = (0, http_1.asyncHandler)(async (req, res) => {
    await ensureManagementSchema();
    const id = (0, validation_1.readPositiveId)(req.params.id, "Notifikasi");
    await ensureNotificationExists(id);
    await database_1.pool.query(`UPDATE kinerja_notifikasi SET status_baca = 'dibaca' WHERE id = ?`, [id]);
    return (0, http_1.sendSuccess)(res, null, "Notifikasi ditandai sudah dibaca");
});
exports.markAllKinerjaNotificationsAsRead = (0, http_1.asyncHandler)(async (req, res) => {
    await ensureManagementSchema();
    const currentEmployeeId = req.user?.employeeId || null;
    const isPrivileged = ["super_admin", "admin_satker", "kepala_satker", "kasubbag_umum", "ketua_tim", "pejabat_penilai", "reviewer"].includes(String(req.user?.role || ""));
    const employeeId = req.body?.employeeId ? (0, validation_1.readPositiveId)(req.body.employeeId, "Pegawai") : currentEmployeeId;
    if (!employeeId)
        (0, http_1.fail)("Pegawai notifikasi tidak ditemukan", 400);
    if (!isPrivileged && employeeId !== currentEmployeeId)
        (0, http_1.fail)("Anda tidak memiliki hak akses untuk tindakan ini", 403);
    await database_1.pool.query(`UPDATE kinerja_notifikasi SET status_baca = 'dibaca' WHERE pegawai_id = ?`, [employeeId]);
    return (0, http_1.sendSuccess)(res, null, "Seluruh notifikasi ditandai sudah dibaca");
});
const DAILY_WORK_MONITORING_ROLES = [
    "super_admin",
    "admin_satker",
    "kepala_satker",
    "kasubbag_umum",
    "ketua_tim",
    "pejabat_penilai",
    "reviewer"
];
const toOptionalDashboardDate = (value) => {
    if (value === undefined || value === null || value === "")
        return null;
    return readOptionalDateString(value, "Tanggal dashboard");
};
const buildDailyWorkScope = (req, filters = {}, aliases = {}) => {
    const employeeAlias = aliases.employee || "p";
    const teamAlias = aliases.team || "tk";
    const assignmentAlias = aliases.assignment || "a";
    const currentEmployeeId = Number(req.user?.employeeId || 0);
    const currentRole = String(req.user?.role || "");
    const isMonitoringRole = DAILY_WORK_MONITORING_ROLES.includes(currentRole);
    const conditions = [];
    const params = [];
    if (filters.unitId) {
        conditions.push(`${employeeAlias}.departemen_id = ?`);
        params.push(filters.unitId);
    }
    if (filters.teamId) {
        conditions.push(`COALESCE(${teamAlias}.id, ${assignmentAlias}.tim_kerja_id) = ?`);
        params.push(filters.teamId);
    }
    if (!isMonitoringRole || currentRole === "pegawai") {
        conditions.push(`${employeeAlias}.id = ?`);
        params.push(currentEmployeeId || -1);
    }
    else if (currentRole === "ketua_tim") {
        conditions.push(`(
      ${employeeAlias}.id = ?
      OR EXISTS (
        SELECT 1
        FROM kinerja_tim_kerja scoped_team
        LEFT JOIN kinerja_tim_anggota scoped_member ON scoped_member.tim_kerja_id = scoped_team.id
        WHERE scoped_team.ketua_pegawai_id = ?
          AND (
            scoped_team.id = COALESCE(${teamAlias}.id, ${assignmentAlias}.tim_kerja_id)
            OR scoped_member.pegawai_id = ${employeeAlias}.id
          )
      )
    )`);
        params.push(currentEmployeeId || -1, currentEmployeeId || -1);
    }
    return {
        sql: conditions.length ? conditions.join(" AND ") : "1 = 1",
        params,
        roleMode: isMonitoringRole && currentRole !== "pegawai" ? "monitoring" : "pegawai"
    };
};
const readDailyWorkFilters = (req) => ({
    date: toOptionalDashboardDate(req.query.date),
    unitId: req.query.unitId ? readOptionalPositiveId(req.query.unitId, "Unit/Bidang") : null,
    teamId: req.query.teamId ? readOptionalPositiveId(req.query.teamId, "Tim kerja") : null
});
exports.getKinerjaDailyWorkDashboard = (0, http_1.asyncHandler)(async (req, res) => {
    await (0, kinerja_operational_controller_1.ensureOperationalSchema)();
    const filters = readDailyWorkFilters(req);
    const scope = buildDailyWorkScope(req, { unitId: filters.unitId, teamId: filters.teamId });
    const currentEmployeeId = Number(req.user?.employeeId || 0);
    const selectedDateParam = filters.date || null;
    const [currentEmployeeRows] = await database_1.pool.query(`SELECT
        p.id,
        p.nama_lengkap AS fullName,
        p.nip,
        p.nama_jabatan AS positionName,
        p.departemen_id AS unitId,
        d.nama AS unitName,
        COALESCE(member_team.nama_tim, leader_team.nama_tim, '') AS teamName
     FROM pegawai p
     LEFT JOIN departemen d ON d.id = p.departemen_id
     LEFT JOIN kinerja_tim_anggota ta ON ta.pegawai_id = p.id
     LEFT JOIN kinerja_tim_kerja member_team ON member_team.id = ta.tim_kerja_id AND member_team.status = 'aktif'
     LEFT JOIN kinerja_tim_kerja leader_team ON leader_team.ketua_pegawai_id = p.id AND leader_team.status = 'aktif'
     WHERE p.id = ?
     GROUP BY p.id, p.nama_lengkap, p.nip, p.nama_jabatan, p.departemen_id, d.nama, member_team.nama_tim, leader_team.nama_tim
     LIMIT 1`, [currentEmployeeId || -1]);
    const [unitRows] = await database_1.pool.query(`SELECT id, nama AS name FROM departemen ORDER BY nama ASC`);
    const [teamRows] = await database_1.pool.query(`SELECT id, nama_tim AS name FROM kinerja_tim_kerja WHERE status = 'aktif' ORDER BY nama_tim ASC`);
    const [activeActivityRows] = await database_1.pool.query(`SELECT
        l.id,
        l.assignment_id AS assignmentId,
        COALESCE(NULLIF(l.uraian_kegiatan, ''), a.judul, 'Aktivitas tanpa uraian') AS activityTitle,
        COALESCE(a.judul, 'Tanpa penugasan') AS assignmentTitle,
        ${(0, kinerja_timer_helper_1.activityStatusSql)("l")} AS activityStatus,
        DATE_FORMAT(l.started_at, '%Y-%m-%dT%H:%i:%s') AS startedAt,
        DATE_FORMAT(l.paused_at, '%Y-%m-%dT%H:%i:%s') AS pausedAt,
        DATE_FORMAT(l.finished_at, '%Y-%m-%dT%H:%i:%s') AS finishedAt,
        DATE_FORMAT(l.last_activity_at, '%Y-%m-%dT%H:%i:%s') AS lastActivityAt,
        DATE_FORMAT(NOW(), '%Y-%m-%dT%H:%i:%s') AS serverNow,
        COALESCE(l.total_paused_seconds, 0) AS totalPausedSeconds,
        ${(0, kinerja_timer_helper_1.getTimerDurationSecondsSql)("l")} AS activeDurationSeconds,
        COALESCE(l.volume, 0) AS volumeRealisasi,
        COALESCE(s.nama_satuan, '') AS satuan,
        DATE_FORMAT(a.target_selesai, '%Y-%m-%d') AS dueDate,
        IF(a.target_selesai IS NOT NULL AND a.target_selesai < CURDATE() AND ${(0, kinerja_timer_helper_1.activityStatusSql)("l")} IN ('berjalan','jeda'), 1, 0) AS isOverdue
     FROM kinerja_logbook l
     LEFT JOIN kinerja_assignment a ON a.id = l.assignment_id
     LEFT JOIN kinerja_tim_kerja tk ON tk.id = COALESCE(l.tim_kerja_id, a.tim_kerja_id)
     LEFT JOIN kinerja_satuan s ON s.id = l.satuan_id
     WHERE l.pegawai_id = ?
       AND ${(0, kinerja_timer_helper_1.activityStatusSql)("l")} IN ('berjalan','jeda')
     ORDER BY COALESCE(l.last_activity_at, l.started_at, l.diperbarui_pada, l.dibuat_pada) DESC
     LIMIT 1`, [currentEmployeeId || -1]);
    const [assignmentSummaryRows] = await database_1.pool.query(`SELECT
        COUNT(CASE WHEN a.status <> 'selesai' THEN 1 END) AS activeAssignments,
        COUNT(CASE WHEN a.status <> 'selesai' AND a.target_selesai = COALESCE(?, CURDATE()) THEN 1 END) AS dueToday,
        COUNT(CASE WHEN a.status <> 'selesai' AND a.target_selesai IS NOT NULL AND a.target_selesai < COALESCE(?, CURDATE()) THEN 1 END) AS overdue,
        COUNT(CASE WHEN a.status = 'selesai' AND YEAR(a.diperbarui_pada) = YEAR(COALESCE(?, CURDATE())) AND MONTH(a.diperbarui_pada) = MONTH(COALESCE(?, CURDATE())) THEN 1 END) AS completedThisMonth
     FROM kinerja_assignment a
     WHERE a.pegawai_id = ?`, [selectedDateParam, selectedDateParam, selectedDateParam, selectedDateParam, currentEmployeeId || -1]);
    const [priorityAssignmentRows] = await database_1.pool.query(`SELECT
        a.id,
        a.judul AS title,
        a.status,
        a.progres AS progress,
        a.prioritas AS priority,
        DATE_FORMAT(a.target_selesai, '%Y-%m-%d') AS dueDate,
        COALESCE(tk.nama_tim, '-') AS teamName,
        IF(a.target_selesai IS NOT NULL AND a.target_selesai < COALESCE(?, CURDATE()) AND a.status <> 'selesai', 1, 0) AS isOverdue
     FROM kinerja_assignment a
     LEFT JOIN kinerja_tim_kerja tk ON tk.id = a.tim_kerja_id
     WHERE a.pegawai_id = ?
       AND a.status <> 'selesai'
     ORDER BY isOverdue DESC,
              CASE a.prioritas WHEN 'tinggi' THEN 1 WHEN 'sedang' THEN 2 ELSE 3 END,
              CASE WHEN a.target_selesai IS NULL THEN 1 ELSE 0 END,
              a.target_selesai ASC,
              a.diperbarui_pada DESC
     LIMIT 8`, [selectedDateParam, currentEmployeeId || -1]);
    const [recentActivityRows] = await database_1.pool.query(`SELECT
        l.id,
        COALESCE(NULLIF(l.uraian_kegiatan, ''), a.judul, 'Aktivitas tanpa uraian') AS activityTitle,
        COALESCE(a.judul, 'Tanpa penugasan') AS assignmentTitle,
        ${(0, kinerja_timer_helper_1.activityStatusSql)("l")} AS activityStatus,
        DATE_FORMAT(l.started_at, '%Y-%m-%dT%H:%i:%s') AS startedAt,
        DATE_FORMAT(l.paused_at, '%Y-%m-%dT%H:%i:%s') AS pausedAt,
        DATE_FORMAT(l.finished_at, '%Y-%m-%dT%H:%i:%s') AS finishedAt,
        DATE_FORMAT(l.last_activity_at, '%Y-%m-%dT%H:%i:%s') AS lastActivityAt,
        DATE_FORMAT(NOW(), '%Y-%m-%dT%H:%i:%s') AS serverNow,
        COALESCE(l.total_paused_seconds, 0) AS totalPausedSeconds,
        ${(0, kinerja_timer_helper_1.getTimerDurationSecondsSql)("l")} AS activeDurationSeconds
     FROM kinerja_logbook l
     LEFT JOIN kinerja_assignment a ON a.id = l.assignment_id
     WHERE l.pegawai_id = ?
     ORDER BY COALESCE(l.last_activity_at, l.finished_at, l.started_at, l.diperbarui_pada, l.dibuat_pada) DESC
     LIMIT 5`, [currentEmployeeId || -1]);
    const [realtimeSummaryRows] = await database_1.pool.query(`SELECT
        COUNT(CASE WHEN ${(0, kinerja_timer_helper_1.activityStatusSql)("l")} = 'berjalan' THEN 1 END) AS running,
        COUNT(CASE WHEN ${(0, kinerja_timer_helper_1.activityStatusSql)("l")} = 'jeda' THEN 1 END) AS paused,
        COUNT(CASE WHEN ${(0, kinerja_timer_helper_1.activityStatusSql)("l")} = 'selesai' THEN 1 END) AS finishedToday,
        COUNT(CASE WHEN a.target_selesai IS NOT NULL AND a.target_selesai < COALESCE(?, CURDATE()) AND ${(0, kinerja_timer_helper_1.activityStatusSql)("l")} IN ('berjalan','jeda') THEN 1 END) AS overdue
     FROM kinerja_logbook l
     INNER JOIN pegawai p ON p.id = l.pegawai_id
     LEFT JOIN kinerja_assignment a ON a.id = l.assignment_id
     LEFT JOIN kinerja_tim_kerja tk ON tk.id = COALESCE(l.tim_kerja_id, a.tim_kerja_id)
     WHERE (${scope.sql})
       AND (
         l.tanggal_kegiatan = COALESCE(?, CURDATE())
         OR DATE(COALESCE(l.started_at, l.dibuat_pada)) = COALESCE(?, CURDATE())
       )
       AND ${(0, kinerja_timer_helper_1.activityStatusSql)("l")} IN ('berjalan','jeda','selesai')`, [selectedDateParam, ...scope.params, selectedDateParam, selectedDateParam]);
    const [attentionRows] = await database_1.pool.query(`SELECT
        l.id,
        p.nama_lengkap AS employeeName,
        COALESCE(d.nama, '-') AS unitName,
        COALESCE(tk.nama_tim, '-') AS teamName,
        COALESCE(NULLIF(l.uraian_kegiatan, ''), a.judul, 'Aktivitas tanpa uraian') AS activityTitle,
        COALESCE(a.judul, 'Tanpa penugasan') AS assignmentTitle,
        ${(0, kinerja_timer_helper_1.activityStatusSql)("l")} AS activityStatus,
        ${(0, kinerja_timer_helper_1.getTimerDurationSecondsSql)("l")} AS activeDurationSeconds,
        COALESCE(l.total_paused_seconds, 0) AS totalPausedSeconds,
        DATE_FORMAT(l.started_at, '%Y-%m-%dT%H:%i:%s') AS startedAt,
        DATE_FORMAT(l.paused_at, '%Y-%m-%dT%H:%i:%s') AS pausedAt,
        DATE_FORMAT(l.finished_at, '%Y-%m-%dT%H:%i:%s') AS finishedAt,
        DATE_FORMAT(NOW(), '%Y-%m-%dT%H:%i:%s') AS serverNow,
        DATE_FORMAT(a.target_selesai, '%Y-%m-%d') AS dueDate,
        CASE
          WHEN a.target_selesai IS NOT NULL AND a.target_selesai < COALESCE(?, CURDATE()) AND ${(0, kinerja_timer_helper_1.activityStatusSql)("l")} IN ('berjalan','jeda') THEN 'Melewati batas akhir penugasan'
          WHEN ${(0, kinerja_timer_helper_1.activityStatusSql)("l")} = 'berjalan' AND ${(0, kinerja_timer_helper_1.getTimerDurationSecondsSql)("l")} >= 14400 THEN 'Aktivitas berjalan lebih dari 4 jam'
          WHEN ${(0, kinerja_timer_helper_1.activityStatusSql)("l")} = 'jeda' AND l.paused_at IS NOT NULL AND TIMESTAMPDIFF(SECOND, l.paused_at, NOW()) >= 3600 THEN 'Aktivitas jeda lebih dari 1 jam'
          ELSE 'Perlu ditinjau'
        END AS reason,
        IF(a.target_selesai IS NOT NULL AND a.target_selesai < COALESCE(?, CURDATE()) AND ${(0, kinerja_timer_helper_1.activityStatusSql)("l")} IN ('berjalan','jeda'), 1, 0) AS isOverdue
     FROM kinerja_logbook l
     INNER JOIN pegawai p ON p.id = l.pegawai_id
     LEFT JOIN departemen d ON d.id = p.departemen_id
     LEFT JOIN kinerja_assignment a ON a.id = l.assignment_id
     LEFT JOIN kinerja_tim_kerja tk ON tk.id = COALESCE(l.tim_kerja_id, a.tim_kerja_id)
     WHERE (${scope.sql})
       AND ${(0, kinerja_timer_helper_1.activityStatusSql)("l")} IN ('berjalan','jeda')
       AND (
         (a.target_selesai IS NOT NULL AND a.target_selesai < COALESCE(?, CURDATE()))
         OR (${(0, kinerja_timer_helper_1.activityStatusSql)("l")} = 'berjalan' AND ${(0, kinerja_timer_helper_1.getTimerDurationSecondsSql)("l")} >= 14400)
         OR (${(0, kinerja_timer_helper_1.activityStatusSql)("l")} = 'jeda' AND l.paused_at IS NOT NULL AND TIMESTAMPDIFF(SECOND, l.paused_at, NOW()) >= 3600)
       )
     ORDER BY isOverdue DESC, activeDurationSeconds DESC, COALESCE(l.last_activity_at, l.started_at, l.diperbarui_pada) DESC
     LIMIT 8`, [selectedDateParam, selectedDateParam, ...scope.params, selectedDateParam]);
    const [todayActivityRows] = await database_1.pool.query(`SELECT
        l.id,
        p.id AS employeeId,
        p.nama_lengkap AS employeeName,
        COALESCE(d.nama, '-') AS unitName,
        COALESCE(tk.nama_tim, '-') AS teamName,
        COALESCE(NULLIF(l.uraian_kegiatan, ''), a.judul, 'Aktivitas tanpa uraian') AS activityTitle,
        COALESCE(a.judul, 'Tanpa penugasan') AS assignmentTitle,
        ${(0, kinerja_timer_helper_1.activityStatusSql)("l")} AS activityStatus,
        DATE_FORMAT(l.started_at, '%Y-%m-%dT%H:%i:%s') AS startedAt,
        DATE_FORMAT(l.paused_at, '%Y-%m-%dT%H:%i:%s') AS pausedAt,
        DATE_FORMAT(l.finished_at, '%Y-%m-%dT%H:%i:%s') AS finishedAt,
        DATE_FORMAT(l.last_activity_at, '%Y-%m-%dT%H:%i:%s') AS lastActivityAt,
        DATE_FORMAT(NOW(), '%Y-%m-%dT%H:%i:%s') AS serverNow,
        COALESCE(l.total_paused_seconds, 0) AS totalPausedSeconds,
        ${(0, kinerja_timer_helper_1.getTimerDurationSecondsSql)("l")} AS activeDurationSeconds,
        COALESCE(l.volume, 0) AS volumeRealisasi,
        COALESCE(s.nama_satuan, '') AS satuan,
        DATE_FORMAT(a.target_selesai, '%Y-%m-%d') AS dueDate,
        IF(a.target_selesai IS NOT NULL AND a.target_selesai < COALESCE(?, CURDATE()) AND ${(0, kinerja_timer_helper_1.activityStatusSql)("l")} IN ('berjalan','jeda'), 1, 0) AS isOverdue
     FROM kinerja_logbook l
     INNER JOIN pegawai p ON p.id = l.pegawai_id
     LEFT JOIN departemen d ON d.id = p.departemen_id
     LEFT JOIN kinerja_assignment a ON a.id = l.assignment_id
     LEFT JOIN kinerja_tim_kerja tk ON tk.id = COALESCE(l.tim_kerja_id, a.tim_kerja_id)
     LEFT JOIN kinerja_satuan s ON s.id = l.satuan_id
     WHERE (${scope.sql})
       AND (
         l.tanggal_kegiatan = COALESCE(?, CURDATE())
         OR DATE(COALESCE(l.started_at, l.dibuat_pada)) = COALESCE(?, CURDATE())
       )
       AND ${(0, kinerja_timer_helper_1.activityStatusSql)("l")} IN ('berjalan','jeda','selesai')
     ORDER BY isOverdue DESC,
              FIELD(${(0, kinerja_timer_helper_1.activityStatusSql)("l")}, 'berjalan', 'jeda', 'selesai'),
              COALESCE(l.last_activity_at, l.started_at, l.diperbarui_pada, l.dibuat_pada) DESC
     LIMIT 10`, [selectedDateParam, ...scope.params, selectedDateParam, selectedDateParam]);
    const [statusTrendRows] = await database_1.pool.query(`SELECT
        ${(0, kinerja_timer_helper_1.activityStatusSql)("l")} AS activityStatus,
        COUNT(*) AS total
     FROM kinerja_logbook l
     INNER JOIN pegawai p ON p.id = l.pegawai_id
     LEFT JOIN kinerja_assignment a ON a.id = l.assignment_id
     LEFT JOIN kinerja_tim_kerja tk ON tk.id = COALESCE(l.tim_kerja_id, a.tim_kerja_id)
     WHERE (${scope.sql})
       AND (
         l.tanggal_kegiatan = COALESCE(?, CURDATE())
         OR DATE(COALESCE(l.started_at, l.dibuat_pada)) = COALESCE(?, CURDATE())
       )
       AND ${(0, kinerja_timer_helper_1.activityStatusSql)("l")} IN ('berjalan','jeda','selesai')
     GROUP BY ${(0, kinerja_timer_helper_1.activityStatusSql)("l")}`, [...scope.params, selectedDateParam, selectedDateParam]);
    const realtimeSummary = realtimeSummaryRows[0] || {};
    const statusDistribution = {
        running: 0,
        paused: 0,
        finished: 0
    };
    statusTrendRows.forEach((row) => {
        if (row.activityStatus === "berjalan")
            statusDistribution.running = Number(row.total || 0);
        if (row.activityStatus === "jeda")
            statusDistribution.paused = Number(row.total || 0);
        if (row.activityStatus === "selesai")
            statusDistribution.finished = Number(row.total || 0);
    });
    const [selectedDateRows] = await database_1.pool.query(`SELECT DATE_FORMAT(COALESCE(?, CURDATE()), '%Y-%m-%d') AS selectedDate,
            DATE_FORMAT(NOW(), '%Y-%m-%dT%H:%i:%s') AS serverNow`, [selectedDateParam]);
    const selectedDateInfo = selectedDateRows[0] || {};
    return (0, http_1.sendSuccess)(res, {
        source: "kinerja-daily-work-dashboard-v1",
        roleMode: scope.roleMode,
        serverNow: selectedDateInfo.serverNow,
        date: selectedDateInfo.selectedDate,
        currentUser: {
            employeeId: currentEmployeeId || null,
            fullName: req.user?.fullName || currentEmployeeRows[0]?.fullName || "-",
            nip: req.user?.nip || currentEmployeeRows[0]?.nip || "-",
            role: req.user?.role || "pegawai",
            unitName: currentEmployeeRows[0]?.unitName || "-",
            teamName: currentEmployeeRows[0]?.teamName || "-",
            positionName: currentEmployeeRows[0]?.positionName || "-"
        },
        lookups: {
            units: unitRows.map((row) => ({ id: Number(row.id), name: String(row.name || "-") })),
            teams: teamRows.map((row) => ({ id: Number(row.id), name: String(row.name || "-") }))
        },
        employee: {
            activeActivity: activeActivityRows[0] || null,
            assignmentSummary: {
                activeAssignments: Number(assignmentSummaryRows[0]?.activeAssignments || 0),
                dueToday: Number(assignmentSummaryRows[0]?.dueToday || 0),
                overdue: Number(assignmentSummaryRows[0]?.overdue || 0),
                completedThisMonth: Number(assignmentSummaryRows[0]?.completedThisMonth || 0)
            },
            priorityAssignments: priorityAssignmentRows,
            recentActivities: recentActivityRows
        },
        monitoring: {
            realtimeSummary: {
                running: Number(realtimeSummary.running || 0),
                paused: Number(realtimeSummary.paused || 0),
                finishedToday: Number(realtimeSummary.finishedToday || 0),
                overdue: Number(realtimeSummary.overdue || 0)
            },
            attentionItems: attentionRows,
            todayActivities: todayActivityRows,
            statusDistribution
        }
    });
});
