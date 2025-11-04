import axios from "axios";
import { obtenerConfigCliente } from "../services/configCliente.js";
import dotenv from "dotenv";
dotenv.config();

/**
 * 🔧 Función genérica para enviar templates a la API de WhatsApp (Meta)
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
 * 📲 Enviar mensaje de presentación por WhatsApp
 */
export const enviarPresentacion = async (req, res) => {
  try {
    const { tenant, telefono, cedula } = req.body;

    if (!tenant || !telefono || !cedula) {
      return res
        .status(400)
        .json({ error: "Faltan datos requeridos: tenant, telefono o cedula" });
    }

    const config = await obtenerConfigCliente(tenant);
    if (!config) throw new Error("No se encontró configuración del cliente");

    const presentacionWpp = config?.agendamiento?.presentacionUrls?.find(
      (c) => c.tipo === "wpp"
    );
    if (!presentacionWpp) {
      return res
        .status(404)
        .json({ error: "No hay configuración de WhatsApp para presentación" });
    }

    const { tokenMeta, urlMeta, nombreTemplate } = presentacionWpp;

    const data = {
      messaging_product: "whatsapp",
      to: telefono,
      type: "template",
      template: {
        name: nombreTemplate,
        language: { code: "en" },
        components: [
          {
            type: "header",
            parameters: [
              {
                type: "image",
                image: {
                  link:
                    config.url_imagen_wpp ||
                    "https://mozartimages.s3.us-east-1.amazonaws.com/Logo_Mozart_color.png",
                },
              },
            ],
          },
          {
            type: "body",
            parameters: [
              { type: "text", text: `*${config.name}*` },
              { type: "text", text: `Cédula: ${cedula}` },
              {
                type: "text",
                text:
                  config.presentacion ||
                  "Soy tu asistente Mozart, estoy aquí para ayudarte con tus citas médicas.",
              },
            ],
          },
        ],
      },
    };

    const metaResponse = await enviarTemplate(urlMeta, tokenMeta, data);
    res.status(200).json({
      message: " Mensaje de presentación enviado correctamente",
      tenant,
      telefono,
      cedula,
      metaResponse,
    });
  } catch (error) {
    console.error(
      " Error enviando mensaje de presentación:",
      error.response?.data || error.message
    );
    res.status(500).json({
      error: "No se pudo enviar el mensaje de presentación",
      details: error.response?.data || error.message,
    });
  }
};

/**
 * 📋 Enviar mensaje de verificación de datos
 */
export const enviarVerificacion = async (req, res) => {
  try {
    const { tenant, telefono, cedula } = req.body;

    if (!tenant || !telefono || !cedula) {
      return res
        .status(400)
        .json({ error: "Faltan datos requeridos: tenant, telefono o cedula" });
    }

    const config = await obtenerConfigCliente(tenant);
    if (!config) throw new Error("No se encontró configuración del cliente");

    const verificacionWpp = config?.agendamiento?.verificacionDatosUrls?.find(
      (c) => c.tipo === "wpp"
    );
    if (!verificacionWpp) {
      return res
        .status(404)
        .json({ error: "No hay configuración de WhatsApp para verificación" });
    }

    const { tokenMeta, urlMeta, nombreTemplate } = verificacionWpp;

    const data = {
      messaging_product: "whatsapp",
      to: telefono,
      type: "template",
      template: {
        name: nombreTemplate,
        language: { code: "en" },
        components: [
          {
            type: "header",
            parameters: [
              {
                type: "image",
                image: {
                  link:
                    config.url_imagen_wpp ||
                    "https://mozartimages.s3.us-east-1.amazonaws.com/Logo_Mozart_color.png",
                },
              },
            ],
          },
          {
            type: "body",
            parameters: [
              {
                type: "text",
                text: `*${config.name}*`,
              },
            ],
          },
        ],
      },
    };

    const metaResponse = await enviarTemplate(urlMeta, tokenMeta, data);
    res.status(200).json({
      message: " Mensaje de verificación enviado correctamente",
      tenant,
      telefono,
      cedula,
      metaResponse,
    });
  } catch (error) {
    console.error(
      " Error enviando verificación:",
      error.response?.data || error.message
    );
    res.status(500).json({
      error: "No se pudo enviar el mensaje de verificación",
      details: error.response?.data || error.message,
    });
  }
};

/**
 *  Enviar mensaje de agendamiento
 */
export const enviarAgendamiento = async (req, res) => {
  try {
    const { tenant, telefono, cedula} = req.body;

    if (!tenant || !telefono || !cedula ) {
      return res.status(400).json({
        error: "Faltan datos requeridos: tenant, telefono, cedula",
      });
    }

    const config = await obtenerConfigCliente(tenant);
    if (!config) throw new Error("No se encontró configuración del cliente");

    const agendamientoWpp = config?.agendamiento?.agendamientoCitasUrls?.find(
      (c) => c.tipo === "wpp"
    );
    if (!agendamientoWpp) {
      return res.status(404).json({
        error: "No hay configuración de WhatsApp para agendamiento",
      });
    }

    const { tokenMeta, urlMeta, nombreTemplate } = agendamientoWpp;

    const data = {
      messaging_product: "whatsapp",
      to: telefono,
      type: "template",
      template: {
        name: nombreTemplate,
        language: { code: "en" },
        components: [
          {
            type: "header",
            parameters: [
              {
                type: "image",
                image: {
                  link:
                    config.url_imagen_wpp ||
                    "https://mozartimages.s3.us-east-1.amazonaws.com/Logo_Mozart_color.png",
                },
              },
            ],
          },
          {
            type: "body",
            parameters: [
              {
                type: "text",
                text: `*${config.name}*`,
              },
            ],
          },
        ],
      },
    };

    const metaResponse = await enviarTemplate(urlMeta, tokenMeta, data);
    res.status(200).json({
      message: " Mensaje de agendamiento enviado correctamente",
      tenant,
      telefono,
      cedula,
      metaResponse,
    });
  } catch (error) {
    console.error(
      " Error enviando agendamiento:",
      error.response?.data || error.message
    );
    res.status(500).json({
      error: "No se pudo enviar el mensaje de agendamiento",
      details: error.response?.data || error.message,
    });
  }
};






