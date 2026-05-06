import { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { pool } from "../../config/database";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware";
import { asyncHandler, fail, sendSuccess } from "../../shared/http";
import {
  ensureOneOf,
  ensureRequired,
  readBoolean,
  readDateString,
  readIntegerInRange,
  readNonNegativeNumber,
  readPositiveId,
  readPositiveNumber,
  readTrimmedString
} from "../../shared/validation";

const ASSIGNMENT_STATUS = ["Belum Submit", "Siap Submit", "Selesai"] as const;
const ACTIVITY_TYPES = ["kegiatan", "persentase", "file", "dokumen", "laporan"] as const;
const DAY_STATUS = ["kerja", "libur", "cuti"] as const;

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

const toMonthLabel = (month: number) => monthLabels[month - 1] || `Bulan ${month}`;

const toDisplayDate = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
};

const toDateRangeLabel = (startDate: string, endDate: string) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${startDate} - ${endDate}`;
  }

  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const startDay = String(start.getDate()).padStart(2, "0");
  const endDay = String(end.getDate()).padStart(2, "0");
  const endMonthLabel = new Intl.DateTimeFormat("id-ID", { month: "short" }).format(end);
  const endYear = end.getFullYear();

  if (sameMonth) {
    return `${startDay}–${endDay} ${endMonthLabel} ${endYear}`;
  }

  return `${toDisplayDate(startDate)} – ${toDisplayDate(endDate)}`;
};

const buildAssignmentRecord = (row: any) => {
  const percentage = Number(row.targetValue) > 0 ? Number(((Number(row.realizationValue) / Number(row.targetValue)) * 100).toFixed(2)) : 0;

  return {
    id: Number(row.id),
    employeeId: Number(row.employeeId),
    assignee: String(row.assignee || ""),
    activityId: row.activityId ? Number(row.activityId) : null,
    activity: String(row.activity || row.activityName || ""),
    description: String(row.description || ""),
    priority: row.priorityLabel ? String(row.priorityLabel) : null,
    month: Number(row.month),
    monthLabel: toMonthLabel(Number(row.month)),
    year: Number(row.year),
    date: toDateRangeLabel(String(row.startDate), String(row.endDate)),
    startDate: String(row.startDate),
    endDate: String(row.endDate),
    target: `${Number(row.targetValue)} (${String(row.targetUnit || row.activityType || "target")})`,
    targetValue: Number(row.targetValue),
    targetUnit: String(row.targetUnit || ""),
    realization: String(Number(row.realizationValue)),
    realizationValue: Number(row.realizationValue),
    proof: row.proof ? String(row.proof) : "Belum ada bukti",
    status: String(row.status),
    activityType: String(row.activityType),
    teamProvinsiId: row.teamProvinsiId ? Number(row.teamProvinsiId) : null,
    teamProvinsiName: row.teamProvinsiName ? String(row.teamProvinsiName) : null,
    teamKabupatenId: row.teamKabupatenId ? Number(row.teamKabupatenId) : null,
    teamKabupatenName: row.teamKabupatenName ? String(row.teamKabupatenName) : null,
    percentage,
    createdAt: row.createdAt ? String(row.createdAt) : null,
    updatedAt: row.updatedAt ? String(row.updatedAt) : null
  };
};

const normalizeAssignmentPayload = (body: Record<string, unknown>) => {
  const employeeId = readPositiveId(body.employeeId, "Pegawai");
  const month = readIntegerInRange(body.month, 1, 12, "Bulan");
  const year = readIntegerInRange(body.year, 2020, 2100, "Tahun");
  const activityName = ensureRequired(
    readTrimmedString(body.activityName),
    "Nama aktivitas wajib diisi"
  );
  const activityType = ensureOneOf(
    readTrimmedString(body.activityType || "kegiatan").toLowerCase(),
    ACTIVITY_TYPES,
    "Tipe aktivitas"
  );
  const startDate = readDateString(body.startDate, "Tanggal mulai");
  const endDate = readDateString(body.endDate, "Tanggal selesai");
  const targetValue = readPositiveNumber(body.targetValue, "Target");
  const realizationValue = readNonNegativeNumber(body.realizationValue, "Realisasi", 0);
  const targetUnit = ensureRequired(
    readTrimmedString(body.targetUnit),
    "Satuan target wajib diisi"
  );
  const status = ensureOneOf(
    readTrimmedString(body.status || "Belum Submit"),
    ASSIGNMENT_STATUS,
    "Status submit"
  );

  if (new Date(endDate).getTime() < new Date(startDate).getTime()) {
    fail("Tanggal selesai tidak boleh lebih awal dari tanggal mulai", 400);
  }

  return {
    employeeId,
    activityId: body.activityId ? readPositiveId(body.activityId, "Aktivitas") : null,
    activityName,
    description: readTrimmedString(body.description),
    priorityLabel: readTrimmedString(body.priorityLabel),
    month,
    year,
    startDate,
    endDate,
    activityType,
    targetUnit,
    targetValue,
    realizationValue,
    proof: readTrimmedString(body.proof),
    status,
    teamProvinsiId: body.teamProvinsiId ? readPositiveId(body.teamProvinsiId, "Tim provinsi") : null,
    teamKabupatenId: body.teamKabupatenId ? readPositiveId(body.teamKabupatenId, "Tim kabupaten") : null,
    active: readBoolean(body.active, true)
  };
};

const normalizeLogbookPayload = (body: Record<string, unknown>) => {
  const employeeId = readPositiveId(body.employeeId, "Pegawai");
  const entryDate = readDateString(body.entryDate || body.date, "Tanggal logbook");
  const workHours = readNonNegativeNumber(body.workHours || body.hours, "Jam kerja", 0);
  const dayStatus = ensureOneOf(
    readTrimmedString(body.dayStatus || "kerja").toLowerCase(),
    DAY_STATUS,
    "Status hari"
  );
  const summary = ensureRequired(
    readTrimmedString(body.summary),
    "Ringkasan logbook wajib diisi"
  );

  return {
    employeeId,
    assignmentId: body.assignmentId ? readPositiveId(body.assignmentId, "Penugasan") : null,
    entryDate,
    workHours,
    dayStatus,
    summary
  };
};

const ensureEmployeeExists = async (employeeId: number) => {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM pegawai WHERE id = ? LIMIT 1",
    [employeeId]
  );

  if (!rows.length) {
    fail("Pegawai tidak ditemukan", 404);
  }
};


let performanceSchemaReady: Promise<void> | null = null;

const ensurePerformanceSchema = async () => {
  if (performanceSchemaReady) return performanceSchemaReady;

  performanceSchemaReady = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tim_kinerja (
        id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        nama VARCHAR(150) NOT NULL,
        jenis VARCHAR(20) NOT NULL,
        aktif SMALLINT NOT NULL DEFAULT 1,
        dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_tim_kinerja_jenis_nama UNIQUE (jenis, nama)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS master_kegiatan_kinerja (
        id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        nama VARCHAR(180) NOT NULL,
        tipe_aktivitas VARCHAR(30) NOT NULL DEFAULT 'kegiatan',
        aktif SMALLINT NOT NULL DEFAULT 1,
        dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_master_kegiatan_kinerja_nama UNIQUE (nama)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS penugasan_kinerja (
        id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        pegawai_id INTEGER NOT NULL,
        tim_provinsi_id INTEGER DEFAULT NULL,
        tim_kabupaten_id INTEGER DEFAULT NULL,
        kegiatan_id INTEGER DEFAULT NULL,
        nama_aktivitas VARCHAR(200) NOT NULL,
        deskripsi TEXT DEFAULT NULL,
        label_prioritas VARCHAR(50) DEFAULT NULL,
        tahun INTEGER NOT NULL,
        bulan SMALLINT NOT NULL,
        tanggal_mulai DATE NOT NULL,
        tanggal_selesai DATE NOT NULL,
        tipe_aktivitas VARCHAR(30) NOT NULL DEFAULT 'kegiatan',
        satuan_target VARCHAR(60) NOT NULL,
        nilai_target NUMERIC(10,2) NOT NULL,
        nilai_realisasi NUMERIC(10,2) NOT NULL DEFAULT 0.00,
        bukti_realisasi TEXT DEFAULT NULL,
        status_submit VARCHAR(30) NOT NULL DEFAULT 'Belum Submit',
        aktif SMALLINT NOT NULL DEFAULT 1,
        dibuat_oleh_pegawai_id INTEGER DEFAULT NULL,
        dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS logbook_kinerja_harian (
        id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        pegawai_id INTEGER NOT NULL,
        penugasan_id INTEGER DEFAULT NULL,
        tanggal DATE NOT NULL,
        jam_kerja NUMERIC(4,2) NOT NULL DEFAULT 0.00,
        status_hari VARCHAR(20) NOT NULL DEFAULT 'kerja',
        ringkasan TEXT NOT NULL,
        dibuat_oleh_pegawai_id INTEGER DEFAULT NULL,
        dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_penugasan_kinerja_periode ON penugasan_kinerja (tahun, bulan, status_submit)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_penugasan_kinerja_pegawai ON penugasan_kinerja (pegawai_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_penugasan_kinerja_kegiatan ON penugasan_kinerja (kegiatan_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_penugasan_kinerja_tim_provinsi ON penugasan_kinerja (tim_provinsi_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_penugasan_kinerja_tim_kabupaten ON penugasan_kinerja (tim_kabupaten_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_logbook_kinerja_periode ON logbook_kinerja_harian (tanggal, pegawai_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_logbook_kinerja_penugasan ON logbook_kinerja_harian (penugasan_id)`);

    await pool.query(`
      INSERT INTO tim_kinerja (id, nama, jenis, aktif) VALUES
        (1, 'Tim Provinsi Statistik Produksi', 'provinsi', 1),
        (2, 'Tim Provinsi Neraca Wilayah', 'provinsi', 1),
        (3, 'Tim Kabupaten Luwu', 'kabupaten', 1),
        (4, 'Tim Kabupaten Belopa', 'kabupaten', 1)
      ON CONFLICT (jenis, nama) DO NOTHING
    `);

    await pool.query(`
      INSERT INTO master_kegiatan_kinerja (id, nama, tipe_aktivitas, aktif) VALUES
        (1, 'Persiapan Sensus Ekonomi 2026', 'kegiatan', 1),
        (2, 'IBS Tahunan', 'persentase', 1),
        (3, 'Survei Khusus Neraca Produksi', 'file', 1),
        (4, 'Pemutakhiran Tim Kegiatan', 'dokumen', 1),
        (5, 'Monitoring Lapangan', 'laporan', 1)
      ON CONFLICT (nama) DO NOTHING
    `);

    await pool.query(`
      INSERT INTO penugasan_kinerja
        (id, pegawai_id, tim_provinsi_id, tim_kabupaten_id, kegiatan_id, nama_aktivitas, deskripsi, label_prioritas, tahun, bulan, tanggal_mulai, tanggal_selesai, tipe_aktivitas, satuan_target, nilai_target, nilai_realisasi, bukti_realisasi, status_submit, aktif, dibuat_oleh_pegawai_id)
      VALUES
        (1, 3, 1, 3, 1, 'Persiapan Sensus Ekonomi 2026', 'Rapat koordinasi sensus ekonomi 2026', NULL, 2026, 4, '2026-04-01', '2026-04-30', 'kegiatan', 'kegiatan', 10, 10, 'Notulen rapat terlampir', 'Selesai', 1, 7),
        (2, 7, 1, 3, 2, 'IBS Tahunan', 'Updating direktori perusahaan awal (DPA)', 'Prioritas', 2026, 4, '2026-04-01', '2026-04-28', 'persentase', 'persentase', 60, 48, 'Draft unggah tersedia', 'Belum Submit', 1, 3),
        (3, 8, 2, 4, 3, 'Survei Khusus Neraca Produksi', 'Laporan progres pelaksanaan pendataan lengkap perguruan tinggi', 'Prioritas', 2026, 4, '2026-04-01', '2026-04-27', 'file', 'file', 1, 1, 'Draft reviu sudah ada', 'Belum Submit', 1, 3),
        (4, 9, 1, 4, 4, 'Pemutakhiran Tim Kegiatan', 'Verifikasi penugasan dan administrasi lapangan', NULL, 2026, 4, '2026-04-05', '2026-04-18', 'dokumen', 'dokumen', 12, 9, 'Bukti edit internal', 'Siap Submit', 1, 3),
        (5, 10, 2, 3, 5, 'Monitoring Lapangan', 'Rekap pemantauan lapangan mingguan', NULL, 2026, 4, '2026-04-02', '2026-04-20', 'laporan', 'laporan', 6, 5, 'Laporan sementara', 'Siap Submit', 1, 7)
      ON CONFLICT (id) DO NOTHING
    `);

    await pool.query(`
      INSERT INTO logbook_kinerja_harian
        (id, pegawai_id, penugasan_id, tanggal, jam_kerja, status_hari, ringkasan, dibuat_oleh_pegawai_id)
      VALUES
        (1, 3, 1, '2026-04-01', 5.50, 'kerja', 'Koordinasi awal sensus ekonomi dengan tim kabupaten.', 3),
        (2, 3, 1, '2026-04-02', 6.00, 'kerja', 'Penyusunan agenda rapat dan bahan paparan.', 3),
        (3, 7, 2, '2026-04-01', 3.00, 'kerja', 'Pemutakhiran daftar perusahaan IBS.', 7),
        (4, 7, 2, '2026-04-03', 4.50, 'kerja', 'Validasi progres lapangan IBS tahunan.', 7),
        (5, 8, 3, '2026-04-04', 7.00, 'kerja', 'Finalisasi laporan progres pendataan perguruan tinggi.', 8),
        (6, 8, NULL, '2026-04-05', 0.00, 'libur', 'Hari libur nasional.', 8),
        (7, 9, 4, '2026-04-06', 2.50, 'kerja', 'Verifikasi susunan tim kegiatan dan peran operator.', 9),
        (8, 9, NULL, '2026-04-07', 0.00, 'cuti', 'Cuti tahunan.', 9),
        (9, 10, 5, '2026-04-02', 4.00, 'kerja', 'Rekap monitoring lapangan minggu pertama.', 10),
        (10, 10, 5, '2026-04-03', 4.50, 'kerja', 'Pembenahan laporan monitoring lapangan.', 10)
      ON CONFLICT (id) DO NOTHING
    `);

    await pool.query(`SELECT setval(pg_get_serial_sequence('tim_kinerja','id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM tim_kinerja), 1), true)`);
    await pool.query(`SELECT setval(pg_get_serial_sequence('master_kegiatan_kinerja','id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM master_kegiatan_kinerja), 1), true)`);
    await pool.query(`SELECT setval(pg_get_serial_sequence('penugasan_kinerja','id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM penugasan_kinerja), 1), true)`);
    await pool.query(`SELECT setval(pg_get_serial_sequence('logbook_kinerja_harian','id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM logbook_kinerja_harian), 1), true)`);
  })().catch((error) => {
    performanceSchemaReady = null;
    throw error;
  });

  return performanceSchemaReady;
};

