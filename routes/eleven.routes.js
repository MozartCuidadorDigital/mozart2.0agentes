import { Router } from "express";
import express from "express";
import {
  responseMetricaFull,
  responseMetricaTamizaje,
  responseMetricaRepositorio,
} from "../controllers/eleven.controller.js";

const router = Router();
const rawBody = express.raw({ type: "application/json", limit: "10mb" });

router.post("/responseMetricaFull", rawBody, responseMetricaFull);
router.post("/responseMetricaTamizaje", rawBody, responseMetricaTamizaje);
router.post("/responseMetricaRepositorio", rawBody, responseMetricaRepositorio);

export default router;