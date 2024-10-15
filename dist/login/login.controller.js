"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserDetails = exports.userChangePassword = exports.userResetPassword = exports.userRegister = exports.userLogin = void 0;
const login_resolver_1 = require("./login.resolver");
const client_1 = require("@prisma/client");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const login_repository_1 = __importDefault(require("./login.repository"));
const extractRoleFromUsername = (username) => {
    const parts = username.split('_');
    if (parts.length > 1) {
        const roleString = parts[1].split('@')[0];
        // Ensure the role is one of the valid enum values
        switch (roleString.toLowerCase()) {
            case 'admin':
                return client_1.UserRole.admin;
            case 'subadmin':
                return client_1.UserRole.sub_admin;
            case 'doctor':
                return client_1.UserRole.doctor;
            case 'super_admin':
                return client_1.UserRole.super_admin; // Added for completeness
            default:
                console.warn(`Unknown role: ${roleString}`); // Log unknown role
                return client_1.UserRole.unknown; // Return 'unknown' if role is unrecognized
        }
    }
    return client_1.UserRole.super_admin; // Default to 'user' if no role is found
};
// Function to generate JWT token
const generateToken = (user) => {
    return jsonwebtoken_1.default.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN, // Token expires in 1 hour
    });
};
const userLogin = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { username, password } = req.body;
        const role = extractRoleFromUsername(username); // Extract role
        const user = yield (0, login_resolver_1.loginUser)(username, password);
        if (user) {
            const role = extractRoleFromUsername(user.username); // Extract role
            const token = generateToken(user); // Generate JWT token
            res.status(200).json({ token, user: { username: user.username, role } }); // Send token and user data
        }
        else {
            res.status(401).json({ error: 'Invalid username or password' });
        }
    }
    catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.userLogin = userLogin;
const userRegister = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { username, password } = req.body;
        const role = extractRoleFromUsername(username); // Extract role from username
        const newUser = yield (0, login_resolver_1.createUser)(username, password, role);
        res.status(201).json(newUser);
    }
    catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.userRegister = userRegister;
const userResetPassword = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { username, newPassword } = req.body;
        yield (0, login_resolver_1.resetPassword)(username, newPassword);
        res.status(200).json({ message: 'Password reset successful' });
    }
    catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.userResetPassword = userResetPassword;
const userChangePassword = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { userId, oldPassword, newPassword } = req.body;
        yield (0, login_resolver_1.changePassword)(userId, oldPassword, newPassword);
        res.status(200).json({ message: 'Password change successful' });
    }
    catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.userChangePassword = userChangePassword;
const getUserDetails = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id; // Assuming user ID is stored in the request after authentication
        if (typeof userId !== 'number') {
            res.status(401).json({ error: 'Unauthorized: User ID not found' });
            return; // Ensure to return after sending a response
        }
        const user = yield login_repository_1.default.findUserById(userId);
        if (user) {
            const role = extractRoleFromUsername(user.username); // Extract role from username if needed
            res.status(200).json({ username: user.username, role }); // Send username and role
        }
        else {
            res.status(404).json({ error: 'User not found' });
        }
    }
    catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.getUserDetails = getUserDetails;
