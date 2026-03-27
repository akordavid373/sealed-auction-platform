const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { Server, Keypair, TransactionBuilder, Networks, BASE_FEE, Asset } = require('stellar-sdk');
const { StellarSealedBidAuction } = require('./contracts/StellarSealedBidAuction');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const session = require('express-session');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Security middleware
app.use(helmet());
app.use(cors());
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

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// In-memory storage (in production, use a proper database)
const auctions = new Map();
const bids = new Map();
const users = new Map();

// JWT Secret Key (in production, use environment variable)
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// OAuth Configuration
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;

// Passport serialize/deserialize functions
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  const user = users.get(id);
  done(null, user);
});

// Google OAuth Strategy
if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback"
  },
  (accessToken, refreshToken, profile, done) => {
    try {
      let user = Array.from(users.values()).find(u => u.provider === 'google' && u.providerId === profile.id);
      
      if (!user) {
        const userId = uuidv4();
        user = new User(userId, profile.displayName, null, profile.emails[0].value, 'google', profile.id);
        users.set(userId, user);
      }
      
      return done(null, user);
    } catch (error) {
      return done(error, null);
    }
  }));
}

// GitHub OAuth Strategy
if (GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET) {
  passport.use(new GitHubStrategy({
    clientID: GITHUB_CLIENT_ID,
    clientSecret: GITHUB_CLIENT_SECRET,
    callbackURL: "/auth/github/callback"
  },
  (accessToken, refreshToken, profile, done) => {
    try {
      let user = Array.from(users.values()).find(u => u.provider === 'github' && u.providerId === profile.id);
      
      if (!user) {
        const userId = uuidv4();
        user = new User(userId, profile.username, null, profile.emails ? profile.emails[0].value : null, 'github', profile.id);
        users.set(userId, user);
      }
      
      return done(null, user);
    } catch (error) {
      return done(error, null);
    }
  }));
}

// JWT Token blacklist for logout functionality
const tokenBlacklist = new Set();

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

function decryptBid(encryptedData, secretKey) {
  const algorithm = 'aes-256-cbc';
  const key = crypto.scryptSync(secretKey, 'salt', 32);
  const iv = Buffer.from(encryptedData.iv, 'hex');
  
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return parseFloat(decrypted);
}

// Routes
app.get('/api/auctions', (req, res) => {
  const auctionList = Array.from(auctions.values()).map(auction => ({
    id: auction.id,
    title: auction.title,
    description: auction.description,
    startingBid: auction.startingBid,
    currentHighestBid: auction.currentHighestBid,
    endTime: auction.endTime,
    status: auction.status,
    bidCount: auction.bids.length,
    creator: auction.creator
  }));
  res.json(auctionList);
});

app.post('/api/auctions', authenticateToken, async (req, res) => {
  try {
    const { title, description, startingBid, endTime } = req.body;
    const userId = req.user.userId;
    
    if (!title || !description || !startingBid || !endTime) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const auctionId = generateAuctionId();
    const auction = new Auction(auctionId, title, description, startingBid, new Date(endTime), userId);
    
    auctions.set(auctionId, auction);
    
    io.emit('auctionCreated', auction);
    res.status(201).json(auction);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create auction' });
  }
});

app.get('/api/auctions/:id', (req, res) => {
  const auction = auctions.get(req.params.id);
  if (!auction) {
    return res.status(404).json({ error: 'Auction not found' });
  }
  res.json(auction);
});

app.post('/api/bids', authenticateToken, async (req, res) => {
  try {
    const { auctionId, amount, secretKey } = req.body;
    const bidderId = req.user.userId;
    
    if (!auctionId || amount === undefined || !secretKey) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const auction = auctions.get(auctionId);
    if (!auction) {
      return res.status(404).json({ error: 'Auction not found' });
    }

    if (auction.status !== 'active') {
      return res.status(400).json({ error: 'Auction is not active' });
    }

    if (amount <= auction.startingBid) {
      return res.status(400).json({ error: 'Bid must be higher than starting bid' });
    }

    const encryptedBid = encryptBid(amount, secretKey);
    const bidId = uuidv4();
    const bid = new Bid(bidId, auctionId, bidderId, amount, encryptedBid);
    
    bids.set(bidId, bid);
    auction.addBid(bid);
    
    io.emit('bidPlaced', { auctionId, bidCount: auction.bids.length });
    res.status(201).json({ message: 'Bid placed successfully', bidId });
  } catch (error) {
    res.status(500).json({ error: 'Failed to place bid' });
  }
});

app.post('/api/auctions/:id/close', authenticateToken, (req, res) => {
  try {
    const auction = auctions.get(req.params.id);
    if (!auction) {
      return res.status(404).json({ error: 'Auction not found' });
    }

    // Only the auction creator can close it
    if (auction.creator !== req.user.userId) {
      return res.status(403).json({ error: 'Only the auction creator can close it' });
    }

    if (auction.status !== 'active') {
      return res.status(400).json({ error: 'Auction is already closed' });
    }

    auction.close();
    io.emit('auctionClosed', auction);
    res.json(auction);
  } catch (error) {
    res.status(500).json({ error: 'Failed to close auction' });
  }
});

app.post('/api/users/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    const existingUser = Array.from(users.values()).find(u => u.username === username);
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();
    const user = new User(userId, username, hashedPassword);
    
    users.set(userId, user);
    
    // Generate JWT token
    const token = generateToken(user);
    
    res.status(201).json({ 
      userId: user.id, 
      username: user.username,
      token: token,
      expiresIn: '24h'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to register user' });
  }
});

app.post('/api/users/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const user = Array.from(users.values()).find(u => u.username === username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValid = await bcrypt.compare(password, user.hashedPassword);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = generateToken(user);
    
    res.json({ 
      userId: user.id, 
      username: user.username,
      token: token,
      expiresIn: '24h'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to login' });
  }
});

// New logout endpoint
app.post('/api/users/logout', authenticateToken, (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (token) {
      tokenBlacklist.add(token);
    }
    
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to logout' });
  }
});

// New token validation endpoint
app.get('/api/users/verify', authenticateToken, (req, res) => {
  res.json({ 
    valid: true, 
    user: { 
      userId: req.user.userId, 
      username: req.user.username 
    } 
  });
});

// OAuth Routes
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
    google: !!GOOGLE_CLIENT_ID,
    github: !!GITHUB_CLIENT_ID
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
  for (const [id, auction] of auctions) {
    if (auction.status === 'active' && new Date(auction.endTime) <= now) {
      auction.close();
      io.emit('auctionClosed', auction);
    }
  }
}, 60000); // Check every minute

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sealed-Bid Auction server running on port ${PORT}`);
});
