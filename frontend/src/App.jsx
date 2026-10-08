import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import AuthPage from './pages/AuthPage';
import AccountPage from './pages/AccountPage';
import ValidationPage from './pages/ValidationPage';
import './App.css';

/**
 * Защищённый роут.
 * Редиректит на /login если пользователь не авторизован.
 * @param {Object} props - Props компонента.
 * @param {React.ReactNode} props.children - Дочерние компоненты.
 */
function ProtectedRoute({ children }) {
    const { user, loading } = useAuth();

    if (loading) {
        return <div className="container"><p>Загрузка...</p></div>;
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    return children;
}

/**
 * Главный компонент приложения с роутингом.
 */
function AppRoutes() {
    const { user } = useAuth();

    return (
        <Routes>
            <Route
                path="/"
                element={user ? <Navigate to="/account" replace /> : <AuthPage />}
            />
            <Route path="/login" element={<AuthPage />} />
            <Route
                path="/account"
                element={
                    <ProtectedRoute>
                        <AccountPage />
                    </ProtectedRoute>
                }
            />
            <Route path="/validation" element={<ValidationPage />} />
        </Routes>
    );
}

/**
 * Корневой компонент приложения.
 */
function App() {
    return (
        <BrowserRouter>
            <AuthProvider>
                <AppRoutes />
            </AuthProvider>
        </BrowserRouter>
    );
}

export default App;