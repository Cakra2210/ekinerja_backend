"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureValidPayload = exports.calculateDimensions = exports.normalizePayload = exports.toNumber = void 0;
const clampScore = (value) => {
    if (Number.isNaN(value))
        return 0;
    if (value < 0)
        return 0;
    if (value > 100)
        return 100;
    return value;
};
const toNumber = (value, fallback = 0) => {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : fallback;
};
exports.toNumber = toNumber;
const normalizePayload = (body) => ({
    employeeId: (0, exports.toNumber)(body.employeeId),
    evaluatorEmployeeId: (0, exports.toNumber)(body.evaluatorEmployeeId),
    evaluationYear: (0, exports.toNumber)(body.evaluationYear),
    evaluationMonth: (0, exports.toNumber)(body.evaluationMonth),
    pelayananResponsif: clampScore((0, exports.toNumber)(body.pelayananResponsif, 0)),
    pelayananRamah: clampScore((0, exports.toNumber)(body.pelayananRamah, 0)),
    pelayananSolutif: clampScore((0, exports.toNumber)(body.pelayananSolutif, 0)),
    akuntabelProsedur: clampScore((0, exports.toNumber)(body.akuntabelProsedur, 0)),
    akuntabelTransparansi: clampScore((0, exports.toNumber)(body.akuntabelTransparansi, 0)),
    akuntabelTanggungJawab: clampScore((0, exports.toNumber)(body.akuntabelTanggungJawab, 0)),
    kompetenPenguasaan: clampScore((0, exports.toNumber)(body.kompetenPenguasaan, 0)),
    kompetenPenyelesaian: clampScore((0, exports.toNumber)(body.kompetenPenyelesaian, 0)),
    kompetenPengembangan: clampScore((0, exports.toNumber)(body.kompetenPengembangan, 0)),
    harmonisTim: clampScore((0, exports.toNumber)(body.harmonisTim, 0)),
    harmonisRelasi: clampScore((0, exports.toNumber)(body.harmonisRelasi, 0)),
    harmonisLingkungan: clampScore((0, exports.toNumber)(body.harmonisLingkungan, 0)),
    loyalKomitmen: clampScore((0, exports.toNumber)(body.loyalKomitmen, 0)),
    loyalAturan: clampScore((0, exports.toNumber)(body.loyalAturan, 0)),
    loyalDedikasi: clampScore((0, exports.toNumber)(body.loyalDedikasi, 0)),
    adaptifPerubahan: clampScore((0, exports.toNumber)(body.adaptifPerubahan, 0)),
    adaptifFleksibilitas: clampScore((0, exports.toNumber)(body.adaptifFleksibilitas, 0)),
    adaptifBelajar: clampScore((0, exports.toNumber)(body.adaptifBelajar, 0)),
    kolaboratifKerjaSama: clampScore((0, exports.toNumber)(body.kolaboratifKerjaSama, 0)),
    kolaboratifDiskusi: clampScore((0, exports.toNumber)(body.kolaboratifDiskusi, 0)),
    kolaboratifKoordinasi: clampScore((0, exports.toNumber)(body.kolaboratifKoordinasi, 0)),
    note: String(body.note || "").trim()
});
exports.normalizePayload = normalizePayload;
const average = (...scores) => Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2));
const calculateDimensions = (payload) => {
    const pelayananAvg = average(payload.pelayananResponsif, payload.pelayananRamah, payload.pelayananSolutif);
    const akuntabelAvg = average(payload.akuntabelProsedur, payload.akuntabelTransparansi, payload.akuntabelTanggungJawab);
    const kompetenAvg = average(payload.kompetenPenguasaan, payload.kompetenPenyelesaian, payload.kompetenPengembangan);
    const harmonisAvg = average(payload.harmonisTim, payload.harmonisRelasi, payload.harmonisLingkungan);
    const loyalAvg = average(payload.loyalKomitmen, payload.loyalAturan, payload.loyalDedikasi);
    const adaptifAvg = average(payload.adaptifPerubahan, payload.adaptifFleksibilitas, payload.adaptifBelajar);
    const kolaboratifAvg = average(payload.kolaboratifKerjaSama, payload.kolaboratifDiskusi, payload.kolaboratifKoordinasi);
    return {
        pelayananAvg,
        akuntabelAvg,
        kompetenAvg,
        harmonisAvg,
        loyalAvg,
        adaptifAvg,
        kolaboratifAvg,
        finalScore: average(pelayananAvg, akuntabelAvg, kompetenAvg, harmonisAvg, loyalAvg, adaptifAvg, kolaboratifAvg)
    };
};
exports.calculateDimensions = calculateDimensions;
const ensureValidPayload = (payload, res) => {
    if (!payload.employeeId || !payload.evaluatorEmployeeId) {
        res.status(400).json({
            success: false,
            message: "Pegawai penilai dan pegawai yang dinilai wajib dipilih"
        });
        return false;
    }
    if (payload.employeeId === payload.evaluatorEmployeeId) {
        res.status(400).json({
            success: false,
            message: "Pegawai tidak dapat menilai dirinya sendiri"
        });
        return false;
    }
    if (payload.evaluationMonth < 1 || payload.evaluationMonth > 12) {
        res.status(400).json({
            success: false,
            message: "Bulan penilaian tidak valid"
        });
        return false;
    }
    if (payload.evaluationYear < 2000 || payload.evaluationYear > 2100) {
        res.status(400).json({
            success: false,
            message: "Tahun penilaian tidak valid"
        });
        return false;
    }
    return true;
};
exports.ensureValidPayload = ensureValidPayload;
