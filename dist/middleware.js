"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const authenticateToken = (req, res, next) => {
    var _a;
    const token = (_a = req.headers['authorization']) === null || _a === void 0 ? void 0 : _a.split(' ')[1]; // Extract token from Authorization header
    if (!token) {
        res.sendStatus(401); // Unauthorized if token is not present
        return; // Ensure we return to avoid further processing
    }
    jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            res.sendStatus(403); // Forbidden if token is invalid
            return; // Ensure we return to avoid further processing
        }
        req.user = user; // Attach user information to request
        next(); // Proceed to the next middleware or route handler
    });
};
exports.authenticateToken = authenticateToken;
