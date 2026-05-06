import { Router } from "express";
import { authorizeRoles } from "../../middleware/auth.middleware";
import {
  approveDialogAwal,
  approveIkiPegawai,
  createCascadingIku,
  createDialogAwal,
  createIkuSatker,
  createIkiPegawai,
  createKinerjaTeam,
  createTargetPeriodik,
  deleteCascadingIku,
  deleteIkuSatker,
  deleteKinerjaTeam,
  generateKinerjaRecommendations,
  generateTargetPeriodik,
  getCascadingIku,
  getDialogAwal,
  getIkuSatker,
  getIkiPegawai,
  getKinerjaActivityReport,
  getKinerjaActivityReportDetail,
  getKinerjaBootstrap,
  getKinerjaLookups,
  getKinerjaMonitoringAssignments,
  getKinerjaMonitoringLogbooks,
  getKinerjaRecommendations,
  getKinerjaTeams,
  getTargetPeriodik,
  lockIkiPegawai,
  reviewKinerjaRecommendation,
  reviseIkiPegawai,
  submitIkiPegawai,
  updateCascadingIku,
  updateDialogAwal,
  updateIkuSatker,
  updateIkiPegawai,
  updateKinerjaTeam,
  updateTargetPeriodik
} from "./kinerja.controller";
import {
  createActivityEvidence,
  createIndicatorRealization,
  createOperationalActivity,
  createOperationalAssignment,
  createTimekeeperAdditionalAssignment,
  deleteActivityEvidence,
  deleteIndicatorRealization,
  deleteOperationalActivity,
  deleteOperationalAssignment,
  finalizeIndicatorRealization,
  getActivityEvidences,
  getIndicatorRealizations,
  getOperationalActivities,
  getOperationalActivityHistory,
  getOperationalAssignments,
  pauseActiveTimekeeperActivity,
  submitIndicatorRealization,
  updateActivityEvidence,
  updateIndicatorRealization,
  updateOperationalActivity,
  updateOperationalAssignment,
  verifyActivityEvidence,
  verifyIndicatorRealization
} from "./kinerja.operational.controller";

import {
  createTimekeeperAdditionalAssignmentNative,
  finishTimekeeperActivity,
  getTimekeeperRealizationSummary,
  getTimekeeperState,
  pauseTimekeeperActivity,
  resumeTimekeeperActivity,
  startTimekeeperActivity
} from "./kinerja.timekeeper.controller";
import {
  archiveKinerjaEvidence,
  createKinerjaEvidenceVersion,
  getKinerjaEvidenceVersions,
  restoreKinerjaEvidence,
  uploadNewKinerjaEvidence
} from "./kinerja.document.controller";
import { uploadKinerjaEvidenceFile } from "./kinerja.document.upload";
import {
  approveKinerjaTargetChange,
  createKinerjaFeedback,
  createKinerjaTargetChange,
  getKinerjaDashboardOverview,
  getKinerjaBerandaDashboard,
  getKinerjaDailyWorkDashboard,
  getKinerjaAnalyticsFollowUpDirect,
  getKinerjaDashboardDiagnostics,
  getKinerjaFeedbacks,
  getKinerjaNotifications,
  getKinerjaRiskMonitoring,
  getKinerjaRiskMonitoringDirect,
  getKinerjaTargetChanges,
  markAllKinerjaNotificationsAsRead,
  markKinerjaFeedbackAsRead,
  markKinerjaNotificationAsRead,
  rejectKinerjaTargetChange,
  updateKinerjaFeedback
} from "./kinerja.management.controller";

