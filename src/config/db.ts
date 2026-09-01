import mongoose from "mongoose";

const FALLBACK_URI = "mongodb+srv://clicktrick11_db_user:3KZo2K0QoU56K5dA@cluster0.umw4qh1.mongodb.net/test?retryWrites=true&w=majority";

let cachedPromise: Promise<typeof mongoose> | null = null;

const connectDB = async () => {
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  if (!cachedPromise) {
    const uri = process.env.MONGODB_URI || FALLBACK_URI;
    cachedPromise = mongoose.connect(uri, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 5000,
    }).then((m) => {
      console.log("MongoDB Connected successfully");
      return m;
    }).catch((err) => {
      cachedPromise = null;
      console.error("Database connection failed:", err.message);
      throw err;
    });
  }

  await cachedPromise;
  return mongoose;
};

export default connectDB;