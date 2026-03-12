import axios from "axios";
import dotenv from "dotenv";
import { obtenerConfigCliente } from "../services/configCliente.js";
dotenv.config();

/**
 *  Función genérica para ejecutar llamadas con ElevenLabs
 */
const ejecutarLlamada = async (
  agent_id,
  agent_phone_number_id,
  numeroDestino,
  dynamicVariables
) => {
  const data = {
    agent_id,
    agent_phone_number_id,
    to_number: numeroDestino.startsWith("+") ? numeroDestino : `+${numeroDestino}`,
    conversation_initiation_client_data: {
      dynamic_variables: dynamicVariables,
    },
  };

  const response = await axios.post(
    "https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call",
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
 *  Enviar llamada de presentación
 * Requiere: tenant, telefono, cedula
 */
export const enviarLlamadaPresentacion = async (req, res) => {
  try {
    const { tenant, telefono, identificadorId, nombreCompleto } = req.body;

    if (!tenant || !telefono || !identificadorId || !nombreCompleto ) {
      return res.status(400).json({
        error: "Faltan datos requeridos: tenant, telefono, identificadorId o nombreCompleto",
      });
    }

    // 1️ Obtener configuración del cliente desde la base de datos
    const config = await obtenerConfigCliente(tenant);
    if (!config) throw new Error("No se encontró configuración del cliente");

    // 2️ Buscar la configuración del tipo 'llamada'
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

    // 3️ Construir variables dinámicas desde la base de datos
    const dynamicVariables = {
      nombre_cliente: config.name ||  
      tenant,
      identificadorId,
      nombreCompleto,
      areas_especializacion: config.areas_especializacion || "",
      informacion_general: config.informacion_general || "" ,
      servicios: config.servicios || "",
      presentacion: config.presentacion ||"",
      
    };

    console.log(" Enviando llamada con datos:", {
      idAgente,
      codigoTelefono,
      telefono,
      dynamicVariables,
    });

    // 4️⃣ Ejecutar la llamada
    const resultado = await ejecutarLlamada(
      idAgente,
      codigoTelefono,
      telefono,
      dynamicVariables
    );

    // 5️⃣ Responder al cliente
    res.status(200).json({
      success: true,
      message: "📲 Llamada de presentación iniciada correctamente",
      tenant,
      telefono,
      identificadorId,
      nombreCompleto,
      resultado,
    });
  } catch (error) {
    console.error(" Error enviando llamada:", error.response?.data || error.message);
    res.status(500).json({
      error: "No se pudo iniciar la llamada de presentación",
      details: error.response?.data || error.message,
    });
  }
};


/**
 *  Enviar llamada de agendamiento
 * Requiere: tenant, telefono, cedula
 */
export const enviarLlamadaAgendamiento = async (req, res) => {
  try {
    const { tenant, telefono, cedula } = req.body;

    if (!tenant || !telefono || !cedula) {
      return res.status(400).json({
        error: "Faltan datos requeridos: tenant, telefono o cedula",
      });
    }

    // 1️ Obtener configuración del cliente
    const config = await obtenerConfigCliente(tenant);
    if (!config) throw new Error("No se encontró configuración del cliente");

    // 2️ Buscar dentro del bloque agendamiento.agendamientoCitasUrls
    const llamadaConfig = config?.agendamiento?.agendamientoCitasUrls?.find(
      (c) => c.tipo === "llamada"
    );

    if (!llamadaConfig) {
      return res.status(404).json({
        error: "No hay configuración de llamada para agendamiento",
      });
    }

    const { codigoTelefono, idAgente } = llamadaConfig;

    if (!process.env.ELEVEN_API_KEY) {
      throw new Error("Falta ELEVEN_API_KEY en el archivo .env");
    }

    // 3️⃣ Variables dinámicas solo con lo necesario
    const dynamicVariables = {
      nombre_cliente: config.nombre_cliente || "",
      tenant: config.tenant || "",
    };

    console.log(" Enviando llamada de agendamiento con datos:", {
      idAgente,
      codigoTelefono,
      telefono,
      dynamicVariables,
    });

    const resultado = await ejecutarLlamada(
      idAgente,
      codigoTelefono,
      telefono,
      dynamicVariables
    );

    res.status(200).json({
      success: true,
      message: " Llamada de agendamiento iniciada correctamente",
      tenant,
      telefono,
      cedula,
      resultado,
    });
  } catch (error) {
    console.error(" Error enviando llamada de agendamiento:", error.response?.data || error.message);
    res.status(500).json({
      error: "No se pudo iniciar la llamada de agendamiento",
      details: error.response?.data || error.message,
    });
  }
};

/**
 * 📞 Enviar llamada de recordatorio de cita
 * Requiere: tenant, telefono, cedula, nombrepaciente, nombredoctor, fecha, hora, lugar, especialidad
 */
export const enviarLlamadaRecordatorioCita = async (req, res) => {
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

    // 🔎 Validación
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
          "Faltan datos requeridos: tenant, telefono, cedula, nombrepaciente, nombredoctor, fecha, hora, lugar, especialidad",
      });
    }

    // 1️ Obtener configuración del cliente
    const config = await obtenerConfigCliente(tenant);
    if (!config) throw new Error("No se encontró configuración del cliente");

    // 2️ Obtener configuración de llamada desde recordatoriosUrls
    const llamadaConfig = config?.agendamiento?.recordatoriosUrls?.find(
      (c) => c.tipo === "llamada"
    );

    if (!llamadaConfig) {
      return res.status(404).json({
        error: "No hay configuración de llamada para recordatorio de cita",
      });
    }

    const { codigoTelefono, idAgente } = llamadaConfig;

    if (!process.env.ELEVEN_API_KEY) {
      throw new Error("Falta ELEVEN_API_KEY en el archivo .env");
    }

    // 3️ Variables dinámicas EXACTAMENTE como ElevenLabs las usa
    const dynamicVariables = {
      nombre_cliente: config.name || "",
      tenant,

      // Datos del paciente
      nombrepaciente,
      nombredoctor,
      fecha,
      hora,
      lugar,
      especialidad,

   
    };

    console.log(" Enviando llamada RECORDATORIO con datos:", {
      idAgente,
      codigoTelefono,
      telefono,
      dynamicVariables,
    });

    // 4️ Ejecutar la llamada
    const resultado = await ejecutarLlamada(
      idAgente,
      codigoTelefono,
      telefono,
      dynamicVariables
    );

    // 5️ Respuesta
    res.status(200).json({
      success: true,
      message: " Llamada de recordatorio iniciada correctamente",
      tenant,
      telefono,
      cedula,
      resultado,
    });
  } catch (error) {
    console.error(
      " Error enviando llamada de recordatorio:",
      error.response?.data || error.message
    );
    res.status(500).json({
      error: "No se pudo iniciar la llamada de recordatorio",
      details: error.response?.data || error.message,
    });
  }
};

