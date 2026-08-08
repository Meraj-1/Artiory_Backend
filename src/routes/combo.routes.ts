import { Router } from "express";
import {
  createComboProduct,
  getComboProducts,
  getComboProductById,
  updateComboProduct,
  deleteComboProduct,
} from "../controllers/combo_controller";

const router = Router();

router.post("/", createComboProduct);
router.get("/", getComboProducts);
router.get("/:id", getComboProductById);
router.put("/:id", updateComboProduct);
router.delete("/:id", deleteComboProduct);

export default router;
