import { Router } from "express";
import { getInventoryList, updateInventoryItem } from "../controllers/inventory_controller";

const router = Router();

router.get("/", getInventoryList);
router.put("/update", updateInventoryItem);

export default router;
