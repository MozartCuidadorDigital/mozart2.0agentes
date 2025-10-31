import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

export const obtenerConfigCliente = async (tenant) => {
  try {
    console.log("🔍 Consultando configuración de tenant:", tenant);

    const response = await axios.post(
      "https://new.api.mozartia.com/api/external/client-config",
      { tenant },
      {
        headers: {
          "x-api-key": process.env.MOZART_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ Respuesta completa del servidor:", response.data);

    if (!response.data?.data) {
      console.error("⚠️ No se encontró 'data' en la respuesta:", response.data);
      throw new Error("No se encontró configuración para el tenant.");
    }

    return response.data.data;
  } catch (error) {
    console.error(
      "❌ Error obteniendo config del cliente:",
      error.response?.data || error.message
    );
    throw new Error("Error al obtener configuración del cliente");
  }
};



