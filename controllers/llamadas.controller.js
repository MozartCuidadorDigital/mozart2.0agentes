import axios from "axios";
import dotenv from "dotenv";
import { obtenerConfigCliente } from "../services/configCliente.js";
dotenv.config();

/**
 * 🔧 Función genérica para ejecutar llamadas con ElevenLabs
 */
const ejecutarLlamada = async (agent_id, agent_phone_number_id, numeroDestino) => {
  const data = {
    agent_id,
    agent_phone_number_id,
    to_number: numeroDestino.startsWith("+") ? numeroDestino : `+${numeroDestino}`,
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
 * 📞 Enviar llamada de presentación
 * Requiere: tenant, telefono, cedula
 */
export const enviarLlamadaPresentacion = async (req, res) => {
  try {
    const { tenant, telefono, cedula } = req.body;

    if (!tenant || !telefono || !cedula) {
      return res.status(400).json({
        error: "Faltan datos requeridos: tenant, telefono o cedula",
      });
    }

    // 1️⃣ Obtener la configuración del cliente desde la base de datos
    const config = await obtenerConfigCliente(tenant);
    if (!config) throw new Error("No se encontró configuración del cliente");

    // 2️⃣ Buscar la configuración del tipo 'llamada'
    const llamadaConfig = config?.agendamiento?.presentacionUrls?.find(
      (c) => c.tipo === "llamada"
    );

    if (!llamadaConfig) {
      return res.status(404).json({
        error: "No hay configuración de llamada para presentación",
      });
    }

    const { codigoTelefono, idAgente } = llamadaConfig;

    if (!process.env.ELEVEN_API_KEY) {
      throw new Error("Falta ELEVEN_API_KEY en el archivo .env");
    }

    // 3️⃣ Ejecutar la llamada
    const resultado = await ejecutarLlamada(idAgente, codigoTelefono, telefono);

    // 4️⃣ Responder al cliente
    res.status(200).json({
      success: true,
      message: "📞 Llamada de presentación iniciada correctamente",
      tenant,
      telefono,
      cedula,
      resultado,
    });
  } catch (error) {
    console.error("❌ Error enviando llamada:", error.response?.data || error.message);
    res.status(500).json({
      error: "No se pudo iniciar la llamada de presentación",
      details: error.response?.data || error.message,
    });
  }
};



