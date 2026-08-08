import app from "../src/app";
import connectDB from "../src/config/db";

// Connect to MongoDB
connectDB().catch((err) => {
  console.error("Critical error during database initialization:", err);
});

export default app;
