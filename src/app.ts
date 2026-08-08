import express from "express";
import cors from "cors";
import dotenv from "dotenv";

// Load environment variables as early as possible so config modules can use them
dotenv.config();

import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/user.routes";
import orderRoutes from "./routes/order.routes";
import addressRoutes from "./routes/address.routes";
import productRoutes from "./routes/product.routes";
import comboRoutes from "./routes/combo.routes";
import inventoryRoutes from "./routes/inventory.routes";
import customerRoutes from "./routes/customer.routes";
import couponRoutes from "./routes/coupon.routes";

const app = express();

const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
  "http://localhost:3002",
  "http://127.0.0.1:3002",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  process.env.FRONTEND_URL,
  process.env.DASHBOARD_URL,
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-auth-token",
      "x-access-token",
      "token",
      "X-Requested-With",
      "Accept"
    ],
  })
);
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message: "Artiory API Running"
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/address", addressRoutes);
app.use("/api/products", productRoutes);
app.use("/api/combos", comboRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/coupons", couponRoutes);

export default app;
