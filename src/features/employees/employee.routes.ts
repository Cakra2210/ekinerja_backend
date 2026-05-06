import { Router } from "express";
import {
  createEmployee,
  deleteEmployee,
  getEmployeeDynamicRecap,
  getEmployeeDynamicRecapVariables,
  getEmployeeConditionDashboard,
  getEmployees,
  updateEmployee
} from "./employee.controller";
import { employeeProfilePhotoUpload } from "./employee.upload";
import { authorizeRoles } from "../../middleware/auth.middleware";
import { validateUploadedFile } from "../../shared/uploadSecurity";

const employeeRoutes = Router();
const manageEmployeeAccess = authorizeRoles("super_admin", "admin_satker");
const validateProfilePhotoUpload = (req: any, _res: any, next: any) => {
  try { validateUploadedFile(req.file, "profile_image"); next(); } catch (error) { next(error); }
};

employeeRoutes.get("/", getEmployees);
employeeRoutes.get("/condition-dashboard", getEmployeeConditionDashboard);
employeeRoutes.get("/dynamic-recap/variables", getEmployeeDynamicRecapVariables);
employeeRoutes.get("/dynamic-recap", getEmployeeDynamicRecap);
employeeRoutes.post("/", manageEmployeeAccess, employeeProfilePhotoUpload.single("profilePhoto"), validateProfilePhotoUpload, createEmployee);
employeeRoutes.put("/:id", manageEmployeeAccess, employeeProfilePhotoUpload.single("profilePhoto"), validateProfilePhotoUpload, updateEmployee);
employeeRoutes.delete("/:id", manageEmployeeAccess, deleteEmployee);

export default employeeRoutes;
