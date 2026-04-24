const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
app.use(cors({ origin: "*" }));
app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  },
});

// =====================================
// 🔥 In-memory storage
// =====================================
/*
users = {
  userId: {
    socketId: "",
    status: "online" | "busy" | "offline",
    lastSeen: Date,
    name: string | null,
    email: string | null,
  }
}
*/
let users = {};
const roomMessages = {};
const userIds = [];
const onlineUserRoom = "online-users";

// =====================================
// 🔥 SOCKET CONNECTION
// =====================================
io.on("connection", (socket) => {
  const auth = socket.handshake.auth || {};
  const userId = auth.userId;
  const name = auth.name ?? null;
  const email = auth.email ?? null;

  if (!userId) {
    console.log("No userId. Disconnecting...");
    return socket.disconnect();
  }

  console.log("Connected:", userId, name, email);

  if (userIds.includes(userId)) {
    if (!roomMessages[onlineUserRoom]) {
      roomMessages[onlineUserRoom] = [];
    }
    const messageData = {
      message: "offline",
      userId,
      time: users[userId].lastSeen,
    };

    // Save message
    roomMessages[onlineUserRoom].push(messageData);

    io.to(onlineUserRoom).emit("receive-message", messageData);
  }

  // =====================================
  // ✅ SET USER ONLINE
  // =====================================
  users[userId] = {
    socketId: socket.id,
    status: "online",
    lastSeen: null,
    name,
    email,
  };

  if (!userIds.includes(userId)) userIds.push(userId);



  if (!roomMessages[onlineUserRoom]) {
    roomMessages[onlineUserRoom] = [];
  }
  const messageData = {
    message: "online",
    userId,
    time: new Date(),
  };

  // Save message
  roomMessages[onlineUserRoom].push(messageData);

  io.to(onlineUserRoom).emit("receive-message", messageData);

  // Send full user list to new user
  socket.emit("all_user_status", users);

  // Broadcast this user online
  io.emit("update_user_status", {
    userId,
    status: "online",
    lastSeen: null,
    name,
    email,
  });

  // =====================================
  // 🔵 CHANGE STATUS (busy / online)
  // =====================================
  socket.on("change_status", (newStatus) => {
    if (!users[userId]) return;

    if (newStatus !== "online" && newStatus !== "busy") return;

    users[userId].status = newStatus;

    io.emit("update_user_status", {
      userId,
      status: newStatus,
      lastSeen: null,
      name: users[userId].name,
      email: users[userId].email,
    });

    if (!roomMessages[onlineUserRoom]) {
      roomMessages[onlineUserRoom] = [];
    }
    const messageData = {
      message: newStatus,
      userId,
      time: new Date(),
    };

    // Save message
    roomMessages[onlineUserRoom].push(messageData);

    io.to(onlineUserRoom).emit("receive-message", messageData);

    console.log(`${userId} changed status to ${newStatus}`);
  });

  // =====================================
  // 🔄 JOIN ROOM CONNECTION
  // =====================================

  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    if (roomMessages[roomId]) {
      socket.emit("chat-history", roomMessages[roomId]);
    }
    console.log("Joined room:", roomId);
  });

  socket.on("send-message", (data) => {
    const { roomId, message, userId } = data;

    if (!roomMessages[roomId]) {
      roomMessages[roomId] = [];
    }
    const messageData = {
      message,
      userId,
      time: new Date(),
    };

    // Save message
    roomMessages[roomId].push(messageData);

    io.to(roomId).emit("receive-message", messageData);
  });

  // =====================================
  // 🎥 VIDEO CALL
  // =====================================

  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    console.log(`User ${socket.id} joined room ${roomId}`);

    socket.to(roomId).emit("user-joined", socket.id);
  });

  // WebRTC Offer
  socket.on("offer", (data) => {
    socket.to(data.roomId).emit("offer", data);
  });

  // WebRTC Answer
  socket.on("answer", (data) => {
    socket.to(data.roomId).emit("answer", data);
  });

  // ICE Candidate
  socket.on("ice-candidate", (data) => {
    socket.to(data.roomId).emit("ice-candidate", data);
  });

  // =====================================
  // 🔄 GET ALL USERS (Optional Manual Call)
  // =====================================
  socket.on("get_all_users", () => {
    socket.emit("all_user_status", users);
  });

  socket.on("get_all_rooms", () => {
    const rooms = Object.keys(roomMessages).map((roomId) => ({
      roomId,
      messageCount: roomMessages[roomId].length,
    }));
    socket.emit("all_rooms", rooms);
  });

  // =====================================
  // ⚫ DISCONNECT → SET OFFLINE
  // =====================================
  socket.on("disconnect", () => {
    console.log("Disconnected:", userId);

    if (!users[userId]) return;

    users[userId].status = "offline";
    users[userId].lastSeen = new Date();

    io.emit("update_user_status", {
      userId,
      status: "offline",
      lastSeen: users[userId].lastSeen,
      name: users[userId].name,
      email: users[userId].email,
    });
  });
});

// =====================================
// 🔥 REST API (Optional)
// =====================================
app.get("/users", (req, res) => {
  res.json(users);
});

app.get("/rooms", (req, res) => {
  const rooms = Object.keys(roomMessages).map((roomId) => ({
    roomId,
    messageCount: roomMessages[roomId].length,
  }));
  res.json(rooms);
});

app.delete("/rooms/:roomId/messages", (req, res) => {
  const { roomId } = req.params;
  delete roomMessages[roomId];
  io.to(roomId).emit("chat-history", []);
  res.json({ ok: true, roomId });
});

app.get("/get_user_status", (req, res) => {
  const updatedUserStatus = userIds
    ?.map((userId) => {
      return users[userId] ?? null;
    })
    .filter(Boolean);
  res.json(updatedUserStatus);
});

app.post("/update_multi_user_status", (req, res) => {
  Object.keys(req.body).forEach((userId) => {
    if (users[userId]) {
      users[userId].status = req.body[userId];
    } else {
      userIds.push(userId);
      users[userId] = {
        socketId: null,
        status: req.body[userId],
        lastSeen: null,
        name: null,
        email: null,
      };
    }
    io.emit("update_user_status", {
      userId: userId,
      status: users[userId].status,
      lastSeen: users[userId].lastSeen,
      name: users[userId].name,
      email: users[userId].email,
    });
  });
  res.send("status updated");
});

app.get("/", (req, res) => {
  res.send("Socket Server Running");
});

// =====================================
// 🚀 START SERVER
// =====================================
const PORT = 8080;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