const ensureAssignmentExists = async (assignmentId: number) => {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM penugasan_kinerja WHERE id = ? LIMIT 1",
    [assignmentId]
  );

  if (!rows.length) {
    fail("Penugasan tidak ditemukan", 404);
  }
};

export const getPerformanceLookups = asyncHandler(async (_req, res) => {
  await ensurePerformanceSchema();
  const [provinsiRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, nama FROM tim_kinerja WHERE jenis = 'provinsi' AND aktif = 1 ORDER BY nama ASC`
  );
  const [kabupatenRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, nama FROM tim_kinerja WHERE jenis = 'kabupaten' AND aktif = 1 ORDER BY nama ASC`
  );
  const [activityRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, nama, tipe_aktivitas AS activityType FROM master_kegiatan_kinerja WHERE aktif = 1 ORDER BY nama ASC`
  );
  const [employeeRows] = await pool.query<RowDataPacket[]>(
    `SELECT e.id, e.nama_lengkap AS fullName, e.nip, COALESCE(j.nama, e.nama_jabatan) AS position
     FROM pegawai e
     LEFT JOIN jabatan j ON j.id = e.jabatan_id
     WHERE e.status_aktif = 'aktif'
     ORDER BY e.nama_lengkap ASC`
  );

  const currentYear = new Date().getFullYear();

  return sendSuccess(res, {
    teams: {
      provinsi: provinsiRows.map((row) => ({ id: Number(row.id), name: String(row.nama) })),
      kabupaten: kabupatenRows.map((row) => ({ id: Number(row.id), name: String(row.nama) }))
    },
    activities: activityRows.map((row) => ({
      id: Number(row.id),
      name: String(row.nama),
      activityType: String(row.activityType)
    })),
    employees: employeeRows.map((row) => ({
      id: Number(row.id),
      fullName: String(row.fullName),
      nip: String(row.nip),
      position: String(row.position || "")
    })),
    years: [currentYear - 1, currentYear, currentYear + 1],
    months: monthLabels.map((label, index) => ({ value: index + 1, label }))
  });
});

export const getAssignments = asyncHandler(async (req, res) => {
  await ensurePerformanceSchema();
  const requestedMonth = req.query.month ? readIntegerInRange(req.query.month, 1, 12, "Bulan") : 0;
  const requestedYear = req.query.year ? readIntegerInRange(req.query.year, 2020, 2100, "Tahun") : 0;
  const requestedEmployeeId = req.query.employeeId ? readPositiveId(req.query.employeeId, "Pegawai") : 0;
  const requestedTeamProvinsiId = req.query.teamProvinsiId ? readPositiveId(req.query.teamProvinsiId, "Tim provinsi") : 0;
  const requestedTeamKabupatenId = req.query.teamKabupatenId ? readPositiveId(req.query.teamKabupatenId, "Tim kabupaten") : 0;
  const requestedActivityId = req.query.activityId ? readPositiveId(req.query.activityId, "Aktivitas") : 0;
  const requestedStatus = readTrimmedString(req.query.status).trim();
  const requestedType = readTrimmedString(req.query.activityType).trim().toLowerCase();
  const search = readTrimmedString(req.query.search);
  const includeInactive = readBoolean(req.query.includeInactive, false);

  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (!includeInactive) {
    conditions.push("pk.aktif = 1");
  }
  if (requestedYear > 0) {
    conditions.push("pk.tahun = ?");
    params.push(requestedYear);
  }
  if (requestedMonth > 0) {
    conditions.push("pk.bulan = ?");
    params.push(requestedMonth);
  }
  if (requestedEmployeeId > 0) {
    conditions.push("pk.pegawai_id = ?");
    params.push(requestedEmployeeId);
  }
  if (requestedTeamProvinsiId > 0) {
    conditions.push("pk.tim_provinsi_id = ?");
    params.push(requestedTeamProvinsiId);
  }
  if (requestedTeamKabupatenId > 0) {
    conditions.push("pk.tim_kabupaten_id = ?");
    params.push(requestedTeamKabupatenId);
  }
  if (requestedActivityId > 0) {
    conditions.push("pk.kegiatan_id = ?");
    params.push(requestedActivityId);
  }
  if (requestedStatus && requestedStatus !== "all") {
    conditions.push("pk.status_submit = ?");
    params.push(requestedStatus);
  }
  if (requestedType && requestedType !== "all") {
    conditions.push("pk.tipe_aktivitas = ?");
    params.push(requestedType);
  }
  if (search) {
    conditions.push(`(
      e.nama_lengkap LIKE ?
      OR pk.nama_aktivitas LIKE ?
      OR pk.deskripsi LIKE ?
      OR COALESCE(mk.nama, '') LIKE ?
    )`);
    const keyword = `%${search}%`;
    params.push(keyword, keyword, keyword, keyword);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT pk.id,
            pk.pegawai_id AS employeeId,
            e.nama_lengkap AS assignee,
            pk.kegiatan_id AS activityId,
            COALESCE(mk.nama, pk.nama_aktivitas) AS activity,
            pk.nama_aktivitas AS activityName,
            pk.deskripsi AS description,
            pk.label_prioritas AS priorityLabel,
            pk.bulan AS month,
            pk.tahun AS year,
            DATE_FORMAT(pk.tanggal_mulai, '%Y-%m-%d') AS startDate,
            DATE_FORMAT(pk.tanggal_selesai, '%Y-%m-%d') AS endDate,
            pk.tipe_aktivitas AS activityType,
            pk.satuan_target AS targetUnit,
            pk.nilai_target AS targetValue,
            pk.nilai_realisasi AS realizationValue,
            pk.bukti_realisasi AS proof,
            pk.status_submit AS status,
            pk.tim_provinsi_id AS teamProvinsiId,
            tp.nama AS teamProvinsiName,
            pk.tim_kabupaten_id AS teamKabupatenId,
            tk.nama AS teamKabupatenName,
            pk.dibuat_pada AS createdAt,
            pk.diperbarui_pada AS updatedAt
     FROM penugasan_kinerja pk
     INNER JOIN pegawai e ON e.id = pk.pegawai_id
     LEFT JOIN master_kegiatan_kinerja mk ON mk.id = pk.kegiatan_id
     LEFT JOIN tim_kinerja tp ON tp.id = pk.tim_provinsi_id
     LEFT JOIN tim_kinerja tk ON tk.id = pk.tim_kabupaten_id
     ${whereClause}
     ORDER BY pk.tahun DESC, pk.bulan DESC, pk.tanggal_mulai ASC, e.nama_lengkap ASC`,
    params
  );

  return sendSuccess(res, {
    records: rows.map(buildAssignmentRecord)
  });
});