//llamada recordatorio medicamentos
export const enviarLlamadaRecordatorioMedicamento = async (req, res) => {
  try {
    const {
      tenant,
      telefono,
      cedula,
      nombrepaciente,
      nombre_cliente,
      medicamento,
      dosis,
      frecuencia,
      via_administracion,
      fecha_inicio,
      fecha_fin,
      hora_programada,
      duracion,
      indicaciones_especiales,
    } = req.body;

    // 🔎 Validación
    if (
      !tenant ||
      !telefono ||
      !cedula ||
      !nombrepaciente ||
      !nombre_cliente ||
      !medicamento ||
      !dosis ||
      !frecuencia ||
      !via_administracion ||
      !fecha_inicio ||
      !fecha_fin ||
      !hora_programada ||
      !duracion
    ) {
      return res.status(400).json({
        error:
          "Faltan datos requeridos: tenant, telefono, cedula, nombrepaciente, nombre_cliente, medicamento, dosis, frecuencia, via_administracion, fecha_inicio, fecha_fin, hora_programada, duracion",
      });
    }

    // 1️ Obtener configuración del cliente
    const config = await obtenerConfigCliente(tenant);
    if (!config) throw new Error("No se encontró configuración del cliente");

    // 2️ Buscar configuración de llamada para medicamentos
    const llamadaConfig = config?.agendamiento?.recordatoriosUrls?.find(
      (c) => c.tipo === "llamada"
    );

    if (!llamadaConfig) {
      return res.status(404).json({
        error: "No hay configuración de llamada para recordatorio de medicamento",
      });
    }

    const { codigoTelefono, idAgente } = llamadaConfig;

    if (!process.env.ELEVEN_API_KEY) {
      throw new Error("Falta ELEVEN_API_KEY en el archivo .env");
    }

    // 3️ Variables dinámicas EXACTAMENTE como ElevenLabs las usa
    const dynamicVariables = {
      tenant,
      telefono,
      cedula,
      nombrepaciente,
      nombre_cliente,

      medicamento,
      dosis,
      frecuencia,
      via_administracion,
      fecha_inicio,
      fecha_fin,
      hora_programada,
      duracion,
      indicaciones_especiales: indicaciones_especiales || "",
    };

    console.log(" Enviando llamada RECORDATORIO MEDICAMENTO con datos:", {
      idAgente,
      codigoTelefono,
      telefono,
      dynamicVariables,
    });

    // 4️ Ejecutar la llamada
    const resultado = await ejecutarLlamada(
      idAgente,
      codigoTelefono,
      telefono,
      dynamicVariables
    );

    // 5️ Respuesta
    res.status(200).json({
      success: true,
      message: " Llamada de recordatorio de medicamento iniciada correctamente",
      tenant,
      telefono,
      cedula,
      resultado,
    });
  } catch (error) {
    console.error(
      " Error enviando llamada de recordatorio de medicamento:",
      error.response?.data || error.message
    );

    res.status(500).json({
      error: "No se pudo iniciar la llamada de recordatorio de medicamento",
      details: error.response?.data || error.message,
    });
  }
};

