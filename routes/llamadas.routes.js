import express from "express";
import { llamadaPresentacion, llamadaAgendamiento } from "../controllers/llamadas.controller.js";

const router = express.Router();

// Endpoints separados
router.post("/presentacion", llamadaPresentacion);
router.post("/agendamiento", llamadaAgendamiento);

export default router;


