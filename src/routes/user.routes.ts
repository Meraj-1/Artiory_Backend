import { Router } from "express";
import multer from "multer";
import {
  uploadProfileImage,
  AddAddress,
  getUserCart,
  syncUserCart,
  getUserWishlist,
  syncUserWishlist,
} from "../controllers/user_controller";
import { protect } from "../middleware/auth_middleware";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post("/profile-image", protect, upload.single("image"), uploadProfileImage);
router.post("/address", protect, AddAddress);

// Cart persists
router.get("/cart", protect, getUserCart);
router.post("/cart", protect, syncUserCart);

// Wishlist persists
router.get("/wishlist", protect, getUserWishlist);
router.post("/wishlist", protect, syncUserWishlist);

export default router;
