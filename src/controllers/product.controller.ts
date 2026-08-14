import { Request, Response } from "express";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import Product from "../models/Product_model";
import ComboProduct from "../models/ComboProduct_model";
import { r2Client, R2_BUCKET_NAME, R2_PUBLIC_URL } from "../config/r2";

// ─── Helpers ────────────────────────────────────────────────────────────────

const isValidImageUrl = (value: any) => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && /^(https?:\/\/|\/)/i.test(trimmed) && !trimmed.startsWith("blob:");
};

const normalizeImageString = (value: any) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return isValidImageUrl(trimmed) ? trimmed : "";
  }

  if (value && typeof value === "object") {
    return normalizeImageString(value.url || value.imageUrl || value.src || value.path || value.href);
  }

  return "";
};

const normalizeProductImageFields = (product: any) => {
  const productData = product && typeof product.toObject === "function" ? product.toObject() : product;
  const productIdStr = productData._id ? String(productData._id) : "";

  const filterUnrelatedR2Images = (url: string) => {
    if (!url) return false;
    const lowerUrl = url.toLowerCase();
    if ((lowerUrl.includes("product") || url.includes(R2_PUBLIC_URL)) && productIdStr) {
      return url.includes(productIdStr);
    }
    return true;
  };

  const images = Array.isArray(productData?.images)
    ? [...new Set(
        productData.images
          .map((img: any) => normalizeImageString(img))
          .filter(Boolean)
          .filter(filterUnrelatedR2Images)
      )]
    : [];

  const variants = Array.isArray(productData?.variants)
    ? productData.variants.map((variant: any) => {
        const imgUrl = normalizeImageString(variant?.imageUrl || variant?.url || variant?.src);
        return {
          ...variant,
          imageUrl: filterUnrelatedR2Images(imgUrl) ? imgUrl : "",
        };
      })
    : [];

  const rawThumbnail = normalizeImageString(productData?.thumbnail) || normalizeImageString(productData?.image);
  const thumbnail = (rawThumbnail && filterUnrelatedR2Images(rawThumbnail))
    ? rawThumbnail
    : (images.length > 0 ? images[0] : "");

  return {
    ...productData,
    image: thumbnail,
    thumbnail,
    images,
    variants,
  };
};

const buildProductPayload = (body: any) => {
  let incomingImages = body.images;
  if (typeof incomingImages === "string") {
    try {
      incomingImages = JSON.parse(incomingImages);
    } catch (e) {
      incomingImages = [incomingImages];
    }
  }

  let incomingVariants = body.variants;
  if (typeof incomingVariants === "string") {
    try {
      incomingVariants = JSON.parse(incomingVariants);
    } catch (e) {
      incomingVariants = [];
    }
  }

  let dimensions = body.dimensions;
  if (typeof dimensions === "string") {
    try {
      dimensions = JSON.parse(dimensions);
    } catch (e) {
      dimensions = {};
    }
  }

  const payload: any = {
    productName: body.productName || body.name || "",
    skuCode: (body.skuCode || body.sku || "").toString().trim().toUpperCase(),
    category: body.category || "",
    subCategory: body.subCategory || "",
    variants: Array.isArray(incomingVariants)
      ? incomingVariants.map((v: any) => ({
          color: v.color || "",
          design: v.design || "",
          sellingPrice: Number(v.sellingPrice ?? v.price ?? 0),
          mrp: Number(v.mrp ?? 0),
          stockQuantity: Number(v.stockQuantity ?? v.stock ?? 0),
          imageUrl: normalizeImageString(v.imageUrl || v.url),
        }))
      : [],
    sellingPrice: Number(body.sellingPrice || 0),
    mrp: Number(body.mrp || 0),
    stockQuantity: Number(body.stockQuantity ?? body.stock ?? 0),
    shortDescription: body.shortDescription || body.shortDesc || "",
    detailedDescription: body.detailedDescription || body.detailedDesc || "",
    weight: Number(body.weight || 0),
    dimensions: typeof dimensions === "object" ? dimensions : {},
    gst: Number(body.gst || 0),
    active: body.active !== undefined ? body.active : true,
    thumbnail: normalizeImageString(body.thumbnail)
      || normalizeImageString(body.image)
      || (Array.isArray(incomingImages) && normalizeImageString(incomingImages[0]))
      || "",
    images: Array.isArray(incomingImages)
      ? incomingImages
          .map((img: any) => normalizeImageString(img))
          .filter(Boolean)
      : [],
  };

  if (body.published !== undefined) {
    payload.published = body.published === true || body.published === "true";
  }

  return payload;
};

