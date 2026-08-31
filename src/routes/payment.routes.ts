import { Router } from "express";
import { initiateSabPaisaPayment, sabPaisaCallback, enquireSabPaisaPayment } from "../controllers/payment_controller";
import { protect } from "../middleware/auth_middleware";

const router = Router();

router.post("/sabpaisa/initiate", protect, initiateSabPaisaPayment);
router.all("/sabpaisa/callback", sabPaisaCallback);
router.get("/sabpaisa/callback", sabPaisaCallback);
router.post("/sabpaisa/callback", sabPaisaCallback);
router.post("/sabpaisa/enquiry", enquireSabPaisaPayment);
router.post("/sabpaisa/status", enquireSabPaisaPayment);

export default router;
