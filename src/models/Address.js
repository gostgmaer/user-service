// src/models/Address.js
'use strict';

const mongoose = require('mongoose');

const COUNTRY_CODES = [
  'AF','AL','DZ','AD','AO','AG','AR','AM','AU','AT','AZ','BS','BH','BD','BB','BY',
  'BE','BZ','BJ','BT','BO','BA','BW','BR','BN','BG','BF','BI','CV','KH','CM','CA',
  'CF','TD','CL','CN','CO','KM','CG','CD','CR','HR','CU','CY','CZ','DK','DJ','DM',
  'DO','EC','EG','SV','GQ','ER','EE','SZ','ET','FJ','FI','FR','GA','GM','GE','DE',
  'GH','GR','GD','GT','GN','GW','GY','HT','HN','HU','IS','IN','ID','IR','IQ','IE',
  'IL','IT','JM','JP','JO','KZ','KE','KI','KW','KG','LA','LV','LB','LS','LR','LY',
  'LI','LT','LU','MG','MW','MY','MV','ML','MT','MH','MR','MU','MX','FM','MD','MC',
  'MN','ME','MA','MZ','MM','NA','NR','NP','NL','NZ','NI','NE','NG','NO','OM','PK',
  'PW','PA','PG','PY','PE','PH','PL','PT','QA','RO','RU','RW','KN','LC','VC','WS',
  'SM','ST','SA','SN','RS','SC','SL','SG','SK','SI','SB','SO','ZA','SS','ES','LK',
  'SD','SR','SE','CH','SY','TW','TJ','TZ','TH','TL','TG','TO','TT','TN','TR','TM',
  'TV','UG','UA','AE','GB','US','UY','UZ','VU','VE','VN','YE','ZM','ZW',
];

const addressSchema = new mongoose.Schema(
  {
    user:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tenantId:     { type: String, required: true, index: true },
    label:        { type: String, trim: true, default: 'Home' },
    fullName:     { type: String, trim: true, required: true },
    phone:        { type: String, trim: true, default: null },
    email:        { type: String, trim: true, lowercase: true, default: null },
    addressLine1: { type: String, trim: true, required: true },
    addressLine2: { type: String, trim: true, default: null },
    addressLine3: { type: String, trim: true, default: null },
    city:         { type: String, trim: true, required: true },
    state:        { type: String, trim: true, default: null },
    country: {
      type: String,
      trim: true,
      uppercase: true,
      required: true,
      validate: {
        validator: (v) => COUNTRY_CODES.includes(v.toUpperCase()),
        message:   'Invalid ISO-3166 country code',
      },
    },
    postalCode:  { type: String, trim: true, default: null },
    isDefault:   { type: Boolean, default: false },
    isActive:    { type: Boolean, default: true },
    isDeleted:   { type: Boolean, default: false },
    tags:        [{ type: String, trim: true }],
    created_by:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updated_by:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    status: {
      type: String,
      enum: ['active','inactive','deleted'],
      default: 'active',
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

addressSchema.index({ user: 1, tenantId: 1 });
addressSchema.index({ user: 1, isDefault: 1 });

// Ensure only one default per user
addressSchema.pre('save', async function (next) {
  if (this.isDefault && this.isModified('isDefault')) {
    await this.constructor.updateMany(
      { user: this.user, tenantId: this.tenantId, _id: { $ne: this._id } },
      { $set: { isDefault: false } }
    );
  }
  next();
});

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
 * Requires the doc to be populated: .populate('created_by updated_by', 'firstName lastName username email')
 */
addressSchema.methods.toAPIResponse = function () {
  const obj = this.toObject();
  delete obj.__v;
  delete obj.created_by;
  delete obj.updated_by;
  obj.createdBy = resolveUserRef(this.created_by);
  obj.updatedBy = resolveUserRef(this.updated_by);
  return obj;
};

module.exports = mongoose.model('Address', addressSchema);
