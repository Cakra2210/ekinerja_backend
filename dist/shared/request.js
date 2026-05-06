"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readNumber = void 0;
const readNumber = (value) => {
    const rawValue = Array.isArray(value) ? value[0] : value;
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? parsed : undefined;
};
exports.readNumber = readNumber;
