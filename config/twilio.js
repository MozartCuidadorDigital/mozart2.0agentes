import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import sgMail from '@sendgrid/mail';
import { fileURLToPath } from 'url';

dotenv.config();
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Necesario en ES Modules para __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── ENVÍO: Solicitud de cita médica ───────────────────────────────
export const envioSolicitudCita = async (email, dataPaciente) => {
  try {
    const templatePath = path.join(__dirname, '../templates/solicitudCitaMedica.html');
    let template = await fs.promises.readFile(templatePath, 'utf8');

    const {
      nombrePaciente,
      tipoDocumento,
      idNumber,
      edad,
      telefono,
      grupoRiesgo,
      numeroCaso,
      ipsAtencion,
      servicio,
      doctor,
      fecha,
      hora
    } = dataPaciente;

    // Construimos dinámicamente los datos
    let datosHtml = '';

    if (nombrePaciente) datosHtml += `<p><strong>Nombre:</strong> ${nombrePaciente}</p>`;
    if (tipoDocumento) datosHtml += `<p><strong>Tipo de documento:</strong> ${tipoDocumento}</p>`;
    if (idNumber) datosHtml += `<p><strong>Número de documento:</strong> ${idNumber}</p>`;
    if (edad) datosHtml += `<p><strong>Edad:</strong> ${edad} años</p>`;
    if (telefono) datosHtml += `<p><strong>Contacto:</strong> ${telefono}</p>`;
    if (grupoRiesgo) datosHtml += `<p><strong>Grupo de riesgo:</strong> ${grupoRiesgo}</p>`;
    if (numeroCaso) datosHtml += `<p><strong>Número de caso:</strong> ${numeroCaso}</p>`;
    if (doctor) datosHtml += `<p><strong>Doctor:</strong> ${doctor}</p>`;
    if (fecha) datosHtml += `<p><strong>Fecha:</strong> ${fecha}</p>`;
    if (hora) datosHtml += `<p><strong>Hora:</strong> ${hora}</p>`;

    // Reemplazos normales
    template = template
      .replace(/{{ipsAtencion}}/g, ipsAtencion || '')
      .replace(/{{servicio}}/g, servicio || '')
      .replace(/{{datosPaciente}}/g, datosHtml);

    const subject = `SOLICITUD DE ASIGNACION DE CITA POR  ${servicio || 'ESPECIALISTA'} ${nombrePaciente || ''} ${tipoDocumento || ''} # ${idNumber || ''}`;

    const msg = {
      to: email,
      from: 'info@mozartai.com.co',
      subject,
      html: template,
    };

    await sgMail.send(msg);

  } catch (error) {
    console.error("Error enviando correo:", error);
    throw error;
  }
};




// ENVIO FAMISANAR CORREO CITA AGENDADA

export const enviarCorreoCita = async (email, dataPaciente, estado, razon) => {

  const templatePath = path.join(__dirname, '../templates/confirmacionCitaMedica.html');
  let template = await fs.promises.readFile(templatePath, 'utf8');

  const {
    nombrePaciente,
    doctor,
    fecha,
    hora,
    servicio,
    ipsAtencion,
  } = dataPaciente;

  let datosHtml = `
    <p><strong>Paciente:</strong> ${nombrePaciente}</p>
    <p><strong>Servicio:</strong> ${servicio}</p>
  `;

  if (doctor) datosHtml += `<p><strong>Doctor:</strong> ${doctor}</p>`;
  if (fecha) datosHtml += `<p><strong>Fecha:</strong> ${fecha}</p>`;
  if (hora) datosHtml += `<p><strong>Hora:</strong> ${hora}</p>`;

  let titulo = "";
  let mensajePrincipal = "";
  let mensajeFinal = "";
   let razonHtml = "";

  if (estado === "confirmada") {

    titulo = "Cita médica confirmada";

    mensajePrincipal = `
      Tu solicitud de agendamiento de cita médica fue agendada correctamente en
      <strong>${ipsAtencion}</strong>.
    `;

    mensajeFinal = `
      Le agradecemos por haberse comunicado con nosotros y por su paciencia durante este proceso. Nos complace haber podido resolver su inquietud. 
Quedamos atentos a cualquier comentario adicional y le reiteramos nuestro compromiso con la atención de calidad.

    `;

  } else {

    titulo = "No fue posible agendar la cita medica";

    mensajePrincipal = `
      No fue posible programar la cita médica para el servicio de ${servicio}

    `;

    razonHtml = `
      <p><strong>Razón:</strong> ${razon}</p>
    `;

    mensajeFinal = `
      Le agradecemos por haberse comunicado con nosotros y por su paciencia durante este proceso. Nos complace haber podido resolver su inquietud. 
Quedamos atentos a cualquier comentario adicional y le reiteramos nuestro compromiso con la atención de calidad.
    `;
  }

  template = template
    .replace(/{{titulo}}/g, titulo)
    .replace(/{{mensajePrincipal}}/g, mensajePrincipal)
    .replace(/{{razon}}/g, razonHtml)
    .replace(/{{datosPaciente}}/g, datosHtml)
    .replace(/{{mensajeFinal}}/g, mensajeFinal);

  const msg = {
    to: email,
    from: "agendamiento.cemdi@mozartai.com.co",
    subject: titulo,
    html: template
  };

  await sgMail.send(msg);
};