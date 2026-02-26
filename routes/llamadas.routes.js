import express from "express";
import { enviarLlamadaPresentacion, enviarLlamadaAgendamiento, enviarLlamadaRecordatorioCita,
      pruebaLlamadaAgendamiento, enviarLlamadaRecordatorioMedicamento,
      
} from "../controllers/llamadas.controller.js";

const router = express.Router();

router.post("/presentacion", enviarLlamadaPresentacion);
router.post("/agendamiento", enviarLlamadaAgendamiento);
router.post("/recordatoriocita", enviarLlamadaRecordatorioCita);
router.post("/Pruebagendamiento", pruebaLlamadaAgendamiento);
router.post("/recordatoriomedicamento", enviarLlamadaRecordatorioMedicamento);


export default router;



