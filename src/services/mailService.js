const nodemailer = require('nodemailer');
const db = require('../db');
require('dotenv').config();

// Create reusable transporter object using the default SMTP transport
const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST || 'smtp.gmail.com',
  port: process.env.MAIL_PORT || 587,
  secure: process.env.MAIL_SECURE === 'true', // true for 465, false for other ports
  connectionTimeout: 1500,
  greetingTimeout: 1500,
  socketTimeout: 1500,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

/**
 * Core Mail Service for G-CARS 2
 */
const mailService = {
  /**
   * Send Generic Email
   */
  async send(to, subject, html) {
    try {
      const info = await transporter.sendMail({
        from: `"G-CARS 2 Notification" <${process.env.MAIL_FROM || process.env.MAIL_USER}>`,
        to,
        subject,
        html,
      });
      console.log('📧 Email sent to:', to, 'ID:', info.messageId);
      return { success: true, messageId: info.messageId };
    } catch (err) {
      console.error('❌ Email failed to:', to, 'Error:', err.message);
      return { success: false, error: err.message };
    }
  },

  /**
   * Send Approval Request Notification (L1-L6)
   */
  async sendApprovalRequest(to, approverName, requesterName, requestNo, assetName, amount) {
    const subject = `Approval Required: G-CARS Request ${requestNo}`;
    const html = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background: #1e293b; padding: 24px; color: #fbbf24;">
          <h2 style="margin: 0; font-size: 20px;">G-CARS 2 · Action Required</h2>
        </div>
        <div style="padding: 24px; background: #fff; color: #334155;">
          <p>Dear <strong>${approverName}</strong>,</p>
          <p>A new acquisition request has been advanced to your queue and requires your review.</p>
          
          <div style="background: #f8fafc; padding: 16px; border-radius: 8px; margin: 20px 0; border: 1px solid #f1f5f9;">
            <table style="width: 100%; font-size: 14px;">
              <tr><td style="color: #64748b; width: 140px; padding-bottom: 8px;">Request No:</td><td style="font-weight: 700; color: #0f172a;">${requestNo}</td></tr>
              <tr><td style="color: #64748b; padding-bottom: 8px;">Requester:</td><td style="font-weight: 600;">${requesterName}</td></tr>
              <tr><td style="color: #64748b; padding-bottom: 8px;">Asset:</td><td style="font-weight: 600;">${assetName}</td></tr>
              <tr><td style="color: #64748b;">Value:</td><td style="font-weight: 700; color: #16a34a;">₹${Number(amount).toLocaleString('en-IN')}</td></tr>
            </table>
          </div>

          <p style="margin-bottom: 24px;">Please login to the G-CARS 2 portal to approve or reject this request.</p>
          
          <a href="http://localhost:5173/requests/${requestNo}" style="display: inline-block; background: #fbbf24; color: #000; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: 800; font-size: 14px;">REVIEW REQUEST</a>
        </div>
        <div style="background: #f1f5f9; padding: 16px; text-align: center; font-size: 12px; color: #64748b;">
          This is an automated system notification. Please do not reply to this email.
        </div>
      </div>
    `;
    return this.send(to, subject, html);
  },

  /**
   * Send Status Update to Requester
   */
  async sendStatusUpdate(to, requesterName, requestNo, status, comment) {
    const isApproved = status === 'Approved' || status === 'Final';
    const color = isApproved ? '#16a34a' : '#ef4444';
    const subject = `Update: G-CARS Request ${requestNo} has been ${status}`;
    
    const html = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background: ${color}; padding: 24px; color: #fff;">
          <h2 style="margin: 0; font-size: 20px;">G-CARS 2 · Request ${status}</h2>
        </div>
        <div style="padding: 24px; background: #fff; color: #334155;">
          <p>Dear <strong>${requesterName}</strong>,</p>
          <p>The status of your request <strong>${requestNo}</strong> has been updated to <span style="color: ${color}; font-weight: 800;">${status.toUpperCase()}</span>.</p>
          
          ${comment ? `
            <div style="background: #fef2f2; padding: 16px; border-radius: 8px; margin: 20px 0; border: 1px solid #fee2e2;">
              <div style="font-size: 11px; text-transform: uppercase; color: #991b1b; font-weight: 800; margin-bottom: 4px;">Comment/Reason:</div>
              <div style="font-size: 14px; font-style: italic; color: #b91c1c;">"${comment}"</div>
            </div>
          ` : ''}

          <p>You can view the full history of your request by clicking the button below.</p>
          
          <a href="http://localhost:5173/requests/${requestNo}" style="display: inline-block; background: ${color}; color: #fff; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: 800; font-size: 14px;">VIEW STATUS</a>
        </div>
        <div style="background: #f1f5f9; padding: 16px; text-align: center; font-size: 12px; color: #64748b;">
          Automated by GCARS Workflow Engine.
        </div>
      </div>
    `;
    return this.send(to, subject, html);
  }
};

module.exports = mailService;
