import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

/**
 * Страница аутентификации с вкладками входа и регистрации.
 */
export default function AuthPage() {
    const [activeTab, setActiveTab] = useState('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState('HOLDER');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const { user, login, register } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        if (user) {
            navigate('/account');
        }
    }, [user, navigate]);

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await login(email, password);
            navigate('/account');
        } catch (err) {
            setError(err.response?.data?.error || 'Ошибка входа');
        } finally {
            setLoading(false);
        }
    };

    const handleRegister = async (e) => {
        e.preventDefault();
        setError('');

        if (password.length < 6) {
            setError('Пароль должен содержать минимум 6 символов');
            return;
        }

        setLoading(true);

        try {
            await register(email, password, role);
            navigate('/account');
        } catch (err) {
            setError(err.response?.data?.error || 'Ошибка регистрации');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="container">
            <h1>STD - Платформа верификации дипломов</h1>

            <div className="tabs">
                <button
                    className={`tab ${activeTab === 'login' ? 'active' : ''}`}
                    onClick={() => setActiveTab('login')}
                >
                    Вход
                </button>
                <button
                    className={`tab ${activeTab === 'register' ? 'active' : ''}`}
                    onClick={() => setActiveTab('register')}
                >
                    Регистрация
                </button>
            </div>

            {error && <div className="error-message">{error}</div>}

            {activeTab === 'login' ? (
                <form onSubmit={handleLogin} className="form">
                    <h2>Вход в систему</h2>

                    <div className="form-group">
                        <label htmlFor="login-email">Email</label>
                        <input
                            id="login-email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            disabled={loading}
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="login-password">Пароль</label>
                        <input
                            id="login-password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            disabled={loading}
                        />
                    </div>

                    <button type="submit" className="btn btn-primary" disabled={loading}>
                        {loading ? 'Вход...' : 'Войти'}
                    </button>
                </form>
            ) : (
                <form onSubmit={handleRegister} className="form">
                    <h2>Регистрация</h2>

                    <div className="form-group">
                        <label htmlFor="register-email">Email</label>
                        <input
                            id="register-email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            disabled={loading}
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="register-password">Пароль (мин. 6 символов)</label>
                        <input
                            id="register-password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            minLength={6}
                            disabled={loading}
                        />
                    </div>

                    <div className="form-group">
                        <label>Роль</label>
                        <div className="radio-group">
                            <label>
                                <input
                                    type="radio"
                                    value="HOLDER"
                                    checked={role === 'HOLDER'}
                                    onChange={(e) => setRole(e.target.value)}
                                    disabled={loading}
                                />
                                Владелец (HOLDER)
                            </label>
                            <label>
                                <input
                                    type="radio"
                                    value="ISSUER"
                                    checked={role === 'ISSUER'}
                                    onChange={(e) => setRole(e.target.value)}
                                    disabled={loading}
                                />
                                Эмитент (ISSUER)
                            </label>
                        </div>
                    </div>

                    <button type="submit" className="btn btn-primary" disabled={loading}>
                        {loading ? 'Регистрация...' : 'Зарегистрироваться'}
                    </button>
                </form>
            )}
        </div>
    );
}