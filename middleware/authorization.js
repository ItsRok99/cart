const jwt = require("jsonwebtoken");
require("dotenv").config();

module.exports = async (req, res, next) => {
    try {
        // Pridobite celotno avtorizacijsko zaglavje
        const authHeader = req.header("token");

        // Preverite, ali zaglavje obstaja
        if (!authHeader) {
            return res.status(403).json("You are not authorized");
        }

        // Razdelite zaglavje na predpono in žeton
        const parts = authHeader.split(" ");

        // Preverite, ali ima zaglavje pravilno obliko "Bearer {jwtToken}"
        if (parts.length !== 2 || parts[0] !== "Bearer") {
            return res.status(403).json("You are not authorized");
        }

        // Pridobite dejanski JWT žeton
        const jwtToken = parts[1];

        // Preverite veljavnost žetona
        const payload = jwt.verify(jwtToken, process.env.jwtSecret);

        // Shranite podatke o uporabniku v zahtevek
        req.user = payload.user;

        // Nadaljujte z naslednjim middleware-om ali usmerjevalnikom
        next();
    } catch (err) {
        console.error(err.message);
        return res.status(403).json("You are not authorized");
    }
};