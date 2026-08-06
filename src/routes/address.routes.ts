import { Router } from "express";
import { AddAddress } from "../controllers/user_controller";
import { protect } from "../middleware/auth_middleware";

const router = Router();

router.post("/add", protect, AddAddress);

export default router;