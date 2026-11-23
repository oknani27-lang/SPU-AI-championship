'use strict';
const { createHandler } = require('../server.cjs');
const handler = createHandler();
module.exports = (req, res) => {
  const url = new URL(req.url, 'https://placeholder.invalid');
  const route = req.query?.route ?? url.searchParams.get('route');
  const path = Array.isArray(route) ? route.join('/') : route;
  req.url = typeof path === 'string' && /^[a-zA-Z0-9/-]+$/.test(path) ? '/api/' + path : '/api/not-found';
  return handler(req, res);
};
