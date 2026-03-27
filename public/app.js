// Global variables
let socket = io();
let currentUser = null;
let currentAuctionId = null;
let isLoginMode = true;

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    loadAuctions();
    setupEventListeners();
    setupSocketListeners();
    checkOAuthStatus();
    checkOAuthCallback();
});

// Socket.io listeners
function setupSocketListeners() {
    socket.on('auctionCreated', (auction) => {
        showNotification('New auction created: ' + auction.title, 'success');
        loadAuctions();
    });
    
    socket.on('auctionClosed', (auction) => {
        showNotification('Auction closed: ' + auction.title, 'info');
        loadAuctions();
    });
    
    socket.on('bidPlaced', (data) => {
        showNotification('New bid placed!', 'info');
        loadAuctions();
    });
}

// Event listeners
function setupEventListeners() {
    // Auth form
    document.getElementById('authForm').addEventListener('submit', handleAuth);
    
    // Create auction form
    document.getElementById('createAuctionForm').addEventListener('submit', handleCreateAuction);
    
    // Bid form
    document.getElementById('bidForm').addEventListener('submit', handlePlaceBid);
    
    // Set minimum end time to current time
    const now = new Date();
    now.setMinutes(now.getMinutes() + 1);
    document.getElementById('endTime').min = now.toISOString().slice(0, 16);
}

// Authentication functions
function toggleAuth() {
    const modal = document.getElementById('authModal');
    modal.classList.toggle('hidden');
}

function closeAuthModal() {
    document.getElementById('authModal').classList.add('hidden');
    document.getElementById('authForm').reset();
}

function toggleAuthMode() {
    isLoginMode = !isLoginMode;
    const title = document.getElementById('authTitle');
    const submitText = document.getElementById('authSubmitText');
    const modeText = document.getElementById('authModeText');
    
    if (isLoginMode) {
        title.textContent = 'Login';
        submitText.textContent = 'Login';
        modeText.textContent = 'Register';
    } else {
        title.textContent = 'Register';
        submitText.textContent = 'Register';
        modeText.textContent = 'Login';
    }
}

async function handleAuth(e) {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    const endpoint = isLoginMode ? '/api/users/login' : '/api/users/register';
    
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            currentUser = data;
            updateUserDisplay();
            closeAuthModal();
            showNotification(isLoginMode ? 'Login successful!' : 'Registration successful!', 'success');
        } else {
            showNotification(data.error || 'Authentication failed', 'error');
        }
    } catch (error) {
        showNotification('Network error', 'error');
    }
}

function updateUserDisplay() {
    const userDisplay = document.getElementById('userDisplay');
    const authBtn = document.getElementById('authBtn');
    
    if (currentUser) {
        userDisplay.textContent = `Welcome, ${currentUser.username}`;
        userDisplay.classList.remove('hidden');
        authBtn.innerHTML = '<i class="fas fa-sign-out-alt mr-2"></i>Logout';
        authBtn.onclick = logout;
    } else {
        userDisplay.classList.add('hidden');
        authBtn.innerHTML = '<i class="fas fa-user mr-2"></i>Login';
        authBtn.onclick = toggleAuth;
    }
}

function logout() {
    currentUser = null;
    updateUserDisplay();
    showNotification('Logged out successfully', 'info');
    loadAuctions();
}

// Tab functions
function showTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.add('hidden');
    });
    
    // Remove active state from all tab buttons
    document.querySelectorAll('[id$="Tab"]').forEach(btn => {
        btn.classList.remove('bg-purple-600');
        btn.classList.add('hover:bg-purple-500');
    });
    
    // Show selected tab
    document.getElementById(tabName + 'Content').classList.remove('hidden');
    
    // Add active state to selected tab button
    const activeTab = document.getElementById(tabName + 'Tab');
    activeTab.classList.add('bg-purple-600');
    activeTab.classList.remove('hover:bg-purple-500');
    
    // Load tab-specific content
    if (tabName === 'auctions') {
        loadAuctions();
    } else if (tabName === 'myBids') {
        loadMyBids();
    }
}

