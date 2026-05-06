import { ResultSetHeader } from "mysql2/promise";
import { asyncHandler, fail, sendSuccess } from "../../shared/http";
import { pool } from "../../config/database";
import { ensureOperationalSchema } from "./kinerja.operational.controller";
import {
  ensureOneOf,
  ensureRequired,
  readDateString,
  readIntegerInRange,
  readNonNegativeNumber,
  readPositiveId,
  readTrimmedString
} from "../../shared/validation";
import {
  activityStatusSql,
  getTimerDurationMinutesSql,
  getTimerDurationSecondsSql,
  normalizeActivityStatusValue
} from "./kinerja.timer.helper";

const safeNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const asNullableNumber = (value: unknown) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const TEAM_STATUS = ["aktif", "arsip"] as const;
const ASSIGNMENT_STATUS = ["draft", "berjalan", "selesai", "tertunda"] as const;
const LOGBOOK_STATUS = ["draft", "berjalan", "jeda", "dijeda", "selesai", "dikirim", "disetujui", "revisi"] as const;
const MONITORING_ACTIVITY_STATUS = ["berjalan", "jeda", "selesai"] as const;
const RECOMMENDATION_STATUS = ["draf", "ditinjau", "direkomendasikan", "ditindaklanjuti", "ditolak"] as const;
const APPROVAL_STAGE_STATUS = ["menunggu", "disetujui", "ditolak"] as const;

