// Enhanced Wallet Management System UI
class WalletManagementUI {
  constructor() {
    this.currentWallet = null;
    this.wallets = [];
    this.transactions = [];
    this.token = localStorage.getItem('authToken');
    this.apiBase = '/api';
    this.initializeUI();
  }

  async initializeUI() {
    // Create wallet management container
    this.createWalletManagerHTML();
    this.attachEventListeners();
    await this.loadWallets();
  }

  createWalletManagerHTML() {
    const container = document.createElement('div');
    container.id = 'wallet-management';
    container.className = 'wallet-management-container';
    container.innerHTML = `
      <div class="wallet-manager">
        <div class="wallet-header">
          <h2>Wallet Management System</h2>
          <div class="wallet-stats">
            <div class="stat">
              <span class="label">Total Balance</span>
              <span class="value" id="total-balance">0 XLM</span>
            </div>
            <div class="stat">
              <span class="label">Active Wallets</span>
              <span class="value" id="wallet-count">0</span>
            </div>
          </div>
        </div>

        <div class="wallet-tabs">
          <button class="tab-button active" data-tab="wallets">My Wallets</button>
          <button class="tab-button" data-tab="transactions">Transactions</button>
          <button class="tab-button" data-tab="security">Security</button>
          <button class="tab-button" data-tab="backup">Backup & Recovery</button>
        </div>

        <!-- Wallets Tab -->
        <div class="tab-content active" id="wallets-tab">
          <div class="tab-header">
            <h3>My Wallets</h3>
            <button id="create-wallet-btn" class="btn btn-primary">+ Create New Wallet</button>
          </div>

          <div id="wallets-list" class="wallets-list">
            <p class="empty-state">Loading wallets...</p>
          </div>

          <div id="create-wallet-modal" class="modal hidden">
            <div class="modal-content">
              <div class="modal-header">
                <h3>Create New Wallet</h3>
                <button class="close-btn">&times;</button>
              </div>
              <div class="modal-body">
                <form id="create-wallet-form">
                  <div class="form-group">
                    <label for="wallet-name">Wallet Name:</label>
                    <input type="text" id="wallet-name" required placeholder="e.g., Personal Wallet">
                  </div>
                  <div class="form-group">
                    <label for="network">Network:</label>
                    <select id="network">
                      <option value="testnet">Testnet</option>
                      <option value="mainnet">Mainnet</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label class="checkbox">
                      <input type="checkbox" id="backup-phrase-agree" required>
                      I understand I need to securely backup my secret key
                    </label>
                  </div>
                  <button type="submit" class="btn btn-primary">Create Wallet</button>
                </form>
              </div>
            </div>
          </div>
        </div>

        <!-- Transactions Tab -->
        <div class="tab-content" id="transactions-tab">
          <div class="tab-header">
            <h3>Transaction History</h3>
            <div class="transaction-filters">
              <select id="transaction-wallet-filter">
                <option value="">All Wallets</option>
              </select>
            </div>
          </div>

          <div id="transactions-list" class="transactions-list">
            <p class="empty-state">Loading transactions...</p>
          </div>
        </div>

        <!-- Security Tab -->
        <div class="tab-content" id="security-tab">
          <div class="tab-header">
            <h3>Security Settings</h3>
          </div>

          <div id="security-settings" class="security-settings">
            <p class="empty-state">Select a wallet to view security settings</p>
          </div>
        </div>

        <!-- Backup & Recovery Tab -->
        <div class="tab-content" id="backup-tab">
          <div class="tab-header">
            <h3>Backup & Recovery</h3>
          </div>

          <div id="backup-settings" class="backup-settings">
            <p class="empty-state">Select a wallet to view backup options</p>
          </div>
        </div>
      </div>

      <style>
        .wallet-management-container {
          max-width: 1200px;
          margin: 20px auto;
          padding: 20px;
          background: var(--bg-color, #fff);
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }

        .wallet-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 30px;
          border-bottom: 2px solid var(--border-color, #eee);
          padding-bottom: 20px;
        }

        .wallet-header h2 {
          margin: 0;
          font-size: 28px;
          color: var(--text-primary, #000);
        }

        .wallet-stats {
          display: flex;
          gap: 30px;
        }

        .stat {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
        }

        .stat .label {
          font-size: 12px;
          color: var(--text-secondary, #666);
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 5px;
        }

        .stat .value {
          font-size: 20px;
          font-weight: bold;
          color: var(--primary-color, #007bff);
        }

        .wallet-tabs {
          display: flex;
          gap: 10px;
          margin-bottom: 30px;
          border-bottom: 1px solid var(--border-color, #eee);
        }

        .tab-button {
          padding: 12px 20px;
          background: none;
          border: none;
          border-bottom: 3px solid transparent;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          color: var(--text-secondary, #666);
          transition: all 0.3s ease;
        }

        .tab-button.active {
          color: var(--primary-color, #007bff);
          border-bottom-color: var(--primary-color, #007bff);
        }

        .tab-button:hover {
          color: var(--primary-color, #007bff);
        }

        .tab-content {
          display: none;
          animation: fadeIn 0.3s ease;
        }

        .tab-content.active {
          display: block;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .tab-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }

        .tab-header h3 {
          margin: 0;
          font-size: 20px;
        }

        .wallets-list,
        .transactions-list {
          display: grid;
          gap: 15px;
        }

        .wallet-card {
          background: var(--card-bg, #f8f9fa);
          border: 1px solid var(--border-color, #eee);
          border-radius: 8px;
          padding: 20px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          transition: all 0.3s ease;
        }

        .wallet-card:hover {
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          transform: translateY(-2px);
        }

        .wallet-card.active {
          border-color: var(--primary-color, #007bff);
          background: var(--active-card-bg, #f0f7ff);
        }

        .wallet-info {
          flex: 1;
        }

        .wallet-name {
          font-size: 16px;
          font-weight: bold;
          margin-bottom: 5px;
        }

        .wallet-address {
          font-size: 12px;
          color: var(--text-secondary, #666);
          font-family: monospace;
          word-break: break-all;
        }

        .wallet-balance {
          font-size: 18px;
          font-weight: bold;
          color: var(--primary-color, #007bff);
          margin: 10px 0;
        }

        .wallet-actions {
          display: flex;
          gap: 10px;
          margin-left: 20px;
        }

        .btn {
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
          transition: all 0.3s ease;
        }

        .btn-primary {
          background: var(--primary-color, #007bff);
          color: white;
        }

        .btn-primary:hover {
          background: var(--primary-dark, #0056b3);
        }

        .btn-secondary {
          background: var(--secondary-color, #6c757d);
          color: white;
        }

        .btn-secondary:hover {
          background: var(--secondary-dark, #545b62);
        }

        .btn-danger {
          background: var(--danger-color, #dc3545);
          color: white;
        }

        .btn-danger:hover {
          background: var(--danger-dark, #c82333);
        }

        .btn-success {
          background: var(--success-color, #28a745);
          color: white;
        }

        .btn-success:hover {
          background: var(--success-dark, #218838);
        }

        .transaction-row {
          background: var(--card-bg, #f8f9fa);
          border: 1px solid var(--border-color, #eee);
          border-radius: 6px;
          padding: 15px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .transaction-type {
          display: inline-block;
          padding: 4px 8px;
          border-radius: 3px;
          font-size: 11px;
          font-weight: bold;
          text-transform: uppercase;
        }

        .transaction-type.send {
          background: #ffe0e0;
          color: #c00;
        }

        .transaction-type.receive {
          background: #e0ffe0;
          color: #0a0;
        }

        .transaction-type.bid {
          background: #e0e0ff;
          color: #00a;
        }

        .modal {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }

        .modal.hidden {
          display: none;
        }

        .modal-content {
          background: white;
          border-radius: 8px;
          max-width: 500px;
          width: 90%;
          max-height: 80vh;
          overflow-y: auto;
        }

        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 20px;
          border-bottom: 1px solid var(--border-color, #eee);
        }

        .modal-header h3 {
          margin: 0;
        }

        .close-btn {
          background: none;
          border: none;
          font-size: 28px;
          cursor: pointer;
          color: var(--text-secondary, #666);
        }

        .modal-body {
          padding: 20px;
        }

        .form-group {
          margin-bottom: 15px;
        }

        .form-group label {
          display: block;
          margin-bottom: 5px;
          font-weight: 500;
          color: var(--text-primary, #000);
        }

        .form-group input,
        .form-group select {
          width: 100%;
          padding: 10px;
          border: 1px solid var(--border-color, #ddd);
          border-radius: 4px;
          font-size: 14px;
        }

        .form-group input:focus,
        .form-group select:focus {
          outline: none;
          border-color: var(--primary-color, #007bff);
          box-shadow: 0 0 0 3px rgba(0,123,255,0.1);
        }

        .empty-state {
          text-align: center;
          color: var(--text-secondary, #666);
          padding: 40px 20px;
        }

        .security-settings,
        .backup-settings {
          background: var(--card-bg, #f8f9fa);
          border-radius: 8px;
          padding: 20px;
        }

        .setting-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 15px 0;
          border-bottom: 1px solid var(--border-color, #eee);
        }

        .setting-item:last-child {
          border-bottom: none;
        }

        @media (max-width: 768px) {
          .wallet-management-container {
            padding: 10px;
          }

          .wallet-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 15px;
          }

          .wallet-stats {
            flex-direction: column;
            align-items: flex-start;
            gap: 15px;
          }

          .wallet-card {
            flex-direction: column;
            align-items: flex-start;
          }

          .wallet-actions {
            width: 100%;
            margin-left: 0;
            margin-top: 15px;
            flex-wrap: wrap;
          }

          .tab-button {
            padding: 10px 15px;
            font-size: 12px;
          }

          .transaction-row {
            flex-direction: column;
            align-items: flex-start;
            gap: 10px;
          }
        }

        /* Dark mode support */
        @media (prefers-color-scheme: dark) {
          .wallet-management-container {
            background: #1e1e1e;
            --bg-color: #1e1e1e;
            --text-primary: #e0e0e0;
            --text-secondary: #a0a0a0;
            --card-bg: #2a2a2a;
            --border-color: #404040;
          }

          .modal-content {
            background: #1e1e1e;
          }
        }
      </style>
    `;

    document.body.appendChild(container);
  }

