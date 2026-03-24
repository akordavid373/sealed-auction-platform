// Socket.io client setup
const socket = io();

// Global state
let currentUser = null;
let auctions = [];
let currentTab = "auctions";

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
});

function initializeApp() {
    // Check for stored user session
    const storedUser = localStorage.getItem("currentUser");
    if (storedUser) {
        currentUser = JSON.parse(storedUser);
        hideAuthModal();
    }
    
    // Load initial auctions
    loadAuctions();
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
    });
    
    // Auction events
    socket.on("auctionCreated", (auction) => {
        console.log("New auction created:", auction);
        addAuctionToGrid(auction);
        showNotification("New auction created!", "success");
    });
    
    socket.on("auctionClosed", (auction) => {
        console.log("Auction closed:", auction);
        updateAuctionInGrid(auction);
        showNotification(`Auction "${auction.title}" has closed!`, "info");
        
        // Show winner if there is one
        if (auction.winner) {
            showNotification(`Winner: ${auction.winner}`, "success");
        }
    });
    
    socket.on("bidPlaced", (data) => {
        console.log("New bid placed:", data);
        updateBidCount(data.auctionId, data.bidCount);
        showNotification("New bid placed!", "info");
    });
}

// Authentication functions
function handleAuth(e) {
    e.preventDefault();
    const formData = new FormData(authForm);
    const isLogin = authTitle.textContent === "Login";
    
    const endpoint = isLogin ? "/api/users/login" : "/api/users/register";
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
        showNotification(`Successfully ${isLogin ? "logged in" : "registered"}!`, "success");
        loadAuctions();
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
function loadAuctions() {
    fetch("/api/auctions")
    .then(response => response.json())
    .then(data => {
        auctions = data;
        renderAuctions();
    })
    .catch(error => {
        console.error("Error loading auctions:", error);
        showNotification("Failed to load auctions", "error");
    });
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
    
    auctions.forEach(auction => {
        addAuctionToGrid(auction);
    });
}

function addAuctionToGrid(auction) {
    if (!auctionsGrid) return;
    
    const auctionCard = createAuctionCard(auction);
    auctionsGrid.insertAdjacentHTML("afterbegin", auctionCard);
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
    
    fetch("/api/bids", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(bidData)
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

function showNotification(message, type = "info", duration = 3000) {
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

function showAuthModal() {
    if (authModal) authModal.classList.remove("hidden");
}

// Close modals when clicking outside
document.addEventListener("click", (e) => {
    if (e.target === authModal) {
        authModal.classList.add("hidden");
    }
    if (e.target === bidModal) {
        bidModal.classList.add("hidden");
    }
});

// Join auction room for real-time updates
function joinAuctionRoom(auctionId) {
    socket.emit("joinAuction", auctionId);
}

// Auto-refresh auctions every 30 seconds as fallback
setInterval(() => {
    if (currentTab === "auctions") {
        loadAuctions();
    }
}, 30000);
