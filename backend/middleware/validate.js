/**
 * middleware/validate.js
 * ─────────────────────────────────────────────────────────────────────────────
 * OWASP A03 – Injection / A08 – Software & Data Integrity
 *
 * Factory that returns an Express middleware validating req.body or req.query
 * against a Joi schema.
 *
 * Usage:
 *   const { validate } = require('./validate');
 *   const { loginSchema } = require('../validation/schemas');
 *
 *   router.post('/login', validate(loginSchema), ctrl.login);
 *   router.get('/leads', validate(leadsQuerySchema, 'query'), ctrl.getLeads);
 *
 * Behaviour:
 *  • On failure:  returns 422 with the FIRST validation error message.
 *                 (Returning only one error avoids information leakage about
 *                  the full schema structure.)
 *  • On success:  replaces req.body / req.query with the validated+stripped
 *                 object so downstream code always works with clean data.
 *
 * Options passed to every schema:
 *  • abortEarly: true   — stop at first error (less schema leakage)
 *  • stripUnknown: true — silently remove any field not in the schema
 *                         (prevents mass-assignment / parameter pollution)
 *  • convert: true      — coerce types (e.g. "123" → 123 for Joi.number())
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

/**
 * @param {import('joi').Schema} schema   - Joi schema to validate against
 * @param {'body'|'query'|'params'} source - Which part of the request to validate
 * @returns Express middleware
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly:    true,   // return only the first validation error
      stripUnknown:  true,   // OWASP: drop unexpected fields (mass-assignment guard)
      convert:       true,   // coerce strings to numbers/booleans where declared
    });

    if (error) {
      // Return the first validation message only — do not expose full schema
      const message = error.details[0].message
        .replace(/['"]/g, '')  // remove Joi's surrounding quotes for cleaner UX
        .replace(/\d+(\.\d+)?(\.\d+)?$/g, (m) => m); // keep numeric bounds readable

      return res.status(422).json({
        success: false,
        message: `Validation error: ${message}`,
      });
    }

    // Replace source with sanitised, stripped value
    req[source] = value;
    next();
  };
}

module.exports = { validate };
