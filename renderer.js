// renderer.js
// Initialize the terminal
const { Terminal } = require('xterm');
const { FitAddon } = require('xterm-addon-fit');
const { WebLinksAddon } = require('xterm-addon-web-links');
const { Client } = require('ssh2');

// Get UI elements
const hostInput = document.getElementById('host');
const portInput = document.getElementById('port');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const newTabBtn = document.getElementById('new-tab-btn');
const tabContainer = document.getElementById('tab-container');
const terminalsContainer = document.getElementById('terminals-container');

// Keep track of all terminal tabs
const terminals = [];
let activeTabIndex = -1;

// Tab counter for unique IDs
let tabCounter = 0;

// Create a new terminal tab
function createTab(title = 'Local') {
  const tabId = tabCounter++;
  const isFirstTab = terminals.length === 0;
  
  // Create tab button
  const tab = document.createElement('button');
  tab.className = `tab ${isFirstTab ? 'active' : ''}`;
  tab.id = `tab-${tabId}`;
  tab.innerHTML = `
    <div class="status-indicator" id="status-indicator-${tabId}"></div>
    <span id="tab-title-${tabId}">${title}</span>
    <button class="tab-close" id="close-tab-${tabId}">×</button>
  `;
  
  // Insert before the new tab button
  tabContainer.insertBefore(tab, newTabBtn);
  
  // Create terminal container
  const terminalWrapper = document.createElement('div');
  terminalWrapper.className = `terminal-wrapper ${isFirstTab ? 'active' : ''}`;
  terminalWrapper.id = `terminal-wrapper-${tabId}`;
  terminalsContainer.appendChild(terminalWrapper);
  
  // Create terminal instance
  const terminal = new Terminal({
    fontFamily: '"Cascadia Code", "Menlo", monospace',
    fontSize: 14,
    lineHeight: 1.2,
    cursorBlink: true,
    theme: {
      background: '#1E1E1E',
      foreground: '#F8F8F2',
      cursor: '#F8F8F2'
    }
  });
  
  // Create and load addons
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon());
  
  // Open the terminal in the container element
  terminal.open(terminalWrapper);
  
  // Make the terminal fit its container
  fitAddon.fit();
  
  // Initialize terminal with welcome message
  terminal.writeln('Welcome to SSH Terminal');
  terminal.writeln('Configure your connection settings above and click Connect');
  terminal.write('\r\n> ');
  
  // Create a terminal object to track state
  const terminalObj = {
    id: tabId,
    title: title,
    element: terminalWrapper,
    terminal: terminal,
    fitAddon: fitAddon,
    sshSession: null,
    sshStream: null,
    isConnected: false
  };
  
  // Add to terminals array
  terminals.push(terminalObj);
  
  // Set as active if it's the first tab
  if (isFirstTab) {
    activeTabIndex = 0;
  }
  
  // Set up event listeners for the tab
  tab.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-close')) {
      return; // Handle in the close button event
    }
    activateTab(tabId);
  });
  
  // Add context menu support
  tab.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    activateTab(tabId);
    showContextMenu(e.pageX, e.pageY);
  });
  
  // Tab close button
  const closeBtn = document.getElementById(`close-tab-${tabId}`);
  closeBtn.addEventListener('click', () => {
    closeTab(tabId);
  });
  
  // Handle terminal data events
  terminal.onData(data => {
    handleTerminalData(tabId, data);
  });
  
  return terminalObj;
}

// Activate a tab by its ID
function activateTab(tabId) {
  // Find the tab index
  const index = terminals.findIndex(t => t.id === tabId);
  if (index === -1) return;
  
  // Update active tab index
  activeTabIndex = index;
  
  // Update tab and terminal visibility
  for (let i = 0; i < terminals.length; i++) {
    const t = terminals[i];
    const tabEl = document.getElementById(`tab-${t.id}`);
    
    if (i === activeTabIndex) {
      tabEl.classList.add('active');
      t.element.classList.add('active');
    } else {
      tabEl.classList.remove('active');
      t.element.classList.remove('active');
    }
  }
  
  // Update UI state based on active terminal connection
  const activeTerminal = terminals[activeTabIndex];
  setConnectionUIState(activeTerminal.isConnected, activeTerminal.isConnected);
  
  // Resize the terminal to fit its container
  activeTerminal.fitAddon.fit();
}

// Close a tab by its ID
function closeTab(tabId) {
  // Find the tab index
  const index = terminals.findIndex(t => t.id === tabId);
  if (index === -1) return;
  
  const terminal = terminals[index];
  
  // Disconnect if connected
  if (terminal.isConnected) {
    disconnectSSH(terminal);
  }
  
  // Remove DOM elements
  const tabEl = document.getElementById(`tab-${tabId}`);
  tabEl.remove();
  terminal.element.remove();
  
  // Remove from terminals array
  terminals.splice(index, 1);
  
  // Update active tab if needed
  if (terminals.length === 0) {
    // Create a new tab if none remain
    createTab();
  } else if (index === activeTabIndex) {
    // Activate the previous tab or the first one
    const newIndex = Math.max(0, index - 1);
    activateTab(terminals[newIndex].id);
  } else if (activeTabIndex > index) {
    // Adjust active tab index if a tab before it was removed
    activeTabIndex--;
  }
}

// Handle terminal data input
function handleTerminalData(tabId, data) {
  // Find the terminal
  const index = terminals.findIndex(t => t.id === tabId);
  if (index === -1) return;
  
  const terminal = terminals[index];
  
  if (terminal.isConnected && terminal.sshStream) {
    terminal.sshStream.write(data);
  } else {
    // Echo back the typed character for local terminal
    terminal.terminal.write(data);
    
    // If Enter is pressed, show prompt again
    if (data === '\r') {
      terminal.terminal.write('\n> ');
    }
  }
}

