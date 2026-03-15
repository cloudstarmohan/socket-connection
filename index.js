const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
});

// =====================================
// 🔥 In-memory storage
// =====================================
/*
users = {
  userId: {
    socketId: "",
    status: "online" | "busy" | "offline",
    lastSeen: Date
  }
}
*/
let users = {};

// =====================================
// 🔥 SOCKET CONNECTION
// =====================================
io.on("connection", (socket) => {
  const userId = socket.handshake.auth.userId;

  if (!userId) {
    console.log("No userId. Disconnecting...");
    return socket.disconnect();
  }

  console.log("Connected:", userId);

  // =====================================
  // ✅ SET USER ONLINE
  // =====================================
  users[userId] = {
    socketId: socket.id,
    status: "online",
    lastSeen: null,
  };

  // Send full user list to new user
  socket.emit("all_user_status", users);

  // Broadcast this user online
  io.emit("update_user_status", {
    userId,
    status: "online",
    lastSeen: null,
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
    });

    console.log(`${userId} changed status to ${newStatus}`);
  });

  // =====================================
  // 🔄 JOIN ROOM CONNECTION
  // =====================================

  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    console.log("Joined room:", roomId);
  });

  socket.on("send-message", (data) => {
    const { roomId, message, user } = data;

    io.to(roomId).emit("receive-message", {
      message,
      user,
      time: new Date(),
    });
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
    });
  });
});

// =====================================
// 🔥 REST API (Optional)
// =====================================
app.get("/users", (req, res) => {
  res.json(users);
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
