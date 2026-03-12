import express from "express";
import {
  enviarPresentacion,
  enviarVerificacion,
  enviarAgendamiento,
  enviarRecordatorioCita,
  enviarCitasPendientes,
} from "../controllers/whatsapp.controller.js";

const router = express.Router();

router.post("/presentacion", enviarPresentacion);
router.post("/verificacion", enviarVerificacion);
router.post("/agendamiento", enviarAgendamiento);
router.post("/recordatoriocita", enviarRecordatorioCita);
router.post("/citapendiente", enviarCitasPendientes);

export default router;



