const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { Server } = require('socket.io');

const app = express();

// SECURITY UPDATE: Mitigate TLS/CA vulnerabilities and bypass flaws
// 1. Hide the Express framework signature
app.disable('x-powered-by');

// 2. Enforce HTTP Strict Transport Security (HSTS) and prevent MIME-sniffing
// This prevents attackers from forcing a downgrade to HTTP if the TLS CA is compromised
app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

app.use(cors());

// Serve test page at fourthroom.org/test
app.get('/test', (req, res) => {
  res.sendFile(path.join(__dirname, 'test.html'));
});

// Serve all static files (HTML, CSS, JSON, images) from the current folder
app.use(express.static(__dirname));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Twilio Client Setup (Environment Variables)
const twilioSid = process.env.TWILIO_ACCOUNT_SID;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
let twilioClient = null;

if (twilioSid && twilioAuthToken) {
  const twilio = require('twilio');
  twilioClient = twilio(twilioSid, twilioAuthToken);
  console.log('[Twilio] NTS TURN Service Initialized');
} else {
  console.warn('[Twilio] Credentials missing. Falling back to public STUN.');
}

// Endpoint to provide ephemeral ICE servers (STUN + TURN)
app.get('/api/ice-servers', async (req, res) => {
  const fallbackServers = [{ urls: 'stun:stun.l.google.com:19302' }];

  if (!twilioClient) {
    return res.json({ iceServers: fallbackServers });
  }

  try {
    const token = await twilioClient.tokens.create({ ttl: 14400 });
    res.json({ iceServers: token.iceServers });
  } catch (err) {
    console.error('[Twilio Error] Failed to generate NTS Token:', err.message);
    res.json({ iceServers: fallbackServers });
  }
});

// TOTAL MONTHLY RENDER FREE TIER HOURS ALLOWANCE
const MONTHLY_RENDER_HOURS_LIMIT = 750;
const serverStartTime = new Date();

// ANONYMOUS IN-MEMORY USAGE STATS
const usageStats = {
  activeConnections: 0,
  totalVideoCallsStarted: 0,
  totalVoiceCallsStarted: 0,
  totalWebTextsSent: 0,
  totalRoomsJoined: 0
};

app.get('/stats', (req, res) => {
  const uptimeSeconds = process.uptime();
  const uptimeHours = parseFloat((uptimeSeconds / 3600).toFixed(4));
  const remainingHours = parseFloat(Math.max(0, MONTHLY_RENDER_HOURS_LIMIT - uptimeHours).toFixed(4));
  const percentUsed = parseFloat(((uptimeHours / MONTHLY_RENDER_HOURS_LIMIT) * 100).toFixed(2));

  res.json({
    status: "online",
    stats: usageStats,
    serverUptime: {
      startedAt: serverStartTime.toISOString(),
      currentSessionSeconds: Math.floor(uptimeSeconds),
      currentSessionHours: uptimeHours,
      monthlyAllowanceHours: MONTHLY_RENDER_HOURS_LIMIT,
      sessionHoursRemaining: remainingHours,
      percentOfMonthlyQuotaUsed: `${percentUsed}%`
    },
    timestamp: new Date().toISOString()
  });
});


// ==========================================
// GAME ON! "PICTURE THIS!" STATE MANAGER
// ==========================================
const gameRooms = {};

const BOARD_SPACES = [
  "Inherit a Painting",
  "Bank Auction",
  "Collect $3,000,000 OR a Value Card",
  "May Buy a Painting for $1,500,000",
  "Private Auction",
  "Bank Auction",
  "Bank Auction",
  "Inherit a Painting",
  "Collect $3,000,000 OR a Value Card",
  "May Buy a Painting for $2,000,000",
  "Bank Auction",
  "May Buy a Painting for $1,500,000",
  "Bank Auction",
  "May Buy a Painting for $2,500,000",
  "Private Auction",
  "Collect $3,000,000 OR a Value Card",
  "Bank Auction",
  "Inherit a Painting",
  "Bank Auction",
  "Bank Auction",
  "Collect $3,000,000 OR a Value Card",
  "May Buy a Painting for $1,500,000",
  "Inherit a Painting",
  "Bank Auction",
  "Private Auction",
  "May Buy a Painting for $2,000,000",
  "Collect $3,000,000 OR a Value Card",
  "Bank Auction",
  "May Buy a Painting for $2,500,000",
  "Bank Auction"
];
// ==========================================


