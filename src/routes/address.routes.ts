import { Router } from "express";
import {
  AddAddress,
  getAddresses,
  updateAddress,
  deleteAddress,
} from "../controllers/user_controller";
import { protect } from "../middleware/auth_middleware";

const router = Router();

router.get("/", protect, getAddresses);
router.post("/", protect, AddAddress);
router.put("/:id", protect, updateAddress);
router.delete("/:id", protect, deleteAddress);

export default router;