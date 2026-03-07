// src/config/services.js
// All downstream service base URLs — always sourced from env.js, never from process.env directly.
'use strict';

const env = require('./env');

module.exports = {
  authService:    env.services.auth,
  emailService:   env.services.email,
  orderService:   env.services.order,
  cartService:    env.services.cart,
  wishlistService:env.services.wishlist,
  notifyService:  env.services.notification,
};
