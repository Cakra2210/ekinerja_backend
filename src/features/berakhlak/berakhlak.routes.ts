import { Router } from "express";
import {
  createBerakhlakEvaluation,
  getBerakhlakDashboard,
  getBerakhlakEvaluations,
  updateBerakhlakEvaluation
} from "./berakhlak.controller";
import { authorizeRoles } from "../../middleware/auth.middleware";

const berakhlakRoutes = Router();
const manageBerakhlakAccess = authorizeRoles("super_admin", "admin_satker", "kepala_satker", "kasubbag_umum", "ketua_tim", "pejabat_penilai", "pegawai", "reviewer");

berakhlakRoutes.get("/evaluations", getBerakhlakEvaluations);
berakhlakRoutes.post("/evaluations", manageBerakhlakAccess, createBerakhlakEvaluation);
berakhlakRoutes.put("/evaluations/:id", manageBerakhlakAccess, updateBerakhlakEvaluation);
berakhlakRoutes.get("/dashboard", getBerakhlakDashboard);

export default berakhlakRoutes;
