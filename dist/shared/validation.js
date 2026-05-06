"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureRequired = exports.ensureOneOf = exports.readDateString = exports.readNonNegativeNumber = exports.readPositiveNumber = exports.readIntegerInRange = exports.readPositiveId = exports.readNumberStrict = exports.readBoolean = exports.readTrimmedString = void 0;
const http_1 = require("./http");
const readTrimmedString = (value) => String(value || "").trim();
exports.readTrimmedString = readTrimmedString;
const readBoolean = (value, defaultValue = false) => {
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
exports.readBoolean = readBoolean;
const readNumberStrict = (value, fieldName) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        throw new http_1.AppError(`${fieldName} tidak valid`, 400);
    }
    return parsed;
};
exports.readNumberStrict = readNumberStrict;
const readPositiveId = (value, fieldName) => {
    const parsed = (0, exports.readNumberStrict)(value, fieldName);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new http_1.AppError(`${fieldName} tidak valid`, 400);
    }
    return parsed;
};
exports.readPositiveId = readPositiveId;
const readIntegerInRange = (value, min, max, fieldName) => {
    const parsed = (0, exports.readNumberStrict)(value, fieldName);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        throw new http_1.AppError(`${fieldName} tidak valid`, 400);
    }
    return parsed;
};
exports.readIntegerInRange = readIntegerInRange;
const readPositiveNumber = (value, fieldName) => {
    const parsed = (0, exports.readNumberStrict)(value, fieldName);
    if (parsed <= 0) {
        throw new http_1.AppError(`${fieldName} tidak valid`, 400);
    }
    return parsed;
};
exports.readPositiveNumber = readPositiveNumber;
const readNonNegativeNumber = (value, fieldName, defaultValue = 0) => {
    if (value === undefined || value === null || value === "") {
        return defaultValue;
    }
    const parsed = (0, exports.readNumberStrict)(value, fieldName);
    if (parsed < 0) {
        throw new http_1.AppError(`${fieldName} tidak valid`, 400);
    }
    return parsed;
};
exports.readNonNegativeNumber = readNonNegativeNumber;
const readDateString = (value, fieldName) => {
    const normalized = (0, exports.readTrimmedString)(value);
    if (!normalized) {
        throw new http_1.AppError(`${fieldName} wajib diisi`, 400);
    }
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) {
        throw new http_1.AppError(`${fieldName} tidak valid`, 400);
    }
    return normalized;
};
exports.readDateString = readDateString;
const ensureOneOf = (value, allowedValues, fieldLabel) => {
    if (!allowedValues.includes(value)) {
        throw new http_1.AppError(`${fieldLabel} tidak valid`, 400);
    }
    return value;
};
exports.ensureOneOf = ensureOneOf;
const ensureRequired = (value, message) => {
    if (!value) {
        throw new http_1.AppError(message, 400);
    }
    return value;
};
exports.ensureRequired = ensureRequired;