export const createAssignment = asyncHandler(async (req: AuthenticatedRequest, res) => {
  await ensurePerformanceSchema();
  const payload = normalizeAssignmentPayload(req.body || {});
  await ensureEmployeeExists(payload.employeeId);

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO penugasan_kinerja (
       pegawai_id,
       tim_provinsi_id,
       tim_kabupaten_id,
       kegiatan_id,
       nama_aktivitas,
       deskripsi,
       label_prioritas,
       tahun,
       bulan,
       tanggal_mulai,
       tanggal_selesai,
       tipe_aktivitas,
       satuan_target,
       nilai_target,
       nilai_realisasi,
       bukti_realisasi,
       status_submit,
       aktif,
       dibuat_oleh_pegawai_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.employeeId,
      payload.teamProvinsiId,
      payload.teamKabupatenId,
      payload.activityId,
      payload.activityName,
      payload.description || null,
      payload.priorityLabel || null,
      payload.year,
      payload.month,
      payload.startDate,
      payload.endDate,
      payload.activityType,
      payload.targetUnit,
      payload.targetValue,
      payload.realizationValue,
      payload.proof || null,
      payload.status,
      payload.active ? 1 : 0,
      req.user?.employeeId || null
    ]
  );

  return sendSuccess(res, { id: Number(result.insertId) }, "Penugasan berhasil disimpan", 201);
});

