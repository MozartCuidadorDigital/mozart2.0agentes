import express from "express";
import { descargarAutorizacion, enviarCorreoCitaEndpoint } from "../controllers/automatizaciones/famisanar/automatizacion.js";
import { enviarCorreoComercial } from "../controllers/automatizaciones/comercial/automatizacion.js";
import { enviarTemplateWP } from "../controllers/automatizaciones/coosalud/automatizacion.js";
import { AgendarCitaGuajiraCristal, AutorizacionGuajira, CancelarCitaGuajiraCristal, descargarAutorizacionEsperanza, ReAgendarCitaGuajiraCristal } from "../controllers/automatizaciones/guajira/automatizacion.js";
import multer from "multer";

const storage = multer.memoryStorage();
export const upload = multer({
  storage,
});

const router = express.Router();

router.post("/autorizacionesFamisanar", descargarAutorizacion);
router.post("/enviarCorreoConfirmacion", enviarCorreoCitaEndpoint)
router.post("/enviarCorreoComercial", enviarCorreoComercial);
router.post("/enviarTemplate", enviarTemplateWP)


router.post("/autorizacionPersona", AutorizacionGuajira)
router.post(
  "/subirAutorizacion",
  upload.array("excel", 10),
  descargarAutorizacionEsperanza
);
router.post("/agendarCitaQrystalos", AgendarCitaGuajiraCristal)
router.post("/reagendarCitaQrystalos", ReAgendarCitaGuajiraCristal)
router.post("/cancelarCitaQrystalos", CancelarCitaGuajiraCristal)

export default router;