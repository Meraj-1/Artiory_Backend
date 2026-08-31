import { Router } from "express";
import { getInventoryList, updateInventoryItem } from "../controllers/inventory_controller";

const router = Router();

router.get("/", getInventoryList);
router.put("/update", updateInventoryItem);
router.patch("/update", updateInventoryItem);
router.post("/update", updateInventoryItem);
router.put("/:sku", updateInventoryItem);
router.patch("/:sku", updateInventoryItem);
router.post("/:sku", updateInventoryItem);

export default router;