import {
  activateKinerjaPolicy,
  closeKinerjaCalibration,
  createKinerjaCalibration,
  createKinerjaCalibrationItem,
  createKinerjaMidyearEvaluation,
  createKinerjaPolicy,
  createKinerjaPolicyFormula,
  createKinerjaPredicate,
  finalizeKinerjaFinalEvaluation,
  finalizeKinerjaMidyearEvaluation,
  generateKinerjaFinalEvaluations,
  getKinerjaCalibrations,
  getKinerjaFinalEvaluations,
  getKinerjaMidyearEvaluations,
  getKinerjaPolicies,
  getKinerjaPolicyFormulas,
  getKinerjaPredicates,
  updateKinerjaCalibration,
  updateKinerjaCalibrationItem,
  updateKinerjaFinalEvaluation,
  updateKinerjaMidyearEvaluation,
  updateKinerjaPolicy,
  updateKinerjaPolicyFormula,
  updateKinerjaPredicate
} from "./kinerja.evaluation.controller";

import {
  createKinerjaFieldMonitoring,
  createKinerjaProcessingMonitoring,
  createKinerjaPstService,
  createKinerjaPublication,
  createKinerjaSectoralCoaching,
  deleteKinerjaFieldMonitoring,
  deleteKinerjaProcessingMonitoring,
  deleteKinerjaPstService,
  deleteKinerjaPublication,
  deleteKinerjaSectoralCoaching,
  getKinerjaFieldMonitorings,
  getKinerjaProcessingMonitorings,
  getKinerjaPstServices,
  getKinerjaPublications,
  getKinerjaSectoralCoachings,
  updateKinerjaFieldMonitoring,
  updateKinerjaProcessingMonitoring,
  updateKinerjaPstService,
  updateKinerjaPublication,
  updateKinerjaSectoralCoaching
} from "./kinerja.bps.controller";

import {
  createKinerjaEvaluatorMapping,
  deleteKinerjaEvaluatorMapping,
  generateKinerjaIkiBulk,
  generateKinerjaOverdueNotifications,
  generateKinerjaPeriodicTargetsBulk,
  getKinerjaAutomationLogs,
  getKinerjaEvaluatorMappings,
  syncKinerjaEvaluatorMappings,
  updateKinerjaEvaluatorMapping
} from "./kinerja.automation.controller";

import {
  completeKinerjaBackupLog,
  createKinerjaAccessMatrix,
  createKinerjaBackupLog,
  getKinerjaAccessMatrix,
  getKinerjaAuditTrails,
  getKinerjaBackupLogs,
  getKinerjaSecuritySettings,
  getKinerjaSessionLogs,
  restoreKinerjaBackupLog,
  updateKinerjaAccessMatrix,
  updateKinerjaSecuritySetting
} from "./kinerja.security.controller";


import {
  createKinerjaCoachingRecommendation,
  createKinerjaRewardRecommendation,
  createKinerjaTalentPool,
  createKinerjaTrainingRecommendation,
  generateKinerjaCoachingRecommendations,
  generateKinerjaRewardRecommendations,
  generateKinerjaTalentPools,
  generateKinerjaTrainingRecommendations,
  getKinerjaCoachingRecommendations,
  getKinerjaRewardRecommendations,
  getKinerjaTalentPools,
  getKinerjaTrainingRecommendations,
  updateKinerjaCoachingRecommendation,
  updateKinerjaRewardRecommendation,
  updateKinerjaTalentPool,
  updateKinerjaTrainingRecommendation
} from "./kinerja.hr.controller";

import {
  getKinerjaContributionAnalytics,
  getKinerjaExecutiveAnalytics,
  getKinerjaScoreDistribution,
  getKinerjaTeamRankings,
  getKinerjaWorkloadAnalytics
} from "./kinerja.analytics.controller";

const kinerjaRoutes = Router();
const manageKinerjaAccess = authorizeRoles("super_admin", "admin_satker", "kepala_satker", "kasubbag_umum", "ketua_tim", "pejabat_penilai", "pegawai", "reviewer");

kinerjaRoutes.get("/bootstrap", getKinerjaBootstrap);
kinerjaRoutes.get("/lookups", getKinerjaLookups);

