# Wallet Management System - Implementation Guide

## Overview

This implementation provides a comprehensive **Multi-Wallet Management System** for the Stellar Sealed-Bid Auction platform. It enables users to manage multiple Stellar wallets with advanced features including wallet switching, transaction history, security settings, and backup/recovery functionality.

## Features Implemented

### ✅ Multi-Wallet Support
- Users can create and manage multiple Stellar wallets
- Each wallet has its own identity, balance, and security settings
- Seamless switching between wallets
- Wallet names for easy identification

### ✅ Wallet Switching
- Users can switch between active wallets
- Only one wallet can be active at a time
- Smooth UI transitions when switching wallets
- All subsequent transactions use the active wallet

### ✅ Security Settings
- Two-Factor Authentication (2FA) toggle per wallet
- Security PIN configuration
- Encrypted private key storage using AES-256
- Secure authentication token management

### ✅ Backup & Recovery
- Backup recovery phrase generation and storage
- Last backup timestamp tracking
- Recovery hash verification
- Secure recovery options interface

### ✅ Transaction History
- Complete transaction history per wallet
- Aggregated transaction history across all user wallets
- Transaction type categorization (send, receive, bid, etc.)
- Transaction status tracking (pending, completed, failed)
- Pagination support for large transaction lists

### ✅ Balance Aggregation
- Real-time balance retrieval per wallet
- Aggregated total balance across all wallets
- Currency display (XLM)
- Balance updates on wallet operations

### ✅ Mobile Wallet Support
- Responsive design for mobile devices
- Touch-friendly interface
- Mobile-optimized forms and buttons
- Full functionality on mobile browsers

## Architecture

### Database Schema