// Auction functions
async function loadAuctions() {
    try {
        const response = await fetch('/api/auctions');
        const auctions = await response.json();
        
        const grid = document.getElementById('auctionsGrid');
        grid.innerHTML = '';
        
        auctions.forEach(auction => {
            const card = createAuctionCard(auction);
            grid.appendChild(card);
        });
    } catch (error) {
        showNotification('Failed to load auctions', 'error');
    }
}

function createAuctionCard(auction) {
    const card = document.createElement('div');
    card.className = 'glass-effect rounded-xl p-3 sm:p-4 md:p-6 hover:transform hover:scale-105 transition auction-card-mobile mobile-overflow-hidden';
    
    const endTime = new Date(auction.endTime);
    const now = new Date();
    const isExpired = endTime <= now;
    const statusColor = auction.status === 'active' && !isExpired ? 'green' : 'red';
    
    card.innerHTML = `
        <div class="flex flex-col sm:flex-row sm:justify-between sm:items-start mb-3 sm:mb-4 space-y-2 sm:space-y-0">
            <h3 class="text-base sm:text-lg md:text-xl font-bold truncate flex-1 pr-2">${auction.title}</h3>
            <span class="px-2 py-1 rounded text-xs bg-${statusColor}-500 bg-opacity-30 border border-${statusColor}-500 flex-shrink-0">
                ${auction.status}
            </span>
        </div>
        <p class="text-gray-300 mb-3 sm:mb-4 text-xs sm:text-sm md:text-base line-clamp-3">${auction.description}</p>
        <div class="space-y-1 sm:space-y-2 mb-3 sm:mb-4 text-xs sm:text-sm md:text-base">
            <div class="flex justify-between">
                <span class="truncate pr-2">Starting Bid:</span>
                <span class="font-semibold flex-shrink-0">$${auction.startingBid.toFixed(2)}</span>
            </div>
            <div class="flex justify-between">
                <span class="truncate pr-2">Current Highest:</span>
                <span class="font-semibold text-green-400 flex-shrink-0">$${auction.currentHighestBid.toFixed(2)}</span>
            </div>
            <div class="flex justify-between">
                <span class="truncate pr-2">Bids:</span>
                <span class="font-semibold flex-shrink-0">${auction.bidCount}</span>
            </div>
            <div class="flex justify-between">
                <span class="truncate pr-2">Ends:</span>
                <span class="text-xs sm:text-sm flex-shrink-0">${endTime.toLocaleString()}</span>
            </div>
        </div>
        ${auction.winner ? `
            <div class="bg-green-500 bg-opacity-20 border border-green-500 rounded-lg p-2 sm:p-3 mb-3 sm:mb-4">
                <p class="text-xs sm:text-sm"><strong>Winner:</strong> ${auction.winner}</p>
                <p class="text-xs sm:text-sm"><strong>Winning Bid:</strong> $${auction.winningBid.amount.toFixed(2)}</p>
            </div>
        ` : ''}
        <div class="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2">
            ${auction.status === 'active' && !isExpired && currentUser ? `
                <button onclick="openBidModal('${auction.id}')" class="flex-1 bg-purple-600 hover:bg-purple-700 py-2 px-3 sm:px-4 rounded-lg transition text-xs sm:text-sm md:text-base">
                    <i class="fas fa-gavel mr-1 sm:mr-2"></i><span class="hidden sm:inline">Place Bid</span><span class="sm:hidden">Bid</span>
                </button>
            ` : ''}
            <button onclick="viewAuctionDetails('${auction.id}')" class="flex-1 bg-gray-600 hover:bg-gray-700 py-2 px-3 sm:px-4 rounded-lg transition text-xs sm:text-sm md:text-base">
                <i class="fas fa-eye mr-1 sm:mr-2"></i><span class="hidden sm:inline">Details</span><span class="sm:hidden">View</span>
            </button>
        </div>
    `;
    
    return card;
}

