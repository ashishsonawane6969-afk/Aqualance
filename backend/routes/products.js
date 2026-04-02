const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Products API working 🚀'
  });
});

module.exports = router;
