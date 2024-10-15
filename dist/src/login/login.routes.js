"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const login_controller_1 = require("./login.controller");
const middleware_1 = require("../../middleware");
const router = (0, express_1.Router)();
router.post('/login', login_controller_1.userLogin);
router.post('/register', login_controller_1.userRegister);
router.post('/reset-password', login_controller_1.userResetPassword);
router.post('/change-password', login_controller_1.userChangePassword);
router.get('/user-details', middleware_1.authenticateToken, login_controller_1.getUserDetails); // Protected route
exports.default = router;