io.on('connection', (socket) => {
  usageStats.activeConnections++;
  console.log(`[Connect] Active sockets: ${usageStats.activeConnections}`);

  // WEBPHONE & WEBTEXT SIGNALING
  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    usageStats.totalRoomsJoined++;
    socket.to(roomId).emit('user-joined', { socketId: socket.id });
  });

  socket.on('offer', (data) => {
    if (data.isAudioOnly) usageStats.totalVoiceCallsStarted++;
    else usageStats.totalVideoCallsStarted++;
    socket.to(data.targetId).emit('offer', { offer: data.offer, senderId: socket.id });
  });

  socket.on('answer', (data) => {
    socket.to(data.targetId).emit('answer', { answer: data.answer, senderId: socket.id });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.targetId).emit('ice-candidate', { candidate: data.candidate, senderId: socket.id });
  });

  socket.on('send-web-chat', (data) => {
    usageStats.totalWebTextsSent++;
    socket.to(data.roomId).emit('receive-web-chat', {
      cipher: data.cipher,
      iv: data.iv,
      message: data.message,
      sender: data.sender
    });
  });


  // ==========================================
  // GAME ON! "PICTURE THIS!" SOCKET EVENTS
  // ==========================================
  
  socket.on('game-select-piece', ({ roomId, color }) => {
    if (!gameRooms[roomId]) {
      gameRooms[roomId] = { players: [], turnIndex: 0, phase: 'lobby' };
    }
    const room = gameRooms[roomId];
    
    // Prevent duplicate player profiles if they click multiple times
    const existing = room.players.find(p => p.id === socket.id);
    if (!existing) {
      room.players.push({ id: socket.id, piece: color, spaceIndex: 0, cash: 15000000, portfolio: [] });
    } else {
      existing.piece = color; 
    }
  });

  socket.on('game-start', ({ roomId }) => {
    const room = gameRooms[roomId];
    if(room && room.players.length > 0) {
      room.phase = 'board_ready';
    }
  });

  socket.on('game-init-deck', ({ roomId, genre }) => {
    const room = gameRooms[roomId];
    if (room && room.players.length > 0) {
      room.phase = 'active_turn';
      // Signal the first player that it is their turn to roll
      io.to(roomId).emit('game-state-update', {
        phase: 'turn_start',
        activePlayerId: room.players[room.turnIndex].id,
        activePlayerPiece: room.players[room.turnIndex].piece
      });
    }
  });

  socket.on('game-roll-dice', ({ roomId }) => {
    const room = gameRooms[roomId];
    if(!room) return;
    
    const player = room.players[room.turnIndex];
    // Ensure only the active player can roll the dice
    if(!player || player.id !== socket.id) return; 

    const roll = Math.floor(Math.random() * 6) + 1;
    player.spaceIndex = (player.spaceIndex + roll) % 30; // Move along the 30-space board
    const spaceAction = BOARD_SPACES[player.spaceIndex];

    // 1. Emit dice animation state to everyone
    io.to(roomId).emit('game-state-update', { 
      phase: 'dice_animating', 
      lastRoll: roll, 
      activePlayerPiece: player.piece 
    });

    // 2. Wait 2.5 seconds for animation to play, then resolve the space action
    setTimeout(() => {
      let buttonsHtml = '';
      
      // Inject direct socket.emit calls to automatically process end-turns via the HTML client
      if (spaceAction === "Bank Auction") {
        buttonsHtml = `<button class="btn-game-action" onclick="socket.emit('game-end-turn', {roomId: '${roomId}'})">Start Bidding (End Turn)</button>`;
      } else if (spaceAction.includes("Collect")) {
        buttonsHtml = `<button class="btn-game-action" onclick="socket.emit('game-end-turn', {roomId: '${roomId}'})">Take Cash</button>
                       <button class="btn-game-action" onclick="socket.emit('game-end-turn', {roomId: '${roomId}'})">Take Value Card</button>`;
      } else if (spaceAction.includes("Buy")) {
         buttonsHtml = `<button class="btn-game-action" onclick="socket.emit('game-end-turn', {roomId: '${roomId}'})">Buy Painting</button>
                        <button class="btn-game-action" onclick="socket.emit('game-end-turn', {roomId: '${roomId}'})">Pass</button>`;
      } else {
        buttonsHtml = `<button class="btn-game-action" onclick="socket.emit('game-end-turn', {roomId: '${roomId}'})">Done</button>`;
      }

      io.to(roomId).emit('game-state-update', {
        phase: 'space_action',
        currentSpaceText: spaceAction,
        actionButtonsHtml: buttonsHtml,
        activePlayerId: player.id
      });
    }, 2500);
  });
  
  socket.on('game-end-turn', ({ roomId }) => {
     const room = gameRooms[roomId];
     if(room && room.players.length > 0) {
       // Advance to next player
       room.turnIndex = (room.turnIndex + 1) % room.players.length;
       
       io.to(roomId).emit('game-state-update', {
         phase: 'turn_start',
         activePlayerId: room.players[room.turnIndex].id,
         activePlayerPiece: room.players[room.turnIndex].piece
       });
     }
  });


  // ==========================================
  // DISCONNECT LOGIC
  // ==========================================
  socket.on('disconnect', () => {
    usageStats.activeConnections = Math.max(0, usageStats.activeConnections - 1);
    console.log(`[Disconnect] Active sockets: ${usageStats.activeConnections}`);
    
    // (Optional): Add logic here to cleanly remove disconnected players from gameRooms 
    // if their phone drops mid-game, preventing the turn order from getting stuck.
    
    io.emit('user-disconnected', { socketId: socket.id });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});