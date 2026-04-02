'use strict';

const express = require('express');
const app = express();

const PORT = process.env.PORT || 5000;

// 🔥 Minimal route
app.get('/', (req, res) => {
  res.send('SERVER WORKING');
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 🔥 Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 MINIMAL SERVER RUNNING ON ${PORT}`);
});
