const axios = require("axios");
const config = require("../config");

class AIService {
  constructor() {
    this.API_KEY = config.API_KEY;
    this.MODEL = config.AI_MODEL;
  }

  isConfigured() {
    return !!this.API_KEY;
  }

  async generateCode(prompt, projectName, saveToProject = false) {
    if (!this.API_KEY) {
      throw new Error("AI is not configured. Set A4F_API_KEY in .env.");
    }

    const systemPrompt = `You are a helpful coding assistant. When asked to create code for a problem, respond ONLY with a valid JSON array containing objects with "filename" and "content" properties. The content should include proper file structure and complete code. Do not include any explanatory text outside the JSON. Example format:
[
  {
    "filename": "index.html",
    "content": "<!DOCTYPE html>..."
  },
  {
    "filename": "style.css", 
    "content": "body { ... }"
  }
]`;

    const fullPrompt = `${systemPrompt}\n\nUser request: ${prompt}`;

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.MODEL}:generateContent?key=${this.API_KEY}`,
      {
        contents: [
          {
            parts: [
              {
                text: fullPrompt,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1500,
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const responseContent = response.data.candidates[0].content.parts[0].text;

    // Clean the response
    let cleanedResponse = responseContent.trim();
    if (cleanedResponse.startsWith("```json")) {
      cleanedResponse = cleanedResponse.replace(/^```json\s*/, "");
    } else if (cleanedResponse.startsWith("```")) {
      cleanedResponse = cleanedResponse.replace(/^```\s*/, "");
    }

    if (cleanedResponse.includes("```")) {
      cleanedResponse = cleanedResponse.split("```")[0];
    }

    cleanedResponse = cleanedResponse.replace(/["'`]*\s*$/, "").trim();

    const files = JSON.parse(cleanedResponse);

    // Optionally save generated files to project
    if (projectName && saveToProject) {
      const fs = require("fs");
      const path = require("path");
      const projectPath = path.join(config.getProjectsDir(), projectName);
      if (!fs.existsSync(projectPath)) {
        fs.mkdirSync(projectPath, { recursive: true });
      }

      files.forEach((file) => {
        const fpath = path.join(projectPath, file.filename);
        const dir = path.dirname(fpath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fpath, file.content, "utf8");
      });
    }

    return {
      files,
      rawResponse: responseContent,
      message: "Code generated successfully",
    };
  }

  async chat(message, history = [], context) {
    if (!this.API_KEY) {
      return {
        response:
          "🤖 AI Assistant: Hi! I'm ready to help you with coding questions. However, to provide real AI responses, you need to:\n\n1. Configure your A4F API key in the .env file as A4F_API_KEY=your-actual-key\n2. Restart the server\n\nOnce configured, I can help with code analysis, debugging, and development questions!",
      };
    }

    const systemPrompt = `You are a helpful AI assistant specialized in coding and development. You're integrated into a web-based IDE similar to VS Code. You can help with:
        - Writing and debugging code
        - Explaining programming concepts
        - Suggesting best practices
        - Code optimization
        - Architecture advice
        - Framework-specific guidance
        
        ${context ? `Current context: ${context}` : ""}
        
        Provide clear, concise answers and code examples when appropriate.`;

    const conversationHistory = history
      .slice(-10)
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join("\n");
    const fullPrompt = `${systemPrompt}\n\nConversation history:\n${conversationHistory}\n\nUser: ${message}\n\nAssistant:`;

    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.MODEL}:generateContent?key=${this.API_KEY}`,
        {
          contents: [
            {
              parts: [
                {
                  text: fullPrompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1000,
          },
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      const aiResponse = response.data.candidates[0].content.parts[0].text;
      return {
        response: aiResponse,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error("AI Chat Error:", error.response?.data || error.message);
      return {
        response:
          "🤖 AI Assistant: I'm having trouble connecting to the AI service right now. Please try again in a moment.",
        timestamp: new Date().toISOString(),
      };
    }
  }

  async analyzeCode(code, language, fileName) {
    if (!this.API_KEY) {
      throw new Error("AI is not configured. Set A4F_API_KEY in .env.");
    }

    const systemPrompt =
      "You are a code analysis expert. Analyze the provided code and give suggestions for improvements, potential bugs, best practices, and optimizations. Be concise and specific.";
    const fullPrompt = `${systemPrompt}\n\nAnalyze this ${language} code from file "${fileName}":\n\n${code}`;

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.MODEL}:generateContent?key=${this.API_KEY}`,
      {
        contents: [
          {
            parts: [
              {
                text: fullPrompt,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1000,
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const analysis = response.data.candidates[0].content.parts[0].text;
    return { analysis };
  }
}

module.exports = new AIService();
