// Socket.io client setup
const socket = io();

// Global state
let currentUser = null;
let auctions = [];
let currentTab = "auctions";
let currentPage = 1;
let isLoading = false;
let hasMoreAuctions = true;
const AUCTIONS_PER_PAGE = 10;

// Notification state
let notifications = [];
let unreadNotifications = 0;
const MAX_NOTIFICATIONS = 50; // Keep last 50 notifications

// Notification preferences
let notificationPreferences = {
    enabled: true,
    types: {
        auctions: true,
        bids: true,
        results: true
    },
    retention: 50
};

// DOM elements
const authModal = document.getElementById("authModal");
const authForm = document.getElementById("authForm");
const authTitle = document.getElementById("authTitle");
const authModeText = document.getElementById("authModeText");
const auctionsGrid = document.getElementById("auctionsGrid");
const createAuctionForm = document.getElementById("createAuctionForm");
const bidModal = document.getElementById("bidModal");
const bidForm = document.getElementById("bidForm");

// Initialize app
document.addEventListener("DOMContentLoaded", () => {
    initializeApp();
    setupEventListeners();
    setupSocketListeners();
    checkOAuthStatus();
    checkOAuthCallback();
});

function initializeApp() {
    // Check for stored user session
    const storedUser = localStorage.getItem("currentUser");
    if (storedUser) {
        currentUser = JSON.parse(storedUser);
        hideAuthModal();
        updateUserDisplay();
    }
    
    // Load notifications from localStorage
    loadNotifications();
    
    // Load initial auctions
    loadAuctions(true);
    
    // Setup infinite scroll
    setupInfiniteScroll();
}

function setupEventListeners() {
    // Auth form submission
    if (authForm) authForm.addEventListener("submit", handleAuth);
    
    // Auth mode toggle
    if (authModeText) authModeText.addEventListener("click", toggleAuthMode);
    
    // Create auction form
    if (createAuctionForm) createAuctionForm.addEventListener("submit", handleCreateAuction);
    
    // Bid form
    if (bidForm) bidForm.addEventListener("submit", handlePlaceBid);
    
    // Tab navigation
    document.querySelectorAll("[data-tab]").forEach(button => {
        button.addEventListener("click", () => switchTab(button.dataset.tab));
    });
}

function setupSocketListeners() {
    // Connection events
    socket.on("connect", () => {
        console.log("Connected to server");
    });
    
    socket.on("disconnect", () => {
        console.log("Disconnected from server");
        showNotification("Connection lost. Reconnecting...", "warning");
    });
    
    // Auction events
    socket.on("auctionCreated", (auction) => {
        console.log("New auction created:", auction);
        addAuctionToGrid(auction);
        addNotification(`New auction: ${auction.title}`, "auction", { auctionId: auction.id });
    });
    
    socket.on("auctionClosed", (auction) => {
        console.log("Auction closed:", auction);
        updateAuctionInGrid(auction);
        
        if (auction.winner) {
            addNotification(`Auction "${auction.title}" closed! Winner: ${auction.winner}`, "success", { auctionId: auction.id });
        } else {
            addNotification(`Auction "${auction.title}" closed without bids`, "info", { auctionId: auction.id });
        }
    });
    
    socket.on("bidPlaced", (data) => {
        console.log("New bid placed:", data);
        updateBidCount(data.auctionId, data.bidCount);
        addNotification("New bid placed on auction!", "bid", { auctionId: data.auctionId });
    });
}

// Authentication functions
function handleAuth(e) {
    e.preventDefault();
    const formData = new FormData(authForm);
    const isLogin = authTitle.textContent === "Login";
    
    const endpoint = isLogin ? "/api/auth/login" : "/api/users";
    const payload = {
        username: formData.get("username"),
        password: formData.get("password")
    };
    
    fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            showNotification(data.error, "error");
            return;
        }
        
        currentUser = data;
        localStorage.setItem("currentUser", JSON.stringify(currentUser));
        hideAuthModal();
        updateUserDisplay();
        showNotification(`Successfully ${isLogin ? "logged in" : "registered"}!`, "success");
        loadAuctions(true);
    })
    .catch(error => {
        console.error("Auth error:", error);
        showNotification("Authentication failed", "error");
    });
}

