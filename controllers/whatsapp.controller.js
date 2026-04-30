import axios from "axios";
import { obtenerConfigCliente } from "../services/configCliente.js";
import dotenv from "dotenv";
dotenv.config();

/**
 *  Función genérica para enviar templates a la API de WhatsApp (Meta)
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
 *  Enviar mensaje de presentación por WhatsApp
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
 *  Enviar mensaje de verificación de datos
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
    console.log(" Consultando paciente en Mozart:", cedula, tenant);

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

    return data; //  paciente + citas + autorizaciones
  } catch (error) {
    console.error(
      " Error real consultando paciente:",
      error.response?.data || error.message
    );
    throw new Error("Error consultando paciente en la API clínica");
  }
};




/**
 * Enviar mensaje de agendamiento
 */
export const enviarAgendamiento = async (req, res) => {
  try {
    const { tenant, telefono, cedula, citaId } = req.body;

    if (!tenant || !telefono || !cedula || !citaId) {
      return res.status(400).json({
        error: "Faltan datos requeridos: tenant, telefono, cedula, citaId",
      });
    }

    //  1. Paciente desde Mozart
    const respPaciente = await axios.post(
      "https://new.api.mozartia.com/api/external/patient-info",
      { tenant, identificacion: cedula },
      {
        headers: {
          "x-api-key": process.env.MOZART_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    const dataPaciente = respPaciente?.data?.data;
    const paciente = dataPaciente?.paciente;

    if (!paciente) throw new Error("Paciente no encontrado");

    const nombrePaciente = `${paciente.firstName} ${paciente.lastName}`;

    //  2. Buscar la cita EXACTA por ID
    const historial = dataPaciente?.citas?.historial || [];

    const cita = historial.find((c) => c.id === citaId);

    if (!cita) {
      return res.status(404).json({
        error: "No se encontró la cita seleccionada",
      });
    }

    const cups = cita.especialidad || "Sin CUPS";
    const servicio = cita.servicio || "Servicio médico";

    console.log(" CITA SELECCIONADA:", { cups, servicio });

    // 🔧 3. Configuración del cliente
    const config = await obtenerConfigCliente(tenant);

    const agendamientoWpp = config?.agendamiento?.agendamientoCitasUrls?.find(
      (c) => c.tipo === "wpp"
    );

    if (!agendamientoWpp) {
      return res.status(404).json({
        error: "No hay configuración de WhatsApp para agendamiento",
      });
    }

    const { tokenMeta, urlMeta, nombreTemplate } = agendamientoWpp;

    //  4. Payload WhatsApp
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
              { type: "text", text: `*${config.name}*` }, // {{1}}
              { type: "text", text: nombrePaciente },      // {{2}}
              { type: "text", text: cups },                // {{3}}
              { type: "text", text: servicio },            // {{4}}
            ],
          },
        ],
      },
    };

    //  5. Enviar a Meta
    const metaResponse = await axios.post(urlMeta, data, {
      headers: {
        Authorization: `Bearer ${tokenMeta}`,
        "Content-Type": "application/json",
      },
    });

    return res.status(200).json({
      message: "Mensaje enviado correctamente",
      paciente: nombrePaciente,
      cups,
      servicio,
      metaResponse: metaResponse.data,
    });
  } catch (error) {
    console.error(
      " Error enviando agendamiento:",
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
      especialidad
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

    //  Obtener configuración del cliente
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
/**
 * Enviar citas pendientes (máximo 5) por WhatsApp
 */
export const enviarCitasPendientes = async (req, res) => {
  try {
    const { tenant, telefono, cedula } = req.body;

    if (!tenant || !telefono || !cedula) {
      return res.status(400).json({
        error: "Faltan datos requeridos: tenant, telefono, cedula",
      });
    }

    const WHATSAPP_META_TOKEN = process.env.WHATSAPP_META_TOKEN;
    const WHATSAPP_META_URL = process.env.WHATSAPP_META_URL;

    // 1️⃣ Consultar paciente en Mozart
    const respPaciente = await axios.post(
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

    const dataPaciente = respPaciente?.data?.data;
    const paciente = dataPaciente?.paciente;

    if (!paciente) throw new Error("Paciente no encontrado");

    const nombrePaciente = `${paciente.firstName} ${paciente.lastName}`.trim();

    const historial = dataPaciente?.citas?.historial || [];

    // 2️⃣ Filtrar citas pendientes
    const citasPendientes = historial
      .filter((c) => c.estado === "PendienteAgendar")
      .slice(0, 5);

    if (citasPendientes.length === 0) {
      return res.status(200).json({
        message: "El paciente no tiene citas pendientes",
      });
    }

    // 3️⃣ Obtener especialidades numeradas
    const especialidades = citasPendientes.map(
      (c, i) => `${i + 1}. ${c.especialidad || "Consulta médica"}`
    );

    // completar hasta 5 para el template
    while (especialidades.length < 5) {
      especialidades.push(" ");
    }

    console.log("CITAS PENDIENTES:", especialidades);

    // 4️⃣ Payload WhatsApp
    const data = {
      messaging_product: "whatsapp",
      to: telefono,
      type: "template",
      template: {
        name: "roche_plan_de_manejo",
        language: {
          code: "en",
        },
        components: [
          {
            type: "header",
            parameters: [
              {
                type: "image",
                image: {
                  link: "https://mozartimages-1.s3.us-east-1.amazonaws.com/Logo_Roche.PNG",
                },
              },
            ],
          },
          {
            type: "body",
            parameters: [
              { type: "text", text: ` ${nombrePaciente} ` },
              { type: "text", text: especialidades[0] },
              { type: "text", text: especialidades[1] },
              { type: "text", text: especialidades[2] },
              { type: "text", text: especialidades[3] },
              { type: "text", text: especialidades[4] },
            ],
          },
        ],
      },
    };

    // 5️⃣ Enviar a WhatsApp (Meta)
    const metaResponse = await axios.post(
      WHATSAPP_META_URL,
      data,
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_META_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    return res.status(200).json({
      message: "Mensaje de citas pendientes enviado correctamente",
      paciente: nombrePaciente,
      especialidades,
      metaResponse: metaResponse.data,
    });

    
  } catch (error) {
    console.error(
      "Error enviando citas pendientes:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      error: "No se pudo enviar el mensaje de citas pendientes",
      details: error.response?.data || error.message,
    });
  }
}; 








