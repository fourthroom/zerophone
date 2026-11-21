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
// ==========================================
// GAME ON! "PICTURE THIS!" AUTOMATED ENGINE
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

const FALLBACK_ART_IMAGE = "15FDDD6C-6205-4F68-8C6A-338AB0FA6C84_4_5005_c.jpeg";
const DECK_SIZE = 14; // Adjust higher/lower for longer or shorter family games
const AUCTION_SECONDS = 12;

const GENRE_QUERIES = {
  renaissance: "renaissance painting",
  baroque: "baroque painting",
  impressionism: "impressionism painting",
  american: "american painting landscape portrait",
  modern: "modern abstract painting"
};

const FALLBACK_DECKS = {
  renaissance: [
    { title: "The Birth of Venus", artist: "Sandro Botticelli", year: "c. 1485" },
    { title: "Mona Lisa", artist: "Leonardo da Vinci", year: "1503" },
    { title: "The School of Athens", artist: "Raphael", year: "1511" },
    { title: "The Arnolfini Portrait", artist: "Jan van Eyck", year: "1434" },
    { title: "The Garden of Earthly Delights", artist: "Hieronymus Bosch", year: "1510" },
    { title: "Primavera", artist: "Sandro Botticelli", year: "1482" },
    { title: "Lady with an Ermine", artist: "Leonardo da Vinci", year: "1490" },
    { title: "The Ambassadors", artist: "Hans Holbein", year: "1533" },
    { title: "The Tempest", artist: "Giorgione", year: "1508" },
    { title: "Sistine Madonna", artist: "Raphael", year: "1512" },
    { title: "Bacchus and Ariadne", artist: "Titian", year: "1523" },
    { title: "The Hunters in the Snow", artist: "Pieter Bruegel", year: "1565" },
    { title: "Saint George and the Dragon", artist: "Paolo Uccello", year: "1470" },
    { title: "Portrait of a Young Man", artist: "Agnolo Bronzino", year: "1530" }
  ],
  baroque: [
    { title: "The Night Watch", artist: "Rembrandt", year: "1642" },
    { title: "Girl with a Pearl Earring", artist: "Johannes Vermeer", year: "1665" },
    { title: "Las Meninas", artist: "Diego Velázquez", year: "1656" },
    { title: "The Calling of Saint Matthew", artist: "Caravaggio", year: "1600" },
    { title: "The Milkmaid", artist: "Johannes Vermeer", year: "1658" },
    { title: "Judith Slaying Holofernes", artist: "Artemisia Gentileschi", year: "1620" },
    { title: "The Anatomy Lesson", artist: "Rembrandt", year: "1632" },
    { title: "The Swing", artist: "Jean-Honoré Fragonard", year: "1767" },
    { title: "View of Delft", artist: "Johannes Vermeer", year: "1660" },
    { title: "The Elevation of the Cross", artist: "Peter Paul Rubens", year: "1610" },
    { title: "The Astronomer", artist: "Johannes Vermeer", year: "1668" },
    { title: "Bacchus", artist: "Caravaggio", year: "1596" },
    { title: "The Laughing Cavalier", artist: "Frans Hals", year: "1624" },
    { title: "A Dance to the Music of Time", artist: "Nicolas Poussin", year: "1634" }
  ],
  impressionism: [
    { title: "Impression, Sunrise", artist: "Claude Monet", year: "1872" },
    { title: "Water Lilies", artist: "Claude Monet", year: "1906" },
    { title: "A Sunday on La Grande Jatte", artist: "Georges Seurat", year: "1884" },
    { title: "Luncheon of the Boating Party", artist: "Pierre-Auguste Renoir", year: "1881" },
    { title: "The Starry Night", artist: "Vincent van Gogh", year: "1889" },
    { title: "The Dance Class", artist: "Edgar Degas", year: "1874" },
    { title: "Paris Street; Rainy Day", artist: "Gustave Caillebotte", year: "1877" },
    { title: "The Cradle", artist: "Berthe Morisot", year: "1872" },
    { title: "Bal du moulin de la Galette", artist: "Pierre-Auguste Renoir", year: "1876" },
    { title: "The Child's Bath", artist: "Mary Cassatt", year: "1893" },
    { title: "Haystacks", artist: "Claude Monet", year: "1890" },
    { title: "Cafe Terrace at Night", artist: "Vincent van Gogh", year: "1888" },
    { title: "A Bar at the Folies-Bergère", artist: "Édouard Manet", year: "1882" },
    { title: "Boulevard Montmartre", artist: "Camille Pissarro", year: "1897" }
  ],
  american: [
    { title: "Nighthawks", artist: "Edward Hopper", year: "1942" },
    { title: "American Gothic", artist: "Grant Wood", year: "1930" },
    { title: "Whistler's Mother", artist: "James McNeill Whistler", year: "1871" },
    { title: "Washington Crossing the Delaware", artist: "Emanuel Leutze", year: "1851" },
    { title: "Christina's World", artist: "Andrew Wyeth", year: "1948" },
    { title: "The Gulf Stream", artist: "Winslow Homer", year: "1899" },
    { title: "Madame X", artist: "John Singer Sargent", year: "1884" },
    { title: "The Oxbow", artist: "Thomas Cole", year: "1836" },
    { title: "Among the Sierra Nevada", artist: "Albert Bierstadt", year: "1868" },
    { title: "Breezing Up", artist: "Winslow Homer", year: "1876" },
    { title: "Dempsey and Firpo", artist: "George Bellows", year: "1924" },
    { title: "Sky Above Clouds", artist: "Georgia O'Keeffe", year: "1965" },
    { title: "Snap the Whip", artist: "Winslow Homer", year: "1872" },
    { title: "Chop Suey", artist: "Edward Hopper", year: "1929" }
  ],
  modern: [
    { title: "The Persistence of Memory", artist: "Salvador Dalí", year: "1931" },
    { title: "The Scream", artist: "Edvard Munch", year: "1893" },
    { title: "The Kiss", artist: "Gustav Klimt", year: "1908" },
    { title: "Composition VIII", artist: "Wassily Kandinsky", year: "1923" },
    { title: "The Son of Man", artist: "René Magritte", year: "1964" },
    { title: "Broadway Boogie Woogie", artist: "Piet Mondrian", year: "1943" },
    { title: "The Old Guitarist", artist: "Pablo Picasso", year: "1903" },
    { title: "The Red Studio", artist: "Henri Matisse", year: "1911" },
    { title: "I and the Village", artist: "Marc Chagall", year: "1911" },
    { title: "The Two Fridas", artist: "Frida Kahlo", year: "1939" },
    { title: "Number 1A, 1948", artist: "Jackson Pollock", year: "1948" },
    { title: "The Sleeping Gypsy", artist: "Henri Rousseau", year: "1897" },
    { title: "Twittering Machine", artist: "Paul Klee", year: "1922" },
    { title: "Orange and Yellow", artist: "Mark Rothko", year: "1956" }
  ]
};

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function createValueDeck() {
  const spec = [
    { label: "FORGERY", amount: 0, isForgery: true, count: 4 },
    { label: "$500,000", amount: 500000, isForgery: false, count: 4 },
    { label: "$1,000,000", amount: 1000000, isForgery: false, count: 5 },
    { label: "$1,500,000", amount: 1500000, isForgery: false, count: 5 },
    { label: "$2,000,000", amount: 2000000, isForgery: false, count: 5 },
    { label: "$2,500,000", amount: 2500000, isForgery: false, count: 4 },
    { label: "$3,000,000", amount: 3000000, isForgery: false, count: 4 },
    { label: "$4,000,000", amount: 4000000, isForgery: false, count: 3 },
    { label: "$5,000,000", amount: 5000000, isForgery: false, count: 2 }
  ];
  const deck = [];
  let idCounter = 1;
  for (const item of spec) {
    for (let i = 0; i < item.count; i++) {
      deck.push({ id: `val_${idCounter++}`, label: item.label, amount: item.amount, isForgery: item.isForgery });
    }
  }
  return shuffle(deck);
}

