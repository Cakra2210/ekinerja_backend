"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const employee_controller_1 = require("./employee.controller");
const employee_upload_1 = require("./employee.upload");
const auth_middleware_1 = require("../../middleware/auth.middleware");
const uploadSecurity_1 = require("../../shared/uploadSecurity");
const employeeRoutes = (0, express_1.Router)();
const manageEmployeeAccess = (0, auth_middleware_1.authorizeRoles)("super_admin", "admin_satker");
const validateProfilePhotoUpload = (req, _res, next) => {
    try {
        (0, uploadSecurity_1.validateUploadedFile)(req.file, "profile_image");
        next();
    }
    catch (error) {
        next(error);
    }
};
employeeRoutes.get("/", employee_controller_1.getEmployees);
employeeRoutes.get("/condition-dashboard", employee_controller_1.getEmployeeConditionDashboard);
employeeRoutes.get("/dynamic-recap/variables", employee_controller_1.getEmployeeDynamicRecapVariables);
employeeRoutes.get("/dynamic-recap", employee_controller_1.getEmployeeDynamicRecap);
employeeRoutes.post("/", manageEmployeeAccess, employee_upload_1.employeeProfilePhotoUpload.single("profilePhoto"), validateProfilePhotoUpload, employee_controller_1.createEmployee);
employeeRoutes.put("/:id", manageEmployeeAccess, employee_upload_1.employeeProfilePhotoUpload.single("profilePhoto"), validateProfilePhotoUpload, employee_controller_1.updateEmployee);
employeeRoutes.delete("/:id", manageEmployeeAccess, employee_controller_1.deleteEmployee);
exports.default = employeeRoutes;
