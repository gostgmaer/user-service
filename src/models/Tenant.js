// src/models/Tenant.js
'use strict';

const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema(
  {
    tenantId:    { type: String, required: true, unique: true, index: true },
    name:        { type: String, required: true, trim: true },
    domain:      { type: String, trim: true, default: null },
    isActive:    { type: Boolean, default: true },
    isDeleted:   { type: Boolean, default: false },
    plan:        { type: String, enum: ['free','starter','pro','enterprise'], default: 'free' },
    settings:    { type: mongoose.Schema.Types.Mixed, default: {} },
    created_by:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Tenant', tenantSchema);
