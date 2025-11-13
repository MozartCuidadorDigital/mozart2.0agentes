import express from "express";
import { enviarLlamadaPresentacion,
      enviarLlamadaAgendamiento,
      enviarLlamadaRecordatorioCita,
} from "../controllers/llamadas.controller.js";

const router = express.Router();

router.post("/presentacion", enviarLlamadaPresentacion);
router.post("/agendamiento", enviarLlamadaAgendamiento);
router.post("/recordatoriocita", enviarLlamadaRecordatorioCita);


export default router;



