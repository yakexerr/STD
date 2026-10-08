'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const config = require('../config');

const router = express.Router();

/**
 * Регистрация нового пользователя.
 * @route POST /api/auth/register
 */
router.post('/register', async (req, res) => {
    try {
        const { email, password, role } = req.body;

        // Валидация входных данных
        if (!email || !password || !role) {
            return res.status(400).json({ error: 'Email, password, and role are required' });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        if (!['ISSUER', 'HOLDER'].includes(role)) {
            return res.status(400).json({ error: 'Role must be ISSUER or HOLDER' });
        }

        // Проверяем, что пользователь с таким email не существует
        const [existingUsers] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUsers.length > 0) {
            return res.status(400).json({ error: 'User with this email already exists' });
        }

        // Хэшируем пароль
        const passwordHash = await bcrypt.hash(password, 10);

        // Вставляем пользователя в БД
        const [result] = await pool.query(
            'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
            [email, passwordHash, role]
        );

        const userId = result.insertId;

        // Генерируем JWT
        const token = jwt.sign(
            { id: userId, email, role },
            config.JWT_SECRET,
            { expiresIn: config.JWT_EXPIRES_IN }
        );

        res.status(201).json({
            token,
            user: { id: userId, email, role }
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * Вход пользователя.
 * @route POST /api/auth/login
 */
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        // Ищем пользователя
        const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const user = users[0];

        // Проверяем пароль
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Генерируем JWT
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            config.JWT_SECRET,
            { expiresIn: config.JWT_EXPIRES_IN }
        );

        res.status(200).json({
            token,
            user: { id: user.id, email: user.email, role: user.role }
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;