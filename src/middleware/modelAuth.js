module.exports = (req, res, next) => {

    const configuredApiKey = process.env.MODEL_API_KEY;
    const providedApiKey = req.get("x-model-api-key");
    const authorization = req.get("authorization");

    const bearerToken = authorization?.startsWith("Bearer ")
        ? authorization.slice(7)
        : null;

    console.log("Configured:", configuredApiKey);
    console.log("Provided Header:", providedApiKey);
    console.log("Bearer:", bearerToken);

    if (!configuredApiKey) {
        return res.status(500).json({
            success: false,
            message: "Model API key is not configured"
        });
    }

    if (
        providedApiKey !== configuredApiKey &&
        bearerToken !== configuredApiKey
    ) {
        return res.status(401).json({
            success: false,
            message: "Unauthorized model request"
        });
    }

    next();
};