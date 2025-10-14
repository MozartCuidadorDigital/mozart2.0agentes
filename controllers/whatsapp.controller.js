import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

export const enviarPresentacion = async (req, res) => {
  try {
    const { tenant, paciente } = req.body;

    if (!tenant || !paciente) {
      return res.status(400).json({ error: "Faltan datos requeridos: tenant o paciente" });
    }

    const data = {
      messaging_product: "whatsapp",
      to: paciente,
      type: "template",
      template: {
        name: "mozart2_presentacion",
        language: { code: "en" },
        components: [
          {
            type: "header",
            parameters: [
              {
                type: "image",
                image: {
                  link: "https://mozartimages.s3.us-east-1.amazonaws.com/Logo_Mozart_color.png",
                },
              },
            ],
          },
          {
            type: "body",
            parameters: [
              { type: "text", text: `*IPS ${tenant.toUpperCase()}*` },
              { type: "text", text: "nefrología, endocrinología y endocrinología infantil." },
              { type: "text", text: "verificación de datos, agendamiento de citas y consulta de síntomas" },
            ],
          },
        ],
      },
    };

    const response = await axios.post(
      process.env.META_GRAPH_URL,
      data,
      {
        headers: {
          Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.status(200).json({
      message: "Mensaje enviado correctamente ✅",
      to: paciente,
      tenant,
      metaResponse: response.data,
    });
  } catch (error) {
    console.error("❌ Error al enviar mensaje:", error.response?.data || error.message);
    res.status(500).json({
      error: "No se pudo enviar el mensaje",
      details: error.response?.data || error.message,
    });
  }
};

export const enviarVerificacion = async (req, res) => {
  try {
    const { tenant, paciente } = req.body;

    if (!tenant || !paciente) {
      return res.status(400).json({ error: "Faltan datos requeridos: tenant o paciente" });
    }

    const data = {
      messaging_product: "whatsapp",
      to: paciente,
      type: "template",
      template: {
        name: "mozart2_verificacion",
        language: { code: "en" },
        components: [
          {
            type: "header",
            parameters: [
              {
                type: "image",
                image: {
                  link: "https://mozartimages.s3.us-east-1.amazonaws.com/Logo_Mozart_color.png",
                },
              },
            ],
          },
          {
            type: "body",
            parameters: [
              { type: "text", text: `*IPS ${tenant.toUpperCase()}*` },
            ],
          },
        ],
      },
    };

    const response = await axios.post(
      process.env.META_GRAPH_URL,
      data,
      {
        headers: {
          Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.status(200).json({
      message: "Mensaje enviado correctamente ✅",
      to: paciente,
      tenant,
      metaResponse: response.data,
    });
  } catch (error) {
    console.error("❌ Error al enviar mensaje:", error.response?.data || error.message);
    res.status(500).json({
      error: "No se pudo enviar el mensaje",
      details: error.response?.data || error.message,
    });
  }
};

export const enviarAgendamiento = async (req, res) => {
  try {
    const { tenant, paciente } = req.body;

    if (!tenant || !paciente) {
      return res.status(400).json({ error: "Faltan datos requeridos: tenant o paciente" });
    }

    const data = {
      messaging_product: "whatsapp",
      to: paciente,
      type: "template",
      template: {
        name: "mozart2_agendamiento",
        language: { code: "en" },
        components: [
          {
            type: "header",
            parameters: [
              {
                type: "image",
                image: {
                  link: "https://mozartimages.s3.us-east-1.amazonaws.com/Logo_Mozart_color.png",
                },
              },
            ],
          },
          {
            type: "body",
            parameters: [
              { type: "text", text: `*IPS ${tenant.toUpperCase()}*` },
            ],
          },
        ],
      },
    };

    const response = await axios.post(
      process.env.META_GRAPH_URL,
      data,
      {
        headers: {
          Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.status(200).json({
      message: "Mensaje enviado correctamente ✅",
      to: paciente,
      tenant,
      metaResponse: response.data,
    });
  } catch (error) {
    console.error("❌ Error al enviar mensaje:", error.response?.data || error.message);
    res.status(500).json({
      error: "No se pudo enviar el mensaje",
      details: error.response?.data || error.message,
    });
  }
};


