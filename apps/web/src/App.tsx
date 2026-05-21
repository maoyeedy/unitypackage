import { Component, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import './App.css';

import type { ExtractedFileContent, UnityPackageParseDiagnostic } from 'unitypackage-core';

import FileDropZone from './components/FileDropZone';
import FileList from './components/FileList';
import { Controls } from './components/Controls';
import { LanguageSelect } from './components/LanguageSelect';
import { Header } from './components/Header';

import { translations, type Language, type TranslationKey } from './translations';
import type { DownloadZipResponse, ParsePackageResponse } from './workerTypes';

interface ParseResult {
  files: ExtractedFileContent;
  diagnostics: UnityPackageParseDiagnostic[];
}

const isValidLanguage = (lang: string): lang is Language => {
  return lang in translations;
};

const getUrlBoolean = (params: URLSearchParams, name: string, fallback: boolean): boolean => {
  const value = params.get(name);
  if (value === null) return fallback;
  return value === 'true' || value === '1';
};

const getInitialLanguage = (): Language => {
  const urlLanguage = new URLSearchParams(window.location.search).get('language');
  if (urlLanguage && isValidLanguage(urlLanguage)) {
    return urlLanguage;
  }

  const browserLang = navigator.language.split('-')[0];
  return isValidLanguage(browserLang) ? browserLang : 'en';
};

const parsePackageInWorker = (buffer: ArrayBuffer): Promise<ParseResult> => {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./parsePackage.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = ({ data }: MessageEvent<ParsePackageResponse>) => {
      worker.terminate();
      if (data.type === 'success') {
        resolve({ files: data.files, diagnostics: data.diagnostics });
        return;
      }

      reject(new Error(data.message));
    };

    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };

    worker.onmessageerror = () => {
      worker.terminate();
      reject(new Error('Failed to receive parsed package data'));
    };

    worker.postMessage({ buffer }, [buffer]);
  });
};

const createDownloadZipInWorker = (
  files: ExtractedFileContent,
  excludeMeta: boolean,
  maintainStructure: boolean,
): Promise<Uint8Array | null> => {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./downloadZip.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = ({ data }: MessageEvent<DownloadZipResponse>) => {
      worker.terminate();
      if (data.type === 'success') {
        resolve(data.data);
        return;
      }

      if (data.type === 'empty') {
        resolve(null);
        return;
      }

      reject(new Error(data.message));
    };

    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };

    worker.onmessageerror = () => {
      worker.terminate();
      reject(new Error('Failed to receive ZIP data'));
    };

    worker.postMessage({ files, excludeMeta, maintainStructure });
  });
};

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    console.error('Unhandled web error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="App app-error" role="alert">
          <h1>Something went wrong.</h1>
          <p>Reload the page and try opening the package again.</p>
        </div>
      );
    }

    return this.props.children;
  }
}

function AppContent() {
  const initialParams = new URLSearchParams(window.location.search);
  const [files, setFiles] = useState<ExtractedFileContent>({});
  const [diagnostics, setDiagnostics] = useState<UnityPackageParseDiagnostic[]>([]);
  const [excludeMeta, setExcludeMeta] = useState(() => getUrlBoolean(initialParams, 'excludeMeta', true));
  const [categorizeByExtension, setCategorizeByExtension] = useState(() => getUrlBoolean(initialParams, 'categorize', true));
  const [maintainStructure, setMaintainStructure] = useState(false);
  const [enablePreview, setEnablePreview] = useState(false);
  const [showFileSize, setShowFileSize] = useState(true);
  const [language, setLanguage] = useState<Language>(getInitialLanguage);
  const [isLoading, setIsLoading] = useState(false);
  const [processingFileName, setProcessingFileName] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('excludeMeta', String(excludeMeta));
    params.set('categorize', String(categorizeByExtension));
    params.set('language', language);
    const nextUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    window.history.replaceState(null, '', nextUrl);
  }, [excludeMeta, categorizeByExtension, language]);

  const t = useCallback((key: TranslationKey, ...args: string[]) => {
    const languageTranslations = translations[language];
    const text = key in languageTranslations ? languageTranslations[key] : translations.en[key];
    return args.reduce((str, arg, i) => str.replace(`{${i.toString()}}`, arg), text);
  }, [language]);

  const handleFileDrop = async (file: File) => {
    setIsLoading(true);
    setProcessingFileName(file.name);
    setFiles({});
    setDiagnostics([]);
    const startTime = performance.now();
    try {
      const buffer = await file.arrayBuffer();
      const result = await parsePackageInWorker(buffer);
      const endTime = performance.now();
      console.log(`Extraction completed in ${(endTime - startTime).toFixed(2)}ms`);
      setFiles(result.files);
      setDiagnostics(result.diagnostics);
    } catch (error) {
      console.error('Error:', error);
      alert(t('errorMessage'));
    } finally {
      setIsLoading(false);
      setProcessingFileName(null);
    }
  };

  const handleDownloadAll = async () => {
    const startTime = performance.now();
    try {
      const data = await createDownloadZipInWorker(files, excludeMeta, maintainStructure);
      const endTime = performance.now();
      console.log(`Zip creation completed in ${(endTime - startTime).toFixed(2)}ms`);

      if (!data) {
        alert(t('invalidFile'));
        return;
      }

      const blob = new Blob([new Uint8Array(data)], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'all_files.zip';
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error:', error);
      alert(t('errorMessage'));
    }
  };

  return (
    <div className="App">
      <Header t={t} />
      <LanguageSelect
        currentLanguage={language}
        onLanguageChange={setLanguage}
      />
      <FileDropZone
        onFileDrop={(file) => void handleFileDrop(file)}
        label={isLoading && processingFileName ? `${t('processing')} ${processingFileName}` : t('dropZone')}
        invalidFileMessage={t('invalidFile')}
      />
      <Controls
        t={t}
        excludeMeta={excludeMeta}
        categorizeByExtension={categorizeByExtension}
        maintainStructure={maintainStructure}
        enablePreview={enablePreview}
        showFileSize={showFileSize}
        onExcludeMetaChange={setExcludeMeta}
        onCategorizeByExtensionChange={setCategorizeByExtension}
        onMaintainStructureChange={setMaintainStructure}
        onEnablePreviewChange={setEnablePreview}
        onShowFileSizeChange={setShowFileSize}
      />
      {diagnostics.length > 0 && !isLoading && (
        <section className="diagnostics" aria-live="polite">
          <h2>Parse diagnostics</h2>
          <ul>
            {diagnostics.map((diagnostic, index) => (
              <li key={`${diagnostic.code}-${diagnostic.path ?? diagnostic.guid ?? index.toString()}`}>
                <strong>{diagnostic.code}</strong>
                {': '}
                {diagnostic.message}
                {diagnostic.path ? ` (${diagnostic.path})` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
      {Object.keys(files).length > 0 && !isLoading && (
        <div className="download-all">
          <button type="button" onClick={() => void handleDownloadAll()}>{t('downloadAll')}</button>
        </div>
      )}
      {Object.keys(files).length > 0 && !isLoading && (
        <FileList
          files={files}
          excludeMeta={excludeMeta}
          categorizeByExtension={categorizeByExtension}
          maintainStructure={maintainStructure}
          enablePreview={enablePreview}
          showFileSize={showFileSize}
          downloadCategoryLabel={(cat: string) => t('downloadCategory', cat)}
        />
      )}
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

export default App;