  attachEventListeners() {
    // Tab navigation
    document.querySelectorAll('.tab-button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tabName = e.target.dataset.tab;
        this.switchTab(tabName);
      });
    });

    // Create wallet button
    document.getElementById('create-wallet-btn')?.addEventListener('click', () => {
      document.getElementById('create-wallet-modal').classList.remove('hidden');
    });

    // Close modal
    document.querySelector('.close-btn')?.addEventListener('click', () => {
      document.getElementById('create-wallet-modal').classList.add('hidden');
    });

    // Create wallet form
    document.getElementById('create-wallet-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.createNewWallet();
    });
  }

  switchTab(tabName) {
    // Update buttons
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    // Update content
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(`${tabName}-tab`).classList.add('active');

    // Load tab-specific content
    if (tabName === 'transactions') {
      this.loadTransactions();
    } else if (tabName === 'security') {
      this.loadSecuritySettings();
    } else if (tabName === 'backup') {
      this.loadBackupSettings();
    }
  }

  async loadWallets() {
    try {
      const response = await fetch(`${this.apiBase}/wallets`, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });

      if (!response.ok) throw new Error('Failed to load wallets');

      const data = await response.json();
      this.wallets = data.wallets || [];

      // Update UI
      this.updateWalletsList();
      this.updateWalletStats();
      this.updateTransactionFilter();
    } catch (error) {
      console.error('Error loading wallets:', error);
      document.getElementById('wallets-list').innerHTML = '<p class="empty-state">Failed to load wallets</p>';
    }
  }

  updateWalletsList() {
    const list = document.getElementById('wallets-list');

    if (this.wallets.length === 0) {
      list.innerHTML = '<p class="empty-state">No wallets yet. Create one to get started.</p>';
      return;
    }

    list.innerHTML = this.wallets.map(wallet => `
      <div class="wallet-card ${wallet.is_active ? 'active' : ''}">
        <div class="wallet-info">
          <div class="wallet-name">${wallet.name}</div>
          <div class="wallet-address">${wallet.public_key}</div>
          <div class="wallet-balance">${wallet.balance} XLM</div>
          <div style="font-size: 12px; color: var(--text-secondary, #666);">
            ${wallet.network} • Created: ${new Date(wallet.created_at).toLocaleDateString()}
          </div>
        </div>
        <div class="wallet-actions">
          ${!wallet.is_active ? `<button class="btn btn-primary" onclick="window.walletUI.switchWallet('${wallet.id}')">Use</button>` : ''}
          <button class="btn btn-secondary" onclick="window.walletUI.showWalletDetails('${wallet.id}')">Details</button>
          <button class="btn btn-danger" onclick="window.walletUI.deleteWallet('${wallet.id}')">Delete</button>
        </div>
      </div>
    `).join('');
  }

  async updateWalletStats() {
    try {
      const response = await fetch(`${this.apiBase}/wallets/balance`, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });

      const data = await response.json();
      document.getElementById('total-balance').textContent = `${data.totalBalance} XLM`;
      document.getElementById('wallet-count').textContent = this.wallets.length;
    } catch (error) {
      console.error('Error updating wallet stats:', error);
    }
  }

  async createNewWallet() {
    const name = document.getElementById('wallet-name').value;
    const network = document.getElementById('network').value;

    try {
      const response = await fetch(`${this.apiBase}/wallets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({ walletName: name, network })
      });

      if (!response.ok) throw new Error('Failed to create wallet');

      const data = await response.json();
      alert(`Wallet created! Your public key:\n${data.publicKey}\n\nStore your secret key securely!`);

      document.getElementById('create-wallet-modal').classList.add('hidden');
      document.getElementById('create-wallet-form').reset();
      await this.loadWallets();
    } catch (error) {
      console.error('Error creating wallet:', error);
      alert('Failed to create wallet');
    }
  }

  async switchWallet(walletId) {
    try {
      const response = await fetch(`${this.apiBase}/wallets/switch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({ walletId })
      });

      if (!response.ok) throw new Error('Failed to switch wallet');

      await this.loadWallets();
      alert('Wallet switched successfully!');
    } catch (error) {
      console.error('Error switching wallet:', error);
      alert('Failed to switch wallet');
    }
  }

  async deleteWallet(walletId) {
    if (!confirm('Are you sure you want to delete this wallet? This action cannot be undone.')) return;

    try {
      const response = await fetch(`${this.apiBase}/wallets/${walletId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${this.token}` }
      });

      if (!response.ok) throw new Error('Failed to delete wallet');

      await this.loadWallets();
      alert('Wallet deleted successfully!');
    } catch (error) {
      console.error('Error deleting wallet:', error);
      alert('Failed to delete wallet');
    }
  }

  async loadTransactions() {
    try {
      const response = await fetch(`${this.apiBase}/wallets/transactions/history?limit=100`, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });

      const data = await response.json();
      this.transactions = data.transactions || [];
      this.renderTransactions();
    } catch (error) {
      console.error('Error loading transactions:', error);
    }
  }

  renderTransactions() {
    const list = document.getElementById('transactions-list');

    if (this.transactions.length === 0) {
      list.innerHTML = '<p class="empty-state">No transactions yet</p>';
      return;
    }

    list.innerHTML = this.transactions.map(tx => `
      <div class="transaction-row">
        <div>
          <span class="transaction-type ${tx.transaction_type}">${tx.transaction_type}</span>
          <div style="font-size: 12px; color: var(--text-secondary, #666); margin-top: 5px;">
            ${new Date(tx.timestamp).toLocaleString()}
          </div>
        </div>
        <div>${tx.amount} XLM</div>
      </div>
    `).join('');
  }

  updateTransactionFilter() {
    const filter = document.getElementById('transaction-wallet-filter');
    if (!filter) return;

    filter.innerHTML = '<option value="">All Wallets</option>' +
      this.wallets.map(w => `<option value="${w.id}">${w.name}</option>`).join('');
  }

  async loadSecuritySettings() {
    // Placeholder for security settings
    document.getElementById('security-settings').innerHTML = `
      <div class="setting-item">
        <span>Two-Factor Authentication (2FA)</span>
        <button class="btn btn-primary">Enable</button>
      </div>
      <div class="setting-item">
        <span>Security PIN</span>
        <button class="btn btn-primary">Set PIN</button>
      </div>
    `;
  }

  async loadBackupSettings() {
    // Placeholder for backup settings
    document.getElementById('backup-settings').innerHTML = `
      <div class="setting-item">
        <span>Create Backup Recovery Phrase</span>
        <button class="btn btn-primary">Create Backup</button>
      </div>
      <div class="setting-item">
        <span>Restore from Recovery Phrase</span>
        <button class="btn btn-secondary">Restore</button>
      </div>
    `;
  }

  showWalletDetails(walletId) {
    const wallet = this.wallets.find(w => w.id === walletId);
    if (!wallet) return;

    alert(`Wallet Details:\n\nName: ${wallet.name}\nPublic Key: ${wallet.public_key}\nBalance: ${wallet.balance} XLM\nNetwork: ${wallet.network}`);
  }
}

// Initialize wallet management UI when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.walletUI = new WalletManagementUI();
  });
} else {
  window.walletUI = new WalletManagementUI();
}
