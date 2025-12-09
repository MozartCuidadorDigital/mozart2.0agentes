import express from "express";
import { dispararLlamadaConnect } from "../controllers/llamadasConnect.controller.js";

const router = express.Router();

// Ruta genérica (body libre)
router.post("/outbound", dispararLlamadaConnect);

export default router;
