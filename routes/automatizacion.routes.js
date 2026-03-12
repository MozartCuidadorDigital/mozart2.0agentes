import express from "express";
import { descargarAutorizacion, enviarCorreoCitaEndpoint } from "../controllers/automatizaciones/famisanar/automatizacion.js";

const router = express.Router();

router.post("/autorizacionesFamisanar", descargarAutorizacion);
router.post("/enviarCorreoConfirmacion", enviarCorreoCitaEndpoint)

export default router;