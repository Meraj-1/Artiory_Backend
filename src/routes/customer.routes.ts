import { Router } from "express";
import { getCustomersList } from "../controllers/customer_controller";

const router = Router();

router.get("/", getCustomersList);

export default router;
