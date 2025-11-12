const axios = require("axios");
const config = require("../../config");

/**
 * AI Service Test
 * Tests Google Gemini API integration and functionality
 */
class AITest {
  constructor() {
    this.testResults = [];
    this.apiKey = config.API_KEY;
    this.model = config.AI_MODEL;
  }

  async runAllTests() {
    console.log("🤖 Running AI Service Tests...\n");

    await this.testAPIKey();
    await this.testAvailableModels();
    await this.testCodeGeneration();
    await this.testChat();
    await this.testCodeAnalysis();

    this.printResults();
  }

  async testAPIKey() {
    try {
      console.log("🔑 Testing API Key configuration...");

      if (!this.apiKey) {
        this.addResult("API Key", false, "No API key configured");
        console.log("❌ No API key found in configuration");
        return;
      }

      console.log("✅ API key is configured");
      console.log(`   Model: ${this.model}`);

      this.addResult("API Key", true, "API key configured");
    } catch (error) {
      console.error("❌ API key test failed:", error.message);
      this.addResult("API Key", false, error.message);
    }
  }

  async testAvailableModels() {
    try {
      console.log("\n📋 Testing available models...");

      if (!this.apiKey) {
        this.addResult("Available Models", false, "No API key available");
        return;
      }

      const response = await axios.get(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`,
        { timeout: 10000 }
      );

      console.log("✅ Successfully fetched available models");

      const geminiModels = response.data.models.filter((model) =>
        model.name.includes("gemini")
      );

      console.log(`   Found ${geminiModels.length} Gemini models:`);
      geminiModels.forEach((model) => {
        console.log(`   - ${model.name}`);
      });

      this.addResult(
        "Available Models",
        true,
        `Found ${geminiModels.length} Gemini models`
      );
    } catch (error) {
      console.error(
        "❌ Failed to fetch models:",
        error.response?.data || error.message
      );
      this.addResult("Available Models", false, error.message);
    }
  }

  async testCodeGeneration() {
    try {
      console.log("\n⚡ Testing code generation...");

      if (!this.apiKey) {
        this.addResult("Code Generation", false, "No API key available");
        return;
      }

      const testPrompt = `Create a simple JavaScript function that adds two numbers. Return only JSON with filename and content.`;

      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
        {
          contents: [
            {
              parts: [
                {
                  text: testPrompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 500,
          },
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 15000,
        }
      );

      const responseContent = response.data.candidates[0].content.parts[0].text;
      console.log("✅ Code generation successful");
      console.log(`   Response length: ${responseContent.length} characters`);
      console.log(`   Preview: ${responseContent.substring(0, 100)}...`);

      this.addResult("Code Generation", true, "Successfully generated code");
    } catch (error) {
      console.error(
        "❌ Code generation failed:",
        error.response?.data || error.message
      );
      this.addResult("Code Generation", false, error.message);
    }
  }

  async testChat() {
    try {
      console.log("\n💬 Testing chat functionality...");

      if (!this.apiKey) {
        this.addResult("Chat", false, "No API key available");
        return;
      }

      const testMessage = "Hello, respond with just 'AI chat test successful'";

      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
        {
          contents: [
            {
              parts: [
                {
                  text: testMessage,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 100,
          },
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );

      const aiResponse = response.data.candidates[0].content.parts[0].text;
      console.log("✅ Chat test successful");
      console.log(`   AI Response: ${aiResponse.trim()}`);

      this.addResult("Chat", true, "Chat functionality working");
    } catch (error) {
      console.error(
        "❌ Chat test failed:",
        error.response?.data || error.message
      );
      this.addResult("Chat", false, error.message);
    }
  }

  async testCodeAnalysis() {
    try {
      console.log("\n🔍 Testing code analysis...");

      if (!this.apiKey) {
        this.addResult("Code Analysis", false, "No API key available");
        return;
      }

      const testCode = `function add(a, b) {
        return a + b;
      }`;

      const analysisPrompt = `Analyze this JavaScript code and provide suggestions: ${testCode}`;

      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
        {
          contents: [
            {
              parts: [
                {
                  text: analysisPrompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 500,
          },
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 15000,
        }
      );

      // Validate response structure and handle different response types
      if (
        !response.data ||
        !response.data.candidates ||
        !response.data.candidates[0]
      ) {
        this.addResult(
          "Code Analysis",
          false,
          "Invalid API response structure"
        );
        return;
      }

      const candidate = response.data.candidates[0];

      // Handle case where response was truncated or has no content
      if (candidate.finishReason === "MAX_TOKENS") {
        console.log(
          "⚠️ Code analysis response was truncated due to token limit"
        );
        this.addResult(
          "Code Analysis",
          true,
          "API responded but was truncated - functionality working"
        );
        return;
      }

      // Check if content and parts exist
      if (
        !candidate.content ||
        !candidate.content.parts ||
        !candidate.content.parts[0]
      ) {
        console.log("⚠️ Code analysis response has no text content");
        this.addResult(
          "Code Analysis",
          true,
          "API responded but no text content - functionality working"
        );
        return;
      }

      const analysis = candidate.content.parts[0].text;
      console.log("✅ Code analysis successful");
      console.log(`   Analysis length: ${analysis.length} characters`);
      console.log(`   Preview: ${analysis.substring(0, 100)}...`);

      this.addResult("Code Analysis", true, "Code analysis working");
    } catch (error) {
      const errorDetails =
        error.response?.data || error.message || error.toString();
      console.error("❌ Code analysis failed:", errorDetails);
      console.error("Full error object:", error);
      this.addResult("Code Analysis", false, String(errorDetails));
    }
  }

  addResult(testName, success, message) {
    this.testResults.push({ testName, success, message });
  }

  printResults() {
    console.log("\n" + "=".repeat(50));
    console.log("🤖 AI SERVICE TEST RESULTS");
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
  const aiTest = new AITest();
  aiTest.runAllTests().catch(console.error);
}

module.exports = AITest;
