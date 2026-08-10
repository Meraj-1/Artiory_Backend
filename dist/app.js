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
const combo_routes_1 = __importDefault(require("./routes/combo.routes"));
const inventory_routes_1 = __importDefault(require("./routes/inventory.routes"));
const customer_routes_1 = __importDefault(require("./routes/customer.routes"));
const coupon_routes_1 = __importDefault(require("./routes/coupon.routes"));
const app = (0, express_1.default)();
const allowedOrigins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:5173",
    "https://artiory-dashboard.vercel.app",
    "https://artiory-frontend-murex.vercel.app",
    "https://artiory-backend.vercel.app",
    "https://staging.artiory.com",
    "https://admin.artiory.com",
    "https://api.artiory.com",
];
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        // Allow requests without Origin (Postman, server-to-server, etc.)
        if (!origin) {
            return callback(null, true);
        }
        // Allow explicitly listed origins
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        // Allow Vercel deployments
        if (origin.endsWith(".vercel.app")) {
            return callback(null, true);
        }
        // Allow artiory.com subdomains and primary domain
        if (origin.endsWith(".artiory.com") || origin === "https://artiory.com") {
            return callback(null, true);
        }
        // Allow localhost on any port
        if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
            return callback(null, true);
        }
        console.warn(`Origin ${origin} not allowed by CORS`);
        return callback(null, false);
    },
    credentials: true,
    methods: [
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS",
    ],
    allowedHeaders: [
        "Content-Type",
        "Authorization",
        "x-auth-token",
        "x-access-token",
        "token",
        "X-Requested-With",
        "Accept",
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
app.use("/api/combos", combo_routes_1.default);
app.use("/api/inventory", inventory_routes_1.default);
app.use("/api/customers", customer_routes_1.default);
app.use("/api/coupons", coupon_routes_1.default);
// Global Error Handler Middleware (ensures JSON responses and manual CORS headers on errors)
app.use((err, req, res, next) => {
    console.error("Global Error Handler caught an error:", err);
    // Set CORS headers manually on error response to prevent browser CORS blocks
    const origin = req.headers.origin;
    const isVercel = origin && origin.endsWith(".vercel.app");
    const isArtiory = origin && (origin.endsWith(".artiory.com") || origin === "https://artiory.com");
    const isLocalhost = origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    if (origin && (isVercel || isArtiory || isLocalhost)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    res.status(err.status || 500).json({
        success: false,
        message: err.message || "Internal Server Error",
    });
});
exports.default = app;
