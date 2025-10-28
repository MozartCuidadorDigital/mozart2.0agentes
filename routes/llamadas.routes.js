import express from "express";
import { llamadaPresentacion, llamadaAgendamiento } from "../controllers/llamadas.controller.js";

const router = express.Router();

// Endpoints separados (cada uno con su agente)
router.post("/presentacion", llamadaPresentacion);
router.post("/agendamiento", llamadaAgendamiento);

export default router;

