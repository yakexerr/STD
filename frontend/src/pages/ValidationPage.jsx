import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';

/**
 * Публичная страница проверки подлинности документа.
 */
export default function ValidationPage() {
    const [file, setFile] = useState(null);
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const { user } = useAuth();
    const navigate = useNavigate();

    const handleCheck = async (e) => {
        e.preventDefault();
        setError('');
        setResult(null);

        if (!file) {
            setError('Выберите PDF файл для проверки');
            return;
        }

        setLoading(true);

        try {
            const formData = new FormData();
            formData.append('document', file);

            const response = await api.validation.check(formData);
            setResult(response.data);
        } catch (err) {
            setError(err.response?.data?.error || 'Ошибка проверки документа');
        } finally {
            setLoading(false);
        }
    };

    const handleBack = () => {
        if (user) {
            navigate('/account');
        } else {
            navigate('/');
        }
    };

    return (
        <div className="container">
            <h1>Проверка подлинности документа</h1>

            <form onSubmit={handleCheck} className="form">
                <div className="form-group">
                    <label htmlFor="validation-file">Загрузите PDF файл для проверки</label>
                    <input
                        id="validation-file"
                        type="file"
                        accept=".pdf"
                        onChange={(e) => setFile(e.target.files[0])}
                        required
                        disabled={loading}
                    />
                </div>

                <button type="submit" className="btn btn-primary" disabled={loading}>
                    {loading ? 'Проверка...' : 'Проверить подлинность'}
                </button>
            </form>

            {error && <div className="error-message">{error}</div>}

            {result && (
                <div className={`validation-result status-${result.status.toLowerCase()}`}>
                    <h2>Результат проверки</h2>
                    <p className="result-status">
                        {result.status === 'VALID' && '✓ Документ подлинный'}
                        {result.status === 'REVOKED' && '✗ Документ отозван'}
                        {result.status === 'NOT_FOUND' && '? Документ не найден в реестре'}
                    </p>
                    <p>{result.message}</p>
                </div>
            )}

            <button className="btn btn-secondary" onClick={handleBack}>
                Назад
            </button>
        </div>
    );
}