const monthLabels = [
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

const readOptionalDateString = (value: unknown, fieldName: string) => {
  const normalized = readTrimmedString(value);
  if (!normalized) return null;
  return readDateString(normalized, fieldName);
};

const readOptionalTimeString = (value: unknown) => {
  const normalized = readTrimmedString(value);
  return normalized || null;
};

const readIdArray = (value: unknown, fieldName: string) => {
  if (value === undefined || value === null || value === "") {
    return [] as number[];
  }

  const values = Array.isArray(value) ? value : String(value).split(",");
  return [...new Set(values.map((item) => readPositiveId(item, fieldName)))];
};

const ensureEmployeeExists = async (employeeId: number) => {
  const [rows] = await pool.query<any[]>(
    `SELECT id FROM pegawai WHERE id = ? LIMIT 1`,
    [employeeId]
  );

  if (!rows.length) {
    fail("Pegawai tidak ditemukan", 404);
  }
};

const ensureTeamExists = async (teamId: number) => {
  const [rows] = await pool.query<any[]>(
    `SELECT id FROM kinerja_tim_kerja WHERE id = ? LIMIT 1`,
    [teamId]
  );

  if (!rows.length) {
    fail("Tim kerja tidak ditemukan", 404);
  }
};

const ensureAssignmentExists = async (assignmentId: number) => {
  const [rows] = await pool.query<any[]>(
    `SELECT id FROM kinerja_assignment WHERE id = ? LIMIT 1`,
    [assignmentId]
  );

  if (!rows.length) {
    fail("Penugasan tidak ditemukan", 404);
  }
};

const normalizeTeamPayload = (body: Record<string, unknown>) => ({
  teamName: ensureRequired(readTrimmedString(body.teamName), "Nama tim wajib diisi"),
  leaderEmployeeId: body.leaderEmployeeId ? readPositiveId(body.leaderEmployeeId, "Ketua tim") : null,
  focus: readTrimmedString(body.focus),
  status: ensureOneOf(readTrimmedString(body.status || "aktif").toLowerCase(), TEAM_STATUS, "Status tim"),
  formedDate: readOptionalDateString(body.formedDate, "Tanggal dibentuk"),
  memberIds: readIdArray(body.memberIds, "Anggota tim")
});

const normalizeAssignmentPayload = (body: Record<string, unknown>) => {
  const startDate = readDateString(body.startDate, "Tanggal mulai");
  const endDate = readDateString(body.endDate, "Tanggal selesai");

  if (new Date(endDate).getTime() < new Date(startDate).getTime()) {
    fail("Tanggal selesai tidak boleh lebih awal dari tanggal mulai", 400);
  }

  return {
    employeeId: readPositiveId(body.employeeId, "Pegawai"),
    teamId: body.teamId ? readPositiveId(body.teamId, "Tim kerja") : null,
    title: ensureRequired(readTrimmedString(body.title), "Judul penugasan wajib diisi"),
    startDate,
    endDate,
    status: ensureOneOf(readTrimmedString(body.status || "draft").toLowerCase(), ASSIGNMENT_STATUS, "Status penugasan"),
    progress: readIntegerInRange(body.progress ?? 0, 0, 100, "Progres"),
    note: readTrimmedString(body.note)
  };
};

const normalizeLogbookPayload = (body: Record<string, unknown>) => ({
  employeeId: readPositiveId(body.employeeId, "Pegawai"),
  assignmentId: body.assignmentId ? readPositiveId(body.assignmentId, "Penugasan") : null,
  activityDate: readDateString(body.activityDate, "Tanggal aktivitas"),
  startTime: readOptionalTimeString(body.startTime),
  endTime: readOptionalTimeString(body.endTime),
  activity: ensureRequired(readTrimmedString(body.activity), "Uraian aktivitas wajib diisi"),
  output: readTrimmedString(body.output),
  status: ensureOneOf(readTrimmedString(body.status || "draft").toLowerCase(), LOGBOOK_STATUS, "Status logbook")
});

const buildTeamRecord = (row: any) => ({
  id: Number(row.id),
  teamName: String(row.teamName || ""),
  leaderEmployeeId: row.leaderEmployeeId ? Number(row.leaderEmployeeId) : null,
  leaderName: String(row.leaderName || "-"),
  focus: String(row.focus || ""),
  status: String(row.status || "aktif"),
  formedDate: row.formedDate ? String(row.formedDate) : null,
  totalMembers: Number(row.totalMembers || 0),
  memberIds: String(row.memberIds || "")
    .split(",")
    .map((item: string) => item.trim())
    .filter(Boolean)
    .map((item: string) => Number(item)),
  memberNames: String(row.memberNames || "")
    .split(",")
    .map((item: string) => item.trim())
    .filter(Boolean)
});

const buildAssignmentRecord = (row: any) => ({
  id: Number(row.id),
  employeeId: Number(row.employeeId),
  employeeName: String(row.employeeName || "-"),
  teamId: row.teamId ? Number(row.teamId) : null,
  teamName: String(row.teamName || "-"),
  title: String(row.title || ""),
  startDate: row.startDate ? String(row.startDate) : null,
  endDate: row.endDate ? String(row.endDate) : null,
  status: String(row.status || "draft"),
  progress: Number(row.progress || 0),
  note: String(row.note || ""),
  createdAt: row.createdAt ? String(row.createdAt) : null,
  updatedAt: row.updatedAt ? String(row.updatedAt) : null
});

const buildLogbookRecord = (row: any) => ({
  id: Number(row.id),
  employeeId: Number(row.employeeId),
  employeeName: String(row.employeeName || "-"),
  periodeId: row.periodeId ? Number(row.periodeId) : null,
  periodeName: String(row.periodeName || ""),
  assignmentId: row.assignmentId ? Number(row.assignmentId) : null,
  assignmentTitle: String(row.assignmentTitle || "-"),
  teamId: row.teamId ? Number(row.teamId) : null,
  teamName: String(row.teamName || "-"),
  indicatorId: row.indicatorId ? Number(row.indicatorId) : null,
  indicatorName: String(row.indicatorName || ""),
  activityId: row.activityId ? Number(row.activityId) : null,
  activityName: String(row.activityName || ""),
  categoryId: row.categoryId ? Number(row.categoryId) : null,
  categoryName: String(row.categoryName || ""),
  unitId: row.unitId ? Number(row.unitId) : null,
  unitName: String(row.unitName || "-"),
  activityDate: String(row.activityDate || ""),
  startTime: row.startTime ? String(row.startTime) : null,
  endTime: row.endTime ? String(row.endTime) : null,
  activity: String(row.activity || ""),
  volume: row.volume == null ? null : Number(row.volume),
  durationMinutes: row.durationMinutes == null ? null : Number(row.durationMinutes),
  startedAt: row.startedAt ? String(row.startedAt) : null,
  pausedAt: row.pausedAt ? String(row.pausedAt) : null,
  resumedAt: row.resumedAt ? String(row.resumedAt) : null,
  finishedAt: row.finishedAt ? String(row.finishedAt) : null,
  totalPausedSeconds: Number(row.totalPausedSeconds || 0),
  activeDurationSeconds: asNullableNumber(row.activeDurationSeconds),
  serverNow: row.serverNow ? String(row.serverNow) : null,
  output: String(row.output || ""),
  evidenceCount: Number(row.evidenceCount || 0),
  activityStatus: row.activityStatus ? String(row.activityStatus) : null,
  status: String(row.activityStatus || row.status || "draft"),
  administrativeStatus: String(row.status || "draft"),
  lastActivityAt: row.lastActivityAt ? String(row.lastActivityAt) : null,
  createdAt: row.createdAt ? String(row.createdAt) : null,
  updatedAt: row.updatedAt ? String(row.updatedAt) : null
});

const buildRecommendationRecord = (row: any) => ({
  id: Number(row.id),
  employeeId: Number(row.employeeId),
  employeeName: String(row.employeeName || "-"),
  nip: String(row.nip || ""),
  position: String(row.position || "-"),
  year: Number(row.year || 0),
  month: Number(row.month || 0),
  periodLabel: String(row.periodLabel || ""),
  recommendationScore: Number(row.recommendationScore || 0),
  status: String(row.status || "draf"),
  summary: String(row.summary || ""),
  followUpNote: String(row.followUpNote || ""),
  reviewerEmployeeId: row.reviewerEmployeeId ? Number(row.reviewerEmployeeId) : null,
  reviewerName: String(row.reviewerName || "-"),
  reviewedAt: row.reviewedAt ? String(row.reviewedAt) : null,
  approvalStage1Status: String(row.approvalStage1Status || "menunggu"),
  approvalStage1ReviewerId: row.approvalStage1ReviewerId ? Number(row.approvalStage1ReviewerId) : null,
  approvalStage1ReviewerName: String(row.approvalStage1ReviewerName || "-"),
  approvalStage1ReviewedAt: row.approvalStage1ReviewedAt ? String(row.approvalStage1ReviewedAt) : null,
  approvalStage1Note: String(row.approvalStage1Note || ""),
  approvalStage2Status: String(row.approvalStage2Status || "menunggu"),
  approvalStage2ReviewerId: row.approvalStage2ReviewerId ? Number(row.approvalStage2ReviewerId) : null,
  approvalStage2ReviewerName: String(row.approvalStage2ReviewerName || "-"),
  approvalStage2ReviewedAt: row.approvalStage2ReviewedAt ? String(row.approvalStage2ReviewedAt) : null,
  approvalStage2Note: String(row.approvalStage2Note || ""),
  createdAt: row.createdAt ? String(row.createdAt) : null,
  updatedAt: row.updatedAt ? String(row.updatedAt) : null
});

export const getKinerjaBootstrap = asyncHandler(async (_req, res) => {
  await ensureKinerjaRecommendationSchema();
  const [[employeeSummary]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS totalEmployees FROM pegawai WHERE status_aktif = 'aktif'`
  );

  const unitSummary = { totalUnits: 0 };

  const [[teamSummary]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS totalTeams FROM kinerja_tim_kerja WHERE status = 'aktif'`
  );

  const [[assignmentSummary]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS totalAssignments FROM kinerja_assignment`
  );

  const [[logbookSummary]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS totalLogbooks FROM kinerja_logbook`
  );

  const [employeePreview] = await pool.query<any[]>(
    `SELECT e.id,
            e.nip,
            e.nama_lengkap AS fullName,
            e.nama_jabatan AS position,
            e.status_aktif AS activeStatus,
            COUNT(DISTINCT a.id) AS assignmentCount,
            COUNT(DISTINCT l.id) AS logbookCount
     FROM pegawai e
     LEFT JOIN kinerja_assignment a ON a.pegawai_id = e.id
     LEFT JOIN kinerja_logbook l ON l.pegawai_id = e.id
     GROUP BY e.id, e.nip, e.nama_lengkap, e.nama_jabatan, e.status_aktif
     ORDER BY e.nama_lengkap ASC
     LIMIT 8`
  );

  const workUnitPreview: any[] = [];

  const [teamPreview] = await pool.query<any[]>(
    `SELECT tk.id,
            tk.nama_tim AS teamName,
            COALESCE(p.nama_lengkap, '-') AS leaderName,
            tk.fokus_kinerja AS focus,
            tk.status,
            COUNT(DISTINCT ta.id) AS totalMembers
     FROM kinerja_tim_kerja tk
     LEFT JOIN pegawai p ON p.id = tk.ketua_pegawai_id
     LEFT JOIN kinerja_tim_anggota ta ON ta.tim_kerja_id = tk.id
     GROUP BY tk.id, tk.nama_tim, p.nama_lengkap, tk.fokus_kinerja, tk.status
     ORDER BY tk.dibentuk_pada DESC, tk.nama_tim ASC
     LIMIT 8`
  );

  const [assignmentPreview] = await pool.query<any[]>(
    `SELECT a.id,
            a.judul AS title,
            COALESCE(p.nama_lengkap, '-') AS employeeName,
            COALESCE(tk.nama_tim, '-') AS teamName,
            a.status,
            a.progres AS progress,
            DATE_FORMAT(a.target_mulai, '%Y-%m-%d') AS startDate,
            DATE_FORMAT(a.target_selesai, '%Y-%m-%d') AS endDate
     FROM kinerja_assignment a
     LEFT JOIN pegawai p ON p.id = a.pegawai_id
     LEFT JOIN kinerja_tim_kerja tk ON tk.id = a.tim_kerja_id
     ORDER BY a.dibuat_pada DESC
     LIMIT 8`
  );

  const [logbookPreview] = await pool.query<any[]>(
    `SELECT l.id,
            DATE_FORMAT(l.tanggal_kegiatan, '%Y-%m-%d') AS activityDate,
            COALESCE(p.nama_lengkap, '-') AS employeeName,
            COALESCE(a.judul, '-') AS assignmentTitle,
            l.uraian_kegiatan AS activity,
            COALESCE(l.output_kegiatan, '-') AS output,
            l.status
     FROM kinerja_logbook l
     LEFT JOIN pegawai p ON p.id = l.pegawai_id
     LEFT JOIN kinerja_assignment a ON a.id = l.assignment_id
     ORDER BY l.tanggal_kegiatan DESC, l.dibuat_pada DESC
     LIMIT 8`
  );

  const [recommendationPreview] = await pool.query<any[]>(
    `SELECT r.id,
            COALESCE(p.nama_lengkap, '-') AS employeeName,
            r.tahun,
            r.bulan,
            r.nilai_rekomendasi AS recommendationScore,
            r.status,
            r.ringkasan AS summary
     FROM kinerja_rekomendasi_ckp r
     LEFT JOIN pegawai p ON p.id = r.pegawai_id
     ORDER BY r.tahun DESC, r.bulan DESC, p.nama_lengkap ASC
     LIMIT 8`
  );

  const [reportPreview] = await pool.query<any[]>(
    `SELECT p.nama_lengkap AS employeeName,
            DATE_FORMAT(l.tanggal_kegiatan, '%Y-%m') AS periodLabel,
            COUNT(*) AS totalActivities,
            SUM(CASE WHEN l.status = 'disetujui' THEN 1 ELSE 0 END) AS approvedActivities
     FROM kinerja_logbook l
     LEFT JOIN pegawai p ON p.id = l.pegawai_id
     GROUP BY p.nama_lengkap, DATE_FORMAT(l.tanggal_kegiatan, '%Y-%m')
     ORDER BY periodLabel DESC, totalActivities DESC
     LIMIT 8`
  );

  const activityTimeline = logbookPreview.slice(0, 6).map((item) => ({
    date: item.activityDate,
    title: item.assignmentTitle,
    description: `${item.employeeName} · ${item.activity}`,
    status: item.status
  }));

  return sendSuccess(res, {
    summary: {
      totalEmployees: safeNumber(employeeSummary?.totalEmployees),
      totalUnits: safeNumber(unitSummary?.totalUnits),
      totalTeams: safeNumber(teamSummary?.totalTeams),
      totalAssignments: safeNumber(assignmentSummary?.totalAssignments),
      totalLogbooks: safeNumber(logbookSummary?.totalLogbooks)
    },
    employeePreview,
    workUnitPreview,
    teamPreview,
    assignmentPreview,
    logbookPreview,
    recommendationPreview,
    reportPreview,
    activityTimeline
  });
});

export const getKinerjaLookups = asyncHandler(async (_req, res) => {
  const currentYear = new Date().getFullYear();

  const [employeeRows] = await pool.query<any[]>(
    `SELECT e.id,
            e.nama_lengkap AS name,
            e.nip,
            COALESCE(j.nama, e.nama_jabatan) AS position
     FROM pegawai e
     LEFT JOIN jabatan j ON j.id = e.jabatan_id
     WHERE e.status_aktif = 'aktif'
     ORDER BY e.nama_lengkap ASC`
  );

  const [workUnitRows] = await pool.query<any[]>(
    `SELECT id, nama AS name
     FROM departemen
     ORDER BY nama ASC`
  );

  const [teamRows] = await pool.query<any[]>(
    `SELECT id, nama_tim AS name
     FROM kinerja_tim_kerja
     ORDER BY nama_tim ASC`
  );

  const [periodYearRows] = await pool.query<any[]>(
    `SELECT DISTINCT tahun AS year
     FROM kinerja_periode
     WHERE tahun IS NOT NULL
     ORDER BY tahun DESC`
  );

  const years = Array.from(
    new Set(
      [currentYear, ...periodYearRows.map((row) => Number(row.year || 0)).filter((value) => Number.isFinite(value) && value >= 2020)]
    )
  ).sort((left, right) => right - left);

  return sendSuccess(res, {
    employees: employeeRows.map((row) => ({
      id: Number(row.id),
      name: String(row.name || ""),
      nip: String(row.nip || ""),
      position: String(row.position || "")
    })),
    workUnits: workUnitRows.map((row) => ({
      id: Number(row.id),
      name: String(row.name || ""),
      unitCode: String(row.unitCode || "")
    })),
    teams: teamRows.map((row) => ({ id: Number(row.id), name: String(row.name || "") })),
    teamStatuses: [...TEAM_STATUS],
    assignmentStatuses: [...ASSIGNMENT_STATUS],
    logbookStatuses: [...LOGBOOK_STATUS],
    recommendationStatuses: [...RECOMMENDATION_STATUS],
    years,
    months: monthLabels.map((label, index) => ({ value: index + 1, label }))
  });
});

export const getKinerjaTeams = asyncHandler(async (_req, res) => {
  const [rows] = await pool.query<any[]>(
    `SELECT tk.id,
            tk.nama_tim AS teamName,
            tk.ketua_pegawai_id AS leaderEmployeeId,
            COALESCE(p.nama_lengkap, '-') AS leaderName,
            tk.fokus_kinerja AS focus,
            tk.status,
            DATE_FORMAT(tk.dibentuk_pada, '%Y-%m-%d') AS formedDate,
            COUNT(DISTINCT ta.id) AS totalMembers,
            GROUP_CONCAT(DISTINCT ta.pegawai_id ORDER BY ta.pegawai_id) AS memberIds,
            GROUP_CONCAT(DISTINCT pm.nama_lengkap ORDER BY pm.nama_lengkap SEPARATOR ', ') AS memberNames
     FROM kinerja_tim_kerja tk
     LEFT JOIN pegawai p ON p.id = tk.ketua_pegawai_id
     LEFT JOIN kinerja_tim_anggota ta ON ta.tim_kerja_id = tk.id
     LEFT JOIN pegawai pm ON pm.id = ta.pegawai_id
     GROUP BY tk.id, tk.nama_tim, tk.ketua_pegawai_id, p.nama_lengkap, tk.fokus_kinerja, tk.status, tk.dibentuk_pada
     ORDER BY tk.dibentuk_pada DESC, tk.nama_tim ASC`
  );

  return sendSuccess(res, rows.map(buildTeamRecord));
});

export const createKinerjaTeam = asyncHandler(async (req, res) => {
  const payload = normalizeTeamPayload(req.body || {});
  if (payload.leaderEmployeeId) await ensureEmployeeExists(payload.leaderEmployeeId);
  for (const memberId of payload.memberIds) {
    await ensureEmployeeExists(memberId);
  }

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO kinerja_tim_kerja (nama_tim, ketua_pegawai_id, fokus_kinerja, status, dibentuk_pada)
     VALUES (?, ?, ?, ?, ?)`,
    [payload.teamName, payload.leaderEmployeeId, payload.focus || null, payload.status, payload.formedDate]
  );

  if (payload.memberIds.length) {
    await pool.query(
      `INSERT INTO kinerja_tim_anggota (tim_kerja_id, pegawai_id, peran)
       VALUES ${payload.memberIds.map(() => '(?, ?, ?)').join(', ')}`,
      payload.memberIds.flatMap((memberId) => [result.insertId, memberId, 'anggota'])
    );
  }

  return sendSuccess(res, { id: result.insertId }, "Tim kerja berhasil ditambahkan", 201);
});

export const updateKinerjaTeam = asyncHandler(async (req, res) => {
  const id = readPositiveId(req.params.id, "Tim kerja");
  const payload = normalizeTeamPayload(req.body || {});
  await ensureTeamExists(id);
  if (payload.leaderEmployeeId) await ensureEmployeeExists(payload.leaderEmployeeId);
  for (const memberId of payload.memberIds) await ensureEmployeeExists(memberId);

  await pool.query(
    `UPDATE kinerja_tim_kerja
     SET nama_tim = ?, ketua_pegawai_id = ?, fokus_kinerja = ?, status = ?, dibentuk_pada = ?
     WHERE id = ?`,
    [payload.teamName, payload.leaderEmployeeId, payload.focus || null, payload.status, payload.formedDate, id]
  );

  await pool.query(`DELETE FROM kinerja_tim_anggota WHERE tim_kerja_id = ?`, [id]);

  if (payload.memberIds.length) {
    await pool.query(
      `INSERT INTO kinerja_tim_anggota (tim_kerja_id, pegawai_id, peran)
       VALUES ${payload.memberIds.map(() => '(?, ?, ?)').join(', ')}`,
      payload.memberIds.flatMap((memberId) => [id, memberId, 'anggota'])
    );
  }

  return sendSuccess(res, null, "Tim kerja berhasil diperbarui");
});

export const deleteKinerjaTeam = asyncHandler(async (req, res) => {
  const id = readPositiveId(req.params.id, "Tim kerja");
  const [result] = await pool.query<ResultSetHeader>(`DELETE FROM kinerja_tim_kerja WHERE id = ?`, [id]);

  if (!result.affectedRows) {
    fail("Tim kerja tidak ditemukan", 404);
  }

  return sendSuccess(res, null, "Tim kerja berhasil dihapus");
});

export const getKinerjaAssignments = asyncHandler(async (req, res) => {
  const conditions: string[] = [];
  const params: Array<number | string> = [];

  if (req.query.employeeId) {
    conditions.push(`a.pegawai_id = ?`);
    params.push(readPositiveId(req.query.employeeId, "Pegawai"));
  }

  if (req.query.teamId) {
    conditions.push(`a.tim_kerja_id = ?`);
    params.push(readPositiveId(req.query.teamId, "Tim kerja"));
  }

  if (req.query.status) {
    conditions.push(`a.status = ?`);
    params.push(ensureOneOf(readTrimmedString(req.query.status).toLowerCase(), ASSIGNMENT_STATUS, "Status penugasan"));
  }

  if (req.query.month) {
    conditions.push(`MONTH(a.target_mulai) = ?`);
    params.push(readIntegerInRange(req.query.month, 1, 12, "Bulan"));
  }

  if (req.query.year) {
    conditions.push(`YEAR(a.target_mulai) = ?`);
    params.push(readIntegerInRange(req.query.year, 2020, 2100, "Tahun"));
  }

  if (req.query.search) {
    conditions.push(`(a.judul LIKE ? OR p.nama_lengkap LIKE ? OR tk.nama_tim LIKE ?)`);
    const keyword = `%${readTrimmedString(req.query.search)}%`;
    params.push(keyword, keyword, keyword);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows] = await pool.query<any[]>(
    `SELECT a.id,
            a.pegawai_id AS employeeId,
            COALESCE(p.nama_lengkap, '-') AS employeeName,
            a.tim_kerja_id AS teamId,
            COALESCE(tk.nama_tim, '-') AS teamName,
            a.judul AS title,
            DATE_FORMAT(a.target_mulai, '%Y-%m-%d') AS startDate,
            DATE_FORMAT(a.target_selesai, '%Y-%m-%d') AS endDate,
            a.status,
            a.progres AS progress,
            a.note,
            a.dibuat_pada AS createdAt,
            a.diperbarui_pada AS updatedAt
     FROM kinerja_assignment a
     LEFT JOIN pegawai p ON p.id = a.pegawai_id
     LEFT JOIN kinerja_tim_kerja tk ON tk.id = a.tim_kerja_id
     ${whereSql}
     ORDER BY a.dibuat_pada DESC, a.id DESC`,
    params
  );

  return sendSuccess(res, rows.map(buildAssignmentRecord));
});

export const createKinerjaAssignment = asyncHandler(async (req, res) => {
  const payload = normalizeAssignmentPayload(req.body || {});
  await ensureEmployeeExists(payload.employeeId);
  if (payload.teamId) await ensureTeamExists(payload.teamId);

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO kinerja_assignment (pegawai_id, tim_kerja_id, judul, target_mulai, target_selesai, status, progres, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [payload.employeeId, payload.teamId, payload.title, payload.startDate, payload.endDate, payload.status, payload.progress, payload.note || null]
  );

  return sendSuccess(res, { id: result.insertId }, "Penugasan berhasil ditambahkan", 201);
});

export const updateKinerjaAssignment = asyncHandler(async (req, res) => {
  const id = readPositiveId(req.params.id, "Penugasan");
  const payload = normalizeAssignmentPayload(req.body || {});
  await ensureAssignmentExists(id);
  await ensureEmployeeExists(payload.employeeId);
  if (payload.teamId) await ensureTeamExists(payload.teamId);

  await pool.query(
    `UPDATE kinerja_assignment
     SET pegawai_id = ?, tim_kerja_id = ?, judul = ?, target_mulai = ?, target_selesai = ?, status = ?, progres = ?, note = ?
     WHERE id = ?`,
    [payload.employeeId, payload.teamId, payload.title, payload.startDate, payload.endDate, payload.status, payload.progress, payload.note || null, id]
  );

  return sendSuccess(res, null, "Penugasan berhasil diperbarui");
});

export const deleteKinerjaAssignment = asyncHandler(async (req, res) => {
  const id = readPositiveId(req.params.id, "Penugasan");
  const [result] = await pool.query<ResultSetHeader>(`DELETE FROM kinerja_assignment WHERE id = ?`, [id]);

  if (!result.affectedRows) {
    fail("Penugasan tidak ditemukan", 404);
  }

  return sendSuccess(res, null, "Penugasan berhasil dihapus");
});

export const getKinerjaLogbooks = asyncHandler(async (req, res) => {
  const conditions: string[] = [];
  const params: Array<number | string> = [];

  if (req.query.employeeId) {
    conditions.push(`l.pegawai_id = ?`);
    params.push(readPositiveId(req.query.employeeId, "Pegawai"));
  }

  if (req.query.assignmentId) {
    conditions.push(`l.assignment_id = ?`);
    params.push(readPositiveId(req.query.assignmentId, "Penugasan"));
  }

  if (req.query.status) {
    conditions.push(`${activityStatusSql('l')} = ?`);
    params.push(ensureOneOf(normalizeActivityStatusValue(req.query.status), MONITORING_ACTIVITY_STATUS, "Status aktivitas"));
  }
  conditions.push(`${activityStatusSql('l')} IN ('berjalan', 'jeda', 'selesai')`);

  if (req.query.month) {
    conditions.push(`MONTH(l.tanggal_kegiatan) = ?`);
    params.push(readIntegerInRange(req.query.month, 1, 12, "Bulan"));
  }

  if (req.query.year) {
    conditions.push(`YEAR(l.tanggal_kegiatan) = ?`);
    params.push(readIntegerInRange(req.query.year, 2020, 2100, "Tahun"));
  }

  if (req.query.search) {
    conditions.push(`(l.uraian_kegiatan LIKE ? OR p.nama_lengkap LIKE ? OR a.judul LIKE ?)`);
    const keyword = `%${readTrimmedString(req.query.search)}%`;
    params.push(keyword, keyword, keyword);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows] = await pool.query<any[]>(
    `SELECT l.id,
            l.pegawai_id AS employeeId,
            COALESCE(p.nama_lengkap, '-') AS employeeName,
            l.assignment_id AS assignmentId,
            COALESCE(a.judul, '-') AS assignmentTitle,
            DATE_FORMAT(l.tanggal_kegiatan, '%Y-%m-%d') AS activityDate,
            TIME_FORMAT(l.jam_mulai, '%H:%i') AS startTime,
            TIME_FORMAT(l.jam_selesai, '%H:%i') AS endTime,
            l.uraian_kegiatan AS activity,
            COALESCE(l.output_kegiatan, '') AS output,
            l.status,
            DATE_FORMAT(l.dibuat_pada, '%Y-%m-%dT%H:%i:%s') AS createdAt,
            DATE_FORMAT(COALESCE(l.diperbarui_pada, l.dibuat_pada), '%Y-%m-%dT%H:%i:%s') AS updatedAt
     FROM kinerja_logbook l
     LEFT JOIN pegawai p ON p.id = l.pegawai_id
     LEFT JOIN kinerja_assignment a ON a.id = l.assignment_id
     ${whereSql}
     ORDER BY l.tanggal_kegiatan DESC, l.dibuat_pada DESC`,
    params
  );

  return sendSuccess(res, rows.map(buildLogbookRecord));
});

export const createKinerjaLogbook = asyncHandler(async (req, res) => {
  const payload = normalizeLogbookPayload(req.body || {});
  await ensureEmployeeExists(payload.employeeId);
  if (payload.assignmentId) await ensureAssignmentExists(payload.assignmentId);

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO kinerja_logbook (pegawai_id, assignment_id, tanggal_kegiatan, jam_mulai, jam_selesai, uraian_kegiatan, output_kegiatan, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [payload.employeeId, payload.assignmentId, payload.activityDate, payload.startTime, payload.endTime, payload.activity, payload.output || null, payload.status]
  );

  return sendSuccess(res, { id: result.insertId }, "Aktivitas berhasil ditambahkan", 201);
});

export const updateKinerjaLogbook = asyncHandler(async (req, res) => {
  const id = readPositiveId(req.params.id, "Log book");
  const payload = normalizeLogbookPayload(req.body || {});
  await ensureEmployeeExists(payload.employeeId);
  if (payload.assignmentId) await ensureAssignmentExists(payload.assignmentId);

  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE kinerja_logbook
     SET pegawai_id = ?, assignment_id = ?, tanggal_kegiatan = ?, jam_mulai = ?, jam_selesai = ?, uraian_kegiatan = ?, output_kegiatan = ?, status = ?
     WHERE id = ?`,
    [payload.employeeId, payload.assignmentId, payload.activityDate, payload.startTime, payload.endTime, payload.activity, payload.output || null, payload.status, id]
  );

  if (!result.affectedRows) {
    fail("Aktivitas tidak ditemukan", 404);
  }

  return sendSuccess(res, null, "Aktivitas berhasil diperbarui");
});

