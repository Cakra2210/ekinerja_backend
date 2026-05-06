"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRankings = exports.updateEvaluation = exports.createEvaluation = exports.getEvaluations = void 0;
const database_1 = require("../../config/database");
const http_1 = require("../../shared/http");
const validation_1 = require("../../shared/validation");
const monthNames = [
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember"
];
const clampScore = (value) => {
    if (Number.isNaN(value))
        return 0;
    if (value < 0)
        return 0;
    if (value > 100)
        return 100;
    return Number(value.toFixed(2));
};
const normalizeEvaluationPayload = (body) => {
    const evaluationYear = Number(body.evaluationYear);
    const evaluationMonth = Number(body.evaluationMonth);
    const performanceAchievement = clampScore(Number(body.performanceAchievement));
    if (!Number.isInteger(evaluationYear) || evaluationYear < 2000 || evaluationYear > 2100) {
        (0, http_1.fail)("Tahun penilaian bulanan tidak valid", 400);
    }
    if (!Number.isInteger(evaluationMonth) || evaluationMonth < 1 || evaluationMonth > 12) {
        (0, http_1.fail)("Bulan penilaian bulanan tidak valid", 400);
    }
    return {
        employeeId: (0, validation_1.readPositiveId)(body.employeeId, "Pegawai"),
        evaluationYear,
        evaluationMonth,
        performanceAchievement,
        note: (0, validation_1.readTrimmedString)(body.note)
    };
};
const formatPeriodName = (year, month) => `${monthNames[month - 1]} ${year}`;
const getMonthlyPeriodDates = (year, month) => {
    const monthLabel = String(month).padStart(2, "0");
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
        startDate: `${year}-${monthLabel}-01`,
        endDate: `${year}-${monthLabel}-${String(lastDay).padStart(2, "0")}`
    };
};
const resolvePeriodStatus = (year, month) => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    if (year > currentYear || (year === currentYear && month >= currentMonth)) {
        return "Aktif";
    }
    return "Selesai";
};
const ensureMonthlyPeriod = async (year, month) => {
    const { startDate, endDate } = getMonthlyPeriodDates(year, month);
    const [existingRows] = await database_1.pool.query(`SELECT id
     FROM periode_evaluasi
     WHERE tanggal_mulai = ? AND tanggal_selesai = ?
     LIMIT 1`, [startDate, endDate]);
    if (existingRows.length) {
        return Number(existingRows[0].id);
    }
    const [result] = await database_1.pool.query(`INSERT INTO periode_evaluasi (nama, tanggal_mulai, tanggal_selesai, status)
     VALUES (?, ?, ?, ?)`, [formatPeriodName(year, month), startDate, endDate, resolvePeriodStatus(year, month)]);
    return Number(result.insertId);
};
const buildEvaluationSelect = () => `SELECT ev.id,
            ev.pegawai_id AS employeeId,
            e.nama_lengkap AS employeeName,
            e.nip,
            '' AS departmentName,
            ev.periode_evaluasi_id AS periodId,
            COALESCE(p.nama, CONCAT(LPAD(MONTH(p.tanggal_mulai), 2, '0'), '-', YEAR(p.tanggal_mulai))) AS periodName,
            YEAR(p.tanggal_mulai) AS evaluationYear,
            MONTH(p.tanggal_mulai) AS evaluationMonth,
            ev.nama_penilai AS evaluatorName,
            ev.productivity AS performanceAchievement,
            ev.skor_akhir AS finalScore,
            COALESCE(ev.note, '') AS note,
            DATE_FORMAT(ev.dibuat_pada, '%Y-%m-%d %H:%i:%s') AS createdAt
     FROM evaluasi_kinerja ev
     INNER JOIN pegawai e ON e.id = ev.pegawai_id
     INNER JOIN periode_evaluasi p ON p.id = ev.periode_evaluasi_id`;
