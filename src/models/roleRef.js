// src/models/roleRef.js
// Lightweight inline schemas that reference the SHARED roles/permissions
// collections owned by the auth service. Prevents model re-registration errors
// and eliminates circular imports when both User.js and authorize.js need them.
'use strict';

const mongoose = require('mongoose');

const getRoleModel = () => {
  if (mongoose.models.Role) return mongoose.models.Role;
  const s = new mongoose.Schema(
    {
      name:        String,
      tenantId:    String,
      isActive:    Boolean,
      isDeleted:   Boolean,
      permissions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Permission' }],
    },
    { collection: 'roles' }
  );
  return mongoose.model('Role', s);
};

const getPermissionModel = () => {
  if (mongoose.models.Permission) return mongoose.models.Permission;
  const s = new mongoose.Schema(
    { resource: String, action: String, tenantId: String, isActive: Boolean },
    { collection: 'permissions' }
  );
  return mongoose.model('Permission', s);
};

module.exports = { getRoleModel, getPermissionModel };