export const deleteKinerjaLogbook = asyncHandler(async (req, res) => {
  const id = readPositiveId(req.params.id, "Log book");
  const [result] = await pool.query<ResultSetHeader>(`DELETE FROM kinerja_logbook WHERE id = ?`, [id]);

  if (!result.affectedRows) {
    fail("Aktivitas tidak ditemukan", 404);
  }

  return sendSuccess(res, null, "Aktivitas berhasil dihapus");
});

export const getKinerjaMonitoringLogbooks = asyncHandler(async (req, res) => {
  await ensureOperationalSchema();
  const conditions: string[] = [];
  const params: Array<number | string> = [];

  if (req.query.date) {
    conditions.push(`l.tanggal_kegiatan = ?`);
    params.push(readDateString(req.query.date, "Tanggal monitoring"));
  }
  if (req.query.employeeId) {
    conditions.push(`l.pegawai_id = ?`);
    params.push(readPositiveId(req.query.employeeId, "Pegawai"));
  }
  if (req.query.teamId) {
    conditions.push(`COALESCE(l.tim_kerja_id, a.tim_kerja_id) = ?`);
    params.push(readPositiveId(req.query.teamId, "Tim kerja"));
  }
  if (req.query.status) {
    conditions.push(`${activityStatusSql('l')} = ?`);
    params.push(ensureOneOf(normalizeActivityStatusValue(req.query.status), MONITORING_ACTIVITY_STATUS, "Status aktivitas"));
  }

  const keyword = readTrimmedString(req.query.keyword);
  if (keyword) {
    const keywordParam = `%${keyword}%`;
    conditions.push(`(
      l.uraian_kegiatan LIKE ?
      OR COALESCE(l.output_kegiatan, '') LIKE ?
      OR COALESCE(p.nama_lengkap, '') LIKE ?
      OR COALESCE(a.judul, '') LIKE ?
      OR COALESCE(tk.nama_tim, atk.nama_tim, '') LIKE ?
    )`);
    params.push(keywordParam, keywordParam, keywordParam, keywordParam, keywordParam);
  }

  conditions.push(`${activityStatusSql('l')} IN ('berjalan', 'jeda', 'selesai')`);
  if (req.query.month) {
    conditions.push(`MONTH(l.tanggal_kegiatan) = ?`);
    params.push(readIntegerInRange(req.query.month, 1, 12, "Bulan"));
  }
  if (req.query.year) {
    conditions.push(`YEAR(l.tanggal_kegiatan) = ?`);
    params.push(readIntegerInRange(req.query.year, 2020, 2100, "Tahun"));
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const fromSql = `FROM kinerja_logbook l
     LEFT JOIN pegawai p ON p.id = l.pegawai_id
     LEFT JOIN kinerja_assignment a ON a.id = l.assignment_id
     LEFT JOIN kinerja_tim_kerja tk ON tk.id = l.tim_kerja_id
     LEFT JOIN kinerja_tim_kerja atk ON atk.id = a.tim_kerja_id
     LEFT JOIN kinerja_satuan s ON s.id = l.satuan_id`;

  const [summaryRows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS totalRecords,
            SUM(CASE WHEN ${activityStatusSql('l')} = 'selesai' THEN 1 ELSE 0 END) AS approvedRecords,
            SUM(CASE WHEN ${activityStatusSql('l')} = 'berjalan' THEN 1 ELSE 0 END) AS sentRecords,
            SUM(CASE WHEN ${activityStatusSql('l')} = 'jeda' THEN 1 ELSE 0 END) AS revisionRecords
     ${fromSql}
     ${whereSql}`,
    params
  );

  const [rows] = await pool.query<any[]>(
    `SELECT l.id,
            l.pegawai_id AS employeeId,
            l.periode_id AS periodeId,
            l.assignment_id AS assignmentId,
            COALESCE(l.tim_kerja_id, a.tim_kerja_id) AS teamId,
            l.indikator_kinerja_id AS indicatorId,
            l.kegiatan_id AS activityId,
            l.kategori_id AS categoryId,
            l.satuan_id AS unitId,
            DATE_FORMAT(l.tanggal_kegiatan, '%Y-%m-%d') AS activityDate,
            l.jam_mulai AS startTime,
            l.jam_selesai AS endTime,
            l.volume,
            ${getTimerDurationMinutesSql('l')} AS durationMinutes,
            DATE_FORMAT(l.started_at, '%Y-%m-%dT%H:%i:%s') AS startedAt,
            DATE_FORMAT(l.paused_at, '%Y-%m-%dT%H:%i:%s') AS pausedAt,
            DATE_FORMAT(l.resumed_at, '%Y-%m-%dT%H:%i:%s') AS resumedAt,
            DATE_FORMAT(l.finished_at, '%Y-%m-%dT%H:%i:%s') AS finishedAt,
            COALESCE(l.total_paused_seconds, 0) AS totalPausedSeconds,
            ${getTimerDurationSecondsSql('l')} AS activeDurationSeconds,
            DATE_FORMAT(NOW(), '%Y-%m-%dT%H:%i:%s') AS serverNow,
            COALESCE(p.nama_lengkap, '-') AS employeeName,
            COALESCE(a.judul, '-') AS assignmentTitle,
            COALESCE(tk.nama_tim, atk.nama_tim, '-') AS teamName,
            COALESCE(s.nama_satuan, '-') AS unitName,
            l.uraian_kegiatan AS activity,
            COALESCE(l.output_kegiatan, '-') AS output,
            0 AS evidenceCount,
            ${activityStatusSql('l')} AS activityStatus,
            l.status,
            DATE_FORMAT(COALESCE(l.last_activity_at, l.diperbarui_pada, l.dibuat_pada), '%Y-%m-%dT%H:%i:%s') AS lastActivityAt,
            DATE_FORMAT(l.dibuat_pada, '%Y-%m-%dT%H:%i:%s') AS createdAt,
            DATE_FORMAT(l.diperbarui_pada, '%Y-%m-%dT%H:%i:%s') AS updatedAt
     ${fromSql}
     ${whereSql}
     ORDER BY l.tanggal_kegiatan DESC, COALESCE(l.last_activity_at, l.diperbarui_pada, l.dibuat_pada) DESC, l.id DESC`,
    params
  );

  return sendSuccess(res, {
    summary: {
      totalRecords: safeNumber(summaryRows[0]?.totalRecords),
      approvedRecords: safeNumber(summaryRows[0]?.approvedRecords),
      sentRecords: safeNumber(summaryRows[0]?.sentRecords),
      revisionRecords: safeNumber(summaryRows[0]?.revisionRecords)
    },
    records: rows.map(buildLogbookRecord)
  });
});

export const getKinerjaMonitoringAssignments = asyncHandler(async (req, res) => {
  const conditions: string[] = [];
  const params: Array<number | string> = [];

  if (req.query.employeeId) {
    conditions.push(`a.pegawai_id = ?`);
    params.push(readPositiveId(req.query.employeeId, "Pegawai"));
  }
  if (req.query.teamId) {
    conditions.push(`a.tim_kerja_id = ?`);
    params.push(readPositiveId(req.query.teamId, "Tim kerja"));
  }
  if (req.query.status) {
    conditions.push(`a.status = ?`);
    params.push(ensureOneOf(readTrimmedString(req.query.status).toLowerCase(), ASSIGNMENT_STATUS, "Status penugasan"));
  }
  if (req.query.month) {
    conditions.push(`MONTH(a.target_mulai) = ?`);
    params.push(readIntegerInRange(req.query.month, 1, 12, "Bulan"));
  }
  if (req.query.year) {
    conditions.push(`YEAR(a.target_mulai) = ?`);
    params.push(readIntegerInRange(req.query.year, 2020, 2100, "Tahun"));
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [summaryRows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS totalRecords,
            SUM(CASE WHEN a.status = 'selesai' THEN 1 ELSE 0 END) AS completedRecords,
            SUM(CASE WHEN a.status = 'berjalan' THEN 1 ELSE 0 END) AS runningRecords,
            ROUND(AVG(a.progres), 2) AS averageProgress
     FROM kinerja_assignment a
     ${whereSql}`,
    params
  );

  const [rows] = await pool.query<any[]>(
    `SELECT a.id,
            a.pegawai_id AS employeeId,
            COALESCE(p.nama_lengkap, '-') AS employeeName,
            a.tim_kerja_id AS teamId,
            COALESCE(tk.nama_tim, '-') AS teamName,
            a.judul AS title,
            DATE_FORMAT(a.target_mulai, '%Y-%m-%d') AS startDate,
            DATE_FORMAT(a.target_selesai, '%Y-%m-%d') AS endDate,
            a.status,
            a.progres AS progress,
            a.note,
            a.dibuat_pada AS createdAt,
            a.diperbarui_pada AS updatedAt
     FROM kinerja_assignment a
     LEFT JOIN pegawai p ON p.id = a.pegawai_id
     LEFT JOIN kinerja_tim_kerja tk ON tk.id = a.tim_kerja_id
     ${whereSql}
     ORDER BY a.target_selesai ASC, a.dibuat_pada DESC`,
    params
  );

  return sendSuccess(res, {
    summary: {
      totalRecords: safeNumber(summaryRows[0]?.totalRecords),
      completedRecords: safeNumber(summaryRows[0]?.completedRecords),
      runningRecords: safeNumber(summaryRows[0]?.runningRecords),
      averageProgress: safeNumber(summaryRows[0]?.averageProgress)
    },
    records: rows.map(buildAssignmentRecord)
  });
});



const ACTIVITY_REPORT_TYPES = ["daily", "weekly", "monthly", "yearly"] as const;

const padDatePart = (value: number) => String(value).padStart(2, "0");

const formatUtcDate = (date: Date) => `${date.getUTCFullYear()}-${padDatePart(date.getUTCMonth() + 1)}-${padDatePart(date.getUTCDate())}`;

const getMonthRange = (year: number, month: number) => {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return { start: formatUtcDate(start), end: formatUtcDate(end) };
};

const parseIsoWeekRange = (value: unknown) => {
  const normalized = readTrimmedString(value);
  if (!normalized) return null;

  const match = normalized.match(/^(\d{4})-W(\d{1,2})$/i);
  if (!match) return null;

  const year = Number(match[1]);
  const week = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(week) || week < 1 || week > 53) return null;

  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const januaryFourthDay = januaryFourth.getUTCDay() || 7;
  const firstMonday = new Date(januaryFourth);
  firstMonday.setUTCDate(januaryFourth.getUTCDate() - januaryFourthDay + 1);

  const weekStart = new Date(firstMonday);
  weekStart.setUTCDate(firstMonday.getUTCDate() + (week - 1) * 7);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);

  return { start: formatUtcDate(weekStart), end: formatUtcDate(weekEnd) };
};

type ActivityReportFilterBuild = {
  conditions: string[];
  params: Array<number | string>;
};

const appendActivityReportFilters = (query: Record<string, unknown>, target: ActivityReportFilterBuild) => {
  const date = readTrimmedString(query.date);
  if (date) {
    target.conditions.push(`l.tanggal_kegiatan = ?`);
    target.params.push(readDateString(date, "Tanggal laporan"));
  }

  const startDate = readTrimmedString(query.startDate);
  if (startDate) {
    target.conditions.push(`l.tanggal_kegiatan >= ?`);
    target.params.push(readDateString(startDate, "Tanggal awal"));
  }

  const endDate = readTrimmedString(query.endDate);
  if (endDate) {
    target.conditions.push(`l.tanggal_kegiatan <= ?`);
    target.params.push(readDateString(endDate, "Tanggal akhir"));
  }

  const weekRange = parseIsoWeekRange(query.week);
  if (weekRange) {
    target.conditions.push(`l.tanggal_kegiatan BETWEEN ? AND ?`);
    target.params.push(weekRange.start, weekRange.end);
  }

  const monthValue = readTrimmedString(query.month);
  if (monthValue) {
    const month = readIntegerInRange(monthValue, 1, 12, "Bulan");
    const year = query.year ? readIntegerInRange(query.year, 2020, 2100, "Tahun") : new Date().getFullYear();
    const monthRange = getMonthRange(year, month);
    target.conditions.push(`l.tanggal_kegiatan BETWEEN ? AND ?`);
    target.params.push(monthRange.start, monthRange.end);
  } else if (query.year) {
    const year = readIntegerInRange(query.year, 2020, 2100, "Tahun");
    target.conditions.push(`YEAR(l.tanggal_kegiatan) = ?`);
    target.params.push(year);
  }

  const workUnitId = asNullableNumber(query.workUnitId);
  if (workUnitId && workUnitId > 0) {
    target.conditions.push(`p.departemen_id = ?`);
    target.params.push(workUnitId);
  }

  const employeeId = asNullableNumber(query.employeeId);
  if (employeeId && employeeId > 0) {
    target.conditions.push(`l.pegawai_id = ?`);
    target.params.push(employeeId);
  }

  const status = readTrimmedString(query.status);
  if (status && status !== "semua") {
    target.conditions.push(`${activityStatusSql('l')} = ?`);
    target.params.push(ensureOneOf(normalizeActivityStatusValue(status), MONITORING_ACTIVITY_STATUS, "Status aktivitas"));
  }

  const keyword = readTrimmedString(query.keyword).toLowerCase();
  if (keyword) {
    target.conditions.push(`(LOWER(l.uraian_kegiatan) LIKE ? OR LOWER(COALESCE(l.output_kegiatan, '')) LIKE ? OR LOWER(COALESCE(p.nama_lengkap, '')) LIKE ?)`);
    target.params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }

  target.conditions.push(`${activityStatusSql('l')} IN ('berjalan', 'jeda', 'selesai')`);
};

const buildActivityReportWhereSql = (query: Record<string, unknown>) => {
  const filterBuild: ActivityReportFilterBuild = { conditions: [], params: [] };
  appendActivityReportFilters(query, filterBuild);
  return {
    whereSql: filterBuild.conditions.length ? `WHERE ${filterBuild.conditions.join(' AND ')}` : '',
    params: filterBuild.params
  };
};