kinerjaRoutes.get("/dashboard/overview", getKinerjaDashboardOverview);
kinerjaRoutes.get("/dashboard/kerja-harian", getKinerjaDailyWorkDashboard);
kinerjaRoutes.get("/dashboard/beranda", getKinerjaBerandaDashboard);
kinerjaRoutes.get("/analytics/follow-up-direct", getKinerjaAnalyticsFollowUpDirect);
kinerjaRoutes.get("/dashboard/diagnostics", getKinerjaDashboardDiagnostics);
kinerjaRoutes.get("/monitoring/risks", getKinerjaRiskMonitoring);
kinerjaRoutes.get("/monitoring/risks-direct", getKinerjaRiskMonitoringDirect);

kinerjaRoutes.get("/feedbacks", getKinerjaFeedbacks);
kinerjaRoutes.post("/feedbacks", manageKinerjaAccess, createKinerjaFeedback);
kinerjaRoutes.put("/feedbacks/:id", manageKinerjaAccess, updateKinerjaFeedback);
kinerjaRoutes.post("/feedbacks/:id/read", manageKinerjaAccess, markKinerjaFeedbackAsRead);

kinerjaRoutes.get("/target-changes", getKinerjaTargetChanges);
kinerjaRoutes.post("/target-changes", manageKinerjaAccess, createKinerjaTargetChange);
kinerjaRoutes.post("/target-changes/:id/approve", manageKinerjaAccess, approveKinerjaTargetChange);
kinerjaRoutes.post("/target-changes/:id/reject", manageKinerjaAccess, rejectKinerjaTargetChange);

kinerjaRoutes.get("/notifications", getKinerjaNotifications);
kinerjaRoutes.post("/notifications/:id/read", manageKinerjaAccess, markKinerjaNotificationAsRead);
kinerjaRoutes.post("/notifications/read-all", manageKinerjaAccess, markAllKinerjaNotificationsAsRead);

kinerjaRoutes.get("/planning/iku-satker", getIkuSatker);
kinerjaRoutes.post("/planning/iku-satker", manageKinerjaAccess, createIkuSatker);
kinerjaRoutes.put("/planning/iku-satker/:id", manageKinerjaAccess, updateIkuSatker);
kinerjaRoutes.delete("/planning/iku-satker/:id", manageKinerjaAccess, deleteIkuSatker);

kinerjaRoutes.get("/planning/cascading", getCascadingIku);
kinerjaRoutes.post("/planning/cascading", manageKinerjaAccess, createCascadingIku);
kinerjaRoutes.put("/planning/cascading/:id", manageKinerjaAccess, updateCascadingIku);
kinerjaRoutes.delete("/planning/cascading/:id", manageKinerjaAccess, deleteCascadingIku);

kinerjaRoutes.get("/planning/iki", getIkiPegawai);
kinerjaRoutes.post("/planning/iki", manageKinerjaAccess, createIkiPegawai);
kinerjaRoutes.put("/planning/iki/:id", manageKinerjaAccess, updateIkiPegawai);
kinerjaRoutes.post("/planning/iki/:id/submit", manageKinerjaAccess, submitIkiPegawai);
kinerjaRoutes.post("/planning/iki/:id/approve", manageKinerjaAccess, approveIkiPegawai);
kinerjaRoutes.post("/planning/iki/:id/revise", manageKinerjaAccess, reviseIkiPegawai);
kinerjaRoutes.post("/planning/iki/:id/lock", manageKinerjaAccess, lockIkiPegawai);

kinerjaRoutes.get("/planning/periodic-targets", getTargetPeriodik);
kinerjaRoutes.post("/planning/periodic-targets/generate", manageKinerjaAccess, generateTargetPeriodik);
kinerjaRoutes.post("/planning/periodic-targets", manageKinerjaAccess, createTargetPeriodik);
kinerjaRoutes.put("/planning/periodic-targets/:id", manageKinerjaAccess, updateTargetPeriodik);

