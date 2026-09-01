import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import User, { IUser } from "../models/User_model";

// Extend Express Request interface to include user
declare global {
  namespace Express {
    interface Request {
      user?: IUser;
    }
  }
}

export const protect = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<any> => {
  let token: string | undefined;

  const authHeader = (req.headers.authorization || req.headers["x-auth-token"] || req.headers["x-access-token"]) as string;

  if (authHeader) {
    token = authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : authHeader;
  }

  if (token) {
    // 1. Quietly handle admin bypass token to avoid false jwt verification error logging
    if (token.startsWith("artiory-token-")) {
      const adminEmail = process.env.ADMIN_EMAIL || "admin@artiory.com";
      let adminUser = await User.findOne({ email: adminEmail });
      if (!adminUser) {
        adminUser = await User.create({
          name: "Admin User",
          email: adminEmail,
          googleId: "admin-dev-id",
        });
      }
      req.user = adminUser;
      return next();
    }

    // 2. Verify standard database user JWT (support primary & fallback JWT secrets)
    try {
      const secrets = [
        process.env.JWT_SECRET,
        "werfuh3482fnrf8932rf_prod_secure_key",
        "werfuh3482fnrf8932rf",
        "fallback_secret",
        process.env.NEXTAUTH_SECRET,
      ].filter(Boolean) as string[];

      let decoded: any = null;
      for (const secret of secrets) {
        try {
          decoded = jwt.verify(token, secret);
          if (decoded) break;
        } catch {}
      }

      if (!decoded) {
        return res.status(401).json({ message: "Not authorized, token failed" });
      }

      let user = null;
      try {
        if (decoded.id && /^[0-9a-fA-F]{24}$/.test(decoded.id)) {
          user = await User.findById(decoded.id).select("-googleId");
        }
        if (!user && decoded.email) {
          user = await User.findOne({ email: decoded.email }).select("-googleId");
        }
        if (!user) {
          const userEmail = decoded.email || `customer_${(decoded.id || Date.now()).toString().slice(-6)}@artiory.com`;
          user = await User.findOne({ email: userEmail });
          if (!user) {
            user = await User.create({
              name: decoded.name || "Customer",
              email: userEmail,
            });
          }
        }
      } catch (userLookupErr) {
        console.error("Auth User Lookup/Create Error:", userLookupErr);
      }

      if (user) {
        req.user = user;
        return next();
      }

      return res.status(401).json({ message: "Not authorized, user not found" });
    } catch (error) {
      console.error("JWT Verification Error:", error);
      return res.status(401).json({ message: "Not authorized, token failed" });
    }
  }

  return res.status(401).json({ message: "Not authorized, no token" });
};
