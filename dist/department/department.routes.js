"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const department_controller_1 = require("./department.controller");
const router = (0, express_1.Router)();
router.post('/', department_controller_1.createDepartment); // Changed from '/departments' to '/'
router.get('/', department_controller_1.getDepartments); // Changed from '/departments' to '/'
exports.default = router;
