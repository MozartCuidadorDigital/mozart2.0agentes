import crypto from "crypto";
import moment from "moment-timezone";
import "moment/locale/es.js";
import { connectDB } from "../config/database.js";
import Metrica from "../models/MetricasLogs.js";

moment.locale("es");

// ── Helpers ──────────────────────────────────────────────────────────────────

function msToMMSS(ms) {
  if (ms == null || isNaN(ms)) return null;
  const totalSec = Math.floor(ms / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
  return `${pad(mm)}:${pad(ss)}`;
}

const norm = (s) => (typeof s === "string" ? s.trim() : s);

const postJson = async (url, body, label = "") => {
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "mozart-external-api-2024",
      },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    console.log(`🌐 [${label}] status=${resp.status}`);
    console.log(`🌐 [${label}] response=`, data);
    return { ok: resp.ok, status: resp.status, data };
  } catch (err) {
    console.error(`🔥 [${label}] error llamando API`, err);
    return { ok: false, error: err.message };
  }
};

function sumarPreciosLLM(bodyJson) {
  try {
    const llmUsage = bodyJson?.data?.metadata?.charging?.llm_usage;
    if (!llmUsage) return 0;
    let total = 0;
    Object.values(llmUsage).forEach((generationType) => {
      const modelUsage = generationType?.model_usage;
      if (!modelUsage) return;
      Object.values(modelUsage).forEach((modelData) => {
        Object.values(modelData).forEach((metric) => {
          if (metric?.price && typeof metric.price === "number") {
            total += metric.price;
          }
        });
      });
    });
    return total;
  } catch {
    return 0;
  }
}

function verifyHmac(req, secret) {
  const signatureHeader = req.headers["elevenlabs-signature"];
  if (!signatureHeader) return { ok: false, reason: "Missing signature" };

  const [tPart, v0Part] = signatureHeader.split(",");
  const timestamp = tPart.split("=")[1];
  const signature = v0Part.split("=")[1].trim();

  const rawBody = req.body.toString("utf8");
  const mac = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  if (signature !== mac) return { ok: false, reason: "Invalid signature" };
  return { ok: true, rawBody };
}

function detectChannel(bodyJson) {
  const callerId = norm(
    bodyJson.data?.conversation_initiation_client_data?.dynamic_variables?.system__caller_id
  );
  const calledNumber = norm(
    bodyJson.data?.conversation_initiation_client_data?.dynamic_variables?.system__called_number
  );
  const isPhone =
    (callerId && callerId.startsWith("+57")) ||
    (calledNumber && calledNumber.startsWith("+57"));
  return { channel: isPhone ? "llamada" : "whatsapp", callerId, calledNumber };
}

// ── Constants ────────────────────────────────────────────────────────────────

const HMAC_METRICA_FULL = "wsec_5d09ef28a5cdf0e060f91f6093ff9703314daad8b7b08059165f22a7b70aaf0c";
const HMAC_METRICA_TAMIZAJE = "wsec_2e4fddbb06e43a9b903cc5339846c32a1512f75553f1bd81ea59fff3a21c8a11";
const HMAC_METRICA_REPOSITORIO = "wsec_c9992285ec9ee5912403052b6baf8ac9aa6942df81d849eeb73541a55f82cf81";

// ── Handlers ─────────────────────────────────────────────────────────────────

