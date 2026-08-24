"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadProductImage = exports.unpublishProduct = exports.publishProduct = exports.deleteProduct = exports.updateProduct = exports.createProduct = exports.getProductById = exports.getStoreProducts = exports.getProducts = exports.getDashboardProducts = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const uuid_1 = require("uuid");
const Product_model_1 = __importDefault(require("../models/Product_model"));
const ComboProduct_model_1 = __importDefault(require("../models/ComboProduct_model"));
const r2_1 = require("../config/r2");
// ─── Helpers ────────────────────────────────────────────────────────────────
const isValidImageUrl = (value) => {
    if (typeof value !== "string")
        return false;
    const trimmed = value.trim();
    return trimmed.length > 0 && /^(https?:\/\/|\/)/i.test(trimmed) && !trimmed.startsWith("blob:");
};
const normalizeImageString = (value) => {
    if (typeof value === "string") {
        const trimmed = value.trim();
        return isValidImageUrl(trimmed) ? trimmed : "";
    }
    if (value && typeof value === "object") {
        return normalizeImageString(value.url || value.imageUrl || value.src || value.path || value.href);
    }
    return "";
};
const normalizeProductImageFields = (product) => {
    const productData = product && typeof product.toObject === "function" ? product.toObject() : product;
    const productIdStr = productData._id ? String(productData._id) : "";
    const filterUnrelatedR2Images = (url) => {
        if (!url)
            return false;
        const lowerUrl = url.toLowerCase();
        if ((lowerUrl.includes("product") || url.includes(r2_1.R2_PUBLIC_URL)) && productIdStr) {
            return url.includes(productIdStr);
        }
        return true;
    };
    const images = Array.isArray(productData?.images)
        ? [...new Set(productData.images
                .map((img) => normalizeImageString(img))
                .filter(Boolean)
                .filter(filterUnrelatedR2Images))]
        : [];
    const variants = Array.isArray(productData?.variants)
        ? productData.variants.map((variant) => {
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
const buildProductPayload = (body) => {
    let incomingImages = body.images;
    if (typeof incomingImages === "string") {
        try {
            incomingImages = JSON.parse(incomingImages);
        }
        catch (e) {
            incomingImages = [incomingImages];
        }
    }
    let incomingVariants = body.variants;
    if (typeof incomingVariants === "string") {
        try {
            incomingVariants = JSON.parse(incomingVariants);
        }
        catch (e) {
            incomingVariants = [];
        }
    }
    let dimensions = body.dimensions;
    if (typeof dimensions === "string") {
        try {
            dimensions = JSON.parse(dimensions);
        }
        catch (e) {
            // Parse plain text dimensions like "30x20x10" or "30*20*10"
            const cleaned = dimensions.replace(/[^0-9.x*×]/gi, "");
            const parts = cleaned.split(/[x*×]/i);
            if (parts.length >= 3) {
                dimensions = {
                    length: Number(parts[0]) || 10,
                    width: Number(parts[1]) || 10,
                    height: Number(parts[2]) || 10,
                };
            }
            else {
                dimensions = {};
            }
        }
    }
    // Auto-convert grams (>5) to kg, otherwise keep kg input
    const rawWeight = Number(body.weight || 0);
    const normalizedWeight = rawWeight > 5 ? rawWeight / 1000 : rawWeight;
    const payload = {
        productName: body.productName || body.name || "",
        skuCode: (body.skuCode || body.sku || "").toString().trim().toUpperCase(),
        category: body.category || "",
        subCategory: body.subCategory || "",
        variants: Array.isArray(incomingVariants)
            ? incomingVariants.map((v) => ({
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
        weight: normalizedWeight,
        dimensions: typeof dimensions === "object" ? dimensions : {},
        gst: Number(body.gst || 0),
        active: body.active !== undefined ? body.active : true,
        thumbnail: normalizeImageString(body.thumbnail)
            || normalizeImageString(body.image)
            || (Array.isArray(incomingImages) && normalizeImageString(incomingImages[0]))
            || "",
        images: Array.isArray(incomingImages)
            ? incomingImages
                .map((img) => normalizeImageString(img))
                .filter(Boolean)
            : [],
    };
    if (body.published !== undefined) {
        payload.published = body.published === true || body.published === "true";
    }
    return payload;
};
const getUploadedFiles = (req) => {
    const anyReq = req;
    const files = Array.isArray(anyReq.files)
        ? anyReq.files
        : req.file ? [req.file] : [];
    console.log("[getUploadedFiles] total files received:", files.length, files.map(f => ({ field: f.fieldname, name: f.originalname, size: f.size })));
    // deduplicate by originalname + size to prevent same file multiple times
    const seen = new Set();
    return files.filter((f) => {
        const key = `${f.originalname}-${f.size}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
};
const hasBlobImageInBody = (body) => {
    const values = [body?.image, ...(Array.isArray(body?.images) ? body.images : [])];
    return values.some((value) => typeof value === "string" && value.startsWith("blob:"));
};
const uploadFilesToR2 = async (files, productId) => {
    const uploadResults = await Promise.all(files.map((file) => uploadToR2(file, productId)));
    return uploadResults.filter(Boolean);
};
const logUploadDebug = (req, prefix = "upload debug") => {
    const anyReq = req;
    const fileInfo = req.file
        ? { fieldname: req.file.fieldname, originalname: req.file.originalname, mimetype: req.file.mimetype, size: req.file.size }
        : undefined;
    const filesInfo = Array.isArray(anyReq.files)
        ? anyReq.files.map((f) => ({ fieldname: f.fieldname, originalname: f.originalname, mimetype: f.mimetype, size: f.size }))
        : anyReq.files;
    console.log(prefix, {
        contentType: req.headers["content-type"],
        bodyKeys: req.body && typeof req.body === "object" ? Object.keys(req.body) : undefined,
        bodyImageField: req.body?.image ? typeof req.body.image === "string" ? req.body.image.slice(0, 50) : "[non-string]" : undefined,
        file: fileInfo,
        files: filesInfo,
    });
};
const uploadToR2 = async (file, productId) => {
    const fileExt = file.originalname.split(".").pop() || "jpg";
    const fileName = `products/${productId}-${(0, uuid_1.v4)()}.${fileExt}`;
    try {
        await r2_1.r2Client.send(new client_s3_1.PutObjectCommand({
            Bucket: r2_1.R2_BUCKET_NAME,
            Key: fileName,
            Body: file.buffer,
            ContentType: file.mimetype,
        }));
    }
    catch (err) {
        console.error("R2 upload failed", err);
        throw err;
    }
    return `${r2_1.R2_PUBLIC_URL}/${fileName}`;
};
const sendError = (res, status, message) => res.status(status).json({ success: false, message });
// GET /api/products/dashboard?search=&category=&status=&page=&limit=
const getDashboardProducts = async (req, res) => {
    try {
        const { search, category, status, page = 1, limit = 1000 } = req.query;
        const filter = {};
        if (category)
            filter.category = category;
        if (search)
            filter.productName = { $regex: search, $options: "i" };
        if (status === "Published") {
            filter.published = true;
        }
        else if (status === "Draft") {
            filter.active = false;
        }
        else if (status === "Pending") {
            filter.published = false;
            filter.active = true;
        }
        const [products, productsTotal] = await Promise.all([
            Product_model_1.default.find(filter).sort({ createdAt: -1 }),
            Product_model_1.default.countDocuments(filter),
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
                deletedAt: normalized.deletedAt || null,
                isCombo: false,
            };
        });
        // Load combo products
        let comboFilter = {};
        if (search)
            comboFilter.comboName = { $regex: search, $options: "i" };
        if (status === "Published") {
            comboFilter.published = true;
        }
        else if (status === "Draft") {
            comboFilter.active = false;
        }
        else if (status === "Pending") {
            comboFilter.published = false;
            comboFilter.active = true;
        }
        const combos = await ComboProduct_model_1.default.find(comboFilter)
            .populate("items.product", "thumbnail image images")
            .sort({ createdAt: -1 });
        const combosTotal = combos.length;
        const formattedCombos = combos.map((c) => {
            const firstProd = c.items[0]?.product;
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
                deletedAt: c.deletedAt || null,
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
    }
    catch (err) {
        console.error(err);
        sendError(res, 500, "Server Error");
    }
};
exports.getDashboardProducts = getDashboardProducts;
// GET /api/products?category=&published=&active=&search=&page=&limit=
const getProducts = async (req, res) => {
    try {
        const { category, published, active, search, page = 1, limit = 20 } = req.query;
        const filter = {};
        if (category)
            filter.category = category;
        if (published !== undefined)
            filter.published = published === "true";
        if (active !== undefined)
            filter.active = active === "true";
        if (search)
            filter.productName = { $regex: search, $options: "i" };
        const skip = (Number(page) - 1) * Number(limit);
        const [products, total] = await Promise.all([
            Product_model_1.default.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
            Product_model_1.default.countDocuments(filter),
        ]);
        const data = products.map((product) => normalizeProductImageFields(product));
        res.status(200).json({
            success: true,
            data,
            pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
        });
    }
    catch (err) {
        console.error(err);
        sendError(res, 500, "Server Error");
    }
};
exports.getProducts = getProducts;
// GET /api/products/store  — only published products for frontend
const getStoreProducts = async (req, res) => {
    try {
        const { search, category, page = 1, limit = 1000 } = req.query;
        const filter = { published: true };
        if (category)
            filter.category = category;
        if (search)
            filter.productName = { $regex: search, $options: "i" };
        const skip = (Number(page) - 1) * Number(limit);
        const [products, productsTotal] = await Promise.all([
            Product_model_1.default.find(filter)
                .select("productName category subCategory sellingPrice mrp thumbnail images stockQuantity skuCode shortDescription variants createdAt")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(Number(limit)),
            Product_model_1.default.countDocuments(filter),
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
        let comboData = [];
        let combosTotal = 0;
        const normalizedCategory = category ? category.toString().toLowerCase() : "";
        const includesCombo = !category || normalizedCategory === "stationery" || normalizedCategory === "stationery combo set";
        if (includesCombo) {
            const comboFilter = { published: true };
            if (search) {
                comboFilter.comboName = { $regex: search, $options: "i" };
            }
            const combos = await ComboProduct_model_1.default.find(comboFilter)
                .populate("items.product", "productName skuCode sellingPrice mrp thumbnail images stockQuantity")
                .sort({ createdAt: -1 });
            combosTotal = combos.length;
            comboData = combos.map((c) => {
                const mrp = c.items.reduce((sum, item) => {
                    const prod = item.product;
                    return sum + ((prod?.sellingPrice ?? prod?.price ?? 0) * (item.quantity || 1));
                }, 0);
                const firstProd = c.items[0]?.product;
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
    }
    catch (err) {
        console.error(err);
        sendError(res, 500, "Server Error");
    }
};
exports.getStoreProducts = getStoreProducts;
// GET /api/products/:id
const getProductById = async (req, res) => {
    try {
        let product = await Product_model_1.default.findById(req.params.id);
        if (product) {
            res.status(200).json({ success: true, data: normalizeProductImageFields(product) });
            return;
        }
        const combo = await ComboProduct_model_1.default.findById(req.params.id)
            .populate("items.product", "productName skuCode sellingPrice mrp thumbnail images stockQuantity shortDescription detailedDescription");
        if (!combo) {
            sendError(res, 404, "Product not found");
            return;
        }
        const mrp = combo.items.reduce((sum, item) => {
            const prod = item.product;
            return sum + ((prod?.sellingPrice ?? prod?.price ?? 0) * (item.quantity || 1));
        }, 0);
        const firstProd = combo.items[0]?.product;
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
    }
    catch (err) {
        console.error(err);
        sendError(res, 500, "Server Error");
    }
};
exports.getProductById = getProductById;
// POST /api/products  (multipart/form-data, image field optional)
const createProduct = async (req, res) => {
    try {
        const productName = req.body.productName || req.body.name;
        const skuCode = req.body.skuCode || req.body.sku;
        if (!productName || !skuCode) {
            sendError(res, 400, "Product Name & SKU are required");
            return;
        }
        const formattedSku = skuCode.toString().trim().toUpperCase();
        const existing = await Product_model_1.default.findOne({ skuCode: formattedSku });
        if (existing) {
            sendError(res, 409, "SKU already exists");
            return;
        }
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
        const product = await Product_model_1.default.create(payload);
        if (uploadedFiles.length > 0) {
            try {
                const uploadedImageUrls = await uploadFilesToR2(uploadedFiles, String(product._id));
                product.images = uploadedImageUrls;
                product.thumbnail = uploadedImageUrls[0];
                product.markModified("images");
                product.markModified("thumbnail");
                await product.save();
            }
            catch (err) {
                await product.deleteOne();
                sendError(res, 500, "Failed to upload image to R2");
                return;
            }
        }
        const normalizedProduct = normalizeProductImageFields(product);
        res.status(201).json({ success: true, message: "Product created successfully", data: normalizedProduct });
    }
    catch (err) {
        console.error(err);
        sendError(res, 500, "Server Error");
    }
};
exports.createProduct = createProduct;
// PUT /api/products/:id  (multipart/form-data, image field optional)
const updateProduct = async (req, res) => {
    try {
        const product = await Product_model_1.default.findById(req.params.id);
        if (!product) {
            sendError(res, 404, "Product not found");
            return;
        }
        const uploadedFiles = getUploadedFiles(req);
        if (uploadedFiles.length === 0 && hasBlobImageInBody(req.body)) {
            sendError(res, 400, "Please upload the image file using multipart/form-data, not a blob URL.");
            return;
        }
        const payload = buildProductPayload(req.body);
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
        if (payload.active === true) {
            payload.$unset = { deletedAt: "" };
            delete payload.deletedAt;
        }
        const updated = await Product_model_1.default.findByIdAndUpdate(req.params.id, payload, { new: true });
        const normalizedUpdatedProduct = normalizeProductImageFields(updated);
        res.status(200).json({ success: true, message: "Product updated successfully", data: normalizedUpdatedProduct });
    }
    catch (err) {
        console.error(err);
        sendError(res, 500, "Server Error");
    }
};
exports.updateProduct = updateProduct;
// DELETE /api/products/:id (Soft Delete to Draft)
const deleteProduct = async (req, res) => {
    try {
        const deleted = await Product_model_1.default.findByIdAndUpdate(req.params.id, { active: false, published: false, deletedAt: new Date() }, { new: true });
        if (deleted) {
            res.status(200).json({ success: true, message: "Product moved to draft successfully" });
            return;
        }
        const deletedCombo = await ComboProduct_model_1.default.findByIdAndUpdate(req.params.id, { active: false, published: false, deletedAt: new Date() }, { new: true });
        if (!deletedCombo) {
            sendError(res, 404, "Product not found");
            return;
        }
        res.status(200).json({ success: true, message: "Combo product moved to draft successfully" });
    }
    catch (err) {
        console.error(err);
        sendError(res, 500, "Server Error");
    }
};
exports.deleteProduct = deleteProduct;
// PATCH /api/products/:id/publish (Publish / Recover)
const publishProduct = async (req, res) => {
    try {
        let product = await Product_model_1.default.findByIdAndUpdate(req.params.id, { published: true, active: true, $unset: { deletedAt: "" } }, { new: true });
        if (product) {
            res.status(200).json({ success: true, message: "Product published", data: product });
            return;
        }
        const combo = await ComboProduct_model_1.default.findByIdAndUpdate(req.params.id, { published: true, active: true, $unset: { deletedAt: "" } }, { new: true });
        if (!combo) {
            sendError(res, 404, "Product not found");
            return;
        }
        res.status(200).json({ success: true, message: "Combo product published", data: combo });
    }
    catch (err) {
        console.error(err);
        sendError(res, 500, "Server Error");
    }
};
exports.publishProduct = publishProduct;
// PATCH /api/products/:id/unpublish
const unpublishProduct = async (req, res) => {
    try {
        let product = await Product_model_1.default.findByIdAndUpdate(req.params.id, { published: false }, { new: true });
        if (product) {
            res.status(200).json({ success: true, message: "Product unpublished", data: product });
            return;
        }
        const combo = await ComboProduct_model_1.default.findByIdAndUpdate(req.params.id, { published: false }, { new: true });
        if (!combo) {
            sendError(res, 404, "Product not found");
            return;
        }
        res.status(200).json({ success: true, message: "Combo product unpublished", data: combo });
    }
    catch (err) {
        console.error(err);
        sendError(res, 500, "Server Error");
    }
};
exports.unpublishProduct = unpublishProduct;
// POST /api/products/:id/upload-image
const uploadProductImage = async (req, res) => {
    try {
        const uploadedFiles = getUploadedFiles(req);
        if (uploadedFiles.length === 0) {
            sendError(res, 400, "No image file provided");
            return;
        }
        const product = await Product_model_1.default.findById(req.params.id);
        if (!product) {
            sendError(res, 404, "Product not found");
            return;
        }
        const uploadedImageUrls = await uploadFilesToR2(uploadedFiles, String(product._id));
        const mergedImages = [...new Set([...(product.images || []), ...uploadedImageUrls])];
        product.images = mergedImages;
        product.thumbnail = product.thumbnail || uploadedImageUrls[0] || "";
        product.markModified("images");
        product.markModified("thumbnail");
        await product.save();
        const normalizedProduct = normalizeProductImageFields(product);
        res.status(200).json({ success: true, message: "Image uploaded successfully", imageUrls: uploadedImageUrls, data: normalizedProduct });
    }
    catch (err) {
        console.error(err);
        sendError(res, 500, "Failed to upload image");
    }
};
exports.uploadProductImage = uploadProductImage;
