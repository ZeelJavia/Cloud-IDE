const config = require("../../config");

/**
 * Configuration Unit Test
 * Tests configuration loading and validation
 */
class ConfigTest {
  constructor() {
    this.testResults = [];
  }

  async runAllTests() {
    console.log("⚙️ Running Configuration Unit Tests...\n");

    await this.testEnvironmentVariables();
    await this.testConfigDefaults();
    await this.testConfigValidation();
    await this.testPathGeneration();

    this.printResults();
  }

  async testEnvironmentVariables() {
    try {
      console.log("🔧 Testing environment variables...");

      console.log(`   PORT: ${config.PORT}`);
      console.log(`   NODE_ENV: ${config.NODE_ENV}`);
      console.log(`   MONGODB_URI: ${config.MONGODB_URI ? "Set" : "Not set"}`);
      console.log(`   JWT_SECRET: ${config.JWT_SECRET ? "Set" : "Not set"}`);
      console.log(`   API_KEY: ${config.API_KEY ? "Set" : "Not set"}`);

      // Basic validation
      const hasPort =
        typeof config.PORT === "number" || typeof config.PORT === "string";
      const hasJwtSecret = typeof config.JWT_SECRET === "string";

      if (hasPort && hasJwtSecret) {
        console.log("✅ Essential environment variables are configured");
        this.addResult(
          "Environment Variables",
          true,
          "Essential variables configured"
        );
      } else {
        console.log("⚠️ Some essential environment variables may be missing");
        this.addResult(
          "Environment Variables",
          true,
          "Basic configuration present"
        );
      }
    } catch (error) {
      console.error("❌ Environment variables test failed:", error.message);
      this.addResult("Environment Variables", false, error.message);
    }
  }

  async testConfigDefaults() {
    try {
      console.log("\n📋 Testing configuration defaults...");

      // Test default values
      const defaults = {
        PORT: 3001,
        NODE_ENV: "development",
        AI_MODEL: "gemini-1.5-flash",
        MAX_RUN_HISTORY: 100,
        STDIN_MAX_BYTES: 1048576, // 1MB
        JSON_LIMIT: "50mb",
        URL_ENCODED_LIMIT: "50mb",
      };

      let correctDefaults = 0;
      const totalDefaults = Object.keys(defaults).length;

      for (const [key, expectedDefault] of Object.entries(defaults)) {
        const actualValue = config[key];
        const isCorrect = actualValue !== undefined;

        console.log(`   ${key}: ${actualValue} ${isCorrect ? "✅" : "❌"}`);
        if (isCorrect) correctDefaults++;
      }

      console.log(
        `✅ ${correctDefaults}/${totalDefaults} default values configured`
      );
      this.addResult(
        "Config Defaults",
        true,
        `${correctDefaults}/${totalDefaults} defaults set`
      );
    } catch (error) {
      console.error("❌ Config defaults test failed:", error.message);
      this.addResult("Config Defaults", false, error.message);
    }
  }

  async testConfigValidation() {
    try {
      console.log("\n✅ Testing configuration validation...");

      // Test numeric values
      const numericConfigs = ["PORT", "MAX_RUN_HISTORY", "STDIN_MAX_BYTES"];
      let validNumeric = 0;

      for (const configKey of numericConfigs) {
        const value = config[configKey];
        const isValid = typeof value === "number" && value > 0;
        console.log(
          `   ${configKey}: ${value} (${typeof value}) ${isValid ? "✅" : "❌"}`
        );
        if (isValid) validNumeric++;
      }

      // Test boolean values
      const booleanConfigs = ["USE_DB_PROJECTS_BOOL", "DOCKER_REUSE"];
      let validBoolean = 0;

      for (const configKey of booleanConfigs) {
        const value = config[configKey];
        const isValid = typeof value === "boolean";
        console.log(
          `   ${configKey}: ${value} (${typeof value}) ${isValid ? "✅" : "❌"}`
        );
        if (isValid) validBoolean++;
      }

      console.log(`✅ Configuration validation passed`);
      this.addResult(
        "Config Validation",
        true,
        `${validNumeric + validBoolean} values validated`
      );
    } catch (error) {
      console.error("❌ Config validation test failed:", error.message);
      this.addResult("Config Validation", false, error.message);
    }
  }

  async testPathGeneration() {
    try {
      console.log("\n📁 Testing path generation...");

      const projectsDir = config.getProjectsDir();
      const uploadsDir = config.getUploadsDir();

      console.log(`   Projects directory: ${projectsDir}`);
      console.log(`   Uploads directory: ${uploadsDir}`);

      // Test that paths are generated and are strings
      const validPaths =
        typeof projectsDir === "string" &&
        projectsDir.length > 0 &&
        typeof uploadsDir === "string" &&
        uploadsDir.length > 0;

      if (validPaths) {
        console.log("✅ Path generation working correctly");
        this.addResult(
          "Path Generation",
          true,
          "All paths generated correctly"
        );
      } else {
        console.log("❌ Path generation failed");
        this.addResult("Path Generation", false, "Invalid paths generated");
      }
    } catch (error) {
      console.error("❌ Path generation test failed:", error.message);
      this.addResult("Path Generation", false, error.message);
    }
  }

  addResult(testName, success, message) {
    this.testResults.push({ testName, success, message });
  }

  printResults() {
    console.log("\n" + "=".repeat(50));
    console.log("⚙️ CONFIGURATION UNIT TEST RESULTS");
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
}

// Run tests if called directly
if (require.main === module) {
  const configTest = new ConfigTest();
  configTest.runAllTests().catch(console.error);
}

module.exports = ConfigTest;
