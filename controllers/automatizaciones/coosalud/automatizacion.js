import dotenv from "dotenv";


dotenv.config();

export const enviarTemplateWP = async (req, res) => {
  const { telefono, nombrePaciente, servicio, ipsAtencion, fecha, hora } = req.body

  const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL;
  const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
  const TEMPLATE_NAME = process.env.TEMPLATE_NAME;
  const TEMPLATE_LANGUAGE = process.env.TEMPLATE_LANGUAGE;

  const whatsappBody = {
    messaging_product: "whatsapp",
    to: telefono,
    type: "template",
    template: {
        name: TEMPLATE_NAME,
        language: { code: TEMPLATE_LANGUAGE },
        components: [
            {
                type: "header",
                parameters: [
                    {
                        type: "image",
                        image: {
                            link: "https://mozartimages-1.s3.us-east-1.amazonaws.com/logo+de+coosalud.jpg"
                        }
                    }
                ]
            },
            {
                type: "body",
                parameters: [
                    { type: "text", text: nombrePaciente   },
                    { type: "text", text: servicio },
                    { type: "text", text: ipsAtencion      },
                    { type: "text", text: fecha    },
                    { type: "text", text: hora     }
                ]
            }
        ]
    }
  };

  const response = await fetch(WHATSAPP_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(whatsappBody)
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("Error:", data);
    return res.status(response.status).json(data);
  }

  return res.json({
    ok: true,
    messageId: data.messages?.[0]?.id,
    data
  });

}