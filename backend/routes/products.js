console.log("✅ products routes loaded");

const express = require('express');
const router = express.Router();


router.get('/', ctrl.getAll);
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Products API working 🚀'
  });
});

module.exports = router;
