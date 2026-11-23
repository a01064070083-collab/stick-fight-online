const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? makeCode() : code;
}

io.on("connection", (socket) => {
  socket.on("createRoom", () => {
    const code = makeCode();
    rooms.set(code, {
      code,
      host: socket.id,
      guest: null,
      settings: {
        char1: "normal",
        char2: "fire",
        map: "arena",
        duration: 90,
        unlocked1: [],
        unlocked2: []
      }
    });
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.role = 0; // 0 = PLAYER 1 (방장)
    socket.emit("roomJoined", { code, role: 0, settings: rooms.get(code).settings, guestReady: false });
  });

  socket.on("joinRoom", (rawCode) => {
    const code = String(rawCode || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return socket.emit("roomError", "존재하지 않는 초대 코드입니다.");
    if (room.guest) return socket.emit("roomError", "이미 인원이 가득 찬 방입니다.");

    room.guest = socket.id;
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.role = 1; // 1 = PLAYER 2 (참가자)

    socket.emit("roomJoined", { code, role: 1, settings: room.settings, guestReady: true });
    io.to(room.host).emit("guestStatus", { connected: true });
  });

  socket.on("updateSettings", (partial) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    Object.assign(room.settings, partial);
    io.to(room.code).emit("settingsUpdated", room.settings);
  });

  socket.on("startMatch", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.role !== 0) return;
    if (!room.guest) return socket.emit("roomError", "상대방이 아직 입장하지 않았습니다.");
    io.to(room.code).emit("matchStarted", room.settings);
  });

  socket.on("guestInput", (input) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.host) return;
    io.to(room.host).emit("guestInput", input);
  });

  socket.on("syncState", (state) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.guest) return;
    io.to(room.guest).emit("syncState", state);
  });

  socket.on("pauseToggle", (paused) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    io.to(room.code).emit("pauseUpdated", paused);
  });

  socket.on("returnMenu", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    io.to(room.code).emit("returnedMenu");
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;
    if (socket.data.role === 0) {
      io.to(code).emit("roomClosed", "방장이 나가서 방이 종료되었습니다.");
      rooms.delete(code);
    } else if (socket.data.role === 1) {
      room.guest = null;
      io.to(room.host).emit("guestStatus", { connected: false });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Stick Fight Server running on http://localhost:${PORT}`));
