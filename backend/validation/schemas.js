'use strict';

const Joi = require('joi');

/* ── Reusable field definitions ───────────────────────────────────────────── */
const phone = Joi.string()
  .pattern(/^[6-9]\d{9}$/)
  .messages({ 'string.pattern.base': 'Phone must be a valid 10-digit Indian mobile number' });

const id = Joi.number().integer().positive().max(2_147_483_647);

const safeText = (max = 255) =>
  Joi.string()
    .trim()
    .max(max)
    .custom((value) => value.replace(/<[^>]*>/g, '').trim(), 'strip HTML tags');

const latitude  = Joi.number().min(-90).max(90);
const longitude = Joi.number().min(-180).max(180);

/* ── AUTH ─────────────────────────────────────────────────────────────────── */
const loginSchema = Joi.object({
  phone:    phone.required(),
  password: Joi.string().min(8).max(128).required(),
}).options({ stripUnknown: true });

/* ── ORDERS ───────────────────────────────────────────────────────────────── */
const orderCreateSchema = Joi.object({
  customer_name: safeText(100).required(),
  shop_name:     safeText(150).required(),
  phone:         phone.required(),
  address:       safeText(500).required(),
  city:          safeText(100).required(),
  pincode:       Joi.string().pattern(/^\d{6}$/).required()
                   .messages({ 'string.pattern.base': 'Pincode must be 6 digits' }),
  latitude:      latitude.optional().allow(null),
  longitude:     longitude.optional().allow(null),
  notes:         safeText(1000).optional().allow('', null),
  products: Joi.array().items(
    Joi.object({
      id:         id.required(),
      variant_id: Joi.number().integer().positive().optional().allow(null),
      quantity:   Joi.number().integer().min(1).max(9999).required(),
    }).options({ stripUnknown: true })
  ).min(1).max(50).required(),
}).options({ stripUnknown: true });

const orderAssignSchema = Joi.object({
  order_id:    id.required(),
  delivery_id: id.required(),
}).options({ stripUnknown: true });

const orderStatusSchema = Joi.object({
  order_id: id.required(),
  status:   Joi.string()
              .valid('pending', 'assigned', 'out_for_delivery', 'delivered', 'cancelled')
              .required(),
}).options({ stripUnknown: true });

/* ── PRODUCTS ─────────────────────────────────────────────────────────────── */
const _imageField = Joi.alternatives()
  .try(
    Joi.string().uri().max(2048),
    Joi.string()
      .pattern(/^data:image\/[a-zA-Z0-9.+_-]+;base64,[A-Za-z0-9+\/\r\n]+=*$/)
      .max(10_000_000)
  )
  .optional().allow('', null);

const productWriteSchema = Joi.object({
  name:         safeText(150).required(),
  description:  safeText(2000).optional().allow('', null),
  price:        Joi.number().positive().precision(2).max(999_999).required(),
  mrp:          Joi.number().positive().precision(2).max(999_999).optional().allow(null),
  distributor_price: Joi.number().positive().precision(2).max(999_999).optional().allow(null),
  image:        _imageField,
  images:       Joi.array().items(_imageField).max(3).optional().allow(null),
  category:     safeText(80).optional().allow('', null).default('General'),
  stock:        Joi.number().integer().min(0).max(999_999).optional(),
  unit:         safeText(50).optional().allow('', null).default('piece'),
  is_active:    Joi.boolean().optional(),
  product_type: Joi.string().valid('jar', 'strip', 'single').optional().default('single'),
  // Bundle fields
  base_quantity: Joi.number().positive().precision(2).max(999_999).optional().allow(null),
  base_unit:     Joi.string().valid('GM','KG','L','ML','PCS').optional().allow(null, ''),
  pack_size:     Joi.number().integer().positive().max(9999).optional().allow(null),
  is_bundle:     Joi.boolean().optional().default(false),
  display_name:  safeText(255).optional().allow('', null),
}).options({ stripUnknown: true });

