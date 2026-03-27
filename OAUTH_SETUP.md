# OAuth Integration Setup Guide

This guide explains how to configure OAuth providers (Google and GitHub) for social login functionality in the Sealed Auction Platform.

## Overview

The platform now supports social authentication using:
- **Google OAuth 2.0** - Users can sign in with their Google account
- **GitHub OAuth** - Users can sign in with their GitHub account

## Prerequisites

1. Node.js and npm installed
2. OAuth applications created on Google and GitHub
3. Environment variables configured

## Step 1: Google OAuth Setup

### 1.1 Create Google OAuth Application

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Navigate to **APIs & Services** > **Credentials**
4. Click **Create Credentials** > **OAuth client ID**
5. Configure:
   - **Application type**: Web application
   - **Name**: Sealed Auction Platform
   - **Authorized JavaScript origins**: `http://localhost:3000`
   - **Authorized redirect URIs**: `http://localhost:3000/auth/google/callback`
6. Copy the **Client ID** and **Client Secret**

### 1.2 Enable Required APIs

Enable the following APIs in your Google Cloud project:
- Google+ API (if available)
- People API

## Step 2: GitHub OAuth Setup

### 2.1 Create GitHub OAuth Application

1. Go to GitHub Settings > **Developer settings** > **OAuth Apps**
2. Click **New OAuth App**
3. Configure:
   - **Application name**: Sealed Auction Platform
   - **Homepage URL**: `http://localhost:3000`
   - **Authorization callback URL**: `http://localhost:3000/auth/github/callback`
4. Click **Register application**
5. Copy the **Client ID** and **Client Secret**

## Step 3: Environment Configuration

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Update `.env` with your OAuth credentials:
   ```env
   # OAuth Configuration
   GOOGLE_CLIENT_ID=your_google_client_id_here
   GOOGLE_CLIENT_SECRET=your_google_client_secret_here
   GITHUB_CLIENT_ID=your_github_client_id_here
   GITHUB_CLIENT_SECRET=your_github_client_secret_here
   
   # JWT Configuration
   JWT_SECRET=your_jwt_secret_here
   SESSION_SECRET=your_session_secret_here
   ```

## Step 4: Install Dependencies

```bash
npm install
```

## Step 5: Run the Application

```bash
npm start
```

## How It Works

### Authentication Flow

1. **User clicks social login button** → Redirected to OAuth provider
2. **User authenticates with provider** → Provider redirects back with authorization code
3. **Server exchanges code for tokens** → Retrieves user profile
4. **Server creates/updates user account** → Generates JWT token
5. **User redirected to app with token** → Client stores token and updates UI

### Security Features

- **JWT tokens** for secure authentication
- **Session management** with express-session
- **Token blacklisting** for secure logout
- **Environment variables** for sensitive data
- **HTTPS redirect** in production

### User Account Creation

When users authenticate via OAuth:
- A new user account is automatically created if it doesn't exist
- User profile data (name, email) is retrieved from the provider
- The user can immediately start using the platform

## Testing the Integration

1. Start the application: `npm start`
2. Open `http://localhost:3000` in your browser
3. Click the login button to open the auth modal
4. You should see Google and/or GitHub login buttons (if configured)
5. Click a social login button to test the OAuth flow

## Troubleshooting

### Common Issues

1. **Redirect URI mismatch**
   - Ensure redirect URIs in OAuth console match exactly
   - Check for trailing slashes and protocol (http vs https)

2. **Environment variables not loading**
   - Verify `.env` file exists in project root
   - Ensure no spaces around equals signs
   - Restart server after changing environment variables

3. **CORS issues**
   - Check that authorized JavaScript origins are set correctly
   - Ensure the application is running on the correct port

4. **Social buttons not showing**
   - Check browser console for errors
   - Verify `/api/auth/status` endpoint returns correct configuration
   - Ensure OAuth credentials are properly set in environment

### Debug Mode

Enable debug logging by setting:
```env
NODE_ENV=development
DEBUG=passport:*
```

## Production Deployment

For production deployment:

1. **Use HTTPS** - OAuth providers require HTTPS in production
2. **Update redirect URIs** - Change from localhost to your domain
3. **Secure environment variables** - Use proper secret management
4. **Update session configuration** - Set `secure: true` for cookies
5. **Domain verification** - Verify your domain with OAuth providers

## Security Considerations

- Store OAuth credentials securely using environment variables
- Use strong JWT secrets and rotate them regularly
- Implement proper session timeout and cleanup
- Monitor for suspicious authentication attempts
- Keep OAuth libraries updated to latest versions

## API Endpoints

### OAuth Routes
- `GET /auth/google` - Initiate Google OAuth flow
- `GET /auth/google/callback` - Google OAuth callback
- `GET /auth/github` - Initiate GitHub OAuth flow
- `GET /auth/github/callback` - GitHub OAuth callback
- `GET /api/auth/status` - Check OAuth provider availability

### Authentication Routes
- `POST /api/users/login` - Traditional login
- `POST /api/users/register` - Traditional registration
- `POST /api/users/logout` - Logout (token blacklisting)
- `GET /api/users/verify` - Verify JWT token

## Support

For issues with OAuth integration:
1. Check the troubleshooting section above
2. Review server logs for error messages
3. Verify OAuth provider console settings
4. Ensure all dependencies are properly installed
