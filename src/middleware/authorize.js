// src/middleware/authorize.js
// Permission-based RBAC middleware with superadmin bypass.
//
// Role and Permission documents live in the SHARED database owned by the
// auth service. We do NOT duplicate those model files here — instead we
// reference the same collections via lightweight inline schemas so that
// mongoose can query them in this process without redefining their full logic.
'use strict';

const User       = require('../models/User');
const AppError   = require('../utils/appError');
const { getRoleModel, getPermissionModel } = require('../models/roleRef');

const authorize = (resource, action) => {
  return async (req, res, next) => {
    try {
      // Service accounts (Mode 2) bypass RBAC — the service-to-service
      // API key is already a trusted credential.
      if (req.user?.isServiceAccount) return next();

      if (!req.user) return next(AppError.unauthorized('Authentication required'));

      const userId   = req.user._id;
      const tenantId = req.tenantId || req.user.tenantId;

      // Reload user to get fresh role
      const user = await User.findOne({ _id: userId, tenantId, isDeleted: false });
      if (!user) return next(AppError.unauthorized('User not found'));

      // Superadmin bypass — role is populated in auth middleware (has .name)
      const roleName = user.role?.name;
      if (roleName === 'super_admin') return next();

      // Settings resource — only super_admin
      if (resource === 'settings') {
        return next(AppError.forbidden('Only super_admin can access settings'));
      }

      // Query the shared roles collection via the roleRef helper
      const Role = getRoleModel();
      void getPermissionModel(); // ensure Permission model is registered for populate
      const role = await Role.findById(user.role?._id || user.role)
        .populate({ path: 'permissions', match: { isActive: true } });

      if (!role) return next(AppError.forbidden('Role not found or inactive'));

      const hasPermission = role.permissions.some(
        (p) => p.resource === resource && (p.action === action || p.action === 'manage')
      );

      if (hasPermission) return next();

      return next(AppError.forbidden(`Access denied: requires ${action}:${resource}`));
    } catch (err) {
      return next(AppError.internal('Authorization check failed'));
    }
  };
};

module.exports = { authorize };
