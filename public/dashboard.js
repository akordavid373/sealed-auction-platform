class UserDashboard {
    constructor() {
        this.socket = io();
        this.currentPage = 1;
        this.pageSize = 12;
        this.filters = {
            status: 'all',
            sortBy: 'created_at',
            sortOrder: 'DESC'
        };
        
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        this.setupSocketListeners();
        this.showLoading();
        this.fetchDashboardData();
    }
    
    getAuthToken() {
        return localStorage.getItem('token') || localStorage.getItem('authToken') || '';
    }

    redirectToLogin() {
        window.location.href = '/';
    }
    
    setupEventListeners() {
        // Filter controls
        document.getElementById('statusFilter').addEventListener('change', (e) => {
            this.filters.status = e.target.value;
            this.currentPage = 1;
            this.fetchDashboardData();
        });
        
        document.getElementById('sortBy').addEventListener('change', (e) => {
            this.filters.sortBy = e.target.value;
            this.currentPage = 1;
            this.fetchDashboardData();
        });
        
        document.getElementById('sortOrder').addEventListener('change', (e) => {
            this.filters.sortOrder = e.target.value;
            this.currentPage = 1;
            this.fetchDashboardData();
        });
        
        // Button controls
        document.getElementById('refreshBtn').addEventListener('click', () => {
            this.fetchDashboardData();
        });
        
        document.getElementById('createAuctionBtn').addEventListener('click', () => {
            window.location.href = '/'; // Redirect to main page for creating auctions
        });
        
        // Pagination
        document.getElementById('prevPage').addEventListener('click', () => {
            if (this.currentPage > 1) {
                this.currentPage--;
                this.fetchDashboardData();
            }
        });
        
        document.getElementById('nextPage').addEventListener('click', () => {
            this.currentPage++;
            this.fetchDashboardData();
        });
    }
    
    setupSocketListeners() {
        this.socket.on('connect', () => {
            console.log('Connected to server for real-time updates');
            this.socket.emit('joinDashboard');
        });
        
        this.socket.on('auction_update', (data) => {
            console.log('Real-time auction update:', data);
            this.handleRealtimeUpdate(data);
        });
        
        this.socket.on('bid_update', (data) => {
            console.log('Real-time bid update:', data);
            this.handleRealtimeUpdate(data);
        });
        
        this.socket.on('new_activity', (data) => {
            console.log('New activity:', data);
            this.addActivityItem(data);
        });
    }
    
    async fetchDashboardData() {
        const token = this.getAuthToken();
        if (!token) {
            this.showError('Please log in to view your dashboard.');
            this.hideLoading();
            this.redirectToLogin();
            return;
        }

        try {
            const params = new URLSearchParams({
                page: this.currentPage,
                limit: this.pageSize,
                ...this.filters
            });
            
            const response = await fetch(`/api/user/dashboard?${params}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await response.json();
            
            if (data.success) {
                this.updateDashboard(data.data);
            } else {
                console.error('Failed to fetch dashboard data:', data.error);
                this.showError('Failed to load dashboard data');
            }
        } catch (error) {
            console.error('Error fetching dashboard data:', error);
            this.showError('Network error while loading dashboard');
        } finally {
            this.hideLoading();
        }
    }
    
    updateDashboard(data) {
        // Update statistics
        this.updateStatistics(data.stats);
        
        // Update auctions grid
        this.updateAuctionsGrid(data.auctions.items);
        
        // Update pagination
        this.updatePagination(data.auctions.pagination);
        
        // Update activity feed
        this.updateActivityFeed(data.recentActivity);
        
        // Update active bids
        this.updateActiveBids(data.activeBids);
        
        // Update showing count
        document.getElementById('showingCount').textContent = data.auctions.items.length;
    }
    
    updateStatistics(stats) {
        document.getElementById('totalAuctions').textContent = stats.total_auctions_created || 0;
        document.getElementById('activeAuctions').textContent = stats.active_auctions || 0;
        document.getElementById('totalBids').textContent = stats.total_bids_placed || 0;
        document.getElementById('auctionsWon').textContent = stats.auctions_won || 0;
    }
    
    updateAuctionsGrid(auctions) {
        const grid = document.getElementById('auctionsGrid');
        grid.innerHTML = '';
        
        if (auctions.length === 0) {
            grid.innerHTML = '<div class="col-span-full text-center py-8 text-gray-500">No auctions found. Create your first auction!</div>';
            return;
        }
        
        auctions.forEach(auction => {
            const card = this.createAuctionCard(auction);
            grid.appendChild(card);
        });
    }
    
    createAuctionCard(auction) {
        const card = document.createElement('div');
        card.className = 'auction-card';
        card.onclick = () => this.viewAuction(auction.id);
        
        const statusClass = auction.status === 'active' ? 'status-active' : 
                           auction.status === 'closed' ? 'status-closed' : 'status-pending';
        
        const endTime = new Date(auction.end_time).toLocaleString();
        const createdTime = new Date(auction.created_at).toLocaleDateString();
        
        card.innerHTML = `
            <div class="p-4">
                <div class="flex justify-between items-start mb-2">
                    <h3 class="font-semibold text-lg truncate">${auction.title}</h3>
                    <span class="text-sm px-2 py-1 rounded ${statusClass} bg-opacity-20">
                        ${auction.status}
                    </span>
                </div>
                <p class="text-gray-600 text-sm mb-3 line-clamp-2">${auction.description}</p>
                <div class="space-y-2">
                    <div class="flex justify-between text-sm">
                        <span>Starting Bid:</span>
                        <span class="font-semibold">${auction.starting_bid} XLM</span>
                    </div>
                    <div class="flex justify-between text-sm">
                        <span>Current Bid:</span>
                        <span class="font-semibold">${auction.highest_bid || auction.starting_bid} XLM</span>
                    </div>
                    <div class="flex justify-between text-sm">
                        <span>Total Bids:</span>
                        <span class="font-semibold">${auction.bid_count || 0}</span>
                    </div>
                    <div class="flex justify-between text-sm">
                        <span>Ends:</span>
                        <span class="font-semibold">${endTime}</span>
                    </div>
                    <div class="flex justify-between text-sm">
                        <span>Created:</span>
                        <span class="font-semibold">${createdTime}</span>
                    </div>
                </div>
            </div>
        `;
        
        return card;
    }
    
    updatePagination(pagination) {
        const paginationEl = document.getElementById('pagination');
        const prevBtn = document.getElementById('prevPage');
        const nextBtn = document.getElementById('nextPage');
        const pageInfo = document.getElementById('pageInfo');
        const totalPages = pagination.totalPages || Math.ceil(pagination.total / pagination.limit);
        
        if (pagination.total > pagination.limit) {
            paginationEl.style.display = 'flex';
            pageInfo.textContent = `Page ${pagination.page} of ${totalPages}`;
            prevBtn.disabled = pagination.page <= 1;
            nextBtn.disabled = pagination.page >= totalPages;
        } else {
            paginationEl.style.display = 'none';
        }
    }
    
    updateActivityFeed(activities) {
        const feed = document.getElementById('activityFeed');
        feed.innerHTML = '';
        
        if (activities.length === 0) {
            feed.innerHTML = '<div class="text-center py-4 text-gray-500">No recent activity</div>';
            return;
        }
        
        activities.forEach(activity => {
            const item = this.createActivityItem(activity);
            feed.appendChild(item);
        });
    }
    
    createActivityItem(activity) {
        const item = document.createElement('div');
        item.className = 'activity-item';
        
        const timestamp = new Date(activity.timestamp).toLocaleString();
        const action = activity.is_winning_bid ? 'Won auction' : 'Placed bid';
        const amount = activity.amount ? `${activity.amount} XLM` : '';
        
        item.innerHTML = `
            <div class="flex justify-between items-start">
                <div>
                    <p class="font-medium">${action} on "${activity.auction_title}"</p>
                    <p class="text-sm text-gray-600">${amount} • ${timestamp}</p>
                </div>
                <span class="text-sm ${activity.auction_status === 'active' ? 'text-green-600' : 'text-gray-500'}">
                    ${activity.auction_status}
                </span>
            </div>
        `;
        
        return item;
    }
    
    updateActiveBids(bids) {
        const container = document.getElementById('activeBids');
        container.innerHTML = '';
        
        if (bids.length === 0) {
            container.innerHTML = '<div class="text-center py-4 text-gray-500">No active bids</div>';
            return;
        }
        
        bids.forEach(bid => {
            const bidItem = this.createBidItem(bid);
            container.appendChild(bidItem);
        });
    }
    
    createBidItem(bid) {
        const item = document.createElement('div');
        item.className = 'p-3 bg-gray-50 rounded-lg';
        
        const endTime = new Date(bid.end_time).toLocaleString();
        const timeLeft = this.getTimeLeft(bid.end_time);
        
        item.innerHTML = `
            <div class="flex justify-between items-start mb-2">
                <h4 class="font-medium truncate">${bid.auction_title}</h4>
                <span class="text-sm font-semibold text-purple-600">${bid.amount} XLM</span>
            </div>
            <div class="text-sm text-gray-600">
                <p>Your bid: ${bid.amount} XLM</p>
                <p>Ends: ${endTime}</p>
                <p class="font-medium ${timeLeft.includes('Ended') ? 'text-red-600' : 'text-green-600'}">${timeLeft}</p>
            </div>
        `;
        
        return item;
    }
    
    getTimeLeft(endTime) {
        const now = new Date();
        const end = new Date(endTime);
        const diff = end - now;
        
        if (diff <= 0) return 'Ended';
        
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        
        if (days > 0) return `${days}d ${hours}h left`;
        if (hours > 0) return `${hours}h ${minutes}m left`;
        return `${minutes}m left`;
    }
    
    viewAuction(auctionId) {
        window.location.href = `/auction/${auctionId}`;
    }
    
    handleRealtimeUpdate(data) {
        // Refresh dashboard data when real-time updates occur
        this.fetchDashboardData();
        
        // Announce update to screen readers
        const liveRegion = document.getElementById('aria-live-polite');
        liveRegion.textContent = `Dashboard updated: ${data.type} ${data.id}`;
    }
    
    addActivityItem(activity) {
        const feed = document.getElementById('activityFeed');
        const item = this.createActivityItem(activity);
        
        // Add to top of feed
        if (feed.firstChild) {
            feed.insertBefore(item, feed.firstChild);
        } else {
            feed.appendChild(item);
        }
        
        // Limit to 10 items
        while (feed.children.length > 10) {
            feed.removeChild(feed.lastChild);
        }
    }
    
    showLoading() {
        document.getElementById('loadingOverlay').style.display = 'flex';
    }
    
    hideLoading() {
        document.getElementById('loadingOverlay').style.display = 'none';
    }
    
    showError(message) {
        // Simple error display - could be enhanced
        alert(message);
    }
}

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new UserDashboard();
});
