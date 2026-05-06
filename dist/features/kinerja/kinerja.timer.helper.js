"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTimerDurationMinutesSql = exports.getTimerDurationSecondsSql = exports.activityStatusSql = exports.normalizeActivityStatusValue = void 0;
const validation_1 = require("../../shared/validation");
const normalizeActivityStatusValue = (value) => {
    const normalized = (0, validation_1.readTrimmedString)(value).toLowerCase();
    if (normalized === "dijeda" || normalized === "paused")
        return "jeda";
    if (normalized === "running")
        return "berjalan";
    if (normalized === "done" || normalized === "completed" || normalized === "finished")
        return "selesai";
    return normalized;
};
exports.normalizeActivityStatusValue = normalizeActivityStatusValue;
const activityStatusSql = (alias = "l") => `
  COALESCE(
    ${alias}.status_aktivitas,
    CASE
      WHEN ${alias}.status = 'dijeda' THEN 'jeda'
      WHEN ${alias}.status IN ('berjalan', 'jeda', 'selesai') THEN ${alias}.status
      ELSE NULL
    END
  )
`;
exports.activityStatusSql = activityStatusSql;
const getTimerDurationSecondsSql = (alias = "l") => `
  CASE
    WHEN ${alias}.started_at IS NULL THEN COALESCE(${alias}.durasi_menit, 0) * 60
    ELSE GREATEST(
      0,
      TIMESTAMPDIFF(
        SECOND,
        ${alias}.started_at,
        CASE
          WHEN ${(0, exports.activityStatusSql)(alias)} = 'berjalan' THEN NOW()
          WHEN ${(0, exports.activityStatusSql)(alias)} = 'jeda' THEN COALESCE(${alias}.paused_at, NOW())
          WHEN ${(0, exports.activityStatusSql)(alias)} = 'selesai' THEN COALESCE(${alias}.finished_at, ${alias}.paused_at, NOW())
          ELSE COALESCE(${alias}.finished_at, ${alias}.paused_at, NOW())
        END
      ) - COALESCE(${alias}.total_paused_seconds, 0)
    )
  END
`;
exports.getTimerDurationSecondsSql = getTimerDurationSecondsSql;
const getTimerDurationMinutesSql = (alias = "l") => `
  CASE
    WHEN ${alias}.started_at IS NULL THEN ${alias}.durasi_menit
    ELSE CEIL(${(0, exports.getTimerDurationSecondsSql)(alias)} / 60)
  END
`;
exports.getTimerDurationMinutesSql = getTimerDurationMinutesSql;
