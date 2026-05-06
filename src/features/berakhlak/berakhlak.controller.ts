import { pool } from "../../config/database";
import { AuthenticatedRequest } from "../../middleware/auth.middleware";
import { asyncHandler, fail, sendSuccess } from "../../shared/http";
import {
  readIntegerInRange,
  readPositiveId,
  readTrimmedString
} from "../../shared/validation";

type BerakhlakPayload = {
  employeeId: number;
  evaluatorEmployeeId: number;
  evaluationYear: number;
  evaluationMonth: number;
  pelayananResponsif: number;
  pelayananRamah: number;
  pelayananSolutif: number;
  akuntabelProsedur: number;
  akuntabelTransparansi: number;
  akuntabelTanggungJawab: number;
  kompetenPenguasaan: number;
  kompetenPenyelesaian: number;
  kompetenPengembangan: number;
  harmonisTim: number;
  harmonisRelasi: number;
  harmonisLingkungan: number;
  loyalKomitmen: number;
  loyalAturan: number;
  loyalDedikasi: number;
  adaptifPerubahan: number;
  adaptifFleksibilitas: number;
  adaptifBelajar: number;
  kolaboratifKerjaSama: number;
  kolaboratifDiskusi: number;
  kolaboratifKoordinasi: number;
  note: string;
};

type DashboardDimension = {
  key: string;
  label: string;
  value: number;
};

const BASE_SELECT = `SELECT ev.id,
                            ev.pegawai_id AS employeeId,
                            ee.nama_lengkap AS employeeName,
                            ee.nip AS employeeNip,
                            ev.penilai_pegawai_id AS evaluatorEmployeeId,
                            er.nama_lengkap AS evaluatorName,
                            er.nip AS evaluatorNip,
                            ev.tahun_evaluasi AS evaluationYear,
                            ev.bulan_evaluasi AS evaluationMonth,
                            ev.pelayanan_responsif AS pelayananResponsif,
                            ev.pelayanan_ramah AS pelayananRamah,
                            ev.pelayanan_solutif AS pelayananSolutif,
                            ev.akuntabel_prosedur AS akuntabelProsedur,
                            ev.akuntabel_transparansi AS akuntabelTransparansi,
                            ev.akuntabel_tanggung_jawab AS akuntabelTanggungJawab,
                            ev.kompeten_penguasaan AS kompetenPenguasaan,
                            ev.kompeten_penyelesaian AS kompetenPenyelesaian,
                            ev.kompeten_pengembangan AS kompetenPengembangan,
                            ev.harmonis_tim AS harmonisTim,
                            ev.harmonis_relasi AS harmonisRelasi,
                            ev.harmonis_lingkungan AS harmonisLingkungan,
                            ev.loyal_komitmen AS loyalKomitmen,
                            ev.loyal_aturan AS loyalAturan,
                            ev.loyal_dedikasi AS loyalDedikasi,
                            ev.adaptif_perubahan AS adaptifPerubahan,
                            ev.adaptif_fleksibilitas AS adaptifFleksibilitas,
                            ev.adaptif_belajar AS adaptifBelajar,
                            ev.kolaboratif_kerja_sama AS kolaboratifKerjaSama,
                            ev.kolaboratif_diskusi AS kolaboratifDiskusi,
                            ev.kolaboratif_koordinasi AS kolaboratifKoordinasi,
                            ev.pelayanan_avg AS pelayananAvg,
                            ev.akuntabel_avg AS akuntabelAvg,
                            ev.kompeten_avg AS kompetenAvg,
                            ev.harmonis_avg AS harmonisAvg,
                            ev.loyal_avg AS loyalAvg,
                            ev.adaptif_avg AS adaptifAvg,
                            ev.kolaboratif_avg AS kolaboratifAvg,
                            ev.skor_akhir AS finalScore,
                            ev.note,
                            DATE_FORMAT(ev.dibuat_pada, '%Y-%m-%d %H:%i:%s') AS createdAt,
                            DATE_FORMAT(ev.diperbarui_pada, '%Y-%m-%d %H:%i:%s') AS updatedAt
                     FROM evaluasi_berakhlak_360 ev
                     INNER JOIN pegawai ee ON ee.id = ev.pegawai_id
                     INNER JOIN pegawai er ON er.id = ev.penilai_pegawai_id`;

const clampScore = (value: number) => {
  if (Number.isNaN(value)) return 50;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
};

const readOptionalQueryNumber = (value: unknown, fallback = 0) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const readScore = (value: unknown) => clampScore(readOptionalQueryNumber(value, 50));