export const responseMetricaFull = async (req, res) => {
  try {
    const hmac = verifyHmac(req, HMAC_METRICA_FULL);
    if (!hmac.ok) {
      console.error("❌ HMAC inválido:", hmac.reason);
      return res.status(hmac.reason === "Missing signature" ? 401 : 403).send(hmac.reason);
    }
    console.log("✅ Webhook auténtico de ElevenLabs (MetricaFull)");

    const bodyJson = JSON.parse(hmac.rawBody);

    const cleanTranscript = bodyJson.data.transcript
      .filter((t) => t.message && t.role)
      .map((t) => ({ role: t.role, message: t.message.trim() }));

    const prices = sumarPreciosLLM(bodyJson);
    console.log("💵 Total facturado llamada:", prices);

    const results = bodyJson.data.analysis.data_collection_results || {};
    const nombreLlamador = norm(results.nombreLlamador?.value);
    const nombrePaciente = norm(results.nombrePaciente?.value);
    const appointmentId  = norm(results.appointmentId?.value);
    const errorMessage   = norm(results.errorMessage?.value);
    const patientId      = norm(results.patientId?.value);
    const tenant         = norm(results.tenant?.value);
    const citaAgendada   = Boolean(results.citaAgendada?.value);

    const { channel, callerId } = detectChannel(bodyJson);
    const duracionLlamadaMs = bodyJson.data.metadata.call_duration_secs * 1000;
    const duracion = msToMMSS(duracionLlamadaMs);
    const soloTexto = Boolean(bodyJson.data.metadata.text_only);
    const isSuccess = Boolean(appointmentId) && citaAgendada === true;

    console.log("Exitoso?", isSuccess);
    console.log("Transcripcion: ", cleanTranscript);
    console.log("Duración interacción: ", duracionLlamadaMs);
    console.log("duracion min: ", duracion);

    // Guardar en MongoDB
    await connectDB();
    await Metrica.create({
      tenant,
      appointmentId,
      patientId,
      channel,
      direction: "Inbound",
      success: isSuccess,
      citaAgendada,
      nombrePaciente: nombreLlamador || nombrePaciente,
      duracionMs: duracionLlamadaMs,
      duracionFormat: duracion,
      soloTexto,
      costoLLM: prices,
      errorMessage: isSuccess ? null : errorMessage,
      transcript: cleanTranscript,
    });

    if (isSuccess) {
      await postJson(
        "https://api.salud.mozartai.com.co/api/external/update-call-duration",
        {
          tenant,
          appointmentId,
          channel,
          soloTexto,
          duracionLlamada: duracionLlamadaMs,
          transcript: JSON.stringify(cleanTranscript),
        },
        "update-call-duration"
      );
    } else {
      await postJson(
        "https://api.salud.mozartai.com.co/api/external/metric",
        {
          tenant,
          action: "appointment_created",
          channel,
          soloTexto,
          direction: "Inbound",
          patientId,
          duracion: duracionLlamadaMs,
          transcript: JSON.stringify(cleanTranscript),
          metadata: {
            patientName: nombreLlamador || nombrePaciente,
            callerId,
            success: false,
            errorMessage: errorMessage || "null",
          },
        },
        "metric"
      );
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Error procesando webhook MetricaFull:", err);
    return res.status(500).send("Internal error");
  }
};

export const responseMetricaTamizaje = async (req, res) => {
  try {
    const hmac = verifyHmac(req, HMAC_METRICA_TAMIZAJE);
    if (!hmac.ok) {
      console.error("❌ HMAC inválido:", hmac.reason);
      return res.status(hmac.reason === "Missing signature" ? 401 : 403).send(hmac.reason);
    }
    console.log("✅ Webhook auténtico de ElevenLabs (MetricaTamizaje)");

    const bodyJson = JSON.parse(hmac.rawBody);

    const cleanTranscript = bodyJson.data.transcript
      .filter((t) => t.message && t.role)
      .map((t) => ({ role: t.role, message: t.message.trim() }));

    const prices = sumarPreciosLLM(bodyJson);
    console.log("💵 Total facturado llamada:", prices);

    const results = bodyJson.data.analysis.data_collection_results || {};
    const tenant     = norm(results.tenant?.value);
    const tamizajeId = norm(results.tamizajeId?.value);

    const { channel } = detectChannel(bodyJson);
    const duracionLlamadaMs = bodyJson.data.metadata.call_duration_secs * 1000;
    const duracion = msToMMSS(duracionLlamadaMs);

    console.log("Transcripcion: ", cleanTranscript);
    console.log("Duración interacción: ", duracionLlamadaMs);
    console.log("duracion min: ", duracion);

    await postJson(
      "https://api.salud.mozartai.com.co/api/external/tamizaje-session",
      {
        tenant,
        tamizajeId,
        transcript: JSON.stringify(cleanTranscript),
        duracion: duracionLlamadaMs,
        canal: channel,
      },
      "tamizaje-session"
    );

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Error procesando webhook MetricaTamizaje:", err);
    return res.status(500).send("Internal error");
  }
};

export const responseMetricaRepositorio = async (req, res) => {
  try {
    const hmac = verifyHmac(req, HMAC_METRICA_REPOSITORIO);
    if (!hmac.ok) {
      console.error("❌ HMAC inválido:", hmac.reason);
      return res.status(hmac.reason === "Missing signature" ? 401 : 403).send(hmac.reason);
    }
    console.log("✅ Webhook auténtico de ElevenLabs (MetricaRepositorio)");

    const bodyJson = JSON.parse(hmac.rawBody);

    const cleanTranscript = bodyJson.data.transcript
      .filter((t) => t.message && t.role)
      .map((t) => ({ role: t.role, message: t.message.trim() }));

    const prices = sumarPreciosLLM(bodyJson);
    console.log("💵 Total facturado llamada:", prices);

    const results = bodyJson.data.analysis.data_collection_results || {};
    const tenant        = norm(results.tenant?.value);
    const repositorioId = norm(results.repositorioId?.value);

    const { channel } = detectChannel(bodyJson);
    const duracionLlamadaMs = bodyJson.data.metadata.call_duration_secs * 1000;
    const duracion = msToMMSS(duracionLlamadaMs);

    console.log("Transcripcion: ", cleanTranscript);
    console.log("Duración interacción: ", duracionLlamadaMs);
    console.log("duracion min: ", duracion);

    await postJson(
      "https://api.salud.mozartai.com.co/api/external/repositorio-session",
      {
        tenant,
        repositorioId,
        transcript: JSON.stringify(cleanTranscript),
        duracion: duracionLlamadaMs,
        canal: channel,
      },
      "repositorio-session"
    );

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Error procesando webhook MetricaRepositorio:", err);
    return res.status(500).send("Internal error");
  }
};