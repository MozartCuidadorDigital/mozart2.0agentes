import express from "express";
import { descargarAutorizacion, enviarCorreoCitaEndpoint } from "../controllers/automatizaciones/famisanar/automatizacion.js";
import { enviarCorreoComercial } from "../controllers/automatizaciones/comercial/automatizacion.js";
import { enviarTemplateWP } from "../controllers/automatizaciones/coosalud/automatizacion.js";

const router = express.Router();

router.post("/autorizacionesFamisanar", descargarAutorizacion);
router.post("/enviarCorreoConfirmacion", enviarCorreoCitaEndpoint)
router.post("/enviarCorreoComercial", enviarCorreoComercial);
router.post("/enviarTemplate", enviarTemplateWP)


export default router;