async function handleCreateAuction(e) {
    e.preventDefault();
    
    if (!currentUser) {
        showNotification('Please login to create an auction', 'error');
        return;
    }
    
    const title = document.getElementById('auctionTitle').value;
    const description = document.getElementById('auctionDescription').value;
    const startingBid = parseFloat(document.getElementById('startingBid').value);
    const endTime = document.getElementById('endTime').value;
    
    try {
        const response = await fetch('/api/auctions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title,
                description,
                startingBid,
                endTime,
                userId: currentUser.userId
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showNotification('Auction created successfully!', 'success');
            document.getElementById('createAuctionForm').reset();
            showTab('auctions');
        } else {
            showNotification(data.error || 'Failed to create auction', 'error');
        }
    } catch (error) {
        showNotification('Network error', 'error');
    }
}

// Bid functions
function openBidModal(auctionId) {
    if (!currentUser) {
        showNotification('Please login to place a bid', 'error');
        return;
    }
    
    currentAuctionId = auctionId;
    document.getElementById('bidModal').classList.remove('hidden');
}

function closeBidModal() {
    document.getElementById('bidModal').classList.add('hidden');
    document.getElementById('bidForm').reset();
    currentAuctionId = null;
}

async function handlePlaceBid(e) {
    e.preventDefault();
    
    const amount = parseFloat(document.getElementById('bidAmount').value);
    const secretKey = document.getElementById('secretKey').value;
    
    try {
        const response = await fetch('/api/bids', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                auctionId: currentAuctionId,
                bidderId: currentUser.userId,
                amount,
                secretKey
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showNotification('Bid placed successfully! Save your secret key securely.', 'success');
            closeBidModal();
            loadAuctions();
        } else {
            showNotification(data.error || 'Failed to place bid', 'error');
        }
    } catch (error) {
        showNotification('Network error', 'error');
    }
}

async function viewAuctionDetails(auctionId) {
    try {
        const response = await fetch(`/api/auctions/${auctionId}`);
        const auction = await response.json();
        
        // Show detailed view (could be enhanced with a modal)
        showNotification(`Viewing details for: ${auction.title}`, 'info');
    } catch (error) {
        showNotification('Failed to load auction details', 'error');
    }
}

async function loadMyBids() {
    if (!currentUser) {
        document.getElementById('myBidsList').innerHTML = '<p>Please login to view your bids.</p>';
        return;
    }
    
    // This would require an additional endpoint to get user's bids
    // For now, show a placeholder
    document.getElementById('myBidsList').innerHTML = '<p>Your bid history will appear here.</p>';
}

// Notification system
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `fixed top-4 right-4 z-50 p-4 rounded-lg glass-effect animate-pulse-slow`;
    
    const colors = {
        success: 'bg-green-500 bg-opacity-20 border-green-500',
        error: 'bg-red-500 bg-opacity-20 border-red-500',
        info: 'bg-blue-500 bg-opacity-20 border-blue-500'
    };
    
    notification.classList.add(...colors[type].split(' '));
    notification.innerHTML = `
        <div class="flex items-center">
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'} mr-2"></i>
            <span>${message}</span>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// OAuth Functions
async function checkOAuthStatus() {
    try {
        const response = await fetch('/api/auth/status');
        const data = await response.json();
        
        if (data.google) {
            document.getElementById('googleLoginBtn').classList.remove('hidden');
        }
        if (data.github) {
            document.getElementById('githubLoginBtn').classList.remove('hidden');
        }
    } catch (error) {
        console.error('Error checking OAuth status:', error);
    }
}

function checkOAuthCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const username = urlParams.get('username');
    
    if (token && username) {
        currentUser = { userId: username, username: username, token: token };
        localStorage.setItem('authToken', token);
        updateUserDisplay();
        showNotification('Login successful!', 'success');
        
        // Clean up URL
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}
