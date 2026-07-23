import mongoose from "mongoose";

let connected = false;

export async function connectDB() {
  if (connected) return;
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI no está definida en .env");
  await mongoose.connect(uri);
  connected = true;
  console.log("✅ MongoDB conectado");
}