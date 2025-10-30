import express from "express";
import { enviarPresentacion, enviarAgendamiento } from "../controllers/whatsapp.controller.js";

const router = express.Router();

// Endpoints separados
router.post("/presentacion", enviarPresentacion);
router.post("/agendamiento", enviarAgendamiento);

export default router;

