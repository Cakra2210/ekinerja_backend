import { ResultSetHeader, RowDataPacket } from "mysql2";

import { pool } from "../../config/database";
import { BASE_SELECT, mapEvaluationRows } from "./berakhlak.mapper";
import { DashboardDimension, BerakhlakPayload, EvaluationFilters } from "./berakhlak.types";
import { calculateDimensions } from "./berakhlak.validation";

const isAdminLike = (role?: EvaluationFilters["viewerRole"]) => role === "super_admin" || role === "admin_satker" || role === "kepala_satker" || role === "kasubbag_umum" || role === "reviewer";

const buildWhere = (filters: EvaluationFilters) => {
  const whereClauses: string[] = [];
  const params: number[] = [];

  if (filters.year && filters.year > 0) {
    whereClauses.push("ev.tahun_evaluasi = ?");
    params.push(filters.year);
  }

  if (filters.month && filters.month > 0) {
    whereClauses.push("ev.bulan_evaluasi = ?");
    params.push(filters.month);
  }

  if (filters.employeeId && filters.employeeId > 0) {
    whereClauses.push("ev.pegawai_id = ?");
    params.push(filters.employeeId);
  }

  if (!isAdminLike(filters.viewerRole) && filters.viewerEmployeeId) {
    whereClauses.push("ev.penilai_pegawai_id = ?");
    params.push(filters.viewerEmployeeId);
  }

  return {
    whereSql: whereClauses.length ? ` WHERE ${whereClauses.join(" AND ")}` : "",
    params
  };
};

export const getSingleEvaluationById = async (id: number) => {
  const [rows] = await pool.query<RowDataPacket[]>(
    `${BASE_SELECT}
     WHERE ev.id = ?
     LIMIT 1`,
    [id]
  );

  return mapEvaluationRows(rows)[0] || null;
};

export const listEvaluations = async (filters: EvaluationFilters) => {
  const { whereSql, params } = buildWhere(filters);
  const [rows] = await pool.query<RowDataPacket[]>(
    `${BASE_SELECT}
     ${whereSql}
     ORDER BY ev.tahun_evaluasi DESC, ev.bulan_evaluasi DESC, ev.diperbarui_pada DESC, ev.dibuat_pada DESC, ev.id DESC`,
    params
  );
  return mapEvaluationRows(rows);
};

export const findDuplicateEvaluation = async (
  payload: BerakhlakPayload,
  excludeId?: number
) => {
  const params = [
    payload.evaluatorEmployeeId,
    payload.employeeId,
    payload.evaluationYear,
    payload.evaluationMonth
  ];

  let sql = `SELECT id
             FROM evaluasi_berakhlak_360
             WHERE penilai_pegawai_id = ?
               AND pegawai_id = ?
               AND tahun_evaluasi = ?
               AND bulan_evaluasi = ?`;

  if (excludeId) {
    sql += " AND id <> ?";
    params.push(excludeId);
  }

  sql += " LIMIT 1";

  const [rows] = await pool.query<RowDataPacket[]>(sql, params);
  return rows.length > 0;
};

