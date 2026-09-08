import { Router } from "express";
import {
  createOrder,
  getMyOrders,
  getOrderById,
  getAllOrders,
  reconcileOrder,
  trackOrder,
} from "../controllers/order_controller";
import { protect, protectOptional } from "../middleware/auth_middleware";

const router = Router();

router.post("/", protectOptional, createOrder);
router.post("/track", protectOptional, trackOrder);
router.get("/", protect, getAllOrders);
router.post("/reconcile", protect, reconcileOrder);
router.get("/myorders", protect, getMyOrders);
router.get("/:id", protectOptional, getOrderById);

export default router;