export const getKinerjaActivityReport = asyncHandler(async (req, res) => {
  await ensureOperationalSchema();

  const reportType = ensureOneOf(
    readTrimmedString(req.query.reportType) || "daily",
    ACTIVITY_REPORT_TYPES,
    "Jenis laporan"
  );
  const { whereSql, params } = buildActivityReportWhereSql(req.query as Record<string, unknown>);
  const statusExpr = activityStatusSql('l');
  const durationExpr = getTimerDurationSecondsSql('l');
  const monthNameSql = `ELT(MONTH(MIN(l.tanggal_kegiatan)), 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember')`;
  const periodSelect = reportType === "weekly"
    ? `YEARWEEK(l.tanggal_kegiatan, 3) AS periodKey,
       DATE_FORMAT(MIN(DATE_SUB(l.tanggal_kegiatan, INTERVAL WEEKDAY(l.tanggal_kegiatan) DAY)), '%Y-%m-%d') AS periodStart,
       DATE_FORMAT(MAX(DATE_ADD(DATE_SUB(l.tanggal_kegiatan, INTERVAL WEEKDAY(l.tanggal_kegiatan) DAY), INTERVAL 6 DAY)), '%Y-%m-%d') AS periodEnd,
       CONCAT(DATE_FORMAT(MIN(DATE_SUB(l.tanggal_kegiatan, INTERVAL WEEKDAY(l.tanggal_kegiatan) DAY)), '%d/%m/%Y'), ' - ', DATE_FORMAT(MAX(DATE_ADD(DATE_SUB(l.tanggal_kegiatan, INTERVAL WEEKDAY(l.tanggal_kegiatan) DAY), INTERVAL 6 DAY)), '%d/%m/%Y')) AS periodLabel`
    : reportType === "monthly"
      ? `DATE_FORMAT(MIN(l.tanggal_kegiatan), '%Y-%m') AS periodKey,
         DATE_FORMAT(MIN(l.tanggal_kegiatan), '%Y-%m-01') AS periodStart,
         DATE_FORMAT(LAST_DAY(MAX(l.tanggal_kegiatan)), '%Y-%m-%d') AS periodEnd,
         CONCAT(${monthNameSql}, ' ', YEAR(MIN(l.tanggal_kegiatan))) AS periodLabel`
      : reportType === "yearly"
        ? `YEAR(MIN(l.tanggal_kegiatan)) AS periodKey,
           CONCAT(YEAR(MIN(l.tanggal_kegiatan)), '-01-01') AS periodStart,
           CONCAT(YEAR(MAX(l.tanggal_kegiatan)), '-12-31') AS periodEnd,
           CONCAT('Tahun ', YEAR(MIN(l.tanggal_kegiatan))) AS periodLabel`
        : `DATE_FORMAT(l.tanggal_kegiatan, '%Y-%m-%d') AS periodKey,
           DATE_FORMAT(l.tanggal_kegiatan, '%Y-%m-%d') AS periodStart,
           DATE_FORMAT(l.tanggal_kegiatan, '%Y-%m-%d') AS periodEnd,
           DATE_FORMAT(l.tanggal_kegiatan, '%d/%m/%Y') AS periodLabel`;
  const periodGroupBy = reportType === "weekly"
    ? `YEARWEEK(l.tanggal_kegiatan, 3)`
    : reportType === "monthly"
      ? `DATE_FORMAT(l.tanggal_kegiatan, '%Y-%m')`
      : reportType === "yearly"
        ? `YEAR(l.tanggal_kegiatan)`
        : `l.tanggal_kegiatan`;

  const [summaryRows] = await pool.query<any[]>(
    `SELECT COUNT(DISTINCT l.pegawai_id) AS totalEmployees,
            COUNT(*) AS totalActivities,
            SUM(${durationExpr}) AS totalDurationSeconds,
            SUM(COALESCE(l.total_paused_seconds, 0)) AS totalPausedSeconds,
            SUM(CASE WHEN ${statusExpr} = 'selesai' THEN 1 ELSE 0 END) AS completedActivities,
            SUM(CASE WHEN ${statusExpr} = 'berjalan' THEN 1 ELSE 0 END) AS runningActivities,
            SUM(CASE WHEN ${statusExpr} = 'jeda' THEN 1 ELSE 0 END) AS pausedActivities,
            ROUND(SUM(COALESCE(l.volume, 0)), 2) AS totalVolume
     FROM kinerja_logbook l
     LEFT JOIN pegawai p ON p.id = l.pegawai_id
     LEFT JOIN departemen d ON d.id = p.departemen_id
     LEFT JOIN kinerja_satuan s ON s.id = l.satuan_id
     ${whereSql}`,
    params
  );

  const [rows] = await pool.query<any[]>(
    `SELECT l.pegawai_id AS employeeId,
            COALESCE(p.nama_lengkap, '-') AS employeeName,
            COALESCE(p.nip, '') AS nip,
            COALESCE(d.nama, '-') AS workUnitName,
            ${periodSelect},
            COUNT(*) AS totalActivities,
            SUM(${durationExpr}) AS totalDurationSeconds,
            SUM(COALESCE(l.total_paused_seconds, 0)) AS totalPausedSeconds,
            COUNT(DISTINCT l.tanggal_kegiatan) AS activeDays,
            SUM(CASE WHEN ${statusExpr} = 'selesai' THEN 1 ELSE 0 END) AS completedActivities,
            SUM(CASE WHEN ${statusExpr} = 'berjalan' THEN 1 ELSE 0 END) AS runningActivities,
            SUM(CASE WHEN ${statusExpr} = 'jeda' THEN 1 ELSE 0 END) AS pausedActivities,
            ROUND(SUM(COALESCE(l.volume, 0)), 2) AS totalVolume,
            GROUP_CONCAT(DISTINCT COALESCE(s.nama_satuan, '') ORDER BY s.nama_satuan SEPARATOR ', ') AS volumeUnitSummary,
            GROUP_CONCAT(DISTINCT LEFT(l.uraian_kegiatan, 160) ORDER BY l.tanggal_kegiatan ASC, l.started_at ASC SEPARATOR ' || ') AS activityDescriptions
     FROM kinerja_logbook l
     LEFT JOIN pegawai p ON p.id = l.pegawai_id
     LEFT JOIN departemen d ON d.id = p.departemen_id
     LEFT JOIN kinerja_satuan s ON s.id = l.satuan_id
     ${whereSql}
     GROUP BY l.pegawai_id, p.nama_lengkap, p.nip, d.nama, ${periodGroupBy}
     ORDER BY periodStart DESC, p.nama_lengkap ASC`,
    params
  );

  const summary = summaryRows[0] || {};
  return sendSuccess(res, {
    reportType,
    serverNow: new Date().toISOString(),
    summary: {
      totalEmployees: safeNumber(summary.totalEmployees),
      totalActivities: safeNumber(summary.totalActivities),
      totalDurationSeconds: safeNumber(summary.totalDurationSeconds),
      totalPausedSeconds: safeNumber(summary.totalPausedSeconds),
      completedActivities: safeNumber(summary.completedActivities),
      runningActivities: safeNumber(summary.runningActivities),
      pausedActivities: safeNumber(summary.pausedActivities),
      totalVolume: safeNumber(summary.totalVolume)
    },
    records: rows.map((row) => {
      const totalDurationSeconds = safeNumber(row.totalDurationSeconds);
      const activeDays = Math.max(1, safeNumber(row.activeDays));
      return {
        reportType,
        employeeId: Number(row.employeeId),
        employeeName: String(row.employeeName || '-'),
        nip: String(row.nip || ''),
        workUnitName: String(row.workUnitName || '-'),
        periodKey: String(row.periodKey || ''),
        periodStart: String(row.periodStart || ''),
        periodEnd: String(row.periodEnd || ''),
        periodLabel: String(row.periodLabel || ''),
        totalActivities: safeNumber(row.totalActivities),
        totalDurationSeconds,
        totalPausedSeconds: safeNumber(row.totalPausedSeconds),
        averageDurationPerDaySeconds: reportType === "daily" ? totalDurationSeconds : Math.round(totalDurationSeconds / activeDays),
        activeDays,
        completedActivities: safeNumber(row.completedActivities),
        runningActivities: safeNumber(row.runningActivities),
        pausedActivities: safeNumber(row.pausedActivities),
        totalVolume: safeNumber(row.totalVolume),
        volumeSummary: [row.totalVolume, row.volumeUnitSummary].filter(Boolean).join(' '),
        activityDescriptions: String(row.activityDescriptions || '')
          .split(' || ')
          .map((item) => item.trim())
          .filter(Boolean)
      };
    })
  });
});

export const getKinerjaActivityReportDetail = asyncHandler(async (req, res) => {
  await ensureOperationalSchema();

  const filterBuild: ActivityReportFilterBuild = { conditions: [], params: [] };
  appendActivityReportFilters(req.query as Record<string, unknown>, filterBuild);

  const periodStart = readTrimmedString(req.query.periodStart);
  const periodEnd = readTrimmedString(req.query.periodEnd);
  if (periodStart) {
    filterBuild.conditions.push(`l.tanggal_kegiatan >= ?`);
    filterBuild.params.push(readDateString(periodStart, "Awal periode"));
  }
  if (periodEnd) {
    filterBuild.conditions.push(`l.tanggal_kegiatan <= ?`);
    filterBuild.params.push(readDateString(periodEnd, "Akhir periode"));
  }

  const whereSql = filterBuild.conditions.length ? `WHERE ${filterBuild.conditions.join(' AND ')}` : '';
  const statusExpr = activityStatusSql('l');
  const durationExpr = getTimerDurationSecondsSql('l');

  const [rows] = await pool.query<any[]>(
    `SELECT l.id,
            l.pegawai_id AS employeeId,
            COALESCE(p.nama_lengkap, '-') AS employeeName,
            COALESCE(p.nip, '') AS nip,
            COALESCE(d.nama, '-') AS workUnitName,
            COALESCE(tk.nama_tim, '-') AS teamName,
            DATE_FORMAT(l.tanggal_kegiatan, '%Y-%m-%d') AS activityDate,
            l.uraian_kegiatan AS description,
            ROUND(COALESCE(l.volume, 0), 2) AS volume,
            COALESCE(s.nama_satuan, '-') AS unit,
            ${statusExpr} AS activityStatus,
            DATE_FORMAT(l.started_at, '%Y-%m-%d %H:%i:%s') AS startedAt,
            DATE_FORMAT(l.paused_at, '%Y-%m-%d %H:%i:%s') AS pausedAt,
            DATE_FORMAT(l.resumed_at, '%Y-%m-%d %H:%i:%s') AS resumedAt,
            DATE_FORMAT(l.finished_at, '%Y-%m-%d %H:%i:%s') AS finishedAt,
            COALESCE(l.total_paused_seconds, 0) AS totalPausedSeconds,
            ${durationExpr} AS activeDurationSeconds,
            COALESCE(l.output_kegiatan, '') AS output,
            DATE_FORMAT(l.diperbarui_pada, '%Y-%m-%d %H:%i:%s') AS updatedAt
     FROM kinerja_logbook l
     LEFT JOIN pegawai p ON p.id = l.pegawai_id
     LEFT JOIN departemen d ON d.id = p.departemen_id
     LEFT JOIN kinerja_tim_kerja tk ON tk.id = l.tim_kerja_id
     LEFT JOIN kinerja_satuan s ON s.id = l.satuan_id
     ${whereSql}
     ORDER BY l.tanggal_kegiatan DESC, COALESCE(l.started_at, l.dibuat_pada) DESC, l.id DESC`,
    filterBuild.params
  );

  const totalDurationSeconds = rows.reduce((sum, row) => sum + safeNumber(row.activeDurationSeconds), 0);
  const totalPausedSeconds = rows.reduce((sum, row) => sum + safeNumber(row.totalPausedSeconds), 0);

  return sendSuccess(res, {
    serverNow: new Date().toISOString(),
    summary: {
      totalActivities: rows.length,
      totalDurationSeconds,
      totalPausedSeconds,
      completedActivities: rows.filter((row) => String(row.activityStatus) === 'selesai').length,
      runningActivities: rows.filter((row) => String(row.activityStatus) === 'berjalan').length,
      pausedActivities: rows.filter((row) => String(row.activityStatus) === 'jeda').length
    },
    activities: rows.map((row) => ({
      id: Number(row.id),
      employeeId: Number(row.employeeId),
      employeeName: String(row.employeeName || '-'),
      nip: String(row.nip || ''),
      workUnitName: String(row.workUnitName || '-'),
      teamName: String(row.teamName || '-'),
      date: String(row.activityDate || ''),
      description: String(row.description || ''),
      volume: safeNumber(row.volume),
      unit: String(row.unit || '-'),
      activityStatus: String(row.activityStatus || 'selesai'),
      startedAt: row.startedAt ? String(row.startedAt) : null,
      pausedAt: row.pausedAt ? String(row.pausedAt) : null,
      resumedAt: row.resumedAt ? String(row.resumedAt) : null,
      finishedAt: row.finishedAt ? String(row.finishedAt) : null,
      totalPausedSeconds: safeNumber(row.totalPausedSeconds),
      activeDurationSeconds: safeNumber(row.activeDurationSeconds),
      output: String(row.output || ''),
      updatedAt: row.updatedAt ? String(row.updatedAt) : null
    }))
  });
});

let kinerjaRecommendationSchemaReady = false;

const ensureTableColumn = async (tableName: string, columnName: string, alterSql: string) => {
  const [rows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );

  if (safeNumber(rows[0]?.total) === 0) {
    await pool.query(alterSql);
  }
};

