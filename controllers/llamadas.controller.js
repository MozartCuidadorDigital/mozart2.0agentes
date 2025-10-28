import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

// 🔹 Configuración de agentes por tipo de llamada
const agentes = {
  presentacion: {
    agent_id: process.env.AGENT_ID_PRESENTACION,
    agent_phone_number_id: process.env.AGENT_PHONE_PRESENTACION,
  },
  agendamiento: {
    agent_id: process.env.AGENT_ID_AGENDAMIENTO,
    agent_phone_number_id: process.env.AGENT_PHONE_AGENDAMIENTO,
  },
};


// ✅ Llamada de presentación
export const llamadaPresentacion = async (req, res) => {
  try {
    const { tenant, paciente } = req.body;

    if (!tenant || !paciente) {
      return res.status(400).json({ error: "Faltan datos requeridos: tenant o paciente" });
    }

    const agente = agentes.presentacion;

    const data = {
      agent_id: agente.agent_id,
      agent_phone_number_id: agente.agent_phone_number_id,
      to_number: `+${paciente}`,
    };

    const response = await axios.post(
      "https://api.elevenlabs.io/v1/convai/twilio/outbound-call",
      data,
      {
        headers: {
          "xi-api-key": process.env.ELEVEN_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    res.status(200).json({
      message: "📞 Llamada de presentación iniciada correctamente",
      tenant,
      to: `+${paciente}`,
      metaResponse: response.data,
    });
  } catch (error) {
    console.error("❌ Error en llamada de presentación:", error.response?.data || error.message);
    res.status(500).json({
      error: "No se pudo iniciar la llamada de presentación",
      details: error.response?.data || error.message,
    });
  }
};

// ✅ Llamada de agendamiento
export const llamadaAgendamiento = async (req, res) => {
  try {
    const { tenant, paciente } = req.body;

    if (!tenant || !paciente) {
      return res.status(400).json({ error: "Faltan datos requeridos: tenant o paciente" });
    }

    const agente = agentes.agendamiento;

    const data = {
      agent_id: agente.agent_id,
      agent_phone_number_id: agente.agent_phone_number_id,
      to_number: `+${paciente}`,
    };

    const response = await axios.post(
      "https://api.elevenlabs.io/v1/convai/twilio/outbound-call",
      data,
      {
        headers: {
          "xi-api-key": process.env.ELEVEN_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    res.status(200).json({
      message: "📞 Llamada de agendamiento iniciada correctamente",
      tenant,
      to: `+${paciente}`,
      metaResponse: response.data,
    });
  } catch (error) {
    console.error("❌ Error en llamada de agendamiento:", error.response?.data || error.message);
    res.status(500).json({
      error: "No se pudo iniciar la llamada de agendamiento",
      details: error.response?.data || error.message,
    });
  }
};

