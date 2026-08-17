import { Router } from "express";
import { initiateSabPaisaPayment, sabPaisaCallback } from "../controllers/payment_controller";
import { protect } from "../middleware/auth_middleware";

const router = Router();

router.post("/sabpaisa/initiate", protect, initiateSabPaisaPayment);
router.post("/sabpaisa/callback", sabPaisaCallback);

export default router;
