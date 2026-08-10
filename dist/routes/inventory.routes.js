"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const inventory_controller_1 = require("../controllers/inventory_controller");
const router = (0, express_1.Router)();
router.get("/", inventory_controller_1.getInventoryList);
router.put("/update", inventory_controller_1.updateInventoryItem);
exports.default = router;
