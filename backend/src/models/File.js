const mongoose = require("mongoose");

const fileSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
    path: { type: String, required: true }, // normalized relative path within project
    name: { type: String, required: true },
    type: { type: String, enum: ["file", "folder"], default: "file" },
    content: { type: String }, // only for files
    size: { type: Number, default: 0 },
    language: { type: String },
    hash: { type: String }, // optional checksum
  },
  { timestamps: true }
);

fileSchema.index({ project: 1, path: 1 }, { unique: true });
fileSchema.index({ project: 1, type: 1 });

module.exports = mongoose.models.File || mongoose.model("File", fileSchema);
