#!/usr/bin/env node
/*
Setup MongoDB for this project:
- Reads MONGODB_URI from .env or --uri flag
- Ensures indexes for User, Project, File
- Optionally seeds an admin user (--admin-email/--admin-password/--admin-name)
- Optionally seeds a sample project (--seed-project --project-name "test project")

Usage examples:
  node src/scripts/setup-mongo.js --uri "mongodb://localhost:27017/devdock"
  node src/scripts/setup-mongo.js --admin-email admin@example.com --admin-password secret
  npm run db:setup -- --seed-project --project-name "test project" --admin-email admin@example.com --admin-password secret
*/

const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

// Load models
const User = require("../models/User");
const Project = require("../models/Project");
const File = require("../models/File");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    if (!a.startsWith("--")) continue;
    a = a.slice(2);
    const [k, v] = a.includes("=") ? a.split(/=(.*)/) : [a, undefined];
    if (v !== undefined) out[k] = v;
    else if (i + 1 < argv.length && !String(argv[i + 1]).startsWith("--")) {
      out[k] = argv[++i];
    } else {
      out[k] = true;
    }
  }
  return out;
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const uri = args.uri || process.env.MONGODB_URI || process.env.DATABASE_URL;
  if (!uri) {
    console.error("MONGODB_URI not provided. Use --uri or set in .env");
    process.exit(1);
  }
  const safeUri = uri.replace(/:\/\/.*@/, "://***@");
  console.log("Connecting to MongoDB:", safeUri);
  await mongoose.connect(uri);
  console.log("🗄️  Connected");

  // Ensure indexes
  console.log("🧱 Ensuring indexes...");
  try {
    await User.syncIndexes();
    await Project.syncIndexes();
    await File.syncIndexes();
    console.log("✅ Indexes in sync");
  } catch (e) {
    console.warn("⚠️  Index sync warning:", e.message);
  }

  // Seed admin user if requested
  let admin = null;
  if (args["admin-email"] || process.env.DEFAULT_ADMIN_EMAIL) {
    const email = (args["admin-email"] || process.env.DEFAULT_ADMIN_EMAIL)
      .trim()
      .toLowerCase();
    const name =
      args["admin-name"] || process.env.DEFAULT_ADMIN_NAME || "Admin";
    let password = args["admin-password"] || process.env.DEFAULT_ADMIN_PASSWORD;
    if (!password) {
      // Generate a safe random password
      password =
        Math.random().toString(36).slice(2) +
        Math.random().toString(36).slice(2);
      console.log(
        "🔐 No admin password provided; generated a random password shown below."
      );
    }
    const hash = await bcrypt.hash(String(password), 10);
    admin = await User.findOneAndUpdate(
      { email },
      { $set: { name, email, password: hash, provider: "local" } },
      { upsert: true, new: true }
    );
    console.log("👤 Admin user ready:", email);
    if (!args["admin-password"] && !process.env.DEFAULT_ADMIN_PASSWORD) {
      console.log("   Generated password:", password);
    }
  }

  // Optionally seed a sample project
  if (args["seed-project"] || process.env.SEED_SAMPLE_PROJECT === "true") {
    const owner = admin || (await User.findOne());
    if (!owner) {
      console.error(
        "Cannot seed project: no user found. Provide --admin-email to create one."
      );
    } else {
      const projectName =
        args["project-name"] || process.env.SEED_PROJECT_NAME || "test project";
      let project = await Project.findOne({
        owner: owner._id,
        name: projectName,
      });
      if (!project) {
        project = await Project.create({ owner: owner._id, name: projectName });
        console.log("📁 Created project:", projectName);
      } else {
        console.log("📁 Project exists, updating files:", projectName);
      }
      const exampleFiles = [
        {
          path: "index.html",
          name: "index.html",
          type: "file",
          content:
            '<!DOCTYPE html>\n<html>\n<head><meta charset="utf-8"/><title>DevDock</title></head>\n<body><h1>test project</h1><script src="script.js"></script></body>\n</html>',
        },
        {
          path: "script.js",
          name: "script.js",
          type: "file",
          content: 'console.log("Hello from test project!");',
        },
        {
          path: "style.css",
          name: "style.css",
          type: "file",
          content: "body{font-family:sans-serif}",
        },
      ];

      const ops = exampleFiles.map((f) => ({
        updateOne: {
          filter: { project: project._id, path: f.path },
          update: {
            $set: {
              name: f.name,
              type: f.type,
              content: f.content,
              size: Buffer.byteLength(f.content || ""),
            },
          },
          upsert: true,
        },
      }));
      await File.bulkWrite(ops);
      console.log(`📝 Seeded ${ops.length} files for project '${projectName}'`);
    }
  }

  await mongoose.disconnect();
  console.log("🎉 MongoDB setup completed successfully.");
  process.exit(0);
})().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