kinerjaRoutes.get("/planning/initial-dialogs", getDialogAwal);
kinerjaRoutes.post("/planning/initial-dialogs", manageKinerjaAccess, createDialogAwal);
kinerjaRoutes.put("/planning/initial-dialogs/:id", manageKinerjaAccess, updateDialogAwal);
kinerjaRoutes.post("/planning/initial-dialogs/:id/approve", manageKinerjaAccess, approveDialogAwal);

kinerjaRoutes.get("/teams", getKinerjaTeams);
kinerjaRoutes.post("/teams", manageKinerjaAccess, createKinerjaTeam);
kinerjaRoutes.put("/teams/:id", manageKinerjaAccess, updateKinerjaTeam);
kinerjaRoutes.delete("/teams/:id", manageKinerjaAccess, deleteKinerjaTeam);

kinerjaRoutes.get("/timekeeper/state", manageKinerjaAccess, getTimekeeperState);
kinerjaRoutes.get("/timekeeper/realization-summary", manageKinerjaAccess, getTimekeeperRealizationSummary);
kinerjaRoutes.post("/timekeeper/additional-assignment", manageKinerjaAccess, createTimekeeperAdditionalAssignmentNative);
kinerjaRoutes.post("/timekeeper/start", manageKinerjaAccess, startTimekeeperActivity);
kinerjaRoutes.post("/timekeeper/pause", manageKinerjaAccess, pauseTimekeeperActivity);
kinerjaRoutes.post("/timekeeper/resume", manageKinerjaAccess, resumeTimekeeperActivity);
kinerjaRoutes.post("/timekeeper/finish", manageKinerjaAccess, finishTimekeeperActivity);

kinerjaRoutes.get("/assignments", getOperationalAssignments);
kinerjaRoutes.post("/assignments/timekeeper-additional", createTimekeeperAdditionalAssignment);
kinerjaRoutes.post("/assignments", manageKinerjaAccess, createOperationalAssignment);
kinerjaRoutes.put("/assignments/:id", manageKinerjaAccess, updateOperationalAssignment);
kinerjaRoutes.delete("/assignments/:id", manageKinerjaAccess, deleteOperationalAssignment);

kinerjaRoutes.get("/logbooks", getOperationalActivities);
kinerjaRoutes.post("/logbooks", manageKinerjaAccess, createOperationalActivity);
kinerjaRoutes.post("/logbooks/timekeeper/pause-active", manageKinerjaAccess, pauseActiveTimekeeperActivity);
kinerjaRoutes.get("/logbooks/:id/history", manageKinerjaAccess, getOperationalActivityHistory);
kinerjaRoutes.put("/logbooks/:id", manageKinerjaAccess, updateOperationalActivity);
kinerjaRoutes.delete("/logbooks/:id", manageKinerjaAccess, deleteOperationalActivity);

kinerjaRoutes.get("/evidences", getActivityEvidences);
kinerjaRoutes.post("/evidences", manageKinerjaAccess, createActivityEvidence);
kinerjaRoutes.post("/evidences/upload", manageKinerjaAccess, uploadKinerjaEvidenceFile, uploadNewKinerjaEvidence);
kinerjaRoutes.get("/evidences/:id/versions", getKinerjaEvidenceVersions);
kinerjaRoutes.post("/evidences/:id/version", manageKinerjaAccess, uploadKinerjaEvidenceFile, createKinerjaEvidenceVersion);
kinerjaRoutes.post("/evidences/:id/archive", manageKinerjaAccess, archiveKinerjaEvidence);
kinerjaRoutes.post("/evidences/:id/restore", manageKinerjaAccess, restoreKinerjaEvidence);
kinerjaRoutes.put("/evidences/:id", manageKinerjaAccess, updateActivityEvidence);
kinerjaRoutes.delete("/evidences/:id", manageKinerjaAccess, deleteActivityEvidence);
kinerjaRoutes.post("/evidences/:id/verify", manageKinerjaAccess, verifyActivityEvidence);

