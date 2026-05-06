import { AppError } from "./http";

export const readTrimmedString = (value: unknown) => String(value || "").trim();

export const readBoolean = (value: unknown, defaultValue = false) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === 1 || value === "1" || value === "true") {
    return true;
  }

  if (value === 0 || value === "0" || value === "false") {
    return false;
  }

  return defaultValue;
};

export const readNumberStrict = (value: unknown, fieldName: string) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new AppError(`${fieldName} tidak valid`, 400);
  }

  return parsed;
};

export const readPositiveId = (value: unknown, fieldName: string) => {
  const parsed = readNumberStrict(value, fieldName);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError(`${fieldName} tidak valid`, 400);
  }

  return parsed;
};

export const readIntegerInRange = (
  value: unknown,
  min: number,
  max: number,
  fieldName: string
) => {
  const parsed = readNumberStrict(value, fieldName);

  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new AppError(`${fieldName} tidak valid`, 400);
  }

  return parsed;
};

export const readPositiveNumber = (value: unknown, fieldName: string) => {
  const parsed = readNumberStrict(value, fieldName);

  if (parsed <= 0) {
    throw new AppError(`${fieldName} tidak valid`, 400);
  }

  return parsed;
};

export const readNonNegativeNumber = (
  value: unknown,
  fieldName: string,
  defaultValue = 0
) => {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const parsed = readNumberStrict(value, fieldName);

  if (parsed < 0) {
    throw new AppError(`${fieldName} tidak valid`, 400);
  }

  return parsed;
};

export const readDateString = (value: unknown, fieldName: string) => {
  const normalized = readTrimmedString(value);

  if (!normalized) {
    throw new AppError(`${fieldName} wajib diisi`, 400);
  }

  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    throw new AppError(`${fieldName} tidak valid`, 400);
  }

  return normalized;
};

export const ensureOneOf = <T extends string>(value: string, allowedValues: readonly T[], fieldLabel: string) => {
  if (!allowedValues.includes(value as T)) {
    throw new AppError(`${fieldLabel} tidak valid`, 400);
  }

  return value as T;
};

export const ensureRequired = (value: string, message: string) => {
  if (!value) {
    throw new AppError(message, 400);
  }

  return value;
};