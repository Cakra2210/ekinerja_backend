import { readTrimmedString } from "../../shared/validation";

export type ActivityTimerStatus = "berjalan" | "jeda" | "selesai";

export const normalizeActivityStatusValue = (value: unknown) => {
  const normalized = readTrimmedString(value).toLowerCase();
  if (normalized === "dijeda" || normalized === "paused") return "jeda";
  if (normalized === "running") return "berjalan";
  if (normalized === "done" || normalized === "completed" || normalized === "finished") return "selesai";
  return normalized;
};

export const activityStatusSql = (alias = "l") => `
  COALESCE(
    ${alias}.status_aktivitas,
    CASE
      WHEN ${alias}.status = 'dijeda' THEN 'jeda'
      WHEN ${alias}.status IN ('berjalan', 'jeda', 'selesai') THEN ${alias}.status
      ELSE NULL
    END
  )
`;

export const getTimerDurationSecondsSql = (alias = "l") => `
  CASE
    WHEN ${alias}.started_at IS NULL THEN COALESCE(${alias}.durasi_menit, 0) * 60
    ELSE GREATEST(
      0,
      TIMESTAMPDIFF(
        SECOND,
        ${alias}.started_at,
        CASE
          WHEN ${activityStatusSql(alias)} = 'berjalan' THEN NOW()
          WHEN ${activityStatusSql(alias)} = 'jeda' THEN COALESCE(${alias}.paused_at, NOW())
          WHEN ${activityStatusSql(alias)} = 'selesai' THEN COALESCE(${alias}.finished_at, ${alias}.paused_at, NOW())
          ELSE COALESCE(${alias}.finished_at, ${alias}.paused_at, NOW())
        END
      ) - COALESCE(${alias}.total_paused_seconds, 0)
    )
  END
`;

export const getTimerDurationMinutesSql = (alias = "l") => `
  CASE
    WHEN ${alias}.started_at IS NULL THEN ${alias}.durasi_menit
    ELSE CEIL(${getTimerDurationSecondsSql(alias)} / 60)
  END
`;