async function buildArtworkDeck(genre) {
  const query = GENRE_QUERIES[genre] || "oil painting";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const url = `https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(query)}&query[term][is_public_domain]=true&fields=id,title,artist_title,date_display,image_id&limit=35`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      const valid = (data.data || []).filter(a => a.image_id && a.title).map(a => ({
        id: `art_${a.id}`,
        title: a.title.slice(0, 60),
        artist: a.artist_title || "Unknown Artist",
        year: a.date_display || "",
        imageUrl: `https://www.artic.edu/iiif/2/${a.image_id}/full/400,/0/default.jpg`,
        values: []
      }));
      if (valid.length >= 10) return shuffle(valid).slice(0, DECK_SIZE);
    }
  } catch (err) {
    console.warn("[Art API fallback]", err.message);
  }
  const base = FALLBACK_DECKS[genre] || FALLBACK_DECKS.renaissance;
  return shuffle(base).slice(0, DECK_SIZE).map((a, idx) => ({
    id: `art_fb_${genre}_${idx}`,
    title: a.title,
    artist: a.artist,
    year: a.year,
    imageUrl: FALLBACK_ART_IMAGE,
    values: []
  }));
}

function drawValueCard(room) {
  if (!room.valueDeck || room.valueDeck.length === 0) {
    room.valueDeck = createValueDeck();
  }
  return room.valueDeck.pop();
}

