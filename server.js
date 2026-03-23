const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const { Server, Keypair, TransactionBuilder, Networks, BASE_FEE, Asset } = require('stellar-sdk');
// const { StellarSealedBidAuction } = require('./contracts/StellarSealedBidAuction');

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
  constructor(id, username, hashedPassword) {
    this.id = id;
    this.username = username;
    this.hashedPassword = hashedPassword;
    this.createdAt = new Date();
  }
}

// Helper functions
function generateAuctionId() {
  return uuidv4();
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

app.post('/api/auctions', async (req, res) => {
  try {
    const { title, description, startingBid, endTime, userId } = req.body;
    
    if (!title || !description || !startingBid || !endTime || !userId) {
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

app.post('/api/bids', async (req, res) => {
  try {
    const { auctionId, bidderId, amount, secretKey } = req.body;
    
    if (!auctionId || !bidderId || amount === undefined || !secretKey) {
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

app.post('/api/auctions/:id/close', (req, res) => {
  try {
    const auction = auctions.get(req.params.id);
    if (!auction) {
      return res.status(404).json({ error: 'Auction not found' });
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

    const existingUser = Array.from(users.values()).find(u => u.username === username);
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();
    const user = new User(userId, username, hashedPassword);
    
    users.set(userId, user);
    res.status(201).json({ userId, username });
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

    res.json({ userId: user.id, username: user.username });
  } catch (error) {
    res.status(500).json({ error: 'Failed to login' });
  }
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

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Sealed-Bid Auction server running on port ${PORT}`);
});