function toggleAuthMode() {
    const isLogin = authTitle.textContent === "Login";
    authTitle.textContent = isLogin ? "Register" : "Login";
    authModeText.textContent = isLogin ? "Login" : "Register";
    authForm.reset();
}

function hideAuthModal() {
    if (authModal) authModal.classList.add("hidden");
}

// Auction functions
function loadAuctions(reset = false) {
    if (isLoading || (!hasMoreAuctions && !reset)) return;
    
    isLoading = true;
    showLoadingIndicator();
    
    if (reset) {
        currentPage = 1;
        auctions = [];
        renderAuctions();
    }
    
    fetch(`/api/auctions?page=${currentPage}&limit=${AUCTIONS_PER_PAGE}`)
    .then(response => response.json())
    .then(data => {
        const { auctions: newAuctions, pagination } = data;
        
        if (reset) {
            auctions = newAuctions;
        } else {
            auctions = [...auctions, ...newAuctions];
        }
        
        currentPage = pagination.page;
        hasMoreAuctions = pagination.hasMore;
        isLoading = false;
        
        renderAuctions();
        hideLoadingIndicator();
    })
    .catch(error => {
        console.error("Error loading auctions:", error);
        showNotification("Failed to load auctions", "error");
        isLoading = false;
        hideLoadingIndicator();
    });
}

function loadMoreAuctions() {
    if (!isLoading && hasMoreAuctions) {
        currentPage++;
        loadAuctions(false);
    }
}

function renderAuctions() {
    if (!auctionsGrid) return;
    
    auctionsGrid.innerHTML = "";
    
    if (auctions.length === 0) {
        auctionsGrid.innerHTML = `
            <div class="col-span-full text-center py-12">
                <i class="fas fa-gavel text-4xl mb-4 opacity-50"></i>
                <p class="text-lg opacity-75">No auctions available</p>
            </div>
        `;
        return;
    }
    
    // Render all auctions in correct order (newest first)
    auctions.forEach(auction => {
        const auctionCard = createAuctionCard(auction);
        auctionsGrid.insertAdjacentHTML("beforeend", auctionCard);
    });
}

function setupInfiniteScroll() {
    window.addEventListener('scroll', () => {
        const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
        
        // Load more when user is within 100px of bottom
        if (scrollTop + clientHeight >= scrollHeight - 100 && !isLoading && hasMoreAuctions) {
            loadMoreAuctions();
        }
    });
}

function showLoadingIndicator() {
    let loader = document.getElementById('loading-indicator');
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'loading-indicator';
        loader.className = 'fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white px-6 py-3 rounded-full shadow-lg animate-pulse z-50';
        loader.innerHTML = `
            <div class="flex items-center space-x-2">
                <i class="fas fa-spinner fa-spin"></i>
                <span>Loading more auctions...</span>
            </div>
        `;
        document.body.appendChild(loader);
    }
    loader.style.display = 'block';
}

function hideLoadingIndicator() {
    const loader = document.getElementById('loading-indicator');
    if (loader) {
        loader.style.display = 'none';
    }
}

function addAuctionToGrid(auction, prepend = true) {
    if (!auctionsGrid) return;
    
    const auctionCard = createAuctionCard(auction);
    // Prepend new auctions (from socket events), append when loading more
    auctionsGrid.insertAdjacentHTML(prepend ? "afterbegin" : "beforeend", auctionCard);
}

