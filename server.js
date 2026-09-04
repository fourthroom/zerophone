const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
app.use(cors());

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

io.on('connection', (socket) => {
  usageStats.activeConnections++;
  console.log(`[Connect] Active sockets: ${usageStats.activeConnections}`);

  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    usageStats.totalRoomsJoined++;
    socket.to(roomId).emit('user-joined', { socketId: socket.id });
  });

  socket.on('offer', (data) => {
    if (data.isAudioOnly) {
      usageStats.totalVoiceCallsStarted++;
    } else {
      usageStats.totalVideoCallsStarted++;
    }
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

  socket.on('disconnect', () => {
    usageStats.activeConnections = Math.max(0, usageStats.activeConnections - 1);
    console.log(`[Disconnect] Active sockets: ${usageStats.activeConnections}`);
    io.emit('user-disconnected', { socketId: socket.id });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});