//Prueba llamada agendamiento
export const pruebaLlamadaAgendamiento = async (req, res) => {
  try {
    const { tenant, telefono, identificadorId, nombreCompleto, especialidad, servicio, citaid } = req.body;

    if (!tenant || !telefono || !identificadorId || !nombreCompleto || !especialidad || !servicio || !citaid) {
      return res.status(400).json({
        error:
          "Faltan datos requeridos: tenant, telefono, cedula, nombreCompleto, especialidad, citaid",
      });
    }

    const config = await obtenerConfigCliente(tenant);
    if (!config) throw new Error("No se encontró configuración del cliente");

    const llamadaConfig = config?.agendamiento?.agendamientoCitasUrls?.find(
      (c) => c.tipo === "llamada"
    );

    if (!llamadaConfig) {
      return res.status(404).json({
        error: "No hay configuración de llamada para agendamiento",
      });
    }

    const { codigoTelefono, idAgente } = llamadaConfig;

    if (!process.env.ELEVEN_API_KEY) {
      throw new Error("Falta ELEVEN_API_KEY en el archivo .env");
    }

    // ⭐ Variables dinámicas específicas
    const dynamicVariables = {
      nombre_cliente: config.nombre_cliente || 
      tenant,
      identificadorId,
      nombreCompleto,
      especialidad,
      servicio,
      citaid,
    };

    console.log("📞 Enviando llamada AGENDAMIENTO:", {
      idAgente,
      codigoTelefono,
      telefono,
      dynamicVariables,
    });

    const resultado = await ejecutarLlamada(
      idAgente,
      codigoTelefono,
      telefono,
      dynamicVariables
    );

    res.status(200).json({
      success: true,
      message: "📲 Llamada de agendamiento iniciada correctamente",
      tenant,
      telefono,
      identificadorId,
      servicio,
      resultado,
    });
  } catch (error) {
    console.error(
      "❌ Error enviando llamada de agendamiento:",
      error.response?.data || error.message
    );
    res.status(500).json({
      error: "No se pudo iniciar la llamada de agendamiento",
      details: error.response?.data || error.message,
    });
  }
};
