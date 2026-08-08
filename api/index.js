"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = __importDefault(require("../src/app"));
const db_1 = __importDefault(require("../src/config/db"));
// Connect to MongoDB
(0, db_1.default)().catch((err) => {
    console.error("Critical error during database initialization:", err);
});
exports.default = app_1.default;