function createAuctionCard(auction) {
    const endTime = new Date(auction.endTime);
    const now = new Date();
    const isExpired = endTime <= now;
    const statusClass = auction.status === "closed" || isExpired ? "bg-red-500" : "bg-green-500";
    const statusText = auction.status === "closed" ? "Closed" : isExpired ? "Expired" : "Active";
    
    return `
        <div class="auction-card glass-effect rounded-xl p-6 hover:shadow-lg transition-all duration-300 animate-fade-in" data-auction-id="${auction.id}">
            <div class="flex justify-between items-start mb-4">
                <h3 class="text-lg font-semibold line-clamp-3">${auction.title}</h3>
                <span class="${statusClass} text-white text-xs px-2 py-1 rounded-full">${statusText}</span>
            </div>
            
            <p class="text-sm opacity-75 mb-4 line-clamp-3">${auction.description}</p>
            
            <div class="space-y-2 mb-4">
                <div class="flex justify-between text-sm">
                    <span>Starting Bid:</span>
                    <span class="font-semibold">${auction.startingBid} XLM</span>
                </div>
                <div class="flex justify-between text-sm">
                    <span>Current Highest:</span>
                    <span class="font-semibold text-green-500">${auction.currentHighestBid} XLM</span>
                </div>
                <div class="flex justify-between text-sm">
                    <span>Bids:</span>
                    <span class="font-semibold" data-bid-count="${auction.id}">${auction.bidCount}</span>
                </div>
                <div class="flex justify-between text-sm">
                    <span>Ends:</span>
                    <span class="font-semibold">${endTime.toLocaleDateString()}</span>
                </div>
            </div>
            
            <div class="flex space-x-2">
                ${auction.status === "active" && !isExpired ? `
                    <button onclick="openBidModal('${auction.id}')" class="flex-1 bg-blue-500 hover:bg-blue-600 text-white px-3 py-2 rounded-lg text-sm transition-colors">
                        <i class="fas fa-hand-holding-usd mr-1"></i>Place Bid
                    </button>
                ` : ""}
                <button onclick="viewAuctionDetails('${auction.id}')" class="flex-1 bg-gray-500 hover:bg-gray-600 text-white px-3 py-2 rounded-lg text-sm transition-colors">
                    <i class="fas fa-eye mr-1"></i>View Details
                </button>
            </div>
        </div>
    `;
}

function updateAuctionInGrid(auction) {
    const auctionCard = document.querySelector(`[data-auction-id="${auction.id}"]`);
    if (auctionCard) {
        const newCard = createAuctionCard(auction);
        auctionCard.outerHTML = newCard;
    }
}

function updateBidCount(auctionId, bidCount) {
    const bidCountElement = document.querySelector(`[data-bid-count="${auctionId}"]`);
    if (bidCountElement) {
        bidCountElement.textContent = bidCount;
        bidCountElement.classList.add("animate-pulse");
        setTimeout(() => {
            bidCountElement.classList.remove("animate-pulse");
        }, 1000);
    }
}

function handleCreateAuction(e) {
    e.preventDefault();
    
    if (!currentUser) {
        showNotification("Please login to create an auction", "error");
        showAuthModal();
        return;
    }
    
    const formData = new FormData(createAuctionForm);
    const endTime = new Date(formData.get("endTime"));
    
    if (endTime <= new Date()) {
        showNotification("End time must be in the future", "error");
        return;
    }
    
    const auctionData = {
        title: formData.get("title"),
        description: formData.get("description"),
        startingBid: parseFloat(formData.get("startingBid")),
        endTime: endTime.toISOString(),
        userId: currentUser.userId
    };
    
    fetch("/api/auctions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(auctionData)
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            showNotification(data.error, "error");
            return;
        }
        
        showNotification("Auction created successfully!", "success");
        createAuctionForm.reset();
        // Socket.io will handle adding the auction to the grid
    })
    .catch(error => {
        console.error("Error creating auction:", error);
        showNotification("Failed to create auction", "error");
    });
}

