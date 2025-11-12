const jwt = require("jsonwebtoken");
const config = require("../config");

// Socket authentication middleware (JWT via query.token or handshake.auth.token)
const socketAuthMiddleware = (socket, next) => {
  try {
    const token =
      (socket.handshake.query && socket.handshake.query.token) ||
      (socket.handshake.auth && socket.handshake.auth.token);
    if (!token) return next(); // allow anonymous; HTTP routes still enforce auth

    jwt.verify(token, config.JWT_SECRET, (err, decoded) => {
      if (!err && decoded)
        socket.user = { id: decoded.id, email: decoded.email };
      return next();
    });
  } catch (e) {
    return next();
  }
};

// HTTP authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Access token required" });
  }

  jwt.verify(token, config.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: "Invalid or expired token" });
    }
    req.user = user;
    next();
  });
};

// Optional authentication middleware (doesn't block if no token)
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return next(); // Continue without user
  }

  jwt.verify(token, config.JWT_SECRET, (err, user) => {
    if (!err && user) {
      req.user = user;
    }
    next(); // Continue regardless of token validity
  });
};

// Token verification middleware (alias for authenticateToken)
const verifyToken = authenticateToken;

module.exports = {
  socketAuthMiddleware,
  authenticateToken,
  verifyToken,
  optionalAuth,
};