kinerjaRoutes.get("/realizations", getIndicatorRealizations);
kinerjaRoutes.post("/realizations", manageKinerjaAccess, createIndicatorRealization);
kinerjaRoutes.put("/realizations/:id", manageKinerjaAccess, updateIndicatorRealization);
kinerjaRoutes.delete("/realizations/:id", manageKinerjaAccess, deleteIndicatorRealization);
kinerjaRoutes.post("/realizations/:id/submit", manageKinerjaAccess, submitIndicatorRealization);
kinerjaRoutes.post("/realizations/:id/verify", manageKinerjaAccess, verifyIndicatorRealization);
kinerjaRoutes.post("/realizations/:id/finalize", manageKinerjaAccess, finalizeIndicatorRealization);

kinerjaRoutes.get("/monitoring/logbooks", getKinerjaMonitoringLogbooks);
kinerjaRoutes.get("/monitoring/assignments", getKinerjaMonitoringAssignments);

kinerjaRoutes.get("/activity-report", getKinerjaActivityReport);
kinerjaRoutes.get("/activity-report/detail", getKinerjaActivityReportDetail);
kinerjaRoutes.get("/recommendations", getKinerjaRecommendations);
kinerjaRoutes.post("/recommendations/generate", manageKinerjaAccess, generateKinerjaRecommendations);
kinerjaRoutes.put("/recommendations/:id/review", manageKinerjaAccess, reviewKinerjaRecommendation);


kinerjaRoutes.get("/evaluation/policies", getKinerjaPolicies);
kinerjaRoutes.post("/evaluation/policies", manageKinerjaAccess, createKinerjaPolicy);
kinerjaRoutes.put("/evaluation/policies/:id", manageKinerjaAccess, updateKinerjaPolicy);
kinerjaRoutes.post("/evaluation/policies/:id/activate", manageKinerjaAccess, activateKinerjaPolicy);

kinerjaRoutes.get("/evaluation/formulas", getKinerjaPolicyFormulas);
kinerjaRoutes.post("/evaluation/formulas", manageKinerjaAccess, createKinerjaPolicyFormula);
kinerjaRoutes.put("/evaluation/formulas/:id", manageKinerjaAccess, updateKinerjaPolicyFormula);

kinerjaRoutes.get("/evaluation/predicates", getKinerjaPredicates);
kinerjaRoutes.post("/evaluation/predicates", manageKinerjaAccess, createKinerjaPredicate);
kinerjaRoutes.put("/evaluation/predicates/:id", manageKinerjaAccess, updateKinerjaPredicate);

kinerjaRoutes.get("/evaluation/midyear", getKinerjaMidyearEvaluations);
kinerjaRoutes.post("/evaluation/midyear", manageKinerjaAccess, createKinerjaMidyearEvaluation);
kinerjaRoutes.put("/evaluation/midyear/:id", manageKinerjaAccess, updateKinerjaMidyearEvaluation);
kinerjaRoutes.post("/evaluation/midyear/:id/finalize", manageKinerjaAccess, finalizeKinerjaMidyearEvaluation);

kinerjaRoutes.get("/evaluation/final", getKinerjaFinalEvaluations);
kinerjaRoutes.post("/evaluation/final/generate", manageKinerjaAccess, generateKinerjaFinalEvaluations);
kinerjaRoutes.put("/evaluation/final/:id", manageKinerjaAccess, updateKinerjaFinalEvaluation);
kinerjaRoutes.post("/evaluation/final/:id/finalize", manageKinerjaAccess, finalizeKinerjaFinalEvaluation);

