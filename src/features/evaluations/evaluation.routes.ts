import { Router } from "express";
import {
  createEvaluation,
  getEvaluations,
  updateEvaluation
} from "./evaluation.controller";
import { getRankings } from "./ranking.controller";
import { authorizeRoles } from "../../middleware/auth.middleware";

const evaluationRoutes = Router();
const rankingsRoutes = Router();
const manageEvaluationAccess = authorizeRoles("super_admin", "admin_satker", "kepala_satker", "kasubbag_umum", "ketua_tim", "pejabat_penilai", "pegawai", "reviewer");

evaluationRoutes.get("/", getEvaluations);
evaluationRoutes.post("/", manageEvaluationAccess, createEvaluation);
evaluationRoutes.put("/:id", manageEvaluationAccess, updateEvaluation);
rankingsRoutes.get("/", getRankings);

export { evaluationRoutes, rankingsRoutes };
