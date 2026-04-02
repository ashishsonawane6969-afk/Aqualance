const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/productController');
// const auth = require('../middleware/auth');
const { authenticatedLimiter } = require('../middleware/rateLimiter');
const { validate } = require('../middleware/validate');
// const { productWriteSchema, productQuerySchema } = require('../validation/schemas');

router.get('/', (req, res) => {
  res.json({ message: "route working" });
});

module.exports = router;
