// src/utils/helper.js
'use strict';

/**
 * Paginate, sort, and search an in-memory array.
 */
const paginateSortSearch = (array, { page = 1, limit = 20, sortBy, order = 'desc', search, searchFields = [] } = {}) => {
  let items = [...array];

  if (search && searchFields.length > 0) {
    const keyword = search.toLowerCase();
    items = items.filter((item) =>
      searchFields.some((field) => String(item[field] || '').toLowerCase().includes(keyword))
    );
  }

  if (sortBy) {
    items.sort((a, b) => {
      const aVal = a[sortBy];
      const bVal = b[sortBy];
      if (aVal < bVal) return order === 'asc' ? -1 : 1;
      if (aVal > bVal) return order === 'asc' ? 1 : -1;
      return 0;
    });
  }

  const total      = items.length;
  const totalPages = Math.ceil(total / limit);
  const skip       = (page - 1) * limit;
  const data       = items.slice(skip, skip + limit);

  return { data, total, page, limit, totalPages };
};

/**
 * Build a MongoDB filter object from a plain key-value object.
 * Only keys in allowedFields are included.
 */
const buildFilters = (queryObject = {}, allowedFields = []) => {
  return allowedFields.reduce((acc, field) => {
    if (queryObject[field] !== undefined && queryObject[field] !== '') {
      acc[field] = queryObject[field];
    }
    return acc;
  }, {});
};

/**
 * Format a duration in milliseconds as a relative human-readable string.
 */
const formatRelativeDuration = (ms) => {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60)   return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)   return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  const hours   = Math.floor(minutes / 60);
  if (hours < 24)     return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  const days    = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
};

module.exports = { paginateSortSearch, buildFilters, formatRelativeDuration };
