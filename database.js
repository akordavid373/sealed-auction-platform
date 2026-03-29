const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const DatabaseSecurityLayer = require('./utils/database-security');

class AuctionDatabase {
  constructor(dbPath = './auctions.db') {
    this.dbPath = path.resolve(__dirname, dbPath);
    this.db = new Database(this.dbPath);
    this.securityLayer = new DatabaseSecurityLayer(this.db);
    this.initializeSchema();
  }

  initializeSchema() {
    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');

    // Create users table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE,
        hashed_password TEXT NOT NULL,
        failed_login_attempts INTEGER DEFAULT 0,
        last_failed_login DATETIME,
        locked_until DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create password reset tokens table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        expires_at DATETIME NOT NULL,
        used INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Create auctions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auctions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        starting_bid REAL NOT NULL,
        current_highest_bid REAL DEFAULT 0,
        end_time DATETIME NOT NULL,
        creator_id TEXT NOT NULL,
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'closed', 'cancelled')),
        winner_id TEXT,
        winning_bid_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (creator_id) REFERENCES users(id),
        FOREIGN KEY (winner_id) REFERENCES users(id)
      )
    `);

    // Create bids table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bids (
        id TEXT PRIMARY KEY,
        auction_id TEXT NOT NULL,
        bidder_id TEXT NOT NULL,
        amount REAL NOT NULL,
        encrypted_bid TEXT NOT NULL,
        encrypted_iv TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        revealed INTEGER DEFAULT 0,
        FOREIGN KEY (auction_id) REFERENCES auctions(id) ON DELETE CASCADE,
        FOREIGN KEY (bidder_id) REFERENCES users(id)
      )
    `);

    // Create indexes for better performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_auctions_status ON auctions(status);
      CREATE INDEX IF NOT EXISTS idx_auctions_end_time ON auctions(end_time);
      CREATE INDEX IF NOT EXISTS idx_bids_auction_id ON bids(auction_id);
      CREATE INDEX IF NOT EXISTS idx_bids_bidder_id ON bids(bidder_id);
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
    `);
  }

  // User operations
  createUser(id, username, password, email = null) {
    // Validate inputs
    const validation = this.securityLayer.validateInputs({ id, username, password, email });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const hashedPassword = bcrypt.hashSync(password, 10);
    const stmt = this.securityLayer.prepare(`
      INSERT INTO users (id, username, email, hashed_password)
      VALUES (?, ?, ?, ?)
    `);
    return stmt.run(id, username, email, hashedPassword);
  }

  getUserByUsername(username) {
    const validation = this.securityLayer.validateInput(username);
    if (!validation.valid) {
      console.warn('[SECURITY] Invalid username format:', username);
      return null;
    }
    
    const stmt = this.securityLayer.prepare('SELECT * FROM users WHERE username = ?');
    return stmt.get(validation.sanitized);
  }

  getUserById(id) {
    const validation = this.securityLayer.validateInput(id);
    if (!validation.valid) {
      console.warn('[SECURITY] Invalid user ID format:', id);
      return null;
    }
    
    const stmt = this.securityLayer.prepare('SELECT * FROM users WHERE id = ?');
    return stmt.get(validation.sanitized);
  }

  // Account lockout methods
  incrementFailedLoginAttempts(username) {
    const validation = this.securityLayer.validateInput(username);
    if (!validation.valid) {
      console.warn('[SECURITY] Invalid username format:', username);
      return null;
    }

    const now = new Date().toISOString();
    const stmt = this.securityLayer.prepare(`
      UPDATE users 
      SET failed_login_attempts = failed_login_attempts + 1,
          last_failed_login = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE username = ?
    `);
    return stmt.run(now, validation.sanitized);
  }

  lockAccount(username, lockDurationMinutes = 30) {
    const validation = this.securityLayer.validateInput(username);
    if (!validation.valid) {
      console.warn('[SECURITY] Invalid username format:', username);
      return null;
    }

    const lockedUntil = new Date();
    lockedUntil.setMinutes(lockedUntil.getMinutes() + lockDurationMinutes);
    
    const stmt = this.securityLayer.prepare(`
      UPDATE users 
      SET locked_until = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE username = ?
    `);
    return stmt.run(lockedUntil.toISOString(), validation.sanitized);
  }

  resetFailedLoginAttempts(username) {
    const validation = this.securityLayer.validateInput(username);
    if (!validation.valid) {
      console.warn('[SECURITY] Invalid username format:', username);
      return null;
    }

    const stmt = this.securityLayer.prepare(`
      UPDATE users 
      SET failed_login_attempts = 0,
          locked_until = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE username = ?
    `);
    return stmt.run(validation.sanitized);
  }

  isAccountLocked(username) {
    const validation = this.securityLayer.validateInput(username);
    if (!validation.valid) {
      console.warn('[SECURITY] Invalid username format:', username);
      return false;
    }

    const stmt = this.securityLayer.prepare(`
      SELECT locked_until FROM users WHERE username = ?
    `);
    const result = stmt.get(validation.sanitized);
    
    if (!result || !result.locked_until) {
      return false;
    }

    const lockedUntil = new Date(result.locked_until);
    const now = new Date();
    
    // If lock has expired, reset it
    if (lockedUntil <= now) {
      this.resetFailedLoginAttempts(username);
      return false;
    }

    return true;
  }

  resetExpiredLockouts() {
    const now = new Date().toISOString();
    const stmt = this.securityLayer.prepare(`
      UPDATE users 
      SET failed_login_attempts = 0,
          locked_until = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE locked_until IS NOT NULL AND locked_until <= ?
    `);
    return stmt.run(now);
  }

  // Auction operations
  createAuction(auction) {
    // Validate auction data
    const validation = this.securityLayer.validateInputs({
      id: auction.id,
      title: auction.title,
      description: auction.description,
      startingBid: auction.startingBid,
      endTime: auction.endTime,
      creator: auction.creator
    });
    
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const stmt = this.securityLayer.prepare(`
      INSERT INTO auctions (id, title, description, starting_bid, current_highest_bid, end_time, creator_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      validation.sanitized.id,
      validation.sanitized.title,
      validation.sanitized.description || null,
      validation.sanitized.startingBid,
      validation.sanitized.startingBid,
      validation.sanitized.endTime,
      validation.sanitized.creator,
      auction.status
    );
  }

  getAuction(id) {
    const validation = this.securityLayer.validateInput(id);
    if (!validation.valid) {
      console.warn('[SECURITY] Invalid auction ID format:', id);
      return null;
    }
    
    const stmt = this.securityLayer.prepare('SELECT * FROM auctions WHERE id = ?');
    return stmt.get(validation.sanitized);
  }

  getAllAuctions() {
    const stmt = this.securityLayer.prepare('SELECT * FROM auctions ORDER BY created_at DESC');
    return stmt.all();
  }

  getActiveAuctions() {
    const stmt = this.securityLayer.prepare("SELECT * FROM auctions WHERE status = 'active' ORDER BY created_at DESC");
    return stmt.all();
  }

  getPaginatedAuctions(page = 1, limit = 10, status = null) {
    // Validate pagination parameters
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    
    if (isNaN(pageNum) || pageNum < 1) {
      throw new Error('Invalid page number');
    }
    
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      throw new Error('Limit must be between 1 and 100');
    }
    
    const offset = (pageNum - 1) * limitNum;
    let query = 'SELECT * FROM auctions';
    let countQuery = 'SELECT COUNT(*) as total FROM auctions';
    
    if (status) {
      const statusValidation = this.securityLayer.validateInput(status);
      if (!statusValidation.valid) {
        throw new Error('Invalid status value');
      }
      query += " WHERE status = ?";
      countQuery += " WHERE status = ?";
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    
    const countStmt = this.securityLayer.prepare(countQuery);
    const auctionsStmt = this.securityLayer.prepare(query);
    
    const totalResult = status 
      ? countStmt.get(status) 
      : countStmt.get();
    
    const auctions = status 
      ? auctionsStmt.all(status, limitNum, offset) 
      : auctionsStmt.all(limitNum, offset);
    
    return {
      auctions,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalResult.total,
        totalPages: Math.ceil(totalResult.total / limitNum),
        hasMore: offset + auctions.length < totalResult.total
      }
    };
  }

  updateAuction(id, updates) {
    // Validate ID
    const idValidation = this.securityLayer.validateInput(id);
    if (!idValidation.valid) {
      throw new Error('Invalid auction ID');
    }
    
    // Validate update fields
    const validatedUpdates = {};
    const allowedFields = ['title', 'description', 'starting_bid', 'current_highest_bid', 'end_time', 'status'];
    
    for (const [key, value] of Object.entries(updates)) {
      if (!allowedFields.includes(key)) {
        console.warn(`[SECURITY] Attempted to update disallowed field: ${key}`);
        continue;
      }
      
      const validation = this.securityLayer.validateInput(value);
      if (!validation.valid) {
        throw new Error(`Invalid value for field ${key}`);
      }
      validatedUpdates[key] = validation.sanitized;
    }
    
    if (Object.keys(validatedUpdates).length === 0) {
      throw new Error('No valid fields to update');
    }
    
    const fields = [];
    const values = [];
    
    Object.keys(validatedUpdates).forEach(key => {
      fields.push(`${key} = ?`);
      values.push(validatedUpdates[key]);
    });
    
    values.push(idValidation.sanitized);
    
    const stmt = this.securityLayer.prepare(`
      UPDATE auctions SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `);
    return stmt.run(...values);
  }

  closeAuction(id, winnerId, winningBidId) {
    // Validate all IDs
    const validations = this.securityLayer.validateInputs({
      id,
      winnerId: winnerId || null,
      winningBidId: winningBidId || null
    });
    
    if (!validations.valid) {
      throw new Error(validations.errors.join(', '));
    }
    
    const stmt = this.securityLayer.prepare(`
      UPDATE auctions 
      SET status = 'closed', winner_id = ?, winning_bid_id = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);
    return stmt.run(
      validations.sanitized.winnerId,
      validations.sanitized.winningBidId,
      validations.sanitized.id
    );
  }

  // Bid operations
  createBid(bid) {
    // Validate bid data
    const validation = this.securityLayer.validateInputs({
      id: bid.id,
      auctionId: bid.auctionId,
      bidderId: bid.bidderId,
      amount: bid.amount
    });
    
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const stmt = this.securityLayer.prepare(`
      INSERT INTO bids (id, auction_id, bidder_id, amount, encrypted_bid, encrypted_iv)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      validation.sanitized.id,
      validation.sanitized.auctionId,
      validation.sanitized.bidderId,
      validation.sanitized.amount,
      bid.encryptedBid.encrypted,
      bid.encryptedBid.iv
    );
  }

  getBidsForAuction(auctionId) {
    const validation = this.securityLayer.validateInput(auctionId);
    if (!validation.valid) {
      console.warn('[SECURITY] Invalid auction ID format:', auctionId);
      return [];
    }
    
    const stmt = this.securityLayer.prepare('SELECT * FROM bids WHERE auction_id = ? ORDER BY amount DESC');
    return stmt.all(validation.sanitized);
  }

  getBidCount(auctionId) {
    const validation = this.securityLayer.validateInput(auctionId);
    if (!validation.valid) {
      console.warn('[SECURITY] Invalid auction ID format:', auctionId);
      return 0;
    }
    
    const stmt = this.securityLayer.prepare('SELECT COUNT(*) as count FROM bids WHERE auction_id = ?');
    const result = stmt.get(validation.sanitized);
    return result.count;
  }

  getHighestBid(auctionId) {
    const validation = this.securityLayer.validateInput(auctionId);
    if (!validation.valid) {
      console.warn('[SECURITY] Invalid auction ID format:', auctionId);
      return null;
    }
    
    const stmt = this.securityLayer.prepare('SELECT MAX(amount) as highest FROM bids WHERE auction_id = ?');
    const result = stmt.get(validation.sanitized);
    return result.highest;
  }

  // Password reset operations
  getUserByEmail(email) {
    const validation = this.securityLayer.validateInput(email);
    if (!validation.valid) {
      console.warn('[SECURITY] Invalid email format:', email);
      return null;
    }
    
    const stmt = this.securityLayer.prepare('SELECT * FROM users WHERE email = ?');
    return stmt.get(validation.sanitized);
  }

  createPasswordResetToken(userId, token, expiresAt) {
    const validation = this.securityLayer.validateInputs({ userId, token, expiresAt });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    // Invalidate any existing tokens for this user
    this.invalidateUserResetTokens(userId);
    
    const stmt = this.securityLayer.prepare(`
      INSERT INTO password_reset_tokens (id, user_id, token, expires_at)
      VALUES (?, ?, ?, ?)
    `);
    return stmt.run(crypto.randomUUID(), validation.sanitized.userId, validation.sanitized.token, validation.sanitized.expiresAt);
  }

  getValidResetToken(token) {
    const validation = this.securityLayer.validateInput(token);
    if (!validation.valid) {
      console.warn('[SECURITY] Invalid token format:', token);
      return null;
    }
    
    const stmt = this.securityLayer.prepare(`
      SELECT * FROM password_reset_tokens 
      WHERE token = ? AND used = 0 AND expires_at > datetime('now')
    `);
    return stmt.get(validation.sanitized);
  }

  invalidateResetToken(token) {
    const validation = this.securityLayer.validateInput(token);
    if (!validation.valid) {
      console.warn('[SECURITY] Invalid token format:', token);
      return false;
    }
    
    const stmt = this.securityLayer.prepare(`
      UPDATE password_reset_tokens SET used = 1 WHERE token = ?
    `);
    const result = stmt.run(validation.sanitized);
    return result.changes > 0;
  }

  invalidateUserResetTokens(userId) {
    const validation = this.securityLayer.validateInput(userId);
    if (!validation.valid) {
      console.warn('[SECURITY] Invalid user ID format:', userId);
      return false;
    }
    
    const stmt = this.securityLayer.prepare(`
      UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0
    `);
    const result = stmt.run(validation.sanitized);
    return result.changes > 0;
  }

  updateUserPassword(userId, newPassword) {
    const validation = this.securityLayer.validateInputs({ userId, newPassword });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    const stmt = this.securityLayer.prepare(`
      UPDATE users SET hashed_password = ?, updated_at = datetime('now') WHERE id = ?
    `);
    return stmt.run(hashedPassword, validation.sanitized.userId);
  }

  // Cleanup expired tokens
  cleanupExpiredTokens() {
    const stmt = this.securityLayer.prepare(`
      DELETE FROM password_reset_tokens WHERE expires_at <= datetime('now')
    `);
    return stmt.run();
  }

  // Utility methods
  close() {
    this.db.close();
  }

  // Security monitoring
  getSecurityStats() {
    return this.securityLayer.getSecurityStats();
  }

  getQueryLog(limit = 100) {
    return this.securityLayer.getQueryLog(limit);
  }

  clearQueryLog() {
    this.securityLayer.clearQueryLog();
  }

  // Export for in-memory compatibility (temporary)
  toMap() {
    const auctions = new Map();
    const bids = new Map();
    const users = new Map();

    this.getAllAuctions().forEach(auction => {
      auctions.set(auction.id, auction);
    });

    this.db.prepare('SELECT * FROM bids').all().forEach(bid => {
      bids.set(bid.id, bid);
    });

    this.db.prepare('SELECT * FROM users').all().forEach(user => {
      users.set(user.id, user);
    });

    return { auctions, bids, users };
  }
}

module.exports = AuctionDatabase;
