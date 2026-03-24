import { enviarCorreoInteresComercial } from '../../../config/twilio.js';


export const enviarCorreoComercial = async (req, res) => {
  try {

    const {
      nombre, interes, telefono, franjaHoraria, correo, empresa, cargo } = req.body;

    if (!correo) {
      return res.status(400).json({
        error: "Email requerido"
      });
    }

    const dataPaciente = {
      nombre,
      interes,
      telefono,
      franjaHoraria,
      correo,
      empresa,
      cargo
    };

    await enviarCorreoInteresComercial(dataPaciente);

    res.json({
      message: "Correo enviado correctamente"
    });

  } catch (error) {

    console.error("Error enviando correo:", error);

    res.status(500).json({
      error: "Error enviando correo"
    });

  }
};