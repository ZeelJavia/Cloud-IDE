require("dotenv").config();
const mongoose = require("mongoose");
const config = require("../../config");

/**
 * Database Connection Test
 * Tests MongoDB connection and basic model operations
 */
class DatabaseTest {
  constructor() {
    this.testResults = [];
  }

  async runAllTests() {
    console.log("🧪 Running Database Tests...\n");

    await this.testConnection();
    await this.testModels();
    await this.testUserOperations();
    await this.testProjectOperations();
    await this.testFileOperations();

    this.printResults();
    await this.cleanup();
  }

  async testConnection() {
    try {
      console.log("📡 Testing MongoDB connection...");

      if (!config.MONGODB_URI) {
        this.addResult("MongoDB URI", false, "No MongoDB URI configured");
        return;
      }

      await mongoose.connect(config.MONGODB_URI, {
        serverSelectionTimeoutMS: 8000,
      });

      console.log("✅ MongoDB connected successfully!");
      console.log(`   Connection state: ${mongoose.connection.readyState}`);
      console.log(`   Database: ${mongoose.connection.name}`);

      this.addResult("MongoDB Connection", true, "Connected successfully");
    } catch (error) {
      console.error("❌ MongoDB connection failed:", error.message);
      this.addResult("MongoDB Connection", false, error.message);
    }
  }

  async testModels() {
    try {
      console.log("\n📦 Testing Database Models...");

      const User = require("../../models/User");
      const Project = require("../../models/Project");
      const File = require("../../models/File");

      console.log("✅ User model loaded:", !!User);
      console.log("✅ Project model loaded:", !!Project);
      console.log("✅ File model loaded:", !!File);

      this.addResult("Models Loading", true, "All models loaded successfully");
    } catch (error) {
      console.error("❌ Model loading failed:", error.message);
      this.addResult("Models Loading", false, error.message);
    }
  }

  async testUserOperations() {
    try {
      console.log("\n👤 Testing User Operations...");

      const User = require("../../models/User");

      // Create test user
      const testUser = await User.create({
        name: "Test User",
        email: `test-${Date.now()}@example.com`,
        password: "hashedpassword",
        provider: "local",
      });

      console.log("✅ Created test user:", testUser.email);

      // Find user
      const foundUser = await User.findById(testUser._id);
      console.log("✅ Found user:", !!foundUser);

      // Delete test user
      await User.findByIdAndDelete(testUser._id);
      console.log("✅ Deleted test user");

      this.addResult("User Operations", true, "CRUD operations successful");
    } catch (error) {
      console.error("❌ User operations failed:", error.message);
      this.addResult("User Operations", false, error.message);
    }
  }

  async testProjectOperations() {
    try {
      console.log("\n📁 Testing Project Operations...");

      const User = require("../../models/User");
      const Project = require("../../models/Project");

      // Create test user first
      const testUser = await User.create({
        name: "Project Test User",
        email: `project-test-${Date.now()}@example.com`,
        password: "hashedpassword",
        provider: "local",
      });

      // Create test project
      const testProject = await Project.create({
        owner: testUser._id,
        name: `test-project-${Date.now()}`,
      });

      console.log("✅ Created test project:", testProject.name);

      // Find project
      const foundProject = await Project.findById(testProject._id);
      console.log("✅ Found project:", !!foundProject);

      // Cleanup
      await Project.findByIdAndDelete(testProject._id);
      await User.findByIdAndDelete(testUser._id);
      console.log("✅ Cleaned up test data");

      this.addResult("Project Operations", true, "CRUD operations successful");
    } catch (error) {
      console.error("❌ Project operations failed:", error.message);
      this.addResult("Project Operations", false, error.message);
    }
  }

  async testFileOperations() {
    try {
      console.log("\n📄 Testing File Operations...");

      const User = require("../../models/User");
      const Project = require("../../models/Project");
      const File = require("../../models/File");

      // Create test user and project
      const testUser = await User.create({
        name: "File Test User",
        email: `file-test-${Date.now()}@example.com`,
        password: "hashedpassword",
        provider: "local",
      });

      const testProject = await Project.create({
        owner: testUser._id,
        name: `file-test-project-${Date.now()}`,
      });

      // Create test file
      const testFile = await File.create({
        project: testProject._id,
        path: "test.js",
        name: "test.js",
        type: "file",
        content: "console.log('Hello World');",
        size: 25,
      });

      console.log("✅ Created test file:", testFile.name);

      // Find file
      const foundFile = await File.findById(testFile._id);
      console.log("✅ Found file:", !!foundFile);

      // Cleanup
      await File.findByIdAndDelete(testFile._id);
      await Project.findByIdAndDelete(testProject._id);
      await User.findByIdAndDelete(testUser._id);
      console.log("✅ Cleaned up test data");

      this.addResult("File Operations", true, "CRUD operations successful");
    } catch (error) {
      console.error("❌ File operations failed:", error.message);
      this.addResult("File Operations", false, error.message);
    }
  }

  addResult(testName, success, message) {
    this.testResults.push({ testName, success, message });
  }

  printResults() {
    console.log("\n" + "=".repeat(50));
    console.log("📊 DATABASE TEST RESULTS");
    console.log("=".repeat(50));

    let passed = 0;
    let failed = 0;

    this.testResults.forEach((result) => {
      const status = result.success ? "✅ PASS" : "❌ FAIL";
      console.log(`${status} ${result.testName}: ${result.message}`);

      if (result.success) passed++;
      else failed++;
    });

    console.log("=".repeat(50));
    console.log(`📈 Summary: ${passed} passed, ${failed} failed`);
    console.log("=".repeat(50));
  }

  async cleanup() {
    try {
      if (mongoose.connection.readyState === 1) {
        await mongoose.disconnect();
        console.log("🔌 Disconnected from MongoDB");
      }
    } catch (error) {
      console.error("Error during cleanup:", error.message);
    }
  }
}

// Run tests if called directly
if (require.main === module) {
  const dbTest = new DatabaseTest();
  dbTest.runAllTests().catch(console.error);
}

module.exports = DatabaseTest;
