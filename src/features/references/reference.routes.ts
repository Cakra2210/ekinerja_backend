import { Router } from "express";
import {
  createActivityCategory,
  createKinerjaPeriod,
  createKinerjaUnit,
  createPerformanceActivity,
  createPerformanceIndicator,
  createPosition,
  deleteActivityCategory,
  deleteKinerjaPeriod,
  deleteKinerjaUnit,
  deletePerformanceActivity,
  deletePerformanceIndicator,
  deletePosition,
  getActivityCategories,
  getCriteria,
  getDepartments,
  getKinerjaPeriods,
  getKinerjaUnits,
  getPerformanceActivities,
  getPerformanceIndicators,
  getPeriods,
  getPositions,
  updateActivityCategory,
  updateKinerjaPeriod,
  updateKinerjaUnit,
  updatePerformanceActivity,
  updatePerformanceIndicator,
  updatePosition
} from "./reference.controller";
import { authorizeRoles } from "../../middleware/auth.middleware";

const referenceRoutes = Router();
const configurationAccess = authorizeRoles("super_admin", "admin_satker");

referenceRoutes.get("/departments", getDepartments);
referenceRoutes.get("/criteria", getCriteria);
referenceRoutes.get("/periods", getPeriods);
referenceRoutes.get("/positions", getPositions);
referenceRoutes.post("/positions", configurationAccess, createPosition);
referenceRoutes.put("/positions/:id", configurationAccess, updatePosition);
referenceRoutes.delete("/positions/:id", configurationAccess, deletePosition);
referenceRoutes.get("/performance-indicators", getPerformanceIndicators);
referenceRoutes.post("/performance-indicators", configurationAccess, createPerformanceIndicator);
referenceRoutes.put("/performance-indicators/:id", configurationAccess, updatePerformanceIndicator);
referenceRoutes.delete("/performance-indicators/:id", configurationAccess, deletePerformanceIndicator);
referenceRoutes.get("/performance-activities", getPerformanceActivities);
referenceRoutes.post("/performance-activities", configurationAccess, createPerformanceActivity);
referenceRoutes.put("/performance-activities/:id", configurationAccess, updatePerformanceActivity);
referenceRoutes.delete("/performance-activities/:id", configurationAccess, deletePerformanceActivity);

referenceRoutes.get("/kinerja-periods", getKinerjaPeriods);
referenceRoutes.post("/kinerja-periods", configurationAccess, createKinerjaPeriod);
referenceRoutes.put("/kinerja-periods/:id", configurationAccess, updateKinerjaPeriod);
referenceRoutes.delete("/kinerja-periods/:id", configurationAccess, deleteKinerjaPeriod);

referenceRoutes.get("/kinerja-units", getKinerjaUnits);
referenceRoutes.post("/kinerja-units", configurationAccess, createKinerjaUnit);
referenceRoutes.put("/kinerja-units/:id", configurationAccess, updateKinerjaUnit);
referenceRoutes.delete("/kinerja-units/:id", configurationAccess, deleteKinerjaUnit);

referenceRoutes.get("/activity-categories", getActivityCategories);
referenceRoutes.post("/activity-categories", configurationAccess, createActivityCategory);
referenceRoutes.put("/activity-categories/:id", configurationAccess, updateActivityCategory);
referenceRoutes.delete("/activity-categories/:id", configurationAccess, deleteActivityCategory);

export default referenceRoutes;
