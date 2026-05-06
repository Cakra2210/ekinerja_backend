import { ResultSetHeader } from "mysql2/promise";
import { pool } from "../../config/database";
import { AuthenticatedRequest } from "../../middleware/auth.middleware";
import { asyncHandler, fail, sendSuccess } from "../../shared/http";
import { ensureOneOf, ensureRequired, readPositiveId, readTrimmedString } from "../../shared/validation";

let hrSchemaReady = false;

const PRIORITY_OPTIONS = ["rendah", "sedang", "tinggi"] as const;
const RECOMMENDATION_STATUS_OPTIONS = ["draft", "diajukan", "disetujui", "ditolak", "ditindaklanjuti"] as const;
const TALENT_CATEGORY_OPTIONS = ["unggul", "potensial", "siap_promosi"] as const;
const READINESS_OPTIONS = ["dasar", "menengah", "tinggi"] as const;
const TALENT_STATUS_OPTIONS = ["draft", "direkomendasikan", "ditetapkan", "arsip"] as const;

const readOptionalPositiveId = (value: unknown, fieldName: string) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return readPositiveId(value, fieldName);
};

const readOptionalText = (value: unknown) => {
  const normalized = readTrimmedString(value);
  return normalized || null;
};

const ensureHrSchema = async () => {
  if (hrSchemaReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_rekomendasi_penghargaan (
      id INT NOT NULL AUTO_INCREMENT,
      periode_id INT NOT NULL,
      pegawai_id INT NOT NULL,
      evaluasi_akhir_id INT NULL,
      jenis_penghargaan VARCHAR(150) NOT NULL,
      alasan TEXT NULL,
      prioritas ENUM('rendah','sedang','tinggi') NOT NULL DEFAULT 'sedang',
      status ENUM('draft','diajukan','disetujui','ditolak','ditindaklanjuti') NOT NULL DEFAULT 'draft',
      tindak_lanjut TEXT NULL,
      catatan TEXT NULL,
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_kinerja_reward_periode_pegawai (periode_id, pegawai_id),
      KEY idx_kinerja_reward_status (status),
      CONSTRAINT fk_kinerja_reward_periode FOREIGN KEY (periode_id) REFERENCES kinerja_periode (id) ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT fk_kinerja_reward_employee FOREIGN KEY (pegawai_id) REFERENCES pegawai (id) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT fk_kinerja_reward_final FOREIGN KEY (evaluasi_akhir_id) REFERENCES kinerja_evaluasi_akhir_tahun (id) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_rekomendasi_pembinaan (
      id INT NOT NULL AUTO_INCREMENT,
      periode_id INT NOT NULL,
      pegawai_id INT NOT NULL,
      evaluasi_akhir_id INT NULL,
      fokus_pembinaan VARCHAR(180) NOT NULL,
      alasan TEXT NULL,
      target_perbaikan TEXT NULL,
      rekomendasi_tindak_lanjut TEXT NULL,
      prioritas ENUM('rendah','sedang','tinggi') NOT NULL DEFAULT 'sedang',
      status ENUM('draft','diajukan','disetujui','ditolak','ditindaklanjuti') NOT NULL DEFAULT 'draft',
      catatan TEXT NULL,
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_kinerja_coaching_periode_pegawai (periode_id, pegawai_id),
      KEY idx_kinerja_coaching_status (status),
      CONSTRAINT fk_kinerja_coaching_periode FOREIGN KEY (periode_id) REFERENCES kinerja_periode (id) ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT fk_kinerja_coaching_employee FOREIGN KEY (pegawai_id) REFERENCES pegawai (id) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT fk_kinerja_coaching_final FOREIGN KEY (evaluasi_akhir_id) REFERENCES kinerja_evaluasi_akhir_tahun (id) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_rekomendasi_pelatihan (
      id INT NOT NULL AUTO_INCREMENT,
      periode_id INT NOT NULL,
      pegawai_id INT NOT NULL,
      evaluasi_akhir_id INT NULL,
      tema_pelatihan VARCHAR(180) NOT NULL,
      kompetensi_target VARCHAR(180) NULL,
      alasan TEXT NULL,
      prioritas ENUM('rendah','sedang','tinggi') NOT NULL DEFAULT 'sedang',
      status ENUM('draft','diajukan','disetujui','ditolak','ditindaklanjuti') NOT NULL DEFAULT 'draft',
      catatan TEXT NULL,
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_kinerja_training_periode_pegawai (periode_id, pegawai_id),
      KEY idx_kinerja_training_status (status),
      CONSTRAINT fk_kinerja_training_periode FOREIGN KEY (periode_id) REFERENCES kinerja_periode (id) ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT fk_kinerja_training_employee FOREIGN KEY (pegawai_id) REFERENCES pegawai (id) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT fk_kinerja_training_final FOREIGN KEY (evaluasi_akhir_id) REFERENCES kinerja_evaluasi_akhir_tahun (id) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kinerja_talent_pool (
      id INT NOT NULL AUTO_INCREMENT,
      periode_id INT NOT NULL,
      pegawai_id INT NOT NULL,
      evaluasi_akhir_id INT NULL,
      kategori_talenta ENUM('unggul','potensial','siap_promosi') NOT NULL DEFAULT 'potensial',
      readiness_level ENUM('dasar','menengah','tinggi') NOT NULL DEFAULT 'menengah',
      alasan TEXT NULL,
      status ENUM('draft','direkomendasikan','ditetapkan','arsip') NOT NULL DEFAULT 'draft',
      catatan TEXT NULL,
      dibuat_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diperbarui_pada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_kinerja_talent_pool_periode_pegawai (periode_id, pegawai_id),
      KEY idx_kinerja_talent_status (status),
      CONSTRAINT fk_kinerja_talent_periode FOREIGN KEY (periode_id) REFERENCES kinerja_periode (id) ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT fk_kinerja_talent_employee FOREIGN KEY (pegawai_id) REFERENCES pegawai (id) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT fk_kinerja_talent_final FOREIGN KEY (evaluasi_akhir_id) REFERENCES kinerja_evaluasi_akhir_tahun (id) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  hrSchemaReady = true;
};

const scoreToNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isHighPredicate = (value: string) => {
  const text = value.toLowerCase();
  return text.includes("sangat") || text.includes("unggul") || text.includes("istimewa") || text.includes("sangat baik");
};

const isLowPredicate = (value: string) => {
  const text = value.toLowerCase();
  return text.includes("kurang") || text.includes("rendah") || text.includes("butuh") || text.includes("perlu pembinaan");
};

const resolveTrainingTheme = (row: any) => {
  const iki = scoreToNumber(row.nilai_iki);
  const activity = scoreToNumber(row.nilai_aktivitas);
  const behavior = scoreToNumber(row.nilai_perilaku);
  const assignment = scoreToNumber(row.nilai_penugasan);

  const options = [
    { score: iki, theme: "Penguatan capaian indikator individu", competency: "Manajemen target dan hasil kerja" },
    { score: activity, theme: "Penguatan aktivitas dan dokumentasi kerja", competency: "Pencatatan aktivitas dan bukti dukung" },
    { score: behavior, theme: "Penguatan perilaku kerja", competency: "Kolaborasi, komunikasi, dan orientasi hasil" },
    { score: assignment, theme: "Penguatan penugasan dan ketepatan output", competency: "Perencanaan kerja dan ketepatan waktu" }
  ].filter((item) => item.score !== null) as { score: number; theme: string; competency: string }[];

  if (!options.length) {
    return {
      theme: "Penguatan kompetensi teknis statistik",
      competency: "Teknis statistik, pengolahan, dan analisis"
    };
  }

  const sorted = options.sort((a, b) => a.score - b.score);
  return {
    theme: sorted[0].theme,
    competency: sorted[0].competency
  };
};

const fetchFinalEvaluationRows = async (periodeId: number) => {
  const [rows] = await pool.query<any[]>(
    `SELECT fe.id,
            fe.periode_id,
            fe.pegawai_id,
            fe.nilai_iku,
            fe.nilai_iki,
            fe.nilai_penugasan,
            fe.nilai_aktivitas,
            fe.nilai_perilaku,
            fe.nilai_akhir,
            fe.predikat,
            fe.status,
            e.nama_lengkap AS employeeName
     FROM kinerja_evaluasi_akhir_tahun fe
     INNER JOIN pegawai e ON e.id = fe.pegawai_id
     WHERE fe.periode_id = ?
       AND fe.status IN ('reviewed','calibrated','finalized')`,
    [periodeId]
  );

  return rows;
};

const listRewards = async (req: AuthenticatedRequest, res: any) => {
  await ensureHrSchema();

  const periodeId = readOptionalPositiveId(req.query.periodeId, "Periode");
  const status = readTrimmedString(req.query.status);
  const params: any[] = [];
  const conditions: string[] = [];

  if (periodeId) {
    conditions.push("rr.periode_id = ?");
    params.push(periodeId);
  }

  if (status) {
    conditions.push("rr.status = ?");
    params.push(status);
  }

  const [rows] = await pool.query<any[]>(
    `SELECT rr.id,
            rr.periode_id AS periodeId,
            CONCAT(kp.tahun, ' - ', kp.nama_periode) AS periodeName,
            rr.pegawai_id AS employeeId,
            e.nama_lengkap AS employeeName,
            rr.evaluasi_akhir_id AS finalEvaluationId,
            rr.jenis_penghargaan AS rewardType,
            rr.alasan AS reason,
            rr.prioritas AS priority,
            rr.status,
            rr.tindak_lanjut AS followUpNote,
            rr.catatan AS note,
            rr.dibuat_pada AS createdAt,
            rr.diperbarui_pada AS updatedAt,
            fe.nilai_akhir AS finalScore,
            fe.predikat AS predicate
     FROM kinerja_rekomendasi_penghargaan rr
     INNER JOIN kinerja_periode kp ON kp.id = rr.periode_id
     INNER JOIN pegawai e ON e.id = rr.pegawai_id
     LEFT JOIN kinerja_evaluasi_akhir_tahun fe ON fe.id = rr.evaluasi_akhir_id
     ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY rr.diperbarui_pada DESC, rr.id DESC`,
    params
  );

  return sendSuccess(res, rows);
};

const createReward = async (req: AuthenticatedRequest, res: any) => {
  await ensureHrSchema();
  const periodeId = readPositiveId(req.body?.periodeId, "Periode");
  const employeeId = readPositiveId(req.body?.employeeId, "Pegawai");
  const finalEvaluationId = readOptionalPositiveId(req.body?.finalEvaluationId, "Evaluasi akhir");
  const rewardType = ensureRequired(readTrimmedString(req.body?.rewardType), "Jenis penghargaan wajib diisi");
  const reason = readOptionalText(req.body?.reason);
  const priority = ensureOneOf(readTrimmedString(req.body?.priority) || "sedang", PRIORITY_OPTIONS, "Prioritas");
  const status = ensureOneOf(readTrimmedString(req.body?.status) || "draft", RECOMMENDATION_STATUS_OPTIONS, "Status");
  const followUpNote = readOptionalText(req.body?.followUpNote);
  const note = readOptionalText(req.body?.note);

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO kinerja_rekomendasi_penghargaan
      (periode_id, pegawai_id, evaluasi_akhir_id, jenis_penghargaan, alasan, prioritas, status, tindak_lanjut, catatan)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [periodeId, employeeId, finalEvaluationId, rewardType, reason, priority, status, followUpNote, note]
  );

  return sendSuccess(res, { id: result.insertId }, "Rekomendasi penghargaan berhasil ditambahkan", 201);
};

const updateReward = async (req: AuthenticatedRequest, res: any) => {
  await ensureHrSchema();
  const id = readPositiveId(req.params.id, "Rekomendasi penghargaan");
  const periodeId = readPositiveId(req.body?.periodeId, "Periode");
  const employeeId = readPositiveId(req.body?.employeeId, "Pegawai");
  const finalEvaluationId = readOptionalPositiveId(req.body?.finalEvaluationId, "Evaluasi akhir");
  const rewardType = ensureRequired(readTrimmedString(req.body?.rewardType), "Jenis penghargaan wajib diisi");
  const reason = readOptionalText(req.body?.reason);
  const priority = ensureOneOf(readTrimmedString(req.body?.priority) || "sedang", PRIORITY_OPTIONS, "Prioritas");
  const status = ensureOneOf(readTrimmedString(req.body?.status) || "draft", RECOMMENDATION_STATUS_OPTIONS, "Status");
  const followUpNote = readOptionalText(req.body?.followUpNote);
  const note = readOptionalText(req.body?.note);

  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE kinerja_rekomendasi_penghargaan
     SET periode_id = ?, pegawai_id = ?, evaluasi_akhir_id = ?, jenis_penghargaan = ?, alasan = ?, prioritas = ?, status = ?, tindak_lanjut = ?, catatan = ?
     WHERE id = ?`,
    [periodeId, employeeId, finalEvaluationId, rewardType, reason, priority, status, followUpNote, note, id]
  );

  if (!result.affectedRows) fail("Rekomendasi penghargaan tidak ditemukan", 404);
  return sendSuccess(res, null, "Rekomendasi penghargaan berhasil diperbarui");
};

const generateRewards = async (req: AuthenticatedRequest, res: any) => {
  await ensureHrSchema();
  const periodeId = readPositiveId(req.body?.periodeId, "Periode");
  const rows = await fetchFinalEvaluationRows(periodeId);
  let processed = 0;

  for (const row of rows) {
    const finalScore = scoreToNumber(row.nilai_akhir) ?? 0;
    const predicate = String(row.predikat || "");
    if (finalScore < 90 && !isHighPredicate(predicate)) continue;

    await pool.query(
      `INSERT INTO kinerja_rekomendasi_penghargaan
        (periode_id, pegawai_id, evaluasi_akhir_id, jenis_penghargaan, alasan, prioritas, status, tindak_lanjut, catatan)
       VALUES (?, ?, ?, ?, ?, 'tinggi', 'diajukan', NULL, ?)
       ON DUPLICATE KEY UPDATE
         evaluasi_akhir_id = VALUES(evaluasi_akhir_id),
         jenis_penghargaan = VALUES(jenis_penghargaan),
         alasan = VALUES(alasan),
         prioritas = VALUES(prioritas),
         catatan = VALUES(catatan),
         diperbarui_pada = CURRENT_TIMESTAMP`,
      [
        periodeId,
        Number(row.pegawai_id),
        Number(row.id),
        finalScore >= 95 ? "Pegawai Kinerja Unggul" : "Pegawai Berprestasi",
        `Nilai akhir ${finalScore.toFixed(2)} dengan predikat ${predicate || "baik"}.`,
        `Dihasilkan otomatis dari evaluasi akhir tahun untuk ${row.employeeName || "pegawai"}.`
      ]
    );
    processed += 1;
  }

  return sendSuccess(res, { processed }, "Rekomendasi penghargaan otomatis berhasil dibuat");
};

const listCoachings = async (req: AuthenticatedRequest, res: any) => {
  await ensureHrSchema();
  const periodeId = readOptionalPositiveId(req.query.periodeId, "Periode");
  const status = readTrimmedString(req.query.status);
  const params: any[] = [];
  const conditions: string[] = [];
  if (periodeId) { conditions.push("rc.periode_id = ?"); params.push(periodeId); }
  if (status) { conditions.push("rc.status = ?"); params.push(status); }
  const [rows] = await pool.query<any[]>(
    `SELECT rc.id,
            rc.periode_id AS periodeId,
            CONCAT(kp.tahun, ' - ', kp.nama_periode) AS periodeName,
            rc.pegawai_id AS employeeId,
            e.nama_lengkap AS employeeName,
            rc.evaluasi_akhir_id AS finalEvaluationId,
            rc.fokus_pembinaan AS coachingFocus,
            rc.alasan AS reason,
            rc.target_perbaikan AS improvementTarget,
            rc.rekomendasi_tindak_lanjut AS followUpRecommendation,
            rc.prioritas AS priority,
            rc.status,
            rc.catatan AS note,
            rc.dibuat_pada AS createdAt,
            rc.diperbarui_pada AS updatedAt,
            fe.nilai_akhir AS finalScore,
            fe.predikat AS predicate
     FROM kinerja_rekomendasi_pembinaan rc
     INNER JOIN kinerja_periode kp ON kp.id = rc.periode_id
     INNER JOIN pegawai e ON e.id = rc.pegawai_id
     LEFT JOIN kinerja_evaluasi_akhir_tahun fe ON fe.id = rc.evaluasi_akhir_id
     ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY rc.diperbarui_pada DESC, rc.id DESC`, params
  );
  return sendSuccess(res, rows);
};

const createCoaching = async (req: AuthenticatedRequest, res: any) => {
  await ensureHrSchema();
  const periodeId = readPositiveId(req.body?.periodeId, "Periode");
  const employeeId = readPositiveId(req.body?.employeeId, "Pegawai");
  const finalEvaluationId = readOptionalPositiveId(req.body?.finalEvaluationId, "Evaluasi akhir");
  const coachingFocus = ensureRequired(readTrimmedString(req.body?.coachingFocus), "Fokus pembinaan wajib diisi");
  const reason = readOptionalText(req.body?.reason);
  const improvementTarget = readOptionalText(req.body?.improvementTarget);
  const followUpRecommendation = readOptionalText(req.body?.followUpRecommendation);
  const priority = ensureOneOf(readTrimmedString(req.body?.priority) || "sedang", PRIORITY_OPTIONS, "Prioritas");
  const status = ensureOneOf(readTrimmedString(req.body?.status) || "draft", RECOMMENDATION_STATUS_OPTIONS, "Status");
  const note = readOptionalText(req.body?.note);
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO kinerja_rekomendasi_pembinaan
      (periode_id, pegawai_id, evaluasi_akhir_id, fokus_pembinaan, alasan, target_perbaikan, rekomendasi_tindak_lanjut, prioritas, status, catatan)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [periodeId, employeeId, finalEvaluationId, coachingFocus, reason, improvementTarget, followUpRecommendation, priority, status, note]
  );
  return sendSuccess(res, { id: result.insertId }, "Rekomendasi pembinaan berhasil ditambahkan", 201);
};

const updateCoaching = async (req: AuthenticatedRequest, res: any) => {
  await ensureHrSchema();
  const id = readPositiveId(req.params.id, "Rekomendasi pembinaan");
  const periodeId = readPositiveId(req.body?.periodeId, "Periode");
  const employeeId = readPositiveId(req.body?.employeeId, "Pegawai");
  const finalEvaluationId = readOptionalPositiveId(req.body?.finalEvaluationId, "Evaluasi akhir");
  const coachingFocus = ensureRequired(readTrimmedString(req.body?.coachingFocus), "Fokus pembinaan wajib diisi");
  const reason = readOptionalText(req.body?.reason);
  const improvementTarget = readOptionalText(req.body?.improvementTarget);
  const followUpRecommendation = readOptionalText(req.body?.followUpRecommendation);
  const priority = ensureOneOf(readTrimmedString(req.body?.priority) || "sedang", PRIORITY_OPTIONS, "Prioritas");
  const status = ensureOneOf(readTrimmedString(req.body?.status) || "draft", RECOMMENDATION_STATUS_OPTIONS, "Status");
  const note = readOptionalText(req.body?.note);
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE kinerja_rekomendasi_pembinaan
     SET periode_id = ?, pegawai_id = ?, evaluasi_akhir_id = ?, fokus_pembinaan = ?, alasan = ?, target_perbaikan = ?, rekomendasi_tindak_lanjut = ?, prioritas = ?, status = ?, catatan = ?
     WHERE id = ?`,
    [periodeId, employeeId, finalEvaluationId, coachingFocus, reason, improvementTarget, followUpRecommendation, priority, status, note, id]
  );
  if (!result.affectedRows) fail("Rekomendasi pembinaan tidak ditemukan", 404);
  return sendSuccess(res, null, "Rekomendasi pembinaan berhasil diperbarui");
};

const generateCoachings = async (req: AuthenticatedRequest, res: any) => {
  await ensureHrSchema();
  const periodeId = readPositiveId(req.body?.periodeId, "Periode");
  const rows = await fetchFinalEvaluationRows(periodeId);
  let processed = 0;
  for (const row of rows) {
    const finalScore = scoreToNumber(row.nilai_akhir) ?? 0;
    const predicate = String(row.predikat || "");
    if (finalScore >= 75 && !isLowPredicate(predicate)) continue;

    await pool.query(
      `INSERT INTO kinerja_rekomendasi_pembinaan
        (periode_id, pegawai_id, evaluasi_akhir_id, fokus_pembinaan, alasan, target_perbaikan, rekomendasi_tindak_lanjut, prioritas, status, catatan)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'tinggi', 'diajukan', ?)
       ON DUPLICATE KEY UPDATE
         evaluasi_akhir_id = VALUES(evaluasi_akhir_id),
         fokus_pembinaan = VALUES(fokus_pembinaan),
         alasan = VALUES(alasan),
         target_perbaikan = VALUES(target_perbaikan),
         rekomendasi_tindak_lanjut = VALUES(rekomendasi_tindak_lanjut),
         prioritas = VALUES(prioritas),
         catatan = VALUES(catatan),
         diperbarui_pada = CURRENT_TIMESTAMP`,
      [
        periodeId,
        Number(row.pegawai_id),
        Number(row.id),
        "Peningkatan capaian target dan tindak lanjut kerja",
        `Nilai akhir ${finalScore.toFixed(2)} dengan predikat ${predicate || "belum optimal"}.`,
        "Perbaikan disiplin tindak lanjut, ketepatan waktu, dan kualitas hasil kerja.",
        "Lakukan pembinaan berkala minimal bulanan dan evaluasi progres per triwulan.",
        `Dihasilkan otomatis dari evaluasi akhir tahun untuk ${row.employeeName || "pegawai"}.`
      ]
    );
    processed += 1;
  }
  return sendSuccess(res, { processed }, "Rekomendasi pembinaan otomatis berhasil dibuat");
};

const listTrainings = async (req: AuthenticatedRequest, res: any) => {
  await ensureHrSchema();
  const periodeId = readOptionalPositiveId(req.query.periodeId, "Periode");
  const status = readTrimmedString(req.query.status);
  const params: any[] = [];
  const conditions: string[] = [];
  if (periodeId) { conditions.push("rt.periode_id = ?"); params.push(periodeId); }
  if (status) { conditions.push("rt.status = ?"); params.push(status); }
  const [rows] = await pool.query<any[]>(
    `SELECT rt.id,
            rt.periode_id AS periodeId,
            CONCAT(kp.tahun, ' - ', kp.nama_periode) AS periodeName,
            rt.pegawai_id AS employeeId,
            e.nama_lengkap AS employeeName,
            rt.evaluasi_akhir_id AS finalEvaluationId,
            rt.tema_pelatihan AS trainingTheme,
            rt.kompetensi_target AS targetCompetency,
            rt.alasan AS reason,
            rt.prioritas AS priority,
            rt.status,
            rt.catatan AS note,
            rt.dibuat_pada AS createdAt,
            rt.diperbarui_pada AS updatedAt,
            fe.nilai_akhir AS finalScore,
            fe.predikat AS predicate
     FROM kinerja_rekomendasi_pelatihan rt
     INNER JOIN kinerja_periode kp ON kp.id = rt.periode_id
     INNER JOIN pegawai e ON e.id = rt.pegawai_id
     LEFT JOIN kinerja_evaluasi_akhir_tahun fe ON fe.id = rt.evaluasi_akhir_id
     ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY rt.diperbarui_pada DESC, rt.id DESC`, params
  );
  return sendSuccess(res, rows);
};

const createTraining = async (req: AuthenticatedRequest, res: any) => {
  await ensureHrSchema();
  const periodeId = readPositiveId(req.body?.periodeId, "Periode");
  const employeeId = readPositiveId(req.body?.employeeId, "Pegawai");
  const finalEvaluationId = readOptionalPositiveId(req.body?.finalEvaluationId, "Evaluasi akhir");
  const trainingTheme = ensureRequired(readTrimmedString(req.body?.trainingTheme), "Tema pelatihan wajib diisi");
  const targetCompetency = readOptionalText(req.body?.targetCompetency);
  const reason = readOptionalText(req.body?.reason);
  const priority = ensureOneOf(readTrimmedString(req.body?.priority) || "sedang", PRIORITY_OPTIONS, "Prioritas");
  const status = ensureOneOf(readTrimmedString(req.body?.status) || "draft", RECOMMENDATION_STATUS_OPTIONS, "Status");
  const note = readOptionalText(req.body?.note);
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO kinerja_rekomendasi_pelatihan
      (periode_id, pegawai_id, evaluasi_akhir_id, tema_pelatihan, kompetensi_target, alasan, prioritas, status, catatan)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [periodeId, employeeId, finalEvaluationId, trainingTheme, targetCompetency, reason, priority, status, note]
  );
  return sendSuccess(res, { id: result.insertId }, "Rekomendasi pelatihan berhasil ditambahkan", 201);
};

const updateTraining = async (req: AuthenticatedRequest, res: any) => {
  await ensureHrSchema();
  const id = readPositiveId(req.params.id, "Rekomendasi pelatihan");
  const periodeId = readPositiveId(req.body?.periodeId, "Periode");
  const employeeId = readPositiveId(req.body?.employeeId, "Pegawai");
  const finalEvaluationId = readOptionalPositiveId(req.body?.finalEvaluationId, "Evaluasi akhir");
  const trainingTheme = ensureRequired(readTrimmedString(req.body?.trainingTheme), "Tema pelatihan wajib diisi");
  const targetCompetency = readOptionalText(req.body?.targetCompetency);
  const reason = readOptionalText(req.body?.reason);
  const priority = ensureOneOf(readTrimmedString(req.body?.priority) || "sedang", PRIORITY_OPTIONS, "Prioritas");
  const status = ensureOneOf(readTrimmedString(req.body?.status) || "draft", RECOMMENDATION_STATUS_OPTIONS, "Status");
  const note = readOptionalText(req.body?.note);
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE kinerja_rekomendasi_pelatihan
     SET periode_id = ?, pegawai_id = ?, evaluasi_akhir_id = ?, tema_pelatihan = ?, kompetensi_target = ?, alasan = ?, prioritas = ?, status = ?, catatan = ?
     WHERE id = ?`,
    [periodeId, employeeId, finalEvaluationId, trainingTheme, targetCompetency, reason, priority, status, note, id]
  );
  if (!result.affectedRows) fail("Rekomendasi pelatihan tidak ditemukan", 404);
  return sendSuccess(res, null, "Rekomendasi pelatihan berhasil diperbarui");
};

const generateTrainings = async (req: AuthenticatedRequest, res: any) => {
  await ensureHrSchema();
  const periodeId = readPositiveId(req.body?.periodeId, "Periode");
  const rows = await fetchFinalEvaluationRows(periodeId);
  let processed = 0;
  for (const row of rows) {
    const finalScore = scoreToNumber(row.nilai_akhir) ?? 0;
    if (finalScore < 75 || finalScore >= 90) continue;

    const recommendation = resolveTrainingTheme(row);

    await pool.query(
      `INSERT INTO kinerja_rekomendasi_pelatihan
        (periode_id, pegawai_id, evaluasi_akhir_id, tema_pelatihan, kompetensi_target, alasan, prioritas, status, catatan)
       VALUES (?, ?, ?, ?, ?, ?, 'sedang', 'diajukan', ?)
       ON DUPLICATE KEY UPDATE
         evaluasi_akhir_id = VALUES(evaluasi_akhir_id),
         tema_pelatihan = VALUES(tema_pelatihan),
         kompetensi_target = VALUES(kompetensi_target),
         alasan = VALUES(alasan),
         prioritas = VALUES(prioritas),
         catatan = VALUES(catatan),
         diperbarui_pada = CURRENT_TIMESTAMP`,
      [
        periodeId,
        Number(row.pegawai_id),
        Number(row.id),
        recommendation.theme,
        recommendation.competency,
        `Nilai akhir ${finalScore.toFixed(2)} menunjukkan kebutuhan penguatan kompetensi terarah.`,
        `Dihasilkan otomatis dari evaluasi akhir tahun untuk ${row.employeeName || "pegawai"}.`
      ]
    );
    processed += 1;
  }
  return sendSuccess(res, { processed }, "Rekomendasi pelatihan otomatis berhasil dibuat");
};

const listTalentPools = async (req: AuthenticatedRequest, res: any) => {
  await ensureHrSchema();
  const periodeId = readOptionalPositiveId(req.query.periodeId, "Periode");
  const status = readTrimmedString(req.query.status);
  const params: any[] = [];
  const conditions: string[] = [];
  if (periodeId) { conditions.push("tp.periode_id = ?"); params.push(periodeId); }
  if (status) { conditions.push("tp.status = ?"); params.push(status); }
  const [rows] = await pool.query<any[]>(
    `SELECT tp.id,
            tp.periode_id AS periodeId,
            CONCAT(kp.tahun, ' - ', kp.nama_periode) AS periodeName,
            tp.pegawai_id AS employeeId,
            e.nama_lengkap AS employeeName,
            tp.evaluasi_akhir_id AS finalEvaluationId,
            tp.kategori_talenta AS talentCategory,
            tp.readiness_level AS readinessLevel,
            tp.alasan AS reason,
            tp.status,
            tp.catatan AS note,
            tp.dibuat_pada AS createdAt,
            tp.diperbarui_pada AS updatedAt,
            fe.nilai_akhir AS finalScore,
            fe.predikat AS predicate
     FROM kinerja_talent_pool tp
     INNER JOIN kinerja_periode kp ON kp.id = tp.periode_id
     INNER JOIN pegawai e ON e.id = tp.pegawai_id
     LEFT JOIN kinerja_evaluasi_akhir_tahun fe ON fe.id = tp.evaluasi_akhir_id
     ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY tp.diperbarui_pada DESC, tp.id DESC`, params
  );
  return sendSuccess(res, rows);
};

const createTalentPool = async (req: AuthenticatedRequest, res: any) => {
  await ensureHrSchema();
  const periodeId = readPositiveId(req.body?.periodeId, "Periode");
  const employeeId = readPositiveId(req.body?.employeeId, "Pegawai");
  const finalEvaluationId = readOptionalPositiveId(req.body?.finalEvaluationId, "Evaluasi akhir");
  const talentCategory = ensureOneOf(readTrimmedString(req.body?.talentCategory) || "potensial", TALENT_CATEGORY_OPTIONS, "Kategori talenta");
  const readinessLevel = ensureOneOf(readTrimmedString(req.body?.readinessLevel) || "menengah", READINESS_OPTIONS, "Level kesiapan");
  const reason = readOptionalText(req.body?.reason);
  const status = ensureOneOf(readTrimmedString(req.body?.status) || "draft", TALENT_STATUS_OPTIONS, "Status");
  const note = readOptionalText(req.body?.note);
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO kinerja_talent_pool
      (periode_id, pegawai_id, evaluasi_akhir_id, kategori_talenta, readiness_level, alasan, status, catatan)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [periodeId, employeeId, finalEvaluationId, talentCategory, readinessLevel, reason, status, note]
  );
  return sendSuccess(res, { id: result.insertId }, "Talent pool berhasil ditambahkan", 201);
};

const updateTalentPool = async (req: AuthenticatedRequest, res: any) => {
  await ensureHrSchema();
  const id = readPositiveId(req.params.id, "Talent pool");
  const periodeId = readPositiveId(req.body?.periodeId, "Periode");
  const employeeId = readPositiveId(req.body?.employeeId, "Pegawai");
  const finalEvaluationId = readOptionalPositiveId(req.body?.finalEvaluationId, "Evaluasi akhir");
  const talentCategory = ensureOneOf(readTrimmedString(req.body?.talentCategory) || "potensial", TALENT_CATEGORY_OPTIONS, "Kategori talenta");
  const readinessLevel = ensureOneOf(readTrimmedString(req.body?.readinessLevel) || "menengah", READINESS_OPTIONS, "Level kesiapan");
  const reason = readOptionalText(req.body?.reason);
  const status = ensureOneOf(readTrimmedString(req.body?.status) || "draft", TALENT_STATUS_OPTIONS, "Status");
  const note = readOptionalText(req.body?.note);
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE kinerja_talent_pool
     SET periode_id = ?, pegawai_id = ?, evaluasi_akhir_id = ?, kategori_talenta = ?, readiness_level = ?, alasan = ?, status = ?, catatan = ?
     WHERE id = ?`,
    [periodeId, employeeId, finalEvaluationId, talentCategory, readinessLevel, reason, status, note, id]
  );
  if (!result.affectedRows) fail("Talent pool tidak ditemukan", 404);
  return sendSuccess(res, null, "Talent pool berhasil diperbarui");
};

const generateTalentPool = async (req: AuthenticatedRequest, res: any) => {
  await ensureHrSchema();
  const periodeId = readPositiveId(req.body?.periodeId, "Periode");
  const rows = await fetchFinalEvaluationRows(periodeId);
  let processed = 0;
  for (const row of rows) {
    const finalScore = scoreToNumber(row.nilai_akhir) ?? 0;
    const predicate = String(row.predikat || "");
    if (finalScore < 88 && !isHighPredicate(predicate)) continue;

    const talentCategory = finalScore >= 95 ? "unggul" : finalScore >= 92 ? "siap_promosi" : "potensial";
    const readinessLevel = finalScore >= 95 ? "tinggi" : "menengah";

    await pool.query(
      `INSERT INTO kinerja_talent_pool
        (periode_id, pegawai_id, evaluasi_akhir_id, kategori_talenta, readiness_level, alasan, status, catatan)
       VALUES (?, ?, ?, ?, ?, ?, 'direkomendasikan', ?)
       ON DUPLICATE KEY UPDATE
         evaluasi_akhir_id = VALUES(evaluasi_akhir_id),
         kategori_talenta = VALUES(kategori_talenta),
         readiness_level = VALUES(readiness_level),
         alasan = VALUES(alasan),
         status = VALUES(status),
         catatan = VALUES(catatan),
         diperbarui_pada = CURRENT_TIMESTAMP`,
      [
        periodeId,
        Number(row.pegawai_id),
        Number(row.id),
        talentCategory,
        readinessLevel,
        `Nilai akhir ${finalScore.toFixed(2)} dengan predikat ${predicate || "baik"} menunjukkan potensi pengembangan lanjutan.`,
        `Dihasilkan otomatis dari evaluasi akhir tahun untuk ${row.employeeName || "pegawai"}.`
      ]
    );
    processed += 1;
  }
  return sendSuccess(res, { processed }, "Talent pool otomatis berhasil dibuat");
};

export const getKinerjaRewardRecommendations = asyncHandler(async (req, res) => listRewards(req, res));
export const createKinerjaRewardRecommendation = asyncHandler(async (req, res) => createReward(req, res));
export const updateKinerjaRewardRecommendation = asyncHandler(async (req, res) => updateReward(req, res));
export const generateKinerjaRewardRecommendations = asyncHandler(async (req, res) => generateRewards(req, res));

export const getKinerjaCoachingRecommendations = asyncHandler(async (req, res) => listCoachings(req, res));
export const createKinerjaCoachingRecommendation = asyncHandler(async (req, res) => createCoaching(req, res));
export const updateKinerjaCoachingRecommendation = asyncHandler(async (req, res) => updateCoaching(req, res));
export const generateKinerjaCoachingRecommendations = asyncHandler(async (req, res) => generateCoachings(req, res));

export const getKinerjaTrainingRecommendations = asyncHandler(async (req, res) => listTrainings(req, res));
export const createKinerjaTrainingRecommendation = asyncHandler(async (req, res) => createTraining(req, res));
export const updateKinerjaTrainingRecommendation = asyncHandler(async (req, res) => updateTraining(req, res));
export const generateKinerjaTrainingRecommendations = asyncHandler(async (req, res) => generateTrainings(req, res));

export const getKinerjaTalentPools = asyncHandler(async (req, res) => listTalentPools(req, res));
export const createKinerjaTalentPool = asyncHandler(async (req, res) => createTalentPool(req, res));
export const updateKinerjaTalentPool = asyncHandler(async (req, res) => updateTalentPool(req, res));
export const generateKinerjaTalentPools = asyncHandler(async (req, res) => generateTalentPool(req, res));
