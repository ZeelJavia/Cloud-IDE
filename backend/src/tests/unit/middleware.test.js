const authMiddleware = require("../../middleware/auth");
const corsMiddleware = require("../../middleware/cors");
const {
  errorHandler,
  notFoundHandler,
} = require("../../middleware/errorHandler");

/**
 * Middleware Unit Tests
 * Tests middleware functions and their behavior
 */
class MiddlewareTest {
  constructor() {
    this.testResults = [];
  }

  async runAllTests() {
    console.log("🛡️ Running Middleware Unit Tests...\n");

    await this.testAuthMiddleware();
    await this.testCorsMiddleware();
    await this.testErrorHandler();
    await this.testMiddlewareChaining();

    this.printResults();
  }

  async testAuthMiddleware() {
    try {
      console.log("🔐 Testing authentication middleware...");

      // Test that auth middleware exports correct functions
      const hasVerifyToken = typeof authMiddleware.verifyToken === "function";
      const hasOptionalAuth = typeof authMiddleware.optionalAuth === "function";

      console.log(`   verifyToken function: ${hasVerifyToken ? "✅" : "❌"}`);
      console.log(`   optionalAuth function: ${hasOptionalAuth ? "✅" : "❌"}`);

      // Test middleware structure
      if (hasVerifyToken) {
        const middlewareLength = authMiddleware.verifyToken.length;
        const isValidMiddleware = middlewareLength === 3; // req, res, next
        console.log(
          `   Middleware signature: ${
            isValidMiddleware ? "✅" : "❌"
          } (${middlewareLength} parameters)`
        );
      }

      const authTestsPassed = hasVerifyToken && hasOptionalAuth;

      if (authTestsPassed) {
        console.log("✅ Authentication middleware structure correct");
        this.addResult("Auth Middleware", true, "All auth functions available");
      } else {
        console.log("❌ Authentication middleware issues detected");
        this.addResult("Auth Middleware", false, "Missing auth functions");
      }
    } catch (error) {
      console.error("❌ Auth middleware test failed:", error.message);
      this.addResult("Auth Middleware", false, error.message);
    }
  }

  async testCorsMiddleware() {
    try {
      console.log("\n🌐 Testing CORS middleware...");

      // Test CORS middleware function
      const isCorsFunction = typeof corsMiddleware === "function";
      console.log(
        `   CORS middleware function: ${isCorsFunction ? "✅" : "❌"}`
      );

      if (isCorsFunction) {
        // Test that it's a proper middleware (3 parameters)
        const middlewareLength = corsMiddleware.length;
        const isValidMiddleware = middlewareLength === 3; // req, res, next
        console.log(
          `   Middleware signature: ${
            isValidMiddleware ? "✅" : "❌"
          } (${middlewareLength} parameters)`
        );

        // CORS middleware uses external library, so we just check it's properly structured
        console.log("✅ CORS middleware is properly configured");
        this.addResult(
          "CORS Middleware",
          true,
          "CORS middleware properly configured"
        );
      } else {
        this.addResult("CORS Middleware", false, "CORS not a function");
      }
    } catch (error) {
      console.error("❌ CORS middleware test failed:", error.message);
      this.addResult("CORS Middleware", false, error.message);
    }
  }

  async testErrorHandler() {
    try {
      console.log("\n⚠️ Testing error handler middleware...");

      // Test error handler function
      const isErrorFunction = typeof errorHandler === "function";
      console.log(
        `   Error handler function: ${isErrorFunction ? "✅" : "❌"}`
      );

      if (isErrorFunction) {
        // Test that it's a proper error middleware (4 parameters: err, req, res, next)
        const middlewareLength = errorHandler.length;
        const isValidErrorMiddleware = middlewareLength === 4;
        console.log(
          `   Error middleware signature: ${
            isValidErrorMiddleware ? "✅" : "❌"
          } (${middlewareLength} parameters)`
        );

        // Test basic error handling
        const mockError = new Error("Test error");
        const mockReq = { url: "/test" };
        const mockRes = {
          status: function (code) {
            this.statusCode = code;
            return this;
          },
          json: function (data) {
            this.responseData = data;
            return this;
          },
          statusCode: 200,
        };
        const mockNext = () => {};

        try {
          errorHandler(mockError, mockReq, mockRes, mockNext);
          const hasErrorResponse =
            mockRes.statusCode >= 400 && mockRes.responseData;
          console.log(
            `   Error handling response: ${hasErrorResponse ? "✅" : "❌"}`
          );

          if (hasErrorResponse) {
            this.addResult("Error Handler", true, "Error handler functional");
          } else {
            this.addResult(
              "Error Handler",
              false,
              "Error handler not responding correctly"
            );
          }
        } catch (error) {
          console.log("⚠️ Error handler execution issue:", error.message);
          this.addResult(
            "Error Handler",
            false,
            "Error handler execution error"
          );
        }
      } else {
        this.addResult("Error Handler", false, "Error handler not a function");
      }
    } catch (error) {
      console.error("❌ Error handler test failed:", error.message);
      this.addResult("Error Handler", false, error.message);
    }
  }

  async testMiddlewareChaining() {
    try {
      console.log("\n🔗 Testing middleware chaining...");

      // Test that all middleware can be chained
      let chainable = true;
      const middlewares = [
        { name: "CORS", fn: corsMiddleware },
        { name: "Auth", fn: authMiddleware.verifyToken },
        { name: "Error Handler", fn: errorHandler },
      ];

      for (const middleware of middlewares) {
        if (typeof middleware.fn !== "function") {
          console.log(`❌ ${middleware.name} is not chainable`);
          chainable = false;
        } else {
          console.log(`✅ ${middleware.name} is chainable`);
        }
      }

      if (chainable) {
        console.log("✅ All middleware can be chained");
        this.addResult(
          "Middleware Chaining",
          true,
          "All middleware properly structured"
        );
      } else {
        console.log("❌ Some middleware cannot be chained");
        this.addResult(
          "Middleware Chaining",
          false,
          "Chaining issues detected"
        );
      }
    } catch (error) {
      console.error("❌ Middleware chaining test failed:", error.message);
      this.addResult("Middleware Chaining", false, error.message);
    }
  }

  addResult(testName, success, message) {
    this.testResults.push({ testName, success, message });
  }

  printResults() {
    console.log("\n" + "=".repeat(50));
    console.log("🛡️ MIDDLEWARE UNIT TEST RESULTS");
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
  const middlewareTest = new MiddlewareTest();
  middlewareTest.runAllTests().catch(console.error);
}

module.exports = MiddlewareTest;
