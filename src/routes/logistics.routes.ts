import { Router } from "express";
import { shipOrderWithiThink, trackiThinkShipment, checkPincodeServiceability, getShippingCharge } from "../controllers/logistics_controller";

const router = Router();

// Ship order route (POST /api/logistics/orders/:orderId/ship)
router.post("/orders/:orderId/ship", shipOrderWithiThink);

// Track AWB shipment route (GET /api/logistics/shipments/:awbNumber/track)
router.get("/shipments/:awbNumber/track", trackiThinkShipment);

// Check pincode serviceability route
router.post("/pincode-check", checkPincodeServiceability);

// Calculate shipping charges route
router.post("/shipping-charge", getShippingCharge);

export default router;
