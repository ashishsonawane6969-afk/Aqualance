'use strict';

const express = require('express');
const router  = express.Router();

console.log("🔍 Loading productController...");

const ctrl = require('../controllers/productController');

console.log("✅ productController loaded");

const auth = require('../middleware/auth');
const { authenticatedLimiter } = require('../middleware/rateLimiter');
const { validate } = require('../middleware/validate');
const { productWriteSchema, productQuerySchema } = require('../validation/schemas');
