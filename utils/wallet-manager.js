// Wallet Management System
// Handles multi-wallet support, transaction history, and security

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

class WalletManager {
  constructor(db) {
    this.db = db;
    this.initializeTables();
  }

  // Initialize wallet-related database tables
  initializeTables() {
    try {
      const db = this.db.getDatabase();

      // Wallets table - stores multiple wallets per user
      db.exec(`
        CREATE TABLE IF NOT EXISTS wallets (
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
      `);

      // Wallet transactions table - tracks all transactions
      db.exec(`
        CREATE TABLE IF NOT EXISTS wallet_transactions (
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
      `);

      // Wallet security settings table
      db.exec(`
        CREATE TABLE IF NOT EXISTS wallet_security (
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
      `);

      // Create indexes for better query performance
      db.exec(`CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_wallet_id ON wallet_transactions(wallet_id);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON wallet_transactions(user_id);`);
    } catch (error) {
      console.error('Failed to initialize wallet tables:', error);
    }
  }

  // Create a new wallet for a user
  createWallet(userId, walletName, publicKey, encryptedPrivateKey, backupPhrase = null) {
    try {
      const db = this.db.getDatabase();
      const walletId = uuidv4();

      const stmt = db.prepare(`
        INSERT INTO wallets (id, user_id, name, public_key, private_key_encrypted, backup_phrase_encrypted)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      const encryptedBackupPhrase = backupPhrase ? this.encryptData(backupPhrase) : null;

      stmt.run(walletId, userId, walletName, publicKey, encryptedPrivateKey, encryptedBackupPhrase);

      // Create security settings for this wallet
      this.initializeWalletSecurity(walletId);

      return {
        success: true,
        walletId,
        message: 'Wallet created successfully'
      };
    } catch (error) {
      console.error('Failed to create wallet:', error);
      return { success: false, error: error.message };
    }
  }

  // Get all wallets for a user
  getUserWallets(userId) {
    try {
      const db = this.db.getDatabase();
      const stmt = db.prepare(`
        SELECT id, name, public_key, network, balance, is_active, created_at
        FROM wallets
        WHERE user_id = ?
        ORDER BY is_active DESC, created_at DESC
      `);

      const wallets = stmt.all(userId);
      return { success: true, wallets };
    } catch (error) {
      console.error('Failed to get user wallets:', error);
      return { success: false, error: error.message };
    }
  }

  // Get active wallet for a user
  getActiveWallet(userId) {
    try {
      const db = this.db.getDatabase();
      const stmt = db.prepare(`
        SELECT id, name, public_key, network, balance, is_active
        FROM wallets
        WHERE user_id = ? AND is_active = 1
        LIMIT 1
      `);

      const wallet = stmt.get(userId);
      return { success: true, wallet };
    } catch (error) {
      console.error('Failed to get active wallet:', error);
      return { success: false, error: error.message };
    }
  }

  // Switch active wallet
  switchActiveWallet(userId, walletId) {
    try {
      const db = this.db.getDatabase();

      // Deactivate all wallets for this user
      db.prepare('UPDATE wallets SET is_active = 0 WHERE user_id = ?').run(userId);

      // Activate the selected wallet
      const result = db.prepare('UPDATE wallets SET is_active = 1 WHERE id = ? AND user_id = ?').run(walletId, userId);

      if (result.changes === 0) {
        return { success: false, error: 'Wallet not found' };
      }

      return { success: true, message: 'Wallet switched successfully' };
    } catch (error) {
      console.error('Failed to switch wallet:', error);
      return { success: false, error: error.message };
    }
  }

  // Update wallet balance
  updateWalletBalance(walletId, newBalance) {
    try {
      const db = this.db.getDatabase();
      db.prepare('UPDATE wallets SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newBalance, walletId);
      return { success: true };
    } catch (error) {
      console.error('Failed to update wallet balance:', error);
      return { success: false, error: error.message };
    }
  }

  // Get wallet balance
  getWalletBalance(walletId) {
    try {
      const db = this.db.getDatabase();
      const stmt = db.prepare('SELECT balance FROM wallets WHERE id = ?');
      const result = stmt.get(walletId);
      return { success: true, balance: result ? result.balance : 0 };
    } catch (error) {
      console.error('Failed to get wallet balance:', error);
      return { success: false, error: error.message };
    }
  }

  // Get aggregated balance for all user wallets
  getAggregatedBalance(userId) {
    try {
      const db = this.db.getDatabase();
      const stmt = db.prepare('SELECT SUM(balance) as total_balance FROM wallets WHERE user_id = ?');
      const result = stmt.get(userId);
      return {
        success: true,
        totalBalance: result?.total_balance || 0
      };
    } catch (error) {
      console.error('Failed to get aggregated balance:', error);
      return { success: false, error: error.message };
    }
  }

  // Add transaction to history
  addTransaction(walletId, userId, transactionType, amount, fromAddress, toAddress, hash, description = '') {
    try {
      const db = this.db.getDatabase();
      const transactionId = uuidv4();

      const stmt = db.prepare(`
        INSERT INTO wallet_transactions 
        (id, wallet_id, user_id, transaction_type, amount, from_address, to_address, hash, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(transactionId, walletId, userId, transactionType, amount, fromAddress, toAddress, hash, description);

      return { success: true, transactionId };
    } catch (error) {
      console.error('Failed to add transaction:', error);
      return { success: false, error: error.message };
    }
  }

  // Get transaction history for a wallet
  getWalletTransactionHistory(walletId, limit = 50, offset = 0) {
    try {
      const db = this.db.getDatabase();
      const stmt = db.prepare(`
        SELECT id, transaction_type, amount, from_address, to_address, hash, status, description, timestamp
        FROM wallet_transactions
        WHERE wallet_id = ?
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `);

      const transactions = stmt.all(walletId, limit, offset);
      return { success: true, transactions };
    } catch (error) {
      console.error('Failed to get transaction history:', error);
      return { success: false, error: error.message };
    }
  }

  // Get transaction history for a user (all wallets)
  getUserTransactionHistory(userId, limit = 100, offset = 0) {
    try {
      const db = this.db.getDatabase();
      const stmt = db.prepare(`
        SELECT wt.id, wt.transaction_type, wt.amount, wt.from_address, wt.to_address, wt.hash, wt.status, wt.description, wt.timestamp, w.name as wallet_name
        FROM wallet_transactions wt
        JOIN wallets w ON wt.wallet_id = w.id
        WHERE wt.user_id = ?
        ORDER BY wt.timestamp DESC
        LIMIT ? OFFSET ?
      `);

      const transactions = stmt.all(userId, limit, offset);
      return { success: true, transactions };
    } catch (error) {
      console.error('Failed to get user transaction history:', error);
      return { success: false, error: error.message };
    }
  }

  // Initialize wallet security settings
  initializeWalletSecurity(walletId) {
    try {
      const db = this.db.getDatabase();
      const securityId = uuidv4();

      db.prepare(`
        INSERT INTO wallet_security (id, wallet_id)
        VALUES (?, ?)
      `).run(securityId, walletId);

      return { success: true };
    } catch (error) {
      console.error('Failed to initialize wallet security:', error);
      return { success: false, error: error.message };
    }
  }

  // Enable 2FA for wallet
  enable2FA(walletId) {
    try {
      const db = this.db.getDatabase();
      db.prepare('UPDATE wallet_security SET two_factor_enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE wallet_id = ?').run(walletId);
      return { success: true, message: '2FA enabled' };
    } catch (error) {
      console.error('Failed to enable 2FA:', error);
      return { success: false, error: error.message };
    }
  }

  // Disable 2FA for wallet
  disable2FA(walletId) {
    try {
      const db = this.db.getDatabase();
      db.prepare('UPDATE wallet_security SET two_factor_enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE wallet_id = ?').run(walletId);
      return { success: true, message: '2FA disabled' };
    } catch (error) {
      console.error('Failed to disable 2FA:', error);
      return { success: false, error: error.message };
    }
  }

  // Set backup recovery hash
  setBackupRecoveryHash(walletId, recoveryHash) {
    try {
      const db = this.db.getDatabase();
      db.prepare(`
        UPDATE wallet_security 
        SET backup_recovery_hash = ?, last_backup = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
        WHERE wallet_id = ?
      `).run(recoveryHash, walletId);
      return { success: true, message: 'Backup recovery hash set' };
    } catch (error) {
      console.error('Failed to set backup recovery hash:', error);
      return { success: false, error: error.message };
    }
  }

  // Get wallet security settings
  getWalletSecurity(walletId) {
    try {
      const db = this.db.getDatabase();
      const stmt = db.prepare('SELECT * FROM wallet_security WHERE wallet_id = ?');
      const security = stmt.get(walletId);
      return { success: true, security };
    } catch (error) {
      console.error('Failed to get wallet security:', error);
      return { success: false, error: error.message };
    }
  }

  // Delete wallet
  deleteWallet(walletId, userId) {
    try {
      const db = this.db.getDatabase();
      const result = db.prepare('DELETE FROM wallets WHERE id = ? AND user_id = ?').run(walletId, userId);

      if (result.changes === 0) {
        return { success: false, error: 'Wallet not found' };
      }

      return { success: true, message: 'Wallet deleted successfully' };
    } catch (error) {
      console.error('Failed to delete wallet:', error);
      return { success: false, error: error.message };
    }
  }

  // Encrypt data using AES-256
  encryptData(data) {
    const encryptionKey = process.env.ENCRYPTION_KEY || crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(encryptionKey), iv);

    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return `${iv.toString('hex')}:${encrypted}`;
  }

  // Decrypt data using AES-256
  decryptData(encryptedData) {
    const encryptionKey = process.env.ENCRYPTION_KEY || crypto.randomBytes(32);
    const [iv, encrypted] = encryptedData.split(':');

    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(encryptionKey), Buffer.from(iv, 'hex'));

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}

module.exports = WalletManager;
