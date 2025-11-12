const DatabaseTest = require("./integration/database.test");
const AITest = require("./integration/ai.test");
const ServerTest = require("./integration/server.test");
const ConfigTest = require("./unit/config.test");
const ServiceTest = require("./unit/services.test");
const MiddlewareTest = require("./unit/middleware.test");
const APITest = require("./api/endpoints.test");

/**
 * Master Test Runner
 * Orchestrates all test suites and provides comprehensive reporting
 */
class TestRunner {
  constructor() {
    this.allResults = [];
    this.startTime = null;
    this.endTime = null;
  }

  async runAllTests() {
    console.log("🚀 STARTING COMPREHENSIVE TEST SUITE");
    console.log("=".repeat(60));
    this.startTime = new Date();

    // Run all test suites
    await this.runTestSuite("Unit Tests - Configuration", ConfigTest);
    await this.runTestSuite("Unit Tests - Services", ServiceTest);
    await this.runTestSuite("Unit Tests - Middleware", MiddlewareTest);
    await this.runTestSuite("Integration Tests - Database", DatabaseTest);
    await this.runTestSuite("Integration Tests - AI Service", AITest);
    await this.runTestSuite("Integration Tests - Server", ServerTest);
    await this.runTestSuite("API Tests - Endpoints", APITest);

    this.endTime = new Date();
    this.generateFinalReport();
  }

  async runTestSuite(suiteName, TestClass) {
    console.log(`\n🔍 ${suiteName.toUpperCase()}`);
    console.log("─".repeat(60));

    try {
      const testInstance = new TestClass();
      const startTime = new Date();

      await testInstance.runAllTests();

      const endTime = new Date();
      const duration = endTime - startTime;

      // Extract results if available
      const results = testInstance.testResults || [];
      const passed = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      this.allResults.push({
        suiteName,
        passed,
        failed,
        total: passed + failed,
        duration,
        results,
      });

      console.log(`\n⏱️ ${suiteName} completed in ${duration}ms`);
      console.log(`📊 Results: ${passed} passed, ${failed} failed\n`);
    } catch (error) {
      console.error(`❌ ${suiteName} failed to run:`, error.message);
      this.allResults.push({
        suiteName,
        passed: 0,
        failed: 1,
        total: 1,
        duration: 0,
        error: error.message,
        results: [],
      });
    }
  }

  generateFinalReport() {
    console.log("\n" + "=".repeat(80));
    console.log("📋 COMPREHENSIVE TEST REPORT");
    console.log("=".repeat(80));

    const totalDuration = this.endTime - this.startTime;
    let totalPassed = 0;
    let totalFailed = 0;
    let totalTests = 0;

    console.log(
      `🕐 Test execution time: ${totalDuration}ms (${(
        totalDuration / 1000
      ).toFixed(2)}s)`
    );
    console.log(`📅 Completed at: ${this.endTime.toISOString()}\n`);

    // Suite by suite breakdown
    console.log("📊 TEST SUITE BREAKDOWN:");
    console.log("-".repeat(80));

    this.allResults.forEach((suite) => {
      const status =
        suite.failed === 0
          ? "✅ PASS"
          : suite.failed > suite.passed
          ? "❌ FAIL"
          : "⚠️ PARTIAL";
      console.log(`${status} ${suite.suiteName}`);
      console.log(
        `   📈 ${suite.passed} passed, ${suite.failed} failed (${suite.total} total)`
      );
      console.log(`   ⏱️ Duration: ${suite.duration}ms`);

      if (suite.error) {
        console.log(`   ❌ Error: ${suite.error}`);
      }

      totalPassed += suite.passed;
      totalFailed += suite.failed;
      totalTests += suite.total;
      console.log();
    });

    // Overall summary
    console.log("=".repeat(80));
    console.log("🎯 OVERALL SUMMARY");
    console.log("=".repeat(80));

    const overallSuccessRate =
      totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : 0;
    const overallStatus =
      totalFailed === 0
        ? "✅ ALL PASS"
        : totalPassed > totalFailed
        ? "⚠️ MOSTLY PASS"
        : "❌ MOSTLY FAIL";

    console.log(`${overallStatus}`);
    console.log(`📊 Total Tests: ${totalTests}`);
    console.log(`✅ Passed: ${totalPassed}`);
    console.log(`❌ Failed: ${totalFailed}`);
    console.log(`📈 Success Rate: ${overallSuccessRate}%`);
    console.log(`⏱️ Total Duration: ${totalDuration}ms`);

    // Recommendations
    console.log("\n🔧 RECOMMENDATIONS:");
    console.log("-".repeat(40));

    if (totalFailed === 0) {
      console.log("🎉 Excellent! All tests are passing.");
      console.log(
        "💡 Consider adding more edge case tests for better coverage."
      );
    } else if (totalPassed > totalFailed) {
      console.log("👍 Most tests are passing, but some issues need attention.");
      console.log(
        "🔍 Focus on fixing the failed tests for better reliability."
      );
    } else {
      console.log("⚠️ Many tests are failing - immediate attention required.");
      console.log("🔥 Priority: Fix critical failures before deployment.");
    }

    // Critical issues
    const criticalSuites = this.allResults.filter((s) => s.failed > s.passed);
    if (criticalSuites.length > 0) {
      console.log("\n🚨 CRITICAL ISSUES:");
      criticalSuites.forEach((suite) => {
        console.log(`   ❌ ${suite.suiteName}: ${suite.failed} failures`);
      });
    }

    console.log("\n" + "=".repeat(80));
    console.log("✨ TEST SUITE COMPLETED");
    console.log("=".repeat(80));
  }

  // Method to run specific test category
  async runUnitTests() {
    console.log("🔬 Running Unit Tests Only\n");
    await this.runTestSuite("Unit Tests - Configuration", ConfigTest);
    await this.runTestSuite("Unit Tests - Services", ServiceTest);
    await this.runTestSuite("Unit Tests - Middleware", MiddlewareTest);
    this.generateFinalReport();
  }

  async runIntegrationTests() {
    console.log("🔗 Running Integration Tests Only\n");
    await this.runTestSuite("Integration Tests - Database", DatabaseTest);
    await this.runTestSuite("Integration Tests - AI Service", AITest);
    await this.runTestSuite("Integration Tests - Server", ServerTest);
    this.generateFinalReport();
  }

  async runAPITests() {
    console.log("🌐 Running API Tests Only\n");
    await this.runTestSuite("API Tests - Endpoints", APITest);
    this.generateFinalReport();
  }
}

// CLI interface
if (require.main === module) {
  const testRunner = new TestRunner();
  const args = process.argv.slice(2);

  if (args.includes("--unit")) {
    testRunner.runUnitTests().catch(console.error);
  } else if (args.includes("--integration")) {
    testRunner.runIntegrationTests().catch(console.error);
  } else if (args.includes("--api")) {
    testRunner.runAPITests().catch(console.error);
  } else {
    testRunner.runAllTests().catch(console.error);
  }
}

module.exports = TestRunner;
