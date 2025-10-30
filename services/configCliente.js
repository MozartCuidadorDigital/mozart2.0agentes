import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

/**
 * Obtiene la configuración completa de un tenant (IPS)
 * desde el servicio central Mozart.
 */
export const obtenerConfigCliente = async (tenant) => {
  try {
    const response = await axios.post(
      "https://mozart2-0back.vercel.app/api/external/client-config",
      { tenant },
      {
        headers: {
          "x-api-key": process.env.MOZART_API_KEY, // 🔐 Se agrega aquí
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.data?.data) {
      throw new Error("No se encontró configuración para el tenant.");
    }

    return response.data.data;
  } catch (error) {
    console.error("❌ Error obteniendo config del cliente:", error.response?.data || error.message);
    throw new Error("Error al obtener configuración del cliente");
  }
};