const ensureKinerjaRecommendationSchema = async () => {
  if (kinerjaRecommendationSchemaReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_rekomendasi_ckp (
      id INT NOT NULL AUTO_INCREMENT,
      pegawai_id INT NOT NULL,
      tahun SMALLINT NOT NULL,
      bulan TINYINT NOT NULL,
      ringkasan TEXT NULL,
      status ENUM('draf','ditinjau','direkomendasikan','ditindaklanjuti','ditolak') NOT NULL DEFAULT 'draf',
      nilai_rekomendasi DECIMAL(5,2) NOT NULL DEFAULT 0,
      catatan_tindak_lanjut TEXT NULL,
      peninjau_pegawai_id INT NULL,
      tanggal_tinjau DATETIME NULL,
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_kinerja_rekomendasi_ckp_pegawai (pegawai_id),
      KEY idx_kinerja_rekomendasi_ckp_periode (tahun, bulan)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await ensureTableColumn(
    'kinerja_rekomendasi_ckp',
    'approval_tahap_1_status',
    `ALTER TABLE kinerja_rekomendasi_ckp
       ADD COLUMN approval_tahap_1_status ENUM('menunggu','disetujui','ditolak') NOT NULL DEFAULT 'menunggu' AFTER tanggal_tinjau`
  );
  await ensureTableColumn(
    'kinerja_rekomendasi_ckp',
    'approval_tahap_1_pegawai_id',
    `ALTER TABLE kinerja_rekomendasi_ckp
       ADD COLUMN approval_tahap_1_pegawai_id INT NULL AFTER approval_tahap_1_status`
  );
  await ensureTableColumn(
    'kinerja_rekomendasi_ckp',
    'approval_tahap_1_catatan',
    `ALTER TABLE kinerja_rekomendasi_ckp
       ADD COLUMN approval_tahap_1_catatan TEXT NULL AFTER approval_tahap_1_pegawai_id`
  );
  await ensureTableColumn(
    'kinerja_rekomendasi_ckp',
    'approval_tahap_1_pada',
    `ALTER TABLE kinerja_rekomendasi_ckp
       ADD COLUMN approval_tahap_1_pada DATETIME NULL AFTER approval_tahap_1_catatan`
  );
  await ensureTableColumn(
    'kinerja_rekomendasi_ckp',
    'approval_tahap_2_status',
    `ALTER TABLE kinerja_rekomendasi_ckp
       ADD COLUMN approval_tahap_2_status ENUM('menunggu','disetujui','ditolak') NOT NULL DEFAULT 'menunggu' AFTER approval_tahap_1_pada`
  );
  await ensureTableColumn(
    'kinerja_rekomendasi_ckp',
    'approval_tahap_2_pegawai_id',
    `ALTER TABLE kinerja_rekomendasi_ckp
       ADD COLUMN approval_tahap_2_pegawai_id INT NULL AFTER approval_tahap_2_status`
  );
  await ensureTableColumn(
    'kinerja_rekomendasi_ckp',
    'approval_tahap_2_catatan',
    `ALTER TABLE kinerja_rekomendasi_ckp
       ADD COLUMN approval_tahap_2_catatan TEXT NULL AFTER approval_tahap_2_pegawai_id`
  );
  await ensureTableColumn(
    'kinerja_rekomendasi_ckp',
    'approval_tahap_2_pada',
    `ALTER TABLE kinerja_rekomendasi_ckp
       ADD COLUMN approval_tahap_2_pada DATETIME NULL AFTER approval_tahap_2_catatan`
  );

  kinerjaRecommendationSchemaReady = true;
};

const buildRecommendationSummary = (row: any) => {
  const totalActivities = safeNumber(row.totalActivities);
  const approvedActivities = safeNumber(row.approvedActivities);
  const totalAssignments = safeNumber(row.totalAssignments);
  const completedAssignments = safeNumber(row.completedAssignments);
  const avgProgress = safeNumber(row.averageProgress);
  const activityScore = Math.min(100, totalActivities * 12);
  const approvalRate = totalActivities ? (approvedActivities / totalActivities) * 100 : 0;
  const assignmentRate = totalAssignments ? (completedAssignments / totalAssignments) * 100 : avgProgress;
  const recommendationScore = Number((activityScore * 0.35 + approvalRate * 0.35 + assignmentRate * 0.30).toFixed(2));
  const summary = totalActivities || totalAssignments
    ? `${approvedActivities}/${totalActivities} aktivitas disetujui dan ${completedAssignments}/${totalAssignments} penugasan selesai pada periode ini.`
    : 'Belum ada aktivitas yang cukup untuk membentuk rekomendasi CKP pada periode ini.';

  return { recommendationScore, summary };
};

export const generateKinerjaRecommendations = asyncHandler(async (req: any, res) => {
  await ensureKinerjaRecommendationSchema();
  const year = readIntegerInRange(req.body?.year ?? req.query?.year, 2020, 2100, 'Tahun');
  const month = readIntegerInRange(req.body?.month ?? req.query?.month, 1, 12, 'Bulan');
  const employeeId = req.body?.employeeId || req.query?.employeeId ? readPositiveId(req.body?.employeeId ?? req.query?.employeeId, 'Pegawai') : null;

  const conditions = [`e.status_aktif = 'aktif'`];
  const params: Array<number | string> = [year, month, year, month];
  if (employeeId) {
    conditions.push(`e.id = ?`);
    params.push(employeeId);
  }

  const [rows] = await pool.query<any[]>(
    `SELECT e.id AS employeeId,
            COUNT(DISTINCT l.id) AS totalActivities,
            SUM(CASE WHEN l.status = 'disetujui' THEN 1 ELSE 0 END) AS approvedActivities,
            COUNT(DISTINCT a.id) AS totalAssignments,
            SUM(CASE WHEN a.status = 'selesai' THEN 1 ELSE 0 END) AS completedAssignments,
            ROUND(AVG(COALESCE(a.progres, 0)), 2) AS averageProgress
     FROM pegawai e
     LEFT JOIN kinerja_logbook l
       ON l.pegawai_id = e.id
      AND YEAR(l.tanggal_kegiatan) = ?
      AND MONTH(l.tanggal_kegiatan) = ?
     LEFT JOIN kinerja_assignment a
       ON a.pegawai_id = e.id
      AND YEAR(a.target_mulai) = ?
      AND MONTH(a.target_mulai) = ?
     WHERE ${conditions.join(' AND ')}
     GROUP BY e.id`,
    params
  );

  let generatedRecords = 0;
  for (const row of rows) {
    const employee = Number(row.employeeId);
    const { recommendationScore, summary } = buildRecommendationSummary(row);
    const [existingRows] = await pool.query<any[]>(
      `SELECT id, status, catatan_tindak_lanjut AS followUpNote FROM kinerja_rekomendasi_ckp WHERE pegawai_id = ? AND tahun = ? AND bulan = ? LIMIT 1`,
      [employee, year, month]
    );
    if (existingRows.length) {
      const existing = existingRows[0];
      await pool.query(
        `UPDATE kinerja_rekomendasi_ckp
         SET nilai_rekomendasi = ?,
             ringkasan = ?,
             status = 'ditinjau',
             approval_tahap_1_status = 'menunggu',
             approval_tahap_1_pegawai_id = NULL,
             approval_tahap_1_catatan = NULL,
             approval_tahap_1_pada = NULL,
             approval_tahap_2_status = 'menunggu',
             approval_tahap_2_pegawai_id = NULL,
             approval_tahap_2_catatan = NULL,
             approval_tahap_2_pada = NULL,
             catatan_tindak_lanjut = NULL,
             peninjau_pegawai_id = NULL,
             tanggal_tinjau = NULL,
             diperbarui_pada = NOW()
         WHERE id = ?`,
        [recommendationScore, summary, existing.id]
      );
    } else {
      await pool.query(
        `INSERT INTO kinerja_rekomendasi_ckp (pegawai_id, tahun, bulan, ringkasan, status, nilai_rekomendasi, approval_tahap_1_status, approval_tahap_2_status)
         VALUES (?, ?, ?, ?, 'ditinjau', ?, 'menunggu', 'menunggu')`,
        [employee, year, month, summary, recommendationScore]
      );
    }
    generatedRecords += 1;
  }

  return sendSuccess(res, { generatedRecords }, 'Rekomendasi CKP berhasil dibentuk');
});

export const getKinerjaRecommendations = asyncHandler(async (req, res) => {
  await ensureKinerjaRecommendationSchema();
  const conditions: string[] = [];
  const params: Array<number | string> = [];
  if (req.query.employeeId) {
    conditions.push(`r.pegawai_id = ?`);
    params.push(readPositiveId(req.query.employeeId, 'Pegawai'));
  }
  if (req.query.month) {
    conditions.push(`r.bulan = ?`);
    params.push(readIntegerInRange(req.query.month, 1, 12, 'Bulan'));
  }
  if (req.query.year) {
    conditions.push(`r.tahun = ?`);
    params.push(readIntegerInRange(req.query.year, 2020, 2100, 'Tahun'));
  }
  if (req.query.status) {
    conditions.push(`r.status = ?`);
    params.push(ensureOneOf(readTrimmedString(req.query.status).toLowerCase(), RECOMMENDATION_STATUS, 'Status rekomendasi'));
  }
  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [summaryRows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS totalRecords,
            SUM(CASE WHEN r.status IN ('ditinjau', 'direkomendasikan', 'ditindaklanjuti', 'ditolak') THEN 1 ELSE 0 END) AS reviewedRecords,
            SUM(CASE WHEN r.status = 'direkomendasikan' THEN 1 ELSE 0 END) AS approvedRecords,
            SUM(CASE WHEN r.status = 'ditindaklanjuti' THEN 1 ELSE 0 END) AS followedUpRecords,
            SUM(CASE WHEN r.approval_tahap_1_status = 'disetujui' THEN 1 ELSE 0 END) AS stage1ApprovedRecords,
            SUM(CASE WHEN r.approval_tahap_2_status = 'disetujui' THEN 1 ELSE 0 END) AS stage2ApprovedRecords,
            ROUND(AVG(r.nilai_rekomendasi), 2) AS averageScore
     FROM kinerja_rekomendasi_ckp r
     ${whereSql}`,
    params
  );

  const [rows] = await pool.query<any[]>(
    `SELECT r.id,
            r.pegawai_id AS employeeId,
            p.nama_lengkap AS employeeName,
            p.nip,
            COALESCE(p.nama_jabatan, '-') AS position,
            r.tahun AS year,
            r.bulan AS month,
            CONCAT(LPAD(r.bulan, 2, '0'), '/', r.tahun) AS periodLabel,
            r.nilai_rekomendasi AS recommendationScore,
            r.status,
            COALESCE(r.ringkasan, '') AS summary,
            COALESCE(r.catatan_tindak_lanjut, '') AS followUpNote,
            r.peninjau_pegawai_id AS reviewerEmployeeId,
            COALESCE(pr.nama_lengkap, '-') AS reviewerName,
            DATE_FORMAT(r.tanggal_tinjau, '%Y-%m-%d %H:%i:%s') AS reviewedAt,
            r.approval_tahap_1_status AS approvalStage1Status,
            r.approval_tahap_1_pegawai_id AS approvalStage1ReviewerId,
            COALESCE(ps1.nama_lengkap, '-') AS approvalStage1ReviewerName,
            DATE_FORMAT(r.approval_tahap_1_pada, '%Y-%m-%d %H:%i:%s') AS approvalStage1ReviewedAt,
            COALESCE(r.approval_tahap_1_catatan, '') AS approvalStage1Note,
            r.approval_tahap_2_status AS approvalStage2Status,
            r.approval_tahap_2_pegawai_id AS approvalStage2ReviewerId,
            COALESCE(ps2.nama_lengkap, '-') AS approvalStage2ReviewerName,
            DATE_FORMAT(r.approval_tahap_2_pada, '%Y-%m-%d %H:%i:%s') AS approvalStage2ReviewedAt,
            COALESCE(r.approval_tahap_2_catatan, '') AS approvalStage2Note,
            DATE_FORMAT(r.dibuat_pada, '%Y-%m-%d %H:%i:%s') AS createdAt,
            DATE_FORMAT(r.diperbarui_pada, '%Y-%m-%d %H:%i:%s') AS updatedAt
     FROM kinerja_rekomendasi_ckp r
     LEFT JOIN pegawai p ON p.id = r.pegawai_id
     LEFT JOIN pegawai pr ON pr.id = r.peninjau_pegawai_id
     LEFT JOIN pegawai ps1 ON ps1.id = r.approval_tahap_1_pegawai_id
     LEFT JOIN pegawai ps2 ON ps2.id = r.approval_tahap_2_pegawai_id
     ${whereSql}
     ORDER BY r.tahun DESC, r.bulan DESC, r.nilai_rekomendasi DESC, p.nama_lengkap ASC`,
    params
  );

  return sendSuccess(res, {
    summary: {
      totalRecords: safeNumber(summaryRows[0]?.totalRecords),
      reviewedRecords: safeNumber(summaryRows[0]?.reviewedRecords),
      approvedRecords: safeNumber(summaryRows[0]?.approvedRecords),
      followedUpRecords: safeNumber(summaryRows[0]?.followedUpRecords),
      averageScore: safeNumber(summaryRows[0]?.averageScore),
      stage1ApprovedRecords: safeNumber(summaryRows[0]?.stage1ApprovedRecords),
      stage2ApprovedRecords: safeNumber(summaryRows[0]?.stage2ApprovedRecords)
    },
    records: rows.map(buildRecommendationRecord)
  });
});

export const reviewKinerjaRecommendation = asyncHandler(async (req: any, res) => {
  await ensureKinerjaRecommendationSchema();
  const id = readPositiveId(req.params.id, 'Rekomendasi CKP');
  const action = ensureOneOf(
    readTrimmedString(req.body?.action || 'approval-1').toLowerCase(),
    ['approval-1', 'approval-2', 'follow-up'] as const,
    'Aksi approval'
  );
  const summary = ensureRequired(readTrimmedString(req.body?.summary), 'Ringkasan rekomendasi wajib diisi');
  const followUpNote = readTrimmedString(req.body?.followUpNote);
  const stageNote = readTrimmedString(req.body?.stageNote);

  const [rows] = await pool.query<any[]>(
    `SELECT id,
            status,
            approval_tahap_1_status AS approvalStage1Status,
            approval_tahap_2_status AS approvalStage2Status
     FROM kinerja_rekomendasi_ckp
     WHERE id = ?
     LIMIT 1`,
    [id]
  );

  if (!rows.length) {
    fail('Rekomendasi CKP tidak ditemukan', 404);
  }

  const current = rows[0];
  const currentUserId = req.user?.employeeId || null;

  if (action === 'approval-1') {
    const stageStatus = ensureOneOf(
      readTrimmedString(req.body?.stageStatus).toLowerCase(),
      APPROVAL_STAGE_STATUS,
      'Status approval tahap 1'
    );
    const finalStatus = stageStatus === 'ditolak' ? 'ditolak' : 'ditinjau';

    await pool.query(
      `UPDATE kinerja_rekomendasi_ckp
       SET ringkasan = ?,
           status = ?,
           approval_tahap_1_status = ?,
           approval_tahap_1_pegawai_id = ?,
           approval_tahap_1_catatan = ?,
           approval_tahap_1_pada = NOW(),
           peninjau_pegawai_id = ?,
           tanggal_tinjau = NOW(),
           diperbarui_pada = NOW()
       WHERE id = ?`,
      [summary, finalStatus, stageStatus, currentUserId, stageNote || null, currentUserId, id]
    );

    return sendSuccess(res, null, 'Approval tahap 1 berhasil diperbarui');
  }

  if (action === 'approval-2') {
    if (current.approvalStage1Status !== 'disetujui') {
      fail('Approval tahap 2 hanya dapat dilakukan setelah tahap 1 disetujui', 400);
    }

    const stageStatus = ensureOneOf(
      readTrimmedString(req.body?.stageStatus).toLowerCase(),
      APPROVAL_STAGE_STATUS,
      'Status approval tahap 2'
    );
    const finalStatus = stageStatus === 'disetujui' ? 'direkomendasikan' : stageStatus === 'ditolak' ? 'ditolak' : 'ditinjau';

    await pool.query(
      `UPDATE kinerja_rekomendasi_ckp
       SET ringkasan = ?,
           status = ?,
           approval_tahap_2_status = ?,
           approval_tahap_2_pegawai_id = ?,
           approval_tahap_2_catatan = ?,
           approval_tahap_2_pada = NOW(),
           peninjau_pegawai_id = ?,
           tanggal_tinjau = NOW(),
           diperbarui_pada = NOW()
       WHERE id = ?`,
      [summary, finalStatus, stageStatus, currentUserId, stageNote || null, currentUserId, id]
    );

    return sendSuccess(res, null, 'Approval tahap 2 berhasil diperbarui');
  }

  if (current.approvalStage2Status !== 'disetujui' && current.status !== 'direkomendasikan') {
    fail('Tindak lanjut hanya dapat dilakukan setelah approval tahap 2 disetujui', 400);
  }

  await pool.query(
    `UPDATE kinerja_rekomendasi_ckp
     SET ringkasan = ?,
         status = 'ditindaklanjuti',
         catatan_tindak_lanjut = ?,
         peninjau_pegawai_id = ?,
         tanggal_tinjau = NOW(),
         diperbarui_pada = NOW()
     WHERE id = ?`,
    [summary, followUpNote || null, currentUserId, id]
  );

  return sendSuccess(res, null, 'Tindak lanjut rekomendasi berhasil diperbarui');
});


let kinerjaPlanningSchemaReady = false;

const KINERJA_PLANNING_STATUS = ["draft", "aktif", "arsip"] as const;
const KINERJA_IKI_STATUS = ["draft", "diajukan", "disetujui", "revisi", "dikunci"] as const;
const KINERJA_TARGET_PERIOD_TYPES = ["bulanan", "triwulan", "semester"] as const;
const KINERJA_TARGET_PERIOD_STATUS = ["draft", "aktif", "dikunci"] as const;
const KINERJA_DIALOG_STATUS = ["draft", "diajukan", "disetujui"] as const;

const readOptionalPositiveId = (value: unknown, fieldName: string) => {
  const normalized = readTrimmedString(value);
  if (!normalized) return null;
  return readPositiveId(normalized, fieldName);
};

const readOptionalNonNegativeValue = (value: unknown, fieldName: string) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return readNonNegativeNumber(value, fieldName, 0);
};

const readKinerjaPlanningStatus = (value: unknown, fallback: (typeof KINERJA_PLANNING_STATUS)[number] = "draft") => {
  const normalized = readTrimmedString(value).toLowerCase();
  if (!normalized) return fallback;
  return ensureOneOf(normalized, KINERJA_PLANNING_STATUS, "Status perencanaan");
};

const readKinerjaIkiStatus = (value: unknown, fallback: (typeof KINERJA_IKI_STATUS)[number] = "draft") => {
  const normalized = readTrimmedString(value).toLowerCase();
  if (!normalized) return fallback;
  return ensureOneOf(normalized, KINERJA_IKI_STATUS, "Status IKI");
};

const readKinerjaTargetPeriodType = (value: unknown) => {
  const normalized = readTrimmedString(value).toLowerCase();
  return ensureOneOf(normalized, KINERJA_TARGET_PERIOD_TYPES, "Jenis periode target");
};

const readKinerjaTargetPeriodStatus = (value: unknown, fallback: (typeof KINERJA_TARGET_PERIOD_STATUS)[number] = "draft") => {
  const normalized = readTrimmedString(value).toLowerCase();
  if (!normalized) return fallback;
  return ensureOneOf(normalized, KINERJA_TARGET_PERIOD_STATUS, "Status target periodik");
};

const readKinerjaDialogStatus = (value: unknown, fallback: (typeof KINERJA_DIALOG_STATUS)[number] = "draft") => {
  const normalized = readTrimmedString(value).toLowerCase();
  if (!normalized) return fallback;
  return ensureOneOf(normalized, KINERJA_DIALOG_STATUS, "Status dialog awal");
};

const ensurePlanningDateRange = (startDate: string, endDate: string) => {
  if (new Date(endDate).getTime() < new Date(startDate).getTime()) {
    fail("Tanggal selesai tidak boleh lebih awal dari tanggal mulai", 400);
  }
};

const ensureKinerjaPlanningSchema = async () => {
  if (kinerjaPlanningSchemaReady) {
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_periode (
      id INT NOT NULL AUTO_INCREMENT,
      tahun SMALLINT NOT NULL,
      nama_periode VARCHAR(120) NOT NULL,
      jenis_periode ENUM('tahunan','semester','triwulan','bulanan') NOT NULL DEFAULT 'tahunan',
      tanggal_mulai DATE NOT NULL,
      tanggal_selesai DATE NOT NULL,
      status ENUM('draft','aktif','ditutup','arsip') NOT NULL DEFAULT 'draft',
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_kinerja_periode_tahun_nama (tahun, nama_periode)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_satuan (
      id INT NOT NULL AUTO_INCREMENT,
      nama_satuan VARCHAR(100) NOT NULL,
      keterangan VARCHAR(200) NULL,
      status ENUM('aktif','arsip') NOT NULL DEFAULT 'aktif',
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_kinerja_satuan_nama (nama_satuan)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
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
      PRIMARY KEY (id),
      KEY idx_kinerja_iku_satker_periode (periode_id),
      KEY idx_kinerja_iku_satker_satuan (satuan_id),
      KEY idx_kinerja_iku_satker_penanggung_jawab (penanggung_jawab_pegawai_id),
      CONSTRAINT fk_kinerja_iku_satker_periode FOREIGN KEY (periode_id) REFERENCES kinerja_periode (id) ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT fk_kinerja_iku_satker_satuan FOREIGN KEY (satuan_id) REFERENCES kinerja_satuan (id) ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT fk_kinerja_iku_satker_penanggung_jawab FOREIGN KEY (penanggung_jawab_pegawai_id) REFERENCES pegawai (id) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
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
      PRIMARY KEY (id),
      KEY idx_kinerja_cascading_iku_satker (iku_satker_id),
      KEY idx_kinerja_cascading_indikator (indikator_kinerja_id),
      KEY idx_kinerja_cascading_tim (tim_kerja_id),
      KEY idx_kinerja_cascading_pegawai (pegawai_id),
      CONSTRAINT fk_kinerja_cascading_iku_satker FOREIGN KEY (iku_satker_id) REFERENCES kinerja_iku_satker (id) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT fk_kinerja_cascading_indikator FOREIGN KEY (indikator_kinerja_id) REFERENCES indikator_kinerja (id) ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT fk_kinerja_cascading_tim FOREIGN KEY (tim_kerja_id) REFERENCES kinerja_tim_kerja (id) ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT fk_kinerja_cascading_pegawai FOREIGN KEY (pegawai_id) REFERENCES pegawai (id) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
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
      PRIMARY KEY (id),
      KEY idx_kinerja_iki_periode (periode_id),
      KEY idx_kinerja_iki_pegawai (pegawai_id),
      KEY idx_kinerja_iki_tim (tim_kerja_id),
      KEY idx_kinerja_iki_indikator (indikator_kinerja_id),
      KEY idx_kinerja_iki_satuan (satuan_id),
      CONSTRAINT fk_kinerja_iki_periode FOREIGN KEY (periode_id) REFERENCES kinerja_periode (id) ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT fk_kinerja_iki_pegawai FOREIGN KEY (pegawai_id) REFERENCES pegawai (id) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT fk_kinerja_iki_tim FOREIGN KEY (tim_kerja_id) REFERENCES kinerja_tim_kerja (id) ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT fk_kinerja_iki_indikator FOREIGN KEY (indikator_kinerja_id) REFERENCES indikator_kinerja (id) ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT fk_kinerja_iki_satuan FOREIGN KEY (satuan_id) REFERENCES kinerja_satuan (id) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
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
      PRIMARY KEY (id),
      KEY idx_kinerja_target_periodik_iki (iki_pegawai_id),
      CONSTRAINT fk_kinerja_target_periodik_iki FOREIGN KEY (iki_pegawai_id) REFERENCES kinerja_iki_pegawai (id) ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
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
      PRIMARY KEY (id),
      KEY idx_kinerja_dialog_awal_periode (periode_id),
      KEY idx_kinerja_dialog_awal_pegawai (pegawai_id),
      KEY idx_kinerja_dialog_awal_penilai (penilai_pegawai_id),
      CONSTRAINT fk_kinerja_dialog_awal_periode FOREIGN KEY (periode_id) REFERENCES kinerja_periode (id) ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT fk_kinerja_dialog_awal_pegawai FOREIGN KEY (pegawai_id) REFERENCES pegawai (id) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT fk_kinerja_dialog_awal_penilai FOREIGN KEY (penilai_pegawai_id) REFERENCES pegawai (id) ON DELETE RESTRICT ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  kinerjaPlanningSchemaReady = true;
};

const ensureKinerjaPeriodExists = async (periodId: number) => {
  await ensureKinerjaPlanningSchema();
  const [rows] = await pool.query<any[]>(
    `SELECT id,
            tahun,
            nama_periode AS namaPeriode,
            DATE_FORMAT(tanggal_mulai, '%Y-%m-%d') AS tanggalMulai,
            DATE_FORMAT(tanggal_selesai, '%Y-%m-%d') AS tanggalSelesai
     FROM kinerja_periode
     WHERE id = ?
     LIMIT 1`,
    [periodId]
  );

  if (!rows.length) {
    fail("Periode kinerja tidak ditemukan", 404);
  }

  return rows[0];
};

const ensureKinerjaSatuanExists = async (satuanId: number | null) => {
  if (!satuanId) return;
  await ensureKinerjaPlanningSchema();
  const [rows] = await pool.query<any[]>(
    `SELECT id FROM kinerja_satuan WHERE id = ? LIMIT 1`,
    [satuanId]
  );

  if (!rows.length) {
    fail("Satuan tidak ditemukan", 404);
  }
};

const ensureIndicatorKinerjaExists = async (indikatorId: number | null) => {
  if (!indikatorId) return;
  const [rows] = await pool.query<any[]>(
    `SELECT id FROM indikator_kinerja WHERE id = ? LIMIT 1`,
    [indikatorId]
  );

  if (!rows.length) {
    fail("Indikator kinerja tidak ditemukan", 404);
  }
};

const ensureKinerjaIkuSatkerExists = async (ikuId: number) => {
  await ensureKinerjaPlanningSchema();
  const [rows] = await pool.query<any[]>(
    `SELECT id FROM kinerja_iku_satker WHERE id = ? LIMIT 1`,
    [ikuId]
  );

  if (!rows.length) {
    fail("IKU Satker tidak ditemukan", 404);
  }
};

const ensureKinerjaIkiPegawaiExists = async (ikiId: number) => {
  await ensureKinerjaPlanningSchema();
  const [rows] = await pool.query<any[]>(
    `SELECT iki.id,
            iki.target,
            DATE_FORMAT(kp.tanggal_mulai, '%Y-%m-%d') AS tanggalMulai,
            DATE_FORMAT(kp.tanggal_selesai, '%Y-%m-%d') AS tanggalSelesai
     FROM kinerja_iki_pegawai iki
     LEFT JOIN kinerja_periode kp ON kp.id = iki.periode_id
     WHERE iki.id = ?
     LIMIT 1`,
    [ikiId]
  );

  if (!rows.length) {
    fail("IKI pegawai tidak ditemukan", 404);
  }

  return rows[0];
};

const buildKinerjaIkuSatkerRecord = (row: any) => ({
  id: Number(row.id),
  periodeId: Number(row.periodeId),
  periodeNama: String(row.periodeNama || ""),
  sasaranStrategis: String(row.sasaranStrategis || ""),
  namaIku: String(row.namaIku || ""),
  definisi: String(row.definisi || ""),
  formula: String(row.formula || ""),
  target: row.target === null || row.target === undefined ? null : Number(row.target),
  satuanId: row.satuanId === null || row.satuanId === undefined ? null : Number(row.satuanId),
  satuanNama: String(row.satuanNama || ""),
  bobot: row.bobot === null || row.bobot === undefined ? null : Number(row.bobot),
  sumberData: String(row.sumberData || ""),
  penanggungJawabPegawaiId:
    row.penanggungJawabPegawaiId === null || row.penanggungJawabPegawaiId === undefined
      ? null
      : Number(row.penanggungJawabPegawaiId),
  penanggungJawabNama: String(row.penanggungJawabNama || ""),
  status: String(row.status || "draft")
});

const buildKinerjaCascadingRecord = (row: any) => ({
  id: Number(row.id),
  ikuSatkerId: Number(row.ikuSatkerId),
  ikuSatkerNama: String(row.ikuSatkerNama || ""),
  indikatorKinerjaId: Number(row.indikatorKinerjaId),
  indikatorKinerjaNama: String(row.indikatorKinerjaNama || ""),
  timKerjaId: row.timKerjaId == null ? null : Number(row.timKerjaId),
  timKerjaNama: String(row.timKerjaNama || ""),
  pegawaiId: row.pegawaiId == null ? null : Number(row.pegawaiId),
  pegawaiNama: String(row.pegawaiNama || ""),
  persentaseKontribusi:
    row.persentaseKontribusi === null || row.persentaseKontribusi === undefined ? null : Number(row.persentaseKontribusi),
  catatan: String(row.catatan || ""),
  status: String(row.status || "draft")
});

const buildKinerjaIkiRecord = (row: any) => ({
  id: Number(row.id),
  periodeId: Number(row.periodeId),
  periodeNama: String(row.periodeNama || ""),
  pegawaiId: Number(row.pegawaiId),
  pegawaiNama: String(row.pegawaiNama || ""),
  timKerjaId: row.timKerjaId == null ? null : Number(row.timKerjaId),
  timKerjaNama: String(row.timKerjaNama || ""),
  indikatorKinerjaId: row.indikatorKinerjaId == null ? null : Number(row.indikatorKinerjaId),
  indikatorKinerjaNama: String(row.indikatorKinerjaNama || ""),
  namaIki: String(row.namaIki || ""),
  target: row.target === null || row.target === undefined ? null : Number(row.target),
  satuanId: row.satuanId == null ? null : Number(row.satuanId),
  satuanNama: String(row.satuanNama || ""),
  bobot: row.bobot === null || row.bobot === undefined ? null : Number(row.bobot),
  metodeUkur: String(row.metodeUkur || ""),
  sumberBukti: String(row.sumberBukti || ""),
  status: String(row.status || "draft")
});

const buildKinerjaTargetPeriodikRecord = (row: any) => ({
  id: Number(row.id),
  ikiPegawaiId: Number(row.ikiPegawaiId),
  ikiNama: String(row.ikiNama || ""),
  pegawaiNama: String(row.pegawaiNama || ""),
  jenisPeriode: String(row.jenisPeriode || "bulanan"),
  periodeKe: Number(row.periodeKe || 0),
  tanggalMulai: String(row.tanggalMulai || ""),
  tanggalSelesai: String(row.tanggalSelesai || ""),
  target: row.target === null || row.target === undefined ? null : Number(row.target),
  milestone: String(row.milestone || ""),
  status: String(row.status || "draft")
});

const buildKinerjaDialogAwalRecord = (row: any) => ({
  id: Number(row.id),
  periodeId: Number(row.periodeId),
  periodeNama: String(row.periodeNama || ""),
  pegawaiId: Number(row.pegawaiId),
  pegawaiNama: String(row.pegawaiNama || ""),
  penilaiPegawaiId: Number(row.penilaiPegawaiId),
  penilaiNama: String(row.penilaiNama || ""),
  ringkasanTarget: String(row.ringkasanTarget || ""),
  ekspektasiHasil: String(row.ekspektasiHasil || ""),
  ekspektasiPerilaku: String(row.ekspektasiPerilaku || ""),
  risiko: String(row.risiko || ""),
  dukunganDibutuhkan: String(row.dukunganDibutuhkan || ""),
  catatanDialog: String(row.catatanDialog || ""),
  status: String(row.status || "draft")
});

const normalizeKinerjaIkuSatkerPayload = (body: Record<string, unknown>) => ({
  periodeId: readPositiveId(body.periodeId, "Periode kinerja"),
  sasaranStrategis: ensureRequired(readTrimmedString(body.sasaranStrategis), "Sasaran strategis wajib diisi"),
  namaIku: ensureRequired(readTrimmedString(body.namaIku), "Nama IKU wajib diisi"),
  definisi: readTrimmedString(body.definisi),
  formula: readTrimmedString(body.formula),
  target: readOptionalNonNegativeValue(body.target, "Target IKU"),
  satuanId: readOptionalPositiveId(body.satuanId, "Satuan"),
  bobot: readOptionalNonNegativeValue(body.bobot, "Bobot IKU"),
  sumberData: readTrimmedString(body.sumberData),
  penanggungJawabPegawaiId: readOptionalPositiveId(body.penanggungJawabPegawaiId, "Penanggung jawab"),
  status: readKinerjaPlanningStatus(body.status, "draft")
});

const normalizeKinerjaCascadingPayload = (body: Record<string, unknown>) => {
  const timKerjaId = readOptionalPositiveId(body.timKerjaId, "Tim kerja");
  const pegawaiId = readOptionalPositiveId(body.pegawaiId, "Pegawai");

  if (!timKerjaId && !pegawaiId) {
    fail("Pilih minimal tim kerja atau pegawai untuk relasi cascading", 400);
  }

  return {
    ikuSatkerId: readPositiveId(body.ikuSatkerId, "IKU Satker"),
    indikatorKinerjaId: readPositiveId(body.indikatorKinerjaId, "Indikator kinerja"),
    timKerjaId,
    pegawaiId,
    persentaseKontribusi: readOptionalNonNegativeValue(body.persentaseKontribusi, "Persentase kontribusi"),
    catatan: readTrimmedString(body.catatan),
    status: readKinerjaPlanningStatus(body.status, "draft")
  };
};

const normalizeKinerjaIkiPayload = (body: Record<string, unknown>) => ({
  periodeId: readPositiveId(body.periodeId, "Periode kinerja"),
  pegawaiId: readPositiveId(body.pegawaiId, "Pegawai"),
  timKerjaId: readOptionalPositiveId(body.timKerjaId, "Tim kerja"),
  indikatorKinerjaId: readOptionalPositiveId(body.indikatorKinerjaId, "Indikator kinerja"),
  namaIki: ensureRequired(readTrimmedString(body.namaIki), "Nama IKI wajib diisi"),
  target: readOptionalNonNegativeValue(body.target, "Target IKI"),
  satuanId: readOptionalPositiveId(body.satuanId, "Satuan"),
  bobot: readOptionalNonNegativeValue(body.bobot, "Bobot IKI"),
  metodeUkur: readTrimmedString(body.metodeUkur),
  sumberBukti: readTrimmedString(body.sumberBukti),
  status: readKinerjaIkiStatus(body.status, "draft")
});

const normalizeKinerjaTargetPeriodikPayload = (body: Record<string, unknown>) => {
  const tanggalMulai = readDateString(body.tanggalMulai, "Tanggal mulai");
  const tanggalSelesai = readDateString(body.tanggalSelesai, "Tanggal selesai");
  ensurePlanningDateRange(tanggalMulai, tanggalSelesai);

  return {
    ikiPegawaiId: readPositiveId(body.ikiPegawaiId, "IKI pegawai"),
    jenisPeriode: readKinerjaTargetPeriodType(body.jenisPeriode),
    periodeKe: readIntegerInRange(body.periodeKe, 1, 12, "Periode ke"),
    tanggalMulai,
    tanggalSelesai,
    target: readOptionalNonNegativeValue(body.target, "Target periodik"),
    milestone: readTrimmedString(body.milestone),
    status: readKinerjaTargetPeriodStatus(body.status, "draft")
  };
};

const normalizeKinerjaDialogAwalPayload = (body: Record<string, unknown>) => ({
  periodeId: readPositiveId(body.periodeId, "Periode kinerja"),
  pegawaiId: readPositiveId(body.pegawaiId, "Pegawai"),
  penilaiPegawaiId: readPositiveId(body.penilaiPegawaiId, "Penilai"),
  ringkasanTarget: readTrimmedString(body.ringkasanTarget),
  ekspektasiHasil: readTrimmedString(body.ekspektasiHasil),
  ekspektasiPerilaku: readTrimmedString(body.ekspektasiPerilaku),
  risiko: readTrimmedString(body.risiko),
  dukunganDibutuhkan: readTrimmedString(body.dukunganDibutuhkan),
  catatanDialog: readTrimmedString(body.catatanDialog),
  status: readKinerjaDialogStatus(body.status, "draft")
});

const toIsoDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const cloneDate = (value: string | Date) => {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    fail("Tanggal tidak valid", 400);
  }
  return date;
};

const endOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0);
const addDays = (date: Date, days: number) => {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
};
const addMonths = (date: Date, months: number) => {
  const next = new Date(date.getTime());
  next.setMonth(next.getMonth() + months);
  return next;
};

const buildGeneratedTargetRanges = (startDate: string, endDate: string, jenisPeriode: "bulanan" | "triwulan" | "semester") => {
  const ranges: Array<{ periodeKe: number; tanggalMulai: string; tanggalSelesai: string }> = [];
  const end = cloneDate(endDate);
  let cursor = cloneDate(startDate);
  let periodeKe = 1;
  const monthStep = jenisPeriode === "bulanan" ? 1 : jenisPeriode === "triwulan" ? 3 : 6;

  while (cursor.getTime() <= end.getTime()) {
    const start = new Date(cursor.getTime());
    const endCandidate = endOfMonth(addMonths(start, monthStep - 1));
    const segmentEnd = endCandidate.getTime() > end.getTime() ? new Date(end.getTime()) : endCandidate;

    ranges.push({
      periodeKe,
      tanggalMulai: toIsoDate(start),
      tanggalSelesai: toIsoDate(segmentEnd)
    });

    periodeKe += 1;
    cursor = addDays(segmentEnd, 1);
  }

  return ranges;
};

export const getIkuSatker = asyncHandler(async (req, res) => {
  await ensureKinerjaPlanningSchema();
  const periodeId = readOptionalPositiveId(req.query?.periodeId, "Periode kinerja");
  const filters: string[] = [];
  const params: unknown[] = [];

  if (periodeId) {
    filters.push("iku.periode_id = ?");
    params.push(periodeId);
  }

  const [rows] = await pool.query<any[]>(
    `SELECT iku.id,
            iku.periode_id AS periodeId,
            kp.nama_periode AS periodeNama,
            iku.sasaran_strategis AS sasaranStrategis,
            iku.nama_iku AS namaIku,
            COALESCE(iku.definisi, '') AS definisi,
            COALESCE(iku.formula, '') AS formula,
            iku.target,
            iku.satuan_id AS satuanId,
            COALESCE(ks.nama_satuan, '') AS satuanNama,
            iku.bobot,
            COALESCE(iku.sumber_data, '') AS sumberData,
            iku.penanggung_jawab_pegawai_id AS penanggungJawabPegawaiId,
            COALESCE(pp.nama_lengkap, '') AS penanggungJawabNama,
            iku.status
     FROM kinerja_iku_satker iku
     LEFT JOIN kinerja_periode kp ON kp.id = iku.periode_id
     LEFT JOIN kinerja_satuan ks ON ks.id = iku.satuan_id
     LEFT JOIN pegawai pp ON pp.id = iku.penanggung_jawab_pegawai_id
     ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
     ORDER BY kp.tahun DESC, iku.nama_iku ASC`,
    params
  );

  return sendSuccess(res, rows.map(buildKinerjaIkuSatkerRecord));
});

export const createIkuSatker = asyncHandler(async (req, res) => {
  await ensureKinerjaPlanningSchema();
  const payload = normalizeKinerjaIkuSatkerPayload(req.body || {});
  await ensureKinerjaPeriodExists(payload.periodeId);
  await ensureKinerjaSatuanExists(payload.satuanId);
  if (payload.penanggungJawabPegawaiId) await ensureEmployeeExists(payload.penanggungJawabPegawaiId);

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO kinerja_iku_satker
       (periode_id, sasaran_strategis, nama_iku, definisi, formula, target, satuan_id, bobot, sumber_data, penanggung_jawab_pegawai_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.periodeId,
      payload.sasaranStrategis,
      payload.namaIku,
      payload.definisi || null,
      payload.formula || null,
      payload.target,
      payload.satuanId,
      payload.bobot,
      payload.sumberData || null,
      payload.penanggungJawabPegawaiId,
      payload.status
    ]
  );

  return sendSuccess(res, { id: result.insertId }, "IKU Satker berhasil ditambahkan", 201);
});

export const updateIkuSatker = asyncHandler(async (req, res) => {
  await ensureKinerjaPlanningSchema();
  const id = readPositiveId(req.params.id, "IKU Satker");
  const payload = normalizeKinerjaIkuSatkerPayload(req.body || {});
  await ensureKinerjaIkuSatkerExists(id);
  await ensureKinerjaPeriodExists(payload.periodeId);
  await ensureKinerjaSatuanExists(payload.satuanId);
  if (payload.penanggungJawabPegawaiId) await ensureEmployeeExists(payload.penanggungJawabPegawaiId);

  await pool.query(
    `UPDATE kinerja_iku_satker
     SET periode_id = ?,
         sasaran_strategis = ?,
         nama_iku = ?,
         definisi = ?,
         formula = ?,
         target = ?,
         satuan_id = ?,
         bobot = ?,
         sumber_data = ?,
         penanggung_jawab_pegawai_id = ?,
         status = ?,
         diperbarui_pada = NOW()
     WHERE id = ?`,
    [
      payload.periodeId,
      payload.sasaranStrategis,
      payload.namaIku,
      payload.definisi || null,
      payload.formula || null,
      payload.target,
      payload.satuanId,
      payload.bobot,
      payload.sumberData || null,
      payload.penanggungJawabPegawaiId,
      payload.status,
      id
    ]
  );

  return sendSuccess(res, null, "IKU Satker berhasil diperbarui");
});

export const deleteIkuSatker = asyncHandler(async (req, res) => {
  await ensureKinerjaPlanningSchema();
  const id = readPositiveId(req.params.id, "IKU Satker");
  await ensureKinerjaIkuSatkerExists(id);
  await pool.query(`DELETE FROM kinerja_iku_satker WHERE id = ?`, [id]);
  return sendSuccess(res, null, "IKU Satker berhasil dihapus");
});

export const getCascadingIku = asyncHandler(async (req, res) => {
  await ensureKinerjaPlanningSchema();
  const ikuSatkerId = readOptionalPositiveId(req.query?.ikuSatkerId, "IKU Satker");
  const filters: string[] = [];
  const params: unknown[] = [];

  if (ikuSatkerId) {
    filters.push("c.iku_satker_id = ?");
    params.push(ikuSatkerId);
  }

  const [rows] = await pool.query<any[]>(
    `SELECT c.id,
            c.iku_satker_id AS ikuSatkerId,
            iku.nama_iku AS ikuSatkerNama,
            c.indikator_kinerja_id AS indikatorKinerjaId,
            ik.nama AS indikatorKinerjaNama,
            c.tim_kerja_id AS timKerjaId,
            COALESCE(tk.nama_tim, '') AS timKerjaNama,
            c.pegawai_id AS pegawaiId,
            COALESCE(pg.nama_lengkap, '') AS pegawaiNama,
            c.persentase_kontribusi AS persentaseKontribusi,
            COALESCE(c.catatan, '') AS catatan,
            c.status
     FROM kinerja_cascading_iku c
     LEFT JOIN kinerja_iku_satker iku ON iku.id = c.iku_satker_id
     LEFT JOIN indikator_kinerja ik ON ik.id = c.indikator_kinerja_id
     LEFT JOIN kinerja_tim_kerja tk ON tk.id = c.tim_kerja_id
     LEFT JOIN pegawai pg ON pg.id = c.pegawai_id
     ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
     ORDER BY iku.nama_iku ASC, ik.nama ASC`,
    params
  );

  return sendSuccess(res, rows.map(buildKinerjaCascadingRecord));
});

export const createCascadingIku = asyncHandler(async (req, res) => {
  await ensureKinerjaPlanningSchema();
  const payload = normalizeKinerjaCascadingPayload(req.body || {});
  await ensureKinerjaIkuSatkerExists(payload.ikuSatkerId);
  await ensureIndicatorKinerjaExists(payload.indikatorKinerjaId);
  if (payload.timKerjaId) await ensureTeamExists(payload.timKerjaId);
  if (payload.pegawaiId) await ensureEmployeeExists(payload.pegawaiId);

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO kinerja_cascading_iku
       (iku_satker_id, indikator_kinerja_id, tim_kerja_id, pegawai_id, persentase_kontribusi, catatan, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.ikuSatkerId,
      payload.indikatorKinerjaId,
      payload.timKerjaId,
      payload.pegawaiId,
      payload.persentaseKontribusi,
      payload.catatan || null,
      payload.status
    ]
  );

  return sendSuccess(res, { id: result.insertId }, "Cascading IKU berhasil ditambahkan", 201);
});

export const updateCascadingIku = asyncHandler(async (req, res) => {
  await ensureKinerjaPlanningSchema();
  const id = readPositiveId(req.params.id, "Cascading IKU");
  const payload = normalizeKinerjaCascadingPayload(req.body || {});
  const [rows] = await pool.query<any[]>(`SELECT id FROM kinerja_cascading_iku WHERE id = ? LIMIT 1`, [id]);
  if (!rows.length) fail("Cascading IKU tidak ditemukan", 404);
  await ensureKinerjaIkuSatkerExists(payload.ikuSatkerId);
  await ensureIndicatorKinerjaExists(payload.indikatorKinerjaId);
  if (payload.timKerjaId) await ensureTeamExists(payload.timKerjaId);
  if (payload.pegawaiId) await ensureEmployeeExists(payload.pegawaiId);

  await pool.query(
    `UPDATE kinerja_cascading_iku
     SET iku_satker_id = ?,
         indikator_kinerja_id = ?,
         tim_kerja_id = ?,
         pegawai_id = ?,
         persentase_kontribusi = ?,
         catatan = ?,
         status = ?,
         diperbarui_pada = NOW()
     WHERE id = ?`,
    [
      payload.ikuSatkerId,
      payload.indikatorKinerjaId,
      payload.timKerjaId,
      payload.pegawaiId,
      payload.persentaseKontribusi,
      payload.catatan || null,
      payload.status,
      id
    ]
  );

  return sendSuccess(res, null, "Cascading IKU berhasil diperbarui");
});

export const deleteCascadingIku = asyncHandler(async (req, res) => {
  await ensureKinerjaPlanningSchema();
  const id = readPositiveId(req.params.id, "Cascading IKU");
  const [rows] = await pool.query<any[]>(`SELECT id FROM kinerja_cascading_iku WHERE id = ? LIMIT 1`, [id]);
  if (!rows.length) fail("Cascading IKU tidak ditemukan", 404);
  await pool.query(`DELETE FROM kinerja_cascading_iku WHERE id = ?`, [id]);
  return sendSuccess(res, null, "Cascading IKU berhasil dihapus");
});

export const getIkiPegawai = asyncHandler(async (req, res) => {
  await ensureKinerjaPlanningSchema();
  const periodeId = readOptionalPositiveId(req.query?.periodeId, "Periode kinerja");
  const pegawaiId = readOptionalPositiveId(req.query?.pegawaiId, "Pegawai");
  const filters: string[] = [];
  const params: unknown[] = [];

  if (periodeId) {
    filters.push("iki.periode_id = ?");
    params.push(periodeId);
  }
  if (pegawaiId) {
    filters.push("iki.pegawai_id = ?");
    params.push(pegawaiId);
  }

  const [rows] = await pool.query<any[]>(
    `SELECT iki.id,
            iki.periode_id AS periodeId,
            kp.nama_periode AS periodeNama,
            iki.pegawai_id AS pegawaiId,
            pg.nama_lengkap AS pegawaiNama,
            iki.tim_kerja_id AS timKerjaId,
            COALESCE(tk.nama_tim, '') AS timKerjaNama,
            iki.indikator_kinerja_id AS indikatorKinerjaId,
            COALESCE(ik.nama, '') AS indikatorKinerjaNama,
            iki.nama_iki AS namaIki,
            iki.target,
            iki.satuan_id AS satuanId,
            COALESCE(ks.nama_satuan, '') AS satuanNama,
            iki.bobot,
            COALESCE(iki.metode_ukur, '') AS metodeUkur,
            COALESCE(iki.sumber_bukti, '') AS sumberBukti,
            iki.status
     FROM kinerja_iki_pegawai iki
     LEFT JOIN kinerja_periode kp ON kp.id = iki.periode_id
     LEFT JOIN pegawai pg ON pg.id = iki.pegawai_id
     LEFT JOIN kinerja_tim_kerja tk ON tk.id = iki.tim_kerja_id
     LEFT JOIN indikator_kinerja ik ON ik.id = iki.indikator_kinerja_id
     LEFT JOIN kinerja_satuan ks ON ks.id = iki.satuan_id
     ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
     ORDER BY kp.tahun DESC, pg.nama_lengkap ASC, iki.nama_iki ASC`,
    params
  );

  return sendSuccess(res, rows.map(buildKinerjaIkiRecord));
});

export const createIkiPegawai = asyncHandler(async (req, res) => {
  await ensureKinerjaPlanningSchema();
  const payload = normalizeKinerjaIkiPayload(req.body || {});
  await ensureKinerjaPeriodExists(payload.periodeId);
  await ensureEmployeeExists(payload.pegawaiId);
  if (payload.timKerjaId) await ensureTeamExists(payload.timKerjaId);
  await ensureIndicatorKinerjaExists(payload.indikatorKinerjaId);
  await ensureKinerjaSatuanExists(payload.satuanId);

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO kinerja_iki_pegawai
       (periode_id, pegawai_id, tim_kerja_id, indikator_kinerja_id, nama_iki, target, satuan_id, bobot, metode_ukur, sumber_bukti, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.periodeId,
      payload.pegawaiId,
      payload.timKerjaId,
      payload.indikatorKinerjaId,
      payload.namaIki,
      payload.target,
      payload.satuanId,
      payload.bobot,
      payload.metodeUkur || null,
      payload.sumberBukti || null,
      payload.status
    ]
  );

  return sendSuccess(res, { id: result.insertId }, "IKI pegawai berhasil ditambahkan", 201);
});

export const updateIkiPegawai = asyncHandler(async (req, res) => {
  await ensureKinerjaPlanningSchema();
  const id = readPositiveId(req.params.id, "IKI pegawai");
  const payload = normalizeKinerjaIkiPayload(req.body || {});
  await ensureKinerjaIkiPegawaiExists(id);
  await ensureKinerjaPeriodExists(payload.periodeId);
  await ensureEmployeeExists(payload.pegawaiId);
  if (payload.timKerjaId) await ensureTeamExists(payload.timKerjaId);
  await ensureIndicatorKinerjaExists(payload.indikatorKinerjaId);
  await ensureKinerjaSatuanExists(payload.satuanId);

  await pool.query(
    `UPDATE kinerja_iki_pegawai
     SET periode_id = ?,
         pegawai_id = ?,
         tim_kerja_id = ?,
         indikator_kinerja_id = ?,
         nama_iki = ?,
         target = ?,
         satuan_id = ?,
         bobot = ?,
         metode_ukur = ?,
         sumber_bukti = ?,
         status = ?,
         diperbarui_pada = NOW()
     WHERE id = ?`,
    [
      payload.periodeId,
      payload.pegawaiId,
      payload.timKerjaId,
      payload.indikatorKinerjaId,
      payload.namaIki,
      payload.target,
      payload.satuanId,
      payload.bobot,
      payload.metodeUkur || null,
      payload.sumberBukti || null,
      payload.status,
      id
    ]
  );

  return sendSuccess(res, null, "IKI pegawai berhasil diperbarui");
});

const updateIkiStatus = async (id: number, nextStatus: (typeof KINERJA_IKI_STATUS)[number], allowedCurrent: string[]) => {
  await ensureKinerjaPlanningSchema();
  const [rows] = await pool.query<any[]>(
    `SELECT id, status FROM kinerja_iki_pegawai WHERE id = ? LIMIT 1`,
    [id]
  );

  if (!rows.length) {
    fail("IKI pegawai tidak ditemukan", 404);
  }

  const currentStatus = String(rows[0].status || "draft");
  if (!allowedCurrent.includes(currentStatus)) {
    fail("Status IKI pegawai tidak dapat diproses", 400);
  }

  await pool.query(
    `UPDATE kinerja_iki_pegawai
     SET status = ?, diperbarui_pada = NOW()
     WHERE id = ?`,
    [nextStatus, id]
  );
};

export const submitIkiPegawai = asyncHandler(async (req, res) => {
  const id = readPositiveId(req.params.id, "IKI pegawai");
  await updateIkiStatus(id, "diajukan", ["draft", "revisi"]);
  return sendSuccess(res, null, "IKI pegawai berhasil diajukan");
});

export const approveIkiPegawai = asyncHandler(async (req, res) => {
  const id = readPositiveId(req.params.id, "IKI pegawai");
  await updateIkiStatus(id, "disetujui", ["diajukan"]);
  return sendSuccess(res, null, "IKI pegawai berhasil disetujui");
});

export const reviseIkiPegawai = asyncHandler(async (req, res) => {
  const id = readPositiveId(req.params.id, "IKI pegawai");
  await updateIkiStatus(id, "revisi", ["diajukan", "disetujui"]);
  return sendSuccess(res, null, "IKI pegawai dikembalikan untuk revisi");
});

export const lockIkiPegawai = asyncHandler(async (req, res) => {
  const id = readPositiveId(req.params.id, "IKI pegawai");
  await updateIkiStatus(id, "dikunci", ["disetujui"]);
  return sendSuccess(res, null, "IKI pegawai berhasil dikunci");
});

export const getTargetPeriodik = asyncHandler(async (req, res) => {
  await ensureKinerjaPlanningSchema();
  const ikiPegawaiId = readOptionalPositiveId(req.query?.ikiPegawaiId, "IKI pegawai");
  const filters: string[] = [];
  const params: unknown[] = [];

  if (ikiPegawaiId) {
    filters.push("tp.iki_pegawai_id = ?");
    params.push(ikiPegawaiId);
  }

  const [rows] = await pool.query<any[]>(
    `SELECT tp.id,
            tp.iki_pegawai_id AS ikiPegawaiId,
            iki.nama_iki AS ikiNama,
            pg.nama_lengkap AS pegawaiNama,
            tp.jenis_periode AS jenisPeriode,
            tp.periode_ke AS periodeKe,
            DATE_FORMAT(tp.tanggal_mulai, '%Y-%m-%d') AS tanggalMulai,
            DATE_FORMAT(tp.tanggal_selesai, '%Y-%m-%d') AS tanggalSelesai,
            tp.target,
            COALESCE(tp.milestone, '') AS milestone,
            tp.status
     FROM kinerja_target_periodik tp
     LEFT JOIN kinerja_iki_pegawai iki ON iki.id = tp.iki_pegawai_id
     LEFT JOIN pegawai pg ON pg.id = iki.pegawai_id
     ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
     ORDER BY pg.nama_lengkap ASC, tp.jenis_periode ASC, tp.periode_ke ASC`,
    params
  );

  return sendSuccess(res, rows.map(buildKinerjaTargetPeriodikRecord));
});

export const createTargetPeriodik = asyncHandler(async (req, res) => {
  await ensureKinerjaPlanningSchema();
  const payload = normalizeKinerjaTargetPeriodikPayload(req.body || {});
  await ensureKinerjaIkiPegawaiExists(payload.ikiPegawaiId);

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO kinerja_target_periodik
       (iki_pegawai_id, jenis_periode, periode_ke, tanggal_mulai, tanggal_selesai, target, milestone, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.ikiPegawaiId,
      payload.jenisPeriode,
      payload.periodeKe,
      payload.tanggalMulai,
      payload.tanggalSelesai,
      payload.target,
      payload.milestone || null,
      payload.status
    ]
  );

  return sendSuccess(res, { id: result.insertId }, "Target periodik berhasil ditambahkan", 201);
});

export const updateTargetPeriodik = asyncHandler(async (req, res) => {
  await ensureKinerjaPlanningSchema();
  const id = readPositiveId(req.params.id, "Target periodik");
  const payload = normalizeKinerjaTargetPeriodikPayload(req.body || {});
  const [rows] = await pool.query<any[]>(`SELECT id FROM kinerja_target_periodik WHERE id = ? LIMIT 1`, [id]);
  if (!rows.length) fail("Target periodik tidak ditemukan", 404);
  await ensureKinerjaIkiPegawaiExists(payload.ikiPegawaiId);

  await pool.query(
    `UPDATE kinerja_target_periodik
     SET iki_pegawai_id = ?,
         jenis_periode = ?,
         periode_ke = ?,
         tanggal_mulai = ?,
         tanggal_selesai = ?,
         target = ?,
         milestone = ?,
         status = ?,
         diperbarui_pada = NOW()
     WHERE id = ?`,
    [
      payload.ikiPegawaiId,
      payload.jenisPeriode,
      payload.periodeKe,
      payload.tanggalMulai,
      payload.tanggalSelesai,
      payload.target,
      payload.milestone || null,
      payload.status,
      id
    ]
  );

  return sendSuccess(res, null, "Target periodik berhasil diperbarui");
});

export const generateTargetPeriodik = asyncHandler(async (req, res) => {
  await ensureKinerjaPlanningSchema();
  const ikiPegawaiId = readPositiveId(req.body?.ikiPegawaiId, "IKI pegawai");
  const jenisPeriode = readKinerjaTargetPeriodType(req.body?.jenisPeriode);
  const iki = await ensureKinerjaIkiPegawaiExists(ikiPegawaiId);
  const tanggalMulai = String(iki.tanggalMulai || "");
  const tanggalSelesai = String(iki.tanggalSelesai || "");

  if (!tanggalMulai || !tanggalSelesai) {
    fail("Periode kinerja untuk IKI pegawai belum lengkap", 400);
  }

  const [lockedRows] = await pool.query<any[]>(
    `SELECT id
     FROM kinerja_target_periodik
     WHERE iki_pegawai_id = ?
       AND jenis_periode = ?
       AND status = 'dikunci'
     LIMIT 1`,
    [ikiPegawaiId, jenisPeriode]
  );

  if (lockedRows.length) {
    fail("Target periodik yang sudah dikunci tidak dapat digenerate ulang", 400);
  }

  const ranges = buildGeneratedTargetRanges(tanggalMulai, tanggalSelesai, jenisPeriode);
  if (!ranges.length) {
    fail("Rentang target periodik tidak dapat dibentuk", 400);
  }

  await pool.query(
    `DELETE FROM kinerja_target_periodik
     WHERE iki_pegawai_id = ?
       AND jenis_periode = ?`,
    [ikiPegawaiId, jenisPeriode]
  );

  const totalTarget = iki.target === null || iki.target === undefined ? 0 : Number(iki.target);
  const totalCount = ranges.length;
  const targetPerRange = totalCount > 0 ? Number((totalTarget / totalCount).toFixed(2)) : 0;

  for (const [index, range] of ranges.entries()) {
    const targetValue = index === totalCount - 1
      ? Number((totalTarget - targetPerRange * (totalCount - 1)).toFixed(2))
      : targetPerRange;

    await pool.query(
      `INSERT INTO kinerja_target_periodik
         (iki_pegawai_id, jenis_periode, periode_ke, tanggal_mulai, tanggal_selesai, target, milestone, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'aktif')`,
      [
        ikiPegawaiId,
        jenisPeriode,
        range.periodeKe,
        range.tanggalMulai,
        range.tanggalSelesai,
        targetValue,
        `${jenisPeriode} ke-${range.periodeKe}`
      ]
    );
  }

  return sendSuccess(res, { generated: ranges.length }, "Target periodik otomatis berhasil dibuat");
});

export const getDialogAwal = asyncHandler(async (req, res) => {
  await ensureKinerjaPlanningSchema();
  const periodeId = readOptionalPositiveId(req.query?.periodeId, "Periode kinerja");
  const pegawaiId = readOptionalPositiveId(req.query?.pegawaiId, "Pegawai");
  const filters: string[] = [];
  const params: unknown[] = [];

  if (periodeId) {
    filters.push("d.periode_id = ?");
    params.push(periodeId);
  }
  if (pegawaiId) {
    filters.push("d.pegawai_id = ?");
    params.push(pegawaiId);
  }

  const [rows] = await pool.query<any[]>(
    `SELECT d.id,
            d.periode_id AS periodeId,
            kp.nama_periode AS periodeNama,
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
     LEFT JOIN kinerja_periode kp ON kp.id = d.periode_id
     LEFT JOIN pegawai pg ON pg.id = d.pegawai_id
     LEFT JOIN pegawai pn ON pn.id = d.penilai_pegawai_id
     ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
     ORDER BY kp.tahun DESC, pg.nama_lengkap ASC`,
    params
  );

  return sendSuccess(res, rows.map(buildKinerjaDialogAwalRecord));
});

export const createDialogAwal = asyncHandler(async (req, res) => {
  await ensureKinerjaPlanningSchema();
  const payload = normalizeKinerjaDialogAwalPayload(req.body || {});
  await ensureKinerjaPeriodExists(payload.periodeId);
  await ensureEmployeeExists(payload.pegawaiId);
  await ensureEmployeeExists(payload.penilaiPegawaiId);

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO kinerja_dialog_awal
       (periode_id, pegawai_id, penilai_pegawai_id, ringkasan_target, ekspektasi_hasil, ekspektasi_perilaku, risiko, dukungan_dibutuhkan, catatan_dialog, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.periodeId,
      payload.pegawaiId,
      payload.penilaiPegawaiId,
      payload.ringkasanTarget || null,
      payload.ekspektasiHasil || null,
      payload.ekspektasiPerilaku || null,
      payload.risiko || null,
      payload.dukunganDibutuhkan || null,
      payload.catatanDialog || null,
      payload.status
    ]
  );

  return sendSuccess(res, { id: result.insertId }, "Dialog awal berhasil ditambahkan", 201);
});

export const updateDialogAwal = asyncHandler(async (req, res) => {
  await ensureKinerjaPlanningSchema();
  const id = readPositiveId(req.params.id, "Dialog awal");
  const payload = normalizeKinerjaDialogAwalPayload(req.body || {});
  const [rows] = await pool.query<any[]>(`SELECT id FROM kinerja_dialog_awal WHERE id = ? LIMIT 1`, [id]);
  if (!rows.length) fail("Dialog awal tidak ditemukan", 404);
  await ensureKinerjaPeriodExists(payload.periodeId);
  await ensureEmployeeExists(payload.pegawaiId);
  await ensureEmployeeExists(payload.penilaiPegawaiId);

  await pool.query(
    `UPDATE kinerja_dialog_awal
     SET periode_id = ?,
         pegawai_id = ?,
         penilai_pegawai_id = ?,
         ringkasan_target = ?,
         ekspektasi_hasil = ?,
         ekspektasi_perilaku = ?,
         risiko = ?,
         dukungan_dibutuhkan = ?,
         catatan_dialog = ?,
         status = ?,
         diperbarui_pada = NOW()
     WHERE id = ?`,
    [
      payload.periodeId,
      payload.pegawaiId,
      payload.penilaiPegawaiId,
      payload.ringkasanTarget || null,
      payload.ekspektasiHasil || null,
      payload.ekspektasiPerilaku || null,
      payload.risiko || null,
      payload.dukunganDibutuhkan || null,
      payload.catatanDialog || null,
      payload.status,
      id
    ]
  );

  return sendSuccess(res, null, "Dialog awal berhasil diperbarui");
});

export const approveDialogAwal = asyncHandler(async (req, res) => {
  await ensureKinerjaPlanningSchema();
  const id = readPositiveId(req.params.id, "Dialog awal");
  const [rows] = await pool.query<any[]>(`SELECT id, status FROM kinerja_dialog_awal WHERE id = ? LIMIT 1`, [id]);
  if (!rows.length) fail("Dialog awal tidak ditemukan", 404);
  if (String(rows[0].status || "draft") === "disetujui") {
    return sendSuccess(res, null, "Dialog awal sudah disetujui");
  }

  await pool.query(
    `UPDATE kinerja_dialog_awal
     SET status = 'disetujui', diperbarui_pada = NOW()
     WHERE id = ?`,
    [id]
  );

  return sendSuccess(res, null, "Dialog awal berhasil disetujui");
});
