"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const routes_1 = __importDefault(require("./routes"));
const env_1 = require("./config/env");
const error_middleware_1 = require("./middleware/error.middleware");
const app = (0, express_1.default)();
app.disable("x-powered-by");
app.set("trust proxy", env_1.env.trustProxy);
const uploadRoot = path_1.default.resolve(process.cwd(), "uploads");
fs_1.default.mkdirSync(uploadRoot, { recursive: true });
app.use((0, cors_1.default)({
    origin: env_1.env.clientUrl,
    credentials: true
}));
app.use(express_1.default.json({ limit: "2mb" }));
app.use(express_1.default.urlencoded({ extended: true }));
app.use("/uploads", express_1.default.static(uploadRoot, {
    fallthrough: false,
    setHeaders: (res) => {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cache-Control", "private, max-age=300");
    }
}));
app.use("/api", routes_1.default);
app.use(error_middleware_1.notFoundHandler);
app.use(error_middleware_1.errorHandler);
exports.default = app;