// Bid functions
function openBidModal(auctionId) {
    if (!currentUser) {
        showNotification("Please login to place a bid", "error");
        showAuthModal();
        return;
    }
    
    if (bidModal) {
        bidModal.dataset.auctionId = auctionId;
        bidModal.classList.remove("hidden");
    }
}

function handlePlaceBid(e) {
    e.preventDefault();
    
    const auctionId = bidModal.dataset.auctionId;
    const formData = new FormData(bidForm);
    
    const bidData = {
        auctionId: auctionId,
        bidderId: currentUser.userId,
        amount: parseFloat(formData.get("amount")),
        secretKey: formData.get("secretKey")
    };
    
    fetch(`/api/auctions/${auctionId}/bids`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${currentUser.token}`
        },
        body: JSON.stringify({
            amount: parseFloat(formData.get("amount")),
            secretKey: formData.get("secretKey")
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            showNotification(data.error, "error");
            return;
        }
        
        showNotification("Bid placed successfully!", "success");
        bidModal.classList.add("hidden");
        bidForm.reset();
        // Socket.io will handle updating the bid count
    })
    .catch(error => {
        console.error("Error placing bid:", error);
        showNotification("Failed to place bid", "error");
    });
}

function viewAuctionDetails(auctionId) {
    fetch(`/api/auctions/${auctionId}`)
    .then(response => response.json())
    .then(auction => {
        // Create a detailed view modal or navigate to details page
        const details = `
            Title: ${auction.title}
            Description: ${auction.description}
            Starting Bid: ${auction.startingBid} XLM
            Current Highest: ${auction.currentHighestBid} XLM
            Status: ${auction.status}
            Bids: ${auction.bids.length}
            ${auction.winner ? `Winner: ${auction.winner}` : ""}
        `;
        showNotification(details, "info", 5000);
    })
    .catch(error => {
        console.error("Error fetching auction details:", error);
        showNotification("Failed to fetch auction details", "error");
    });
}

// UI utility functions
function switchTab(tabName) {
    // Hide all tabs
    document.querySelectorAll(".tab-content").forEach(tab => {
        tab.classList.add("hidden");
    });
    
    // Show selected tab
    const selectedTab = document.getElementById(`${tabName}Content`);
    if (selectedTab) {
        selectedTab.classList.remove("hidden");
    }
    
    // Update tab buttons
    document.querySelectorAll("[data-tab]").forEach(button => {
        button.classList.remove("bg-purple-600", "text-white");
        button.classList.add("bg-transparent", "text-gray-600");
    });
    
    const selectedButton = document.querySelector(`[data-tab="${tabName}"]`);
    if (selectedButton) {
        selectedButton.classList.remove("bg-transparent", "text-gray-600");
        selectedButton.classList.add("bg-purple-600", "text-white");
    }
    
    currentTab = tabName;
}

// Enhanced Notification System Functions
function loadNotifications() {
    const stored = localStorage.getItem('auctionNotifications');
    if (stored) {
        try {
            notifications = JSON.parse(stored);
            updateUnreadCount();
            updateNotificationBadge();
        } catch (e) {
            console.error('Failed to load notifications:', e);
            notifications = [];
        }
    }
    
    // Load preferences
    loadNotificationPreferences();
}

function saveNotifications() {
    localStorage.setItem('auctionNotifications', JSON.stringify(notifications));
}

function addNotification(message, type = 'info', data = null) {
    // Check notification preferences
    if (!notificationPreferences.enabled) return;
    
    // Check type preferences
    if (type === 'auction' && !notificationPreferences.types.auctions) return;
    if (type === 'bid' && !notificationPreferences.types.bids) return;
    if ((type === 'success' || type === 'error') && !notificationPreferences.types.results) return;
    
    const notification = {
        id: Date.now().toString(),
        message,
        type,
        timestamp: new Date().toISOString(),
        read: false,
        data
    };
    
    // Add to beginning of array (newest first)
    notifications.unshift(notification);
    
    // Limit storage
    if (notifications.length > MAX_NOTIFICATIONS) {
        notifications = notifications.slice(0, MAX_NOTIFICATIONS);
    }
    
    // Update unread count
    if (!notification.read) {
        unreadNotifications++;
        updateNotificationBadge();
    }
    
    // Save to localStorage
    saveNotifications();
    
    // Show toast notification
    showToastNotification(message, type);
    
    // Send browser notification if enabled
    sendBrowserNotification(message, type);
    
    return notification;
}

function showToastNotification(message, type = 'info', duration = 3000) {
    const notification = document.createElement("div");
    notification.className = `fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg animate-fade-in ${
        type === "success" ? "bg-green-500" :
        type === "error" ? "bg-red-500" :
        type === "warning" ? "bg-yellow-500" :
        "bg-blue-500"
    } text-white max-w-sm`;
    
    notification.innerHTML = `
        <div class="flex items-center">
            <i class="fas ${
                type === "success" ? "fa-check-circle" :
                type === "error" ? "fa-exclamation-circle" :
                type === "warning" ? "fa-exclamation-triangle" :
                "fa-info-circle"
            } mr-2"></i>
            <span>${message}</span>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, duration);
}

