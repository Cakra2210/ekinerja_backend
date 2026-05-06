import { pool } from "../../config/database";
import { asyncHandler, fail, sendSuccess } from "../../shared/http";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware";
import {
  readIntegerInRange,
  readNonNegativeNumber,
  readPositiveId,
  readTrimmedString
} from "../../shared/validation";
import { RowDataPacket, ResultSetHeader } from "mysql2/promise";

const ATTENDANCE_INDEX = {
  tl1: 0.5,
  tl2: 1,
  tl3: 1.5,
  tl4: 2,
  psw1: 0.5,
  psw2: 1,
  psw3: 1.5,
  psw4: 2
} as const;

const getQuarterNumber = (month: number) => Math.ceil(month / 3);

const calculatePenaltyIndex = (payload: any) => {
  return Number(
    (
      (payload.tl1Count || 0) * ATTENDANCE_INDEX.tl1 +
      (payload.tl2Count || 0) * ATTENDANCE_INDEX.tl2 +
      (payload.tl3Count || 0) * ATTENDANCE_INDEX.tl3 +
      (payload.tl4Count || 0) * ATTENDANCE_INDEX.tl4 +
      (payload.psw1Count || 0) * ATTENDANCE_INDEX.psw1 +
      (payload.psw2Count || 0) * ATTENDANCE_INDEX.psw2 +
      (payload.psw3Count || 0) * ATTENDANCE_INDEX.psw3 +
      (payload.psw4Count || 0) * ATTENDANCE_INDEX.psw4
    ).toFixed(2)
  );
};

const calculateMonthlyScore = (attendanceDays: number, penaltyIndex: number) => {
  const ratioPenalty = (penaltyIndex / Math.max(attendanceDays, 1)) * 100;
  return Number(Math.max(0, 100 - ratioPenalty).toFixed(2));
};

export const getAttendanceAssessments = asyncHandler(async (req: AuthenticatedRequest, res) => {
  const year = Number(req.query.year) || 0;
  const month = Number(req.query.month) || 0;
  const requestedEmployeeId = Number(req.query.employeeId) || 0;
  const currentUser = req.user;
  const isEmployeeRole = currentUser?.role === "pegawai";
  const employeeId = isEmployeeRole ? Number(currentUser?.employeeId || 0) : requestedEmployeeId;

  const conditions: string[] = [];
  const params: number[] = [];

  if (year > 0) {
    conditions.push("aa.tahun_penilaian = ?");
    params.push(year);
  }
  if (month > 0) {
    conditions.push("aa.bulan_penilaian = ?");
    params.push(month);
  }
  if (employeeId > 0) {
    conditions.push("aa.pegawai_id = ?");
    params.push(employeeId);
  }

  const whereClause = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

  const query = `SELECT aa.id,
                        aa.pegawai_id AS employeeId,
                        e.nama_lengkap AS employeeName,
                        e.nip,
                        COALESCE(p.nama, e.nama_jabatan) AS position,
                        aa.tahun_penilaian AS assessmentYear,
                        aa.bulan_penilaian AS assessmentMonth,
                        aa.hari_kehadiran AS attendanceDays,
                        aa.jumlah_tl1 AS tl1Count,
                        aa.jumlah_tl2 AS tl2Count,
                        aa.jumlah_tl3 AS tl3Count,
                        aa.jumlah_tl4 AS tl4Count,
                        aa.jumlah_psw1 AS psw1Count,
                        aa.jumlah_psw2 AS psw2Count,
                        aa.jumlah_psw3 AS psw3Count,
                        aa.jumlah_psw4 AS psw4Count,
                        aa.total_indeks_pengurang AS totalPenaltyIndex,
                        aa.skor_bulanan AS monthlyScore,
                        aa.triwulan AS quarterNumber,
                        aa.note,
                        aa.dibuat_pada AS createdAt,
                        aa.diperbarui_pada AS updatedAt
                 FROM penilaian_kehadiran aa
                 INNER JOIN pegawai e ON e.id = aa.pegawai_id
                 LEFT JOIN jabatan p ON p.id = e.jabatan_id
                 ${whereClause}
                 ORDER BY aa.tahun_penilaian DESC, aa.bulan_penilaian DESC, e.nama_lengkap ASC`;

  const [rows] = await pool.query<RowDataPacket[]>(query, params);

  return sendSuccess(res, {
    records: rows,
    meta: { indexWeights: ATTENDANCE_INDEX }
  });
});

export const saveAttendanceAssessment = asyncHandler(async (req, res) => {
  const payload = req.body;
  const quarterNumber = getQuarterNumber(payload.assessmentMonth);
  const totalPenaltyIndex = calculatePenaltyIndex(payload);
  const monthlyScore = calculateMonthlyScore(payload.attendanceDays, totalPenaltyIndex);

  const [employeeRows] = await pool.query<RowDataPacket[]>(`SELECT id FROM pegawai WHERE id = ? LIMIT 1`, [payload.employeeId]);
  if (!employeeRows || !employeeRows.length) fail("Pegawai tidak ditemukan", 404);

  const [existing] = await pool.query<RowDataPacket[]>(`SELECT id FROM penilaian_kehadiran WHERE pegawai_id=? AND tahun_penilaian=? AND bulan_penilaian=? LIMIT 1`,
    [payload.employeeId, payload.assessmentYear, payload.assessmentMonth]
  );

  let attendanceId = Number(existing[0]?.id || 0);

  if (attendanceId) {
    await pool.query(`UPDATE penilaian_kehadiran SET hari_kehadiran=?, jumlah_tl1=?, jumlah_tl2=?, jumlah_tl3=?, jumlah_tl4=?, jumlah_psw1=?, jumlah_psw2=?, jumlah_psw3=?, jumlah_psw4=?, total_indeks_pengurang=?, skor_bulanan=?, triwulan=? WHERE id=?`,
      [
        payload.attendanceDays,
        payload.tl1Count,
        payload.tl2Count,
        payload.tl3Count,
        payload.tl4Count,
        payload.psw1Count,
        payload.psw2Count,
        payload.psw3Count,
        payload.psw4Count,
        totalPenaltyIndex,
        monthlyScore,
        quarterNumber,
        attendanceId
      ]
    );
  } else {
    const [result] = await pool.query<ResultSetHeader>(`INSERT INTO penilaian_kehadiran (pegawai_id, tahun_penilaian, bulan_penilaian, hari_kehadiran, jumlah_tl1, jumlah_tl2, jumlah_tl3, jumlah_tl4, jumlah_psw1, jumlah_psw2, jumlah_psw3, jumlah_psw4, total_indeks_pengurang, skor_bulanan, triwulan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.employeeId,
        payload.assessmentYear,
        payload.assessmentMonth,
        payload.attendanceDays,
        payload.tl1Count,
        payload.tl2Count,
        payload.tl3Count,
        payload.tl4Count,
        payload.psw1Count,
        payload.psw2Count,
        payload.psw3Count,
        payload.psw4Count,
        totalPenaltyIndex,
        monthlyScore,
        quarterNumber
      ]
    );
    attendanceId = Number(result.insertId);
  }

  return sendSuccess(res, { id: attendanceId }, "Rekap kehadiran berhasil disimpan", 201);
});