// Function to connect to SSH server
function connectSSH() {
  if (activeTabIndex === -1 || terminals.length === 0) return;
  
  const terminalObj = terminals[activeTabIndex];
  const terminal = terminalObj.terminal;
  
  // Get connection details
  const host = hostInput.value.trim();
  const port = parseInt(portInput.value, 10) || 22;
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  
  if (!host || !username) {
    terminal.writeln('\r\nPlease provide host and username');
    terminal.write('\r\n> ');
    return;
  }
  
  // Update tab title
  const tabTitle = document.getElementById(`tab-title-${terminalObj.id}`);
  tabTitle.textContent = `${username}@${host}`;
  terminalObj.title = `${username}@${host}`;
  
  // Disable UI elements during connection
  setConnectionUIState(true);
  
  terminal.writeln(`\r\nConnecting to ${host}:${port} as ${username}...`);
  
  const conn = new Client();
  
  conn.on('ready', () => {
    terminalObj.isConnected = true;
    terminalObj.sshSession = conn;
    terminal.writeln('\r\nConnection established! Starting shell...');
    setConnectionUIState(true, true);
    
    // Update tab status indicator
    const statusIndicator = document.getElementById(`status-indicator-${terminalObj.id}`);
    statusIndicator.classList.add('connected');
    
    conn.shell((err, stream) => {
      if (err) {
        terminal.writeln(`\r\nError opening shell: ${err.message}`);
        disconnectSSH(terminalObj);
        return;
      }
      
      terminalObj.sshStream = stream;
      
      stream.on('data', (data) => {
        terminal.write(data.toString('utf-8'));
      });
      
      stream.on('close', () => {
        terminal.writeln('\r\nSSH shell connection closed.');
        disconnectSSH(terminalObj);
      });
      
      stream.stderr.on('data', (data) => {
        terminal.writeln(`\r\nERROR: ${data.toString('utf-8')}`);
      });
      
      // Set up window dimensions
      const dimensions = terminalObj.fitAddon.proposeDimensions();
      if (dimensions) {
        stream.setWindow(dimensions.rows, dimensions.cols);
      }
    });
  });
  
  conn.on('error', (err) => {
    terminal.writeln(`\r\nConnection error: ${err.message}`);
    disconnectSSH(terminalObj);
  });
  
  conn.on('end', () => {
    terminal.writeln('\r\nConnection ended by server.');
    disconnectSSH(terminalObj);
  });
  
  conn.on('close', () => {
    if (terminalObj.isConnected) {
      terminal.writeln('\r\nConnection closed.');
      disconnectSSH(terminalObj);
    }
  });
  
  // Connect to the server
  conn.connect({
    host: host,
    port: port,
    username: username,
    password: password,
    keepaliveInterval: 10000, // Send keepalive packet every 10 seconds
    keepaliveCountMax: 3      // Allow 3 consecutive failed keepalive packets
  });
}

// Function to disconnect from SSH server
function disconnectSSH(terminalObj = null) {
  if (!terminalObj) {
    if (activeTabIndex === -1 || terminals.length === 0) return;
    terminalObj = terminals[activeTabIndex];
  }
  
  if (terminalObj.sshStream) {
    terminalObj.sshStream.end();
    terminalObj.sshStream = null;
  }
  
  if (terminalObj.sshSession) {
    terminalObj.sshSession.end();
    terminalObj.sshSession = null;
  }
  
  terminalObj.isConnected = false;
  
  // Update tab status indicator
  const statusIndicator = document.getElementById(`status-indicator-${terminalObj.id}`);
  statusIndicator.classList.remove('connected');
  
  // Reset UI state if this is the active tab
  if (terminals[activeTabIndex] && terminals[activeTabIndex].id === terminalObj.id) {
    setConnectionUIState(false);
  }
  
  terminalObj.terminal.write('\r\n> ');
}

// Function to handle terminal resizing
function handleTerminalResize() {
  for (const terminal of terminals) {
    terminal.fitAddon.fit();
    
    if (terminal.isConnected && terminal.sshStream) {
      const dims = terminal.fitAddon.proposeDimensions();
      if (dims) {
        terminal.sshStream.setWindow(dims.rows, dims.cols);
      }
    }
  }
}

// Function to update UI based on connection state
function setConnectionUIState(connecting, connected = false) {
  // Update button states
  connectBtn.disabled = connecting || connected;
  disconnectBtn.disabled = !connected;
  
  // Update input fields
  hostInput.disabled = connecting || connected;
  portInput.disabled = connecting || connected;
  usernameInput.disabled = connecting || connected;
  passwordInput.disabled = connecting || connected;
}

// Create the first tab
createTab();

// Set up event listeners for UI controls
connectBtn.addEventListener('click', connectSSH);
disconnectBtn.addEventListener('click', () => {
  if (activeTabIndex !== -1) {
    disconnectSSH(terminals[activeTabIndex]);
  }
});

// New tab button
newTabBtn.addEventListener('click', () => {
  const newTerminal = createTab();
  activateTab(newTerminal.id);
});

// Allow pressing Enter in the password field to connect
passwordInput.addEventListener('keyup', (event) => {
  if (event.key === 'Enter') {
    connectBtn.click();
  }
});

// Handle window resize
window.addEventListener('resize', handleTerminalResize);