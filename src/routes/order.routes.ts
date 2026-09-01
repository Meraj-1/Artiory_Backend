import { Router } from "express";
import {
  createOrder,
  getMyOrders,
  getOrderById,
  getAllOrders,
  reconcileOrder,
} from "../controllers/order_controller";
import { protect, protectOptional } from "../middleware/auth_middleware";

const router = Router();

router.post("/", protectOptional, createOrder);
router.get("/", protect, getAllOrders);
router.post("/reconcile", protect, reconcileOrder);
router.get("/myorders", protect, getMyOrders);
router.get("/:id", protect, getOrderById);

export default router;
