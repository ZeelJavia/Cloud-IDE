const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, required: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String }, // hashed password for local provider
    provider: { type: String, enum: ["local", "google"], default: "local" },
    googleId: { type: String },
    picture: { type: String },
  },
  { timestamps: true }
);

// Unique index already declared on the schema path; no extra schema.index needed.

module.exports = mongoose.models.User || mongoose.model("User", userSchema);
