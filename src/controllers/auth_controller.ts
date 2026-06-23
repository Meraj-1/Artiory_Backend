import { Request, Response } from "express";
import User from "../models/User_model";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export const register = async (
  req: Request,
  res: Response
) => {
  try {
    const { name, email, password } = req.body;

    const exists = await User.findOne({ email });

    if (exists) {
      return res.status(400).json({
        message: "User already exists"
      });
    }

    const hashedPassword = await bcrypt.hash(
      password,
      10
    );

    const user = await User.create({
      name,
      email,
      password: hashedPassword
    });

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET!,
      {
        expiresIn: "7d"
      }
    );

    res.status(201).json({
      message: "User created",
      token,
      user
    });
  } catch (error) {
    res.status(500).json({
      message: "Server Error"
    });
  }
};

export const login = async (
  req: Request,
  res: Response
) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).json({
        message: "Invalid credentials"
      });
    }

    const match = await bcrypt.compare(
      password,
      user.password
    );

    if (!match) {
      return res.status(400).json({
        message: "Invalid credentials"
      });
    }

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET!,
      {
        expiresIn: "7d"
      }
    );

    res.json({
      token,
      user
    });
  } catch (error) {
    res.status(500).json({
      message: "Server Error"
    });
  }
};



export const logout = async (
  req: Request,
  res: Response
) => {
  try {
    res.status(200).json({
      success: true,
      message: "Logged out successfully"
    });
  } catch (error) {
    res.status(500).json({
      message: "Server Error"
    });
  }
};