function computeArtworkValue(artwork) {
  const hasForgery = artwork.values.some(v => v.isForgery);
  if (hasForgery) return { hasForgery: true, total: 0 };
  const total = artwork.values.reduce((sum, v) => sum + v.amount, 0);
  return { hasForgery: false, total };
}

function sanitizePublicPlayers(room, revealSecrets = false) {
  return room.players.map(p => ({
    id: p.id,
    name: p.name,
    piece: p.piece,
    spaceIndex: p.spaceIndex,
    cash: p.cash,
    artworkCount: p.portfolio.length,
    portfolio: p.portfolio.map(art => ({
      id: art.id,
      title: art.title,
      artist: art.artist,
      year: art.year,
      imageUrl: art.imageUrl,
      valueCardCount: art.values.length,
      ...(revealSecrets ? { values: art.values, ...computeArtworkValue(art) } : {})
    }))
  }));
}

function sendPrivateStates(room) {
  for (const p of room.players) {
    const detailedPortfolio = p.portfolio.map(art => ({
      ...art,
      ...computeArtworkValue(art)
    }));
    const portfolioTotal = detailedPortfolio.reduce((s, a) => s + a.total, 0);
    io.to(p.id).emit('game-private-state', {
      cash: p.cash,
      portfolio: detailedPortfolio,
      secretPortfolioTotal: portfolioTotal,
      secretNetWorth: p.cash + portfolioTotal
    });
  }
}

function broadcastState(roomId, extra = {}) {
  const room = gameRooms[roomId];
  if (!room || room.players.length === 0) return;
  const active = room.players[room.turnIndex] || room.players[0];
  const reveal = room.phase === 'game_over';

  io.to(roomId).emit('game-state-update', {
    phase: room.phase,
    genre: room.genre,
    deckCount: room.artworkDeck ? room.artworkDeck.length : 0,
    activePlayerId: active.id,
    activePlayerPiece: active.piece,
    activePlayerName: active.name,
    players: sanitizePublicPlayers(room, reveal),
    auction: room.auction ? {
      type: room.auction.type,
      artwork: {
        id: room.auction.artwork.id,
        title: room.auction.artwork.title,
        artist: room.auction.artwork.artist,
        year: room.auction.artwork.year,
        imageUrl: room.auction.artwork.imageUrl,
        valueCardCount: room.auction.artwork.values.length
      },
      sellerId: room.auction.sellerId,
      sellerName: room.auction.sellerName,
      currentBid: room.auction.currentBid,
      minNextBid: room.auction.currentBid === 0 ? 500000 : room.auction.currentBid + 500000,
      highestBidderId: room.auction.highestBidderId,
      highestBidderName: room.auction.highestBidderName,
      highestBidderPiece: room.auction.highestBidderPiece,
      passedIds: room.auction.passedIds,
      endsAt: room.auction.endsAt
    } : null,
    pendingAction: room.pendingAction || null,
    ...extra
  });
  sendPrivateStates(room);
}

