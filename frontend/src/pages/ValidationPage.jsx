import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';

export default function ValidationPage() {
    const [file, setFile] = useState(null);
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [isDragging, setIsDragging] = useState(false);

    const fileInputRef = useRef(null);
    const dragCounter = useRef(0);

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
        navigate(user ? '/account' : '/');
    };

    const statusClass = (result?.status || 'unknown').toLowerCase();

    const handleDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDragEnter = (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter.current += 1;
        if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
            setIsDragging(true);
        }
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter.current -= 1;
        if (dragCounter.current === 0) {
            setIsDragging(false);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        dragCounter.current = 0;
        
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const droppedFile = e.dataTransfer.files[0];
            if (droppedFile.type === 'application/pdf') {
                setFile(droppedFile);
                setError('');
            } else {
                setError('Пожалуйста, загрузите файл в формате PDF');
            }
        }
    };

    return (
        <div className="container validation-wrapper">
            <div className="validation-header">
                <button type="button" className="btn btn-ghost" onClick={handleBack}>
                    ← Назад
                </button>
                <h2 className="validation-title">Проверка подлинности</h2>
            </div>

            <p className="validation-subtitle">
                Загрузите PDF-документ, чтобы проверить его наличие в реестре блокчейна.
            </p>

            <form onSubmit={handleCheck} className="validation-form">
                <label 
                    className={`file-dropzone ${isDragging ? 'dragging' : ''} ${file ? 'has-file' : ''}`}
                    onDragEnter={handleDragEnter}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <input
                        type="file"
                        accept=".pdf"
                        ref={fileInputRef}
                        onChange={(e) => {
                            setFile(e.target.files[0] || null);
                            setError('');
                        }}
                        disabled={loading}
                    />
                    <div className="dropzone-content">
                        <svg className="dropzone-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
                        </svg>
                        {file ? (
                            <span className="dropzone-filename">{file.name}</span>
                        ) : (
                            <>
                                <span className="dropzone-text">
                                    {isDragging ? 'Отпустите файл для загрузки' : 'Нажмите для выбора файла'}
                                </span>
                                <span className="dropzone-hint">или перетащите PDF сюда</span>
                            </>
                        )}
                    </div>
                </label>

                <button type="submit" className="btn btn-primary btn-block" disabled={loading || !file}>
                    {loading ? 'Проверка...' : 'Проверить подлинность'}
                </button>
            </form>

            {error && <div className="error-message fade-in">{error}</div>}

            {result && (
                <div className={`validation-result-card status-${statusClass} fade-in`}>
                    <div className="result-icon">
                        {result.status === 'VALID' && '✓'}
                        {result.status === 'REVOKED' && '✗'}
                        {result.status === 'NOT_FOUND' && '?'}
                    </div>
                    <h3 className="result-title">
                        {result.status === 'VALID' && 'Документ подлинный'}
                        {result.status === 'REVOKED' && 'Документ отозван'}
                        {result.status === 'NOT_FOUND' && 'Документ не найден'}
                    </h3>
                    <p className="result-message">{result.message}</p>
                </div>
            )}
        </div>
    );
}