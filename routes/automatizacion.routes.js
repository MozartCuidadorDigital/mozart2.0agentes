import express from "express";
import { descargarAutorizacion, enviarCorreoCitaEndpoint } from "../controllers/automatizaciones/famisanar/automatizacion.js";
import { enviarCorreoComercial } from "../controllers/automatizaciones/comercial/automatizacion.js";

const router = express.Router();

router.post("/autorizacionesFamisanar", descargarAutorizacion);
router.post("/enviarCorreoConfirmacion", enviarCorreoCitaEndpoint)
router.post("/enviarCorreoComercial", enviarCorreoComercial);

export default router;