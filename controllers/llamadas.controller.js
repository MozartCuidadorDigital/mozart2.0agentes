import axios from "axios";
import { obtenerConfigCliente } from "../services/configCliente.js";
import dotenv from "dotenv";
dotenv.config();

/**
 * Lógica genérica para hacer una llamada usando ElevenLabs.
 */
const ejecutarLlamada = async (agent_id, agent_phone_number_id, paciente) => {
  const data = {
    agent_id,
    agent_phone_number_id,
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

  return response.data;
};

/**
 * 📞 Llamada de presentación
 */
export const llamadaPresentacion = async (req, res) => {
  try {
    const { tenant, paciente } = req.body;
    if (!tenant || !paciente) {
      return res.status(400).json({ error: "Faltan datos requeridos: tenant o paciente" });
    }

    // 1️⃣ Obtener configuración del cliente
    const config = await obtenerConfigCliente(tenant);

    // 2️⃣ Buscar el agente de tipo 'presentacion' y 'llamada'
    const presentacionConfig = config?.presentacion?.find((c) => c.tipo === "llamada");
    if (!presentacionConfig) {
      return res.status(404).json({ error: "No hay configuración de llamada de presentación" });
    }

    // 3️⃣ Ejecutar la llamada con los datos obtenidos
    const metaResponse = await ejecutarLlamada(
      presentacionConfig.idAgente,
      presentacionConfig.codigoTelefono,
      paciente
    );

    res.status(200).json({
      message: "📞 Llamada de presentación iniciada correctamente",
      tenant,
      to: `+${paciente}`,
      metaResponse,
    });
  } catch (error) {
    console.error("❌ Error en llamada de presentación:", error.response?.data || error.message);
    res.status(500).json({
      error: "No se pudo iniciar la llamada de presentación",
      details: error.response?.data || error.message,
    });
  }
};

/**
 * 📞 Llamada de agendamiento
 */
export const llamadaAgendamiento = async (req, res) => {
  try {
    const { tenant, paciente } = req.body;
    if (!tenant || !paciente) {
      return res.status(400).json({ error: "Faltan datos requeridos: tenant o paciente" });
    }

    // 1️⃣ Obtener configuración del cliente
    const config = await obtenerConfigCliente(tenant);

    // 2️⃣ Buscar el agente de tipo 'agendamiento' y 'llamada'
    const agendamientoConfig = config?.agendamiento?.find((c) => c.tipo === "llamada");
    if (!agendamientoConfig) {
      return res.status(404).json({ error: "No hay configuración de llamada de agendamiento" });
    }

    // 3️⃣ Ejecutar la llamada
    const metaResponse = await ejecutarLlamada(
      agendamientoConfig.idAgente,
      agendamientoConfig.codigoTelefono,
      paciente
    );

    res.status(200).json({
      message: "📞 Llamada de agendamiento iniciada correctamente",
      tenant,
      to: `+${paciente}`,
      metaResponse,
    });
  } catch (error) {
    console.error("❌ Error en llamada de agendamiento:", error.response?.data || error.message);
    res.status(500).json({
      error: "No se pudo iniciar la llamada de agendamiento",
      details: error.response?.data || error.message,
    });
  }
};


