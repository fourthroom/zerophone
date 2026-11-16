const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { Server } = require('socket.io');

const app = express();

// SECURITY UPDATE: Mitigate TLS/CA vulnerabilities and bypass flaws
app.disable('x-powered-by');

// Enforce HTTP Strict Transport Security (HSTS)
app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

// FORCE HTTPS REDIRECT FOR WEBRTC CAMERA PERMISSIONS
app.use((req, res, next) => {
  if (req.headers['x-forwarded-proto'] === 'http') {
    return res.redirect(301, `https://${req.hostname}${req.url}`);
  }
  next();
});

app.use(cors());

// Serve test page
app.get('/test', (req, res) => {
  res.sendFile(path.join(__dirname, 'test.html'));
});

// Serve all static files, resolving .html automatically
app.use(express.static(__dirname, { extensions: ['html'] }));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Twilio Client Setup
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

// Endpoint to provide ephemeral ICE servers
app.get('/api/ice-servers', async (req, res) => {
  const fallbackServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (!twilioClient) return res.json({ iceServers: fallbackServers });
  try {
    const token = await twilioClient.tokens.create({ ttl: 14400 });
    res.json({ iceServers: token.iceServers });
  } catch (err) {
    console.error('[Twilio Error]', err.message);
    res.json({ iceServers: fallbackServers });
  }
});

const MONTHLY_RENDER_HOURS_LIMIT = 750;
const serverStartTime = new Date();
const usageStats = { activeConnections: 0, totalVideoCallsStarted: 0, totalVoiceCallsStarted: 0, totalWebTextsSent: 0, totalRoomsJoined: 0 };

app.get('/stats', (req, res) => {
  const uptimeSeconds = process.uptime();
  const uptimeHours = parseFloat((uptimeSeconds / 3600).toFixed(4));
  res.json({
    status: "online", stats: usageStats,
    serverUptime: { startedAt: serverStartTime.toISOString(), sessionHoursRemaining: Math.max(0, MONTHLY_RENDER_HOURS_LIMIT - uptimeHours) }
  });
});

// ==========================================
// GAME ON! "PICTURE THIS!" STATE MANAGER
// ==========================================
const gameRooms = {};

const BOARD_SPACES = [
  "Inherit a Painting", "Bank Auction", "Collect $3,000,000 OR a Value Card", "May Buy a Painting for $1,500,000", "Private Auction",
  "Bank Auction", "Bank Auction", "Inherit a Painting", "Collect $3,000,000 OR a Value Card", "May Buy a Painting for $2,000,000",
  "Bank Auction", "May Buy a Painting for $1,500,000", "Bank Auction", "May Buy a Painting for $2,500,000", "Private Auction",
  "Collect $3,000,000 OR a Value Card", "Bank Auction", "Inherit a Painting", "Bank Auction", "Bank Auction",
  "Collect $3,000,000 OR a Value Card", "May Buy a Painting for $1,500,000", "Inherit a Painting", "Bank Auction", "Private Auction",
  "May Buy a Painting for $2,000,000", "Collect $3,000,000 OR a Value Card", "Bank Auction", "May Buy a Painting for $2,500,000", "Bank Auction"
];

io.on('connection', (socket) => {
  usageStats.activeConnections++;
  
  socket.on('join-room', (roomId) => {
    socket.join(roomId); usageStats.totalRoomsJoined++;
    socket.to(roomId).emit('user-joined', { socketId: socket.id });
  });

  socket.on('offer', (data) => socket.to(data.targetId).emit('offer', { offer: data.offer, senderId: socket.id }));
  socket.on('answer', (data) => socket.to(data.targetId).emit('answer', { answer: data.answer, senderId: socket.id }));
  socket.on('ice-candidate', (data) => socket.to(data.targetId).emit('ice-candidate', { candidate: data.candidate, senderId: socket.id }));
  socket.on('send-web-chat', (data) => socket.to(data.roomId).emit('receive-web-chat', { cipher: data.cipher, iv: data.iv, message: data.message, sender: data.sender }));

  // ==========================================
  // PICTURE THIS! SOCKET EVENTS
  // ==========================================
  socket.on('game-select-piece', ({ roomId, color }) => {
    if (!gameRooms[roomId]) gameRooms[roomId] = { players: [], turnIndex: 0, phase: 'lobby' };
    const room = gameRooms[roomId];
    
    const existing = room.players.find(p => p.id === socket.id);
    if (!existing) room.players.push({ id: socket.id, piece: color, spaceIndex: 0, cash: 15000000, portfolio: [] });
    else existing.piece = color; 

    // Broadcast the badge color to all players so it appears under their video
    io.to(roomId).emit('game-player-updated', { playerId: socket.id, piece: color });
  });

  socket.on('game-start', ({ roomId }) => {
    const room = gameRooms[roomId];
    if(room && room.players.length > 0) {
      room.phase = 'board_ready';
      // Broadcast player array so the client can prepare token graphics
      io.to(roomId).emit('game-started', { players: room.players });
    }
  });

  socket.on('game-init-deck', ({ roomId, genre }) => {
    const room = gameRooms[roomId];
    if (room && room.players.length > 0) {
      room.phase = 'active_turn';
      io.to(roomId).emit('game-state-update', {
        phase: 'turn_start',
        activePlayerId: room.players[room.turnIndex].id,
        activePlayerPiece: room.players[room.turnIndex].piece,
        players: room.players
      });
    }
  });

  socket.on('game-roll-dice', ({ roomId }) => {
    const room = gameRooms[roomId];
    if(!room) return;
    
    const player = room.players[room.turnIndex];
    if(!player || player.id !== socket.id) return; 

    const roll = Math.floor(Math.random() * 6) + 1;
    player.spaceIndex = (player.spaceIndex + roll) % 30;
    const spaceAction = BOARD_SPACES[player.spaceIndex];

    io.to(roomId).emit('game-state-update', { 
      phase: 'dice_animating', lastRoll: roll, activePlayerPiece: player.piece 
    });

    setTimeout(() => {
      let buttonsHtml = '';
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
        activePlayerId: player.id,
        players: room.players // Pass updated array so tokens visually slide to new space!
      });
    }, 2500);
  });
  
  socket.on('game-end-turn', ({ roomId }) => {
     const room = gameRooms[roomId];
     if(room && room.players.length > 0) {
       room.turnIndex = (room.turnIndex + 1) % room.players.length;
       io.to(roomId).emit('game-state-update', {
         phase: 'turn_start',
         activePlayerId: room.players[room.turnIndex].id,
         activePlayerPiece: room.players[room.turnIndex].piece,
         players: room.players
       });
     }
  });

  socket.on('disconnect', () => {
    usageStats.activeConnections = Math.max(0, usageStats.activeConnections - 1);
    io.emit('user-disconnected', { socketId: socket.id });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Signaling server running on port ${PORT}`));