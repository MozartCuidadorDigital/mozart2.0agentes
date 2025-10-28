import express from "express";
import dotenv from "dotenv";
import whatsappRoutes from "./routes/whatsapp.routes.js";
import llamadasRoutes from "./routes/llamadas.routes.js";

dotenv.config();

const app = express();
app.use(express.json());


// Rutas
app.use("/api/whatsapp", whatsappRoutes);
app.use("/api/llamadas", llamadasRoutes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`✅ Servidor corriendo en puerto ${PORT}`));
