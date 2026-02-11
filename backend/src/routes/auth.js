const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const router = express.Router();
const config = require("../config");

const mongoose = (() => {
  try {
    return require("mongoose");
  } catch {
    return null;
  }
})();

const User = (() => {
  try {
    return require("../models/User");
  } catch {
    return null;
  }
})();

function dbReady() {
  try {
    return !!(
      mongoose &&
      mongoose.connection &&
      mongoose.connection.readyState === 1
    );
  } catch {
    return false;
  }
}

// In-memory user storage (fallback if DB not configured)
const users = [];

// Google OAuth2 client - only initialize if credentials are provided
const googleClient = process.env.GOOGLE_CLIENT_ID
  ? new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${
        process.env.BASE_URL || "http://localhost:3001"
      }/api/auth/google/callback`
    )
  : null;

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Access token required" });
  }

  jwt.verify(token, config.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: "Invalid token" });
    }
    req.user = user;
    next();
  });
};

// Register endpoint
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, confirmPassword } = req.body;

    // Validation
    if (!name || !email || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: "Passwords do not match" });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ error: "Password must be at least 6 characters" });
    }

    if (User && dbReady()) {
      // Database path
      const existing = await User.findOne({ email });
      if (existing) {
        return res
          .status(400)
          .json({ error: "User already exists with this email" });
      }
      const hashed = await bcrypt.hash(password, 10);
      const created = await User.create({
        name,
        email,
        password: hashed,
        provider: "local",
      });
      const token = jwt.sign(
        { id: created._id, email: created.email },
        config.JWT_SECRET,
        { expiresIn: "7d" }
      );
      const user = {
        id: created._id,
        name: created.name,
        email: created.email,
        provider: created.provider,
      };
      return res.json({ user, token });
    } else {
      // Fallback in-memory path
      const existingUser = users.find((u) => u.email === email);
      if (existingUser) {
        return res
          .status(400)
          .json({ error: "User already exists with this email" });
      }
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);
      const user = {
        id: Date.now().toString(),
        name,
        email,
        password: hashedPassword,
        createdAt: new Date().toISOString(),
        provider: "local",
      };
      users.push(user);
      const token = jwt.sign(
        { id: user.id, email: user.email },
        config.JWT_SECRET,
        {
          expiresIn: "7d",
        }
      );
      const { password: _, ...userWithoutPassword } = user;
      return res.json({ user: userWithoutPassword, token });
    }
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Login endpoint
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    if (User && dbReady()) {
      const userDoc = await User.findOne({ email });
      if (!userDoc || !userDoc.password) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      const isValid = await bcrypt.compare(password, userDoc.password);
      if (!isValid)
        return res.status(401).json({ error: "Invalid credentials" });
      const token = jwt.sign(
        { id: userDoc._id, email: userDoc.email },
        config.JWT_SECRET,
        { expiresIn: "7d" }
      );
      const user = {
        id: userDoc._id,
        name: userDoc.name,
        email: userDoc.email,
        provider: userDoc.provider,
      };
      return res.json({ user, token });
    } else {
      const user = users.find((u) => u.email === email);
      if (!user) return res.status(401).json({ error: "Invalid credentials" });
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword)
        return res.status(401).json({ error: "Invalid credentials" });
      const token = jwt.sign(
        { id: user.id, email: user.email },
        config.JWT_SECRET,
        {
          expiresIn: "7d",
        }
      );
      const { password: _, ...userWithoutPassword } = user;
      return res.json({ user: userWithoutPassword, token });
    }
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update profile endpoint
router.put("/profile", authenticateToken, async (req, res) => {
  try {
    const { name, email } = req.body;

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Name is required" });
    }

    if (User && dbReady()) {
      // Database path - update user profile
      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Update fields
      user.name = name.trim();

      // Only allow email update for non-OAuth users
      if (user.provider === "local" && email && email.trim()) {
        // Check if email is already taken by another user
        const existingUser = await User.findOne({
          email: email.trim(),
          _id: { $ne: user._id },
        });
        if (existingUser) {
          return res.status(400).json({ error: "Email already in use" });
        }
        user.email = email.trim();
      }

      await user.save();

      const updatedUser = {
        id: String(user._id),
        name: user.name,
        email: user.email,
        provider: user.provider,
        picture: user.picture,
      };

      return res.json({
        message: "Profile updated successfully",
        user: updatedUser,
      });
    } else {
      // Fallback in-memory path
      const user = users.find((u) => u.id === req.user.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Update fields
      user.name = name.trim();

      // Only allow email update for non-OAuth users
      if (user.provider === "local" && email && email.trim()) {
        // Check if email is already taken
        const existingUser = users.find(
          (u) => u.email === email.trim() && u.id !== user.id
        );
        if (existingUser) {
          return res.status(400).json({ error: "Email already in use" });
        }
        user.email = email.trim();
      }

      const { password: _, ...userWithoutPassword } = user;
      return res.json({
        message: "Profile updated successfully",
        user: userWithoutPassword,
      });
    }
  } catch (error) {
    console.error("Profile update error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Verify token endpoint
router.get("/verify", authenticateToken, async (req, res) => {
  try {
    if (User && dbReady()) {
      const u = await User.findById(req.user.id).lean();
      if (!u) return res.status(404).json({ error: "User not found" });
      const { password, ...user } = u;
      return res.json({
        user: {
          id: String(u._id),
          name: u.name,
          email: u.email,
          provider: u.provider,
          picture: u.picture,
        },
      });
    } else {
      const user = users.find((u) => u.id === req.user.id);
      if (!user) return res.status(404).json({ error: "User not found" });
      const { password: _, ...userWithoutPassword } = user;
      return res.json({ user: userWithoutPassword });
    }
  } catch (e) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Check Google OAuth configuration
router.get("/google/status", (req, res) => {
  res.json({
    configured: !!googleClient,
    message: googleClient
      ? "Google OAuth is configured"
      : "Google OAuth is not configured",
  });
});

// Google OAuth2 login
router.get("/google", (req, res) => {
  if (!googleClient) {
    return res.status(500).json({ error: "Google OAuth not configured" });
  }

  const authUrl = googleClient.generateAuthUrl({
    access_type: "offline",
    scope: ["profile", "email"],
    redirect_uri: `${
      process.env.BASE_URL || "http://localhost:3001"
    }/api/auth/google/callback`,
  });
  res.redirect(authUrl);
});

// Google OAuth2 callback
router.get("/google/callback", async (req, res) => {
  try {
    if (!googleClient) {
      return res.redirect(
        `${
          process.env.FRONTEND_URL || "http://localhost:3000"
        }?error=oauth_not_configured`
      );
    }

    const { code } = req.query;

    if (!code) {
      return res.redirect(
        `${
          process.env.FRONTEND_URL || "http://localhost:3000"
        }?error=auth_failed`
      );
    }

    // Exchange code for tokens
    const { tokens } = await googleClient.getToken({
      code,
      redirect_uri: `${
        process.env.BASE_URL || "http://localhost:3001"
      }/api/auth/google/callback`,
    });

    // Verify the ID token
    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    let userObj;
    if (User) {
      let user = await User.findOne({ email });
      if (!user) {
        user = await User.create({
          name,
          email,
          googleId,
          picture,
          provider: "google",
        });
      } else if (user.provider === "local") {
        user.googleId = googleId;
        user.picture = picture;
        user.provider = "google";
        await user.save();
      }
      const token = jwt.sign(
        { id: user._id, email: user.email },
        config.JWT_SECRET,
        {
          expiresIn: "7d",
        }
      );
      userObj = {
        id: String(user._id),
        name: user.name,
        email: user.email,
        picture: user.picture,
        provider: user.provider,
      };
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      return res.redirect(
        `${frontendUrl}?token=${token}&user=${encodeURIComponent(
          JSON.stringify(userObj)
        )}`
      );
    } else {
      // Fallback in-memory path
      let user = users.find((u) => u.email === email);
      if (!user) {
        user = {
          id: Date.now().toString(),
          name,
          email,
          googleId,
          picture,
          createdAt: new Date().toISOString(),
          provider: "google",
        };
        users.push(user);
      } else if (user.provider === "local") {
        user.googleId = googleId;
        user.picture = picture;
        user.provider = "google";
      }
      const token = jwt.sign(
        { id: user.id, email: user.email },
        config.JWT_SECRET,
        {
          expiresIn: "7d",
        }
      );
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      return res.redirect(
        `${frontendUrl}?token=${token}&user=${encodeURIComponent(
          JSON.stringify(user)
        )}`
      );
    }
  } catch (error) {
    console.error("Google OAuth error:", error);
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    res.redirect(`${frontendUrl}?error=auth_failed`);
  }
});

// Logout endpoint
router.post("/logout", authenticateToken, (req, res) => {
  // In a production app with Redis/database sessions, you'd invalidate the token here
  // For JWT tokens, logout is typically handled client-side by removing the token
  res.json({ message: "Logged out successfully" });
});

module.exports = { authRouter: router, authenticateToken };
