// ── REPLACE the existing variantBulkSchema in validation/schemas.js ──────────
// Find: const variantBulkSchema = Joi.object({
// Replace the entire const with this:

const variantBulkSchema = Joi.object({
  variants: Joi.array().items(
    Joi.object({
      id:                Joi.number().integer().positive().optional(),
      variant_name:      Joi.string().trim().max(100).required(),
      size_value:        Joi.number().min(0).max(999_999).optional().default(0),
      size_unit:         Joi.string().valid('GM','ML','KG','L','PCS').optional().default('PCS'), // was required
      pack_quantity:     Joi.number().integer().min(1).max(9999).optional().default(1),
      price:             Joi.number().positive().precision(2).max(999_999).required(),
      mrp:               Joi.number().positive().precision(2).max(999_999).optional().allow(null),
      distributor_price: Joi.number().positive().precision(2).max(999_999).optional().allow(null), // NEW
      stock:             Joi.number().integer().min(0).max(999_999).optional().default(0),
      sku:               Joi.string().trim().max(80).optional().allow('', null),
    }).options({ stripUnknown: true })
  ).min(0).max(20).required(),
}).options({ stripUnknown: true });
