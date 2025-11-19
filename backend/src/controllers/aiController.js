/**
 * AI Controller - Handles AI assistant chat and code generation requests
 */

class AIController {
  async generateCode(req, res) {
    try {
      const { prompt, projectName } = req.body;
      const result = await aiService.generateCode(
        prompt,
        projectName,
        req.body.saveToProject
      );
      res.json(result);
    } catch (error) {
      if (error.message.includes("AI is not configured")) {
        return res.status(501).json({ error: error.message });
      }
      console.error("AI Generation Error:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async chat(req, res) {
    try {
      const { message, history = [], context } = req.body;
      const result = await aiService.chat(message, history, context);
      res.json(result);
    } catch (error) {
      console.error("AI Chat Error:", error);
      res.json({
        response:
          "🤖 AI Assistant: I'm having trouble connecting to the AI service right now. Please try again in a moment.",
        timestamp: new Date().toISOString(),
      });
    }
  }

  async analyzeCode(req, res) {
    try {
      const { code, language, fileName } = req.body;
      const result = await aiService.analyzeCode(code, language, fileName);
      res.json(result);
    } catch (error) {
      if (error.message.includes("AI is not configured")) {
        return res.status(501).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = new AIController();
