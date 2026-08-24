"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const logistics_controller_1 = require("../controllers/logistics_controller");
const router = (0, express_1.Router)();
// Ship order route (POST /api/logistics/orders/:orderId/ship)
router.post("/orders/:orderId/ship", logistics_controller_1.shipOrderWithiThink);
// Track AWB shipment route (GET /api/logistics/shipments/:awbNumber/track)
router.get("/shipments/:awbNumber/track", logistics_controller_1.trackiThinkShipment);
// Check pincode serviceability route
router.post("/pincode-check", logistics_controller_1.checkPincodeServiceability);
// Calculate shipping charges route
router.post("/shipping-charge", logistics_controller_1.getShippingCharge);
exports.default = router;
