import { Router } from "express";
import multer from "multer";
import { uploadProfileImage, AddAddress } from "../controllers/user_controller";
import { protect } from "../middleware/auth_middleware";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post("/profile-image", protect, upload.single("image"), uploadProfileImage);
router.post("/address", protect , AddAddress)

export default router;
