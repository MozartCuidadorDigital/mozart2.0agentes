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
              { type: "text", text: `${config.areas_especializacion}` },
              { type: "text", text: `${config.servicios}` },
            
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
 * obtenerpacienteporcedula
 */

const obtenerPacientePorCedula = async (cedula, tenant) => {
  try {
    console.log("🔎 Consultando paciente en Mozart:", cedula, tenant);

    const resp = await axios.post(
      "https://new.api.mozartia.com/api/external/patient-info",
      {
        tenant,
        identificacion: cedula,
      },
      {
        headers: {
          "x-api-key": process.env.MOZART_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    const data = resp?.data?.data;

    if (!data?.paciente) {
      throw new Error("Paciente no encontrado en Mozart");
    }

    return data; // 👈 paciente + citas + autorizaciones
  } catch (error) {
    console.error(
      "❌ Error real consultando paciente:",
      error.response?.data || error.message
    );
    throw new Error("Error consultando paciente en la API clínica");
  }
};




/**
 *  Enviar mensaje de agendamiento
 */
export const enviarAgendamiento = async (req, res) => {
  try {
    const { tenant, telefono, cedula } = req.body;

    if (!tenant || !telefono || !cedula) {
      return res.status(400).json({
        error: "Faltan datos requeridos: tenant, telefono o cedula",
      });
    }

    // 🔎 1. Obtener data clínica completa
    const pacienteData = await obtenerPacientePorCedula(cedula, tenant);

    const paciente = pacienteData.paciente;
    const historial = pacienteData?.citas?.historial || [];

    const nombrePaciente = `${paciente.firstName} ${paciente.lastName}`;

    // 🩺 2. Buscar citas pendientes por agendar
    const citasPendientes = historial.filter(
      (cita) => cita.estado === "PendienteAgendar"
    );

    if (citasPendientes.length === 0) {
      return res.status(404).json({
        error: "El paciente no tiene citas pendientes por agendar",
      });
    }

    // 👉 Tomamos la primera pendiente
    const cita = citasPendientes[0];

    const cups = cita?.especialidad || "Consulta médica";
    const servicio = cita?.servicio || "Servicio médico";

    // 🔧 3. Configuración del cliente
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

    // 📩 4. Payload WhatsApp
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
              { type: "text", text: `*${config.name}*` }, // {{1}} clínica
              { type: "text", text: nombrePaciente },     // {{2}} paciente
              { type: "text", text: cups },               // {{3}} cups
              { type: "text", text: servicio },           // {{4}} servicio
            ],
          },
        ],
      },
    };

    // 🚀 5. Enviar a Meta
    const metaResponse = await axios.post(urlMeta, data, {
      headers: {
        Authorization: `Bearer ${tokenMeta}`,
        "Content-Type": "application/json",
      },
    });

    return res.status(200).json({
      message: "Mensaje de agendamiento enviado correctamente",
      paciente: nombrePaciente,
      cups,
      servicio,
      citasPendientes: citasPendientes.length,
      metaResponse: metaResponse.data,
    });
  } catch (error) {
    console.error(
      "❌ Error enviando agendamiento:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      error: "No se pudo enviar el mensaje de agendamiento",
      details: error.response?.data || error.message,
    });
  }
};


/**
 *  Enviar mensaje de recordatorio de cita por WhatsApp
 */
export const enviarRecordatorioCita = async (req, res) => {
  try {
    const {
      tenant,
      telefono,
      cedula,
      nombrepaciente,
      nombredoctor,
      fecha,
      hora,
      lugar,
      especialidad,
    } = req.body;

    //  Validar campos requeridos
    if (
      !tenant ||
      !telefono ||
      !cedula ||
      !nombrepaciente ||
      !nombredoctor ||
      !fecha ||
      !hora ||
      !lugar ||
      !especialidad
    ) {
      return res.status(400).json({
        error:
          "Faltan datos requeridos: tenant, telefono, cedula, nombrepaciente, nombredoctor, fecha, hora, lugar o especialidad",
      });
    }

    // 🔧 Obtener configuración del cliente
    const config = await obtenerConfigCliente(tenant);
    if (!config) throw new Error("No se encontró configuración del cliente");

    //  Buscar configuración específica de recordatorios por WhatsApp
    const recordatorioWpp = config?.agendamiento?.recordatoriosUrls?.find(
      (c) => c.tipo === "wpp"
    );

    if (!recordatorioWpp) {
      return res.status(404).json({
        error: "No hay configuración de WhatsApp para recordatorio de cita",
      });
    }

    const { tokenMeta, urlMeta, nombreTemplate } = recordatorioWpp;

    //  Construir cuerpo del mensaje con los parámetros del template
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
              { type: "text", text: `*${config.name}*` }, // IPS/EPS
              { type: "text", text: nombrepaciente },
              { type: "text", text: nombredoctor },
              { type: "text", text: especialidad },
              { type: "text", text: fecha },
              { type: "text", text: hora },
              { type: "text", text: lugar },
            ],
          },
        ],
      },
    };

    //  Enviar mensaje a Meta API
    const metaResponse = await enviarTemplate(urlMeta, tokenMeta, data);

    //  Respuesta OK
    res.status(200).json({
      message: "Mensaje de recordatorio de cita enviado correctamente",
      tenant,
      telefono,
      metaResponse,
    });
  } catch (error) {
    console.error(
      " Error enviando recordatorio de cita:",
      error.response?.data || error.message
    );
    res.status(500).json({
      error: "No se pudo enviar el mensaje de recordatorio de cita",
      details: error.response?.data || error.message,
    });
  }
};