#### wallets table
```sql
CREATE TABLE wallets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  public_key TEXT NOT NULL UNIQUE,
  private_key_encrypted TEXT NOT NULL,
  network TEXT DEFAULT 'testnet',
  balance REAL DEFAULT 0,
  is_active INTEGER DEFAULT 0,
  backup_phrase_encrypted TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

#### wallet_transactions table
```sql
CREATE TABLE wallet_transactions (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  transaction_type TEXT NOT NULL,
  amount REAL NOT NULL,
  from_address TEXT,
  to_address TEXT,
  hash TEXT,
  status TEXT DEFAULT 'pending',
  description TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

#### wallet_security table
```sql
CREATE TABLE wallet_security (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL UNIQUE,
  two_factor_enabled INTEGER DEFAULT 0,
  backup_recovery_hash TEXT,
  last_backup DATETIME,
  security_pin_hash TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE
);
```

## API Endpoints

### Wallet Management

#### Get All Wallets
```
GET /api/wallets
Headers: Authorization: Bearer <token>
Response:
{
  "success": true,
  "wallets": [
    {
      "id": "wallet-uuid",
      "name": "Personal Wallet",
      "public_key": "G...",
      "network": "testnet",
      "balance": 1000.50,
      "is_active": 1,
      "created_at": "2024-01-01T12:00:00Z"
    }
  ],
  "count": 1,
  "_links": { ... }
}
```

#### Get Aggregated Balance
```
GET /api/wallets/balance
Headers: Authorization: Bearer <token>
Response:
{
  "success": true,
  "totalBalance": 1500.75,
  "currency": "XLM",
  "_links": { ... }
}
```

#### Create New Wallet
```
POST /api/wallets
Headers: Authorization: Bearer <token>
Body: {
  "walletName": "My New Wallet",
  "network": "testnet"
}
Response:
{
  "success": true,
  "walletId": "wallet-uuid",
  "publicKey": "G...",
  "message": "Wallet created successfully",
  "_links": { ... }
}
```

#### Get Wallet Details
```
GET /api/wallets/:walletId
Headers: Authorization: Bearer <token>
Response:
{
  "success": true,
  "wallet": { ... },
  "_links": { ... }
}
```

#### Switch Active Wallet
```
POST /api/wallets/switch
Headers: Authorization: Bearer <token>
Body: {
  "walletId": "wallet-uuid"
}
Response:
{
  "success": true,
  "message": "Wallet switched successfully",
  "_links": { ... }
}
```

#### Delete Wallet
```
DELETE /api/wallets/:walletId
Headers: Authorization: Bearer <token>
Response:
{
  "success": true,
  "message": "Wallet deleted successfully",
  "_links": { ... }
}
```

### Transaction History

#### Get Wallet Transactions
```
GET /api/wallets/:walletId/transactions?limit=50&offset=0
Headers: Authorization: Bearer <token>
Response:
{
  "success": true,
  "transactions": [
    {
      "id": "tx-uuid",
      "transaction_type": "send",
      "amount": 100.50,
      "from_address": "G...",
      "to_address": "G...",
      "hash": "tx-hash",
      "status": "completed",
      "description": "Payment to user",
      "timestamp": "2024-01-01T12:00:00Z"
    }
  ],
  "count": 1,
  "_links": { ... }
}
```

#### Get User Transaction History (All Wallets)
```
GET /api/wallets/transactions/history?limit=100&offset=0
Headers: Authorization: Bearer <token>
Response:
{
  "success": true,
  "transactions": [
    {
      "id": "tx-uuid",
      "transaction_type": "receive",
      "amount": 50.00,
      "from_address": "G...",
      "to_address": "G...",
      "hash": "tx-hash",
      "status": "completed",
      "description": "Bid received",
      "timestamp": "2024-01-01T12:00:00Z",
      "wallet_name": "Personal Wallet"
    }
  ],
  "count": 1,
  "_links": { ... }
}
```

### Security Settings

#### Get Wallet Security Settings
```
GET /api/wallets/:walletId/security
Headers: Authorization: Bearer <token>
Response:
{
  "success": true,
  "security": {
    "id": "security-uuid",
    "wallet_id": "wallet-uuid",
    "two_factor_enabled": 0,
    "backup_recovery_hash": "hash...",
    "last_backup": "2024-01-01T12:00:00Z",
    "security_pin_hash": "hash..."
  },
  "_links": { ... }
}
```

#### Enable 2FA
```
POST /api/wallets/:walletId/security/2fa/enable
Headers: Authorization: Bearer <token>
Response:
{
  "success": true,
  "message": "2FA enabled",
  "_links": { ... }
}
```

#### Disable 2FA
```
POST /api/wallets/:walletId/security/2fa/disable
Headers: Authorization: Bearer <token>
Response:
{
  "success": true,
  "message": "2FA disabled",
  "_links": { ... }
}
```

### Backup & Recovery

#### Get Backup Options
```
GET /api/wallets/:walletId/backup
Headers: Authorization: Bearer <token>
Response:
{
  "success": true,
  "backup": {
    "lastBackup": "2024-01-01T12:00:00Z",
    "recoveryHashExists": true,
    "message": "Backup and recovery options available"
  },
  "_links": { ... }
}
```

#### Create Backup Recovery Hash
```
POST /api/wallets/:walletId/backup/create
Headers: Authorization: Bearer <token>
Body: {
  "recoveryPhrase": "word1 word2 word3 ... word12"
}
Response:
{
  "success": true,
  "message": "Backup recovery hash set",
  "_links": { ... }
}
```

## Frontend Integration

### HTML Integration
Add the following to your `index.html`:
```html
<script src="/wallet-management-ui.js"></script>
```

### JavaScript Usage
```javascript
// The WalletManagementUI is automatically initialized
// Access it via: window.walletUI

// Examples:
window.walletUI.loadWallets();
window.walletUI.switchWallet('wallet-uuid');
window.walletUI.deleteWallet('wallet-uuid');
window.walletUI.createNewWallet();
```

## Security Considerations

### Private Key Encryption
- Private keys are encrypted using AES-256-CBC
- Encryption keys are stored in environment variables
- Never expose unencrypted private keys to the client

### Authentication
- All wallet endpoints require JWT authentication
- Tokens are validated before returning wallet data
- User ID from token is verified against wallet ownership

### Data Protection
- All sensitive data is encrypted at rest
- Recovery phrases are hashed before storage
- Passwords follow bcrypt hashing standards

### HTTPS Requirement
- Always use HTTPS in production
- Set secure cookies (production only)
- Implement CORS restrictions

## Environment Variables

```bash
# Encryption key for wallet private keys
ENCRYPTION_KEY=your-256-bit-hex-key

# Database path
DATABASE_PATH=./auctions.db

# JWT secret for tokens
JWT_SECRET=your-jwt-secret

# Node environment
NODE_ENV=production
```

## Testing the Implementation

### Create a Wallet
```bash
curl -X POST http://localhost:3001/api/wallets \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "walletName": "Test Wallet",
    "network": "testnet"
  }'
```

### Get All Wallets
```bash
curl -X GET http://localhost:3001/api/wallets \
  -H "Authorization: Bearer <token>"
```

### Get Aggregated Balance
```bash
curl -X GET http://localhost:3001/api/wallets/balance \
  -H "Authorization: Bearer <token>"
```

### Switch Wallet
```bash
curl -X POST http://localhost:3001/api/wallets/switch \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "walletId": "wallet-uuid"
  }'
```

### Get Transaction History
```bash
curl -X GET http://localhost:3001/api/wallets/transactions/history \
  -H "Authorization: Bearer <token>"
```

## Files Modified/Created

### New Files Created:
1. `/utils/wallet-manager.js` - Core wallet management module
2. `/public/wallet-management-ui.js` - Frontend UI component

### Files Modified:
1. `/server.js` - Added wallet API endpoints and wallet manager initialization

### Database Changes:
- Added `wallets` table
- Added `wallet_transactions` table
- Added `wallet_security` table
- Created indexes for performance

## Compliance with Issue Requirements

### ✅ Multi-wallet support
Implemented: Users can create and manage multiple Stellar wallets

### ✅ Wallet switching
Implemented: Users can seamlessly switch between active wallets

### ✅ Security settings
Implemented: 2FA toggle, PIN configuration, encrypted private key storage

### ✅ Backup/recovery
Implemented: Recovery phrase generation, backup hash verification

### ✅ Transaction history
Implemented: Per-wallet and aggregated transaction history with pagination

### ✅ Balance aggregation
Implemented: Real-time balance per wallet and aggregated total

### ✅ Mobile wallet support
Implemented: Fully responsive UI with mobile-optimized interface

## Future Enhancements

1. **Hardware Wallet Integration** - Support for Ledger/Trezor wallets
2. **Advanced 2FA** - TOTP and SMS options
3. **Multi-signature Wallets** - Shared wallet management
4. **Transaction Signing** - Advanced transaction approval workflows
5. **Analytics Dashboard** - Portfolio insights and statistics
6. **WebAuthn Support** - Biometric authentication
7. **Wallet Import** - Import wallets from other sources
8. **Custom RPC Endpoints** - User-defined Stellar endpoints

## Support & Troubleshooting

### Issue: Wallets not appearing
- Check database connectivity
- Verify user ID is correct
- Ensure JWT token is valid

### Issue: Private key encryption fails
- Verify ENCRYPTION_KEY environment variable is set
- Ensure key is proper 256-bit format

### Issue: Transaction history not updating
- Check wallet transaction creation logic
- Verify user has permission to view transactions

## References

- [Stellar SDK Documentation](https://developers.stellar.org/docs)
- [Soroban Documentation](https://developers.stellar.org/docs/smart-contracts)
- [JWT Best Practices](https://tools.ietf.org/html/rfc7519)
- [AES Encryption Standards](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.197.pdf)
