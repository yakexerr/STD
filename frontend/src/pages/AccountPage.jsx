import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';

/**
 * Страница личного кабинета.
 * Отображает разный контент для ISSUER и HOLDER.
 */
export default function AccountPage() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    const [documents, setDocuments] = useState([]);
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const [docType, setDocType] = useState('CERTIFICATE');
    const [holderEmail, setHolderEmail] = useState('');
    const [file, setFile] = useState(null);
    const [issuing, setIssuing] = useState(false);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            const [docsResponse, historyResponse] = await Promise.all([
                api.documents.getMy(),
                api.validation.getHistory()
            ]);

            setDocuments(docsResponse.data.documents);
            setHistory(historyResponse.data.requests);
        } catch (err) {
            setError('Ошибка загрузки данных');
        } finally {
            setLoading(false);
        }
    };

    const handleIssue = async (e) => {
        e.preventDefault();
        setError('');
        setSuccess('');

        if (!file) {
            setError('Выберите PDF файл');
            return;
        }

        if (!holderEmail) {
            setError('Укажите email владельца');
            return;
        }

        setIssuing(true);

        try {
            const formData = new FormData();
            formData.append('document', file);
            formData.append('type', docType);
            formData.append('holderEmail', holderEmail);

            await api.documents.issue(formData);
            setSuccess('Документ успешно выпущен');
            setHolderEmail('');
            setFile(null);
            loadData();
        } catch (err) {
            setError(err.response?.data?.error || 'Ошибка выпуска документа');
        } finally {
            setIssuing(false);
        }
    };

    const handleRevoke = async (documentId) => {
        if (!confirm('Вы уверены, что хотите отозвать этот документ?')) {
            return;
        }

        try {
            await api.documents.revoke(documentId);
            setSuccess('Документ отозван');
            loadData();
        } catch (err) {
            setError(err.response?.data?.error || 'Ошибка отзыва документа');
        }
    };

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    if (loading) {
        return <div className="container"><p>Загрузка...</p></div>;
    }

    return (
        <div className="container">
            <div className="header">
                <div>
                    <h1>Личный кабинет</h1>
                    <p><strong>Email:</strong> {user.email}</p>
                    <p><strong>Роль:</strong> {user.role === 'ISSUER' ? 'Эмитент' : 'Владелец'}</p>
                </div>
                <div>
                    <button className="btn btn-secondary" onClick={() => navigate('/validation')}>
                        Проверить документ
                    </button>
                    <button className="btn btn-danger" onClick={handleLogout}>
                        Выйти
                    </button>
                </div>
            </div>

            {error && <div className="error-message">{error}</div>}
            {success && <div className="success-message">{success}</div>}

            {user.role === 'ISSUER' && (
                <>
                    <section className="section">
                        <h2>Выпуск нового документа</h2>
                        <form onSubmit={handleIssue} className="form">
                            <div className="form-group">
                                <label htmlFor="doc-type">Тип документа</label>
                                <select
                                    id="doc-type"
                                    value={docType}
                                    onChange={(e) => setDocType(e.target.value)}
                                    disabled={issuing}
                                >
                                    <option value="CERTIFICATE">Сертификат</option>
                                    <option value="DIPLOMA">Диплом</option>
                                </select>
                            </div>

                            <div className="form-group">
                                <label htmlFor="holder-email">Email владельца</label>
                                <input
                                    id="holder-email"
                                    type="email"
                                    value={holderEmail}
                                    onChange={(e) => setHolderEmail(e.target.value)}
                                    required
                                    disabled={issuing}
                                />
                            </div>

                            <div className="form-group">
                                <label htmlFor="doc-file">PDF файл</label>
                                <input
                                    id="doc-file"
                                    type="file"
                                    accept=".pdf"
                                    onChange={(e) => setFile(e.target.files[0])}
                                    required
                                    disabled={issuing}
                                />
                            </div>

                            <button type="submit" className="btn btn-primary" disabled={issuing}>
                                {issuing ? 'Выпуск...' : 'Выпустить документ'}
                            </button>
                        </form>
                    </section>

                    <section className="section">
                        <h2>Выпущенные документы</h2>
                        {documents.length === 0 ? (
                            <p>Нет выпущенных документов</p>
                        ) : (
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>ID</th>
                                        <th>Тип</th>
                                        <th>Владелец</th>
                                        <th>Хэш</th>
                                        <th>Статус</th>
                                        <th>Дата</th>
                                        <th>Действия</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {documents.map((doc) => (
                                        <tr key={doc.id}>
                                            <td>{doc.id}</td>
                                            <td>{doc.type === 'DIPLOMA' ? 'Диплом' : 'Сертификат'}</td>
                                            <td>{doc.holder_id}</td>
                                            <td className="hash-cell">{doc.document_hash}</td>
                                            <td>
                                                <span className={`status-${doc.status.toLowerCase()}`}>
                                                    {doc.status}
                                                </span>
                                            </td>
                                            <td>{new Date(doc.issued_at).toLocaleString('ru-RU')}</td>
                                            <td>
                                                {doc.status === 'VALID' && (
                                                    <button
                                                        className="btn btn-danger btn-small"
                                                        onClick={() => handleRevoke(doc.id)}
                                                    >
                                                        Отозвать
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </section>
                </>
            )}

            {user.role === 'HOLDER' && (
                <section className="section">
                    <h2>Мои документы</h2>
                    {documents.length === 0 ? (
                        <p>У вас нет документов</p>
                    ) : (
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>Тип</th>
                                    <th>Эмитент</th>
                                    <th>Хэш</th>
                                    <th>Статус</th>
                                    <th>Дата</th>
                                    <th>Действия</th>
                                </tr>
                            </thead>
                            <tbody>
                                {documents.map((doc) => (
                                    <tr key={doc.id}>
                                        <td>{doc.id}</td>
                                        <td>{doc.type === 'DIPLOMA' ? 'Диплом' : 'Сертификат'}</td>
                                        <td>{doc.issuer_id}</td>
                                        <td className="hash-cell">{doc.document_hash}</td>
                                        <td>
                                            <span className={`status-${doc.status.toLowerCase()}`}>
                                                {doc.status}
                                            </span>
                                        </td>
                                        <td>{new Date(doc.issued_at).toLocaleString('ru-RU')}</td>
                                        <td>
                                            <button className="btn btn-secondary btn-small">
                                                Скачать
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </section>
            )}

            {history.length > 0 && (
                <section className="section">
                    <h2>История проверок</h2>
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Хэш документа</th>
                                <th>Результат</th>
                                <th>Дата</th>
                            </tr>
                        </thead>
                        <tbody>
                            {history.map((req) => (
                                <tr key={req.id}>
                                    <td className="hash-cell">{req.document_hash}</td>
                                    <td>
                                        <span className={`status-${req.result.toLowerCase()}`}>
                                            {req.result}
                                        </span>
                                    </td>
                                    <td>{new Date(req.created_at).toLocaleString('ru-RU')}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>
            )}
        </div>
    );
}