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
        role TEXT DEFAULT 'user' CHECK(role IN ('user', 'admin', 'moderator')),
        failed_login_attempts INTEGER DEFAULT 0,
        last_failed_login DATETIME,
        locked_until DATETIME,
        is_active INTEGER DEFAULT 1,
        email_verified INTEGER DEFAULT 0,
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

    // Create refresh tokens table for token rotation
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        device_info TEXT,
        ip_address TEXT,
        user_agent TEXT,
        is_revoked INTEGER DEFAULT 0,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Create user sessions table for multi-device support
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        refresh_token_id TEXT NOT NULL,
        device_fingerprint TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (refresh_token_id) REFERENCES refresh_tokens(id) ON DELETE CASCADE
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

    // Create auction views tracking table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auction_views (
        id TEXT PRIMARY KEY,
        auction_id TEXT NOT NULL,
        user_id TEXT,
        ip_address TEXT,
        user_agent TEXT,
        viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (auction_id) REFERENCES auctions(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    // Create admin-related tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS system_logs (
        id TEXT PRIMARY KEY,
        level TEXT NOT NULL CHECK(level IN ('info', 'warning', 'error', 'critical')),
        message TEXT NOT NULL,
        user_id TEXT,
        ip_address TEXT,
        user_agent TEXT,
        endpoint TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS revenue_tracking (
        id TEXT PRIMARY KEY,
        auction_id TEXT NOT NULL,
        transaction_type TEXT NOT NULL CHECK(transaction_type IN ('auction_fee', 'commission', 'refund')),
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'USD',
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'failed')),
        transaction_hash TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (auction_id) REFERENCES auctions(id)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS system_config (
        id TEXT PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        value TEXT NOT NULL,
        description TEXT,
        category TEXT DEFAULT 'general',
        is_public INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        admin_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL CHECK(target_type IN ('user', 'auction', 'config', 'system')),
        target_id TEXT,
        old_values TEXT,
        new_values TEXT,
        ip_address TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (admin_id) REFERENCES users(id)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS security_alerts (
        id TEXT PRIMARY KEY,
        alert_type TEXT NOT NULL CHECK(alert_type IN ('suspicious_login', 'failed_attempts', 'unusual_activity', 'security_breach')),
        severity TEXT NOT NULL CHECK(severity IN ('low', 'medium', 'high', 'critical')),
        message TEXT NOT NULL,
        user_id TEXT,
        ip_address TEXT,
        details TEXT,
        status TEXT DEFAULT 'open' CHECK(status IN ('open', 'investigating', 'resolved', 'false_positive')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME,
        resolved_by TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (resolved_by) REFERENCES users(id)
      )
    `);

    // Create social sharing analytics table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS social_shares (
        id TEXT PRIMARY KEY,
        auction_id TEXT NOT NULL,
        platform TEXT NOT NULL CHECK(platform IN ('twitter', 'facebook', 'linkedin', 'whatsapp', 'telegram', 'email', 'copy_link')),
        share_url TEXT NOT NULL,
        custom_message TEXT,
        image_generated INTEGER DEFAULT 0,
        user_id TEXT,
        ip_address TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (auction_id) REFERENCES auctions(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Create bookmark folders table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bookmark_folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        user_id TEXT NOT NULL,
        parent_folder_id TEXT,
        color TEXT DEFAULT '#3b82f6',
        icon TEXT DEFAULT 'folder',
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_folder_id) REFERENCES bookmark_folders(id) ON DELETE CASCADE
      )
    `);

    // Create bookmark tags table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bookmark_tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT DEFAULT '#10b981',
        user_id TEXT NOT NULL,
        usage_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(user_id, name)
      )
    `);

    // Create bookmarks table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bookmarks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        url TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('auction', 'user', 'search', 'custom')),
        target_id TEXT,
        user_id TEXT NOT NULL,
        folder_id TEXT,
        favicon TEXT,
        thumbnail TEXT,
        is_favorite INTEGER DEFAULT 0,
        is_private INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (folder_id) REFERENCES bookmark_folders(id) ON DELETE SET NULL
      )
    `);

    // Create bookmark-tag relationship table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bookmark_tag_relations (
        bookmark_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (bookmark_id, tag_id),
        FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES bookmark_tags(id) ON DELETE CASCADE
      )
    `);

    // Create bookmark sync table for cross-device synchronization
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bookmark_sync (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        bookmark_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('create', 'update', 'delete')),
        sync_data TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        synced INTEGER DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE
      )
    `);

    // Create share engagement tracking table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS share_engagement (
        id TEXT PRIMARY KEY,
        share_id TEXT NOT NULL,
        engagement_type TEXT NOT NULL CHECK(engagement_type IN ('click', 'view', 'conversion')),
        referrer_url TEXT,
        ip_address TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (share_id) REFERENCES social_shares(id)
      )
    `);

    // Create watchlist table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS watchlist (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        auction_id TEXT NOT NULL,
        notification_preferences TEXT DEFAULT '{"price_change": true, "ending_soon": true, "new_bid": true}',
        price_threshold REAL,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (auction_id) REFERENCES auctions(id) ON DELETE CASCADE,
        UNIQUE(user_id, auction_id)
      )
    `);

    // Create watchlist notifications table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS watchlist_notifications (
        id TEXT PRIMARY KEY,
        watchlist_id TEXT NOT NULL,
        notification_type TEXT NOT NULL CHECK(notification_type IN ('price_change', 'ending_soon', 'auction_ended', 'new_bid', 'outbid')),
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        is_read INTEGER DEFAULT 0,
        is_sent INTEGER DEFAULT 0,
        sent_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE CASCADE
      )
    `);

    // Create watchlist sharing table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS watchlist_shares (
        id TEXT PRIMARY KEY,
        watchlist_owner_id TEXT NOT NULL,
        share_token TEXT UNIQUE NOT NULL,
        share_url TEXT NOT NULL,
        is_public INTEGER DEFAULT 0,
        expires_at DATETIME,
        view_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (watchlist_owner_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Create watchlist activity log
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS watchlist_activity (
        id TEXT PRIMARY KEY,
        watchlist_id TEXT NOT NULL,
        activity_type TEXT NOT NULL CHECK(activity_type IN ('added', 'removed', 'price_alert_triggered', 'ending_soon_alert', 'notification_sent')),
        details TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE CASCADE
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
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_system_logs_level ON system_logs(level);
      CREATE INDEX IF NOT EXISTS idx_system_logs_created_at ON system_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_revenue_tracking_status ON revenue_tracking(status);
      CREATE INDEX IF NOT EXISTS idx_revenue_tracking_created_at ON revenue_tracking(created_at);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_id ON audit_logs(admin_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_security_alerts_status ON security_alerts(status);
      CREATE INDEX IF NOT EXISTS idx_security_alerts_severity ON security_alerts(severity);
      CREATE INDEX IF NOT EXISTS idx_social_shares_auction_id ON social_shares(auction_id);
      CREATE INDEX IF NOT EXISTS idx_social_shares_platform ON social_shares(platform);
      CREATE INDEX IF NOT EXISTS idx_social_shares_created_at ON social_shares(created_at);
      CREATE INDEX IF NOT EXISTS idx_share_engagement_share_id ON share_engagement(share_id);
      CREATE INDEX IF NOT EXISTS idx_share_engagement_type ON share_engagement(engagement_type);
      
      -- Bookmark-related indexes
      CREATE INDEX IF NOT EXISTS idx_bookmark_folders_user_id ON bookmark_folders(user_id);
      CREATE INDEX IF NOT EXISTS idx_bookmark_folders_parent_id ON bookmark_folders(parent_folder_id);
      CREATE INDEX IF NOT EXISTS idx_bookmark_tags_user_id ON bookmark_tags(user_id);
      CREATE INDEX IF NOT EXISTS idx_bookmark_tags_name ON bookmark_tags(name);
      CREATE INDEX IF NOT EXISTS idx_bookmarks_user_id ON bookmarks(user_id);
      CREATE INDEX IF NOT EXISTS idx_bookmarks_folder_id ON bookmarks(folder_id);
      CREATE INDEX IF NOT EXISTS idx_bookmarks_type ON bookmarks(type);
      CREATE INDEX IF NOT EXISTS idx_bookmarks_target_id ON bookmarks(target_id);
      CREATE INDEX IF NOT EXISTS idx_bookmarks_favorite ON bookmarks(is_favorite);
      CREATE INDEX IF NOT EXISTS idx_bookmark_tag_relations_bookmark_id ON bookmark_tag_relations(bookmark_id);
      CREATE INDEX IF NOT EXISTS idx_bookmark_tag_relations_tag_id ON bookmark_tag_relations(tag_id);
      CREATE INDEX IF NOT EXISTS idx_bookmark_sync_user_id ON bookmark_sync(user_id);
      CREATE INDEX IF NOT EXISTS idx_bookmark_sync_device_id ON bookmark_sync(device_id);
      CREATE INDEX IF NOT EXISTS idx_bookmark_sync_synced ON bookmark_sync(synced);
      
      -- Watchlist-related indexes
      CREATE INDEX IF NOT EXISTS idx_watchlist_user_id ON watchlist(user_id);
      CREATE INDEX IF NOT EXISTS idx_watchlist_auction_id ON watchlist(auction_id);
      CREATE INDEX IF NOT EXISTS idx_watchlist_created_at ON watchlist(created_at);
      CREATE INDEX IF NOT EXISTS idx_watchlist_notifications_watchlist_id ON watchlist_notifications(watchlist_id);
      CREATE INDEX IF NOT EXISTS idx_watchlist_notifications_type ON watchlist_notifications(notification_type);
      CREATE INDEX IF NOT EXISTS idx_watchlist_notifications_is_read ON watchlist_notifications(is_read);
      CREATE INDEX IF NOT EXISTS idx_watchlist_shares_owner_id ON watchlist_shares(watchlist_owner_id);
      CREATE INDEX IF NOT EXISTS idx_watchlist_shares_token ON watchlist_shares(share_token);
      CREATE INDEX IF NOT EXISTS idx_watchlist_activity_watchlist_id ON watchlist_activity(watchlist_id);
      CREATE INDEX IF NOT EXISTS idx_watchlist_activity_type ON watchlist_activity(activity_type);
    `);

    // Create chat-related tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('auction', 'global', 'private')),
        auction_id TEXT,
        created_by TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id),
        FOREIGN KEY (auction_id) REFERENCES auctions(id) ON DELETE CASCADE
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_participants (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT DEFAULT 'participant' CHECK(role IN ('admin', 'moderator', 'participant')),
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_read_at DATETIME,
        is_online INTEGER DEFAULT 0,
        FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(room_id, user_id)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        message_type TEXT DEFAULT 'text' CHECK(message_type IN ('text', 'file', 'emoji', 'system')),
        file_url TEXT,
        file_name TEXT,
        file_size INTEGER,
        reply_to_id TEXT,
        is_edited INTEGER DEFAULT 0,
        edited_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (reply_to_id) REFERENCES chat_messages(id) ON DELETE SET NULL
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_typing_indicators (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        is_typing INTEGER DEFAULT 1,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME DEFAULT (datetime('now', '+10 seconds')),
        FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Create chat-related indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_chat_rooms_type ON chat_rooms(type);
      CREATE INDEX IF NOT EXISTS idx_chat_rooms_auction_id ON chat_rooms(auction_id);
      CREATE INDEX IF NOT EXISTS idx_chat_rooms_created_by ON chat_rooms(created_by);
      CREATE INDEX IF NOT EXISTS idx_chat_participants_room_id ON chat_participants(room_id);
      CREATE INDEX IF NOT EXISTS idx_chat_participants_user_id ON chat_participants(user_id);
      CREATE INDEX IF NOT EXISTS idx_chat_participants_is_online ON chat_participants(is_online);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_room_id ON chat_messages(room_id);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id ON chat_messages(user_id);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_reply_to_id ON chat_messages(reply_to_id);
      CREATE INDEX IF NOT EXISTS idx_chat_typing_room_id ON chat_typing_indicators(room_id);
      CREATE INDEX IF NOT EXISTS idx_chat_typing_user_id ON chat_typing_indicators(user_id);
      CREATE INDEX IF NOT EXISTS idx_chat_typing_expires_at ON chat_typing_indicators(expires_at);
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

  getFilteredAuctions(page = 1, limit = 10, filters = {}) {
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
    const params = [];
    const countParams = [];
    
    let query = `
      SELECT a.*, 
             COUNT(DISTINCT b.id) as bid_count,
             (SELECT COUNT(*) FROM auction_views WHERE auction_id = a.id) as view_count
      FROM auctions a
      LEFT JOIN bids b ON a.id = b.auction_id
      WHERE 1=1
    `;
    
    let countQuery = `
      SELECT COUNT(DISTINCT a.id) as total
      FROM auctions a
      LEFT JOIN bids b ON a.id = b.auction_id
      WHERE 1=1
    `;

    // Status filter
    if (filters.status && filters.status !== 'all') {
      const statusValidation = this.securityLayer.validateInput(filters.status);
      if (!statusValidation.valid) {
        throw new Error('Invalid status value');
      }
      query += ' AND a.status = ?';
      countQuery += ' AND a.status = ?';
      params.push(filters.status);
      countParams.push(filters.status);
    }

    // Category filter
    if (filters.category && filters.category !== 'all') {
      const categoryValidation = this.securityLayer.validateInput(filters.category);
      if (!categoryValidation.valid) {
        throw new Error('Invalid category value');
      }
      query += ' AND a.category = ?';
      countQuery += ' AND a.category = ?';
      params.push(filters.category);
      countParams.push(filters.category);
    }

    // Price range filter
    if (filters.minPrice !== undefined && filters.minPrice !== null) {
      const minPrice = parseFloat(filters.minPrice);
      if (isNaN(minPrice)) {
        throw new Error('Invalid minimum price');
      }
      query += ' AND a.current_highest_bid >= ?';
      countQuery += ' AND a.current_highest_bid >= ?';
      params.push(minPrice);
      countParams.push(minPrice);
    }

    if (filters.maxPrice !== undefined && filters.maxPrice !== null) {
      const maxPrice = parseFloat(filters.maxPrice);
      if (isNaN(maxPrice)) {
        throw new Error('Invalid maximum price');
      }
      query += ' AND a.current_highest_bid <= ?';
      countQuery += ' AND a.current_highest_bid <= ?';
      params.push(maxPrice);
      countParams.push(maxPrice);
    }

    // Ending soon filter (within 24 hours)
    if (filters.endingSoon === true) {
      const oneDayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const now = new Date().toISOString();
      query += ' AND a.end_time BETWEEN ? AND ? AND a.status = "active"';
      countQuery += ' AND a.end_time BETWEEN ? AND ? AND a.status = "active"';
      params.push(now, oneDayFromNow);
      countParams.push(now, oneDayFromNow);
    }

    // Search query filter
    if (filters.search && filters.search.trim() !== '') {
      const searchValidation = this.securityLayer.validateInput(filters.search);
      if (!searchValidation.valid) {
        throw new Error('Invalid search query');
      }
      const searchTerm = `%${filters.search.trim()}%`;
      query += ' AND (a.title LIKE ? OR a.description LIKE ?)';
      countQuery += ' AND (a.title LIKE ? OR a.description LIKE ?)';
      params.push(searchTerm, searchTerm);
      countParams.push(searchTerm, searchTerm);
    }

    // Add GROUP BY clause for counting distinct auctions
    query += ' GROUP BY a.id';

    // Sorting
    const validSortOptions = ['price_asc', 'price_desc', 'time_asc', 'time_desc', 'popularity_desc', 'newest'];
    const sortBy = filters.sortBy && validSortOptions.includes(filters.sortBy) ? filters.sortBy : 'newest';
    
    switch (sortBy) {
      case 'price_asc':
        query += ' ORDER BY a.current_highest_bid ASC';
        break;
      case 'price_desc':
        query += ' ORDER BY a.current_highest_bid DESC';
        break;
      case 'time_asc':
        query += ' ORDER BY a.end_time ASC';
        break;
      case 'time_desc':
        query += ' ORDER BY a.end_time DESC';
        break;
      case 'popularity_desc':
        query += ' ORDER BY bid_count DESC';
        break;
      case 'newest':
      default:
        query += ' ORDER BY a.created_at DESC';
        break;
    }

    query += ' LIMIT ? OFFSET ?';
    params.push(limitNum, offset);

    const countStmt = this.securityLayer.prepare(countQuery);
    const auctionsStmt = this.securityLayer.prepare(query);

    const totalResult = countStmt.get(...countParams);
    const auctions = auctionsStmt.all(...params);

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

  getAuctionCategories() {
    const stmt = this.securityLayer.prepare('SELECT DISTINCT category FROM auctions WHERE category IS NOT NULL ORDER BY category');
    return stmt.all();
  }

  searchAuctions(query, limit = 20) {
    const queryValidation = this.securityLayer.validateInput(query);
    if (!queryValidation.valid) {
      throw new Error('Invalid search query');
    }

    const searchTerm = `%${query.trim()}%`;
    const stmt = this.securityLayer.prepare(`
      SELECT id, title, description, current_highest_bid, category, status
      FROM auctions
      WHERE (title LIKE ? OR description LIKE ?)
      AND status = 'active'
      ORDER BY created_at DESC
      LIMIT ?
    `);
    
    return stmt.all(searchTerm, searchTerm, limit);
  }

  recordAuctionView(auctionId, userId = null, ipAddress = null, userAgent = null) {
    try {
      const idValidation = this.securityLayer.validateInput(auctionId);
      if (!idValidation.valid) {
        throw new Error('Invalid auction ID');
      }

      const viewId = require('uuid').v4();
      const stmt = this.securityLayer.prepare(`
        INSERT INTO auction_views (id, auction_id, user_id, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?)
      `);

      stmt.run(viewId, auctionId, userId || null, ipAddress || null, userAgent || null);
      return { id: viewId, success: true };
    } catch (error) {
      // View recording failure should not break the app
      console.warn('Failed to record auction view:', error);
      return { success: false };
    }
  }

  getAuctionViewCount(auctionId) {
    try {
      const idValidation = this.securityLayer.validateInput(auctionId);
      if (!idValidation.valid) {
        throw new Error('Invalid auction ID');
      }

      const stmt = this.securityLayer.prepare(`
        SELECT COUNT(*) as view_count FROM auction_views WHERE auction_id = ?
      `);

      const result = stmt.get(auctionId);
      return result.view_count || 0;
    } catch (error) {
      console.warn('Failed to get auction view count:', error);
      return 0;
    }
  }

  getUserAuctions(userId, filters = {}) {
    const { limit = 50, offset = 0, status, sortBy = 'created_at', sortOrder = 'DESC' } = filters;
    
    // Validate user ID
    const userValidation = this.securityLayer.validateInput(userId);
    if (!userValidation.valid) {
      throw new Error('Invalid user ID');
    }
    
    let query = `
      SELECT a.*, 
             COUNT(b.id) as bid_count,
             MAX(b.amount) as highest_bid,
             u.username as creator_username
      FROM auctions a
      LEFT JOIN bids b ON a.id = b.auction_id
      LEFT JOIN users u ON a.creator_id = u.id
      WHERE a.creator_id = ?
    `;
    const params = [userValidation.sanitized];
    
    if (status && status !== 'all') {
      query += ` AND a.status = ?`;
      params.push(status);
    }
    
    query += ` GROUP BY a.id`;
    
    // Validate sort column
    const validSortColumns = ['created_at', 'end_time', 'title', 'starting_bid', 'status'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'created_at';
    const sortDirection = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    
    query += ` ORDER BY a.${sortColumn} ${sortDirection} LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    
    const stmt = this.securityLayer.prepare(query);
    return stmt.all(...params);
  }

  getUserAuctionsCount(userId, status) {
    const userValidation = this.securityLayer.validateInput(userId);
    if (!userValidation.valid) {
      throw new Error('Invalid user ID');
    }

    let query = `SELECT COUNT(DISTINCT a.id) as total FROM auctions a WHERE a.creator_id = ?`;
    const params = [userValidation.sanitized];

    if (status && status !== 'all') {
      query += ` AND a.status = ?`;
      params.push(status);
    }

    const stmt = this.securityLayer.prepare(query);
    const result = stmt.get(...params);
    return result.total || 0;
  }

  getUserDashboardStats(userId) {
    // Validate user ID
    const userValidation = this.securityLayer.validateInput(userId);
    if (!userValidation.valid) {
      throw new Error('Invalid user ID');
    }
    
    const stmt = this.securityLayer.prepare(`
      SELECT 
        COUNT(DISTINCT CASE WHEN a.creator_id = ? THEN a.id END) as total_auctions_created,
        COUNT(DISTINCT CASE WHEN a.creator_id = ? AND a.status = 'active' THEN a.id END) as active_auctions,
        COUNT(DISTINCT CASE WHEN a.creator_id = ? AND a.status = 'closed' AND a.winner_id IS NOT NULL THEN a.id END) as successful_auctions,
        COUNT(DISTINCT CASE WHEN b.bidder_id = ? THEN b.id END) as total_bids_placed,
        COUNT(DISTINCT CASE WHEN b.bidder_id = ? AND a.status = 'closed' AND a.winner_id = ? THEN b.auction_id END) as auctions_won,
        COALESCE(SUM(CASE WHEN b.bidder_id = ? AND a.status = 'closed' AND a.winner_id = ? THEN a.current_highest_bid END), 0) as total_won_value,
        COALESCE(SUM(CASE WHEN b.bidder_id = ? THEN b.amount END), 0) as total_bid_amount,
        COALESCE(AVG(CASE WHEN b.bidder_id = ? THEN b.amount END), 0) as avg_bid_amount
      FROM users u
      LEFT JOIN auctions a ON a.creator_id = u.id
      LEFT JOIN bids b ON b.bidder_id = u.id
      LEFT JOIN auctions ab ON b.auction_id = ab.id
      WHERE u.id = ?
    `);
    
    const result = stmt.get(
      userValidation.sanitized, // total_auctions_created
      userValidation.sanitized, // active_auctions
      userValidation.sanitized, // successful_auctions
      userValidation.sanitized, // total_bids_placed
      userValidation.sanitized, // auctions_won (bidder)
      userValidation.sanitized, // auctions_won (winner check)
      userValidation.sanitized, // total_won_value (bidder)
      userValidation.sanitized, // total_won_value (winner check)
      userValidation.sanitized, // total_bid_amount
      userValidation.sanitized, // avg_bid_amount
      userValidation.sanitized  // WHERE clause
    );
    
    return result;
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
    
    const updateStmt = this.securityLayer.prepare(`
      UPDATE auctions 
      SET status = 'closed', winner_id = ?, winning_bid_id = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);
    return updateStmt.run(
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

  getUserBidHistory(userId, options = {}) {
    const { limit = 20, status = null, sortBy = 'timestamp', sortOrder = 'DESC' } = options;
    
    const userValidation = this.securityLayer.validateInput(userId);
    if (!userValidation.valid) {
      throw new Error('Invalid user ID');
    }
    
    let query = `
      SELECT b.*, 
             a.title as auction_title, 
             a.status as auction_status, 
             a.end_time,
             (SELECT MAX(amount) FROM bids WHERE auction_id = a.id) as current_highest_bid,
             CASE WHEN a.winner_id = b.bidder_id THEN 1 ELSE 0 END as is_winning_bid
      FROM bids b
      JOIN auctions a ON b.auction_id = a.id
      WHERE b.bidder_id = ?
    `;
    
    const params = [userValidation.sanitized];
    
    if (status && status !== 'all') {
      query += ` AND a.status = ?`;
      params.push(status);
    }
    
    // Group by auction ID if we just want the highest bid per auction
    // But since this is a history, we probably want all bids.
    // Wait, the frontend might want just the latest bid per auction if status='active'.
    // The previous implementation used it for "Active Bids" and "Recent Activity".
    
    const validSortColumns = ['timestamp', 'amount'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'timestamp';
    const sortDirection = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    
    query += ` ORDER BY b.${sortColumn} ${sortDirection} LIMIT ?`;
    params.push(parseInt(limit) || 20);
    
    const stmt = this.securityLayer.prepare(query);
    return stmt.all(...params);
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

  // ==================== REFRESH TOKEN OPERATIONS ====================

  createRefreshToken(refreshToken) {
    const validation = this.securityLayer.validateInputs({
      id: refreshToken.id,
      user_id: refreshToken.user_id,
      token_hash: refreshToken.token_hash,
      device_info: refreshToken.device_info,
      ip_address: refreshToken.ip_address,
      user_agent: refreshToken.user_agent,
      expires_at: refreshToken.expires_at
    });
    
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const stmt = this.securityLayer.prepare(`
      INSERT INTO refresh_tokens (id, user_id, token_hash, device_info, ip_address, user_agent, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    return stmt.run(
      validation.sanitized.id,
      validation.sanitized.user_id,
      validation.sanitized.token_hash,
      validation.sanitized.device_info,
      validation.sanitized.ip_address,
      validation.sanitized.user_agent,
      validation.sanitized.expires_at
    );
  }

  getRefreshToken(tokenHash) {
    const validation = this.securityLayer.validateInput(tokenHash);
    if (!validation.valid) {
      console.warn('[SECURITY] Invalid refresh token hash format:', tokenHash);
      return null;
    }
    
    const stmt = this.securityLayer.prepare(`
      SELECT rt.*, u.username, u.email 
      FROM refresh_tokens rt 
      JOIN users u ON rt.user_id = u.id 
      WHERE rt.token_hash = ? AND rt.is_revoked = 0 AND rt.expires_at > datetime('now')
    `);
    return stmt.get(validation.sanitized);
  }

  revokeRefreshToken(tokenHash) {
    const validation = this.securityLayer.validateInput(tokenHash);
    if (!validation.valid) {
      console.warn('[SECURITY] Invalid refresh token hash format:', tokenHash);
      return false;
    }
    
    const stmt = this.securityLayer.prepare(`
      UPDATE refresh_tokens SET is_revoked = 1 WHERE token_hash = ?
    `);
    const result = stmt.run(validation.sanitized);
    return result.changes > 0;
  }

  revokeAllUserRefreshTokens(userId) {
    const validation = this.securityLayer.validateInput(userId);
    if (!validation.valid) {
      console.warn('[SECURITY] Invalid user ID format:', userId);
      return false;
    }
    
    const stmt = this.securityLayer.prepare(`
      UPDATE refresh_tokens SET is_revoked = 1 WHERE user_id = ? AND is_revoked = 0
    `);
    const result = stmt.run(validation.sanitized);
    return result.changes > 0;
  }

  updateRefreshTokenLastUsed(tokenId) {
    const validation = this.securityLayer.validateInput(tokenId);
    if (!validation.valid) {
      console.warn('[SECURITY] Invalid refresh token ID format:', tokenId);
      return false;
    }
    
    const stmt = this.securityLayer.prepare(`
      UPDATE refresh_tokens SET last_used_at = datetime('now') WHERE id = ?
    `);
    const result = stmt.run(validation.sanitized);
    return result.changes > 0;
  }

  cleanupExpiredRefreshTokens() {
    const stmt = this.securityLayer.prepare(`
      DELETE FROM refresh_tokens WHERE expires_at <= datetime('now') OR is_revoked = 1
    `);
    return stmt.run();
  }

  // ==================== SESSION MANAGEMENT OPERATIONS ====================

  createUserSession(session) {
    const validation = this.securityLayer.validateInputs({
      id: session.id,
      user_id: session.user_id,
      refresh_token_id: session.refresh_token_id,
      device_fingerprint: session.device_fingerprint
    });
    
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const stmt = this.securityLayer.prepare(`
      INSERT INTO user_sessions (id, user_id, refresh_token_id, device_fingerprint)
      VALUES (?, ?, ?, ?)
    `);
    
    return stmt.run(
      validation.sanitized.id,
      validation.sanitized.user_id,
      validation.sanitized.refresh_token_id,
      validation.sanitized.device_fingerprint
    );
  }

  getUserSessions(userId) {
    const validation = this.securityLayer.validateInput(userId);
    if (!validation.valid) {
      console.warn('[SECURITY] Invalid user ID format:', userId);
      return [];
    }
    
    const stmt = this.securityLayer.prepare(`
      SELECT us.*, rt.device_info, rt.ip_address, rt.created_at as token_created_at,
             rt.last_used_at, rt.expires_at
      FROM user_sessions us 
      JOIN refresh_tokens rt ON us.refresh_token_id = rt.id 
      WHERE us.user_id = ? AND us.is_active = 1 AND rt.is_revoked = 0
      ORDER BY us.last_activity_at DESC
    `);
    return stmt.all(validation.sanitized);
  }

  deactivateSession(sessionId) {
    const validation = this.securityLayer.validateInput(sessionId);
    if (!validation.valid) {
      console.warn('[SECURITY] Invalid session ID format:', sessionId);
      return false;
    }
    
    const stmt = this.securityLayer.prepare(`
      UPDATE user_sessions SET is_active = 0 WHERE id = ?
    `);
    const result = stmt.run(validation.sanitized);
    return result.changes > 0;
  }

  updateSessionActivity(sessionId) {
    const validation = this.securityLayer.validateInput(sessionId);
    if (!validation.valid) {
      console.warn('[SECURITY] Invalid session ID format:', sessionId);
      return false;
    }
    
    const stmt = this.securityLayer.prepare(`
      UPDATE user_sessions SET last_activity_at = datetime('now') WHERE id = ?
    `);
    const result = stmt.run(validation.sanitized);
    return result.changes > 0;
  }

  deactivateAllUserSessions(userId) {
    const validation = this.securityLayer.validateInput(userId);
    if (!validation.valid) {
      console.warn('[SECURITY] Invalid user ID format:', userId);
      return false;
    }
    
    const stmt = this.securityLayer.prepare(`
      UPDATE user_sessions SET is_active = 0 WHERE user_id = ?
    `);
    const result = stmt.run(validation.sanitized);
    return result.changes > 0;
  }

  // Admin methods
  updateUserRole(userId, role) {
    const validation = this.securityLayer.validateInputs({ userId, role });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const stmt = this.securityLayer.prepare(`
      UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?
    `);
    return stmt.run(validation.sanitized.role, validation.sanitized.userId);
  }

  updateUserStatus(userId, isActive) {
    const validation = this.securityLayer.validateInputs({ userId, isActive });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const stmt = this.securityLayer.prepare(`
      UPDATE users SET is_active = ?, updated_at = datetime('now') WHERE id = ?
    `);
    return stmt.run(validation.sanitized.isActive ? 1 : 0, validation.sanitized.userId);
  }

  getAllUsers(limit = 50, offset = 0) {
    const stmt = this.securityLayer.prepare(`
      SELECT id, username, email, role, failed_login_attempts, locked_until, 
             is_active, email_verified, created_at, updated_at
      FROM users 
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);
    return stmt.all(limit, offset);
  }

  getUserStats() {
    const stmt = this.securityLayer.prepare(`
      SELECT 
        COUNT(*) as total_users,
        COUNT(CASE WHEN role = 'admin' THEN 1 END) as admin_count,
        COUNT(CASE WHEN role = 'moderator' THEN 1 END) as moderator_count,
        COUNT(CASE WHEN is_active = 1 THEN 1 END) as active_users,
        COUNT(CASE WHEN email_verified = 1 THEN 1 END) as verified_users,
        COUNT(CASE WHEN locked_until > datetime('now') THEN 1 END) as locked_users
      FROM users
    `);
    return stmt.get();
  }

  getAuctionStats() {
    const stmt = this.securityLayer.prepare(`
      SELECT 
        COUNT(*) as total_auctions,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_auctions,
        COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed_auctions,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_auctions,
        COALESCE(SUM(CASE WHEN status = 'closed' THEN current_highest_bid ELSE 0 END), 0) as total_revenue
      FROM auctions
    `);
    return stmt.get();
  }

  getRevenueStats(days = 30) {
    const stmt = this.securityLayer.prepare(`
      SELECT 
        transaction_type,
        SUM(amount) as total_amount,
        COUNT(*) as transaction_count,
        AVG(amount) as average_amount
      FROM revenue_tracking 
      WHERE created_at >= datetime('now', '-${days} days')
        AND status = 'completed'
      GROUP BY transaction_type
    `);
    return stmt.all();
  }

  createAuditLog(adminId, action, targetType, targetId, oldValues = null, newValues = null, ipAddress = null, userAgent = null) {
    const validation = this.securityLayer.validateInputs({ adminId, action, targetType, targetId });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const stmt = this.securityLayer.prepare(`
      INSERT INTO audit_logs (admin_id, action, target_type, target_id, old_values, new_values, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      validation.sanitized.adminId,
      validation.sanitized.action,
      validation.sanitized.targetType,
      validation.sanitized.targetId,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      ipAddress,
      userAgent
    );
  }

  getAuditLogs(limit = 100, offset = 0) {
    const stmt = this.securityLayer.prepare(`
      SELECT al.*, u.username as admin_username
      FROM audit_logs al
      JOIN users u ON al.admin_id = u.id
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?
    `);
    return stmt.all(limit, offset);
  }

  createSecurityAlert(alertType, severity, message, userId = null, ipAddress = null, details = null) {
    const validation = this.securityLayer.validateInputs({ alertType, severity, message, userId });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const stmt = this.securityLayer.prepare(`
      INSERT INTO security_alerts (alert_type, severity, message, user_id, ip_address, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      validation.sanitized.alertType,
      validation.sanitized.severity,
      validation.sanitized.message,
      validation.sanitized.userId,
      ipAddress,
      details ? JSON.stringify(details) : null
    );
  }

  getSecurityAlerts(status = null, limit = 50) {
    let query = `
      SELECT sa.*, u.username as user_username
      FROM security_alerts sa
      LEFT JOIN users u ON sa.user_id = u.id
    `;
    let params = [];
    
    if (status) {
      query += ' WHERE sa.status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY sa.created_at DESC LIMIT ?';
    params.push(limit);
    
    const stmt = this.securityLayer.prepare(query);
    return stmt.all(...params);
  }

  updateSecurityAlertStatus(alertId, status, resolvedBy = null) {
    const validation = this.securityLayer.validateInputs({ alertId, status, resolvedBy });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const stmt = this.securityLayer.prepare(`
      UPDATE security_alerts 
      SET status = ?, resolved_at = datetime('now'), resolved_by = ?
      WHERE id = ?
    `);
    return stmt.run(validation.sanitized.status, validation.sanitized.resolvedBy, validation.sanitized.alertId);
  }

  createSystemConfig(key, value, description = null, category = 'general', isPublic = 0) {
    const validation = this.securityLayer.validateInputs({ key, value, description, category });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const stmt = this.securityLayer.prepare(`
      INSERT INTO system_config (key, value, description, category, is_public)
      VALUES (?, ?, ?, ?, ?)
    `);
    return stmt.run(
      validation.sanitized.key,
      validation.sanitized.value,
      validation.sanitized.description,
      validation.sanitized.category,
      isPublic ? 1 : 0
    );
  }

  updateSystemConfig(key, value) {
    const validation = this.securityLayer.validateInputs({ key, value });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const stmt = this.securityLayer.prepare(`
      UPDATE system_config 
      SET value = ?, updated_at = datetime('now') 
      WHERE key = ?
    `);
    return stmt.run(validation.sanitized.value, validation.sanitized.key);
  }

  getSystemConfig(category = null, isPublic = null) {
    let query = 'SELECT * FROM system_config';
    let params = [];
    let conditions = [];
    
    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }
    
    if (isPublic !== null) {
      conditions.push('is_public = ?');
      params.push(isPublic ? 1 : 0);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY category, key';
    
    const stmt = this.securityLayer.prepare(query);
    return stmt.all(...params);
  }

  createSystemLog(level, message, userId = null, ipAddress = null, userAgent = null, endpoint = null) {
    const validation = this.securityLayer.validateInputs({ level, message, userId });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const stmt = this.securityLayer.prepare(`
      INSERT INTO system_logs (level, message, user_id, ip_address, user_agent, endpoint)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      validation.sanitized.level,
      validation.sanitized.message,
      validation.sanitized.userId,
      ipAddress,
      userAgent,
      endpoint
    );
  }

  getSystemLogs(level = null, limit = 100) {
    let query = `
      SELECT sl.*, u.username as user_username
      FROM system_logs sl
      LEFT JOIN users u ON sl.user_id = u.id
    `;
    let params = [];
    
    if (level) {
      query += ' WHERE sl.level = ?';
      params.push(level);
    }
    
    query += ' ORDER BY sl.created_at DESC LIMIT ?';
    params.push(limit);
    
    const stmt = this.securityLayer.prepare(query);
    return stmt.all(...params);
  }

  trackRevenue(auctionId, transactionType, amount, currency = 'USD', transactionHash = null) {
    const validation = this.securityLayer.validateInputs({ auctionId, transactionType, amount });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const stmt = this.securityLayer.prepare(`
      INSERT INTO revenue_tracking (auction_id, transaction_type, amount, currency, transaction_hash)
      VALUES (?, ?, ?, ?, ?)
    `);
    return stmt.run(
      validation.sanitized.auctionId,
      validation.sanitized.transactionType,
      validation.sanitized.amount,
      currency,
      transactionHash
    );
  }

  getRevenueSummary(days = 30) {
    const stmt = this.securityLayer.prepare(`
      SELECT 
        DATE(created_at) as date,
        SUM(amount) as daily_revenue,
        COUNT(*) as transaction_count
      FROM revenue_tracking 
      WHERE created_at >= datetime('now', '-${days} days')
        AND status = 'completed'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);
    return stmt.all();
  }

  // Additional admin methods
  getAuctionsByStatus(status, limit = 50, offset = 0) {
    const validation = this.securityLayer.validateInputs({ status, limit, offset });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }

    const stmt = this.securityLayer.prepare(`
      SELECT a.*, u.username as creator_username
      FROM auctions a
      JOIN users u ON a.creator_id = u.id
      WHERE a.status = ?
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `);
    return stmt.all(validation.sanitized.status, validation.sanitized.limit, validation.sanitized.offset);
  }

  getAllAuctions(limit = 50, offset = 0) {
    const validation = this.securityLayer.validateInputs({ limit, offset });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }

    const stmt = this.securityLayer.prepare(`
      SELECT a.*, u.username as creator_username
      FROM auctions a
      JOIN users u ON a.creator_id = u.id
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `);
    return stmt.all(validation.sanitized.limit, validation.sanitized.offset);
  }

  updateAuctionStatus(auctionId, status) {
    const validation = this.securityLayer.validateInputs({ auctionId, status });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }

    const stmt = this.securityLayer.prepare(`
      UPDATE auctions 
      SET status = ?, updated_at = datetime('now') 
      WHERE id = ?
    `);
    return stmt.run(validation.sanitized.status, validation.sanitized.auctionId);
  }

  getAuctionById(auctionId) {
    const validation = this.securityLayer.validateInput(auctionId);
    if (!validation.valid) {
      console.warn('[SECURITY] Invalid auction ID format:', auctionId);
      return null;
    }

    const stmt = this.securityLayer.prepare(`
      SELECT a.*, u.username as creator_username
      FROM auctions a
      JOIN users u ON a.creator_id = u.id
      WHERE a.id = ?
    `);
    return stmt.get(validation.sanitized);
  }

  getRevenueTransactions(limit = 50, offset = 0, status = null) {
    let query = `
      SELECT rt.*, a.title as auction_title
      FROM revenue_tracking rt
      JOIN auctions a ON rt.auction_id = a.id
    `;
    let params = [];
    let conditions = [];

    if (status) {
      conditions.push('rt.status = ?');
      params.push(status);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY rt.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const stmt = this.securityLayer.prepare(query);
    return stmt.all(...params);
  }

  getActiveAuctions() {
    const stmt = this.securityLayer.prepare(`
      SELECT * FROM auctions 
      WHERE status = 'active' AND end_time > datetime('now')
      ORDER BY end_time ASC
    `);
    return stmt.all();
  }

  closeAuction(auctionId, winnerId, winningBidId) {
    const validation = this.securityLayer.validateInputs({ auctionId, winnerId, winningBidId });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }

    const stmt = this.securityLayer.prepare(`
      UPDATE auctions 
      SET status = 'closed', winner_id = ?, winning_bid_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `);
    return stmt.run(
      validation.sanitized.winnerId,
      validation.sanitized.winningBidId,
      validation.sanitized.auctionId
    );
  }

  // Social sharing methods
  createSocialShare(auctionId, platform, shareUrl, customMessage = null, imageGenerated = false, userId = null, ipAddress = null, userAgent = null) {
    const validation = this.securityLayer.validateInputs({ auctionId, platform, shareUrl, customMessage });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }

    const stmt = this.securityLayer.prepare(`
      INSERT INTO social_shares (auction_id, platform, share_url, custom_message, image_generated, user_id, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      validation.sanitized.auctionId,
      validation.sanitized.platform,
      validation.sanitized.shareUrl,
      validation.sanitized.customMessage,
      imageGenerated ? 1 : 0,
      userId,
      ipAddress,
      userAgent
    );
  }

  trackShareEngagement(shareId, engagementType, referrerUrl = null, ipAddress = null, userAgent = null) {
    const validation = this.securityLayer.validateInputs({ shareId, engagementType, referrerUrl });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }

    const stmt = this.securityLayer.prepare(`
      INSERT INTO share_engagement (share_id, engagement_type, referrer_url, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?)
    `);
    return stmt.run(
      validation.sanitized.shareId,
      validation.sanitized.engagementType,
      validation.sanitized.referrerUrl,
      ipAddress,
      userAgent
    );
  }

  getShareStats(auctionId = null, days = 30) {
    let query = `
      SELECT 
        platform,
        COUNT(*) as total_shares,
        COUNT(CASE WHEN image_generated = 1 THEN 1 END) as image_shares,
        COUNT(DISTINCT user_id) as unique_users
      FROM social_shares 
      WHERE created_at >= datetime('now', '-${days} days')
    `;
    let params = [];

    if (auctionId) {
      query += ' AND auction_id = ?';
      params.push(auctionId);
    }

    query += ' GROUP BY platform ORDER BY total_shares DESC';

    const stmt = this.securityLayer.prepare(query);
    return stmt.all(...params);
  }

  getEngagementStats(shareId = null, days = 30) {
    let query = `
      SELECT 
        se.engagement_type,
        COUNT(*) as count,
        COUNT(DISTINCT se.ip_address) as unique_ips
      FROM share_engagement se
      JOIN social_shares ss ON se.share_id = ss.id
      WHERE se.created_at >= datetime('now', '-${days} days')
    `;
    let params = [];

    if (shareId) {
      query += ' AND se.share_id = ?';
      params.push(shareId);
    }

    query += ' GROUP BY se.engagement_type ORDER BY count DESC';

    const stmt = this.securityLayer.prepare(query);
    return stmt.all(...params);
  }

  getTopSharedAuctions(limit = 10, days = 30) {
    const stmt = this.securityLayer.prepare(`
      SELECT 
        a.id,
        a.title,
        COUNT(ss.id) as share_count,
        COUNT(DISTINCT ss.user_id) as unique_sharers,
        COUNT(se.id) as engagement_count
      FROM auctions a
      LEFT JOIN social_shares ss ON a.id = ss.auction_id
      LEFT JOIN share_engagement se ON ss.id = se.share_id
      WHERE ss.created_at >= datetime('now', '-${days} days') OR ss.created_at IS NULL
      GROUP BY a.id, a.title
      HAVING share_count > 0
      ORDER BY share_count DESC
      LIMIT ?
    `);
    return stmt.all(limit);
  }

  getShareAnalytics(days = 30) {
    const stmt = this.securityLayer.prepare(`
      SELECT 
        DATE(ss.created_at) as date,
        ss.platform,
        COUNT(ss.id) as shares,
        COUNT(DISTINCT ss.user_id) as unique_users,
        COUNT(se.id) as engagements
      FROM social_shares ss
      LEFT JOIN share_engagement se ON ss.id = se.share_id
      WHERE ss.created_at >= datetime('now', '-${days} days')
      GROUP BY DATE(ss.created_at), ss.platform
      ORDER BY date DESC, ss.platform
    `);
    return stmt.all();
  }

  // Admin Dashboard Methods
  
  // User Management
  getAllUsers(page = 1, limit = 20, filters = {}) {
    let query = `
      SELECT id, username, email, role, failed_login_attempts, last_failed_login, 
             locked_until, is_active, email_verified, created_at, updated_at
      FROM users
      WHERE 1=1
    `;
    const params = [];
    
    if (filters.role) {
      query += ` AND role = ?`;
      params.push(filters.role);
    }
    
    if (filters.status) {
      query += ` AND is_active = ?`;
      params.push(filters.status === 'active' ? 1 : 0);
    }
    
    if (filters.search) {
      query += ` AND (username LIKE ? OR email LIKE ?)`;
      params.push(`%${filters.search}%`, `%${filters.search}%`);
    }
    
    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, (page - 1) * limit);
    
    const stmt = this.securityLayer.prepare(query);
    const users = stmt.all(...params);
    
    // Get total count
    const countQuery = query.replace(/SELECT.*?FROM/, 'SELECT COUNT(*) FROM').replace(/ORDER BY.*$/, '');
    const countStmt = this.securityLayer.prepare(countQuery);
    const total = countStmt.get(...params.slice(0, -2)).count;
    
    return { users, total, page, totalPages: Math.ceil(total / limit) };
  }
  
  updateUserRole(userId, newRole, adminId) {
    const user = this.getUser(userId);
    if (!user) throw new Error('User not found');
    
    const oldRole = user.role;
    const stmt = this.securityLayer.prepare(`
      UPDATE users 
      SET role = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);
    
    const result = stmt.run(newRole, userId);
    
    if (result.changes > 0) {
      this.logAuditAction(adminId, 'update_role', 'user', userId, oldRole, newRole);
    }
    
    return result.changes > 0;
  }
  
  toggleUserStatus(userId, adminId) {
    const user = this.getUser(userId);
    if (!user) throw new Error('User not found');
    
    const newStatus = user.is_active ? 0 : 1;
    const stmt = this.securityLayer.prepare(`
      UPDATE users 
      SET is_active = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);
    
    const result = stmt.run(newStatus, userId);
    
    if (result.changes > 0) {
      this.logAuditAction(adminId, 'toggle_status', 'user', userId, user.is_active.toString(), newStatus.toString());
    }
    
    return result.changes > 0;
  }
  
  // Auction Moderation
  getAllAuctionsForAdmin(page = 1, limit = 20, filters = {}) {
    let query = `
      SELECT a.*, u.username as creator_username, w.username as winner_username
      FROM auctions a
      LEFT JOIN users u ON a.creator_id = u.id
      LEFT JOIN users w ON a.winner_id = w.id
      WHERE 1=1
    `;
    const params = [];
    
    if (filters.status) {
      query += ` AND a.status = ?`;
      params.push(filters.status);
    }
    
    if (filters.search) {
      query += ` AND (a.title LIKE ? OR a.description LIKE ?)`;
      params.push(`%${filters.search}%`, `%${filters.search}%`);
    }
    
    query += ` ORDER BY a.created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, (page - 1) * limit);
    
    const stmt = this.securityLayer.prepare(query);
    const auctions = stmt.all(...params);
    
    // Get total count
    const countQuery = query.replace(/SELECT.*?FROM/, 'SELECT COUNT(*) FROM').replace(/ORDER BY.*$/, '');
    const countStmt = this.securityLayer.prepare(countQuery);
    const total = countStmt.get(...params.slice(0, -2)).count;
    
    return { auctions, total, page, totalPages: Math.ceil(total / limit) };
  }
  
  moderateAuction(auctionId, action, adminId, reason = '') {
    const auction = this.getAuction(auctionId);
    if (!auction) throw new Error('Auction not found');
    
    let newStatus;
    switch (action) {
      case 'close':
        newStatus = 'closed';
        break;
      case 'cancel':
        newStatus = 'cancelled';
        break;
      case 'reopen':
        newStatus = 'active';
        break;
      default:
        throw new Error('Invalid moderation action');
    }
    
    const stmt = this.securityLayer.prepare(`
      UPDATE auctions 
      SET status = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);
    
    const result = stmt.run(newStatus, auctionId);
    
    if (result.changes > 0) {
      this.logAuditAction(adminId, 'moderate_auction', 'auction', auctionId, auction.status, newStatus, reason);
    }
    
    return result.changes > 0;
  }
  
  // System Statistics
  getSystemStats() {
    const stats = {};
    
    // User stats
    const userStats = this.securityLayer.prepare(`
      SELECT 
        COUNT(*) as total_users,
        COUNT(CASE WHEN role = 'admin' THEN 1 END) as admin_users,
        COUNT(CASE WHEN role = 'moderator' THEN 1 END) as moderator_users,
        COUNT(CASE WHEN is_active = 1 THEN 1 END) as active_users,
        COUNT(CASE WHEN created_at >= datetime('now', '-30 days') THEN 1 END) as new_users_30d
      FROM users
    `).get();
    stats.users = userStats;
    
    // Auction stats
    const auctionStats = this.securityLayer.prepare(`
      SELECT 
        COUNT(*) as total_auctions,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_auctions,
        COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed_auctions,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_auctions,
        COUNT(CASE WHEN created_at >= datetime('now', '-30 days') THEN 1 END) as new_auctions_30d
      FROM auctions
    `).get();
    stats.auctions = auctionStats;
    
    // Bid stats
    const bidStats = this.securityLayer.prepare(`
      SELECT 
        COUNT(*) as total_bids,
        COUNT(CASE WHEN timestamp >= datetime('now', '-30 days') THEN 1 END) as bids_30d,
        AVG(amount) as avg_bid_amount,
        MAX(amount) as highest_bid
      FROM bids
    `).get();
    stats.bids = bidStats;
    
    // Revenue stats
    const revenueStats = this.securityLayer.prepare(`
      SELECT 
        COUNT(*) as total_transactions,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_transactions,
        SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END) as total_revenue,
        SUM(CASE WHEN status = 'completed' AND created_at >= datetime('now', '-30 days') THEN amount ELSE 0 END) as revenue_30d
      FROM revenue_tracking
    `).get();
    stats.revenue = revenueStats;
    
    return stats;
  }
  
  // Revenue Tracking
  getRevenueTracking(page = 1, limit = 20, filters = {}) {
    let query = `
      SELECT rt.*, a.title as auction_title
      FROM revenue_tracking rt
      LEFT JOIN auctions a ON rt.auction_id = a.id
      WHERE 1=1
    `;
    const params = [];
    
    if (filters.status) {
      query += ` AND rt.status = ?`;
      params.push(filters.status);
    }
    
    if (filters.transaction_type) {
      query += ` AND rt.transaction_type = ?`;
      params.push(filters.transaction_type);
    }
    
    query += ` ORDER BY rt.created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, (page - 1) * limit);
    
    const stmt = this.securityLayer.prepare(query);
    const transactions = stmt.all(...params);
    
    // Get total count
    const countQuery = query.replace(/SELECT.*?FROM/, 'SELECT COUNT(*) FROM').replace(/ORDER BY.*$/, '');
    const countStmt = this.securityLayer.prepare(countQuery);
    const total = countStmt.get(...params.slice(0, -2)).count;
    
    return { transactions, total, page, totalPages: Math.ceil(total / limit) };
  }
  
  // Security Monitoring
  getSecurityAlerts(page = 1, limit = 20, filters = {}) {
    let query = `
      SELECT sa.*, u.username as user_username
      FROM security_alerts sa
      LEFT JOIN users u ON sa.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    
    if (filters.severity) {
      query += ` AND sa.severity = ?`;
      params.push(filters.severity);
    }
    
    if (filters.status) {
      query += ` AND sa.status = ?`;
      params.push(filters.status);
    }
    
    query += ` ORDER BY sa.created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, (page - 1) * limit);
    
    const stmt = this.securityLayer.prepare(query);
    const alerts = stmt.all(...params);
    
    // Get total count
    const countQuery = query.replace(/SELECT.*?FROM/, 'SELECT COUNT(*) FROM').replace(/ORDER BY.*$/, '');
    const countStmt = this.securityLayer.prepare(countQuery);
    const total = countStmt.get(...params.slice(0, -2)).count;
    
    return { alerts, total, page, totalPages: Math.ceil(total / limit) };
  }
  
  updateSecurityAlert(alertId, status, resolvedBy, notes = '') {
    const stmt = this.securityLayer.prepare(`
      UPDATE security_alerts 
      SET status = ?, resolved_at = CURRENT_TIMESTAMP, resolved_by = ?, details = ?
      WHERE id = ?
    `);
    
    const result = stmt.run(status, resolvedBy, notes, alertId);
    return result.changes > 0;
  }
  
  // Configuration Management
  getSystemConfig(category = null) {
    let query = 'SELECT * FROM system_config';
    const params = [];
    
    if (category) {
      query += ' WHERE category = ?';
      params.push(category);
    }
    
    query += ' ORDER BY category, key';
    
    const stmt = this.securityLayer.prepare(query);
    return stmt.all(...params);
  }
  
  updateSystemConfig(key, value, adminId, description = '') {
    const stmt = this.securityLayer.prepare(`
      UPDATE system_config 
      SET value = ?, updated_at = CURRENT_TIMESTAMP, description = ?
      WHERE key = ?
    `);
    
    const result = stmt.run(value, description, key);
    
    if (result.changes > 0) {
      this.logAuditAction(adminId, 'update_config', 'config', key, '', `${key}: ${value}`);
    }
    
    return result.changes > 0;
  }
  
  createSystemConfig(key, value, category, description, isPublic = false, adminId) {
    const stmt = this.securityLayer.prepare(`
      INSERT INTO system_config (id, key, value, category, description, is_public)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const configId = this.generateId();
    const result = stmt.run(configId, key, value, category, description, isPublic ? 1 : 0);
    
    if (result.changes > 0) {
      this.logAuditAction(adminId, 'create_config', 'config', configId, '', `${key}: ${value}`);
    }
    
    return result.changes > 0;
  }
  
  // Audit Logging
  logAuditAction(adminId, action, targetType, targetId, oldValues = '', newValues = '', ipAddress = '', userAgent = '') {
    const stmt = this.securityLayer.prepare(`
      INSERT INTO audit_logs (id, admin_id, action, target_type, target_id, old_values, new_values, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(this.generateId(), adminId, action, targetType, targetId, oldValues, newValues, ipAddress, userAgent);
  }
  
  getAuditLogs(page = 1, limit = 20, filters = {}) {
    let query = `
      SELECT al.*, u.username as admin_username
      FROM audit_logs al
      LEFT JOIN users u ON al.admin_id = u.id
      WHERE 1=1
    `;
    const params = [];
    
    if (filters.action) {
      query += ` AND al.action = ?`;
      params.push(filters.action);
    }
    
    if (filters.target_type) {
      query += ` AND al.target_type = ?`;
      params.push(filters.target_type);
    }
    
    if (filters.admin_id) {
      query += ` AND al.admin_id = ?`;
      params.push(filters.admin_id);
    }
    
    query += ` ORDER BY al.created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, (page - 1) * limit);
    
    const stmt = this.securityLayer.prepare(query);
    const logs = stmt.all(...params);
    
    // Get total count
    const countQuery = query.replace(/SELECT.*?FROM/, 'SELECT COUNT(*) FROM').replace(/ORDER BY.*$/, '');
    const countStmt = this.securityLayer.prepare(countQuery);
    const total = countStmt.get(...params.slice(0, -2)).count;
    
    return { logs, total, page, totalPages: Math.ceil(total / limit) };
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

  // Bid History Analytics Methods
  getUserBidHistory(userId, filters = {}) {
    const { limit = 50, offset = 0, status, dateFrom, dateTo, sortBy = 'timestamp', sortOrder = 'DESC' } = filters;
    
    let query = `
      SELECT b.*, a.title as auction_title, a.status as auction_status, a.end_time,
             CASE WHEN a.winner_id = ? AND a.winning_bid_id = b.id THEN 1 ELSE 0 END as is_winning_bid
      FROM bids b
      JOIN auctions a ON b.auction_id = a.id
      WHERE b.bidder_id = ?
    `;
    const params = [userId, userId];
    
    if (status) {
      query += ` AND a.status = ?`;
      params.push(status);
    }
    
    if (dateFrom) {
      query += ` AND b.timestamp >= ?`;
      params.push(dateFrom);
    }
    
    if (dateTo) {
      query += ` AND b.timestamp <= ?`;
      params.push(dateTo);
    }
    
    // Validate sort column
    const validSortColumns = ['timestamp', 'amount', 'auction_title', 'auction_status'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'timestamp';
    const sortDirection = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    
    query += ` ORDER BY b.${sortColumn} ${sortDirection} LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    
    const stmt = this.securityLayer.prepare(query);
    return stmt.all(...params);
  }
  
  getUserBidStatistics(userId) {
    const stmt = this.securityLayer.prepare(`
      SELECT 
        COUNT(*) as total_bids,
        COUNT(DISTINCT auction_id) as unique_auctions,
        SUM(amount) as total_spent,
        AVG(amount) as avg_bid_amount,
        MAX(amount) as highest_bid,
        MIN(amount) as lowest_bid,
        COUNT(CASE WHEN a.winner_id = ? AND a.winning_bid_id = b.id THEN 1 END) as won_auctions,
        COUNT(CASE WHEN a.status = 'closed' AND a.winner_id != ? AND a.winner_id IS NOT NULL THEN 1 END) as lost_auctions
      FROM bids b
      JOIN auctions a ON b.auction_id = a.id
      WHERE b.bidder_id = ?
    `);
    return stmt.get(userId, userId, userId);
  }
  
  getCompetitionAnalysis(userId, auctionId = null) {
    let query = `
      SELECT 
        u.username,
        COUNT(b.id) as bid_count,
        AVG(b.amount) as avg_bid,
        MAX(b.amount) as max_bid,
        SUM(b.amount) as total_spent,
        COUNT(CASE WHEN a.winner_id = u.id THEN 1 END) as auctions_won
      FROM users u
      JOIN bids b ON u.id = b.bidder_id
      JOIN auctions a ON b.auction_id = a.id
    `;
    const params = [];
    
    if (auctionId) {
      query += ` WHERE b.auction_id = ?`;
      params.push(auctionId);
    }
    
    query += ` GROUP BY u.id, u.username ORDER BY bid_count DESC LIMIT 20`;
    
    const stmt = this.securityLayer.prepare(query);
    return stmt.all(...params);
  }
  
  getSpendingAnalytics(userId, period = 'monthly') {
    let dateFormat;
    switch (period) {
      case 'daily':
        dateFormat = '%Y-%m-%d';
        break;
      case 'weekly':
        dateFormat = '%Y-%W';
        break;
      case 'monthly':
        dateFormat = '%Y-%m';
        break;
      default:
        dateFormat = '%Y-%m';
    }
    
    const stmt = this.securityLayer.prepare(`
      SELECT 
        strftime('${dateFormat}', b.timestamp) as period,
        COUNT(*) as bid_count,
        SUM(b.amount) as total_spent,
        AVG(b.amount) as avg_bid_amount,
        COUNT(CASE WHEN a.winner_id = ? THEN 1 END) as auctions_won
      FROM bids b
      JOIN auctions a ON b.auction_id = a.id
      WHERE b.bidder_id = ?
        AND b.timestamp >= date('now', '-12 months')
      GROUP BY strftime('${dateFormat}', b.timestamp)
      ORDER BY period DESC
    `);
    return stmt.all(userId, userId);
  }
  
  getTimelineData(userId, limit = 100) {
    const stmt = this.securityLayer.prepare(`
      SELECT 
        b.timestamp,
        b.amount,
        b.id as bid_id,
        a.title as auction_title,
        a.status as auction_status,
        a.end_time,
        CASE WHEN a.winner_id = ? AND a.winning_bid_id = b.id THEN 'won' 
             WHEN a.status = 'closed' AND a.winner_id IS NOT NULL THEN 'lost'
             ELSE 'pending' END as result
      FROM bids b
      JOIN auctions a ON b.auction_id = a.id
      WHERE b.bidder_id = ?
      ORDER BY b.timestamp DESC
      LIMIT ?
    `);
    return stmt.all(userId, userId, limit);
  }
  
  exportBidHistory(userId, format = 'json', filters = {}) {
    const bids = this.getUserBidHistory(userId, { ...filters, limit: 10000 });
    
    switch (format.toLowerCase()) {
      case 'csv':
        return this.convertToCSV(bids);
      case 'json':
      default:
        return JSON.stringify(bids, null, 2);
    }
  }
  
  convertToCSV(data) {
    if (!data || data.length === 0) return '';
    
    const headers = Object.keys(data[0]);
    const csvHeaders = headers.join(',');
    
    const csvRows = data.map(row => {
      return headers.map(header => {
        const value = row[header];
        return typeof value === 'string' && value.includes(',') 
          ? `"${value.replace(/"/g, '""')}"` 
          : value;
      }).join(',');
    });
    
    return [csvHeaders, ...csvRows].join('\n');
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

  // ==================== BOOKMARK MANAGEMENT METHODS ====================

  // Bookmark Folder Operations
  createBookmarkFolder(folder) {
    const validation = this.securityLayer.validateInputs({
      id: folder.id,
      name: folder.name,
      description: folder.description,
      userId: folder.userId,
      parentFolderId: folder.parentFolderId,
      color: folder.color,
      icon: folder.icon
    });
    
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const stmt = this.securityLayer.prepare(`
      INSERT INTO bookmark_folders (id, name, description, user_id, parent_folder_id, color, icon, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    return stmt.run(
      validation.sanitized.id,
      validation.sanitized.name,
      validation.sanitized.description || null,
      validation.sanitized.userId,
      validation.sanitized.parentFolderId || null,
      validation.sanitized.color || '#3b82f6',
      validation.sanitized.icon || 'folder',
      folder.sortOrder || 0
    );
  }

  getBookmarkFolders(userId, parentFolderId = null) {
    const validation = this.securityLayer.validateInputs({ userId, parentFolderId });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    let query = 'SELECT * FROM bookmark_folders WHERE user_id = ?';
    const params = [validation.sanitized.userId];
    
    if (parentFolderId === null) {
      query += ' AND parent_folder_id IS NULL';
    } else {
      query += ' AND parent_folder_id = ?';
      params.push(validation.sanitized.parentFolderId);
    }
    
    query += ' ORDER BY sort_order, name';
    
    const stmt = this.securityLayer.prepare(query);
    return stmt.all(...params);
  }

  updateBookmarkFolder(folderId, updates, userId) {
    const validation = this.securityLayer.validateInputs({ folderId, userId });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const setClause = [];
    const params = [];
    
    if (updates.name !== undefined) {
      setClause.push('name = ?');
      params.push(updates.name);
    }
    if (updates.description !== undefined) {
      setClause.push('description = ?');
      params.push(updates.description);
    }
    if (updates.color !== undefined) {
      setClause.push('color = ?');
      params.push(updates.color);
    }
    if (updates.icon !== undefined) {
      setClause.push('icon = ?');
      params.push(updates.icon);
    }
    if (updates.parentFolderId !== undefined) {
      setClause.push('parent_folder_id = ?');
      params.push(updates.parentFolderId);
    }
    if (updates.sortOrder !== undefined) {
      setClause.push('sort_order = ?');
      params.push(updates.sortOrder);
    }
    
    setClause.push('updated_at = CURRENT_TIMESTAMP');
    params.push(validation.sanitized.folderId, validation.sanitized.userId);
    
    const stmt = this.securityLayer.prepare(`
      UPDATE bookmark_folders 
      SET ${setClause.join(', ')}
      WHERE id = ? AND user_id = ?
    `);
    
    return stmt.run(...params);
  }

  deleteBookmarkFolder(folderId, userId) {
    const validation = this.securityLayer.validateInputs({ folderId, userId });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    // First, move bookmarks in this folder to root (set folder_id to null)
    const moveBookmarksStmt = this.securityLayer.prepare(`
      UPDATE bookmarks 
      SET folder_id = NULL 
      WHERE folder_id = ? AND user_id = ?
    `);
    moveBookmarksStmt.run(validation.sanitized.folderId, validation.sanitized.userId);
    
    // Then delete the folder
    const stmt = this.securityLayer.prepare(`
      DELETE FROM bookmark_folders 
      WHERE id = ? AND user_id = ?
    `);
    
    return stmt.run(validation.sanitized.folderId, validation.sanitized.userId);
  }

  // Bookmark Tag Operations
  createBookmarkTag(tag) {
    const validation = this.securityLayer.validateInputs({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      userId: tag.userId
    });
    
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const stmt = this.securityLayer.prepare(`
      INSERT OR IGNORE INTO bookmark_tags (id, name, color, user_id)
      VALUES (?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      validation.sanitized.id,
      validation.sanitized.name,
      validation.sanitized.color || '#10b981',
      validation.sanitized.userId
    );
    
    // If tag was created, increment usage count
    if (result.changes > 0) {
      this.incrementTagUsage(validation.sanitized.name, validation.sanitized.userId);
    }
    
    return result;
  }

  getBookmarkTags(userId) {
    const validation = this.securityLayer.validateInput(userId);
    if (!validation.valid) {
      throw new Error('Invalid user ID format');
    }
    
    const stmt = this.securityLayer.prepare(`
      SELECT * FROM bookmark_tags 
      WHERE user_id = ? 
      ORDER BY usage_count DESC, name
    `);
    
    return stmt.all(validation.sanitized.userId);
  }

  incrementTagUsage(tagName, userId) {
    const validation = this.securityLayer.validateInputs({ tagName, userId });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const stmt = this.securityLayer.prepare(`
      UPDATE bookmark_tags 
      SET usage_count = usage_count + 1 
      WHERE name = ? AND user_id = ?
    `);
    
    return stmt.run(validation.sanitized.tagName, validation.sanitized.userId);
  }

  decrementTagUsage(tagName, userId) {
    const validation = this.securityLayer.validateInputs({ tagName, userId });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const stmt = this.securityLayer.prepare(`
      UPDATE bookmark_tags 
      SET usage_count = usage_count - 1 
      WHERE name = ? AND user_id = ? AND usage_count > 0
    `);
    
    return stmt.run(validation.sanitized.tagName, validation.sanitized.userId);
  }

  deleteBookmarkTag(tagId, userId) {
    const validation = this.securityLayer.validateInputs({ tagId, userId });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    // Remove tag relations first
    const deleteRelationsStmt = this.securityLayer.prepare(`
      DELETE FROM bookmark_tag_relations 
      WHERE tag_id = ?
    `);
    deleteRelationsStmt.run(validation.sanitized.tagId);
    
    // Then delete the tag
    const stmt = this.securityLayer.prepare(`
      DELETE FROM bookmark_tags 
      WHERE id = ? AND user_id = ?
    `);
    
    return stmt.run(validation.sanitized.tagId, validation.sanitized.userId);
  }

  // Bookmark Operations
  createBookmark(bookmark) {
    const validation = this.securityLayer.validateInputs({
      id: bookmark.id,
      title: bookmark.title,
      description: bookmark.description,
      url: bookmark.url,
      type: bookmark.type,
      targetId: bookmark.targetId,
      userId: bookmark.userId,
      folderId: bookmark.folderId,
      favicon: bookmark.favicon,
      thumbnail: bookmark.thumbnail,
      isFavorite: bookmark.isFavorite,
      isPrivate: bookmark.isPrivate,
      sortOrder: bookmark.sortOrder,
      metadata: bookmark.metadata
    });
    
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const stmt = this.securityLayer.prepare(`
      INSERT INTO bookmarks (
        id, title, description, url, type, target_id, user_id, folder_id, 
        favicon, thumbnail, is_favorite, is_private, sort_order, metadata
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      validation.sanitized.id,
      validation.sanitized.title,
      validation.sanitized.description || null,
      validation.sanitized.url,
      validation.sanitized.type,
      validation.sanitized.targetId || null,
      validation.sanitized.userId,
      validation.sanitized.folderId || null,
      validation.sanitized.favicon || null,
      validation.sanitized.thumbnail || null,
      validation.sanitized.isFavorite ? 1 : 0,
      validation.sanitized.isPrivate ? 1 : 0,
      validation.sanitized.sortOrder || 0,
      validation.sanitized.metadata ? JSON.stringify(validation.sanitized.metadata) : null
    );
    
    // Add tag relations if provided
    if (bookmark.tags && bookmark.tags.length > 0) {
      bookmark.tags.forEach(tagId => {
        this.addTagToBookmark(validation.sanitized.id, tagId);
        
        // Increment tag usage
        const tag = this.getTagById(tagId);
        if (tag) {
          this.incrementTagUsage(tag.name, validation.sanitized.userId);
        }
      });
    }
    
    return result;
  }

  getBookmarks(userId, options = {}) {
    const validation = this.securityLayer.validateInputs({ userId });
    if (!validation.valid) {
      throw new Error('Invalid user ID format');
    }
    
    let query = `
      SELECT b.*, 
             GROUP_CONCAT(t.name) as tags,
             GROUP_CONCAT(t.color) as tag_colors,
             f.name as folder_name,
             f.color as folder_color
      FROM bookmarks b
      LEFT JOIN bookmark_tag_relations btr ON b.id = btr.bookmark_id
      LEFT JOIN bookmark_tags t ON btr.tag_id = t.id
      LEFT JOIN bookmark_folders f ON b.folder_id = f.id
      WHERE b.user_id = ?
    `;
    
    const params = [validation.sanitized.userId];
    
    // Apply filters
    if (options.folderId !== undefined) {
      if (options.folderId === null) {
        query += ' AND b.folder_id IS NULL';
      } else {
        query += ' AND b.folder_id = ?';
        params.push(options.folderId);
      }
    }
    
    if (options.type) {
      query += ' AND b.type = ?';
      params.push(options.type);
    }
    
    if (options.isFavorite !== undefined) {
      query += ' AND b.is_favorite = ?';
      params.push(options.isFavorite ? 1 : 0);
    }
    
    if (options.search) {
      query += ' AND (b.title LIKE ? OR b.description LIKE ? OR b.url LIKE ?)';
      const searchTerm = `%${options.search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }
    
    if (options.tags && options.tags.length > 0) {
      query += ` AND b.id IN (
        SELECT bookmark_id FROM bookmark_tag_relations 
        WHERE tag_id IN (${options.tags.map(() => '?').join(',')})
        GROUP BY bookmark_id
        HAVING COUNT(DISTINCT tag_id) = ?
      )`;
      params.push(...options.tags, options.tags.length);
    }
    
    query += ' GROUP BY b.id ORDER BY b.sort_order, b.created_at DESC';
    
    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }
    
    const stmt = this.securityLayer.prepare(query);
    const bookmarks = stmt.all(...params);
    
    // Parse tags and metadata
    return bookmarks.map(bookmark => ({
      ...bookmark,
      tags: bookmark.tags ? bookmark.tags.split(',') : [],
      tag_colors: bookmark.tag_colors ? bookmark.tag_colors.split(',') : [],
      metadata: bookmark.metadata ? JSON.parse(bookmark.metadata) : null,
      is_favorite: Boolean(bookmark.is_favorite),
      is_private: Boolean(bookmark.is_private)
    }));
  }

  getBookmarkById(bookmarkId, userId) {
    const validation = this.securityLayer.validateInputs({ bookmarkId, userId });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const stmt = this.securityLayer.prepare(`
      SELECT b.*, 
             GROUP_CONCAT(t.name) as tags,
             GROUP_CONCAT(t.color) as tag_colors,
             f.name as folder_name,
             f.color as folder_color
      FROM bookmarks b
      LEFT JOIN bookmark_tag_relations btr ON b.id = btr.bookmark_id
      LEFT JOIN bookmark_tags t ON btr.tag_id = t.id
      LEFT JOIN bookmark_folders f ON b.folder_id = f.id
      WHERE b.id = ? AND b.user_id = ?
      GROUP BY b.id
    `);
    
    const bookmark = stmt.get(validation.sanitized.bookmarkId, validation.sanitized.userId);
    
    if (bookmark) {
      return {
        ...bookmark,
        tags: bookmark.tags ? bookmark.tags.split(',') : [],
        tag_colors: bookmark.tag_colors ? bookmark.tag_colors.split(',') : [],
        metadata: bookmark.metadata ? JSON.parse(bookmark.metadata) : null,
        is_favorite: Boolean(bookmark.is_favorite),
        is_private: Boolean(bookmark.is_private)
      };
    }
    
    return null;
  }

  updateBookmark(bookmarkId, updates, userId) {
    const validation = this.securityLayer.validateInputs({ bookmarkId, userId });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const setClause = [];
    const params = [];
    
    if (updates.title !== undefined) {
      setClause.push('title = ?');
      params.push(updates.title);
    }
    if (updates.description !== undefined) {
      setClause.push('description = ?');
      params.push(updates.description);
    }
    if (updates.url !== undefined) {
      setClause.push('url = ?');
      params.push(updates.url);
    }
    if (updates.folderId !== undefined) {
      setClause.push('folder_id = ?');
      params.push(updates.folderId);
    }
    if (updates.favicon !== undefined) {
      setClause.push('favicon = ?');
      params.push(updates.favicon);
    }
    if (updates.thumbnail !== undefined) {
      setClause.push('thumbnail = ?');
      params.push(updates.thumbnail);
    }
    if (updates.isFavorite !== undefined) {
      setClause.push('is_favorite = ?');
      params.push(updates.isFavorite ? 1 : 0);
    }
    if (updates.isPrivate !== undefined) {
      setClause.push('is_private = ?');
      params.push(updates.isPrivate ? 1 : 0);
    }
    if (updates.sortOrder !== undefined) {
      setClause.push('sort_order = ?');
      params.push(updates.sortOrder);
    }
    if (updates.metadata !== undefined) {
      setClause.push('metadata = ?');
      params.push(JSON.stringify(updates.metadata));
    }
    
    setClause.push('updated_at = CURRENT_TIMESTAMP');
    params.push(validation.sanitized.bookmarkId, validation.sanitized.userId);
    
    const stmt = this.securityLayer.prepare(`
      UPDATE bookmarks 
      SET ${setClause.join(', ')}
      WHERE id = ? AND user_id = ?
    `);
    
    const result = stmt.run(...params);
    
    // Update tag relations if provided
    if (updates.tags !== undefined) {
      this.updateBookmarkTags(validation.sanitized.bookmarkId, updates.tags, validation.sanitized.userId);
    }
    
    return result;
  }

  deleteBookmark(bookmarkId, userId) {
    const validation = this.securityLayer.validateInputs({ bookmarkId, userId });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    // Get bookmark tags before deletion to decrement usage
    const bookmark = this.getBookmarkById(validation.sanitized.bookmarkId, validation.sanitized.userId);
    if (bookmark && bookmark.tags) {
      bookmark.tags.forEach(tagName => {
        this.decrementTagUsage(tagName, validation.sanitized.userId);
      });
    }
    
    // Delete tag relations
    const deleteRelationsStmt = this.securityLayer.prepare(`
      DELETE FROM bookmark_tag_relations 
      WHERE bookmark_id = ?
    `);
    deleteRelationsStmt.run(validation.sanitized.bookmarkId);
    
    // Delete the bookmark
    const stmt = this.securityLayer.prepare(`
      DELETE FROM bookmarks 
      WHERE id = ? AND user_id = ?
    `);
    
    return stmt.run(validation.sanitized.bookmarkId, validation.sanitized.userId);
  }

  // Tag Relations Management
  addTagToBookmark(bookmarkId, tagId) {
    const validation = this.securityLayer.validateInputs({ bookmarkId, tagId });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const stmt = this.securityLayer.prepare(`
      INSERT OR IGNORE INTO bookmark_tag_relations (bookmark_id, tag_id)
      VALUES (?, ?)
    `);
    
    return stmt.run(validation.sanitized.bookmarkId, validation.sanitized.tagId);
  }

  removeTagFromBookmark(bookmarkId, tagId) {
    const validation = this.securityLayer.validateInputs({ bookmarkId, tagId });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const stmt = this.securityLayer.prepare(`
      DELETE FROM bookmark_tag_relations 
      WHERE bookmark_id = ? AND tag_id = ?
    `);
    
    return stmt.run(validation.sanitized.bookmarkId, validation.sanitized.tagId);
  }

  updateBookmarkTags(bookmarkId, tagNames, userId) {
    const validation = this.securityLayer.validateInputs({ bookmarkId, userId });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    // Get current tags to decrement usage
    const currentBookmark = this.getBookmarkById(validation.sanitized.bookmarkId, validation.sanitized.userId);
    if (currentBookmark && currentBookmark.tags) {
      currentBookmark.tags.forEach(tagName => {
        this.decrementTagUsage(tagName, validation.sanitized.userId);
      });
    }
    
    // Remove all existing tag relations
    const deleteRelationsStmt = this.securityLayer.prepare(`
      DELETE FROM bookmark_tag_relations 
      WHERE bookmark_id = ?
    `);
    deleteRelationsStmt.run(validation.sanitized.bookmarkId);
    
    // Add new tag relations
    tagNames.forEach(tagName => {
      // Get or create tag
      let tag = this.getTagByName(tagName, validation.sanitized.userId);
      if (!tag) {
        const tagId = this.generateId();
        this.createBookmarkTag({
          id: tagId,
          name: tagName,
          userId: validation.sanitized.userId
        });
        tag = this.getTagByName(tagName, validation.sanitized.userId);
      }
      
      if (tag) {
        this.addTagToBookmark(validation.sanitized.bookmarkId, tag.id);
        this.incrementTagUsage(tagName, validation.sanitized.userId);
      }
    });
  }

  // Helper Methods
  getTagById(tagId) {
    const validation = this.securityLayer.validateInput(tagId);
    if (!validation.valid) {
      return null;
    }
    
    const stmt = this.securityLayer.prepare('SELECT * FROM bookmark_tags WHERE id = ?');
    return stmt.get(validation.sanitized.tagId);
  }

  getTagByName(tagName, userId) {
    const validation = this.securityLayer.validateInputs({ tagName, userId });
    if (!validation.valid) {
      return null;
    }
    
    const stmt = this.securityLayer.prepare('SELECT * FROM bookmark_tags WHERE name = ? AND user_id = ?');
    return stmt.get(validation.sanitized.tagName, validation.sanitized.userId);
  }

  // Search functionality
  searchBookmarks(userId, query, options = {}) {
    return this.getBookmarks(userId, { ...options, search: query });
  }

  // Import/Export functionality
  exportBookmarks(userId, format = 'json') {
    const bookmarks = this.getBookmarks(userId);
    const folders = this.getBookmarkFolders(userId);
    const tags = this.getBookmarkTags(userId);
    
    const exportData = {
      bookmarks,
      folders,
      tags,
      exported_at: new Date().toISOString(),
      version: '1.0'
    };
    
    if (format === 'json') {
      return JSON.stringify(exportData, null, 2);
    } else if (format === 'csv') {
      // Convert to CSV format
      const csvHeaders = ['title', 'description', 'url', 'type', 'tags', 'folder_name', 'is_favorite', 'created_at'];
      const csvRows = bookmarks.map(bookmark => [
        bookmark.title,
        bookmark.description || '',
        bookmark.url,
        bookmark.type,
        bookmark.tags.join(';'),
        bookmark.folder_name || '',
        bookmark.is_favorite,
        bookmark.created_at
      ]);
      
      return [csvHeaders, ...csvRows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    }
    
    throw new Error('Unsupported export format');
  }

  importBookmarks(userId, importData, format = 'json') {
    let data;
    
    if (format === 'json') {
      data = typeof importData === 'string' ? JSON.parse(importData) : importData;
    } else {
      throw new Error('Unsupported import format');
    }
    
    const results = {
      imported: 0,
      skipped: 0,
      errors: []
    };
    
    // Import folders first
    if (data.folders && Array.isArray(data.folders)) {
      data.folders.forEach(folder => {
        try {
          // Check if folder already exists
          const existing = this.getBookmarkFolders(userId).find(f => f.name === folder.name);
          if (!existing) {
            this.createBookmarkFolder({
              id: this.generateId(),
              name: folder.name,
              description: folder.description,
              userId: userId,
              color: folder.color,
              icon: folder.icon,
              sortOrder: folder.sortOrder
            });
          }
        } catch (error) {
          results.errors.push(`Error importing folder ${folder.name}: ${error.message}`);
        }
      });
    }
    
    // Import tags
    if (data.tags && Array.isArray(data.tags)) {
      data.tags.forEach(tag => {
        try {
          const existing = this.getTagByName(tag.name, userId);
          if (!existing) {
            this.createBookmarkTag({
              id: this.generateId(),
              name: tag.name,
              color: tag.color,
              userId: userId
            });
          }
        } catch (error) {
          results.errors.push(`Error importing tag ${tag.name}: ${error.message}`);
        }
      });
    }
    
    // Import bookmarks
    if (data.bookmarks && Array.isArray(data.bookmarks)) {
      data.bookmarks.forEach(bookmark => {
        try {
          // Check if bookmark already exists (by URL)
          const existing = this.getBookmarks(userId).find(b => b.url === bookmark.url);
          if (!existing) {
            // Find folder ID if folder name is provided
            let folderId = null;
            if (bookmark.folder_name) {
              const folder = this.getBookmarkFolders(userId).find(f => f.name === bookmark.folder_name);
              if (folder) {
                folderId = folder.id;
              }
            }
            
            this.createBookmark({
              id: this.generateId(),
              title: bookmark.title,
              description: bookmark.description,
              url: bookmark.url,
              type: bookmark.type || 'custom',
              targetId: bookmark.target_id,
              userId: userId,
              folderId: folderId,
              favicon: bookmark.favicon,
              thumbnail: bookmark.thumbnail,
              isFavorite: bookmark.is_favorite,
              isPrivate: bookmark.is_private,
              sortOrder: bookmark.sort_order,
              metadata: bookmark.metadata,
              tags: bookmark.tags || []
            });
            
            results.imported++;
          } else {
            results.skipped++;
          }
        } catch (error) {
          results.errors.push(`Error importing bookmark ${bookmark.title}: ${error.message}`);
        }
      });
    }
    
    return results;
  }

  // Sync functionality
  createSyncRecord(syncRecord) {
    const validation = this.securityLayer.validateInputs({
      id: syncRecord.id,
      userId: syncRecord.userId,
      deviceId: syncRecord.deviceId,
      bookmarkId: syncRecord.bookmarkId,
      action: syncRecord.action,
      syncData: syncRecord.syncData
    });
    
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const stmt = this.securityLayer.prepare(`
      INSERT INTO bookmark_sync (id, user_id, device_id, bookmark_id, action, sync_data)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    return stmt.run(
      validation.sanitized.id,
      validation.sanitized.userId,
      validation.sanitized.deviceId,
      validation.sanitized.bookmarkId,
      validation.sanitized.action,
      validation.sanitized.syncData ? JSON.stringify(validation.sanitized.syncData) : null
    );
  }

  getPendingSyncRecords(userId, deviceId = null) {
    const validation = this.securityLayer.validateInputs({ userId, deviceId });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    let query = 'SELECT * FROM bookmark_sync WHERE user_id = ? AND synced = 0';
    const params = [validation.sanitized.userId];
    
    if (deviceId) {
      query += ' AND device_id != ?';
      params.push(validation.sanitized.deviceId);
    }
    
    query += ' ORDER BY timestamp ASC';
    
    const stmt = this.securityLayer.prepare(query);
    const records = stmt.all(...params);
    
    return records.map(record => ({
      ...record,
      sync_data: record.sync_data ? JSON.parse(record.sync_data) : null
    }));
  }

  markSyncRecordsAsSynced(recordIds) {
    if (!recordIds || recordIds.length === 0) {
      return;
    }
    
    const placeholders = recordIds.map(() => '?').join(',');
    const stmt = this.securityLayer.prepare(`
      UPDATE bookmark_sync 
      SET synced = 1 
      WHERE id IN (${placeholders})
    `);
    
    return stmt.run(...recordIds);
  }

  // ==================== WATCHLIST OPERATIONS ====================

  addToWatchlist(watchlistItem) {
    const validation = this.securityLayer.validateInputs({
      id: watchlistItem.id,
      userId: watchlistItem.userId,
      auctionId: watchlistItem.auctionId,
      notificationPreferences: watchlistItem.notificationPreferences,
      priceThreshold: watchlistItem.priceThreshold,
      notes: watchlistItem.notes
    });
    
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    try {
      const stmt = this.securityLayer.prepare(`
        INSERT INTO watchlist (id, user_id, auction_id, notification_preferences, price_threshold, notes)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      const result = stmt.run(
        validation.sanitized.id,
        validation.sanitized.userId,
        validation.sanitized.auctionId,
        JSON.stringify(validation.sanitized.notificationPreferences || {}),
        validation.sanitized.priceThreshold || null,
        validation.sanitized.notes || null
      );
      
      // Log activity
      this.logWatchlistActivity(validation.sanitized.id, 'added', {
        auctionId: validation.sanitized.auctionId
      });
      
      return result;
    } catch (error) {
      if (error.message.includes('UNIQUE constraint failed')) {
        throw new Error('Auction is already in watchlist');
      }
      throw error;
    }
  }

  removeFromWatchlist(userId, auctionId) {
    const validation = this.securityLayer.validateInputs({ userId, auctionId });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    // Get watchlist item ID before deletion for activity logging
    const watchlistItem = this.getWatchlistItem(userId, auctionId);
    
    const stmt = this.securityLayer.prepare(`
      DELETE FROM watchlist 
      WHERE user_id = ? AND auction_id = ?
    `);
    
    const result = stmt.run(validation.sanitized.userId, validation.sanitized.auctionId);
    
    if (result.changes > 0 && watchlistItem) {
      // Log activity
      this.logWatchlistActivity(watchlistItem.id, 'removed', {
        auctionId: validation.sanitized.auctionId
      });
    }
    
    return result;
  }

  getWatchlist(userId, options = {}) {
    const validation = this.securityLayer.validateInputs({ userId });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    let query = `
      SELECT w.*, a.title, a.description, a.starting_bid, a.current_highest_bid, 
             a.end_time, a.status, a.creator_id, u.username as creator_username
      FROM watchlist w
      JOIN auctions a ON w.auction_id = a.id
      JOIN users u ON a.creator_id = u.id
      WHERE w.user_id = ?
    `;
    
    const params = [validation.sanitized.userId];
    
    // Add filtering options
    if (options.status) {
      query += ' AND a.status = ?';
      params.push(options.status);
    }
    
    if (options.sortBy) {
      const sortField = options.sortBy === 'end_time' ? 'a.end_time' : 
                       options.sortBy === 'current_bid' ? 'a.current_highest_bid' : 
                       'w.created_at';
      const sortOrder = options.sortOrder === 'asc' ? 'ASC' : 'DESC';
      query += ` ORDER BY ${sortField} ${sortOrder}`;
    } else {
      query += ' ORDER BY w.created_at DESC';
    }
    
    // Add pagination
    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
      
      if (options.offset) {
        query += ' OFFSET ?';
        params.push(options.offset);
      }
    }
    
    const stmt = this.securityLayer.prepare(query);
    const items = stmt.all(...params);
    
    return items.map(item => ({
      ...item,
      notification_preferences: JSON.parse(item.notification_preferences || '{}')
    }));
  }

  getWatchlistItem(userId, auctionId) {
    const validation = this.securityLayer.validateInputs({ userId, auctionId });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const stmt = this.securityLayer.prepare(`
      SELECT * FROM watchlist 
      WHERE user_id = ? AND auction_id = ?
    `);
    
    const item = stmt.get(validation.sanitized.userId, validation.sanitized.auctionId);
    
    if (item) {
      item.notification_preferences = JSON.parse(item.notification_preferences || '{}');
    }
    
    return item;
  }

  updateWatchlistItem(userId, auctionId, updates) {
    const validation = this.securityLayer.validateInputs({ userId, auctionId });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const allowedFields = ['notification_preferences', 'price_threshold', 'notes'];
    const updateFields = [];
    const updateValues = [];
    
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        updateFields.push(`${key} = ?`);
        updateValues.push(key === 'notification_preferences' ? JSON.stringify(value) : value);
      }
    }
    
    if (updateFields.length === 0) {
      throw new Error('No valid fields to update');
    }
    
    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    updateValues.push(validation.sanitized.userId, validation.sanitized.auctionId);
    
    const stmt = this.securityLayer.prepare(`
      UPDATE watchlist 
      SET ${updateFields.join(', ')}
      WHERE user_id = ? AND auction_id = ?
    `);
    
    return stmt.run(...updateValues);
  }

  bulkAddToWatchlist(userId, auctionIds) {
    const validation = this.securityLayer.validateInputs({ userId });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const results = { added: 0, skipped: 0, errors: [] };
    
    for (const auctionId of auctionIds) {
      try {
        const auctionValidation = this.securityLayer.validateInput(auctionId);
        if (!auctionValidation.valid) {
          results.errors.push(`Invalid auction ID: ${auctionId}`);
          continue;
        }
        
        // Check if auction exists
        const auction = this.getAuction(auctionValidation.sanitized);
        if (!auction) {
          results.errors.push(`Auction not found: ${auctionId}`);
          continue;
        }
        
        // Check if already in watchlist
        const existing = this.getWatchlistItem(validation.sanitized.userId, auctionValidation.sanitized);
        if (existing) {
          results.skipped++;
          continue;
        }
        
        const watchlistItem = {
          id: crypto.randomUUID(),
          userId: validation.sanitized.userId,
          auctionId: auctionValidation.sanitized
        };
        
        this.addToWatchlist(watchlistItem);
        results.added++;
      } catch (error) {
        results.errors.push(`Error adding auction ${auctionId}: ${error.message}`);
      }
    }
    
    return results;
  }

  bulkRemoveFromWatchlist(userId, auctionIds) {
    const validation = this.securityLayer.validateInputs({ userId });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const results = { removed: 0, errors: [] };
    
    for (const auctionId of auctionIds) {
      try {
        const auctionValidation = this.securityLayer.validateInput(auctionId);
        if (!auctionValidation.valid) {
          results.errors.push(`Invalid auction ID: ${auctionId}`);
          continue;
        }
        
        const result = this.removeFromWatchlist(validation.sanitized.userId, auctionValidation.sanitized);
        if (result.changes > 0) {
          results.removed++;
        }
      } catch (error) {
        results.errors.push(`Error removing auction ${auctionId}: ${error.message}`);
      }
    }
    
    return results;
  }

  createWatchlistShare(userId, shareOptions = {}) {
    const validation = this.securityLayer.validateInputs({ userId });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const shareToken = crypto.randomUUID();
    const shareUrl = `${shareOptions.baseUrl || 'https://localhost:3000'}/watchlist/shared/${shareToken}`;
    
    const stmt = this.securityLayer.prepare(`
      INSERT INTO watchlist_shares (id, watchlist_owner_id, share_token, share_url, is_public, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const shareId = crypto.randomUUID();
    const expiresAt = shareOptions.expiresInHours ? 
      new Date(Date.now() + shareOptions.expiresInHours * 60 * 60 * 1000).toISOString() : 
      null;
    
    const result = stmt.run(
      shareId,
      validation.sanitized.userId,
      shareToken,
      shareUrl,
      shareOptions.isPublic ? 1 : 0,
      expiresAt
    );
    
    return {
      id: shareId,
      shareToken,
      shareUrl,
      expiresAt
    };
  }

  getSharedWatchlist(shareToken) {
    const validation = this.securityLayer.validateInput(shareToken);
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    // Check if share exists and is valid
    const shareStmt = this.securityLayer.prepare(`
      SELECT * FROM watchlist_shares 
      WHERE share_token = ? AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    `);
    const share = shareStmt.get(validation.sanitized);
    
    if (!share) {
      throw new Error('Shared watchlist not found or expired');
    }
    
    // Increment view count
    const incrementStmt = this.securityLayer.prepare(`
      UPDATE watchlist_shares 
      SET view_count = view_count + 1 
      WHERE share_token = ?
    `);
    incrementStmt.run(validation.sanitized);
    
    // Get watchlist items
    const watchlistStmt = this.securityLayer.prepare(`
      SELECT w.*, a.title, a.description, a.starting_bid, a.current_highest_bid, 
             a.end_time, a.status, a.creator_id, u.username as creator_username
      FROM watchlist w
      JOIN auctions a ON w.auction_id = a.id
      JOIN users u ON a.creator_id = u.id
      WHERE w.user_id = ?
      ORDER BY w.created_at DESC
    `);
    
    const items = watchlistStmt.all(share.watchlist_owner_id);
    
    return {
      shareInfo: {
        ...share,
        is_public: Boolean(share.is_public)
      },
      items: items.map(item => ({
        ...item,
        notification_preferences: JSON.parse(item.notification_preferences || '{}')
      }))
    };
  }

  createWatchlistNotification(watchlistId, notificationType, title, message) {
    const validation = this.securityLayer.validateInputs({
      watchlistId,
      notificationType,
      title,
      message
    });
    
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const stmt = this.securityLayer.prepare(`
      INSERT INTO watchlist_notifications (id, watchlist_id, notification_type, title, message)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    return stmt.run(
      crypto.randomUUID(),
      validation.sanitized.watchlistId,
      validation.sanitized.notificationType,
      validation.sanitized.title,
      validation.sanitized.message
    );
  }

  getWatchlistNotifications(userId, options = {}) {
    const validation = this.securityLayer.validateInputs({ userId });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    let query = `
      SELECT wn.*, w.user_id, w.auction_id, a.title as auction_title
      FROM watchlist_notifications wn
      JOIN watchlist w ON wn.watchlist_id = w.id
      JOIN auctions a ON w.auction_id = a.id
      WHERE w.user_id = ?
    `;
    
    const params = [validation.sanitized.userId];
    
    if (options.unreadOnly) {
      query += ' AND wn.is_read = 0';
    }
    
    if (options.type) {
      query += ' AND wn.notification_type = ?';
      params.push(options.type);
    }
    
    query += ' ORDER BY wn.created_at DESC';
    
    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }
    
    const stmt = this.securityLayer.prepare(query);
    return stmt.all(...params);
  }

  markNotificationAsRead(notificationId) {
    const validation = this.securityLayer.validateInput(notificationId);
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const stmt = this.securityLayer.prepare(`
      UPDATE watchlist_notifications 
      SET is_read = 1 
      WHERE id = ?
    `);
    
    return stmt.run(validation.sanitized);
  }

  logWatchlistActivity(watchlistId, activityType, details = null) {
    const validation = this.securityLayer.validateInputs({
      watchlistId,
      activityType
    });
    
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    const stmt = this.securityLayer.prepare(`
      INSERT INTO watchlist_activity (id, watchlist_id, activity_type, details)
      VALUES (?, ?, ?, ?)
    `);
    
    return stmt.run(
      crypto.randomUUID(),
      validation.sanitized.watchlistId,
      validation.sanitized.activityType,
      details ? JSON.stringify(details) : null
    );
  }

  getWatchlistActivity(userId, options = {}) {
    const validation = this.securityLayer.validateInputs({ userId });
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }
    
    let query = `
      SELECT wa.*, w.auction_id, a.title as auction_title
      FROM watchlist_activity wa
      JOIN watchlist w ON wa.watchlist_id = w.id
      JOIN auctions a ON w.auction_id = a.id
      WHERE w.user_id = ?
    `;
    
    const params = [validation.sanitized.userId];
    
    if (options.activityType) {
      query += ' AND wa.activity_type = ?';
      params.push(options.activityType);
    }
    
    query += ' ORDER BY wa.created_at DESC';
    
    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }
    
    const stmt = this.securityLayer.prepare(query);
    const activities = stmt.all(...params);
    
    return activities.map(activity => ({
      ...activity,
      details: activity.details ? JSON.parse(activity.details) : null
    }));
  }

  // Helper methods for notifications
  async checkWatchlistAlerts() {
    // Get all active watchlist items with notifications enabled
    const stmt = this.securityLayer.prepare(`
      SELECT w.*, a.title, a.current_highest_bid, a.end_time, a.status
      FROM watchlist w
      JOIN auctions a ON w.auction_id = a.id
      WHERE a.status = 'active'
    `);
    
    const watchlistItems = stmt.all();
    const alerts = [];
    
    for (const item of watchlistItems) {
      const preferences = JSON.parse(item.notification_preferences || '{}');
      
      // Check ending soon alerts (within 1 hour)
      if (preferences.ending_soon) {
        const endTime = new Date(item.end_time);
        const now = new Date();
        const timeDiff = endTime - now;
        const hoursDiff = timeDiff / (1000 * 60 * 60);
        
        if (hoursDiff <= 1 && hoursDiff > 0) {
          alerts.push({
            watchlistId: item.id,
            type: 'ending_soon',
            title: 'Auction Ending Soon',
            message: `Auction "${item.title}" is ending in less than 1 hour!`,
            auctionId: item.auction_id
          });
        }
      }
      
      // Check price change alerts
      if (preferences.price_change && item.price_threshold) {
        if (item.current_highest_bid >= item.price_threshold) {
          alerts.push({
            watchlistId: item.id,
            type: 'price_change',
            title: 'Price Alert Triggered',
            message: `Auction "${item.title}" has reached your price threshold of $${item.price_threshold}`,
            auctionId: item.auction_id
          });
        }
      }
    }
    
    return alerts;
  }
}

module.exports = AuctionDatabase;