function checkGameOverOrAdvance(roomId, message = "", delayMs = 2400) {
  const room = gameRooms[roomId];
  if (!room) return;

  if (room.artworkDeck.length === 0) {
    room.phase = 'game_over';
    room.pendingAction = null;
    room.auction = null;
    const leaderboard = room.players.map(p => {
      const portfolioVal = p.portfolio.reduce((s, a) => s + computeArtworkValue(a).total, 0);
      return {
        id: p.id,
        name: p.name,
        piece: p.piece,
        cash: p.cash,
        portfolioValue: portfolioVal,
        netWorth: p.cash + portfolioVal,
        portfolio: p.portfolio.map(a => ({ ...a, ...computeArtworkValue(a) }))
      };
    }).sort((a, b) => b.netWorth - a.netWorth);

    broadcastState(roomId, {
      message: message || "The Bank Gallery is empty! Revealing all secret values...",
      leaderboard
    });
    return;
  }

  room.phase = 'turn_notice';
  room.pendingAction = null;
  room.auction = null;
  broadcastState(roomId, { message });

  clearTimeout(room.advanceTimer);
  room.advanceTimer = setTimeout(() => {
    const r = gameRooms[roomId];
    if (!r || r.phase === 'game_over' || r.players.length === 0) return;
    r.turnIndex = (r.turnIndex + 1) % r.players.length;
    r.phase = 'turn_start';
    broadcastState(roomId);
  }, delayMs);
}

function closeAuction(roomId) {
  const room = gameRooms[roomId];
  if (!room || !room.auction) return;
  clearTimeout(room.auctionTimer);

  const auc = room.auction;
  const winner = room.players.find(p => p.id === auc.highestBidderId);

  if (auc.type === 'bank') {
    if (winner) {
      winner.cash -= auc.currentBid;
      const secretVal = drawValueCard(room);
      auc.artwork.values.push(secretVal);
      winner.portfolio.push(auc.artwork);
      checkGameOverOrAdvance(
        roomId,
        `SOLD! ${winner.name} (${winner.piece.toUpperCase()}) won "${auc.artwork.title}" for $${auc.currentBid.toLocaleString()}!`
      );
    } else {
      room.artworkDeck.unshift(auc.artwork); // Bottom of deck
      checkGameOverOrAdvance(roomId, `No bids placed. "${auc.artwork.title}" returns to the bottom of the gallery.`);
    }
  } else if (auc.type === 'private') {
    const seller = room.players.find(p => p.id === auc.sellerId);
    if (winner && seller) {
      winner.cash -= auc.currentBid;
      seller.cash += auc.currentBid;
      seller.portfolio = seller.portfolio.filter(a => a.id !== auc.artwork.id);
      winner.portfolio.push(auc.artwork); // Moves painting + ALL attached secret Value cards
      checkGameOverOrAdvance(
        roomId,
        `SOLD! ${winner.name} paid ${seller.name} $${auc.currentBid.toLocaleString()} for "${auc.artwork.title}"!`
      );
    } else {
      checkGameOverOrAdvance(roomId, `No bids! ${auc.sellerName} keeps "${auc.artwork.title}".`);
    }
  }
}

function startAuctionTimer(roomId) {
  const room = gameRooms[roomId];
  if (!room || !room.auction) return;
  clearTimeout(room.auctionTimer);
  room.auction.endsAt = Date.now() + AUCTION_SECONDS * 1000;
  room.auctionTimer = setTimeout(() => closeAuction(roomId), AUCTION_SECONDS * 1000);
}

