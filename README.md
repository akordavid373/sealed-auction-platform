# Private-Input Sealed-Bid Auction System

A secure, web-based sealed-bid auction platform with private input encryption and real-time updates.

## Features

- **Private-Input Bidding**: Bids are encrypted using AES-256 encryption with user-provided secret keys
- **Real-time Updates**: Live auction status and bid count updates using Socket.io
- **Secure Authentication**: User registration and login with bcrypt password hashing
- **Responsive Design**: Modern, mobile-friendly interface using Tailwind CSS
- **Dark Mode Toggle**: Switch between light and dark themes with localStorage persistence
- **Rate Limiting**: Protection against brute force attacks and spam
- **Auto-Closing**: Auctions automatically close when their end time is reached
- **Application Metrics**: Request, latency, error, and process metrics collection

## Security Features

- **AES-256 Encryption**: All bids are encrypted with user-provided secret keys
- **Password Hashing**: User passwords are hashed using bcrypt
- **Rate Limiting**: API endpoints are protected with rate limiting
- **Input Validation**: All user inputs are validated and sanitized
- **Helmet.js**: Security headers for web applications

## Installation

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

3. Open your browser and navigate to `http://localhost:3000`

## Environment Configuration

Create a `.env` file for local development (optional, but recommended):

```bash
NODE_ENV=development
PORT=3001
JWT_SECRET=change-me
SESSION_SECRET=change-me

# Error tracking (Sentry)
SENTRY_DSN=
SENTRY_ENVIRONMENT=development
SENTRY_RELEASE=
SENTRY_TRACES_SAMPLE_RATE=0.1
```

## Error Tracking & Alerting

- The server now supports centralized error tracking via Sentry.
- To enable it, set `SENTRY_DSN` in your environment.
- Captured errors include API handler failures, global Express errors, unhandled promise rejections, and uncaught exceptions.
- Configure alert rules in Sentry (for example: `issue created`, `regression`, or `spike in errors`) to receive notifications in Slack/email/PagerDuty.

## Usage

### Creating an Account
1. Click the "Login" button in the header
2. Switch to "Register" mode
3. Enter a username and password
4. Click "Register"

### Creating an Auction
1. Login to your account
2. Switch to the "Create Auction" tab
3. Fill in the auction details:
   - Title: Brief description of the item
   - Description: Detailed information about the item
   - Starting Bid: Minimum acceptable bid amount
   - End Time: When the auction should close
4. Click "Create Auction"

### Placing a Sealed Bid
1. Browse active auctions in the "Auctions" tab
2. Click "Place Bid" on an auction you're interested in
3. Enter your bid amount
4. Create a **secret key** - this is crucial for bid verification
5. **Save your secret key securely** - you cannot recover it
6. Click "Place Bid"

### Auction Results
- Auctions automatically close at their specified end time
- The highest bid wins
- Winners and winning amounts are displayed after auction closure

### Theme Customization
- Toggle between light and dark modes using the switch in the header
- Theme preference is automatically saved and persists across sessions
- System theme preference is detected and respected by default
- Smooth transitions between theme changes

<!-- ODHUNTER: Updated standard RESTful endpoints for consistency -->
## API Endpoints

### Authentication
- `POST /api/users` - Register a new user
- `POST /api/auth/login` - Login an existing user

### Auctions
- `GET /api/auctions` - Get all auctions
- `POST /api/auctions` - Create a new auction
- `GET /api/auctions/:id` - Get specific auction details
- `PATCH /api/auctions/:id` - Close an auction manually

### Bids
- `POST /api/auctions/:id/bids` - Place a sealed bid

### Monitoring
- `GET /api/monitoring/metrics` - Application metrics in JSON
- `GET /api/monitoring/metrics/prometheus` - Metrics in Prometheus text format

## Security Considerations

### Secret Key Management
- Secret keys are **never stored** on the server
- Users must save their secret keys securely
- Lost secret keys cannot be recovered
- Secret keys are required for bid verification (future enhancement)

### Bid Privacy
- All bids are encrypted before storage
- Server cannot read bid amounts without the secret key
- Only bid counts and highest bid amounts are visible
- Individual bid amounts remain private until auction closure

## Technical Architecture

### Backend
- **Node.js** with Express.js
- **Socket.io** for real-time communication
- **AES-256-CBC** encryption for bid privacy
- **bcrypt** for password hashing
- **Helmet.js** for security headers
- **express-rate-limit** for API protection

### Frontend
- **Vanilla JavaScript** (no framework dependencies)
- **Tailwind CSS** for styling
- **Socket.io client** for real-time updates
- **Font Awesome** for icons
- **CSS Variables** for dynamic theming
- **localStorage** for theme persistence

### Data Storage
- In-memory storage using JavaScript Maps
- **Note**: For production use, replace with a proper database (MongoDB, PostgreSQL, etc.)

## Future Enhancements

- **Bid Verification**: Allow users to verify their bids using secret keys
- **Database Integration**: Replace in-memory storage with persistent database
- **User Profiles**: Enhanced user management and profiles
- **Bid History**: Detailed bid history and analytics
- **Notifications**: Email/SMS notifications for auction events
- **Multi-item Auctions**: Support for multiple items in a single auction
- **Proxy Bidding**: Automatic bidding up to a maximum amount

## Development

### Project Structure
```
sealed-bid-auction/
├── server.js              # Main server file
├── package.json           # Dependencies and scripts
├── public/
│   ├── index.html         # Main HTML file
│   └── app.js            # Frontend JavaScript
└── README.md              # This file
```

### Testing
Run tests with:
```bash
npm test
```

## License

MIT License - feel free to use this project for personal or commercial purposes.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Support

For issues and questions, please create an issue in the project repository.
