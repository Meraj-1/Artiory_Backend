"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
// Load environment variables as early as possible so config modules can use them
dotenv_1.default.config();
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const user_routes_1 = __importDefault(require("./routes/user.routes"));
const order_routes_1 = __importDefault(require("./routes/order.routes"));
const address_routes_1 = __importDefault(require("./routes/address.routes"));
const product_routes_1 = __importDefault(require("./routes/product.routes"));
const app = (0, express_1.default)();
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
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        const isVercel = origin && (origin.endsWith(".vercel.app") || origin.includes("vercel.app"));
        if (!origin || allowedOrigins.includes(origin) || isVercel || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
            callback(null, true);
        }
        else {
            console.warn(`Origin ${origin} not allowed by CORS`);
            callback(null, false);
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
}));
app.use(express_1.default.json());
app.get("/", (req, res) => {
    res.json({ message: "Artiory API Running" });
});
app.get("/favicon.ico", (req, res) => res.status(204).end());
app.use("/api/auth", auth_routes_1.default);
app.use("/api/users", user_routes_1.default);
app.use("/api/orders", order_routes_1.default);
app.use("/api/address", address_routes_1.default);
app.use("/api/products", product_routes_1.default);
exports.default = app;