function resolveSpace(roomId) {
  const room = gameRooms[roomId];
  if (!room) return;
  const player = room.players[room.turnIndex];
  const spaceAction = BOARD_SPACES[player.spaceIndex];

  // 1. INHERIT A PAINTING (Fully Automated)
  if (spaceAction === "Inherit a Painting") {
    const art = room.artworkDeck.pop();
    const val = drawValueCard(room);
    art.values.push(val);
    player.portfolio.push(art);
    checkGameOverOrAdvance(
      roomId,
      `🎁 ${player.name} inherited "${art.title}" (+1 secret Value Card)!`
    );
    return;
  }

  // 2. BANK AUCTION
  if (spaceAction === "Bank Auction") {
    const art = room.artworkDeck.pop();
    room.phase = 'bank_auction';
    room.auction = {
      type: 'bank',
      artwork: art,
      sellerId: null,
      sellerName: "The Bank",
      currentBid: 0,
      highestBidderId: null,
      highestBidderName: null,
      highestBidderPiece: null,
      passedIds: [],
      endsAt: 0
    };
    startAuctionTimer(roomId);
    broadcastState(roomId, { currentSpaceText: spaceAction });
    return;
  }

  // 3. PRIVATE AUCTION
  if (spaceAction === "Private Auction") {
    if (player.portfolio.length === 0) {
      checkGameOverOrAdvance(roomId, `${player.name} landed on Private Auction but owns no artwork. Turn ends.`);
      return;
    }
    if (room.players.length < 2) {
      checkGameOverOrAdvance(roomId, `Private Auction skipped (requires 2+ players).`);
      return;
    }
    const selector = room.players[(room.turnIndex + 1) % room.players.length];
    room.phase = 'private_select';
    room.pendingAction = {
      type: 'private_select',
      selectorId: selector.id,
      selectorName: selector.name,
      sellerId: player.id,
      sellerName: player.name,
      sellerArtworks: player.portfolio.map(a => ({
        id: a.id, title: a.title, artist: a.artist, imageUrl: a.imageUrl, valueCardCount: a.values.length
      }))
    };
    broadcastState(roomId, { currentSpaceText: spaceAction });
    return;
  }

  // 4. DIRECT PURCHASE ($1.5M / $2.0M / $2.5M)
  if (spaceAction.includes("May Buy")) {
    const priceMatch = spaceAction.match(/\$([\d,]+)/);
    const price = priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : 1500000;
    const topArt = room.artworkDeck[room.artworkDeck.length - 1];
    room.phase = 'direct_buy';
    room.pendingAction = {
      type: 'direct_buy',
      price,
      canAfford: player.cash >= price,
      artwork: {
        id: topArt.id, title: topArt.title, artist: topArt.artist, year: topArt.year, imageUrl: topArt.imageUrl
      }
    };
    broadcastState(roomId, { currentSpaceText: spaceAction });
    return;
  }

  // 5. COLLECT $3,000,000 OR A VALUE CARD
  if (spaceAction.includes("Collect")) {
    room.phase = 'collect_choice';
    room.pendingAction = {
      type: 'collect_choice',
      canTakeValue: player.portfolio.length > 0
    };
    broadcastState(roomId, { currentSpaceText: spaceAction });
    return;
  }
}

