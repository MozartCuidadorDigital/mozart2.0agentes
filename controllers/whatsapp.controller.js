import axios from "axios";
import { obtenerConfigCliente } from "../services/configCliente.js";
import dotenv from "dotenv";
dotenv.config();

/**
 * Envía un mensaje de WhatsApp con un template predefinido,
 * usando la configuración dinámica del tenant.
 */
const enviarTemplate = async (urlMeta, tokenMeta, data) => {
  const response = await axios.post(urlMeta, data, {
    headers: {
      Authorization: `Bearer ${tokenMeta}`,
      "Content-Type": "application/json",
    },
  });
  return response.data;
};

/**
 * 📲 Mensaje de presentación (WhatsApp)
 */
export const enviarPresentacion = async (req, res) => {
  try {
    const { tenant, paciente } = req.body;
    if (!tenant || !paciente) {
      return res.status(400).json({ error: "Faltan datos requeridos: tenant o paciente" });
    }

    // 1️⃣ Obtener configuración del cliente
    const config = await obtenerConfigCliente(tenant);

    const { tokenMeta, urlMeta } = config;
    const templateConfig = config?.presentacion?.find((c) => c.tipo === "wpp");

    if (!templateConfig) {
      return res.status(404).json({ error: "No hay template de WhatsApp para presentación" });
    }

    // 2️⃣ Construir cuerpo dinámico para WhatsApp
    const data = {
      messaging_product: "whatsapp",
      to: paciente,
      type: "template",
      template: {
        name: templateConfig.nombreTemplate,
        language: { code: templateConfig.idioma || "es" },
        components: [
          {
            type: "header",
            parameters: [
              {
                type: "image",
                image: { link: config.logo || "https://mozartimages.s3.us-east-1.amazonaws.com/Logo_Mozart_color.png" },
              },
            ],
          },
          {
            type: "body",
            parameters: [
              { type: "text", text: `*IPS ${tenant.toUpperCase()}*` },
              { type: "text", text: "servicios especializados de salud" },
              { type: "text", text: "agendamiento de citas y verificación de datos" },
            ],
          },
        ],
      },
    };

    // 3️⃣ Enviar mensaje
    const metaResponse = await enviarTemplate(urlMeta, tokenMeta, data);

    res.status(200).json({
      message: "📲 Mensaje de presentación enviado correctamente",
      tenant,
      to: paciente,
      metaResponse,
    });
  } catch (error) {
    console.error("❌ Error enviando mensaje de presentación:", error.response?.data || error.message);
    res.status(500).json({
      error: "No se pudo enviar el mensaje de presentación",
      details: error.response?.data || error.message,
    });
  }
};

/**
 * 📲 Mensaje de agendamiento (WhatsApp)
 */
export const enviarAgendamiento = async (req, res) => {
  try {
    const { tenant, paciente } = req.body;
    if (!tenant || !paciente) {
      return res.status(400).json({ error: "Faltan datos requeridos: tenant o paciente" });
    }

    // 1️⃣ Obtener configuración del cliente
    const config = await obtenerConfigCliente(tenant);

    const { tokenMeta, urlMeta } = config;
    const templateConfig = config?.agendamiento?.find((c) => c.tipo === "wpp");

    if (!templateConfig) {
      return res.status(404).json({ error: "No hay template de WhatsApp para agendamiento" });
    }

    // 2️⃣ Construir cuerpo dinámico
    const data = {
      messaging_product: "whatsapp",
      to: paciente,
      type: "template",
      template: {
        name: templateConfig.nombreTemplate,
        language: { code: templateConfig.idioma || "es" },
        components: [
          {
            type: "header",
            parameters: [
              {
                type: "image",
                image: { link: config.logo || "https://mozartimages.s3.us-east-1.amazonaws.com/Logo_Mozart_color.png" },
              },
            ],
          },
          {
            type: "body",
            parameters: [
              { type: "text", text: `*IPS ${tenant.toUpperCase()}*` },
              { type: "text", text: "gracias por agendar con nosotros." },
            ],
          },
        ],
      },
    };

    // 3️⃣ Enviar mensaje
    const metaResponse = await enviarTemplate(urlMeta, tokenMeta, data);

    res.status(200).json({
      message: "📲 Mensaje de agendamiento enviado correctamente",
      tenant,
      to: paciente,
      metaResponse,
    });
  } catch (error) {
    console.error("❌ Error enviando mensaje de agendamiento:", error.response?.data || error.message);
    res.status(500).json({
      error: "No se pudo enviar el mensaje de agendamiento",
      details: error.response?.data || error.message,
    });
  }
};



