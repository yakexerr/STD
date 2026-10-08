import axios from 'axios';

const API_BASE_URL = 'http://localhost:5000/api';

/**
 * Axios instance с настроенными интерцепторами для работы с API.
 */
const apiInstance = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json'
    }
});

/**
 * Интерцептор запроса.
 * Автоматически добавляет Authorization header если токен есть в localStorage.
 */
apiInstance.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

/**
 * Интерцептор ответа.
 * При 401 ошибке удаляет токен из localStorage и редиректит на /login.
 */
apiInstance.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response && error.response.status === 401) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            if (window.location.pathname !== '/login') {
                window.location.href = '/login';
            }
        }
        return Promise.reject(error);
    }
);

/**
 * API сервис с методами для работы с бэкендом.
 */
const api = {
    auth: {
        /**
         * Регистрация нового пользователя.
         * @param {string} email - Email пользователя.
         * @param {string} password - Пароль.
         * @param {string} role - Роль ('ISSUER' или 'HOLDER').
         * @returns {Promise} Результат регистрации.
         */
        register: (email, password, role) => 
            apiInstance.post('/auth/register', { email, password, role }),

        /**
         * Вход пользователя.
         * @param {string} email - Email пользователя.
         * @param {string} password - Пароль.
         * @returns {Promise} Результат входа.
         */
        login: (email, password) => 
            apiInstance.post('/auth/login', { email, password })
    },

    documents: {
        /**
         * Выпуск нового документа.
         * @param {FormData} formData - FormData с файлом и метаданными.
         * @returns {Promise} Результат выпуска.
         */
        issue: (formData) => 
            apiInstance.post('/documents/issue', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            }),

        /**
         * Отзыв документа.
         * @param {number} documentId - ID документа.
         * @returns {Promise} Результат отзыва.
         */
        revoke: (documentId) => 
            apiInstance.post('/documents/revoke', { documentId }),

        /**
         * Получение списка документов пользователя.
         * @returns {Promise} Список документов.
         */
        getMy: () => 
            apiInstance.get('/documents/my')
    },

    validation: {
        /**
         * Проверка подлинности документа.
         * @param {FormData} formData - FormData с файлом.
         * @returns {Promise} Результат проверки.
         */
        check: (formData) => 
            apiInstance.post('/validation/check', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            }),

        /**
         * Получение истории проверок.
         * @returns {Promise} История проверок.
         */
        getHistory: () => 
            apiInstance.get('/validation/history')
    }
};

export default api;