export const createEvaluation = async (payload: BerakhlakPayload) => {
  const dimensions = calculateDimensions(payload);

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO evaluasi_berakhlak_360 (
      pegawai_id,
      penilai_pegawai_id,
      tahun_evaluasi,
      bulan_evaluasi,
      pelayanan_responsif,
      pelayanan_ramah,
      pelayanan_solutif,
      akuntabel_prosedur,
      akuntabel_transparansi,
      akuntabel_tanggung_jawab,
      kompeten_penguasaan,
      kompeten_penyelesaian,
      kompeten_pengembangan,
      harmonis_tim,
      harmonis_relasi,
      harmonis_lingkungan,
      loyal_komitmen,
      loyal_aturan,
      loyal_dedikasi,
      adaptif_perubahan,
      adaptif_fleksibilitas,
      adaptif_belajar,
      kolaboratif_kerja_sama,
      kolaboratif_diskusi,
      kolaboratif_koordinasi,
      pelayanan_avg,
      akuntabel_avg,
      kompeten_avg,
      harmonis_avg,
      loyal_avg,
      adaptif_avg,
      kolaboratif_avg,
      skor_akhir,
      note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.employeeId,
      payload.evaluatorEmployeeId,
      payload.evaluationYear,
      payload.evaluationMonth,
      payload.pelayananResponsif,
      payload.pelayananRamah,
      payload.pelayananSolutif,
      payload.akuntabelProsedur,
      payload.akuntabelTransparansi,
      payload.akuntabelTanggungJawab,
      payload.kompetenPenguasaan,
      payload.kompetenPenyelesaian,
      payload.kompetenPengembangan,
      payload.harmonisTim,
      payload.harmonisRelasi,
      payload.harmonisLingkungan,
      payload.loyalKomitmen,
      payload.loyalAturan,
      payload.loyalDedikasi,
      payload.adaptifPerubahan,
      payload.adaptifFleksibilitas,
      payload.adaptifBelajar,
      payload.kolaboratifKerjaSama,
      payload.kolaboratifDiskusi,
      payload.kolaboratifKoordinasi,
      dimensions.pelayananAvg,
      dimensions.akuntabelAvg,
      dimensions.kompetenAvg,
      dimensions.harmonisAvg,
      dimensions.loyalAvg,
      dimensions.adaptifAvg,
      dimensions.kolaboratifAvg,
      dimensions.finalScore,
      payload.note
    ]
  );

  return getSingleEvaluationById(Number(result.insertId));
};

export const updateEvaluation = async (id: number, payload: BerakhlakPayload) => {
  const dimensions = calculateDimensions(payload);

  await pool.query(
    `UPDATE evaluasi_berakhlak_360
     SET pegawai_id = ?,
         penilai_pegawai_id = ?,
         tahun_evaluasi = ?,
         bulan_evaluasi = ?,
         pelayanan_responsif = ?,
         pelayanan_ramah = ?,
         pelayanan_solutif = ?,
         akuntabel_prosedur = ?,
         akuntabel_transparansi = ?,
         akuntabel_tanggung_jawab = ?,
         kompeten_penguasaan = ?,
         kompeten_penyelesaian = ?,
         kompeten_pengembangan = ?,
         harmonis_tim = ?,
         harmonis_relasi = ?,
         harmonis_lingkungan = ?,
         loyal_komitmen = ?,
         loyal_aturan = ?,
         loyal_dedikasi = ?,
         adaptif_perubahan = ?,
         adaptif_fleksibilitas = ?,
         adaptif_belajar = ?,
         kolaboratif_kerja_sama = ?,
         kolaboratif_diskusi = ?,
         kolaboratif_koordinasi = ?,
         pelayanan_avg = ?,
         akuntabel_avg = ?,
         kompeten_avg = ?,
         harmonis_avg = ?,
         loyal_avg = ?,
         adaptif_avg = ?,
         kolaboratif_avg = ?,
         skor_akhir = ?,
         note = ?
     WHERE id = ?`,
    [
      payload.employeeId,
      payload.evaluatorEmployeeId,
      payload.evaluationYear,
      payload.evaluationMonth,
      payload.pelayananResponsif,
      payload.pelayananRamah,
      payload.pelayananSolutif,
      payload.akuntabelProsedur,
      payload.akuntabelTransparansi,
      payload.akuntabelTanggungJawab,
      payload.kompetenPenguasaan,
      payload.kompetenPenyelesaian,
      payload.kompetenPengembangan,
      payload.harmonisTim,
      payload.harmonisRelasi,
      payload.harmonisLingkungan,
      payload.loyalKomitmen,
      payload.loyalAturan,
      payload.loyalDedikasi,
      payload.adaptifPerubahan,
      payload.adaptifFleksibilitas,
      payload.adaptifBelajar,
      payload.kolaboratifKerjaSama,
      payload.kolaboratifDiskusi,
      payload.kolaboratifKoordinasi,
      dimensions.pelayananAvg,
      dimensions.akuntabelAvg,
      dimensions.kompetenAvg,
      dimensions.harmonisAvg,
      dimensions.loyalAvg,
      dimensions.adaptifAvg,
      dimensions.kolaboratifAvg,
      dimensions.finalScore,
      payload.note,
      id
    ]
  );

  return getSingleEvaluationById(id);
};

export const findEvaluationById = async (id: number) => {
  return getSingleEvaluationById(id);
};

