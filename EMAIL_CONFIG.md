# Email Service Configuration
# Add these to your .env file for production email functionality

# SMTP Configuration (for production)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Email Settings
EMAIL_FROM="Sealed Auction Platform" <noreply@sealedauction.com>

# Frontend URL (for password reset links)
FRONTEND_URL=http://localhost:3000

# Development Settings
NODE_ENV=development

# Note: For Gmail, you'll need to:
# 1. Enable 2-factor authentication
# 2. Generate an app-specific password
# 3. Use the app password as SMTP_PASS
