// Initialize APM (MUST be the first line)
const apm = require('elastic-apm-node').start({
  serviceName: process.env.APM_SERVICE_NAME || 'sealed-auction-platform',
  secretToken: process.env.APM_SECRET_TOKEN || '',
  serverUrl: process.env.APM_SERVER_URL || 'http://localhost:8200',
  environment: process.env.NODE_ENV || 'development'
});

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const Sentry = require('@sentry/node');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { Server, Keypair, TransactionBuilder, Networks, BASE_FEE, Asset } = require('stellar-sdk');
const session = require('express-session');
const passport = require('passport');
const AuctionDatabase = require('./database');
const { ApplicationMetrics, createMetricsMiddleware } = require('./utils/metrics');

// Initialize database
const db = new AuctionDatabase();

const app = express();
const server = http.createServer(app);
const appMetrics = new ApplicationMetrics();
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const sentryDsn = process.env.SENTRY_DSN;
const sentryEnabled = Boolean(sentryDsn);

if (sentryEnabled) {
  Sentry.init({
    dsn: sentryDsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1)
  });

  app.use(Sentry.Handlers.requestHandler());
  console.log('Sentry error tracking enabled.');
} else {
  console.log('Sentry disabled (set SENTRY_DSN to enable error tracking).');
}

function trackError(error, context = {}) {
  if (sentryEnabled) {
    Sentry.withScope((scope) => {
      Object.entries(context).forEach(([key, value]) => {
        scope.setExtra(key, value);
      });
      Sentry.captureException(error);
    });
  }

  if (apm && typeof apm.captureError === 'function') {
    apm.captureError(error, { custom: context });
  }
}

function logError(message, error, context = {}) {
  console.error(message, error);
  trackError(error, { message, ...context });
}

// Security middleware
app.use(helmet());
app.use(createMetricsMiddleware(appMetrics));

// Security monitoring endpoint (admin only)
app.get('/api/security/stats', (req, res) => {
  try {
    // In production, add admin authentication here
    const stats = db.getSecurityStats();
    res.json(stats);
  } catch (error) {
    logError('Error getting security stats:', error, { endpoint: '/api/security/stats' });
    res.status(500).json({ error: 'Failed to get security stats' });
  }
});

app.get('/api/security/logs', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    // In production, add admin authentication here
    const logs = db.getQueryLog(limit);
    res.json(logs);
  } catch (error) {
    logError('Error getting query logs:', error, { endpoint: '/api/security/logs' });
    res.status(500).json({ error: 'Failed to get query logs' });
  }
});

// Application metrics endpoints
app.get('/api/monitoring/metrics', (req, res) => {
  try {
    res.json(appMetrics.getSnapshot());
  } catch (error) {
    console.error('Error getting application metrics:', error);
    res.status(500).json({ error: 'Failed to get application metrics' });
  }
});

app.get('/api/monitoring/metrics/prometheus', (req, res) => {
  try {
    res.type('text/plain');
    res.send(appMetrics.toPrometheus());
  } catch (error) {
    console.error('Error getting prometheus metrics:', error);
    res.status(500).json({ error: 'Failed to get prometheus metrics' });
  }
});

// Restrictive CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000', 'http://localhost:3001'];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  maxAge: 86400 // 24 hours
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static('public'));

// Session middleware for OAuth
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-session-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Rate limiting configuration
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-change-in-production';
const tokenBlacklist = new Set();

// Import validation middleware
const { validateRequest } = require('./utils/validation');
const { validateSchema } = require('./utils/schema-validation');

// Tiered rate limiting configuration
// Strict limits for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: {
    error: 'Too many authentication attempts, please try again after 15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Moderate limits for bid operations
const bidLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // limit each IP to 30 requests per windowMs
  message: {
    error: 'Too many bid operations, please slow down'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Higher limits for read operations
const readLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Very strict limits for auction creation
const createLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // limit each IP to 10 auction creations per hour
  message: {
    error: 'Too many auction creations, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API limiter as fallback
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply general rate limiting to all routes
app.use(generalLimiter);

// Backup directory
const backupDir = path.join(__dirname, 'backups');

// In-memory storage (in production, use a proper database)
let auctions = new Map();
let bids = new Map();
let users = new Map();

// Auction class
class Auction {
  constructor(id, title, description, startingBid, endTime, creator) {
    this.id = id;
    this.title = title;
    this.description = description;
    this.startingBid = startingBid;
    this.currentHighestBid = startingBid;
    this.endTime = endTime;
    this.creator = creator;
    this.status = 'active';
    this.bids = [];
    this.winner = null;
    this.winningBid = null;
    this.createdAt = new Date();
  }

  addBid(bid) {
    this.bids.push(bid);
    if (bid.amount > this.currentHighestBid) {
      this.currentHighestBid = bid.amount;
    }
  }

  close() {
    this.status = 'closed';
    if (this.bids.length > 0) {
      const winningBid = this.bids.reduce((prev, current) => 
        prev.amount > current.amount ? prev : current
      );
      this.winner = winningBid.bidderId;
      this.winningBid = winningBid;
    }
  }
}

// Bid class
class Bid {
  constructor(id, auctionId, bidderId, amount, encryptedBid) {
    this.id = id;
    this.auctionId = auctionId;
    this.bidderId = bidderId;
    this.amount = amount;
    this.encryptedBid = encryptedBid;
    this.timestamp = new Date();
    this.revealed = false;
  }
}

// User class
class User {
  constructor(id, username, hashedPassword, email = null, provider = null, providerId = null) {
    this.id = id;
    this.username = username;
    this.hashedPassword = hashedPassword;
    this.email = email;
    this.provider = provider;
    this.providerId = providerId;
    this.createdAt = new Date();
  }
}

// Helper functions
function generateAuctionId() {
  return uuidv4();
}

// JWT Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  if (tokenBlacklist.has(token)) {
    return res.status(401).json({ error: 'Token has been revoked' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// Account Lockout Middleware
function checkAccountLockout(req, res, next) {
  const user = db.getUserById(req.user.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (db.isAccountLocked(user.username)) {
    return res.status(423).json({ 
      error: 'Account is temporarily locked due to too many failed login attempts',
      lockedUntil: user.locked_until
    });
  }

  next();
}

// Generate JWT Token
function generateToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

function encryptBid(bidAmount, secretKey) {
  const algorithm = 'aes-256-cbc';
  const key = crypto.scryptSync(secretKey, 'salt', 32);
  const iv = crypto.randomBytes(16);
  
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(bidAmount.toString(), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return {
    encrypted,
    iv: iv.toString('hex')
  };
}

// --- Content Negotiation Helpers ---
function toXML(obj, root = 'response') {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<${root}>\n`;
  const processValue = (val, level) => {
    let s = '';
    const indent = '  '.repeat(level);
    if (Array.isArray(val)) {
      val.forEach(item => {
        s += `${indent}<item>\n${processValue(item, level + 1)}${indent}</item>\n`;
      });
    } else if (typeof val === 'object' && val !== null) {
      for (const [k, v] of Object.entries(val)) {
        s += `${indent}<${k}>${processValue(v, level + 1).trim()}</${k}>\n`;
      }
    } else {
      s += `${val}`;
    }
    return s;
  };
  xml += processValue(obj, 1);
  xml += `</${root}>`;
  return xml;
}

function toYAML(obj, indent = 0) {
  let yaml = '';
  const spaces = ' '.repeat(indent);
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      yaml += `${spaces}${key}:\n`;
      value.forEach(item => {
        yaml += `${spaces}  - `;
        if (typeof item === 'object' && item !== null) {
          yaml += toYAML(item, indent + 4).trimStart();
        } else {
          yaml += `${item}\n`;
        }
      });
    } else if (typeof value === 'object' && value !== null) {
      yaml += `${spaces}${key}:\n${toYAML(value, indent + 2)}`;
    } else {
      yaml += `${spaces}${key}: ${value}\n`;
    }
  }
  return yaml;
}

// Content negotiation middleware
app.use((req, res, next) => {
  res.sendData = (data, root = 'response') => {
    const accept = req.headers.accept || '';
    if (accept.includes('application/xml')) {
      res.type('application/xml');
      return res.send(toXML(data, root));
    } else if (accept.includes('text/yaml') || accept.includes('application/yaml')) {
      res.type('text/yaml');
      return res.send(toYAML(data));
    }
    res.json(data);
  };
  next();
});

function decryptBid(encryptedData, secretKey) {
  const algorithm = 'aes-256-cbc';
  const key = crypto.scryptSync(secretKey, 'salt', 32);
  const iv = Buffer.from(encryptedData.iv, 'hex');
  
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return parseFloat(decrypted);
}

// --- Backup and Restore ---
function backupData() {
  try {
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    fs.writeFileSync(path.join(backupDir, 'auctions.json'), JSON.stringify(Array.from(auctions.entries()), null, 2));
    fs.writeFileSync(path.join(backupDir, 'bids.json'), JSON.stringify(Array.from(bids.entries()), null, 2));
    fs.writeFileSync(path.join(backupDir, 'users.json'), JSON.stringify(Array.from(users.entries()), null, 2));
    console.log(`[${new Date().toISOString()}] Data backup successful.`);
  } catch (error) {
    logError('Data backup failed:', error, { operation: 'backupData' });
  }
}

function restoreData() {
  try {
    const auctionsPath = path.join(backupDir, 'auctions.json');
    if (fs.existsSync(auctionsPath)) {
      const data = JSON.parse(fs.readFileSync(auctionsPath));
      const restoredAuctions = data.map(([id, plainAuction]) => {
        const auction = Object.assign(new Auction(), plainAuction);
        auction.endTime = new Date(auction.endTime);
        auction.createdAt = new Date(auction.createdAt);
        auction.bids = auction.bids.map(plainBid => Object.assign(new Bid(), plainBid));
        return [id, auction];
      });
      auctions = new Map(restoredAuctions);
      console.log(`Restored ${auctions.size} auctions from backup.`);
    }

    const bidsPath = path.join(backupDir, 'bids.json');
    if (fs.existsSync(bidsPath)) {
      const data = JSON.parse(fs.readFileSync(bidsPath));
      const restoredBids = data.map(([id, plainBid]) => {
        const bid = Object.assign(new Bid(), plainBid);
        bid.timestamp = new Date(bid.timestamp);
        return [id, bid];
      });
      bids = new Map(restoredBids);
      console.log(`Restored ${bids.size} bids from backup.`);
    }

    const usersPath = path.join(backupDir, 'users.json');
    if (fs.existsSync(usersPath)) {
      const data = JSON.parse(fs.readFileSync(usersPath));
      const restoredUsers = data.map(([id, plainUser]) => {
        const user = Object.assign(new User(), plainUser);
        user.createdAt = new Date(user.createdAt);
        return [id, user];
      });
      users = new Map(restoredUsers);
      console.log(`Restored ${users.size} users from backup.`);
    }
  } catch (error) {
    logError('Failed to restore data from backup. Starting with a clean state.', error, { operation: 'restoreData' });
    auctions = new Map();
    bids = new Map();
    users = new Map();
  }
}

// Restore data on startup
restoreData();

// Routes
app.get('/api/auctions', 
  readLimiter,
  validateSchema('auctionsQuery'),
  validateRequest.query({
    page: { type: 'number' },
    limit: { type: 'number' },
    status: { type: 'status' }
  }),
  (req, res) => {
  try {
    const { page = 1, limit = 10, status = null } = req.sanitizedQuery || {};
    
    // Additional validation for limit to prevent excessive data loading
    const validatedLimit = Math.min(limit, 100);
    
    const result = db.getPaginatedAuctions(page, validatedLimit, status);
    
    const auctionList = result.auctions.map(auction => ({
      id: auction.id,
      title: auction.title,
      description: auction.description,
      startingBid: auction.starting_bid,
      currentHighestBid: auction.current_highest_bid || auction.starting_bid,
      endTime: auction.end_time,
      status: auction.status,
      bidCount: db.getBidCount(auction.id),
      creator: auction.creator_id,
      _links: {
        self: { href: `/api/auctions/${auction.id}` },
        bids: { href: `/api/auctions/${auction.id}/bids` },
        close: { href: `/api/auctions/${auction.id}`, method: 'PATCH' }
      }
    }));
    
    res.sendData({
      auctions: auctionList,
      pagination: result.pagination,
      _links: {
        self: { href: `/api/auctions?page=${page}&limit=${validatedLimit}` + (status ? `&status=${status}` : '') }
      }
    }, 'auctionsResponse');
  } catch (error) {
    logError('Error fetching auctions:', error, { endpoint: '/api/auctions', method: 'GET' });
    res.status(500).sendData({ error: 'Failed to fetch auctions' });
  }
});

app.post('/api/auctions', 
  authenticateToken,
  checkAccountLockout,
  createLimiter,
  validateSchema('createAuction'),
  validateRequest.body({
    title: { type: 'title', required: true },
    description: { type: 'description', required: true },
    startingBid: { type: 'bidAmount', required: true, minimumBid: 0.01 },
    endTime: { type: 'date', required: true, allowPast: false }
  }),
  async (req, res) => {
  try {
    const userId = req.user.userId;
    const { title, description, startingBid, endTime } = req.sanitizedBody;
    
    // Check if user exists
    const user = db.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const auctionId = generateAuctionId();
    
    // Create auction in database
    db.createAuction({
      id: auctionId,
      title,
      description,
      startingBid,
      endTime,
      creator: userId,
      status: 'active'
    });
    
    // Also create in-memory for compatibility
    const auction = new Auction(auctionId, title, description, startingBid, new Date(endTime), userId);
    auctions.set(auctionId, auction);
    
    const responseData = {
      ...auction,
      _links: {
        self: { href: `/api/auctions/${auctionId}` },
        bids: { href: `/api/auctions/${auctionId}/bids` },
        close: { href: `/api/auctions/${auctionId}`, method: 'PATCH' }
      }
    };
    
    io.emit('auctionCreated', auction);
    res.status(201).sendData(responseData, 'auctionCreated');
  } catch (error) {
    logError('Auction creation failed:', error, { endpoint: '/api/auctions', method: 'POST' });
    res.status(500).sendData({ error: 'Failed to create auction' });
  }
});

app.get('/api/auctions/:id', 
  readLimiter,
  validateSchema('auctionIdParam'),
  validateRequest.params({
    id: { type: 'uuid', required: true }
  }),
  (req, res) => {
  try {
    const auctionId = req.sanitizedParams.id;
    
    const auctionDb = db.getAuction(auctionId);
    if (!auctionDb) {
      return res.status(404).json({ error: 'Auction not found' });
    }

    res.sendData({
      id: auctionDb.id,
      title: auctionDb.title,
      description: auctionDb.description,
      startingBid: auctionDb.starting_bid,
      currentHighestBid: auctionDb.current_highest_bid || auctionDb.starting_bid,
      endTime: auctionDb.end_time,
      status: auctionDb.status,
      bidCount: db.getBidCount(auctionId),
      creator: auctionDb.creator_id,
      _links: {
        self: { href: `/api/auctions/${auctionDb.id}` },
        bids: { href: `/api/auctions/${auctionDb.id}/bids` },
        close: { href: `/api/auctions/${auctionDb.id}`, method: 'PATCH' }
      }
    }, 'auctionDetails');
  } catch (error) {
    logError('Error fetching auction:', error, { endpoint: '/api/auctions/:id', method: 'GET' });
    res.status(500).sendData({ error: 'Failed to fetch auction' });
  }
});

app.post('/api/auctions/:id/bids', 
  authenticateToken,
  checkAccountLockout,
  bidLimiter,
  validateSchema('placeBid'),
  validateRequest.body({
    amount: { type: 'bidAmount', required: true, minimumBid: 0.01 },
    secretKey: { type: 'secretKey', required: true }
  }),
  validateRequest.params({
    id: { type: 'uuid', required: true }
  }),
  async (req, res) => {
  try {
    const auctionId = req.sanitizedParams.id;
    const bidderId = req.user.userId;
    const { amount, secretKey } = req.sanitizedBody;
    
    const auctionDb = db.getAuction(auctionId);
    if (!auctionDb) {
      return res.status(404).sendData({ error: 'Auction not found' });
    }

    if (auctionDb.status !== 'active') {
      return res.status(400).sendData({ error: 'Auction is not active' });
    }

    // Validate bid amount against current highest bid
    const minimumBid = Math.max(auctionDb.starting_bid, auctionDb.current_highest_bid || auctionDb.starting_bid);
    if (amount <= minimumBid) {
      return res.status(400).sendData({ error: `Bid must be higher than ${minimumBid}` });
    }

    const encryptedBid = encryptBid(amount, secretKey);
    const bidId = uuidv4();
    const bid = new Bid(bidId, auctionId, bidderId, amount, encryptedBid);
    
    // Save bid to database
    db.createBid({
      id: bidId,
      auctionId,
      bidderId,
      amount,
      encryptedBid
    });
    
    // Update auction's current highest bid
    db.updateAuction(auctionId, { current_highest_bid: amount });
    
    // Also update in-memory for compatibility
    const auction = auctions.get(auctionId);
    if (auction) {
      auction.addBid(bid);
    }
    
    io.emit('bidPlaced', { auctionId, bidCount: auction ? auction.bids.length : 1 });
    res.status(201).sendData({ 
      message: 'Bid placed successfully', 
      bidId,
      _links: {
        self: { href: `/api/auctions/${auctionId}/bids` },
        auction: { href: `/api/auctions/${auctionId}` }
      }
    }, 'bidPlaced');
  } catch (error) {
    logError('Bid placement failed:', error, { endpoint: '/api/auctions/:id/bids', method: 'POST' });
    res.status(500).sendData({ error: 'Failed to place bid' });
  }
});

// Use PATCH for updating auction state (RESTful)
app.patch('/api/auctions/:id', 
  authenticateToken,
  bidLimiter,
  validateSchema('auctionIdParam'),
  validateRequest.params({
    id: { type: 'uuid', required: true }
  }),
  (req, res) => {
  try {
    const auctionId = req.sanitizedParams.id;
    const { status } = req.body;

    if (status !== 'closed') {
      return res.status(400).sendData({ error: 'Only closing auctions is currently supported via this endpoint' });
    }
    
    const auctionDb = db.getAuction(auctionId);
    if (!auctionDb) {
      return res.status(404).sendData({ error: 'Auction not found' });
    }

    if (auctionDb.status === 'closed') {
      return res.status(400).sendData({ error: 'Auction is already closed' });
    }

    // Permission check: only creator can close
    if (auctionDb.creator_id !== req.user.userId) {
      return res.status(403).sendData({ error: 'Only the creator can close this auction' });
    }

    // Get all bids and find winner
    const allBids = db.getBidsForAuction(auctionId);
    let winnerId = null;
    let winningBidId = null;
    
    if (allBids.length > 0) {
      const highestBid = allBids[0]; // Already ordered by amount DESC
      winnerId = highestBid.bidder_id;
      winningBidId = highestBid.id;
    }
    
    // Update auction in database
    db.closeAuction(auctionId, winnerId, winningBidId);
    
    // Update in-memory
    const auction = auctions.get(auctionId);
    if (auction) {
      auction.close();
    }
    
    const responseData = { 
      ...auctionDb, 
      status: 'closed', 
      winner: winnerId, 
      winningBid: winningBidId,
      _links: {
        self: { href: `/api/auctions/${auctionId}` },
        bids: { href: `/api/auctions/${auctionId}/bids` }
      }
    };
    io.emit('auctionClosed', responseData);
    res.sendData(responseData, 'auctionClosed');
  } catch (error) {
    logError('Error closing auction:', error, { endpoint: '/api/auctions/:id', method: 'PATCH' });
    res.status(500).sendData({ error: 'Failed to close auction' });
  }
});

// ODHUNTER: Kept only PATCH endpoint and removed legacy /api/auctions/:id/close and /api/auctions/:id/bid
app.post('/api/users', 
  authLimiter,
  validateSchema('registerUser'),
  validateRequest.body({
    username: { type: 'username', required: true },
    password: { type: 'password', required: true }
  }),
  async (req, res) => {
  try {
    const { username, password } = req.sanitizedBody;
    
    // Check if user already exists
    const existingUser = db.getUserByUsername(username);
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const userId = uuidv4();
    // Create user in database
    db.createUser(userId, username, password);
    
    res.status(201).sendData({ 
      userId, 
      username,
      message: 'User registered successfully',
      _links: {
        login: { href: '/api/auth/login', method: 'POST' }
      }
    }, 'userRegistered');
  } catch (error) {
    logError('Error registering user:', error, { endpoint: '/api/users', method: 'POST' });
    res.status(500).sendData({ error: 'Failed to register user' });
  }
});

// ODHUNTER: Removed legacy /api/users/login and using the standard RESTful endpoint instead
app.post('/api/auth/login', 
  authLimiter,
  validateSchema('loginUser'),
  validateRequest.body({
    username: { type: 'string', required: true },
    password: { type: 'string', required: true }
  }),
  async (req, res) => {
  try {
    const { username, password } = req.sanitizedBody;
    
    if (db.isAccountLocked(username)) {
      const user = db.getUserByUsername(username);
      const lockedUntil = user ? new Date(user.locked_until) : null;
      return res.status(423).sendData({ 
        error: 'Account is temporarily locked due to too many failed login attempts',
        lockedUntil: lockedUntil ? lockedUntil.toISOString() : null
      });
    }
    
    const user = db.getUserByUsername(username);
    if (!user) {
      return res.status(401).sendData({ error: 'Invalid credentials' });
    }

    const isValid = await bcrypt.compare(password, user.hashed_password);
    if (!isValid) {
      db.incrementFailedLoginAttempts(username);
      const updatedUser = db.getUserByUsername(username);
      const MAX_FAILED_ATTEMPTS = 5;
      
      if (updatedUser && updatedUser.failed_login_attempts >= MAX_FAILED_ATTEMPTS) {
        db.lockAccount(username, 30);
        return res.status(423).sendData({ 
          error: 'Account has been locked due to too many failed login attempts',
          lockedUntil: new Date(Date.now() + 30 * 60 * 1000).toISOString()
        });
      }
      
      return res.status(401).sendData({ error: 'Invalid credentials' });
    }

    db.resetFailedLoginAttempts(username);
    const token = generateToken(user);
    
    res.sendData({ 
      userId: user.id, 
      username: user.username,
      token: token,
      expiresIn: '24h',
      _links: {
        verify: { href: '/api/auth/verify', method: 'GET' },
        auctions: { href: '/api/auctions', method: 'GET' }
      }
    }, 'loginResponse');
  } catch (error) {
    logError('Error logging in user:', error, { endpoint: '/api/auth/login', method: 'POST' });
    res.status(500).sendData({ error: 'Failed to login' });
  }
});

// ODHUNTER: Removed legacy /api/users/logout and using the standard RESTful endpoint instead
app.post('/api/auth/logout', authenticateToken, (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (token) {
      tokenBlacklist.add(token);
    }
    
    res.sendData({ 
      message: 'Logged out successfully',
      _links: {
        login: { href: '/api/auth/login', method: 'POST' }
      }
    }, 'logoutResponse');
  } catch (error) {
    res.status(500).sendData({ error: 'Failed to logout' });
  }
});

// ODHUNTER: Removed legacy /api/users/verify and using the standard RESTful endpoint instead
app.get('/api/auth/verify', authenticateToken, (req, res) => {
  res.sendData({ 
    valid: true, 
    user: { 
      userId: req.user.userId, 
      username: req.user.username 
    },
    _links: {
      self: { href: '/api/auth/verify', method: 'GET' },
      logout: { href: '/api/auth/logout', method: 'POST' }
    }
  }, 'verifyResponse');
});

// Account lockout status endpoint
app.get('/api/users/lockout-status', 
  validateSchema('lockoutStatus'),
  validateRequest.query({
    username: { type: 'string', required: true }
  }),
  (req, res) => {
  try {
    const { username } = req.sanitizedQuery;
    
    const user = db.getUserByUsername(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isLocked = db.isAccountLocked(username);
    
    res.json({
      username: user.username,
      isLocked,
      failedLoginAttempts: user.failed_login_attempts || 0,
      lastFailedLogin: user.last_failed_login,
      lockedUntil: user.locked_until,
      _links: {
        self: { href: `/api/users/lockout-status?username=${username}` }
      }
    });
  } catch (error) {
    logError('Error checking lockout status:', error, { endpoint: '/api/users/lockout-status', method: 'GET' });
    res.status(500).json({ error: 'Failed to check lockout status' });
  }
});

// OAuth Routes (requires passport configuration)
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback', 
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req, res) => {
    const token = generateToken(req.user);
    res.redirect(`/?token=${token}&username=${req.user.username}`);
  }
);

app.get('/auth/github', passport.authenticate('github', { scope: ['user:email'] }));

app.get('/auth/github/callback',
  passport.authenticate('github', { failureRedirect: '/login' }),
  (req, res) => {
    const token = generateToken(req.user);
    res.redirect(`/?token=${token}&username=${req.user.username}`);
  }
);

// OAuth status endpoint
app.get('/api/auth/status', (req, res) => {
  res.json({
    google: !!process.env.GOOGLE_CLIENT_ID,
    github: !!process.env.GITHUB_CLIENT_ID,
    _links: {
      self: { href: '/api/auth/status' },
      login: { href: '/api/auth/login', method: 'POST' }
    }
  });
});

// Socket.io connections
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('joinAuction', (auctionId) => {
    socket.join(auctionId);
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Auto-close expired auctions
setInterval(() => {
  const now = new Date();
  const activeAuctions = db.getActiveAuctions();
  
  for (const auction of activeAuctions) {
    if (new Date(auction.end_time) <= now) {
      // Get all bids and find winner
      const allBids = db.getBidsForAuction(auction.id);
      let winnerId = null;
      let winningBidId = null;
      
      if (allBids.length > 0) {
        const highestBid = allBids[0];
        winnerId = highestBid.bidder_id;
        winningBidId = highestBid.id;
      }
      
      // Update auction in database
      db.closeAuction(auction.id, winnerId, winningBidId);
      
      io.emit('auctionClosed', { ...auction, status: 'closed', winner: winnerId, winningBid: winningBidId });
    }
  }
}, 60000); // Check every minute

// Auto-reset expired account lockouts
setInterval(() => {
  try {
    db.resetExpiredLockouts();
    console.log(`[${new Date().toISOString()}] Expired account lockouts reset.`);
  } catch (error) {
    logError('Error resetting expired lockouts:', error, { operation: 'resetExpiredLockouts' });
  }
}, 5 * 60 * 1000); // Check every 5 minutes

// Schedule regular backups
const BACKUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
setInterval(backupData, BACKUP_INTERVAL);
console.log(`Automated backup scheduled to run every ${BACKUP_INTERVAL / 60000} minutes.`);

if (sentryEnabled) {
  app.use(Sentry.Handlers.errorHandler());
}

app.use((err, req, res, next) => {
  logError('Unhandled request error:', err, {
    endpoint: req.originalUrl,
    method: req.method,
    statusCode: err.status || err.statusCode || 500
  });

  if (res.headersSent) {
    return next(err);
  }

  res.status(err.status || err.statusCode || 500).sendData({
    error: 'An unexpected server error occurred'
  });
});

process.on('unhandledRejection', (reason) => {
  const rejectionError = reason instanceof Error ? reason : new Error(String(reason));
  logError('Unhandled Promise Rejection:', rejectionError);
});

process.on('uncaughtException', (error) => {
  logError('Uncaught Exception:', error, { fatal: true });
  setTimeout(() => process.exit(1), 200);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Sealed-Bid Auction server running on port ${PORT}`);
});