kinerjaRoutes.get("/evaluation/calibrations", getKinerjaCalibrations);
kinerjaRoutes.post("/evaluation/calibrations", manageKinerjaAccess, createKinerjaCalibration);
kinerjaRoutes.put("/evaluation/calibrations/:id", manageKinerjaAccess, updateKinerjaCalibration);
kinerjaRoutes.post("/evaluation/calibrations/:id/items", manageKinerjaAccess, createKinerjaCalibrationItem);
kinerjaRoutes.put("/evaluation/calibrations/:id/items/:itemId", manageKinerjaAccess, updateKinerjaCalibrationItem);
kinerjaRoutes.post("/evaluation/calibrations/:id/close", manageKinerjaAccess, closeKinerjaCalibration);


kinerjaRoutes.get("/bps/pst-services", getKinerjaPstServices);
kinerjaRoutes.post("/bps/pst-services", manageKinerjaAccess, createKinerjaPstService);
kinerjaRoutes.put("/bps/pst-services/:id", manageKinerjaAccess, updateKinerjaPstService);
kinerjaRoutes.delete("/bps/pst-services/:id", manageKinerjaAccess, deleteKinerjaPstService);

kinerjaRoutes.get("/bps/publications", getKinerjaPublications);
kinerjaRoutes.post("/bps/publications", manageKinerjaAccess, createKinerjaPublication);
kinerjaRoutes.put("/bps/publications/:id", manageKinerjaAccess, updateKinerjaPublication);
kinerjaRoutes.delete("/bps/publications/:id", manageKinerjaAccess, deleteKinerjaPublication);

kinerjaRoutes.get("/bps/sectoral-coachings", getKinerjaSectoralCoachings);
kinerjaRoutes.post("/bps/sectoral-coachings", manageKinerjaAccess, createKinerjaSectoralCoaching);
kinerjaRoutes.put("/bps/sectoral-coachings/:id", manageKinerjaAccess, updateKinerjaSectoralCoaching);
kinerjaRoutes.delete("/bps/sectoral-coachings/:id", manageKinerjaAccess, deleteKinerjaSectoralCoaching);

kinerjaRoutes.get("/bps/field-monitorings", getKinerjaFieldMonitorings);
kinerjaRoutes.post("/bps/field-monitorings", manageKinerjaAccess, createKinerjaFieldMonitoring);
kinerjaRoutes.put("/bps/field-monitorings/:id", manageKinerjaAccess, updateKinerjaFieldMonitoring);
kinerjaRoutes.delete("/bps/field-monitorings/:id", manageKinerjaAccess, deleteKinerjaFieldMonitoring);

kinerjaRoutes.get("/bps/processing-monitorings", getKinerjaProcessingMonitorings);
kinerjaRoutes.post("/bps/processing-monitorings", manageKinerjaAccess, createKinerjaProcessingMonitoring);
kinerjaRoutes.put("/bps/processing-monitorings/:id", manageKinerjaAccess, updateKinerjaProcessingMonitoring);
kinerjaRoutes.delete("/bps/processing-monitorings/:id", manageKinerjaAccess, deleteKinerjaProcessingMonitoring);

kinerjaRoutes.get("/automation/evaluator-mappings", getKinerjaEvaluatorMappings);
kinerjaRoutes.post("/automation/evaluator-mappings", manageKinerjaAccess, createKinerjaEvaluatorMapping);
kinerjaRoutes.put("/automation/evaluator-mappings/:id", manageKinerjaAccess, updateKinerjaEvaluatorMapping);
kinerjaRoutes.delete("/automation/evaluator-mappings/:id", manageKinerjaAccess, deleteKinerjaEvaluatorMapping);
kinerjaRoutes.post("/automation/evaluator-mappings/sync", manageKinerjaAccess, syncKinerjaEvaluatorMappings);
kinerjaRoutes.post("/automation/generate-iki", manageKinerjaAccess, generateKinerjaIkiBulk);
kinerjaRoutes.post("/automation/generate-periodic-targets", manageKinerjaAccess, generateKinerjaPeriodicTargetsBulk);
kinerjaRoutes.post("/automation/generate-overdue-notifications", manageKinerjaAccess, generateKinerjaOverdueNotifications);
kinerjaRoutes.get("/automation/logs", getKinerjaAutomationLogs);

