import { AccountRole } from "../types";

export const ACCOUNT_ROLES: AccountRole[] = [
  "super_admin",
  "admin_satker",
  "kepala_satker",
  "kasubbag_umum",
  "ketua_tim",
  "pejabat_penilai",
  "pegawai",
  "reviewer"
];

const LEGACY_ROLE_MAP: Record<string, AccountRole> = {
  admin: "super_admin",
  operator: "admin_satker",
  supervisor: "pejabat_penilai",
  user: "pegawai"
};

export const DEFAULT_INITIAL_PASSWORD = "bps7317";

export const normalizeAccountRole = (value: unknown): AccountRole => {
  const normalized = String(value || "").trim().toLowerCase();
  if ((ACCOUNT_ROLES as string[]).includes(normalized)) {
    return normalized as AccountRole;
  }
  return LEGACY_ROLE_MAP[normalized] || "pegawai";
};

const uniqRoles = (roles: AccountRole[]) => Array.from(new Set(roles));

export const getDefaultRoleMatrix = (): AccountRole[] => ["pegawai"];

export const normalizeRoleMatrix = (value: unknown): AccountRole[] => {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  const parsed = source
    .map((item) => normalizeAccountRole(item))
    .filter((role, index, self) => self.indexOf(role) === index);

  const merged = uniqRoles(["pegawai", ...parsed]);
  const filtered = merged.filter((role) => ACCOUNT_ROLES.includes(role));
  return filtered.length ? filtered : ["pegawai"];
};

export const getAllowedAccessRoles = (
  assignedRoles?: AccountRole[] | null,
  legacyRole?: AccountRole | null
): AccountRole[] => {
  if (assignedRoles?.length) {
    return normalizeRoleMatrix(assignedRoles);
  }

  if (legacyRole) {
    return normalizeRoleMatrix([legacyRole]);
  }

  return ["pegawai"];
};

export const getDefaultAccessRole = (assignedRoles?: AccountRole[] | null): AccountRole => {
  const normalizedRoles = getAllowedAccessRoles(assignedRoles);
  if (normalizedRoles.includes("pegawai")) {
    return "pegawai";
  }
  return normalizedRoles[0] || "pegawai";
};

export const NON_PEGAWAI_ROLES: AccountRole[] = ACCOUNT_ROLES.filter((role) => role !== "pegawai");
export const CONFIGURATION_ROLES: AccountRole[] = ["super_admin", "admin_satker"];
