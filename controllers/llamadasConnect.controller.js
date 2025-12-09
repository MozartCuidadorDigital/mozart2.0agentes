import { ConnectClient, StartOutboundVoiceContactCommand } from "@aws-sdk/client-connect";
import dotenv from "dotenv";
dotenv.config();

const connectClient = new ConnectClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

export const dispararLlamadaConnect = async (req, res) => {
  try {
    const { phoneNumber, instanceId, flowId, sourceNumber } = req.body;

    if (!phoneNumber || !instanceId || !flowId || !sourceNumber) {
      return res.status(400).json({
        error: "Faltan parámetros requeridos: phoneNumber, instanceId, flowId o sourceNumber",
      });
    }

    const cmd = new StartOutboundVoiceContactCommand({
      InstanceId: instanceId,
      ContactFlowId: flowId,
      DestinationPhoneNumber: phoneNumber,
      SourcePhoneNumber: sourceNumber,
    });

    const resp = await connectClient.send(cmd);
    return res.status(200).json({
      success: true,
      message: "Llamada outbound iniciada correctamente",
      contactId: resp.ContactId,
    });

  } catch (error) {
    console.error("❌ Error al disparar outbound:", error);
    return res.status(500).json({
      error: "Error al iniciar la llamada outbound",
      details: error.message,
    });
  }
};
