import * as vscode from 'vscode';

export class ContextExtractor {
    public extractContext(document: vscode.TextDocument, position: vscode.Position): string {
        const maxContextLines = vscode.workspace.getConfiguration('claudeDev').get<number>('maxContextLines', 50);
        
        const startLine = Math.max(0, position.line - maxContextLines);
        const endLine = Math.min(document.lineCount - 1, position.line + Math.floor(maxContextLines / 2));
        
        const contextLines: string[] = [];
        
        for (let i = startLine; i <= endLine; i++) {
            const line = document.lineAt(i).text;
            if (i === position.line) {
                const beforeCursor = line.substring(0, position.character);
                const afterCursor = line.substring(position.character);
                contextLines.push(`${beforeCursor}<CURSOR>${afterCursor}`);
            } else {
                contextLines.push(line);
            }
        }
        
        const imports = this.extractImports(document);
        const fileInfo = this.getFileInfo(document);
        
        return [
            fileInfo,
            imports,
            '--- Code Context ---',
            contextLines.join('\n')
        ].filter(Boolean).join('\n\n');
    }

    private extractImports(document: vscode.TextDocument): string {
        const imports: string[] = [];
        const importRegexes = [
            /^import\s+.*$/gm,
            /^from\s+.*import\s+.*$/gm,
            /^#include\s+.*$/gm,
            /^using\s+.*$/gm,
            /^require\s*\(.*\)$/gm
        ];
        
        const text = document.getText();
        
        for (const regex of importRegexes) {
            const matches = text.match(regex);
            if (matches) {
                imports.push(...matches);
            }
        }
        
        return imports.length > 0 ? `--- Imports ---\n${imports.join('\n')}` : '';
    }

    private getFileInfo(document: vscode.TextDocument): string {
        const fileName = document.fileName.split('/').pop() || 'untitled';
        const language = document.languageId;
        
        return `--- File: ${fileName} (${language}) ---`;
    }
}