const normalizePayload = (body: Record<string, unknown>): BerakhlakPayload => ({
  employeeId: readPositiveId(body.employeeId, "Pegawai yang dinilai"),
  evaluatorEmployeeId: readPositiveId(body.evaluatorEmployeeId, "Pegawai penilai"),
  evaluationYear: readIntegerInRange(body.evaluationYear, 2000, 2100, "Tahun penilaian"),
  evaluationMonth: readIntegerInRange(body.evaluationMonth, 1, 12, "Bulan penilaian"),
  pelayananResponsif: readScore(body.pelayananResponsif),
  pelayananRamah: readScore(body.pelayananRamah),
  pelayananSolutif: readScore(body.pelayananSolutif),
  akuntabelProsedur: readScore(body.akuntabelProsedur),
  akuntabelTransparansi: readScore(body.akuntabelTransparansi),
  akuntabelTanggungJawab: readScore(body.akuntabelTanggungJawab),
  kompetenPenguasaan: readScore(body.kompetenPenguasaan),
  kompetenPenyelesaian: readScore(body.kompetenPenyelesaian),
  kompetenPengembangan: readScore(body.kompetenPengembangan),
  harmonisTim: readScore(body.harmonisTim),
  harmonisRelasi: readScore(body.harmonisRelasi),
  harmonisLingkungan: readScore(body.harmonisLingkungan),
  loyalKomitmen: readScore(body.loyalKomitmen),
  loyalAturan: readScore(body.loyalAturan),
  loyalDedikasi: readScore(body.loyalDedikasi),
  adaptifPerubahan: readScore(body.adaptifPerubahan),
  adaptifFleksibilitas: readScore(body.adaptifFleksibilitas),
  adaptifBelajar: readScore(body.adaptifBelajar),
  kolaboratifKerjaSama: readScore(body.kolaboratifKerjaSama),
  kolaboratifDiskusi: readScore(body.kolaboratifDiskusi),
  kolaboratifKoordinasi: readScore(body.kolaboratifKoordinasi),
  note: readTrimmedString(body.note)
});

const calculateAverage = (...scores: number[]) => {
  const total = scores.reduce((sum, score) => sum + score, 0);
  return Number((total / scores.length).toFixed(2));
};

const calculateDimensions = (payload: BerakhlakPayload) => {
  const pelayananAvg = calculateAverage(
    payload.pelayananResponsif,
    payload.pelayananRamah,
    payload.pelayananSolutif
  );
  const akuntabelAvg = calculateAverage(
    payload.akuntabelProsedur,
    payload.akuntabelTransparansi,
    payload.akuntabelTanggungJawab
  );
  const kompetenAvg = calculateAverage(
    payload.kompetenPenguasaan,
    payload.kompetenPenyelesaian,
    payload.kompetenPengembangan
  );
  const harmonisAvg = calculateAverage(
    payload.harmonisTim,
    payload.harmonisRelasi,
    payload.harmonisLingkungan
  );
  const loyalAvg = calculateAverage(
    payload.loyalKomitmen,
    payload.loyalAturan,
    payload.loyalDedikasi
  );
  const adaptifAvg = calculateAverage(
    payload.adaptifPerubahan,
    payload.adaptifFleksibilitas,
    payload.adaptifBelajar
  );
  const kolaboratifAvg = calculateAverage(
    payload.kolaboratifKerjaSama,
    payload.kolaboratifDiskusi,
    payload.kolaboratifKoordinasi
  );
  const finalScore = Number(
    (
      (pelayananAvg +
        akuntabelAvg +
        kompetenAvg +
        harmonisAvg +
        loyalAvg +
        adaptifAvg +
        kolaboratifAvg) /
      7
    ).toFixed(2)
  );

  return {
    pelayananAvg,
    akuntabelAvg,
    kompetenAvg,
    harmonisAvg,
    loyalAvg,
    adaptifAvg,
    kolaboratifAvg,
    finalScore
  };
};

