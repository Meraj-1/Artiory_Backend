import { Request, Response } from "express";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import Product from "../models/Product_model";
import { r2Client, R2_BUCKET_NAME } from "../config/r2";

// ─── Helpers ────────────────────────────────────────────────────────────────

const buildProductPayload = (body: any) => ({
  productName: body.productName || body.name || "",
  skuCode: (body.skuCode || body.sku || "").toString().trim().toUpperCase(),
  category: body.category || "",
  subCategory: body.subCategory || "",
  variants: (body.variants || []).map((v: any) => ({
    color: v.color || "",
    design: v.design || "",
    sellingPrice: Number(v.sellingPrice ?? v.price ?? 0),
    mrp: Number(v.mrp ?? 0),
    stockQuantity: Number(v.stockQuantity ?? v.stock ?? 0),
    imageUrl: v.imageUrl || v.url || "",
  })),
  sellingPrice: Number(body.sellingPrice || 0),
  mrp: Number(body.mrp || 0),
  stockQuantity: Number(body.stockQuantity ?? body.stock ?? 0),
  shortDescription: body.shortDescription || body.shortDesc || "",
  detailedDescription: body.detailedDescription || body.detailedDesc || "",
  weight: Number(body.weight || 0),
  dimensions: typeof body.dimensions === "object" ? body.dimensions : {},
  gst: Number(body.gst || 0),
  active: body.active !== undefined ? body.active : true,
  thumbnail:
    body.thumbnail ||
    (Array.isArray(body.images) && body.images[0]?.url) ||
    (typeof body.images?.[0] === "string" ? body.images[0] : ""),
  images: Array.isArray(body.images)
    ? body.images.map((img: any) =>
        typeof img === "string" ? img : img?.url || ""
      )
    : [],
});

const uploadToR2 = async (file: Express.Multer.File, productId: string) => {
  const fileExt = file.originalname.split(".").pop() || "jpg";
  const fileName = `products/${productId}-${uuidv4()}.${fileExt}`;
  await r2Client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
    })
  );
  return `${process.env.R2_PUBLIC_URL}/${fileName}`;
};

const sendError = (res: Response, status: number, message: string) =>
  res.status(status).json({ success: false, message });

// ─── Controllers ────────────────────────────────────────────────────────────

// GET /api/products?category=&published=&active=&search=&page=&limit=
export const getProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const { category, published, active, search, page = 1, limit = 20 } = req.query;

    const filter: Record<string, any> = {};
    if (category) filter.category = category;
    if (published !== undefined) filter.published = published === "true";
    if (active !== undefined) filter.active = active === "true";
    if (search) filter.productName = { $regex: search, $options: "i" };

    const skip = (Number(page) - 1) * Number(limit);
    const [products, total] = await Promise.all([
      Product.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Product.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: products,
      pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
    });
  } catch (err) {
    console.error(err);
    sendError(res, 500, "Server Error");
  }
};

// GET /api/products/:id
export const getProductById = async (req: Request, res: Response): Promise<void> => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) { sendError(res, 404, "Product not found"); return; }
    res.status(200).json({ success: true, data: product });
  } catch (err) {
    console.error(err);
    sendError(res, 500, "Server Error");
  }
};

// POST /api/products  (multipart/form-data, image field optional)
export const createProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const productName = req.body.productName || req.body.name;
    const skuCode = req.body.skuCode || req.body.sku;

    if (!productName || !skuCode) {
      sendError(res, 400, "Product Name & SKU are required");
      return;
    }

    const formattedSku = skuCode.toString().trim().toUpperCase();
    const existing = await Product.findOne({ skuCode: formattedSku });
    if (existing) { sendError(res, 409, "SKU already exists"); return; }

    const product = await Product.create(buildProductPayload(req.body));

    if (req.file) {
      const imageUrl = await uploadToR2(req.file, String(product._id));
      product.images = [imageUrl];
      product.thumbnail = imageUrl;
      await product.save();
    }

    res.status(201).json({ success: true, message: "Product created successfully", data: product });
  } catch (err) {
    console.error(err);
    sendError(res, 500, "Server Error");
  }
};

// PUT /api/products/:id  (multipart/form-data, image field optional)
export const updateProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) { sendError(res, 404, "Product not found"); return; }

    const payload: any = buildProductPayload(req.body);

    if (req.file) {
      const imageUrl = await uploadToR2(req.file, String(product._id));
      payload.thumbnail = imageUrl;
      payload.images = [...(product.images || []), imageUrl];
    }

    const updated = await Product.findByIdAndUpdate(req.params.id, payload, { new: true });
    res.status(200).json({ success: true, message: "Product updated successfully", data: updated });
  } catch (err) {
    console.error(err);
    sendError(res, 500, "Server Error");
  }
};

// DELETE /api/products/:id
export const deleteProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const deleted = await Product.findByIdAndDelete(req.params.id);
    if (!deleted) { sendError(res, 404, "Product not found"); return; }
    res.status(200).json({ success: true, message: "Product deleted successfully" });
  } catch (err) {
    console.error(err);
    sendError(res, 500, "Server Error");
  }
};

// PATCH /api/products/:id/publish
export const publishProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { published: true },
      { new: true }
    );
    if (!product) { sendError(res, 404, "Product not found"); return; }
    res.status(200).json({ success: true, message: "Product published", data: product });
  } catch (err) {
    console.error(err);
    sendError(res, 500, "Server Error");
  }
};

// PATCH /api/products/:id/unpublish
export const unpublishProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { published: false },
      { new: true }
    );
    if (!product) { sendError(res, 404, "Product not found"); return; }
    res.status(200).json({ success: true, message: "Product unpublished", data: product });
  } catch (err) {
    console.error(err);
    sendError(res, 500, "Server Error");
  }
};

// POST /api/products/:id/upload-image
export const uploadProductImage = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) { sendError(res, 400, "No image file provided"); return; }

    const product = await Product.findById(req.params.id);
    if (!product) { sendError(res, 404, "Product not found"); return; }

    const imageUrl = await uploadToR2(req.file, String(product._id));
    product.images = [...(product.images || []), imageUrl];
    product.thumbnail = product.thumbnail || imageUrl;
    await product.save();

    res.status(200).json({ success: true, message: "Image uploaded successfully", imageUrl, data: product });
  } catch (err) {
    console.error(err);
    sendError(res, 500, "Failed to upload image");
  }
};
