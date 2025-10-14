import express from "express";
import { enviarAgendamiento, enviarPresentacion, enviarVerificacion } from "../controllers/whatsapp.controller.js";

const router = express.Router();

router.post("/presentacion", enviarPresentacion);
router.post("/verificacion", enviarVerificacion);
router.post("/agendamiento", enviarAgendamiento);
// router.post("/agendamiento", enviarAgendamiento);

export default router;
