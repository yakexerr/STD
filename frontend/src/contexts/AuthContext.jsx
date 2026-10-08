import { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

/**
 * Провайдер контекста авторизации.
 * Управляет состоянием пользователя, токеном и методами аутентификации.
 * @param {Object} props - Props компонента.
 * @param {React.ReactNode} props.children - Дочерние компоненты.
 */
export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const savedToken = localStorage.getItem('token');
        const savedUser = localStorage.getItem('user');

        if (savedToken && savedUser) {
            setToken(savedToken);
            setUser(JSON.parse(savedUser));
        }
        setLoading(false);
    }, []);

    /**
     * Вход пользователя.
     * @param {string} email - Email.
     * @param {string} password - Пароль.
     * @returns {Promise<void>}
     */
    const login = async (email, password) => {
        const response = await api.auth.login(email, password);
        const { token: newToken, user: newUser } = response.data;

        localStorage.setItem('token', newToken);
        localStorage.setItem('user', JSON.stringify(newUser));

        setToken(newToken);
        setUser(newUser);
    };

    /**
     * Регистрация нового пользователя.
     * @param {string} email - Email.
     * @param {string} password - Пароль.
     * @param {string} role - Роль.
     * @returns {Promise<void>}
     */
    const register = async (email, password, role) => {
        const response = await api.auth.register(email, password, role);
        const { token: newToken, user: newUser } = response.data;

        localStorage.setItem('token', newToken);
        localStorage.setItem('user', JSON.stringify(newUser));

        setToken(newToken);
        setUser(newUser);
    };

    /**
     * Выход пользователя.
     */
    const logout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setToken(null);
        setUser(null);
    };

    const value = {
        user,
        token,
        login,
        register,
        logout,
        loading
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Хук для доступа к контексту авторизации.
 * @returns {Object} Объект с user, token, login, register, logout, loading.
 */
export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
}