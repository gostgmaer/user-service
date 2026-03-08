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

/**
 * Resolve a user reference to the best available display label.
 * Priority: "First Last" → username → email → id string
 */
function resolveUserRef(ref) {
  if (!ref) return null;
  if (ref !== null && typeof ref === 'object' && !ref._bsontype) {
    const fullName = [ref.firstName, ref.lastName].filter(Boolean).join(' ').trim();
    if (fullName)   return fullName;
    if (ref.username) return ref.username;
    if (ref.email)    return ref.email;
    return String(ref._id ?? ref.id);
  }
  return String(ref);
}

/**
 * Returns a safe API shape with actor refs resolved to display names.
 * Requires the doc to be populated: .populate('created_by', 'firstName lastName username email')
 */
tenantSchema.methods.toAPIResponse = function () {
  const obj = this.toObject();
  delete obj.__v;
  delete obj.isDeleted;
  delete obj.created_by;
  obj.createdBy = resolveUserRef(this.created_by);
  return obj;
};

module.exports = mongoose.model('Tenant', tenantSchema);
