import express from "express";
import { enviarPresentacion } from "../controllers/whatsapp.controller.js";

const router = express.Router();

router.post("/presentacion", enviarPresentacion);

export default router;
