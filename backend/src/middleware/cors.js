const cors = require("cors");
const config = require("../config");

const corsMiddleware = cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowedOrigins = config.ALLOWED_ORIGINS.length
      ? config.ALLOWED_ORIGINS
      : config.DEFAULT_ORIGINS;
    // console.log(
    //   `🔍 CORS Check: Origin=${origin}, Allowed=${allowedOrigins.join(",")}`
    // );
    const isAllowed = allowedOrigins.includes(origin);
    callback(null, isAllowed);
  },
  credentials: true,
});

module.exports = corsMiddleware;
