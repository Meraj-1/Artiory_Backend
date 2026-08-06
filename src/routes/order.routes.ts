import { Router } from "express";
import {
  createOrder,
  getMyOrders,
  getOrderById,
} from "../controllers/order_controller";
import { protect } from "../middleware/auth_middleware";

const router = Router();

router.post("/", protect, createOrder);
router.get("/myorders", protect, getMyOrders);
router.get("/:id", protect, getOrderById);

export default router;
