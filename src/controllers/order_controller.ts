import { Request, Response } from "express";
import Order from "../models/Order_model";


export const createOrder = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { orderItems, totalPrice } = req.body;

    if (!orderItems || orderItems.length === 0) {
      return res.status(400).json({ message: "No order items" });
    }

    const order = new Order({
      user: req.user?._id as any,
      orderItems,
      totalPrice,
    });

    const createdOrder = await order.save();

    res.status(201).json(createdOrder);
  } catch (error) {
    console.error("Create Order Error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

export const getMyOrders = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ message: "Not authorized" });
    }

    const orders = await Order.find({ user: req.user._id as any });
    res.status(200).json(orders);
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
};

export const getOrderById = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const order = await Order.findById(req.params.id).populate(
      "user",
      "name email profileImage"
    );

    if (order) {
      res.status(200).json(order);
    } else {
      res.status(404).json({ message: "Order not found" });
    }
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
};