const productQuerySchema = Joi.object({
  category: safeText(80).optional().allow('', null),
  search:   safeText(200).optional().allow('', null),
}).options({ stripUnknown: true });

// ── REPLACE the existing variantBulkSchema in validation/schemas.js ──────────
// Find: const variantBulkSchema = Joi.object({
// Replace the entire const with this:

const variantBulkSchema = Joi.object({
  variants: Joi.array().items(
    Joi.object({
      id:                Joi.number().integer().positive().optional(),
      variant_name:      Joi.string().trim().max(100).required(),
      size_value:        Joi.number().min(0).max(999_999).optional().default(0),
      size_unit:         Joi.string().valid('GM','ML','KG','L','PCS').optional().default('PCS'),
      pack_quantity:     Joi.number().integer().min(1).max(9999).optional().default(1),
      price:             Joi.number().positive().precision(2).max(999_999).required(),
      mrp:               Joi.number().positive().precision(2).max(999_999).optional().allow(null),
      distributor_price: Joi.number().positive().precision(2).max(999_999).optional().allow(null),
      stock:             Joi.number().integer().min(0).max(999_999).optional().default(0),
      sku:               Joi.string().trim().max(80).optional().allow('', null),
      // Per-variant bundle fields
      is_bundle:         Joi.boolean().optional().default(false),
      base_quantity:     Joi.number().positive().precision(2).max(999_999).optional().allow(null),
      base_unit:         Joi.string().valid('GM','KG','ML','L','PCS').optional().allow(null, '').default('PCS'),
      pack_size:         Joi.number().integer().positive().max(9999).optional().allow(null),
      display_name:      Joi.string().trim().max(255).optional().allow('', null),
    }).options({ stripUnknown: true })
  ).min(0).max(20).required(),
}).options({ stripUnknown: true });

const bundleItemsSchema = Joi.object({
  items: Joi.array().items(
    Joi.object({
      product_id: id.required(),
      variant_id: Joi.number().integer().positive().optional().allow(null),
      quantity:   Joi.number().integer().min(1).max(9999).required(),
    }).options({ stripUnknown: true })
  ).min(0).max(50).required(),
}).options({ stripUnknown: true });

/* ── DELIVERY ─────────────────────────────────────────────────────────────── */
const deliveryBoySchema = Joi.object({
  name:     safeText(100).required(),
  phone:    phone.required(),
  password: Joi.string().min(8).max(128).required()
              .messages({ 'string.min': 'Password must be at least 8 characters' }),
}).options({ stripUnknown: true });

/* ── SALESMAN ─────────────────────────────────────────────────────────────── */
const salesmanCreateSchema = Joi.object({
  name:     safeText(100).required(),
  phone:    phone.required(),
  password: Joi.string().min(8).max(128).required()
              .messages({ 'string.min': 'Password must be at least 8 characters' }),
}).options({ stripUnknown: true });

const leadProductSchema = Joi.object({
  product_id: Joi.number().integer().positive().max(2_147_483_647).required(),
  name:       Joi.string().trim().max(150).required(),
  price:      Joi.number().min(0).precision(2).max(999_999).required(),
  quantity:   Joi.number().integer().min(1).max(9999).required(),
  total:      Joi.number().min(0).precision(2).max(99_999_999).required(),
}).options({ stripUnknown: true });

const leadCreateSchema = Joi.object({
  shop_name:   safeText(150).required(),
  shop_type:   safeText(80).optional().allow('', null),
  owner_name:  safeText(100).required(),
  mobile:      phone.required(),
  village:     safeText(100).required(),
  taluka:      safeText(100).required(),
  district:    safeText(100).required(),
  sale_status: Joi.string().valid('YES', 'NO').optional().default('NO'),
  photo_proof: Joi.string()
    .pattern(/^data:image\/(jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/]+=*$/)
    .max(200_000)
    .optional().allow('', null)
    .messages({ 'string.pattern.base': 'Photo must be a valid image (JPEG, PNG, WebP, or GIF)' }),
  notes:       safeText(1000).optional().allow('', null),
  visited_at:  Joi.string().isoDate().optional().allow('', null),
  products: Joi.array()
    .items(leadProductSchema)
    .min(1).max(50).required()
    .messages({ 'array.min': 'At least one product must be selected.', 'any.required': 'Products are required.' }),
}).options({ stripUnknown: true });

