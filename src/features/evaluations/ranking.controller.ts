import { pool } from "../../config/database";
import { asyncHandler, sendSuccess } from "../../shared/http";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware";

const PERFORMANCE_WEIGHT = 30;
const BERAKHLAK_WEIGHT = 40;
const ATTENDANCE_WEIGHT = 25;
const COMPETENCY_WEIGHT = 5;
const TOTAL_WEIGHT =
  PERFORMANCE_WEIGHT + BERAKHLAK_WEIGHT + ATTENDANCE_WEIGHT + COMPETENCY_WEIGHT;

const readPositiveNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export const getRankings = asyncHandler(async (req: AuthenticatedRequest, res) => {
  const year = readPositiveNumber(req.query.year);
  const month = readPositiveNumber(req.query.month);
  const competencyQuarter = month > 0 ? Math.max(1, Math.ceil(month / 3)) : 0;
  const currentUser = req.user;
  const restrictToCurrentEmployee = currentUser?.role === "pegawai" && Number(currentUser?.employeeId || 0) > 0;

  const performanceConditions: string[] = [];
  const performanceParams: number[] = [];

  if (year > 0) {
    performanceConditions.push("YEAR(p.tanggal_mulai) = ?");
    performanceParams.push(year);
  }

  if (month > 0) {
    performanceConditions.push("MONTH(p.tanggal_mulai) = ?");
    performanceParams.push(month);
  }

  const berakhlakConditions: string[] = [];
  const berakhlakParams: number[] = [];

  if (year > 0) {
    berakhlakConditions.push("tahun_evaluasi = ?");
    berakhlakParams.push(year);
  }

  if (month > 0) {
    berakhlakConditions.push("bulan_evaluasi = ?");
    berakhlakParams.push(month);
  }

  const attendanceConditions: string[] = [];
  const attendanceParams: number[] = [];

  if (year > 0) {
    attendanceConditions.push("tahun_penilaian = ?");
    attendanceParams.push(year);
  }

  if (month > 0) {
    attendanceConditions.push("bulan_penilaian = ?");
    attendanceParams.push(month);
  }

  const competencyConditions: string[] = [];
  const competencyParams: number[] = [];

  if (year > 0) {
    competencyConditions.push("tahun_kegiatan = ?");
    competencyParams.push(year);
  }

  if (competencyQuarter > 0) {
    competencyConditions.push("triwulan_kegiatan = ?");
    competencyParams.push(competencyQuarter);
  }

  const performanceWhere = performanceConditions.length
    ? `WHERE ${performanceConditions.join(" AND ")}`
    : "";
  const berakhlakWhere = berakhlakConditions.length
    ? `WHERE ${berakhlakConditions.join(" AND ")}`
    : "";
  const attendanceWhere = attendanceConditions.length
    ? `WHERE ${attendanceConditions.join(" AND ")}`
    : "";
  const competencyWhere = competencyConditions.length
    ? `WHERE ${competencyConditions.join(" AND ")}`
    : "";

  const [rows] = await pool.query<any[]>(
    `SELECT e.id,
            e.nip,
            e.nama_lengkap AS fullName,
            COALESCE(j.nama, e.nama_jabatan) AS position,
            '' AS departmentName,
            ROUND(COALESCE(kinerja.avg_score, 0), 2) AS performanceScore,
            ROUND(COALESCE(berakhlak.avg_score, 0), 2) AS berakhlakScore,
            ROUND(COALESCE(presensi.avg_score, 0), 2) AS attendanceScore,
            ROUND(COALESCE(kompetensi.avg_score, 0), 2) AS competencyScore,
            COALESCE(kinerja.record_count, 0) AS performanceRecords,
            COALESCE(berakhlak.record_count, 0) AS berakhlakRecords,
            COALESCE(presensi.record_count, 0) AS attendanceRecords,
            COALESCE(kompetensi.record_count, 0) AS competencyRecords,
            (
              CASE WHEN COALESCE(kinerja.record_count, 0) > 0 THEN 1 ELSE 0 END +
              CASE WHEN COALESCE(berakhlak.record_count, 0) > 0 THEN 1 ELSE 0 END +
              CASE WHEN COALESCE(presensi.record_count, 0) > 0 THEN 1 ELSE 0 END +
              CASE WHEN COALESCE(kompetensi.record_count, 0) > 0 THEN 1 ELSE 0 END
            ) AS sourceCoverage,
            ROUND(
              (
                (COALESCE(kinerja.avg_score, 0) * ${PERFORMANCE_WEIGHT}) +
                (COALESCE(berakhlak.avg_score, 0) * ${BERAKHLAK_WEIGHT}) +
                (COALESCE(presensi.avg_score, 0) * ${ATTENDANCE_WEIGHT}) +
                (COALESCE(kompetensi.avg_score, 0) * ${COMPETENCY_WEIGHT})
              ) / ${TOTAL_WEIGHT},
              2
            ) AS averageScore
     FROM pegawai e
     LEFT JOIN jabatan j ON j.id = e.jabatan_id
     LEFT JOIN (
       SELECT ev.pegawai_id,
              ROUND(AVG(ev.skor_akhir), 2) AS avg_score,
              COUNT(*) AS record_count
       FROM evaluasi_kinerja ev
       INNER JOIN periode_evaluasi p ON p.id = ev.periode_evaluasi_id
       ${performanceWhere}
       GROUP BY ev.pegawai_id
     ) kinerja ON kinerja.pegawai_id = e.id
     LEFT JOIN (
       SELECT pegawai_id,
              ROUND(AVG(skor_akhir), 2) AS avg_score,
              COUNT(*) AS record_count
       FROM evaluasi_berakhlak_360
       ${berakhlakWhere}
       GROUP BY pegawai_id
     ) berakhlak ON berakhlak.pegawai_id = e.id
     LEFT JOIN (
       SELECT pegawai_id,
              ROUND(AVG(skor_bulanan), 2) AS avg_score,
              COUNT(*) AS record_count
       FROM penilaian_kehadiran
       ${attendanceWhere}
       GROUP BY pegawai_id
     ) presensi ON presensi.pegawai_id = e.id
     LEFT JOIN (
       SELECT rekap.pegawai_id,
              ROUND(AVG(rekap.skor_triwulan), 2) AS avg_score,
              COUNT(*) AS record_count
       FROM (
         SELECT pegawai_id,
                tahun_kegiatan,
                triwulan_kegiatan,
                LEAST(100, ROUND((SUM(jam_ekuivalen) / 5) * 100, 2)) AS skor_triwulan
         FROM kegiatan_pengembangan_kompetensi
         ${competencyWhere}
         GROUP BY pegawai_id, tahun_kegiatan, triwulan_kegiatan
       ) rekap
       GROUP BY rekap.pegawai_id
     ) kompetensi ON kompetensi.pegawai_id = e.id
     WHERE e.status_aktif = 'aktif'
       ${restrictToCurrentEmployee ? "AND e.id = ?" : ""}
     ORDER BY averageScore DESC,
              sourceCoverage DESC,
              e.nama_lengkap ASC`,
    [
      ...performanceParams,
      ...berakhlakParams,
      ...attendanceParams,
      ...competencyParams,
      ...(restrictToCurrentEmployee ? [Number(currentUser?.employeeId)] : [])
    ]
  );

  const data = rows.map((row, index) => ({
    rank: index + 1,
    ...row,
    weightConfig: {
      performance: PERFORMANCE_WEIGHT,
      berakhlak: BERAKHLAK_WEIGHT,
      attendance: ATTENDANCE_WEIGHT,
      competency: COMPETENCY_WEIGHT,
      normalizedTo: 100
    },
    activeFilter: {
      year: year || null,
      month: month || null
    }
  }));

  return sendSuccess(res, data);
});