export const updateAssignment = asyncHandler(async (req, res) => {
  await ensurePerformanceSchema();
  const assignmentId = readPositiveId(req.params.id, "Penugasan");
  const payload = normalizeAssignmentPayload(req.body || {});
  await ensureAssignmentExists(assignmentId);
  await ensureEmployeeExists(payload.employeeId);

  await pool.query(
    `UPDATE penugasan_kinerja
     SET pegawai_id = ?,
         tim_provinsi_id = ?,
         tim_kabupaten_id = ?,
         kegiatan_id = ?,
         nama_aktivitas = ?,
         deskripsi = ?,
         label_prioritas = ?,
         tahun = ?,
         bulan = ?,
         tanggal_mulai = ?,
         tanggal_selesai = ?,
         tipe_aktivitas = ?,
         satuan_target = ?,
         nilai_target = ?,
         nilai_realisasi = ?,
         bukti_realisasi = ?,
         status_submit = ?,
         aktif = ?
     WHERE id = ?`,
    [
      payload.employeeId,
      payload.teamProvinsiId,
      payload.teamKabupatenId,
      payload.activityId,
      payload.activityName,
      payload.description || null,
      payload.priorityLabel || null,
      payload.year,
      payload.month,
      payload.startDate,
      payload.endDate,
      payload.activityType,
      payload.targetUnit,
      payload.targetValue,
      payload.realizationValue,
      payload.proof || null,
      payload.status,
      payload.active ? 1 : 0,
      assignmentId
    ]
  );

  return sendSuccess(res, null, "Penugasan berhasil diperbarui");
});