const leadUpdateSchema = leadCreateSchema.fork(
  ['shop_name', 'owner_name', 'mobile', 'village', 'taluka', 'district', 'products'],
  (field) => field.optional()
);

const areaAssignSchema = Joi.object({
  taluka:   safeText(100).required(),
  district: safeText(100).required(),
}).options({ stripUnknown: true });

const reportQuerySchema = Joi.object({
  from: Joi.string().isoDate().optional(),
  to:   Joi.string().isoDate().optional(),
}).options({ stripUnknown: true });

const leadsQuerySchema = Joi.object({
  from:        Joi.string().isoDate().optional(),
  to:          Joi.string().isoDate().optional(),
  sale_status: Joi.string().valid('YES', 'NO').optional(),
  district:    safeText(100).optional().allow('', null),
  taluka:      safeText(100).optional().allow('', null),
  page:        Joi.number().integer().min(1).max(100000).optional(),
  per_page:    Joi.number().integer().min(1).max(500).optional(),
}).options({ stripUnknown: true });

/* ── GEO ──────────────────────────────────────────────────────────────────── */
const geoLeadSchema = Joi.object({
  shop_name:    safeText(150).required(),
  shop_type:    safeText(80).optional().allow('', null),
  owner_name:   safeText(100).required(),
  mobile:       phone.required(),
  village:      safeText(100).required(),
  taluka:       safeText(100).required(),
  district:     safeText(100).required(),
  sale_status:  Joi.string().valid('YES', 'NO').optional().default('NO'),
  latitude:     latitude.optional().allow(null),
  longitude:    longitude.optional().allow(null),
  gps_accuracy: Joi.number().min(0).max(99999).optional().allow(null),
  address_geo:  safeText(500).optional().allow('', null),
  photo_data: Joi.string()
    .pattern(/^data:image\/(jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/]+=*$/)
    .max(27_000_000)
    .optional().allow('', null),
  notes:       safeText(1000).optional().allow('', null),
  visited_at:  Joi.string().isoDate().optional().allow('', null),
  products:    Joi.array().items(leadProductSchema).max(50).optional().allow(null),
}).options({ stripUnknown: true });

const geoTrackSchema = Joi.object({
  latitude:  latitude.required(),
  longitude: longitude.required(),
  accuracy:  Joi.number().min(0).max(99999).optional().allow(null),
}).options({ stripUnknown: true });

const geoValidateSchema = Joi.object({
  latitude:  latitude.required(),
  longitude: longitude.required(),
  taluka_id: id.optional().allow(null),
}).options({ stripUnknown: true });

const talukaCreateSchema = Joi.object({
  name:       safeText(100).required(),
  district:   safeText(100).required(),
  state:      safeText(100).optional().allow('', null).default('Maharashtra'),
  center_lat: latitude.required(),
  center_lng: longitude.required(),
  radius_km:  Joi.number().positive().max(500).required(),
  is_active:  Joi.boolean().optional(),
}).options({ stripUnknown: true });

const talukaUpdateSchema = talukaCreateSchema.fork(
  ['name', 'district', 'center_lat', 'center_lng', 'radius_km'],
  (field) => field.optional()
);

const talukaAssignSchema = Joi.object({
  taluka_id: id.optional().allow(null),
}).options({ stripUnknown: true });

