const nodemailer = require('nodemailer');
const crypto = require('crypto');

class EmailService {
  constructor() {
    this.transporter = null;
    this.initializeTransporter();
  }

  initializeTransporter() {
    // For development, use ethereal email (testing)
    if (process.env.NODE_ENV !== 'production') {
      // Create a test account for development
      this.setupTestAccount();
    } else {
      // Production configuration - use environment variables
      this.setupProductionTransporter();
    }
  }

  async setupTestAccount() {
    try {
      const testAccount = await nodemailer.createTestAccount();
      this.transporter = nodemailer.createTransporter({
        host: testAccount.smtp.host,
        port: testAccount.smtp.port,
        secure: testAccount.smtp.secure,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass
        }
      });
      console.log('Email service initialized with test account');
    } catch (error) {
      console.error('Failed to setup test email account:', error);
      // Fallback to a simple console logger for development
      this.transporter = {
        sendMail: async (options) => {
          console.log('--- EMAIL ---');
          console.log('To:', options.to);
          console.log('Subject:', options.subject);
          console.log('Body:', options.text || options.html);
          console.log('--- END EMAIL ---');
          return { messageId: 'dev-' + Date.now() };
        }
      };
    }
  }

  setupProductionTransporter() {
    this.transporter = nodemailer.createTransporter({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  async sendPasswordResetEmail(email, resetToken, username) {
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || '"Sealed Auction Platform" <noreply@sealedauction.com>',
      to: email,
      subject: 'Password Reset Request - Sealed Auction Platform',
      text: `
Hello ${username || 'User'},

You requested a password reset for your account on the Sealed Auction Platform.

Click the following link to reset your password:
${resetUrl}

This link will expire in 1 hour for security reasons.

If you didn't request this password reset, you can safely ignore this email.

Best regards,
The Sealed Auction Platform Team
      `,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Password Reset - Sealed Auction Platform</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #2563eb; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; background: #f9fafb; }
    .button { display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
    .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Password Reset Request</h1>
    </div>
    <div class="content">
      <p>Hello ${username || 'User'},</p>
      <p>You requested a password reset for your account on the Sealed Auction Platform.</p>
      <p>Click the button below to reset your password:</p>
      <div style="text-align: center;">
        <a href="${resetUrl}" class="button">Reset Password</a>
      </div>
      <p>Or copy and paste this link into your browser:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p><strong>This link will expire in 1 hour for security reasons.</strong></p>
      <p>If you didn't request this password reset, you can safely ignore this email.</p>
    </div>
    <div class="footer">
      <p>Best regards,<br>The Sealed Auction Platform Team</p>
    </div>
  </div>
</body>
</html>
      `
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log('Password reset email sent:', info.messageId);
      return info;
    } catch (error) {
      console.error('Failed to send password reset email:', error);
      throw error;
    }
  }

  async sendPasswordResetConfirmationEmail(email, username) {
    const mailOptions = {
      from: process.env.EMAIL_FROM || '"Sealed Auction Platform" <noreply@sealedauction.com>',
      to: email,
      subject: 'Password Successfully Reset - Sealed Auction Platform',
      text: `
Hello ${username || 'User'},

Your password has been successfully reset for your account on the Sealed Auction Platform.

If you didn't make this change, please contact our support team immediately.

Best regards,
The Sealed Auction Platform Team
      `,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Password Reset Confirmation - Sealed Auction Platform</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #10b981; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; background: #f9fafb; }
    .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Password Reset Successful</h1>
    </div>
    <div class="content">
      <p>Hello ${username || 'User'},</p>
      <p>Your password has been successfully reset for your account on the Sealed Auction Platform.</p>
      <p><strong>If you didn't make this change, please contact our support team immediately.</strong></p>
    </div>
    <div class="footer">
      <p>Best regards,<br>The Sealed Auction Platform Team</p>
    </div>
  </div>
</body>
</html>
      `
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log('Password reset confirmation email sent:', info.messageId);
      return info;
    } catch (error) {
      console.error('Failed to send password reset confirmation email:', error);
      throw error;
    }
  }

  generateSecureToken() {
    return crypto.randomBytes(32).toString('hex');
  }
}

module.exports = EmailService;
