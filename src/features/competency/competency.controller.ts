import fs from "fs";
import path from "path";
import { pool } from "../../config/database";
import { CompetencyDevelopmentInput } from "../../types";
import { asyncHandler, fail, sendSuccess } from "../../shared/http";
import {
  ensureOneOf,
  ensureRequired,
  readDateString,
  readPositiveId,
  readPositiveNumber,
  readTrimmedString
} from "../../shared/validation";

const QUARTER_TARGET_HOURS = 5;
const ROLE_INDEX_MAP = {
  narasumber: 1.25,
  peserta: 1
} as const;

const ACTIVITY_ROLES = Object.keys(ROLE_INDEX_MAP) as Array<keyof typeof ROLE_INDEX_MAP>;
const UPLOAD_ROOT = path.resolve(process.cwd(), "uploads");

type UploadedFileMap = {
  invitationFile?: Express.Multer.File[];
  certificateFile?: Express.Multer.File[];
};

const toQuarter = (dateValue: string) => {
  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return Math.ceil((date.getMonth() + 1) / 3);
};

const readOptionalQueryNumber = (value: unknown) => {
  if (value === undefined || value === null || value === "") {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toPublicUploadPath = (storedPath?: string | null) => {
  if (!storedPath) {
    return null;
  }

  return storedPath.replace(/\\/g, "/");
};

const removeUploadFile = (storedPath?: string | null) => {
  if (!storedPath) {
    return;
  }

  const normalizedPath = storedPath.replace(/\\/g, "/");
  const absolutePath = path.isAbsolute(normalizedPath)
    ? path.resolve(normalizedPath)
    : path.resolve(UPLOAD_ROOT, normalizedPath.replace(/^\/+/, "").replace(/^uploads\//, ""));

  if (!absolutePath.startsWith(UPLOAD_ROOT)) {
    return;
  }

  if (fs.existsSync(absolutePath)) {
    fs.unlinkSync(absolutePath);
  }
};

const normalizePayload = (body: Record<string, unknown>): CompetencyDevelopmentInput => {
  const payload: CompetencyDevelopmentInput = {
    employeeId: readPositiveId(body.employeeId, "Pegawai"),
    activityName: ensureRequired(readTrimmedString(body.activityName), "Nama kegiatan wajib diisi"),
    activityType: ensureRequired(readTrimmedString(body.activityType), "Jenis kegiatan wajib diisi"),
    startDate: readDateString(body.startDate, "Tanggal mulai kegiatan"),
    endDate: readDateString(body.endDate, "Tanggal selesai kegiatan"),
    activityRole: ensureOneOf(
      readTrimmedString(body.activityRole || "peserta").toLowerCase(),
      ACTIVITY_ROLES,
      "Peran kegiatan"
    ),
    learningHours: readPositiveNumber(body.learningHours, "Jam pembelajaran"),
    note: readTrimmedString(body.note)
  };

  if (new Date(payload.endDate).getTime() < new Date(payload.startDate).getTime()) {
    fail("Tanggal selesai kegiatan tidak boleh lebih awal dari tanggal mulai kegiatan", 400);
  }

  return payload;
};

const mapActivityRow = (row: any) => ({
  ...row,
  invitationFilePath: toPublicUploadPath(row.invitationFilePath),
  certificateFilePath: toPublicUploadPath(row.certificateFilePath),
  invitationFileUrl: row.invitationFilePath ? toPublicUploadPath(row.invitationFilePath) : null,
  certificateFileUrl: row.certificateFilePath ? toPublicUploadPath(row.certificateFilePath) : null
});

const fetchActivityById = async (activityId: number) => {
  const [rows] = await pool.query<any[]>(
    `SELECT cd.id,
            cd.pegawai_id AS employeeId,
            e.nama_lengkap AS employeeName,
            e.nip,
            COALESCE(p.nama, e.nama_jabatan) AS position,
            cd.nama_kegiatan AS activityName,
            cd.jenis_kegiatan AS activityType,
            DATE_FORMAT(cd.tanggal_mulai, '%Y-%m-%d') AS startDate,
            DATE_FORMAT(cd.tanggal_selesai, '%Y-%m-%d') AS endDate,
            DATE_FORMAT(cd.tanggal_kegiatan, '%Y-%m-%d') AS activityDate,
            cd.tahun_kegiatan AS activityYear,
            cd.triwulan_kegiatan AS activityQuarter,
            cd.peran_kegiatan AS activityRole,
            cd.jam_pelajaran AS learningHours,
            cd.indeks_peran AS roleIndex,
            cd.jam_ekuivalen AS equivalentHours,
            cd.nama_asli_undangan AS invitationOriginalName,
            cd.path_file_undangan AS invitationFilePath,
            cd.nama_asli_sertifikat AS certificateOriginalName,
            cd.path_file_sertifikat AS certificateFilePath,
            cd.note,
            cd.dibuat_pada AS createdAt,
            cd.diperbarui_pada AS updatedAt
     FROM kegiatan_pengembangan_kompetensi cd
     INNER JOIN pegawai e ON e.id = cd.pegawai_id
     LEFT JOIN jabatan p ON p.id = e.jabatan_id
     WHERE cd.id = ?
     LIMIT 1`,
    [activityId]
  );

  return rows[0] ? mapActivityRow(rows[0]) : null;
};

const ensureEmployeeExists = async (employeeId: number) => {
  const [employeeRows] = await pool.query<any[]>(
    `SELECT id FROM pegawai WHERE id = ? LIMIT 1`,
    [employeeId]
  );

  if (!employeeRows.length) {
    fail("Pegawai tidak ditemukan", 400);
  }
};

export const getCompetencyDevelopmentRecap = asyncHandler(async (req, res) => {
  try {
    const requestedYear = readOptionalQueryNumber(req.query.year);
    const requestedQuarter = readOptionalQueryNumber(req.query.quarter);
    const requestedEmployeeId = readOptionalQueryNumber(req.query.employeeId);

    const hasYearFilter = requestedYear > 0;
    const hasQuarterFilter = requestedQuarter >= 1 && requestedQuarter <= 4;
    const hasEmployeeFilter = requestedEmployeeId > 0;

    const activityConditions: string[] = [];
    const activityParams: Array<number | string> = [];

    if (hasYearFilter) {
      activityConditions.push("cd.tahun_kegiatan = ?");
      activityParams.push(requestedYear);
    }

    if (hasQuarterFilter) {
      activityConditions.push("cd.triwulan_kegiatan = ?");
      activityParams.push(requestedQuarter);
    }

    if (hasEmployeeFilter) {
      activityConditions.push("cd.pegawai_id = ?");
      activityParams.push(requestedEmployeeId);
    }

    const activityWhereClause = activityConditions.length
      ? `WHERE ${activityConditions.join(" AND ")}`
      : "";

    const [activities] = await pool.query<any[]>(
      `SELECT cd.id,
              cd.pegawai_id AS employeeId,
              e.nama_lengkap AS employeeName,
              e.nip,
              COALESCE(p.nama, e.nama_jabatan) AS position,
              cd.nama_kegiatan AS activityName,
              cd.jenis_kegiatan AS activityType,
              DATE_FORMAT(cd.tanggal_mulai, '%Y-%m-%d') AS startDate,
              DATE_FORMAT(cd.tanggal_selesai, '%Y-%m-%d') AS endDate,
              DATE_FORMAT(cd.tanggal_kegiatan, '%Y-%m-%d') AS activityDate,
              cd.tahun_kegiatan AS activityYear,
              cd.triwulan_kegiatan AS activityQuarter,
              cd.peran_kegiatan AS activityRole,
              cd.jam_pelajaran AS learningHours,
              cd.indeks_peran AS roleIndex,
              cd.jam_ekuivalen AS equivalentHours,
              cd.nama_asli_undangan AS invitationOriginalName,
              cd.path_file_undangan AS invitationFilePath,
              cd.nama_asli_sertifikat AS certificateOriginalName,
              cd.path_file_sertifikat AS certificateFilePath,
              cd.note,
              cd.dibuat_pada AS createdAt,
              cd.diperbarui_pada AS updatedAt
       FROM kegiatan_pengembangan_kompetensi cd
       INNER JOIN pegawai e ON e.id = cd.pegawai_id
       LEFT JOIN jabatan p ON p.id = e.jabatan_id
       ${activityWhereClause}
       ORDER BY cd.tanggal_selesai DESC, cd.dibuat_pada DESC`,
      activityParams
    );

    const recapConditions: string[] = [];
    const recapParams: Array<number | string> = [];

    if (hasYearFilter) {
      recapConditions.push("tahun_kegiatan = ?");
      recapParams.push(requestedYear);
    }

    if (hasQuarterFilter) {
      recapConditions.push("triwulan_kegiatan = ?");
      recapParams.push(requestedQuarter);
    }

    const recapSummaryWhere = recapConditions.length
      ? `WHERE ${recapConditions.join(" AND ")}`
      : "";

    const employeeOuterWhere = hasEmployeeFilter ? "WHERE e.id = ?" : "";
    const employeeParams = hasEmployeeFilter ? [requestedEmployeeId] : [];

    const [recap] = await pool.query<any[]>(
      `SELECT e.id AS employeeId,
              e.nama_lengkap AS employeeName,
              e.nip,
              COALESCE(p.nama, e.nama_jabatan) AS position,
              e.status_aktif AS activeStatus,
              COALESCE(summary.activity_count, 0) AS activityCount,
              ROUND(COALESCE(summary.actual_hours, 0), 2) AS actualHours,
              ROUND(COALESCE(summary.jam_ekuivalen, 0), 2) AS equivalentHours,
              COALESCE(summary.narasumber_count, 0) AS narasumberCount,
              COALESCE(summary.peserta_count, 0) AS pesertaCount,
              DATE_FORMAT(summary.last_tanggal_kegiatan, '%Y-%m-%d') AS lastActivityDate,
              ROUND(
                LEAST(
                  100,
                  (COALESCE(summary.jam_ekuivalen, 0) / ?) * 100
                ),
                2
              ) AS quarterScore,
              ROUND(
                GREATEST(0, ? - COALESCE(summary.jam_ekuivalen, 0)),
                2
              ) AS remainingHours
       FROM pegawai e
       LEFT JOIN jabatan p ON p.id = e.jabatan_id
       LEFT JOIN (
         SELECT pegawai_id,
                COUNT(*) AS activity_count,
                SUM(jam_pelajaran) AS actual_hours,
                SUM(jam_ekuivalen) AS jam_ekuivalen,
                SUM(CASE WHEN peran_kegiatan = 'narasumber' THEN 1 ELSE 0 END) AS narasumber_count,
                SUM(CASE WHEN peran_kegiatan = 'peserta' THEN 1 ELSE 0 END) AS peserta_count,
                MAX(tanggal_selesai) AS last_tanggal_kegiatan
         FROM kegiatan_pengembangan_kompetensi
         ${recapSummaryWhere}
         GROUP BY pegawai_id
       ) summary ON summary.pegawai_id = e.id
       ${employeeOuterWhere}
       ORDER BY quarterScore DESC, equivalentHours DESC, employeeName ASC`,
      [QUARTER_TARGET_HOURS, QUARTER_TARGET_HOURS, ...recapParams, ...employeeParams]
    );

    return sendSuccess(res, {
      recap,
      activities: activities.map(mapActivityRow),
      meta: {
        quarterTargetHours: QUARTER_TARGET_HOURS,
        roleIndexes: ROLE_INDEX_MAP
      }
    });
  } catch (error: any) {
    if (error?.code === "ER_NO_SUCH_TABLE") {
      fail(
        "Tabel pengembangan kompetensi belum tersedia. Pastikan database diimpor dari backend/db/kinerja_pegawai_bps.sql.",
        500
      );
    }

    throw error;
  }
});

export const createCompetencyDevelopmentActivity = asyncHandler(async (req, res) => {
  const uploadedFiles = (req.files || {}) as UploadedFileMap;
  const invitationFile = uploadedFiles.invitationFile?.[0];
  const certificateFile = uploadedFiles.certificateFile?.[0];

  try {
    const payload = normalizePayload(req.body as Record<string, unknown>);
    const quarter = toQuarter(payload.endDate);

    if (!quarter) {
      fail("Tanggal selesai kegiatan tidak valid", 400);
    }

    const roleIndex = ROLE_INDEX_MAP[payload.activityRole];
    const equivalentHours = Number((payload.learningHours * roleIndex).toFixed(2));
    const activityYear = new Date(payload.endDate).getFullYear();

    await ensureEmployeeExists(payload.employeeId);

    const [result] = await pool.query<any>(
      `INSERT INTO kegiatan_pengembangan_kompetensi
       (
         pegawai_id,
         nama_kegiatan,
         jenis_kegiatan,
         tanggal_kegiatan,
         tanggal_mulai,
         tanggal_selesai,
         tahun_kegiatan,
         triwulan_kegiatan,
         peran_kegiatan,
         jam_pelajaran,
         indeks_peran,
         jam_ekuivalen,
         nama_asli_undangan,
         path_file_undangan,
         nama_asli_sertifikat,
         path_file_sertifikat,
         note
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.employeeId,
        payload.activityName,
        payload.activityType,
        payload.endDate,
        payload.startDate,
        payload.endDate,
        activityYear,
        quarter,
        payload.activityRole,
        payload.learningHours,
        roleIndex,
        equivalentHours,
        invitationFile?.originalname || null,
        invitationFile ? toPublicUploadPath(path.relative(process.cwd(), invitationFile.path)) : null,
        certificateFile?.originalname || null,
        certificateFile ? toPublicUploadPath(path.relative(process.cwd(), certificateFile.path)) : null,
        payload.note || null
      ]
    );

    const created = await fetchActivityById(Number(result.insertId));

    return sendSuccess(
      res,
      created,
      "Aktivitas pengembangan kompetensi berhasil disimpan",
      201
    );
  } catch (error: any) {
    removeUploadFile(invitationFile?.path);
    removeUploadFile(certificateFile?.path);

    if (error?.code === "ER_NO_SUCH_TABLE") {
      fail(
        "Tabel pengembangan kompetensi belum tersedia. Pastikan database diimpor dari backend/db/kinerja_pegawai_bps.sql.",
        500
      );
    }

    throw error;
  }
});

export const updateCompetencyDevelopmentActivity = asyncHandler(async (req, res) => {
  const activityId = readPositiveId(req.params.id, "ID aktivitas");
  const uploadedFiles = (req.files || {}) as UploadedFileMap;
  const invitationFile = uploadedFiles.invitationFile?.[0];
  const certificateFile = uploadedFiles.certificateFile?.[0];

  try {
    const payload = normalizePayload(req.body as Record<string, unknown>);
    const quarter = toQuarter(payload.endDate);

    if (!quarter) {
      fail("Tanggal selesai kegiatan tidak valid", 400);
    }

    const [existingRows] = await pool.query<any[]>(
      `SELECT id,
              nama_asli_undangan AS invitationOriginalName,
              path_file_undangan AS invitationFilePath,
              nama_asli_sertifikat AS certificateOriginalName,
              path_file_sertifikat AS certificateFilePath
       FROM kegiatan_pengembangan_kompetensi
       WHERE id = ?
       LIMIT 1`,
      [activityId]
    );

    if (!existingRows.length) {
      fail("Aktivitas tidak ditemukan", 404);
    }

    await ensureEmployeeExists(payload.employeeId);

    const existing = existingRows[0];
    const roleIndex = ROLE_INDEX_MAP[payload.activityRole];
    const equivalentHours = Number((payload.learningHours * roleIndex).toFixed(2));
    const activityYear = new Date(payload.endDate).getFullYear();
    const nextInvitationPath = invitationFile
      ? toPublicUploadPath(path.relative(process.cwd(), invitationFile.path))
      : existing.invitationFilePath;
    const nextCertificatePath = certificateFile
      ? toPublicUploadPath(path.relative(process.cwd(), certificateFile.path))
      : existing.certificateFilePath;

    await pool.query<any>(
      `UPDATE kegiatan_pengembangan_kompetensi
       SET pegawai_id = ?,
           nama_kegiatan = ?,
           jenis_kegiatan = ?,
           tanggal_kegiatan = ?,
           tanggal_mulai = ?,
           tanggal_selesai = ?,
           tahun_kegiatan = ?,
           triwulan_kegiatan = ?,
           peran_kegiatan = ?,
           jam_pelajaran = ?,
           indeks_peran = ?,
           jam_ekuivalen = ?,
           nama_asli_undangan = ?,
           path_file_undangan = ?,
           nama_asli_sertifikat = ?,
           path_file_sertifikat = ?,
           note = ?
       WHERE id = ?`,
      [
        payload.employeeId,
        payload.activityName,
        payload.activityType,
        payload.endDate,
        payload.startDate,
        payload.endDate,
        activityYear,
        quarter,
        payload.activityRole,
        payload.learningHours,
        roleIndex,
        equivalentHours,
        invitationFile?.originalname || existing.invitationOriginalName || null,
        nextInvitationPath,
        certificateFile?.originalname || existing.certificateOriginalName || null,
        nextCertificatePath,
        payload.note || null,
        activityId
      ]
    );

    if (invitationFile && existing.invitationFilePath) {
      removeUploadFile(existing.invitationFilePath);
    }

    if (certificateFile && existing.certificateFilePath) {
      removeUploadFile(existing.certificateFilePath);
    }

    const updated = await fetchActivityById(activityId);

    return sendSuccess(res, updated, "Aktivitas pengembangan kompetensi berhasil diperbarui");
  } catch (error: any) {
    removeUploadFile(invitationFile?.path);
    removeUploadFile(certificateFile?.path);

    if (error?.code === "ER_NO_SUCH_TABLE") {
      fail(
        "Tabel pengembangan kompetensi belum tersedia. Pastikan database diimpor dari backend/db/kinerja_pegawai_bps.sql.",
        500
      );
    }

    throw error;
  }
});

export const deleteCompetencyDevelopmentActivity = asyncHandler(async (req, res) => {
  const activityId = readPositiveId(req.params.id, "ID aktivitas");

  const [rows] = await pool.query<any[]>(
    `SELECT path_file_undangan AS invitationFilePath,
            path_file_sertifikat AS certificateFilePath
     FROM kegiatan_pengembangan_kompetensi
     WHERE id = ?
     LIMIT 1`,
    [activityId]
  );

  if (!rows.length) {
    fail("Aktivitas tidak ditemukan", 404);
  }

  await pool.query<any>(
    `DELETE FROM kegiatan_pengembangan_kompetensi WHERE id = ?`,
    [activityId]
  );

  removeUploadFile(rows[0].invitationFilePath);
  removeUploadFile(rows[0].certificateFilePath);

  return sendSuccess(res, null, "Aktivitas pengembangan kompetensi berhasil dihapus");
});
