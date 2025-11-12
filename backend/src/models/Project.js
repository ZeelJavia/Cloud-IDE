const mongoose = require("mongoose");

const projectSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

projectSchema.index({ owner: 1, name: 1 }, { unique: true });

module.exports =
  mongoose.models.Project || mongoose.model("Project", projectSchema);
