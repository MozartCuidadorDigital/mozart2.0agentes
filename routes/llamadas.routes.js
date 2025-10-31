import express from "express";
import { enviarLlamadaPresentacion } from "../controllers/llamadas.controller.js";

const router = express.Router();

router.post("/presentacion", enviarLlamadaPresentacion);

export default router;



