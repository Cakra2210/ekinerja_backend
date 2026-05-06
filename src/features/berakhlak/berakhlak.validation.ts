import { Response } from "express";
import { BerakhlakPayload } from "./berakhlak.types";

const clampScore = (value: number) => {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
};

export const toNumber = (value: unknown, fallback = 0) => {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
};

export const normalizePayload = (body: Record<string, unknown>): BerakhlakPayload => ({
  employeeId: toNumber(body.employeeId),
  evaluatorEmployeeId: toNumber(body.evaluatorEmployeeId),
  evaluationYear: toNumber(body.evaluationYear),
  evaluationMonth: toNumber(body.evaluationMonth),
  pelayananResponsif: clampScore(toNumber(body.pelayananResponsif, 0)),
  pelayananRamah: clampScore(toNumber(body.pelayananRamah, 0)),
  pelayananSolutif: clampScore(toNumber(body.pelayananSolutif, 0)),
  akuntabelProsedur: clampScore(toNumber(body.akuntabelProsedur, 0)),
  akuntabelTransparansi: clampScore(toNumber(body.akuntabelTransparansi, 0)),
  akuntabelTanggungJawab: clampScore(toNumber(body.akuntabelTanggungJawab, 0)),
  kompetenPenguasaan: clampScore(toNumber(body.kompetenPenguasaan, 0)),
  kompetenPenyelesaian: clampScore(toNumber(body.kompetenPenyelesaian, 0)),
  kompetenPengembangan: clampScore(toNumber(body.kompetenPengembangan, 0)),
  harmonisTim: clampScore(toNumber(body.harmonisTim, 0)),
  harmonisRelasi: clampScore(toNumber(body.harmonisRelasi, 0)),
  harmonisLingkungan: clampScore(toNumber(body.harmonisLingkungan, 0)),
  loyalKomitmen: clampScore(toNumber(body.loyalKomitmen, 0)),
  loyalAturan: clampScore(toNumber(body.loyalAturan, 0)),
  loyalDedikasi: clampScore(toNumber(body.loyalDedikasi, 0)),
  adaptifPerubahan: clampScore(toNumber(body.adaptifPerubahan, 0)),
  adaptifFleksibilitas: clampScore(toNumber(body.adaptifFleksibilitas, 0)),
  adaptifBelajar: clampScore(toNumber(body.adaptifBelajar, 0)),
  kolaboratifKerjaSama: clampScore(toNumber(body.kolaboratifKerjaSama, 0)),
  kolaboratifDiskusi: clampScore(toNumber(body.kolaboratifDiskusi, 0)),
  kolaboratifKoordinasi: clampScore(toNumber(body.kolaboratifKoordinasi, 0)),
  note: String(body.note || "").trim()
});

const average = (...scores: number[]) =>
  Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2));

export const calculateDimensions = (payload: BerakhlakPayload) => {
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
    finalScore: average(
      pelayananAvg,
      akuntabelAvg,
      kompetenAvg,
      harmonisAvg,
      loyalAvg,
      adaptifAvg,
      kolaboratifAvg
    )
  };
};

export const ensureValidPayload = (payload: BerakhlakPayload, res: Response) => {
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
