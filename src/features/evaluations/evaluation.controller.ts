import { ResultSetHeader } from "mysql2";
import { pool } from "../../config/database";
import { EvaluationInput } from "../../types";
import { asyncHandler, fail, sendSuccess } from "../../shared/http";
import { readPositiveId, readTrimmedString } from "../../shared/validation";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware";

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

const clampScore = (value: number) => {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Number(value.toFixed(2));
};

const normalizeEvaluationPayload = (body: Record<string, unknown>): EvaluationInput => {
  const evaluationYear = Number(body.evaluationYear);
  const evaluationMonth = Number(body.evaluationMonth);
  const performanceAchievement = clampScore(Number(body.performanceAchievement));

  if (!Number.isInteger(evaluationYear) || evaluationYear < 2000 || evaluationYear > 2100) {
    fail("Tahun penilaian bulanan tidak valid", 400);
  }

  if (!Number.isInteger(evaluationMonth) || evaluationMonth < 1 || evaluationMonth > 12) {
    fail("Bulan penilaian bulanan tidak valid", 400);
  }

  return {
    employeeId: readPositiveId(body.employeeId, "Pegawai"),
    evaluationYear,
    evaluationMonth,
    performanceAchievement,
    note: readTrimmedString(body.note)
  };
};

const formatPeriodName = (year: number, month: number) => `${monthNames[month - 1]} ${year}`;

const getMonthlyPeriodDates = (year: number, month: number) => {
  const monthLabel = String(month).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return {
    startDate: `${year}-${monthLabel}-01`,
    endDate: `${year}-${monthLabel}-${String(lastDay).padStart(2, "0")}`
  };
};

const resolvePeriodStatus = (year: number, month: number) => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  if (year > currentYear || (year === currentYear && month >= currentMonth)) {
    return "Aktif";
  }

  return "Selesai";
};

const ensureMonthlyPeriod = async (year: number, month: number) => {
  const { startDate, endDate } = getMonthlyPeriodDates(year, month);

  const [existingRows] = await pool.query<any[]>(
    `SELECT id
     FROM periode_evaluasi
     WHERE tanggal_mulai = ? AND tanggal_selesai = ?
     LIMIT 1`,
    [startDate, endDate]
  );

  if (existingRows.length) {
    return Number(existingRows[0].id);
  }

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO periode_evaluasi (nama, tanggal_mulai, tanggal_selesai, status)
     VALUES (?, ?, ?, ?)`,
    [formatPeriodName(year, month), startDate, endDate, resolvePeriodStatus(year, month)]
  );

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

export const getEvaluations = asyncHandler(async (req: AuthenticatedRequest, res) => {
  const currentUser = req.user;
  const params: Array<string | number> = [];
  let filterSql = "";

  if (currentUser?.role === "pegawai") {
    filterSql = " WHERE ev.pegawai_id = ?";
    params.push(currentUser.employeeId);
  }

  const [rows] = await pool.query<any[]>(
    `${buildEvaluationSelect()}
     ${filterSql}
     ORDER BY YEAR(p.tanggal_mulai) DESC,
              MONTH(p.tanggal_mulai) DESC,
              e.nama_lengkap ASC,
              ev.dibuat_pada DESC`,
    params
  );

  return sendSuccess(res, rows);
});

export const createEvaluation = asyncHandler(async (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    fail("Sesi login tidak ditemukan", 401);
  }

  const currentUser = req.user!;
  const payload = normalizeEvaluationPayload(req.body as Record<string, unknown>);
  const periodId = await ensureMonthlyPeriod(payload.evaluationYear, payload.evaluationMonth);

  const [existingRows] = await pool.query<any[]>(
    `SELECT id
     FROM evaluasi_kinerja
     WHERE pegawai_id = ? AND periode_evaluasi_id = ?
     LIMIT 1`,
    [payload.employeeId, periodId]
  );

  if (existingRows.length) {
    fail("Pegawai ini sudah dinilai pada periode bulanan tersebut", 409);
  }

  const score = payload.performanceAchievement;

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO evaluasi_kinerja
     (pegawai_id, periode_evaluasi_id, nama_penilai, teamwork, discipline,
      productivity, initiative, communication, skor_akhir, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
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
    ]
  );

  return sendSuccess(
    res,
    {
      id: result.insertId,
      employeeId: payload.employeeId,
      periodId,
      evaluationYear: payload.evaluationYear,
      evaluationMonth: payload.evaluationMonth,
      evaluatorName: currentUser.fullName,
      performanceAchievement: score,
      finalScore: score,
      note: payload.note
    },
    "Penilaian SKP bulanan berhasil disimpan",
    201
  );
});

export const updateEvaluation = asyncHandler(async (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    fail("Sesi login tidak ditemukan", 401);
  }

  const currentUser = req.user!;
  const evaluationId = readPositiveId(req.params.id, "ID penilaian");
  const payload = normalizeEvaluationPayload(req.body as Record<string, unknown>);
  const periodId = await ensureMonthlyPeriod(payload.evaluationYear, payload.evaluationMonth);

  const [currentRows] = await pool.query<any[]>(
    `SELECT id,
            pegawai_id AS employeeId,
            nama_penilai AS evaluatorName
     FROM evaluasi_kinerja
     WHERE id = ?
     LIMIT 1`,
    [evaluationId]
  );

  if (!currentRows.length) {
    fail("Data penilaian tidak ditemukan", 404);
  }

  if (currentUser.role === "pegawai" && Number(currentRows[0].employeeId) !== currentUser.employeeId) {
    fail("Anda hanya dapat mengubah nilai milik akun Anda sendiri", 403);
  }

  const [duplicateRows] = await pool.query<any[]>(
    `SELECT id
     FROM evaluasi_kinerja
     WHERE pegawai_id = ? AND periode_evaluasi_id = ? AND id <> ?
     LIMIT 1`,
    [payload.employeeId, periodId, evaluationId]
  );

  if (duplicateRows.length) {
    fail("Pegawai ini sudah memiliki penilaian pada periode bulanan tersebut", 409);
  }

  const score = payload.performanceAchievement;

  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE evaluasi_kinerja
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
     WHERE id = ?`,
    [
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
    ]
  );

  if (result.affectedRows === 0) {
    fail("Data penilaian tidak ditemukan", 404);
  }

  return sendSuccess(
    res,
    {
      id: evaluationId,
      employeeId: payload.employeeId,
      periodId,
      evaluationYear: payload.evaluationYear,
      evaluationMonth: payload.evaluationMonth,
      evaluatorName: currentUser.fullName,
      performanceAchievement: score,
      finalScore: score,
      note: payload.note
    },
    "Penilaian SKP bulanan berhasil diperbarui"
  );
});

export const getRankings = asyncHandler(async (_req, res) => {
  const [rows] = await pool.query<any[]>(
    `SELECT e.id,
            e.nip,
            e.nama_lengkap AS fullName,
            e.nama_jabatan AS position,
            '' AS departmentName,
            ROUND(COALESCE(AVG(ev.skor_akhir), 0), 2) AS averageScore,
            COUNT(ev.id) AS totalEvaluations
     FROM pegawai e
     LEFT JOIN evaluasi_kinerja ev ON ev.pegawai_id = e.id
     GROUP BY e.id, e.nip, e.nama_lengkap, e.nama_jabatan
     ORDER BY averageScore DESC, e.nama_lengkap ASC`,
  );

  const data = rows.map((row, index) => ({
    rank: index + 1,
    ...row
  }));

  return sendSuccess(res, data);
});
