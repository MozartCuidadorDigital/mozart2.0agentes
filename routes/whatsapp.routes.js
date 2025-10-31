import express from "express";
import {
  enviarPresentacion,
  enviarVerificacion,
  enviarAgendamiento,
} from "../controllers/whatsapp.controller.js";

const router = express.Router();

router.post("/presentacion", enviarPresentacion);
router.post("/verificacion", enviarVerificacion);
router.post("/agendamiento", enviarAgendamiento);

export default router;