const formatEvaluationRows = (rows: any[]) =>
  rows.map((row) => ({
    id: Number(row.id),
    employeeId: Number(row.employeeId),
    employeeName: row.employeeName,
    employeeNip: row.employeeNip,
    evaluatorEmployeeId: Number(row.evaluatorEmployeeId),
    evaluatorName: row.evaluatorName,
    evaluatorNip: row.evaluatorNip,
    evaluationYear: Number(row.evaluationYear),
    evaluationMonth: Number(row.evaluationMonth),
    pelayananResponsif: Number(row.pelayananResponsif),
    pelayananRamah: Number(row.pelayananRamah),
    pelayananSolutif: Number(row.pelayananSolutif),
    akuntabelProsedur: Number(row.akuntabelProsedur),
    akuntabelTransparansi: Number(row.akuntabelTransparansi),
    akuntabelTanggungJawab: Number(row.akuntabelTanggungJawab),
    kompetenPenguasaan: Number(row.kompetenPenguasaan),
    kompetenPenyelesaian: Number(row.kompetenPenyelesaian),
    kompetenPengembangan: Number(row.kompetenPengembangan),
    harmonisTim: Number(row.harmonisTim),
    harmonisRelasi: Number(row.harmonisRelasi),
    harmonisLingkungan: Number(row.harmonisLingkungan),
    loyalKomitmen: Number(row.loyalKomitmen),
    loyalAturan: Number(row.loyalAturan),
    loyalDedikasi: Number(row.loyalDedikasi),
    adaptifPerubahan: Number(row.adaptifPerubahan),
    adaptifFleksibilitas: Number(row.adaptifFleksibilitas),
    adaptifBelajar: Number(row.adaptifBelajar),
    kolaboratifKerjaSama: Number(row.kolaboratifKerjaSama),
    kolaboratifDiskusi: Number(row.kolaboratifDiskusi),
    kolaboratifKoordinasi: Number(row.kolaboratifKoordinasi),
    pelayananAvg: Number(row.pelayananAvg),
    akuntabelAvg: Number(row.akuntabelAvg),
    kompetenAvg: Number(row.kompetenAvg),
    harmonisAvg: Number(row.harmonisAvg),
    loyalAvg: Number(row.loyalAvg),
    adaptifAvg: Number(row.adaptifAvg),
    kolaboratifAvg: Number(row.kolaboratifAvg),
    finalScore: Number(row.finalScore),
    note: row.note || "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }));

const getSingleEvaluationById = async (id: number) => {
  const [rows] = await pool.query<any[]>(
    `${BASE_SELECT}
     WHERE ev.id = ?
     LIMIT 1`,
    [id]
  );

  return formatEvaluationRows(rows)[0] || null;
};

const ensureValidPayload = (payload: BerakhlakPayload) => {
  if (payload.employeeId === payload.evaluatorEmployeeId) {
    fail("Pegawai tidak dapat menilai dirinya sendiri", 400);
  }
};

const getExistingEvaluation = async (id: number) => {
  const [currentRows] = await pool.query<any[]>(
    `SELECT id, pegawai_id AS employeeId, penilai_pegawai_id AS evaluatorEmployeeId
     FROM evaluasi_berakhlak_360
     WHERE id = ?
     LIMIT 1`,
    [id]
  );

  if (!currentRows.length) {
    fail("Data penilaian tidak ditemukan", 404);
  }

  return {
    id: Number(currentRows[0].id),
    employeeId: Number(currentRows[0].employeeId),
    evaluatorEmployeeId: Number(currentRows[0].evaluatorEmployeeId)
  };
};

const resolvePayloadByRole = (
  req: AuthenticatedRequest,
  payload: BerakhlakPayload
): BerakhlakPayload => {
  if (req.user?.role === "pegawai") {
    if (!req.user.employeeId) {
      fail("Akun pegawai belum terhubung dengan data pegawai", 403);
    }

    return {
      ...payload,
      evaluatorEmployeeId: req.user.employeeId
    };
  }

  return payload;
};

const getDuplicateEvaluation = async (payload: BerakhlakPayload, excludeId?: number) => {
  const conditions = [
    "penilai_pegawai_id = ?",
    "pegawai_id = ?",
    "tahun_evaluasi = ?",
    "bulan_evaluasi = ?"
  ];
  const params: Array<number> = [
    payload.evaluatorEmployeeId,
    payload.employeeId,
    payload.evaluationYear,
    payload.evaluationMonth
  ];

  if (excludeId) {
    conditions.push("id <> ?");
    params.push(excludeId);
  }

  const [rows] = await pool.query<any[]>(
    `SELECT id
     FROM evaluasi_berakhlak_360
     WHERE ${conditions.join(" AND ")}
     LIMIT 1`,
    params
  );

  return rows[0] || null;
};

export const getBerakhlakEvaluations = asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const whereClauses: string[] = [];
    const params: number[] = [];

    if (req.user?.role === "pegawai") {
      whereClauses.push("ev.penilai_pegawai_id = ?");
      params.push(req.user.employeeId);
    }

    const whereSql = whereClauses.length ? ` WHERE ${whereClauses.join(" AND ")}` : "";

    const [rows] = await pool.query<any[]>(
      `${BASE_SELECT}${whereSql}
       ORDER BY ev.diperbarui_pada DESC, ev.dibuat_pada DESC, ev.id DESC`,
      params
    );

    return sendSuccess(res, formatEvaluationRows(rows));
  } catch (error: any) {
    if (error?.code === "ER_NO_SUCH_TABLE") {
      fail(
        "Tabel penilaian 360 BerAKHLAK belum tersedia. Pastikan struktur database sudah diimpor dari sql/kinerja_pegawai_bps.sql.",
        500
      );
    }

    throw error;
  }
});

