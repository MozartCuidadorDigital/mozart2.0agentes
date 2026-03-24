import express from "express";
import { enviarLlamadaPresentacion, enviarLlamadaAgendamiento, enviarLlamadaRecordatorioCita,
      pruebaLlamadaAgendamiento, enviarLlamadaRecordatorioMedicamento, enviarLlamadaTamizaje,
      enviarLlamadaCentroDiesel,
      
} from "../controllers/llamadas.controller.js";

const router = express.Router();

router.post("/presentacion", enviarLlamadaPresentacion);
router.post("/agendamiento", enviarLlamadaAgendamiento);
router.post("/recordatoriocita", enviarLlamadaRecordatorioCita);
router.post("/Pruebagendamiento", pruebaLlamadaAgendamiento);
router.post("/recordatoriomedicamento", enviarLlamadaRecordatorioMedicamento);
router.post("/Tamizaje", enviarLlamadaTamizaje );

router.post("/llamadaCentroDiesel", enviarLlamadaCentroDiesel);


export default router;



