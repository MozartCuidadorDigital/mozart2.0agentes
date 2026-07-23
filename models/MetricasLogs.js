import mongoose from "mongoose";

const MetricaSchema = new mongoose.Schema(
  {
    tenant: { type: String, index: true, required: true },
    appointmentId: { type: String },
    patientId: { type: String },
    channel: { type: String, enum: ["llamada", "whatsapp"] },
    direction: { type: String, default: "Inbound" },
    success: { type: Boolean, required: true },
    citaAgendada: { type: Boolean },
    nombrePaciente: { type: String },
    duracionMs: { type: Number },
    duracionFormat: { type: String },
    soloTexto: { type: Boolean },
    costoLLM: { type: Number, default: 0 },
    errorMessage: { type: String },
    transcript: { type: Array },
    raw: { type: Object },
  },
  { timestamps: true }
);

export default mongoose.model("Metrica", MetricaSchema);