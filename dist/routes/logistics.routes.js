"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const logistics_controller_1 = require("../controllers/logistics_controller");
const router = (0, express_1.Router)();
// Ship order route (POST /api/logistics/orders/:orderId/ship)
router.post("/orders/:orderId/ship", logistics_controller_1.shipOrderWithiThink);
// Track AWB shipment routes
router.get("/shipments/:awbNumber/track", logistics_controller_1.trackiThinkShipment);
router.post("/order/track", logistics_controller_1.trackiThinkShipment);
router.post("/track", logistics_controller_1.trackiThinkShipment);
// Shipment Label Generation & Printing (POST /api/logistics/shipping/label)
router.post("/shipping/label", logistics_controller_1.getiThinkShippingLabel);
router.post("/label", logistics_controller_1.getiThinkShippingLabel);
router.get("/shipments/:awbNumber/label", logistics_controller_1.getiThinkShippingLabel);
router.get("/shipments/:awbNumber/label-html", logistics_controller_1.renderOrderLabelHtml);
router.get("/orders/:orderId/label-html", logistics_controller_1.renderOrderLabelHtml);
router.get("/orders/:orderId/label", logistics_controller_1.renderOrderLabelHtml);
// Customer Invoice Generation & Printing (POST /api/logistics/shipping/invoice)
router.post("/shipping/invoice", logistics_controller_1.getiThinkCustomerInvoice);
router.post("/invoice", logistics_controller_1.getiThinkCustomerInvoice);
router.get("/shipments/:awbNumber/invoice", logistics_controller_1.getiThinkCustomerInvoice);
router.get("/shipments/:awbNumber/invoice-html", logistics_controller_1.renderOrderInvoiceHtml);
router.get("/orders/:orderId/invoice-html", logistics_controller_1.renderOrderInvoiceHtml);
router.get("/orders/:orderId/invoice", logistics_controller_1.renderOrderInvoiceHtml);
// NDR (Non-Delivery Report) Actions: Reattempt & RTO (POST /api/logistics/ndr/add-reattempt-rto)
router.post("/ndr/add-reattempt-rto", logistics_controller_1.handleNDRAction);
router.post("/ndr/action", logistics_controller_1.handleNDRAction);
router.post("/ndr", logistics_controller_1.handleNDRAction);
// Warehouse / Pickup Location Management (Add & Get)
router.post("/warehouse/add", logistics_controller_1.addiThinkWarehouse);
router.post("/warehouse", logistics_controller_1.addiThinkWarehouse);
router.post("/warehouse/get", logistics_controller_1.getiThinkWarehouses);
router.post("/warehouses", logistics_controller_1.getiThinkWarehouses);
router.get("/warehouses", logistics_controller_1.getiThinkWarehouses);
router.get("/warehouses/:warehouseId", logistics_controller_1.getiThinkWarehouses);
// Store Management (Get Registered Stores & Statuses)
router.post("/store/get", logistics_controller_1.getiThinkStores);
router.post("/stores", logistics_controller_1.getiThinkStores);
router.get("/stores", logistics_controller_1.getiThinkStores);
router.get("/stores/:storeId", logistics_controller_1.getiThinkStores);
// Store Order Details & Order Lists (POST /api/logistics/store/get-order-details & get-order-list)
router.post("/store/get-order-details", logistics_controller_1.getiThinkStoreOrderDetails);
router.post("/store/order-details", logistics_controller_1.getiThinkStoreOrderDetails);
router.post("/store/get-order-list", logistics_controller_1.getiThinkStoreOrderList);
router.post("/store/order-list", logistics_controller_1.getiThinkStoreOrderList);
// State Info & Success IDs for Warehouse (POST /api/logistics/state/get & GET /api/logistics/states)
router.post("/state/get", logistics_controller_1.getiThinkStates);
router.post("/states", logistics_controller_1.getiThinkStates);
router.get("/states", logistics_controller_1.getiThinkStates);
router.get("/states/:countryId", logistics_controller_1.getiThinkStates);
// City Info & Success IDs for Warehouse (POST /api/logistics/city/get & GET /api/logistics/cities/:stateId)
router.post("/city/get", logistics_controller_1.getiThinkCities);
router.post("/cities", logistics_controller_1.getiThinkCities);
router.get("/cities/:stateId", logistics_controller_1.getiThinkCities);
// Get Order Details against AWB list (POST /api/logistics/orders/get-details)
router.post("/orders/get-details", logistics_controller_1.getiThinkOrderDetails);
router.post("/order-details", logistics_controller_1.getiThinkOrderDetails);
// Check pincode serviceability routes
router.post("/pincode-check", logistics_controller_1.checkPincodeServiceability);
router.post("/pincode/check", logistics_controller_1.checkPincodeServiceability);
router.get("/pincode/:pincode", logistics_controller_1.checkPincodeServiceability);
// Calculate shipping charges & rate check routes
router.post("/shipping-charge", logistics_controller_1.getShippingCharge);
router.post("/rate/check", logistics_controller_1.getShippingCharge);
router.post("/rate-check", logistics_controller_1.getShippingCharge);
// Calculate zone rates across all zones (POST /api/logistics/rate/zone-rate)
router.post("/rate/zone-rate", logistics_controller_1.getiThinkZoneRates);
router.post("/rate/zone_rate", logistics_controller_1.getiThinkZoneRates);
router.post("/zone-rate", logistics_controller_1.getiThinkZoneRates);
exports.default = router;
