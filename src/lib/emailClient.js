// src/lib/emailClient.js
// Delegates all outbound email to the Email Microservice.
// No SMTP / nodemailer setup needed in this service.
'use strict';

const serviceClient  = require('./serviceClient');
const { emailService } = require('../config/services');
const logger           = require('../services/logger');

/**
 * Send an email via the Email Microservice.
 * @param {string}  to         - Recipient email address
 * @param {string}  templateId - Template identifier in the email service
 * @param {object}  data       - Template variables
 * @param {string}  [subject]  - Optional subject override
 */
const sendEmail = async ({ to, templateId, data, subject }) => {
  if (!emailService) {
    logger.warn('[EmailClient] EMAIL_SERVICE_URL not configured — skipping email');
    return null;
  }

  try {
    const response = await serviceClient.post(`${emailService}/api/send-email`, {
      to,
      templateId,
      data,
      subject,
    });
    logger.info('[EmailClient] Email queued', { to, templateId });
    return response.data;
  } catch (err) {
    logger.error('[EmailClient] Failed to send email', {
      to,
      templateId,
      error: err.message,
    });
    // Non-fatal — do not re-throw; the main operation should still succeed
    return null;
  }
};

module.exports = { sendEmail };