kinerjaRoutes.get("/analytics/executive-overview", getKinerjaExecutiveAnalytics);
kinerjaRoutes.get("/analytics/team-rankings", getKinerjaTeamRankings);
kinerjaRoutes.get("/analytics/score-distribution", getKinerjaScoreDistribution);
kinerjaRoutes.get("/analytics/workload", getKinerjaWorkloadAnalytics);
kinerjaRoutes.get("/analytics/contributions", getKinerjaContributionAnalytics);


kinerjaRoutes.get("/security/audit-trails", getKinerjaAuditTrails);
kinerjaRoutes.get("/security/access-matrix", getKinerjaAccessMatrix);
kinerjaRoutes.post("/security/access-matrix", manageKinerjaAccess, createKinerjaAccessMatrix);
kinerjaRoutes.put("/security/access-matrix/:id", manageKinerjaAccess, updateKinerjaAccessMatrix);
kinerjaRoutes.get("/security/settings", getKinerjaSecuritySettings);
kinerjaRoutes.put("/security/settings/:key", manageKinerjaAccess, updateKinerjaSecuritySetting);
kinerjaRoutes.get("/security/backups", getKinerjaBackupLogs);
kinerjaRoutes.post("/security/backups", manageKinerjaAccess, createKinerjaBackupLog);
kinerjaRoutes.post("/security/backups/:id/complete", manageKinerjaAccess, completeKinerjaBackupLog);
kinerjaRoutes.post("/security/backups/:id/restore", manageKinerjaAccess, restoreKinerjaBackupLog);
kinerjaRoutes.get("/security/session-logs", getKinerjaSessionLogs);

kinerjaRoutes.get("/hr/reward-recommendations", getKinerjaRewardRecommendations);
kinerjaRoutes.post("/hr/reward-recommendations", manageKinerjaAccess, createKinerjaRewardRecommendation);
kinerjaRoutes.put("/hr/reward-recommendations/:id", manageKinerjaAccess, updateKinerjaRewardRecommendation);
kinerjaRoutes.post("/hr/reward-recommendations/generate", manageKinerjaAccess, generateKinerjaRewardRecommendations);

kinerjaRoutes.get("/hr/coaching-recommendations", getKinerjaCoachingRecommendations);
kinerjaRoutes.post("/hr/coaching-recommendations", manageKinerjaAccess, createKinerjaCoachingRecommendation);
kinerjaRoutes.put("/hr/coaching-recommendations/:id", manageKinerjaAccess, updateKinerjaCoachingRecommendation);
kinerjaRoutes.post("/hr/coaching-recommendations/generate", manageKinerjaAccess, generateKinerjaCoachingRecommendations);

kinerjaRoutes.get("/hr/training-recommendations", getKinerjaTrainingRecommendations);
kinerjaRoutes.post("/hr/training-recommendations", manageKinerjaAccess, createKinerjaTrainingRecommendation);
kinerjaRoutes.put("/hr/training-recommendations/:id", manageKinerjaAccess, updateKinerjaTrainingRecommendation);
kinerjaRoutes.post("/hr/training-recommendations/generate", manageKinerjaAccess, generateKinerjaTrainingRecommendations);

kinerjaRoutes.get("/hr/talent-pool", getKinerjaTalentPools);
kinerjaRoutes.post("/hr/talent-pool", manageKinerjaAccess, createKinerjaTalentPool);
kinerjaRoutes.put("/hr/talent-pool/:id", manageKinerjaAccess, updateKinerjaTalentPool);
kinerjaRoutes.post("/hr/talent-pool/generate", manageKinerjaAccess, generateKinerjaTalentPools);


export default kinerjaRoutes;
