import { Component, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import './App.css';
import { zip } from 'fflate';

import { parseUnityPackageEntries } from 'unitypackage-core';
import type { ExtractedFileContent, UnityPackageEntry } from 'unitypackage-core';

import FileDropZone from './components/FileDropZone';
import FileList from './components/FileList';
import { Controls } from './components/Controls';
import { LanguageSelect } from './components/LanguageSelect';
import { Header } from './components/Header';

import { translations, type Language, type TranslationKey } from './translations';

const isValidLanguage = (lang: string): lang is Language => {
  return lang in translations;
};

const entriesToFiles = (entries: UnityPackageEntry[]): ExtractedFileContent => {
  const result: ExtractedFileContent = {};

  for (const entry of entries) {
    if (entry.asset) {
      result[entry.pathname] = entry.asset;
    }

    if (entry.meta) {
      result[`${entry.pathname}.meta`] = entry.meta;
    }
  }

  return result;
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
  const [files, setFiles] = useState<ExtractedFileContent>({});
  const [excludeMeta, setExcludeMeta] = useState(true);
  const [categorizeByExtension, setCategorizeByExtension] = useState(true);
  const [maintainStructure, setMaintainStructure] = useState(false);
  const [enablePreview, setEnablePreview] = useState(false);
  const [showFileSize, setShowFileSize] = useState(true);
  const [language, setLanguage] = useState<Language>('en');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const browserLang = navigator.language.split('-')[0];
    if (isValidLanguage(browserLang)) {
      setLanguage(browserLang);
    }
  }, []);

  const t = useCallback((key: TranslationKey, ...args: string[]) => {
    const languageTranslations = translations[language];
    const text = key in languageTranslations ? languageTranslations[key] : translations.en[key];
    return args.reduce((str, arg, i) => str.replace(`{${i.toString()}}`, arg), text);
  }, [language]);

  const handleFileDrop = async (file: File) => {
    setIsLoading(true);
    setFiles({});
    const startTime = performance.now();
    try {
      const buffer = await file.arrayBuffer();
      const extracted = entriesToFiles(parseUnityPackageEntries(new Uint8Array(buffer)));
      const endTime = performance.now();
      console.log(`Extraction completed in ${(endTime - startTime).toFixed(2)}ms`);
      setFiles(extracted);
    } catch (error) {
      console.error('Error:', error);
      alert(t('errorMessage'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadAll = () => {
    const startTime = performance.now();
    const filesToZip: Record<string, Uint8Array> = {};
    for (const [path, content] of Object.entries(files)) {
      if (excludeMeta && path.endsWith('.meta')) continue;
      const filePath = maintainStructure ? path : path.split('/').pop() ?? path;
      filesToZip[filePath] = content;
    }

    if (Object.keys(filesToZip).length === 0) {
      alert(t('invalidFile'));
      return;
    }

    zip(filesToZip, (err, data) => {
      const endTime = performance.now();
      console.log(`Zip creation completed in ${(endTime - startTime).toFixed(2)}ms`);
      if (err) {
        console.error('Error:', err);
        alert(t('errorMessage'));
        return;
      }
      const blob = new Blob([data], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'all_files.zip';
      link.click();
      URL.revokeObjectURL(url);
    });
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
        label={isLoading ? t('processing') : t('dropZone')}
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
      {Object.keys(files).length > 0 && !isLoading && (
        <div className="download-all">
          <button type="button" onClick={handleDownloadAll}>{t('downloadAll')}</button>
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
