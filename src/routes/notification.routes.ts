import { Router } from "express";
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  dismissNotification,
} from "../controllers/notification_controller";

const router = Router();

router.get("/", getNotifications);
router.post("/mark-all-read", markAllNotificationsRead);
router.put("/:id/read", markNotificationRead);
router.patch("/:id/read", markNotificationRead);
router.delete("/:id", dismissNotification);
router.post("/:id/dismiss", dismissNotification);

export default router;
