import express from "express";
import { enviarLlamadaPresentacion,
      enviarLlamadaAgendamiento,
} from "../controllers/llamadas.controller.js";

const router = express.Router();

router.post("/presentacion", enviarLlamadaPresentacion);
router.post("/agendamiento", enviarLlamadaAgendamiento);

export default router;



