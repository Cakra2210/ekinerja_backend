"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONFIGURATION_ROLES = exports.NON_PEGAWAI_ROLES = exports.getDefaultAccessRole = exports.getAllowedAccessRoles = exports.normalizeRoleMatrix = exports.getDefaultRoleMatrix = exports.normalizeAccountRole = exports.DEFAULT_INITIAL_PASSWORD = exports.ACCOUNT_ROLES = void 0;
exports.ACCOUNT_ROLES = [
    "super_admin",
    "admin_satker",
    "kepala_satker",
    "kasubbag_umum",
    "ketua_tim",
    "pejabat_penilai",
    "pegawai",
    "reviewer"
];
const LEGACY_ROLE_MAP = {
    admin: "super_admin",
    operator: "admin_satker",
    supervisor: "pejabat_penilai",
    user: "pegawai"
};
exports.DEFAULT_INITIAL_PASSWORD = "bps7317";
const normalizeAccountRole = (value) => {
    const normalized = String(value || "").trim().toLowerCase();
    if (exports.ACCOUNT_ROLES.includes(normalized)) {
        return normalized;
    }
    return LEGACY_ROLE_MAP[normalized] || "pegawai";
};
exports.normalizeAccountRole = normalizeAccountRole;
const uniqRoles = (roles) => Array.from(new Set(roles));
const getDefaultRoleMatrix = () => ["pegawai"];
exports.getDefaultRoleMatrix = getDefaultRoleMatrix;
const normalizeRoleMatrix = (value) => {
    const source = Array.isArray(value)
        ? value
        : typeof value === "string"
            ? value.split(",")
            : [];
    const parsed = source
        .map((item) => (0, exports.normalizeAccountRole)(item))
        .filter((role, index, self) => self.indexOf(role) === index);
    const merged = uniqRoles(["pegawai", ...parsed]);
    const filtered = merged.filter((role) => exports.ACCOUNT_ROLES.includes(role));
    return filtered.length ? filtered : ["pegawai"];
};
exports.normalizeRoleMatrix = normalizeRoleMatrix;
const getAllowedAccessRoles = (assignedRoles, legacyRole) => {
    if (assignedRoles?.length) {
        return (0, exports.normalizeRoleMatrix)(assignedRoles);
    }
    if (legacyRole) {
        return (0, exports.normalizeRoleMatrix)([legacyRole]);
    }
    return ["pegawai"];
};
exports.getAllowedAccessRoles = getAllowedAccessRoles;
const getDefaultAccessRole = (assignedRoles) => {
    const normalizedRoles = (0, exports.getAllowedAccessRoles)(assignedRoles);
    if (normalizedRoles.includes("pegawai")) {
        return "pegawai";
    }
    return normalizedRoles[0] || "pegawai";
};
exports.getDefaultAccessRole = getDefaultAccessRole;
exports.NON_PEGAWAI_ROLES = exports.ACCOUNT_ROLES.filter((role) => role !== "pegawai");
exports.CONFIGURATION_ROLES = ["super_admin", "admin_satker"];
