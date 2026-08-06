import { Router } from "express";
import {
  googleLogin,
  logout,
  deleteAccount,
  adminLogin,
} from "../controllers/auth_controller";
import { protect } from "../middleware/auth_middleware";

const router = Router();

router.post("/google", googleLogin);
router.post("/admin-login", adminLogin);
router.post("/logout", logout);
router.delete("/profile", protect, deleteAccount);

export default router;