const getUploadedFiles = (req: Request): Express.Multer.File[] => {
  const anyReq = req as any;
  const files: Express.Multer.File[] = Array.isArray(anyReq.files)
    ? anyReq.files as Express.Multer.File[]
    : req.file ? [req.file] : [];

  console.log("[getUploadedFiles] total files received:", files.length, files.map(f => ({ field: f.fieldname, name: f.originalname, size: f.size })));

  // deduplicate by originalname + size to prevent same file multiple times
  const seen = new Set<string>();
  return files.filter((f) => {
    const key = `${f.originalname}-${f.size}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const hasBlobImageInBody = (body: any) => {
  const values = [body?.image, ...(Array.isArray(body?.images) ? body.images : [])];
  return values.some((value: any) => typeof value === "string" && value.startsWith("blob:"));
};

const uploadFilesToR2 = async (files: Express.Multer.File[], productId: string) => {
  const uploadResults = await Promise.all(files.map((file) => uploadToR2(file, productId)));
  return uploadResults.filter(Boolean);
};

const logUploadDebug = (req: Request, prefix = "upload debug") => {
  const anyReq = req as any;
  const fileInfo = req.file
    ? { fieldname: req.file.fieldname, originalname: req.file.originalname, mimetype: req.file.mimetype, size: req.file.size }
    : undefined;
  const filesInfo = Array.isArray(anyReq.files)
    ? anyReq.files.map((f: any) => ({ fieldname: f.fieldname, originalname: f.originalname, mimetype: f.mimetype, size: f.size }))
    : anyReq.files;

  console.log(prefix, {
    contentType: req.headers["content-type"],
    bodyKeys: req.body && typeof req.body === "object" ? Object.keys(req.body) : undefined,
    bodyImageField: req.body?.image ? typeof req.body.image === "string" ? req.body.image.slice(0, 50) : "[non-string]" : undefined,
    file: fileInfo,
    files: filesInfo,
  });
};

const uploadToR2 = async (file: Express.Multer.File, productId: string) => {
  const fileExt = file.originalname.split(".").pop() || "jpg";
  const fileName = `products/${productId}-${uuidv4()}.${fileExt}`;

  try {
    await r2Client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: fileName,
        Body: file.buffer,
        ContentType: file.mimetype,
      })
    );
  } catch (err) {
    console.error("R2 upload failed", err);
    throw err;
  }

  return `${R2_PUBLIC_URL}/${fileName}`;
};

const sendError = (res: Response, status: number, message: string) =>
  res.status(status).json({ success: false, message });


// GET /api/products/dashboard?search=&category=&status=&page=&limit=
export const getDashboardProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const { search, category, status, page = 1, limit = 20 } = req.query;

    const filter: Record<string, any> = {};
    if (category) filter.category = category;
    if (search) filter.productName = { $regex: search, $options: "i" };
    if (status === "Published") { filter.published = true; }
    else if (status === "Draft") { filter.active = false; }
    else if (status === "Pending") { filter.published = false; filter.active = true; }

    const [products, productsTotal] = await Promise.all([
      Product.find(filter).sort({ createdAt: -1 }),
      Product.countDocuments(filter),
    ]);

    const formattedProducts = products.map((p) => {
      const normalized = normalizeProductImageFields(p);
      return {
        id: normalized._id,
        name: normalized.productName,
        category: normalized.category || "",
        price: normalized.sellingPrice || 0,
        status: normalized.published ? "Published" : !normalized.active ? "Draft" : "Pending",
        date: normalized.createdAt?.toISOString?.().split("T")[0] || "",
        image: normalized.image || normalized.thumbnail || "",
        images: Array.isArray(normalized.images) ? normalized.images : [],
        stock: normalized.stockQuantity || 0,
        createdAt: normalized.createdAt,
        isCombo: false,
      };
    });

    // Load combo products
    let comboFilter: Record<string, any> = {};
    if (search) comboFilter.comboName = { $regex: search, $options: "i" };
    if (status === "Published") { comboFilter.published = true; }
    else if (status === "Draft") { comboFilter.active = false; }
    else if (status === "Pending") { comboFilter.published = false; comboFilter.active = true; }

    const combos = await ComboProduct.find(comboFilter)
      .populate("items.product", "thumbnail image images")
      .sort({ createdAt: -1 });

    const combosTotal = combos.length;

    const formattedCombos = combos.map((c) => {
      const firstProd: any = c.items[0]?.product;
      const image = firstProd?.thumbnail || firstProd?.image || (firstProd?.images && firstProd.images[0]) || "/product/placeholder.svg";
      const images = firstProd?.images || [];

      return {
        id: c._id,
        name: c.comboName,
        category: "Stationery Combo Set",
        price: c.comboPrice,
        status: c.published ? "Published" : !c.active ? "Draft" : "Pending",
        date: c.createdAt?.toISOString?.().split("T")[0] || "",
        image,
        images,
        stock: c.comboStock,
        createdAt: c.createdAt,
        isCombo: true,
      };
    });

    const mergedData = [...formattedProducts, ...formattedCombos];

    // Sort by date desc
    mergedData.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });

    const total = productsTotal + combosTotal;
    const skip = (Number(page) - 1) * Number(limit);
    const paginatedData = mergedData.slice(skip, skip + Number(limit));

    res.status(200).json({
      success: true,
      data: paginatedData,
      pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
    });
  } catch (err) {
    console.error(err);
    sendError(res, 500, "Server Error");
  }
};

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

    const data = products.map((product) => normalizeProductImageFields(product));

    res.status(200).json({
      success: true,
      data,
      pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
    });
  } catch (err) {
    console.error(err);
    sendError(res, 500, "Server Error");
  }
};

// GET /api/products/store  — only published products for frontend
export const getStoreProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const { search, category, page = 1, limit = 1000 } = req.query;

    const filter: Record<string, any> = { published: true };
    if (category) filter.category = category;
    if (search) filter.productName = { $regex: search, $options: "i" };

    const skip = (Number(page) - 1) * Number(limit);
    const [products, productsTotal] = await Promise.all([
      Product.find(filter)
        .select("productName category subCategory sellingPrice mrp thumbnail images stockQuantity skuCode shortDescription variants createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Product.countDocuments(filter),
    ]);

    const formattedProducts = products.map((product) => {
      const normalized = normalizeProductImageFields(product);
      return {
        _id: normalized._id,
        subCategory: normalized.subCategory || "",
        category: normalized.category || "",
        productName: normalized.productName || "",
        shortDescription: normalized.shortDescription || normalized.shortDesc || "",
        sellingPrice: normalized.sellingPrice ?? 0,
        mrp: normalized.mrp ?? 0,
        image: normalized.image || normalized.thumbnail || "",
        thumbnail: normalized.thumbnail || "",
        images: Array.isArray(normalized.images) ? normalized.images : [],
        stockQuantity: normalized.stockQuantity ?? 0,
        skuCode: normalized.skuCode || "",
        createdAt: normalized.createdAt,
        isCombo: false
      };
    });

    // Load combo products if category matches Stationery, Stationery Combo Set or is empty (All)
    let comboData: any[] = [];
    let combosTotal = 0;

    const normalizedCategory = category ? category.toString().toLowerCase() : "";
    const includesCombo = !category || normalizedCategory === "stationery" || normalizedCategory === "stationery combo set";

    if (includesCombo) {
      const comboFilter: Record<string, any> = { published: true };
      if (search) {
        comboFilter.comboName = { $regex: search, $options: "i" };
      }

      const combos = await ComboProduct.find(comboFilter)
        .populate("items.product", "productName skuCode sellingPrice mrp thumbnail images stockQuantity")
        .sort({ createdAt: -1 });

      combosTotal = combos.length;

      comboData = combos.map((c) => {
        const mrp = c.items.reduce((sum, item: any) => {
          const prod = item.product;
          return sum + ((prod?.sellingPrice ?? prod?.price ?? 0) * (item.quantity || 1));
        }, 0);
        
        const firstProd: any = c.items[0]?.product;
        const image = firstProd?.thumbnail || firstProd?.image || (firstProd?.images && firstProd.images[0]) || "/product/placeholder.svg";
        const images = firstProd?.images || [];

        return {
          _id: c._id,
          subCategory: "Stationery Combo Set",
          category: "Stationery",
          productName: c.comboName,
          shortDescription: c.comboDesc || "Special Combo Pack",
          sellingPrice: c.comboPrice,
          mrp: mrp || c.comboPrice,
          image,
          thumbnail: image,
          images,
          stockQuantity: c.comboStock,
          skuCode: c.comboSku,
          createdAt: c.createdAt,
          isCombo: true
        };
      });
    }

    const mergedData = [...formattedProducts, ...comboData];

    // Sort by createdAt desc
    mergedData.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });

    const total = productsTotal + combosTotal;

    res.status(200).json({
      success: true,
      data: mergedData,
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
    let product = await Product.findById(req.params.id);
    if (product) {
      res.status(200).json({ success: true, data: normalizeProductImageFields(product) });
      return;
    }

    const combo = await ComboProduct.findById(req.params.id)
      .populate("items.product", "productName skuCode sellingPrice mrp thumbnail images stockQuantity shortDescription detailedDescription");

    if (!combo) {
      sendError(res, 404, "Product not found");
      return;
    }

    const mrp = combo.items.reduce((sum, item: any) => {
      const prod = item.product;
      return sum + ((prod?.sellingPrice ?? prod?.price ?? 0) * (item.quantity || 1));
    }, 0);

    const firstProd: any = combo.items[0]?.product;
    const image = firstProd?.thumbnail || firstProd?.image || (firstProd?.images && firstProd.images[0]) || "/product/placeholder.svg";
    const images = firstProd?.images || [];

    const formattedCombo = {
      _id: combo._id,
      productName: combo.comboName,
      skuCode: combo.comboSku,
      sellingPrice: combo.comboPrice,
      mrp: mrp || combo.comboPrice,
      stockQuantity: combo.comboStock,
      category: "Stationery",
      subCategory: "Stationery Combo Set",
      shortDescription: combo.comboDesc || "Special Combo Pack",
      detailedDescription: combo.comboDesc || "Special Combo Pack containing multiple curated items.",
      thumbnail: image,
      images,
      variants: [],
      weight: 0,
      dimensions: {},
      gst: 0,
      isCombo: true,
      active: combo.active,
      published: combo.published,
    };

    res.status(200).json({ success: true, data: formattedCombo });
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

    logUploadDebug(req, "createProduct debug");

    const uploadedFiles = getUploadedFiles(req);
    if (uploadedFiles.length === 0 && hasBlobImageInBody(req.body)) {
      sendError(res, 400, "Please upload the image file using multipart/form-data, not a blob URL.");
      return;
    }

    console.log("createProduct uploaded files:", uploadedFiles.map((file) => ({ fieldname: file.fieldname, originalname: file.originalname, mimetype: file.mimetype, size: file.size })));

    const payload = buildProductPayload(req.body);
    // clear any body-provided image URLs — only R2 uploaded URLs will be used
    payload.images = [];
    payload.thumbnail = "";

    const product = await Product.create(payload);

    if (uploadedFiles.length > 0) {
      try {
        const uploadedImageUrls = await uploadFilesToR2(uploadedFiles, String(product._id));
        product.images = uploadedImageUrls;
        product.thumbnail = uploadedImageUrls[0];
        product.markModified("images");
        product.markModified("thumbnail");
        await product.save();
      } catch (err) {
        await product.deleteOne();
        sendError(res, 500, "Failed to upload image to R2");
        return;
      }
    }

    const normalizedProduct = normalizeProductImageFields(product);
    res.status(201).json({ success: true, message: "Product created successfully", data: normalizedProduct });
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

    const uploadedFiles = getUploadedFiles(req);
    if (uploadedFiles.length === 0 && hasBlobImageInBody(req.body)) {
      sendError(res, 400, "Please upload the image file using multipart/form-data, not a blob URL.");
      return;
    }

    const payload: any = buildProductPayload(req.body);

    if (req.body.images === undefined) {
      payload.images = product.images;
    }

    if (uploadedFiles.length > 0) {
      const uploadedImageUrls = await uploadFilesToR2(uploadedFiles, String(product._id));
      const existingImagesToKeep = req.body.images !== undefined ? (payload.images || []) : (product.images || []);
      const mergedImages = [...new Set([...existingImagesToKeep, ...uploadedImageUrls])];
      payload.thumbnail = payload.thumbnail || uploadedImageUrls[0] || product.thumbnail || "";
      payload.images = mergedImages;
    }

    const updated = await Product.findByIdAndUpdate(req.params.id, payload, { new: true });
    const normalizedUpdatedProduct = normalizeProductImageFields(updated);
    res.status(200).json({ success: true, message: "Product updated successfully", data: normalizedUpdatedProduct });
  } catch (err) {
    console.error(err);
    sendError(res, 500, "Server Error");
  }
};

// DELETE /api/products/:id
export const deleteProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const deleted = await Product.findByIdAndDelete(req.params.id);
    if (deleted) {
      res.status(200).json({ success: true, message: "Product deleted successfully" });
      return;
    }

    const deletedCombo = await ComboProduct.findByIdAndDelete(req.params.id);
    if (!deletedCombo) { sendError(res, 404, "Product not found"); return; }
    res.status(200).json({ success: true, message: "Combo product deleted successfully" });
  } catch (err) {
    console.error(err);
    sendError(res, 500, "Server Error");
  }
};

// PATCH /api/products/:id/list
export const listProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    let product = await Product.findByIdAndUpdate(
      req.params.id,
      { published: true, active: true },
      { new: true }
    );
    if (product) {
      res.status(200).json({ success: true, message: "Product listed", data: product });
      return;
    }

    const combo = await ComboProduct.findByIdAndUpdate(
      req.params.id,
      { published: true, active: true },
      { new: true }
    );
    if (!combo) { sendError(res, 404, "Product not found"); return; }
    res.status(200).json({ success: true, message: "Combo product listed", data: combo });
  } catch (err) {
    console.error(err);
    sendError(res, 500, "Server Error");
  }
};

// PATCH /api/products/:id/unlist
export const unlistProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    let product = await Product.findByIdAndUpdate(
      req.params.id,
      { published: false, active: false },
      { new: true }
    );
    if (product) {
      res.status(200).json({ success: true, message: "Product unlisted", data: product });
      return;
    }

    const combo = await ComboProduct.findByIdAndUpdate(
      req.params.id,
      { published: false, active: false },
      { new: true }
    );
    if (!combo) { sendError(res, 404, "Product not found"); return; }
    res.status(200).json({ success: true, message: "Combo product unlisted", data: combo });
  } catch (err) {
    console.error(err);
    sendError(res, 500, "Server Error");
  }
};

// POST /api/products/:id/upload-image
export const uploadProductImage = async (req: Request, res: Response): Promise<void> => {
  try {
    const uploadedFiles = getUploadedFiles(req);
    if (uploadedFiles.length === 0) { sendError(res, 400, "No image file provided"); return; }

    const product = await Product.findById(req.params.id);
    if (!product) { sendError(res, 404, "Product not found"); return; }

    const uploadedImageUrls = await uploadFilesToR2(uploadedFiles, String(product._id));
    const mergedImages = [...new Set([...(product.images || []), ...uploadedImageUrls])];
    product.images = mergedImages;
    product.thumbnail = product.thumbnail || uploadedImageUrls[0] || "";
    product.markModified("images");
    product.markModified("thumbnail");
    await product.save();

    const normalizedProduct = normalizeProductImageFields(product);
    res.status(200).json({ success: true, message: "Image uploaded successfully", imageUrls: uploadedImageUrls, data: normalizedProduct });
  } catch (err) {
    console.error(err);
    sendError(res, 500, "Failed to upload image");
  }
};