export const removeAssignment = asyncHandler(async (req, res) => {
  await ensurePerformanceSchema();
  const assignmentId = readPositiveId(req.params.id, "Penugasan");
  await ensureAssignmentExists(assignmentId);

  await pool.query(`DELETE FROM logbook_kinerja_harian WHERE penugasan_id = ?`, [assignmentId]);
  await pool.query(`DELETE FROM penugasan_kinerja WHERE id = ?`, [assignmentId]);

  return sendSuccess(res, null, "Penugasan berhasil dihapus");
});

export const updateAssignmentsStatus = asyncHandler(async (req, res) => {
  await ensurePerformanceSchema();
  const rawIds: unknown[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const ids = rawIds
    .map((value: unknown) => Number(value))
    .filter((value: number) => Number.isInteger(value) && value > 0);
  const status = ensureOneOf(
    readTrimmedString(req.body?.status),
    ASSIGNMENT_STATUS,
    "Status submit"
  );

  if (!ids.length) {
    fail("Pilih setidaknya satu penugasan", 400);
  }

  const placeholders = ids.map(() => "?").join(", ");
  await pool.query(
    `UPDATE penugasan_kinerja SET status_submit = ? WHERE id IN (${placeholders})`,
    [status, ...ids]
  );

  return sendSuccess(res, { ids, status }, "Status penugasan berhasil diperbarui");
});

export const getLogbookCalendar = asyncHandler(async (req: AuthenticatedRequest, res) => {
  await ensurePerformanceSchema();
  const year = req.query.year ? readIntegerInRange(req.query.year, 2020, 2100, "Tahun") : new Date().getFullYear();
  const month = req.query.month ? readIntegerInRange(req.query.month, 1, 12, "Bulan") : new Date().getMonth() + 1;
  const employeeId = req.query.employeeId
    ? readPositiveId(req.query.employeeId, "Pegawai")
    : req.user?.employeeId || 0;

  if (!employeeId) {
    fail("Pegawai tidak ditemukan untuk tampilan logbook", 400);
  }

  await ensureEmployeeExists(employeeId);

  const [employeeRows] = await pool.query<RowDataPacket[]>(
    `SELECT nama_lengkap AS fullName FROM pegawai WHERE id = ? LIMIT 1`,
    [employeeId]
  );

  const [entryRows] = await pool.query<RowDataPacket[]>(
    `SELECT lkh.id,
            lkh.penugasan_id AS assignmentId,
            DATE_FORMAT(lkh.tanggal, '%Y-%m-%d') AS entryDate,
            lkh.jam_kerja AS workHours,
            lkh.status_hari AS dayStatus,
            lkh.ringkasan AS summary,
            COALESCE(pk.nama_aktivitas, mk.nama) AS activityName,
            pk.status_submit AS assignmentStatus
     FROM logbook_kinerja_harian lkh
     LEFT JOIN penugasan_kinerja pk ON pk.id = lkh.penugasan_id
     LEFT JOIN master_kegiatan_kinerja mk ON mk.id = pk.kegiatan_id
     WHERE lkh.pegawai_id = ?
       AND YEAR(lkh.tanggal) = ?
       AND MONTH(lkh.tanggal) = ?
     ORDER BY lkh.tanggal ASC, lkh.dibuat_pada ASC`,
    [employeeId, year, month]
  );

  const entries = entryRows.map((row) => ({
    id: Number(row.id),
    assignmentId: row.assignmentId ? Number(row.assignmentId) : null,
    entryDate: String(row.entryDate),
    workHours: Number(row.workHours),
    dayStatus: String(row.dayStatus),
    summary: String(row.summary || ""),
    activityName: row.activityName ? String(row.activityName) : null,
    assignmentStatus: row.assignmentStatus ? String(row.assignmentStatus) : null
  }));

  const entryMap = new Map<string, typeof entries>();
  entries.forEach((entry) => {
    const list = entryMap.get(entry.entryDate) || [];
    list.push(entry);
    entryMap.set(entry.entryDate, list);
  });

  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const cursor = new Date(firstDay);
  cursor.setDate(cursor.getDate() - cursor.getDay());
  const endCursor = new Date(lastDay);
  endCursor.setDate(endCursor.getDate() + (6 - endCursor.getDay()));

  const weeks: any[] = [];
  while (cursor <= endCursor) {
    const days = [];
    for (let index = 0; index < 7; index += 1) {
      const isoDate = cursor.toISOString().slice(0, 10);
      const dayEntries = entryMap.get(isoDate) || [];
      days.push({
        date: isoDate,
        day: cursor.getDate(),
        muted: cursor.getMonth() !== month - 1,
        weekend: cursor.getDay() === 0 || cursor.getDay() === 6,
        current: isoDate === new Date().toISOString().slice(0, 10),
        entries: dayEntries
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(days);
  }

  return sendSuccess(res, {
    employeeId,
    employeeName: String(employeeRows[0]?.fullName || ""),
    year,
    month,
    monthLabel: toMonthLabel(month),
    weeks,
    entries
  });
});

export const saveLogbookEntry = asyncHandler(async (req: AuthenticatedRequest, res) => {
  await ensurePerformanceSchema();
  const payload = normalizeLogbookPayload(req.body || {});
  await ensureEmployeeExists(payload.employeeId);

  if (payload.assignmentId) {
    await ensureAssignmentExists(payload.assignmentId);
  }

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO logbook_kinerja_harian (
       pegawai_id,
       penugasan_id,
       tanggal,
       jam_kerja,
       status_hari,
       ringkasan,
       dibuat_oleh_pegawai_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.employeeId,
      payload.assignmentId,
      payload.entryDate,
      payload.workHours,
      payload.dayStatus,
      payload.summary,
      req.user?.employeeId || null
    ]
  );

  return sendSuccess(res, { id: Number(result.insertId) }, "Logbook berhasil disimpan", 201);
});

export const updateLogbookEntry = asyncHandler(async (req, res) => {
  await ensurePerformanceSchema();
  const logbookId = readPositiveId(req.params.id, "Logbook");
  const payload = normalizeLogbookPayload(req.body || {});
  await ensureEmployeeExists(payload.employeeId);

  const [existingRows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM logbook_kinerja_harian WHERE id = ? LIMIT 1`,
    [logbookId]
  );

  if (!existingRows.length) {
    fail("Catatan logbook tidak ditemukan", 404);
  }

  if (payload.assignmentId) {
    await ensureAssignmentExists(payload.assignmentId);
  }

  await pool.query(
    `UPDATE logbook_kinerja_harian
     SET pegawai_id = ?,
         penugasan_id = ?,
         tanggal = ?,
         jam_kerja = ?,
         status_hari = ?,
         ringkasan = ?
     WHERE id = ?`,
    [
      payload.employeeId,
      payload.assignmentId,
      payload.entryDate,
      payload.workHours,
      payload.dayStatus,
      payload.summary,
      logbookId
    ]
  );

  return sendSuccess(res, null, "Logbook berhasil diperbarui");
});

export const removeLogbookEntry = asyncHandler(async (req, res) => {
  await ensurePerformanceSchema();
  const logbookId = readPositiveId(req.params.id, "Logbook");
  const [result] = await pool.query<ResultSetHeader>(
    `DELETE FROM logbook_kinerja_harian WHERE id = ?`,
    [logbookId]
  );

  if (result.affectedRows < 1) {
    fail("Catatan logbook tidak ditemukan", 404);
  }

  return sendSuccess(res, null, "Logbook berhasil dihapus");
});

const buildMonitoringDayLabels = (year: number, month: number) => {
  const totalDays = new Date(year, month, 0).getDate();
  return Array.from({ length: Math.min(totalDays, 7) }, (_, index) => {
    const day = Math.min(7 - index, totalDays);
    return String(day).padStart(2, "0");
  });
};

const resolveAssignmentTone = (count: number) => {
  if (count <= 0) return "none";
  if (count <= 3) return "green-1";
  if (count <= 7) return "green-2";
  if (count <= 12) return "green-3";
  return "green-4";
};

const resolveLogbookTone = (hours: number, dayStatus: string | null) => {
  if (dayStatus === "libur" || dayStatus === "cuti") return "holiday";
  if (hours <= 0) return "none";
  if (hours <= 2) return "soft";
  if (hours <= 4) return "mid";
  if (hours <= 6) return "strong";
  return "max";
};

export const getMonitoringLogbook = asyncHandler(async (req, res) => {
  await ensurePerformanceSchema();
  const mode = ensureOneOf(
    readTrimmedString(req.query.mode || "logbook").toLowerCase(),
    ["logbook", "assignment"] as const,
    "Mode monitoring"
  );
  const year = req.query.year ? readIntegerInRange(req.query.year, 2020, 2100, "Tahun") : new Date().getFullYear();
  const month = req.query.month ? readIntegerInRange(req.query.month, 1, 12, "Bulan") : new Date().getMonth() + 1;

  const dayLabels = buildMonitoringDayLabels(year, month);
  const dayNumbers = dayLabels.map((value) => Number(value));

  const [employeeRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, nama_lengkap AS fullName
     FROM pegawai
     WHERE status_aktif = 'aktif'
     ORDER BY nama_lengkap ASC`
  );

  const [logRows] = await pool.query<RowDataPacket[]>(
    `SELECT pegawai_id AS employeeId,
            DAY(tanggal) AS dayNumber,
            ROUND(SUM(jam_kerja), 2) AS totalHours,
            MAX(status_hari) AS dayStatus
     FROM logbook_kinerja_harian
     WHERE YEAR(tanggal) = ? AND MONTH(tanggal) = ?
     GROUP BY pegawai_id, DAY(tanggal)
     ORDER BY DAY(tanggal) DESC`,
    [year, month]
  );

  const [assignmentRows] = await pool.query<RowDataPacket[]>(
    `SELECT pegawai_id AS employeeId,
            DAY(tanggal_mulai) AS dayNumber,
            COUNT(*) AS totalAssignments
     FROM penugasan_kinerja
     WHERE tahun = ? AND bulan = ? AND aktif = 1
     GROUP BY pegawai_id, DAY(tanggal_mulai)
     ORDER BY DAY(tanggal_mulai) DESC`,
    [year, month]
  );

  const logMap = new Map<string, { totalHours: number; dayStatus: string | null }>();
  logRows.forEach((row) => {
    logMap.set(`${row.employeeId}-${row.dayNumber}`, {
      totalHours: Number(row.totalHours || 0),
      dayStatus: row.dayStatus ? String(row.dayStatus) : null
    });
  });

  const assignmentMap = new Map<string, number>();
  assignmentRows.forEach((row) => {
    assignmentMap.set(`${row.employeeId}-${row.dayNumber}`, Number(row.totalAssignments || 0));
  });

  const employees = employeeRows.map((row) => {
    const employeeId = Number(row.id);
    const days = dayNumbers.map((dayNumber) => {
      if (mode === "assignment") {
        return resolveAssignmentTone(assignmentMap.get(`${employeeId}-${dayNumber}`) || 0);
      }

      const metrics = logMap.get(`${employeeId}-${dayNumber}`) || { totalHours: 0, dayStatus: null };
      return resolveLogbookTone(metrics.totalHours, metrics.dayStatus);
    });

    return {
      employeeId,
      name: String(row.fullName),
      days
    };
  });

  return sendSuccess(res, {
    mode,
    month,
    year,
    monthLabel: toMonthLabel(month),
    dayLabels,
    employees
  });
});

export const getMonitoringAssignment = asyncHandler(async (req, res) => {
  await ensurePerformanceSchema();
  const year = req.query.year ? readIntegerInRange(req.query.year, 2020, 2100, "Tahun") : new Date().getFullYear();
  const month = req.query.month && req.query.month !== "all" ? readIntegerInRange(req.query.month, 1, 12, "Bulan") : 0;
  const employeeId = req.query.employeeId && req.query.employeeId !== "all" ? readPositiveId(req.query.employeeId, "Pegawai") : 0;
  const activityId = req.query.activityId && req.query.activityId !== "all" ? readPositiveId(req.query.activityId, "Aktivitas") : 0;
  const search = readTrimmedString(req.query.search);

  const conditions = ["pk.tahun = ?", "pk.aktif = 1"];
  const params: Array<string | number> = [year];

  if (month > 0) {
    conditions.push("pk.bulan = ?");
    params.push(month);
  }

  if (employeeId > 0) {
    conditions.push("pk.pegawai_id = ?");
    params.push(employeeId);
  }

  if (activityId > 0) {
    conditions.push("pk.kegiatan_id = ?");
    params.push(activityId);
  }

  if (search) {
    conditions.push(`(
      e.nama_lengkap LIKE ?
      OR pk.nama_aktivitas LIKE ?
      OR COALESCE(mk.nama, '') LIKE ?
    )`);
    const keyword = `%${search}%`;
    params.push(keyword, keyword, keyword);
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT pk.id,
            e.nama_lengkap AS assignee,
            COALESCE(mk.nama, pk.nama_aktivitas) AS activity,
            pk.tipe_aktivitas AS activityType,
            DATE_FORMAT(pk.tanggal_selesai, '%d %M %Y') AS deadline,
            pk.nilai_target AS target,
            pk.nilai_realisasi AS realization,
            CASE WHEN pk.nilai_target > 0 THEN ROUND((pk.nilai_realisasi / pk.nilai_target) * 100, 2) ELSE 0 END AS percentage
     FROM penugasan_kinerja pk
     INNER JOIN pegawai e ON e.id = pk.pegawai_id
     LEFT JOIN master_kegiatan_kinerja mk ON mk.id = pk.kegiatan_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY pk.tanggal_selesai ASC, e.nama_lengkap ASC`,
    params
  );

  return sendSuccess(res, {
    records: rows.map((row) => ({
      id: Number(row.id),
      assignee: String(row.assignee),
      activity: String(row.activity),
      activityType: String(row.activityType),
      deadline: String(row.deadline),
      target: Number(row.target),
      realization: Number(row.realization),
      percentage: Number(row.percentage)
    }))
  });
});