export const createBerakhlakEvaluation = asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const payload = resolvePayloadByRole(
      req,
      normalizePayload(req.body as Record<string, unknown>)
    );
    ensureValidPayload(payload);

    const duplicate = await getDuplicateEvaluation(payload);

    if (duplicate) {
      fail(
        "Pegawai ini sudah Anda nilai pada bulan dan tahun yang sama. Gunakan tombol edit untuk memperbarui nilai periode tersebut.",
        409
      );
    }

    const dimensions = calculateDimensions(payload);

    const [result] = await pool.query<any>(
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

    const created = await getSingleEvaluationById(Number(result.insertId));

    return sendSuccess(
      res,
      created,
      "Penilaian 360 BerAKHLAK berhasil disimpan",
      201
    );
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") {
      fail(
        "Pegawai ini sudah Anda nilai pada bulan dan tahun yang sama. Gunakan tombol edit untuk memperbarui nilai periode tersebut.",
        409
      );
    }

    if (error?.code === "ER_NO_SUCH_TABLE") {
      fail(
        "Tabel penilaian 360 BerAKHLAK belum tersedia. Pastikan struktur database sudah diimpor dari sql/kinerja_pegawai_bps.sql.",
        500
      );
    }

    throw error;
  }
});

export const updateBerakhlakEvaluation = asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const id = readPositiveId(req.params.id, "ID penilaian");
    const existingEvaluation = await getExistingEvaluation(id);
    const payload = resolvePayloadByRole(
      req,
      normalizePayload(req.body as Record<string, unknown>)
    );

    if (req.user?.role === "pegawai" && existingEvaluation.evaluatorEmployeeId !== req.user.employeeId) {
      fail("Anda hanya dapat mengubah penilaian yang Anda buat sendiri", 403);
    }

    ensureValidPayload(payload);

    const duplicate = await getDuplicateEvaluation(payload, id);

    if (duplicate) {
      fail(
        "Pegawai ini sudah Anda nilai pada bulan dan tahun yang sama. Hanya satu data diizinkan untuk setiap periode bulan.",
        409
      );
    }

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

    const updated = await getSingleEvaluationById(id);

    return sendSuccess(res, updated, "Penilaian 360 BerAKHLAK berhasil diperbarui");
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") {
      fail(
        "Pegawai ini sudah Anda nilai pada bulan dan tahun yang sama. Hanya satu data penilaian yang diizinkan untuk periode tersebut.",
        409
      );
    }

    if (error?.code === "ER_NO_SUCH_TABLE") {
      fail(
        "Tabel penilaian 360 BerAKHLAK belum tersedia. Pastikan struktur database sudah diimpor dari sql/kinerja_pegawai_bps.sql.",
        500
      );
    }

    throw error;
  }
});

