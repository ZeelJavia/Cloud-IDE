// Error handling middleware
const errorHandler = (error, req, res, next) => {
  console.error("Error:", error);
  res.status(500).json({
    error: "Internal server error",
    message: error.message,
  });
};

// 404 handler
const notFoundHandler = (req, res) => {
  res.status(404).json({ error: "API endpoint not found" });
};

module.exports = {
  errorHandler,
  notFoundHandler,
};
