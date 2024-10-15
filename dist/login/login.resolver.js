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
exports.changePassword = exports.resetPassword = exports.createUser = exports.loginUser = void 0;
const login_repository_1 = __importDefault(require("./login.repository"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const loginUser = (username, password) => __awaiter(void 0, void 0, void 0, function* () {
    const user = yield login_repository_1.default.findUserByUsername(username);
    if (user && bcrypt_1.default.compareSync(password, user.password)) {
        return user;
    }
    return null;
});
exports.loginUser = loginUser;
const createUser = (username, password, role) => __awaiter(void 0, void 0, void 0, function* () {
    const hashedPassword = bcrypt_1.default.hashSync(password, 10);
    return login_repository_1.default.createUser(username, hashedPassword, role); // Pass role here
});
exports.createUser = createUser;
const resetPassword = (username, newPassword) => __awaiter(void 0, void 0, void 0, function* () {
    const hashedPassword = bcrypt_1.default.hashSync(newPassword, 10);
    return login_repository_1.default.updatePasswordByUsername(username, hashedPassword);
});
exports.resetPassword = resetPassword;
const changePassword = (userId, oldPassword, newPassword) => __awaiter(void 0, void 0, void 0, function* () {
    const user = yield login_repository_1.default.findUserById(userId);
    if (user && bcrypt_1.default.compareSync(oldPassword, user.password)) {
        const hashedPassword = bcrypt_1.default.hashSync(newPassword, 10);
        return login_repository_1.default.updatePasswordByUserId(userId, hashedPassword);
    }
    return null;
});
exports.changePassword = changePassword;
