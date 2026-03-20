'use strict';

const mineflayer = require('mineflayer');
const { Movements, pathfinder, goals } = require('mineflayer-pathfinder');
const { GoalBlock } = goals;
const config = require('./settings.json');
const express = require('express');
const http = require('http');
const https = require('https');

// ============================================================
// EXPRESS SERVER - Keep Render/Aternos alive
// ============================================================
const app = express();
const PORT = process.env.PORT || 5000;

let botState = {
  connected: false,
  lastActivity: Date.now(),
  reconnectAttempts: 0,
  startTime: Date.now(),
  errors: [],
  wasThrottled: false
};

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <title>${config.name} Dashboard</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
          :root { --bg: #0f172a; --container-bg: #111827; --card-bg: #1f2937; --accent: #2dd4bf; --text-main: #f8fafc; --text-dim: #94a3b8; }
          body { font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text-main); display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
          .container { background: var(--container-bg); padding: 3rem 2rem; border-radius: 2rem; width: 420px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); border: 1px solid #1f2937; text-align: center; }
          h1 { font-size: 1.875rem; font-weight: 700; margin-bottom: 2.5rem; display: flex; align-items: center; justify-content: center; gap: 0.75rem; color: #f1f5f9; }
          .card { background: var(--card-bg); border-radius: 1rem; padding: 1.25rem 1.75rem; margin-bottom: 1rem; text-align: left; border-left: 4px solid var(--accent); position: relative; overflow: hidden; transition: transform 0.2s; }
          .card:hover { transform: translateX(5px); }
          .label { font-size: 0.75rem; font-weight: 600; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; }
          .value { font-size: 1.25rem; font-weight: 700; color: var(--accent); display: flex; align-items: center; gap: 0.5rem; text-shadow: 0 0 15px rgba(45, 212, 191, 0.3); }
          .dot { width: 12px; height: 12px; border-radius: 50%; background: #4ade80; box-shadow: 0 0 10px #4ade80; display: inline-block; }
          .dot.offline { background: #f87171; box-shadow: 0 0 10px #f87171; }
          .pulse { animation: pulse-animation 2s infinite; }
          @keyframes pulse-animation { 0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.7); } 70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(74, 222, 128, 0); } 100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(74, 222, 128, 0); } }
          .btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.75rem; background: var(--accent); color: #0f172a; padding: 1rem 2rem; border-radius: 1rem; font-weight: 700; text-decoration: none; margin-top: 1.5rem; transition: all 0.2s; box-shadow: 0 0 20px rgba(45, 212, 191, 0.4); width: 100%; box-sizing: border-box; }
          .footer { margin-top: 1.5rem; font-size: 0.8125rem; color: #4b5563; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🤖 ${config.name}</h1>
          <div class="card"><div class="label">Status</div><div class="value"><span id="status-dot" class="dot pulse"></span><span id="status-text">Connecting...</span></div></div>
          <div class="card"><div class="label">Uptime</div><div class="value" id="uptime-text">0h 0m 0s</div></div>
          <div class="card"><div class="label">Bot Username</div><div class="value" id="username-text">...</div></div>
          <div class="card"><div class="label">Server</div><div class="value" style="font-size: 1.1rem; color: #5eead4;">${config.server.ip}</div></div>
          <a href="/tutorial" class="btn">📘 View Setup Guide</a>
          <div class="footer">Auto-refreshing every 5s</div>
        </div>
        <script>
          async function update() {
            try {
              const r = await fetch('/health');
              const data = await r.json();
              document.getElementById('status-text').innerText = data.status === 'connected' ? 'Online' : 'Reconnecting...';
              document.getElementById('status-dot').className = data.status === 'connected' ? 'dot pulse' : 'dot offline pulse';
              document.getElementById('uptime-text').innerText = Math.floor(data.uptime/3600) + 'h ' + Math.floor((data.uptime%3600)/60) + 'm ' + (data.uptime%60) + 's';
              document.getElementById('username-text').innerText = data.username;
            } catch (e) {}
          }
          setInterval(update, 5000); update();
        </script>
      </body>
    </html>
  `);
});

app.get('/health', (req, res) => {
  res.json({
    status: botState.connected ? 'connected' : 'disconnected',
    username: config['bot-account'].username,
    uptime: Math.floor((Date.now() - botState.startTime) / 1000),
    coords: (bot && bot.entity) ? bot.entity.position : null
  });
});

app.get('/ping', (req, res) => res.send('pong'));

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] HTTP server started on port ${server.address().port}`);
});

