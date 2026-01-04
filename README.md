# Literary EPUB Translator

[![GitHub](https://img.shields.io/badge/GitHub-Repository-181717?logo=github)](https://github.com/EnesMCLK/literary-epub-translator)

A Single Page Application (SPA) built with React, TypeScript, Vite, and Tailwind CSS.

## 📋 Core Requirements

### 1. Pure Client-Side
* The application runs entirely in the browser.
* **NO** Python, Flask, or backend servers.
* Uses browser-native APIs and JavaScript libraries.

### 2. EPUB Handling
* Uses `jszip` to parse EPUB files.
* Regenerates valid EPUB files client-side after translation.

### 3. Translation Engine
* Integrates **Google Gemini API** for translating text chunks.
* The system instruction emphasizes **"Literary Translation"**, strictly preserving:
    * Tone & Style
    * Author's Voice
    * HTML Formatting

### 4. UI/UX (Tailwind CSS)
* **Sticky Header:** Status bar stays at the top during scrolling.
* **Log Viewer:** Console-like area showing real-time translation logs.
* **Progress Bar:** Visual indicator of the translation progress.
* **Typography:** Uses clean, serif fonts (`Merriweather`, `Inter`) for a book-like reading experience.

### 5. Features
* 📂 **Drag & Drop** file upload.
* 📑 **Chapter-by-chapter** processing.
* ⬇️ **Download EPUB** button.
* ⚠️ Robust error handling for API limits.

## 🛠️ Tech Stack
* **Framework:** React 18+
* **Build Tool:** Vite
* **Language:** TypeScript
* **Styling:** Tailwind CSS
* **Icons:** Lucide-React
* **AI:** Google GenAI SDK

## 🚀 How to Run
1. Clone the repository.
2. Open `index.html` directly in a modern browser (or serve via `npx vite`).
3. Enter your Google Gemini API Key.
4. Select a file and start translating.

---
*Generated based on the "Literary EPUB Translator" prompt specification.*