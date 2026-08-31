import { Router } from "express";
import {
  shipOrderWithiThink,
  trackiThinkShipment,
  checkPincodeServiceability,
  getShippingCharge,
  getiThinkOrderDetails,
  getiThinkShippingLabel,
  renderOrderLabelHtml,
  getiThinkCustomerInvoice,
  renderOrderInvoiceHtml,
  getiThinkStates,
  getiThinkCities,
  addiThinkWarehouse,
  getiThinkWarehouses,
  getiThinkZoneRates,
  getiThinkStores,
  getiThinkStoreOrderDetails,
  getiThinkStoreOrderList,
  handleNDRAction
} from "../controllers/logistics_controller";

const router = Router();

// Ship order route (POST /api/logistics/orders/:orderId/ship)
router.post("/orders/:orderId/ship", shipOrderWithiThink);

// Track AWB shipment routes
router.get("/shipments/:awbNumber/track", trackiThinkShipment);
router.post("/order/track", trackiThinkShipment);
router.post("/track", trackiThinkShipment);

// Shipment Label Generation & Printing (POST /api/logistics/shipping/label)
router.post("/shipping/label", getiThinkShippingLabel);
router.post("/label", getiThinkShippingLabel);
router.get("/shipments/:awbNumber/label", getiThinkShippingLabel);
router.get("/shipments/:awbNumber/label-html", renderOrderLabelHtml);
router.get("/orders/:orderId/label-html", renderOrderLabelHtml);
router.get("/orders/:orderId/label", renderOrderLabelHtml);

// Customer Invoice Generation & Printing (POST /api/logistics/shipping/invoice)
router.post("/shipping/invoice", getiThinkCustomerInvoice);
router.post("/invoice", getiThinkCustomerInvoice);
router.get("/shipments/:awbNumber/invoice", getiThinkCustomerInvoice);
router.get("/shipments/:awbNumber/invoice-html", renderOrderInvoiceHtml);
router.get("/orders/:orderId/invoice-html", renderOrderInvoiceHtml);
router.get("/orders/:orderId/invoice", renderOrderInvoiceHtml);

// NDR (Non-Delivery Report) Actions: Reattempt & RTO (POST /api/logistics/ndr/add-reattempt-rto)
router.post("/ndr/add-reattempt-rto", handleNDRAction);
router.post("/ndr/action", handleNDRAction);
router.post("/ndr", handleNDRAction);

// Warehouse / Pickup Location Management (Add & Get)
router.post("/warehouse/add", addiThinkWarehouse);
router.post("/warehouse", addiThinkWarehouse);
router.post("/warehouse/get", getiThinkWarehouses);
router.post("/warehouses", getiThinkWarehouses);
router.get("/warehouses", getiThinkWarehouses);
router.get("/warehouses/:warehouseId", getiThinkWarehouses);

// Store Management (Get Registered Stores & Statuses)
router.post("/store/get", getiThinkStores);
router.post("/stores", getiThinkStores);
router.get("/stores", getiThinkStores);
router.get("/stores/:storeId", getiThinkStores);

// Store Order Details & Order Lists (POST /api/logistics/store/get-order-details & get-order-list)
router.post("/store/get-order-details", getiThinkStoreOrderDetails);
router.post("/store/order-details", getiThinkStoreOrderDetails);
router.post("/store/get-order-list", getiThinkStoreOrderList);
router.post("/store/order-list", getiThinkStoreOrderList);

// State Info & Success IDs for Warehouse (POST /api/logistics/state/get & GET /api/logistics/states)
router.post("/state/get", getiThinkStates);
router.post("/states", getiThinkStates);
router.get("/states", getiThinkStates);
router.get("/states/:countryId", getiThinkStates);

// City Info & Success IDs for Warehouse (POST /api/logistics/city/get & GET /api/logistics/cities/:stateId)
router.post("/city/get", getiThinkCities);
router.post("/cities", getiThinkCities);
router.get("/cities/:stateId", getiThinkCities);

// Get Order Details against AWB list (POST /api/logistics/orders/get-details)
router.post("/orders/get-details", getiThinkOrderDetails);
router.post("/order-details", getiThinkOrderDetails);

// Check pincode serviceability routes
router.post("/pincode-check", checkPincodeServiceability);
router.post("/pincode/check", checkPincodeServiceability);
router.get("/pincode/:pincode", checkPincodeServiceability);

// Calculate shipping charges & rate check routes
router.post("/shipping-charge", getShippingCharge);
router.post("/rate/check", getShippingCharge);
router.post("/rate-check", getShippingCharge);

// Calculate zone rates across all zones (POST /api/logistics/rate/zone-rate)
router.post("/rate/zone-rate", getiThinkZoneRates);
router.post("/rate/zone_rate", getiThinkZoneRates);
router.post("/zone-rate", getiThinkZoneRates);

export default router;
