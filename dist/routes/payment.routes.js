"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const payment_controller_1 = require("../controllers/payment_controller");
const auth_middleware_1 = require("../middleware/auth_middleware");
const router = (0, express_1.Router)();
router.post("/sabpaisa/initiate", auth_middleware_1.protect, payment_controller_1.initiateSabPaisaPayment);
router.post("/sabpaisa/callback", payment_controller_1.sabPaisaCallback);
exports.default = router;
