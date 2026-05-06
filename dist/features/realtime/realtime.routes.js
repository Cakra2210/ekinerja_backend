"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const realtime_service_1 = require("./realtime.service");
const router = (0, express_1.Router)();
router.get("/events", (req, res) => {
    const cleanup = (0, realtime_service_1.registerRealtimeClient)(res);
    req.on("close", () => {
        cleanup();
        res.end();
    });
});
exports.default = router;