io.on('connection', (socket) => {
  usageStats.activeConnections++;

  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    usageStats.totalRoomsJoined++;
    socket.to(roomId).emit('user-joined', { socketId: socket.id });
  });

  socket.on('offer', (data) => socket.to(data.targetId).emit('offer', { offer: data.offer, senderId: socket.id }));
  socket.on('answer', (data) => socket.to(data.targetId).emit('answer', { answer: data.answer, senderId: socket.id }));
  socket.on('ice-candidate', (data) => socket.to(data.targetId).emit('ice-candidate', { candidate: data.candidate, senderId: socket.id }));
  socket.on('send-web-chat', (data) => socket.to(data.roomId).emit('receive-web-chat', { cipher: data.cipher, iv: data.iv, message: data.message, sender: data.sender }));

  // --- PICTURE THIS! SOCKET EVENTS ---
  socket.on('game-select-piece', ({ roomId, color, name }) => {
    socket.join(roomId); // Ensure player receives broadcasts even without an active video call
    if (!gameRooms[roomId]) {
      gameRooms[roomId] = { players: [], turnIndex: 0, phase: 'lobby', artworkDeck: [], valueDeck: [] };
    }
    const room = gameRooms[roomId];
    const displayName = (name && name.trim()) ? name.trim() : color.toUpperCase();

    const existing = room.players.find(p => p.id === socket.id);
    if (!existing) {
      room.players.push({ id: socket.id, name: displayName, piece: color, spaceIndex: 0, cash: 15000000, portfolio: [] });
    } else {
      existing.piece = color;
      existing.name = displayName;
    }

    io.to(roomId).emit('game-player-updated', {
      playerId: socket.id,
      piece: color,
      name: displayName,
      players: sanitizePublicPlayers(room)
    });
  });

  socket.on('game-start', ({ roomId }) => {
    const room = gameRooms[roomId];
    if (room && room.players.length > 0) {
      room.phase = 'board_ready';
      io.to(roomId).emit('game-started', { players: sanitizePublicPlayers(room) });
    }
  });

  socket.on('game-init-deck', async ({ roomId, genre }) => {
    const room = gameRooms[roomId];
    if (!room || room.players.length === 0) return;

    room.genre = genre;
    room.turnIndex = 0;
    room.artworkDeck = await buildArtworkDeck(genre);
    room.valueDeck = createValueDeck();
    room.auction = null;
    room.pendingAction = null;

    // Deal starting capital ($15M), 1 Artwork, and 1 hidden Value card to every player
    for (const p of room.players) {
      p.spaceIndex = 0;
      p.cash = 15000000;
      p.portfolio = [];
      if (room.artworkDeck.length > 1) {
        const art = room.artworkDeck.pop();
        art.values.push(drawValueCard(room));
        p.portfolio.push(art);
      }
    }

    room.phase = 'turn_start';
    broadcastState(roomId, { message: `Deck shuffled (${genre.toUpperCase()})! Starting paintings dealt.` });
  });

  socket.on('game-roll-dice', ({ roomId }) => {
    const room = gameRooms[roomId];
    if (!room || room.phase !== 'turn_start') return;

    const player = room.players[room.turnIndex];
    if (!player || player.id !== socket.id) return;

    const roll = Math.floor(Math.random() * 6) + 1;
    player.spaceIndex = (player.spaceIndex + roll) % 30;
    room.phase = 'dice_animating';

    broadcastState(roomId, { lastRoll: roll });

    setTimeout(() => resolveSpace(roomId), 2400);
  });

  socket.on('game-direct-buy', ({ roomId, buy }) => {
    const room = gameRooms[roomId];
    if (!room || room.phase !== 'direct_buy') return;
    const player = room.players[room.turnIndex];
    if (!player || player.id !== socket.id) return;

    const { price } = room.pendingAction;
    if (buy) {
      if (player.cash < price) {
        return socket.emit('game-error', { message: "Not enough cash for this purchase!" });
      }
      const art = room.artworkDeck.pop();
      const val = drawValueCard(room);
      art.values.push(val);
      player.cash -= price;
      player.portfolio.push(art);
      checkGameOverOrAdvance(roomId, `${player.name} bought "${art.title}" for $${price.toLocaleString()}!`);
    } else {
      checkGameOverOrAdvance(roomId, `${player.name} passed on the purchase.`);
    }
  });

  socket.on('game-collect-choice', ({ roomId, choice, artworkId }) => {
    const room = gameRooms[roomId];
    if (!room || (room.phase !== 'collect_choice' && room.phase !== 'assign_value')) return;
    const player = room.players[room.turnIndex];
    if (!player || player.id !== socket.id) return;

    if (choice === 'cash') {
      player.cash += 3000000;
      checkGameOverOrAdvance(roomId, `💵 ${player.name} collected $3,000,000 from the Bank!`);
      return;
    }

    if (choice === 'value') {
      if (player.portfolio.length === 0) {
        return socket.emit('game-error', { message: "You own no paintings — you must take the $3,000,000 cash." });
      }
      // If they own multiple paintings and haven't picked which one yet, prompt them
      if (player.portfolio.length > 1 && !artworkId) {
        room.phase = 'assign_value';
        room.pendingAction = {
          type: 'assign_value',
          artworks: player.portfolio.map(a => ({ id: a.id, title: a.title, valueCardCount: a.values.length }))
        };
        broadcastState(roomId);
        return;
      }
      const targetArt = artworkId
        ? player.portfolio.find(a => a.id === artworkId)
        : player.portfolio[0];

      if (!targetArt) return;
      targetArt.values.push(drawValueCard(room));
      checkGameOverOrAdvance(roomId, `🃏 ${player.name} secretly attached a new Value Card to "${targetArt.title}"!`);
    }
  });

  socket.on('game-private-select', ({ roomId, artworkId }) => {
    const room = gameRooms[roomId];
    if (!room || room.phase !== 'private_select' || !room.pendingAction) return;
    if (socket.id !== room.pendingAction.selectorId) return;

    const seller = room.players.find(p => p.id === room.pendingAction.sellerId);
    if (!seller) return;
    const chosenArt = seller.portfolio.find(a => a.id === artworkId);
    if (!chosenArt) return;

    room.phase = 'private_auction';
    room.pendingAction = null;
    room.auction = {
      type: 'private',
      artwork: chosenArt,
      sellerId: seller.id,
      sellerName: seller.name,
      currentBid: 0,
      highestBidderId: null,
      highestBidderName: null,
      highestBidderPiece: null,
      passedIds: [seller.id], // Seller acts as auctioneer and cannot bid
      endsAt: 0
    };
    startAuctionTimer(roomId);
    broadcastState(roomId);
  });

  socket.on('game-place-bid', ({ roomId, bidAmount }) => {
    const room = gameRooms[roomId];
    if (!room || !room.auction) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    const auc = room.auction;
    const bid = Number(bidAmount);
    const minBid = auc.currentBid === 0 ? 500000 : auc.currentBid + 500000;

    if (auc.type === 'private' && player.id === auc.sellerId) {
      return socket.emit('game-error', { message: "You are the auctioneer and cannot bid on your own painting!" });
    }
    if (!Number.isFinite(bid) || bid < minBid || bid % 500000 !== 0) {
      return socket.emit('game-error', { message: `Bids must be in $500,000 increments (minimum $${minBid.toLocaleString()}).` });
    }
    if (bid > player.cash) {
      return socket.emit('game-error', { message: `Insufficient funds! You only have $${player.cash.toLocaleString()}.` });
    }

    auc.currentBid = bid;
    auc.highestBidderId = player.id;
    auc.highestBidderName = player.name;
    auc.highestBidderPiece = player.piece;
    auc.passedIds = auc.type === 'private' ? [auc.sellerId] : [];

    // Close immediately if solo testing or no other eligible players can outbid
    const otherEligible = room.players.filter(p => p.id !== player.id && p.id !== auc.sellerId);
    if (otherEligible.length === 0) {
      return closeAuction(roomId);
    }

    startAuctionTimer(roomId);
    broadcastState(roomId);
  });

  socket.on('game-auction-pass', ({ roomId }) => {
    const room = gameRooms[roomId];
    if (!room || !room.auction) return;
    const auc = room.auction;

    if (!auc.passedIds.includes(socket.id) && socket.id !== auc.highestBidderId) {
      auc.passedIds.push(socket.id);
    }

    const activeContenders = room.players.filter(
      p => p.id !== auc.highestBidderId && !auc.passedIds.includes(p.id)
    );

    if (activeContenders.length === 0) {
      closeAuction(roomId);
    } else {
      broadcastState(roomId);
    }
  });

  socket.on('disconnect', () => {
    usageStats.activeConnections = Math.max(0, usageStats.activeConnections - 1);
    // Clean up player from active game rooms safely
    for (const [roomId, room] of Object.entries(gameRooms)) {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        if (room.players.length === 0) {
          clearTimeout(room.auctionTimer);
          clearTimeout(room.advanceTimer);
          delete gameRooms[roomId];
        } else {
          room.turnIndex = room.turnIndex % room.players.length;
          broadcastState(roomId);
        }
      }
    }
    io.emit('user-disconnected', { socketId: socket.id });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Signaling server running on port ${PORT}`));