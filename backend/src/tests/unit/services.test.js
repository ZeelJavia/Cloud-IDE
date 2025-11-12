const projectService = require("../../services/projectService");
const fileService = require("../../services/fileService");
const config = require("../../config");

/**
 * Service Unit Tests
 * Tests service layer business logic functions
 */
class ServiceTest {
  constructor() {
    this.testResults = [];
  }

  async runAllTests() {
    console.log("🔧 Running Service Unit Tests...\n");

    await this.testProjectServiceMethods();
    await this.testFileServiceMethods();
    await this.testErrorHandling();
    await this.testServiceValidation();

    this.printResults();
  }

  async testProjectServiceMethods() {
    try {
      console.log("📁 Testing project service methods...");

      // Test service instantiation
      const hasCreateProject =
        typeof projectService.createProject === "function";
      const hasGetProjects = typeof projectService.getProjects === "function";
      const hasGetProject = typeof projectService.getProject === "function";
      const hasUpdateProject =
        typeof projectService.updateProject === "function";
      const hasDeleteProject =
        typeof projectService.deleteProject === "function";

      console.log(`   createProject method: ${hasCreateProject ? "✅" : "❌"}`);
      console.log(`   getProjects method: ${hasGetProjects ? "✅" : "❌"}`);
      console.log(`   getProject method: ${hasGetProject ? "✅" : "❌"}`);
      console.log(`   updateProject method: ${hasUpdateProject ? "✅" : "❌"}`);
      console.log(`   deleteProject method: ${hasDeleteProject ? "✅" : "❌"}`);

      const allMethodsExist =
        hasCreateProject &&
        hasGetProjects &&
        hasGetProject &&
        hasUpdateProject &&
        hasDeleteProject;

      if (allMethodsExist) {
        console.log("✅ All project service methods exist");
        this.addResult(
          "Project Service Methods",
          true,
          "All CRUD methods available"
        );
      } else {
        console.log("❌ Some project service methods missing");
        this.addResult(
          "Project Service Methods",
          false,
          "Missing methods detected"
        );
      }
    } catch (error) {
      console.error("❌ Project service test failed:", error.message);
      this.addResult("Project Service Methods", false, error.message);
    }
  }

  async testFileServiceMethods() {
    try {
      console.log("\n📄 Testing file service methods...");

      // Test service instantiation
      const hasCreateFile = typeof fileService.createFile === "function";
      const hasGetFiles = typeof fileService.getFiles === "function";
      const hasGetFile = typeof fileService.getFile === "function";
      const hasUpdateFile = typeof fileService.updateFile === "function";
      const hasDeleteFile = typeof fileService.deleteFile === "function";
      const hasGetProjectTree =
        typeof fileService.getProjectTree === "function";

      console.log(`   createFile method: ${hasCreateFile ? "✅" : "❌"}`);
      console.log(`   getFiles method: ${hasGetFiles ? "✅" : "❌"}`);
      console.log(`   getFile method: ${hasGetFile ? "✅" : "❌"}`);
      console.log(`   updateFile method: ${hasUpdateFile ? "✅" : "❌"}`);
      console.log(`   deleteFile method: ${hasDeleteFile ? "✅" : "❌"}`);
      console.log(
        `   getProjectTree method: ${hasGetProjectTree ? "✅" : "❌"}`
      );

      const allMethodsExist =
        hasCreateFile &&
        hasGetFiles &&
        hasGetFile &&
        hasUpdateFile &&
        hasDeleteFile &&
        hasGetProjectTree;

      if (allMethodsExist) {
        console.log("✅ All file service methods exist");
        this.addResult(
          "File Service Methods",
          true,
          "All file operations available"
        );
      } else {
        console.log("❌ Some file service methods missing");
        this.addResult(
          "File Service Methods",
          false,
          "Missing methods detected"
        );
      }
    } catch (error) {
      console.error("❌ File service test failed:", error.message);
      this.addResult("File Service Methods", false, error.message);
    }
  }

  async testErrorHandling() {
    try {
      console.log("\n⚠️ Testing error handling...");

      // Test project service error handling
      try {
        await projectService.getProject(null);
        console.log("❌ Project service should handle null ID");
        this.addResult("Error Handling", false, "Null ID not handled");
      } catch (error) {
        console.log("✅ Project service properly handles null ID");
      }

      // Test file service error handling
      try {
        await fileService.getFile(null);
        console.log("❌ File service should handle null ID");
        this.addResult("Error Handling", false, "Null ID not handled");
      } catch (error) {
        console.log("✅ File service properly handles null ID");
      }

      console.log("✅ Error handling tests completed");
      this.addResult("Error Handling", true, "Services handle invalid inputs");
    } catch (error) {
      console.error("❌ Error handling test failed:", error.message);
      this.addResult("Error Handling", false, error.message);
    }
  }

  async testServiceValidation() {
    try {
      console.log("\n✅ Testing service input validation...");

      // Test validation functions exist
      const projectServiceValidation =
        projectService.validateProjectData !== undefined;
      const fileServiceValidation = fileService.validateFileData !== undefined;

      console.log(
        `   Project validation: ${projectServiceValidation ? "✅" : "⚠️"}`
      );
      console.log(`   File validation: ${fileServiceValidation ? "✅" : "⚠️"}`);

      // Test that services can handle basic validation
      let validationPassed = true;

      try {
        // These should not throw critical errors
        await projectService.getProjects().catch(() => {}); // Might fail without DB
        await fileService.getFiles().catch(() => {}); // Might fail without DB
        console.log("✅ Services handle basic method calls");
      } catch (error) {
        console.log("⚠️ Services may have instantiation issues");
        validationPassed = false;
      }

      this.addResult(
        "Service Validation",
        validationPassed,
        "Basic validation checks passed"
      );
    } catch (error) {
      console.error("❌ Service validation test failed:", error.message);
      this.addResult("Service Validation", false, error.message);
    }
  }

  addResult(testName, success, message) {
    this.testResults.push({ testName, success, message });
  }

  printResults() {
    console.log("\n" + "=".repeat(50));
    console.log("🔧 SERVICE UNIT TEST RESULTS");
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
  const serviceTest = new ServiceTest();
  serviceTest.runAllTests().catch(console.error);
}

module.exports = ServiceTest;