// ============================================================
// UTILS
// ============================================================
function generateRandomName() {
  // Generates a random number-based string to ensure a unique login
  return "Bot_" + Math.floor(Math.random() * 99999999);
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
}

// ============================================================
// SELF-PING & RECONNECTION LOGIC
// ============================================================
let bot = null;
let activeIntervals = [];
let reconnectTimeoutId = null;
let connectionTimeoutId = null;
let isReconnecting = false;

function clearBotTimeouts() {
  if (reconnectTimeoutId) { clearTimeout(reconnectTimeoutId); reconnectTimeoutId = null; }
  if (connectionTimeoutId) { clearTimeout(connectionTimeoutId); connectionTimeoutId = null; }
}

function clearAllIntervals() {
  activeIntervals.forEach(id => clearInterval(id));
  activeIntervals = [];
}

function addInterval(callback, delay) {
  const id = setInterval(callback, delay);
  activeIntervals.push(id);
  return id;
}

function createBot() {
  if (isReconnecting) return;

  if (bot) {
    clearAllIntervals();
    try { bot.removeAllListeners(); bot.end(); } catch (e) {}
    bot = null;
  }

  console.log(`[Bot] Connecting as: ${config['bot-account'].username}`);

  try {
    const botVersion = config.server.version && config.server.version.trim() !== '' ? config.server.version : false;
    bot = mineflayer.createBot({
      username: config['bot-account'].username,
      host: config.server.ip,
      port: config.server.port,
      version: botVersion,
      hideErrors: false
    });

    bot.loadPlugin(pathfinder);

    clearBotTimeouts();
    connectionTimeoutId = setTimeout(() => {
      if (!botState.connected) {
        console.log('[Bot] Connection timed out.');
        scheduleReconnect();
      }
    }, 120000);

    let spawnHandled = false;
    bot.once('spawn', () => {
      if (spawnHandled) return;
      spawnHandled = true;
      clearBotTimeouts();
      botState.connected = true;
      botState.reconnectAttempts = 0;
      isReconnecting = false;
      console.log(`[Bot] [+] Spawned as ${bot.username}`);
      
      const mcData = require('minecraft-data')(bot.version);
      const defaultMove = new Movements(bot, mcData);
      initializeModules(bot, mcData, defaultMove);
    });

    bot.on('kicked', (reason) => {
      console.log(`[Bot] Kicked: ${reason}`);
      botState.connected = false;
    });

    bot.on('end', (reason) => {
      console.log(`[Bot] Disconnected: ${reason}`);
      botState.connected = false;
      scheduleReconnect();
    });

    bot.on('error', (err) => {
      console.log(`[Bot] Error: ${err.message}`);
    });

  } catch (err) {
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  clearBotTimeouts();
  if (isReconnecting) return;
  isReconnecting = true;

  // NEW LOGIC: Change name randomly on every reconnect attempt
  const newName = generateRandomName();
  config['bot-account'].username = newName;
  console.log(`[Bot] Identity randomized to: ${newName}`);

  botState.reconnectAttempts++;
  const delay = Math.min(5000 * Math.pow(2, botState.reconnectAttempts), 60000);
  
  console.log(`[Bot] Retrying in ${delay / 1000}s...`);
  reconnectTimeoutId = setTimeout(() => {
    reconnectTimeoutId = null;
    isReconnecting = false;
    createBot();
  }, delay);
}

// ============================================================
// MODULES (Simplified for brevity)
// ============================================================
function initializeModules(bot, mcData, defaultMove) {
  // Anti-AFK
  addInterval(() => { if (bot && botState.connected) bot.swingArm(); }, 15000);
  
  // Auto-Auth
  if (config.utils['auto-auth'] && config.utils['auto-auth'].enabled) {
    bot.on('messagestr', (msg) => {
      if (msg.includes('/login') || msg.includes('/register')) {
        bot.chat(`/login ${config.utils['auto-auth'].password}`);
      }
    });
  }
}

// ============================================================
// CRASH PROTECTION
// ============================================================
process.on('uncaughtException', (err) => {
  console.log(`[Crash] Recovering from: ${err.message}`);
  isReconnecting = false; 
  scheduleReconnect();
});

console.log('Bot v2.5 - Identity Randomizer Active');
createBot();