exports.getEvaluations = (0, http_1.asyncHandler)(async (req, res) => {
    const currentUser = req.user;
    const params = [];
    let filterSql = "";
    if (currentUser?.role === "pegawai") {
        filterSql = " WHERE ev.pegawai_id = ?";
        params.push(currentUser.employeeId);
    }
    const [rows] = await database_1.pool.query(`${buildEvaluationSelect()}
     ${filterSql}
     ORDER BY YEAR(p.tanggal_mulai) DESC,
              MONTH(p.tanggal_mulai) DESC,
              e.nama_lengkap ASC,
              ev.dibuat_pada DESC`, params);
    return (0, http_1.sendSuccess)(res, rows);
});
exports.createEvaluation = (0, http_1.asyncHandler)(async (req, res) => {
    if (!req.user) {
        (0, http_1.fail)("Sesi login tidak ditemukan", 401);
    }
    const currentUser = req.user;
    const payload = normalizeEvaluationPayload(req.body);
    const periodId = await ensureMonthlyPeriod(payload.evaluationYear, payload.evaluationMonth);
    const [existingRows] = await database_1.pool.query(`SELECT id
     FROM evaluasi_kinerja
     WHERE pegawai_id = ? AND periode_evaluasi_id = ?
     LIMIT 1`, [payload.employeeId, periodId]);
    if (existingRows.length) {
        (0, http_1.fail)("Pegawai ini sudah dinilai pada periode bulanan tersebut", 409);
    }
    const score = payload.performanceAchievement;
    const [result] = await database_1.pool.query(`INSERT INTO evaluasi_kinerja
     (pegawai_id, periode_evaluasi_id, nama_penilai, teamwork, discipline,
      productivity, initiative, communication, skor_akhir, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        payload.employeeId,
        periodId,
        currentUser.fullName,
        score,
        score,
        score,
        score,
        score,
        score,
        payload.note
    ]);
    return (0, http_1.sendSuccess)(res, {
        id: result.insertId,
        employeeId: payload.employeeId,
        periodId,
        evaluationYear: payload.evaluationYear,
        evaluationMonth: payload.evaluationMonth,
        evaluatorName: currentUser.fullName,
        performanceAchievement: score,
        finalScore: score,
        note: payload.note
    }, "Penilaian SKP bulanan berhasil disimpan", 201);
});
exports.updateEvaluation = (0, http_1.asyncHandler)(async (req, res) => {
    if (!req.user) {
        (0, http_1.fail)("Sesi login tidak ditemukan", 401);
    }
    const currentUser = req.user;
    const evaluationId = (0, validation_1.readPositiveId)(req.params.id, "ID penilaian");
    const payload = normalizeEvaluationPayload(req.body);
    const periodId = await ensureMonthlyPeriod(payload.evaluationYear, payload.evaluationMonth);
    const [currentRows] = await database_1.pool.query(`SELECT id,
            pegawai_id AS employeeId,
            nama_penilai AS evaluatorName
     FROM evaluasi_kinerja
     WHERE id = ?
     LIMIT 1`, [evaluationId]);
    if (!currentRows.length) {
        (0, http_1.fail)("Data penilaian tidak ditemukan", 404);
    }
    if (currentUser.role === "pegawai" && Number(currentRows[0].employeeId) !== currentUser.employeeId) {
        (0, http_1.fail)("Anda hanya dapat mengubah nilai milik akun Anda sendiri", 403);
    }
    const [duplicateRows] = await database_1.pool.query(`SELECT id
     FROM evaluasi_kinerja
     WHERE pegawai_id = ? AND periode_evaluasi_id = ? AND id <> ?
     LIMIT 1`, [payload.employeeId, periodId, evaluationId]);
    if (duplicateRows.length) {
        (0, http_1.fail)("Pegawai ini sudah memiliki penilaian pada periode bulanan tersebut", 409);
    }
    const score = payload.performanceAchievement;
    const [result] = await database_1.pool.query(`UPDATE evaluasi_kinerja
     SET pegawai_id = ?,
         periode_evaluasi_id = ?,
         nama_penilai = ?,
         teamwork = ?,
         discipline = ?,
         productivity = ?,
         initiative = ?,
         communication = ?,
         skor_akhir = ?,
         note = ?
     WHERE id = ?`, [
        payload.employeeId,
        periodId,
        currentUser.fullName,
        score,
        score,
        score,
        score,
        score,
        score,
        payload.note,
        evaluationId
    ]);
    if (result.affectedRows === 0) {
        (0, http_1.fail)("Data penilaian tidak ditemukan", 404);
    }
    return (0, http_1.sendSuccess)(res, {
        id: evaluationId,
        employeeId: payload.employeeId,
        periodId,
        evaluationYear: payload.evaluationYear,
        evaluationMonth: payload.evaluationMonth,
        evaluatorName: currentUser.fullName,
        performanceAchievement: score,
        finalScore: score,
        note: payload.note
    }, "Penilaian SKP bulanan berhasil diperbarui");
});
exports.getRankings = (0, http_1.asyncHandler)(async (_req, res) => {
    const [rows] = await database_1.pool.query(`SELECT e.id,
            e.nip,
            e.nama_lengkap AS fullName,
            e.nama_jabatan AS position,
            '' AS departmentName,
            ROUND(COALESCE(AVG(ev.skor_akhir), 0), 2) AS averageScore,
            COUNT(ev.id) AS totalEvaluations
     FROM pegawai e
     LEFT JOIN evaluasi_kinerja ev ON ev.pegawai_id = e.id
     GROUP BY e.id, e.nip, e.nama_lengkap, e.nama_jabatan
     ORDER BY averageScore DESC, e.nama_lengkap ASC`);
    const data = rows.map((row, index) => ({
        rank: index + 1,
        ...row
    }));
    return (0, http_1.sendSuccess)(res, data);
});