export const getBerakhlakDashboard = asyncHandler(async (req: AuthenticatedRequest, res) => {
  try {
    const selectedYear = readOptionalQueryNumber(req.query.year, 0);
    const selectedMonth = readOptionalQueryNumber(req.query.month, 0);
    const selectedEmployeeId = readOptionalQueryNumber(req.query.employeeId, 0);
    const whereClauses: string[] = [];
    const params: number[] = [];

    if (selectedYear > 0) {
      whereClauses.push("ev.tahun_evaluasi = ?");
      params.push(selectedYear);
    }

    if (selectedMonth > 0) {
      whereClauses.push("ev.bulan_evaluasi = ?");
      params.push(selectedMonth);
    }

    if (selectedEmployeeId > 0) {
      whereClauses.push("ev.pegawai_id = ?");
      params.push(selectedEmployeeId);
    }

    if (req.user?.role === "pegawai") {
      whereClauses.push("ev.penilai_pegawai_id = ?");
      params.push(req.user.employeeId);
    }

    const whereSql = whereClauses.length ? ` WHERE ${whereClauses.join(" AND ")}` : "";

    const [rows] = await pool.query<any[]>(
      `${BASE_SELECT}${whereSql}
       ORDER BY ev.diperbarui_pada DESC, ev.dibuat_pada DESC, ev.id DESC`,
      params
    );

    const formattedRows = formatEvaluationRows(rows);
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

    const dimensionDefinitions: Array<{
      key: keyof (typeof formattedRows)[number];
      label: string;
      apiKey: string;
    }> = [
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

    const employeeMap = new Map<
      number,
      {
        employeeId: number;
        fullName: string;
        nip: string;
        totalScore: number;
        totalEvaluations: number;
        lastEvaluatedAt: string | null;
      }
    >();

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

      if (
        !current.lastEvaluatedAt ||
        new Date(item.updatedAt || item.createdAt).getTime() >
          new Date(current.lastEvaluatedAt).getTime()
      ) {
        current.lastEvaluatedAt = item.updatedAt || item.createdAt;
      }

      employeeMap.set(item.employeeId, current);
    });

    const employeeScores =
      selectedEmployeeId > 0 && selectedMonth <= 0
        ? Array.from(
            formattedRows.reduce(
              (map, item) => {
                const key = `${item.evaluationYear}-${String(item.evaluationMonth).padStart(2, "0")}`;
                const current = map.get(key) || {
                  employeeId: item.employeeId,
                  fullName: item.employeeName,
                  nip: item.employeeNip,
                  evaluationYear: item.evaluationYear,
                  evaluationMonth: item.evaluationMonth,
                  totalScore: 0,
                  totalEvaluations: 0,
                  lastEvaluatedAt: null as string | null
                };

                current.totalScore += Number(item.finalScore);
                current.totalEvaluations += 1;

                if (
                  !current.lastEvaluatedAt ||
                  new Date(item.updatedAt || item.createdAt).getTime() >
                    new Date(current.lastEvaluatedAt).getTime()
                ) {
                  current.lastEvaluatedAt = item.updatedAt || item.createdAt;
                }

                map.set(key, current);
                return map;
              },
              new Map<
                string,
                {
                  employeeId: number;
                  fullName: string;
                  nip: string;
                  evaluationYear: number;
                  evaluationMonth: number;
                  totalScore: number;
                  totalEvaluations: number;
                  lastEvaluatedAt: string | null;
                }
              >()
            ).values()
          )
            .map((item) => ({
              employeeId: item.employeeId,
              fullName: item.fullName,
              nip: item.nip,
              evaluationYear: item.evaluationYear,
              evaluationMonth: item.evaluationMonth,
              periodLabel: `${item.evaluationYear}-${String(item.evaluationMonth).padStart(2, "0")}`,
              averageScore: Number((item.totalScore / item.totalEvaluations).toFixed(2)),
              totalEvaluations: item.totalEvaluations,
              lastEvaluatedAt: item.lastEvaluatedAt
            }))
            .sort(
              (a, b) =>
                b.evaluationYear - a.evaluationYear ||
                b.evaluationMonth - a.evaluationMonth
            )
        : Array.from(employeeMap.values())
            .map((item) => ({
              employeeId: item.employeeId,
              fullName: item.fullName,
              nip: item.nip,
              averageScore: Number((item.totalScore / item.totalEvaluations).toFixed(2)),
              totalEvaluations: item.totalEvaluations,
              lastEvaluatedAt: item.lastEvaluatedAt
            }))
            .sort(
              (a, b) => b.averageScore - a.averageScore || a.fullName.localeCompare(b.fullName)
            );

    const monthMap = new Map<
      string,
      { label: string; totalEvaluations: number; totalScore: number }
    >();

    formattedRows.forEach((item) => {
      const key = `${item.evaluationYear}-${String(item.evaluationMonth).padStart(2, "0")}`;
      const current = monthMap.get(key) || {
        label: key,
        totalEvaluations: 0,
        totalScore: 0
      };

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

    return sendSuccess(res, {
      selectedYear: selectedYear > 0 ? selectedYear : null,
      selectedMonth: selectedMonth > 0 ? selectedMonth : null,
      selectedEmployeeId: selectedEmployeeId > 0 ? selectedEmployeeId : null,
      totalEvaluations,
      totalEmployeesEvaluated,
      averageScore,
      activeMonthCount,
      dimensionAverages,
      employeeScores,
      monthlySummary,
      latestEvaluations: formattedRows.slice(0, 10)
    });
  } catch (error: any) {
    if (error?.code === "ER_NO_SUCH_TABLE") {
      fail(
        "Tabel penilaian 360 BerAKHLAK belum tersedia. Pastikan struktur database sudah diimpor dari sql/kinerja_pegawai_bps.sql.",
        500
      );
    }

    throw error;
  }
});