/* ── PAGINATION ───────────────────────────────────────────────────────────── */
const paginationFields = {
  page:     Joi.number().integer().min(1).max(100000).optional(),
  per_page: Joi.number().integer().min(1).max(200).optional(),
};

const orderQuerySchema = Joi.object({
  status: Joi.string()
    .valid('all', 'pending', 'assigned', 'out_for_delivery', 'delivered', 'cancelled')
    .optional(),
  ...paginationFields,
}).options({ stripUnknown: true });

const mapLeadsQuerySchema = Joi.object({
  from:        Joi.string().isoDate().optional(),
  to:          Joi.string().isoDate().optional(),
  salesman_id: id.optional(),
  limit:       Joi.number().integer().min(1).max(2000).optional(),
  offset:      Joi.number().integer().min(0).optional(),
}).options({ stripUnknown: true });

/* ── AI CHAT ──────────────────────────────────────────────────────────────── */
const aiChatSchema = Joi.object({
  message: Joi.string().trim().min(2).max(500).required()
    .messages({ 'string.min': 'Message is too short.', 'string.max': 'Message must be 500 characters or fewer.' }),
  history: Joi.array()
    .items(
      Joi.object({
        role:  Joi.string().valid('user', 'model').required(),
        parts: Joi.array()
          .items(Joi.object({ text: Joi.string().max(2000).required() }).options({ stripUnknown: true }))
          .min(1).max(1).required(),
      }).options({ stripUnknown: true })
    )
    .max(12).optional().default([]),
}).options({ stripUnknown: true });

/* ── CHANGE / RESET PASSWORD ──────────────────────────────────────────────── */
const changePasswordSchema = Joi.object({
  current_password: Joi.string().min(1).max(128).required(),
  new_password:     Joi.string().min(8).max(128).required()
    .messages({ 'string.min': 'New password must be at least 8 characters' }),
}).options({ stripUnknown: true });

const resetPasswordSchema = Joi.object({
  new_password: Joi.string().min(8).max(128).required()
    .messages({ 'string.min': 'Password must be at least 8 characters' }),
}).options({ stripUnknown: true });

/* ── MFA ──────────────────────────────────────────────────────────────────── */
const mfaOtpSchema = Joi.object({
  otp: Joi.string().pattern(/^\d{6}$/).required()
    .messages({ 'string.pattern.base': 'OTP must be exactly 6 digits' }),
}).options({ stripUnknown: true });

const mfaVerifyLoginSchema = Joi.object({
  mfa_token: Joi.string().required(),
  otp:       Joi.string().pattern(/^\d{6}$/).required()
    .messages({ 'string.pattern.base': 'OTP must be exactly 6 digits' }),
}).options({ stripUnknown: true });

/* ── SMS OTP ──────────────────────────────────────────────────────────────── */
const otpVerifySchema = Joi.object({
  otp_token: Joi.string().required(),
  otp:       Joi.string().pattern(/^\d{6}$/).required()
    .messages({ 'string.pattern.base': 'OTP must be exactly 6 digits' }),
}).options({ stripUnknown: true });

const otpResendSchema = Joi.object({
  otp_token: Joi.string().required(),
}).options({ stripUnknown: true });

module.exports = {
  loginSchema, otpVerifySchema, otpResendSchema,
  mfaOtpSchema, mfaVerifyLoginSchema, changePasswordSchema, resetPasswordSchema,
  aiChatSchema,
  orderCreateSchema, orderQuerySchema, orderAssignSchema, orderStatusSchema,
  productWriteSchema, productQuerySchema, variantBulkSchema, bundleItemsSchema,
  deliveryBoySchema,
  salesmanCreateSchema, leadCreateSchema, leadUpdateSchema,
  areaAssignSchema, reportQuerySchema, leadsQuerySchema,
  geoLeadSchema, mapLeadsQuerySchema, geoTrackSchema, geoValidateSchema,
  talukaCreateSchema, talukaUpdateSchema, talukaAssignSchema,
};
