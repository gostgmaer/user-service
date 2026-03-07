// src/utils/security.js
'use strict';

/**
 * Evaluate password strength.
 * Returns { isValid, score, checks, feedback, suggestions, warning }
 */
const checkPasswordStrength = (password) => {
  const checks = {
    minLength:       password.length >= 8,
    hasUpperCase:    /[A-Z]/.test(password),
    hasLowerCase:    /[a-z]/.test(password),
    hasNumbers:      /[0-9]/.test(password),
    hasSpecialChars: /[^A-Za-z0-9]/.test(password),
  };

  const score       = Object.values(checks).filter(Boolean).length;
  const isValid     = score >= 3 && checks.minLength;
  const suggestions = [];

  if (!checks.minLength)       suggestions.push('Use at least 8 characters');
  if (!checks.hasUpperCase)    suggestions.push('Add at least one uppercase letter');
  if (!checks.hasLowerCase)    suggestions.push('Add at least one lowercase letter');
  if (!checks.hasNumbers)      suggestions.push('Add at least one number');
  if (!checks.hasSpecialChars) suggestions.push('Add at least one special character');

  const feedback = score <= 1 ? 'Very Weak' : score === 2 ? 'Weak' : score === 3 ? 'Fair' : score === 4 ? 'Strong' : 'Very Strong';
  const warning  = !isValid ? 'Password does not meet minimum requirements' : '';

  return { isValid, score, checks, feedback, suggestions, warning };
};

module.exports = { checkPasswordStrength };