function sendBrowserNotification(message, type = 'info') {
    if (!notificationPreferences.enabled || !('Notification' in window)) return;
    
    if (Notification.permission === 'granted') {
        const icon = getNotificationIcon(type).split(' ')[1]; // Get icon class
        new Notification('Auction Update', {
            body: message,
            icon: '/favicon.ico', // You can add a proper icon
            badge: '/favicon.ico',
            requireInteraction: false,
            tag: Date.now().toString() // Unique tag for each notification
        });
    } else if (Notification.permission !== 'denied') {
        // Request permission on first attempt
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                sendBrowserNotification(message, type);
            }
        });
    }
}

function markNotificationAsRead(notificationId) {
    const notification = notifications.find(n => n.id === notificationId);
    if (notification && !notification.read) {
        notification.read = true;
        unreadNotifications = Math.max(0, unreadNotifications - 1);
        updateNotificationBadge();
        saveNotifications();
    }
}

function markAllNotificationsAsRead() {
    notifications.forEach(n => n.read = true);
    unreadNotifications = 0;
    updateNotificationBadge();
    saveNotifications();
}

function updateUnreadCount() {
    unreadNotifications = notifications.filter(n => !n.read).length;
}

function updateNotificationBadge() {
    const badge = document.getElementById('notification-badge');
    if (badge) {
        if (unreadNotifications > 0) {
            badge.textContent = unreadNotifications > 99 ? '99+' : unreadNotifications;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }
}

function deleteNotification(notificationId) {
    const index = notifications.findIndex(n => n.id === notificationId);
    if (index !== -1) {
        if (!notifications[index].read) {
            unreadNotifications = Math.max(0, unreadNotifications - 1);
            updateNotificationBadge();
        }
        notifications.splice(index, 1);
        saveNotifications();
        renderNotificationCenter();
    }
}

function clearAllNotifications() {
    if (confirm('Are you sure you want to clear all notifications?')) {
        notifications = [];
        unreadNotifications = 0;
        updateNotificationBadge();
        saveNotifications();
        renderNotificationCenter();
    }
}

function getNotificationIcon(type) {
    switch(type) {
        case 'success': return 'fa-check-circle text-green-500';
        case 'error': return 'fa-times-circle text-red-500';
        case 'warning': return 'fa-exclamation-triangle text-yellow-500';
        case 'info': return 'fa-info-circle text-blue-500';
        case 'auction': return 'fa-gavel text-purple-500';
        case 'bid': return 'fa-hand-holding-usd text-green-500';
        default: return 'fa-bell text-gray-500';
    }
}

function formatNotificationTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
}

function openNotificationCenter() {
    const center = document.getElementById('notification-center');
    if (center) {
        renderNotificationCenter();
        center.classList.remove('hidden');
        markAllNotificationsAsRead();
    }
}