export const getDashboard = async (filters: EvaluationFilters) => {
  const formattedRows = await listEvaluations(filters);
  const totalEvaluations = formattedRows.length;
  const totalEmployeesEvaluated = new Set(formattedRows.map((item) => item.employeeId)).size;
  const averageScore = totalEvaluations
    ? Number(
        (
          formattedRows.reduce((sum, item) => sum + Number(item.finalScore), 0) /
          totalEvaluations
        ).toFixed(2)
      )
    : 0;

  const activeMonthCount = new Set(
    formattedRows.map((item) => `${item.evaluationYear}-${item.evaluationMonth}`)
  ).size;

  const dimensionDefinitions: Array<{ key: keyof typeof formattedRows[number]; label: string; apiKey: string }> = [
    { key: "pelayananAvg", label: "Berorientasi Pelayanan", apiKey: "pelayanan" },
    { key: "akuntabelAvg", label: "Akuntabel", apiKey: "akuntabel" },
    { key: "kompetenAvg", label: "Kompeten", apiKey: "kompeten" },
    { key: "harmonisAvg", label: "Harmonis", apiKey: "harmonis" },
    { key: "loyalAvg", label: "Loyal", apiKey: "loyal" },
    { key: "adaptifAvg", label: "Adaptif", apiKey: "adaptif" },
    { key: "kolaboratifAvg", label: "Kolaboratif", apiKey: "kolaboratif" }
  ];

  const dimensionAverages: DashboardDimension[] = dimensionDefinitions.map((item) => ({
    key: item.apiKey,
    label: item.label,
    value: totalEvaluations
      ? Number(
          (
            formattedRows.reduce((sum, row) => sum + Number(row[item.key] || 0), 0) /
            totalEvaluations
          ).toFixed(2)
        )
      : 0
  }));

  const employeeMap = new Map<number, {
    employeeId: number;
    fullName: string;
    nip: string;
    totalScore: number;
    totalEvaluations: number;
    lastEvaluatedAt: string | null;
  }>();

  formattedRows.forEach((item) => {
    const current = employeeMap.get(item.employeeId) || {
      employeeId: item.employeeId,
      fullName: item.employeeName,
      nip: item.employeeNip,
      totalScore: 0,
      totalEvaluations: 0,
      lastEvaluatedAt: null
    };

    current.totalScore += Number(item.finalScore);
    current.totalEvaluations += 1;
    current.lastEvaluatedAt =
      !current.lastEvaluatedAt || new Date(item.updatedAt || item.createdAt) > new Date(current.lastEvaluatedAt)
        ? item.updatedAt || item.createdAt
        : current.lastEvaluatedAt;

    employeeMap.set(item.employeeId, current);
  });

  const employeeScores = Array.from(employeeMap.values())
    .map((item) => ({
      employeeId: item.employeeId,
      fullName: item.fullName,
      nip: item.nip,
      averageScore: Number((item.totalScore / item.totalEvaluations).toFixed(2)),
      totalEvaluations: item.totalEvaluations,
      lastEvaluatedAt: item.lastEvaluatedAt
    }))
    .sort((a, b) => b.averageScore - a.averageScore || a.fullName.localeCompare(b.fullName));

  const monthMap = new Map<string, { label: string; totalEvaluations: number; totalScore: number }>();
  formattedRows.forEach((item) => {
    const key = `${item.evaluationYear}-${String(item.evaluationMonth).padStart(2, "0")}`;
    const current = monthMap.get(key) || { label: key, totalEvaluations: 0, totalScore: 0 };
    current.totalEvaluations += 1;
    current.totalScore += Number(item.finalScore);
    monthMap.set(key, current);
  });

  const monthlySummary = Array.from(monthMap.values())
    .map((item) => ({
      label: item.label,
      totalEvaluations: item.totalEvaluations,
      averageScore: Number((item.totalScore / item.totalEvaluations).toFixed(2))
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return {
    selectedYear: filters.year && filters.year > 0 ? filters.year : null,
    selectedMonth: filters.month && filters.month > 0 ? filters.month : null,
    selectedEmployeeId: filters.employeeId && filters.employeeId > 0 ? filters.employeeId : null,
    totalEvaluations,
    totalEmployeesEvaluated,
    averageScore,
    activeMonthCount,
    dimensionAverages,
    employeeScores,
    monthlySummary,
    latestEvaluations: formattedRows.slice(0, 10)
  };
};
